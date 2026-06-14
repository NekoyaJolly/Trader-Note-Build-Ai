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
import { apiRequest } from "./apiClient";

/**
 * Push 通知の状態
 */
export type PushPermissionState = "default" | "granted" | "denied" | "unsupported";

/**
 * Push 通知サーバーの状態
 */
export interface PushServerStatus {
  /** Web Push 送信サービスが有効か */
  enabled: boolean;
  /** VAPID 公開鍵が設定されているか */
  hasVapidKey: boolean;
}

interface PushStatusResponse {
  success: boolean;
  data: PushServerStatus;
}

interface VapidPublicKeyResponse {
  success: boolean;
  data: {
    publicKey: string;
  };
}

interface PushSubscribeResponse {
  success: boolean;
  data: {
    id: string;
    endpoint: string;
    active: boolean;
  };
  message?: string;
}

interface PushTestResponse {
  success: boolean;
  data: {
    successCount: number;
    failureCount: number;
  };
  message?: string;
}

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
  /** サーバー側の Web Push 状態 */
  serverStatus: PushServerStatus | null;
  /** サーバー側状態の取得エラー */
  serverStatusError: string | null;
  /** 状態確認中かどうか */
  isCheckingStatus: boolean;
  /** テスト通知の結果メッセージ */
  testMessage: string | null;
  /** 購読を開始 */
  subscribe: () => Promise<boolean>;
  /** 購読を解除 */
  unsubscribe: () => Promise<boolean>;
  /** テスト通知を送信 */
  sendTestNotification: () => Promise<boolean>;
  /** サーバー側状態とブラウザ購読状態を再確認 */
  refreshStatus: () => Promise<void>;
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
 * PushSubscription の鍵を Base64 文字列に変換する
 */
function encodeSubscriptionKey(key: ArrayBuffer | null, keyName: string): string {
  if (!key) {
    throw new Error(`${keyName} 鍵の取得に失敗しました`);
  }

  const bytes = new Uint8Array(key);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Web Push 通知フック
 */
export function usePushNotification(): UsePushNotificationResult {
  const [permission, setPermission] = useState<PushPermissionState>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<PushServerStatus | null>(null);
  const [serverStatusError, setServerStatusError] = useState<string | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(null);

  // Service Worker と Push API がサポートされているか
  const isSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  /**
   * ブラウザ側の購読状態を確認
   */
  const checkBrowserSubscription = useCallback(async (): Promise<void> => {
    if (!isSupported) {
      setIsSubscribed(false);
      return;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
    } catch (err) {
      console.error("[usePushNotification] 購読状態の確認に失敗:", err);
      setIsSubscribed(false);
    }
  }, [isSupported]);

  /**
   * サーバー側の Web Push 状態とブラウザ購読状態を再確認
   */
  const refreshStatus = useCallback(async (): Promise<void> => {
    if (!isSupported) {
      setServerStatus(null);
      setServerStatusError(null);
      setIsSubscribed(false);
      return;
    }

    setIsCheckingStatus(true);
    setServerStatusError(null);

    try {
      const payload = await apiRequest<PushStatusResponse>("/api/push/status", {
        cache: "no-store",
      });
      setServerStatus(payload.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Push通知状態の取得に失敗しました";
      setServerStatus(null);
      setServerStatusError(message);
    } finally {
      setIsCheckingStatus(false);
    }

    await checkBrowserSubscription();
  }, [checkBrowserSubscription, isSupported]);

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
    refreshStatus().catch((err) => {
      console.error("[usePushNotification] 初期状態の確認に失敗:", err);
    });
  }, [isSupported, refreshStatus]);

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
      const vapidPayload = await apiRequest<VapidPublicKeyResponse>("/api/push/vapid-public-key");
      const vapidPublicKey = vapidPayload.data.publicKey;
      if (!vapidPublicKey) {
        throw new Error("VAPID鍵の取得に失敗しました");
      }

      // Service Worker を登録
      const registration = await navigator.serviceWorker.register("/sw-push.js");
      await navigator.serviceWorker.ready;

      // Push 購読を作成
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });

      try {
        // サーバーに購読を登録
        await apiRequest<PushSubscribeResponse>("/api/push/subscribe", {
          method: "POST",
          body: JSON.stringify({
            subscription: {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: encodeSubscriptionKey(subscription.getKey("p256dh"), "p256dh"),
                auth: encodeSubscriptionKey(subscription.getKey("auth"), "auth"),
              },
            },
          }),
        });
      } catch (serverError) {
        // サーバー登録に失敗した場合、ブラウザ側だけ購読済みになる不整合を残さない
        await subscription.unsubscribe().catch((rollbackError) => {
          console.error(
            "[usePushNotification] サーバー登録失敗後の購読ロールバックに失敗:",
            rollbackError
          );
        });
        setIsSubscribed(false);
        throw serverError;
      }

      setIsSubscribed(true);
      setTestMessage(null);
      await refreshStatus();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "購読に失敗しました";
      setError(message);
      console.error("[usePushNotification] 購読エラー:", err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, refreshStatus, requestPermission]);

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
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();

      if (!subscription) {
        setIsSubscribed(false);
        return true;
      }

      // サーバーから購読を解除
      await apiRequest<{ success: boolean; message?: string }>("/api/push/unsubscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });

      // ブラウザの購読を解除
      await subscription.unsubscribe();

      setIsSubscribed(false);
      setTestMessage(null);
      await refreshStatus();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "購読解除に失敗しました";
      setError(message);
      console.error("[usePushNotification] 購読解除エラー:", err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, refreshStatus]);

  /**
   * テスト通知を送信
   */
  const sendTestNotification = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setError("このブラウザはPush通知をサポートしていません");
      return false;
    }

    setIsLoading(true);
    setError(null);
    setTestMessage(null);

    try {
      const payload = await apiRequest<PushTestResponse>("/api/push/test", {
        method: "POST",
      });
      setTestMessage(payload.message ?? `${payload.data.successCount}件の通知を送信しました`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "テスト通知の送信に失敗しました";
      setError(message);
      console.error("[usePushNotification] テスト通知エラー:", err);
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
    serverStatus,
    serverStatusError,
    isCheckingStatus,
    testMessage,
    subscribe,
    unsubscribe,
    sendTestNotification,
    refreshStatus,
    requestPermission,
    isSupported,
  };
}
