/**
 * 通知 SSE 購読フック (Phase δ-3/δ-4、NOTE_SIMILARITY_FOUNDATION.md §13.3)
 *
 * 認証付き per-user 通知 SSE (`GET /api/notifications/stream`) を購読し、
 * 未読バッジと通知フィードをページ更新なしで最新化する。
 *
 * 設計:
 * - **接続はモジュール内で 1 本を共有** (Header のバッジと通知一覧が同時に購読しても
 *   EventSource は 1 つ。useRealtimeChart の共有接続パターンを踏襲)
 * - **StrictMode 二重マウント対策**: readyState (0=CONNECTING / 1=OPEN) を確認して
 *   進行中・確立済みの接続を殺さない (PR #357 の教訓、status+readyState の 2 段ガード)
 * - **エラー時のフォールバック**: SSE が切れたら 30 秒間隔の REST ポーリング
 *   (`fetchUnreadNotificationCount`) に退避しつつ、30 秒ごとに SSE 再接続を試みる
 *   (= 自動更新が完全には止まらない)
 *
 * 新規ファイルの理由: 通知ストリーム購読という恒久的な独立責務
 * (useRealtimeChart = チャートのバー配信 / 本フック = 通知配信)。
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { EventSourcePolyfill } from "event-source-polyfill";
import { fetchUnreadNotificationCount } from "@/lib/api";

/** SSE 再接続 / REST フォールバックの間隔 (ms) */
const RECONNECT_INTERVAL_MS = 30_000;

interface NotificationStreamSubscriber {
  onUnread: (count: number) => void;
  onNotification: () => void;
}

// ========================================
// モジュール共有状態 (接続 1 本を全購読者で共有)
// ========================================

let sharedSource: EventSourcePolyfill | null = null;
let sharedUnread = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const subscribers = new Set<NotificationStreamSubscriber>();

const emitUnread = (count: number): void => {
  sharedUnread = count;
  subscribers.forEach((sub) => sub.onUnread(count));
};

const emitNotification = (): void => {
  subscribers.forEach((sub) => sub.onNotification());
};

/** REST で未読数を 1 回同期する (SSE 接続前 / フォールバック用) */
const syncUnreadViaRest = (): void => {
  fetchUnreadNotificationCount()
    .then(emitUnread)
    .catch(() => {
      /* 一過性の失敗は無視 (次のポーリング/SSE で自己回復) */
    });
};

const disconnectShared = (): void => {
  if (sharedSource) {
    sharedSource.close();
    sharedSource = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

const ensureConnected = (): void => {
  // StrictMode 二重マウント対策: 進行中 (CONNECTING=0) / 確立済み (OPEN=1) の接続は殺さない
  if (sharedSource && (sharedSource.readyState === 0 || sharedSource.readyState === 1)) {
    return;
  }
  disconnectShared();

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  const source = new EventSourcePolyfill(`${apiBase}/api/notifications/stream`, {
    withCredentials: true, // 認証は auth_token cookie (本番は SameSite=None + Secure)
    heartbeatTimeout: 120_000, // サーバ heartbeat は 30 秒間隔。2 分無音で再接続判定
  });
  sharedSource = source;

  source.addEventListener("unread_count", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data as string) as { count: number };
      if (typeof data.count === "number") emitUnread(data.count);
    } catch {
      /* 不正ペイロードは無視 */
    }
  });

  source.addEventListener("notification", () => {
    // ペイロードは使わず「新着があった」事実だけ通知する。
    // 一覧の形 (matchResult 込み) は REST が正のため、購読側が再取得する
    emitNotification();
  });

  source.onerror = () => {
    // 切断: REST で未読数を維持しつつ、一定間隔で SSE 再接続を試みる
    disconnectShared();
    syncUnreadViaRest();
    if (subscribers.size > 0 && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (subscribers.size > 0) ensureConnected();
      }, RECONNECT_INTERVAL_MS);
    }
  };
};

// ========================================
// カスタムフック
// ========================================

export interface UseNotificationStreamResult {
  /** 未読通知数 (SSE で自動更新) */
  unreadCount: number;
}

/**
 * 通知 SSE を購読する。
 *
 * @param onNotification 新着通知の到着時に呼ばれる (一覧の再取得等)。省略可
 */
export function useNotificationStream(onNotification?: () => void): UseNotificationStreamResult {
  const [unreadCount, setUnreadCount] = useState<number>(sharedUnread);
  // コールバックの identity 変化で再購読しないよう ref 経由で参照する
  const onNotificationRef = useRef(onNotification);
  onNotificationRef.current = onNotification;

  useEffect(() => {
    const subscriber: NotificationStreamSubscriber = {
      onUnread: setUnreadCount,
      onNotification: () => onNotificationRef.current?.(),
    };
    subscribers.add(subscriber);

    // 初期表示: SSE の初回 unread_count が届くまでの間を REST で埋める
    syncUnreadViaRest();
    ensureConnected();

    return () => {
      subscribers.delete(subscriber);
      // 最後の購読者が居なくなったら接続を畳む (画面遷移で無駄な常時接続を残さない)
      if (subscribers.size === 0) {
        disconnectShared();
      }
    };
  }, []);

  return { unreadCount };
}
