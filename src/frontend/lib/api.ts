/**
 * 通知 API クライアント
 * Phase4 で実装された API エンドポイントとの連携
 */

import type {
  NotificationListItem,
  NotificationDetail,
} from "@/types/notification";

/**
 * バックエンド API のベース URL
 * 環境変数から取得、デフォルトは localhost:3100
 */
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3100";

/**
 * 通知一覧を取得
 * GET /api/notifications
 */
export async function fetchNotifications(): Promise<NotificationListItem[]> {
  const response = await fetch(`${API_BASE_URL}/api/notifications`, {
    cache: "no-store", // 常に最新データを取得
  });

  if (!response.ok) {
    throw new Error(
      `通知一覧の取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }

  const payload = await response.json();

  // API レスポンスのラップ構造をここで吸収し、UI には配列のみ渡す
  const notifications =
    payload?.notifications ?? payload?.data?.notifications ?? [];

  if (!Array.isArray(notifications)) {
    throw new Error("通知一覧のレスポンス形式が不正です");
  }

  return notifications;
}

/**
 * 通知詳細を取得
 * GET /api/notifications/:id
 */
export async function fetchNotificationDetail(
  id: string
): Promise<NotificationDetail> {
  const response = await fetch(`${API_BASE_URL}/api/notifications/${id}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `通知詳細の取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

/**
 * 通知を既読にする
 * POST /api/notifications/:id/read
 */
export async function markNotificationAsRead(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/notifications/${id}/read`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      `通知の既読化に失敗しました: ${response.status} ${response.statusText}`
    );
  }
}

/**
 * すべての通知を既読にする
 * POST /api/notifications/read-all
 */
export async function markAllNotificationsAsRead(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/notifications/read-all`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      `全通知の既読化に失敗しました: ${response.status} ${response.statusText}`
    );
  }
}
