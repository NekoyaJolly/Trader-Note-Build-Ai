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
    method: "PUT",
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
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error(
      `全通知の既読化に失敗しました: ${response.status} ${response.statusText}`
    );
  }
}

/**
 * ノート一覧を取得
 * GET /api/trades/notes
 */
export async function fetchNotes(): Promise<NoteListItem[]> {
  const response = await fetch(`${API_BASE_URL}/api/trades/notes`, {
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

  // API レスポンスを UI 用の型に整形
  const normalized: NoteListItem[] = notes.map((n: Record<string, unknown>) => ({
    id: String(n.id),
    symbol: String(n.symbol ?? ""),
    side: n.side === "sell" ? "sell" : "buy",
    timestamp: String(n.timestamp ?? n.createdAt ?? new Date().toISOString()),
    aiSummary: (n.aiSummary as string | null) ?? null,
    status: (n.status as "draft" | "approved") ?? "draft",
  }));

  return normalized;
}

/**
 * ノート詳細を取得
 * GET /api/notes/:id
 * Phase1 では 404 が返り得るため、エラー表示を行う。
 */
export async function fetchNoteDetail(id: string): Promise<NoteDetail> {
  const response = await fetch(`${API_BASE_URL}/api/trades/notes/${id}`, {
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
 * CSV テキストをアップロードして取り込み＆ノート生成
 * POST /api/trades/import/upload-text
 */
export async function uploadCsvText(
  filename: string,
  csvText: string
): Promise<{ tradesImported: number; noteIds: string[] }> {
  const response = await fetch(`${API_BASE_URL}/api/trades/import/upload-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, csvText }),
  });
  if (!response.ok) {
    throw new Error(
      `CSV アップロードに失敗しました: ${response.status} ${response.statusText}`
    );
  }
  return response.json();
}

/**
 * ノート承認（簡易）
 * POST /api/trades/notes/:id/approve
 */
export async function approveNote(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/trades/notes/${id}/approve`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `ノート承認に失敗しました: ${response.status} ${response.statusText}`
    );
  }
}

/**
 * ヘルスチェック
 * GET /api/health
 */
export async function fetchHealth(): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE_URL}/health`, { cache: "no-store" });
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
export async function fetchDailyStatus(): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE_URL}/api/daily-status`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `日次ステータス取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }
  return response.json();
}

/**
 * 注文プリセットの型定義
 */
export interface OrderPreset {
  symbol: string;
  side: "buy" | "sell" | "BUY" | "SELL";
  suggestedPrice: number;
  suggestedQuantity: number;
  basedOnNoteId: string;
  confidence: number;
}

/**
 * 注文プリセットを取得
 * GET /api/orders/preset/:noteId
 * 
 * 注意: 本システムは自動売買を行いません。参考情報のみを提供します。
 */
export async function fetchOrderPreset(noteId: string): Promise<{ preset: OrderPreset }> {
  const response = await fetch(`${API_BASE_URL}/api/orders/preset/${noteId}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      `注文プリセットの取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }
  return response.json();
}

/**
 * 注文確認情報の型定義
 */
export interface OrderConfirmation {
  symbol: string;
  side: string;
  price: number;
  quantity: number;
  estimatedCost: number;
  estimatedFee: number;
  total: number;
  warning: string;
}

/**
 * 注文確認情報を取得
 * POST /api/orders/confirmation
 * 
 * 注意: 本システムは自動売買を行いません。参考情報のみを提供します。
 */
export async function fetchOrderConfirmation(params: {
  symbol: string;
  side: string;
  price: number;
  quantity: number;
}): Promise<{ confirmation: OrderConfirmation }> {
  const response = await fetch(`${API_BASE_URL}/api/orders/confirmation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw new Error(
      `注文確認情報の取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }
  return response.json();
}
