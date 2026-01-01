/**
 * 通知 API クライアント
 * Phase4 で実装された API エンドポイントとの連携
 */

import type {
  NotificationListItem,
  NotificationDetail,
} from "@/types/notification";
import type { NoteListItem, NoteDetail, NoteUpdatePayload, NoteStatusCounts, NoteStatus, NoteSummary } from "@/types/note";

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
 * ノート一覧取得のパラメータ型
 */
export interface FetchNotesParams {
  status?: NoteStatus;
  limit?: number;
}

/**
 * ノート一覧を取得
 * GET /api/trades/notes
 * @param params - フィルタ条件（NoteStatus または FetchNotesParams オブジェクト）
 */
export async function fetchNotes(params?: NoteStatus | FetchNotesParams): Promise<{ notes: NoteSummary[] }> {
  const url = new URL(`${API_BASE_URL}/api/trades/notes`);
  
  // 後方互換性: string が渡された場合は status として扱う
  const normalizedParams: FetchNotesParams = typeof params === 'string'
    ? { status: params }
    : params || {};
  
  if (normalizedParams.status) {
    url.searchParams.set("status", normalizedParams.status);
  }
  if (normalizedParams.limit) {
    url.searchParams.set("limit", String(normalizedParams.limit));
  }
  
  const response = await fetch(url.toString(), {
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
  const normalized: NoteSummary[] = notes.map((n: Record<string, unknown>) => ({
    id: String(n.id),
    symbol: String(n.symbol ?? ""),
    side: n.side === "sell" ? "sell" : "buy",
    entryPrice: Number(n.entryPrice ?? 0),
    timestamp: String(n.timestamp ?? n.createdAt ?? new Date().toISOString()),
    createdAt: String(n.createdAt ?? new Date().toISOString()),
    aiSummary: (n.aiSummary as string | null) ?? null,
    status: (n.status as NoteStatus) ?? "draft",
  }));

  return { notes: normalized };
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
 * ノート承認
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
 * ノート非承認（reject）
 * POST /api/trades/notes/:id/reject
 */
export async function rejectNote(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/trades/notes/${id}/reject`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `ノート非承認に失敗しました: ${response.status} ${response.statusText}`
    );
  }
}

/**
 * ノートを下書きに戻す
 * POST /api/trades/notes/:id/revert-to-draft
 */
export async function revertNoteToDraft(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/trades/notes/${id}/revert-to-draft`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `ノートの状態変更に失敗しました: ${response.status} ${response.statusText}`
    );
  }
}

/**
 * ノート内容を更新
 * PUT /api/trades/notes/:id
 */
export async function updateNote(id: string, payload: NoteUpdatePayload): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/trades/notes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(
      `ノート更新に失敗しました: ${response.status} ${response.statusText}`
    );
  }
}

/**
 * ノートステータス集計を取得
 * GET /api/trades/notes/status-counts
 */
export async function fetchNoteStatusCounts(): Promise<NoteStatusCounts> {
  const response = await fetch(`${API_BASE_URL}/api/trades/notes/status-counts`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      `ステータス集計の取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }
  return response.json();
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

// ============================================
// インジケーター設定 API
// ============================================

import type {
  UserIndicatorSettings,
  IndicatorMetadata,
  IndicatorConfig,
  SaveIndicatorConfigRequest,
  IndicatorId,
} from "@/types/indicator";

/**
 * インジケーター設定を取得
 * GET /api/indicators/settings
 */
export async function fetchIndicatorSettings(): Promise<UserIndicatorSettings> {
  const response = await fetch(`${API_BASE_URL}/api/indicators/settings`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      `インジケーター設定の取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }
  const payload = await response.json();
  return payload.data;
}

/**
 * インジケーターメタデータを取得
 * GET /api/indicators/metadata
 */
export async function fetchIndicatorMetadata(category?: string): Promise<{
  indicators: IndicatorMetadata[];
  categories: string[];
}> {
  const url = category
    ? `${API_BASE_URL}/api/indicators/metadata?category=${category}`
    : `${API_BASE_URL}/api/indicators/metadata`;
  
  const response = await fetch(url, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      `メタデータの取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }
  const payload = await response.json();
  return payload.data;
}

/**
 * インジケーター設定を保存
 * POST /api/indicators/settings
 */
export async function saveIndicatorConfig(
  request: SaveIndicatorConfigRequest
): Promise<IndicatorConfig> {
  const response = await fetch(`${API_BASE_URL}/api/indicators/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "インジケーター設定の保存に失敗しました");
  }
  const payload = await response.json();
  return payload.data;
}

/**
 * インジケーター設定を削除
 * DELETE /api/indicators/settings/:indicatorId
 */
export async function deleteIndicatorConfig(indicatorId: IndicatorId): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/indicators/settings/${indicatorId}`,
    {
      method: "DELETE",
    }
  );
  if (!response.ok) {
    throw new Error("インジケーター設定の削除に失敗しました");
  }
}

/**
 * インジケーター設定をリセット
 * POST /api/indicators/settings/reset
 */
export async function resetIndicatorSettings(): Promise<UserIndicatorSettings> {
  const response = await fetch(`${API_BASE_URL}/api/indicators/settings/reset`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("インジケーター設定のリセットに失敗しました");
  }
  const payload = await response.json();
  return payload.data;
}

/**
 * セットアップ状態を取得
 * GET /api/indicators/settings/setup-status
 */
export async function fetchSetupStatus(): Promise<{ hasCompletedSetup: boolean }> {
  const response = await fetch(
    `${API_BASE_URL}/api/indicators/settings/setup-status`,
    {
      cache: "no-store",
    }
  );
  if (!response.ok) {
    throw new Error("セットアップ状態の取得に失敗しました");
  }
  const payload = await response.json();
  return payload.data;
}

// ========================================
// バックテスト API
// ========================================

/**
 * バックテスト実行パラメータ
 */
export interface BacktestExecuteParams {
  /** ノートID */
  noteId: string;
  /** 開始日（ISO形式） */
  startDate: string;
  /** 終了日（ISO形式） */
  endDate: string;
  /** 時間足（例: '1h', '4h', '1d'） */
  timeframe: string;
  /** 一致スコア閾値（0-100） */
  matchThreshold: number;
  /** 利確幅（%） */
  takeProfit?: number;
  /** 損切幅（%） */
  stopLoss?: number;
  /** 最大保有時間（分） */
  maxHoldingMinutes?: number;
  /** 取引コスト（%） */
  tradingCost?: number;
}

/**
 * バックテスト結果サマリー
 */
export interface BacktestSummary {
  runId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  setupCount: number;
  winCount: number;
  lossCount: number;
  timeoutCount: number;
  winRate: number;
  profitFactor: number | null;
  totalProfit: number;
  totalLoss: number;
  averagePnL: number;
  expectancy: number;
  maxDrawdown: number | null;
  events: BacktestEventSummary[];
}

/**
 * バックテストイベントサマリー
 */
export interface BacktestEventSummary {
  entryTime: string;
  entryPrice: number;
  matchScore: number;
  exitTime: string | null;
  exitPrice: number | null;
  outcome: 'win' | 'loss' | 'timeout';
  pnl: number | null;
}

/**
 * バックテストを実行
 * POST /api/backtest/execute
 */
export async function executeBacktest(
  params: BacktestExecuteParams
): Promise<{ runId: string }> {
  const response = await fetch(`${API_BASE_URL}/api/backtest/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "バックテストの実行に失敗しました");
  }
  return response.json();
}

/**
 * バックテスト結果を取得
 * GET /api/backtest/:runId
 */
export async function fetchBacktestResult(
  runId: string
): Promise<BacktestSummary | null> {
  const response = await fetch(`${API_BASE_URL}/api/backtest/${runId}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error("バックテスト結果の取得に失敗しました");
  }
  return response.json();
}

/**
 * ノートのバックテスト履歴を取得
 * GET /api/backtest/history/:noteId
 */
export async function fetchBacktestHistory(
  noteId: string
): Promise<BacktestSummary[]> {
  const response = await fetch(`${API_BASE_URL}/api/backtest/history/${noteId}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("バックテスト履歴の取得に失敗しました");
  }
  const payload = await response.json();
  return payload.runs ?? [];
}

// 型の再エクスポート（外部から使用するため）
export type { NoteSummary } from "@/types/note";
