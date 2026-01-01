/**
 * Web Push 通知フック
 *
 * Push 通知の購読管理を行うカスタムフック
 * - 購読状態の管理
 * - 購読の登録・解除
 * - 通知許可のリクエスト
 */

"use client";

import { useState, useEffect, useCallback } from "react";

// バックエンドの API URL
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3100";

/**
 * Push 通知の状態
 */
export type PushPermissionState = "default" | "granted" | "denied" | "unsupported";

/**
 * フックの戻り値
 */
export interface UsePushNotificationResult {
  /** 通知の許可状態 */
  permission: PushPermissionState;
  /** 購読中かどうか */
  isSubscribed: boolean;
  /** 処理中かどうか */
  isLoading: boolean;
  /** エラーメッセージ */
  error: string | null;
  /** 購読を開始 */
  subscribe: () => Promise<boolean>;
  /** 購読を解除 */
  unsubscribe: () => Promise<boolean>;
  /** 通知許可をリクエスト */
  requestPermission: () => Promise<NotificationPermission>;
  /** Service Worker がサポートされているか */
  isSupported: boolean;
}

/**
 * Base64 URL を Uint8Array に変換
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Web Push 通知フック
 */
export function usePushNotification(): UsePushNotificationResult {
  const [permission, setPermission] = useState<PushPermissionState>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Service Worker と Push API がサポートされているか
  const isSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window;

  /**
   * 初期化: 現在の購読状態を確認
   */
  useEffect(() => {
    if (!isSupported) {
      setPermission("unsupported");
      return;
    }

    // 通知許可の状態を取得
    setPermission(Notification.permission as PushPermissionState);

    // 現在の購読状態を確認
    const checkSubscription = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setIsSubscribed(!!subscription);
      } catch (err) {
        console.error("[usePushNotification] 購読状態の確認に失敗:", err);
      }
    };

    checkSubscription();
  }, [isSupported]);

  /**
   * 通知許可をリクエスト
   */
  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!isSupported) {
      return "denied";
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result as PushPermissionState);
      return result;
    } catch (err) {
      console.error("[usePushNotification] 許可リクエストに失敗:", err);
      return "denied";
    }
  }, [isSupported]);

  /**
   * 購読を開始
   */
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setError("このブラウザはPush通知をサポートしていません");
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 通知許可を確認
      if (Notification.permission === "denied") {
        setError("通知がブロックされています。ブラウザの設定から許可してください。");
        return false;
      }

      if (Notification.permission === "default") {
        const result = await requestPermission();
        if (result !== "granted") {
          setError("通知の許可が必要です");
          return false;
        }
      }

      // VAPID 公開鍵を取得
      const vapidResponse = await fetch(`${API_BASE_URL}/api/push/vapid-public-key`);
      if (!vapidResponse.ok) {
        const data = await vapidResponse.json();
        throw new Error(data.error || "VAPID鍵の取得に失敗しました");
      }
      const { data: vapidData } = await vapidResponse.json();
      const vapidPublicKey = vapidData.publicKey;

      // Service Worker を登録
      const registration = await navigator.serviceWorker.register("/sw-push.js");
      await navigator.serviceWorker.ready;

      // Push 購読を作成
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });

      // サーバーに購読を登録
      const token = localStorage.getItem("accessToken");
      const subscribeResponse = await fetch(`${API_BASE_URL}/api/push/subscribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          subscription: {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: btoa(
                String.fromCharCode(...new Uint8Array(subscription.getKey("p256dh")!))
              ),
              auth: btoa(
                String.fromCharCode(...new Uint8Array(subscription.getKey("auth")!))
              ),
            },
          },
        }),
      });

      if (!subscribeResponse.ok) {
        const data = await subscribeResponse.json();
        throw new Error(data.error || "購読の登録に失敗しました");
      }

      setIsSubscribed(true);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "購読に失敗しました";
      setError(message);
      console.error("[usePushNotification] 購読エラー:", err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, requestPermission]);

  /**
   * 購読を解除
   */
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        setIsSubscribed(false);
        return true;
      }

      // サーバーから購読を解除
      const token = localStorage.getItem("accessToken");
      await fetch(`${API_BASE_URL}/api/push/unsubscribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });

      // ブラウザの購読を解除
      await subscription.unsubscribe();

      setIsSubscribed(false);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "購読解除に失敗しました";
      setError(message);
      console.error("[usePushNotification] 購読解除エラー:", err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  return {
    permission,
    isSubscribed,
    isLoading,
    error,
    subscribe,
    unsubscribe,
    requestPermission,
    isSupported,
  };
}
