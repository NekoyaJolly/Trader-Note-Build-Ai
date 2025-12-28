/**
 * 通知 API クライアント
 * Phase4 で実装された API エンドポイントとの連携
 */

import type {
  NotificationListItem,
  NotificationDetail,
} from "@/types/notification";
import type { NoteListItem, NoteDetail } from "@/types/note";

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

/**
 * ノート一覧を取得
 * GET /api/notes
 * Phase1 では空配列が返るため、UI 側で Empty を適切に表示する。
 */
export async function fetchNotes(): Promise<NoteListItem[]> {
  const response = await fetch(`${API_BASE_URL}/api/notes`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `ノート一覧の取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }

  const payload = await response.json();
  const notes = payload?.notes ?? payload?.data?.notes ?? [];

  if (!Array.isArray(notes)) {
    throw new Error("ノート一覧のレスポンス形式が不正です");
  }

  // API のフィールド差異を UI 用に最小整形（存在するフィールドのみ利用）
  const normalized: NoteListItem[] = notes.map((n: any) => ({
    id: String(n.id),
    symbol: String(n.symbol ?? ""),
    side: n.side === "sell" ? "sell" : "buy", // デフォルトは buy
    timestamp: String(n.timestamp ?? n.createdAt ?? new Date().toISOString()),
    aiSummary: n.aiSummary ?? null,
    status: "draft",
    modeEstimated: "未推定",
  }));

  return normalized;
}

/**
 * ノート詳細を取得
 * GET /api/notes/:id
 * Phase1 では 404 が返り得るため、エラー表示を行う。
 */
export async function fetchNoteDetail(id: string): Promise<NoteDetail> {
  const response = await fetch(`${API_BASE_URL}/api/notes/${id}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `ノート詳細の取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  return data;
}

/**
 * ヘルスチェック
 * GET /api/health
 */
export async function fetchHealth(): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE_URL}/api/health`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `ヘルスチェックに失敗しました: ${response.status} ${response.statusText}`
    );
  }
  return response.json();
}

/**
 * 日次ステータス
 * GET /api/daily-status
 */
export async function fetchDailyStatus(): Promise<any> {
  const response = await fetch(`${API_BASE_URL}/api/daily-status`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `日次ステータス取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }
  return response.json();
}
