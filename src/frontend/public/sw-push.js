/**
 * Service Worker（Web Push 通知用）
 *
 * このファイルは public/ に配置され、ブラウザから直接読み込まれる
 * Push イベントを受信して通知を表示する
 */

/// <reference lib="webworker" />

// Service Worker の型定義
declare const self: ServiceWorkerGlobalScope;

/**
 * Push イベントハンドラ
 *
 * サーバーから Push 通知を受信したときに呼ばれる
 */
self.addEventListener("push", (event) => {
  if (!event.data) {
    console.warn("[SW] Push イベントにデータがありません");
    return;
  }

  try {
    // JSON ペイロードをパース
    const payload = event.data.json();

    const { title, body, icon, badge, url, tag, data } = payload;

    // 通知オプション
    const options: NotificationOptions = {
      body: body || "",
      icon: icon || "/icon-192x192.png",
      badge: badge || "/icon-192x192.png",
      tag: tag || "default",
      data: {
        url: url || "/",
        ...data,
      },
      // 振動パターン（モバイル用）
      vibrate: [100, 50, 100],
      // 通知が消えるまで待つ
      requireInteraction: true,
      // タイムスタンプ
      timestamp: Date.now(),
    };

    // 通知を表示
    event.waitUntil(
      self.registration.showNotification(title || "TradeAssist", options)
    );
  } catch (error) {
    console.error("[SW] Push データのパースに失敗:", error);
  }
});

/**
 * 通知クリックハンドラ
 *
 * ユーザーが通知をクリックしたときに呼ばれる
 */
self.addEventListener("notificationclick", (event) => {
  // 通知を閉じる
  event.notification.close();

  // クリック時の遷移先 URL を取得
  const url = event.notification.data?.url || "/";

  // 既存のウィンドウがあればフォーカス、なければ新しいウィンドウを開く
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // 同じオリジンの既存ウィンドウを探す
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            // 既存ウィンドウをフォーカスしてナビゲート
            client.focus();
            client.postMessage({
              type: "NOTIFICATION_CLICK",
              url,
            });
            return;
          }
        }
        // 既存ウィンドウがなければ新しく開く
        return self.clients.openWindow(url);
      })
  );
});

/**
 * Service Worker インストールハンドラ
 */
self.addEventListener("install", (event) => {
  console.log("[SW] インストール完了");
  // 即座にアクティブ化
  self.skipWaiting();
});

/**
 * Service Worker アクティベートハンドラ
 */
self.addEventListener("activate", (event) => {
  console.log("[SW] アクティブ化完了");
  // 古いキャッシュを削除
  event.waitUntil(
    self.clients.claim()
  );
});

export {};
