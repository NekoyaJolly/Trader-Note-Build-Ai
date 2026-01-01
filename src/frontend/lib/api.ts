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

// ========================================
// ストラテジー API
// ========================================

import type {
  Strategy,
  StrategySummary,
  CreateStrategyRequest,
  UpdateStrategyRequest,
  StrategyStatus,
  StrategyVersion,
  BacktestResult,
} from "@/types/strategy";

/**
 * ストラテジー一覧を取得
 * GET /api/strategies
 */
export async function fetchStrategies(
  status?: StrategyStatus
): Promise<Strategy[]> {
  const url = new URL(`${API_BASE_URL}/api/strategies`);
  
  if (status) {
    url.searchParams.set("status", status);
  }
  
  const response = await fetch(url.toString(), {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `ストラテジー一覧の取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }

  const payload = await response.json();
  return payload.data?.strategies ?? [];
}

/**
 * ストラテジー詳細を取得
 * GET /api/strategies/:id
 */
export async function fetchStrategy(id: string): Promise<Strategy> {
  const response = await fetch(`${API_BASE_URL}/api/strategies/${id}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("ストラテジーが見つかりません");
    }
    throw new Error(
      `ストラテジー詳細の取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * ストラテジーバージョンを取得
 * GET /api/strategies/:id/versions/:versionNumber
 */
export async function fetchStrategyVersion(
  strategyId: string,
  versionNumber: number
): Promise<StrategyVersion> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/versions/${versionNumber}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error("バージョン情報の取得に失敗しました");
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * ストラテジーを作成
 * POST /api/strategies
 */
export async function createStrategy(
  request: CreateStrategyRequest
): Promise<Strategy> {
  const response = await fetch(`${API_BASE_URL}/api/strategies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "ストラテジーの作成に失敗しました");
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * ストラテジーを更新
 * PUT /api/strategies/:id
 */
export async function updateStrategy(
  id: string,
  request: UpdateStrategyRequest
): Promise<Strategy> {
  const response = await fetch(`${API_BASE_URL}/api/strategies/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "ストラテジーの更新に失敗しました");
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * ストラテジーを削除
 * DELETE /api/strategies/:id
 */
export async function deleteStrategy(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/strategies/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "ストラテジーの削除に失敗しました");
  }
}

/**
 * ストラテジーのステータスを変更
 * PUT /api/strategies/:id/status
 */
export async function updateStrategyStatus(
  id: string,
  status: StrategyStatus
): Promise<Strategy> {
  const response = await fetch(`${API_BASE_URL}/api/strategies/${id}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "ステータスの更新に失敗しました");
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * ストラテジーを複製
 * POST /api/strategies/:id/duplicate
 */
export async function duplicateStrategy(id: string): Promise<Strategy> {
  const response = await fetch(`${API_BASE_URL}/api/strategies/${id}/duplicate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "ストラテジーの複製に失敗しました");
  }

  const payload = await response.json();
  return payload.data;
}

// ============================================
// バックテスト API
// ============================================

/** バックテスト実行パラメータ */
export interface BacktestRequestParams {
  startDate: string;
  endDate: string;
  stage1Timeframe: "15m" | "30m" | "1h" | "4h" | "1d";
  enableStage2: boolean;
  initialCapital: number;
  lotSize: number; // 固定ロット数（通貨量）
  leverage: number; // レバレッジ（1〜1000倍）
}

/**
 * ストラテジーのバックテストを実行
 * POST /api/strategies/:id/backtest
 */
export async function runStrategyBacktest(
  strategyId: string,
  params: BacktestRequestParams
): Promise<BacktestResult> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/backtest`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "バックテストの実行に失敗しました");
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * ストラテジーのバックテスト履歴を取得
 * GET /api/strategies/:id/backtest/history
 */
export async function fetchStrategyBacktestHistory(
  strategyId: string,
  limit?: number
): Promise<BacktestHistoryItem[]> {
  const params = new URLSearchParams();
  if (limit) {
    params.set("limit", String(limit));
  }

  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/backtest/history?${params}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error("バックテスト履歴の取得に失敗しました");
  }

  const payload = await response.json();
  return payload.data?.history ?? [];
}

/**
 * ストラテジーのバックテスト結果詳細を取得
 * GET /api/strategies/:id/backtest/:runId
 */
export async function fetchStrategyBacktestResult(
  strategyId: string,
  runId: string
): Promise<BacktestResult> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/backtest/${runId}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("バックテスト結果が見つかりません");
    }
    throw new Error("バックテスト結果の取得に失敗しました");
  }

  const payload = await response.json();
  return payload.data;
}

// 型の再エクスポート（外部から使用するため）
export type { NoteSummary } from "@/types/note";
export type {
  Strategy,
  StrategySummary,
  StrategyVersion,
  StrategyStatus,
  CreateStrategyRequest,
  UpdateStrategyRequest,
  BacktestResult,
  BacktestResultSummary,
  BacktestTradeEvent,
} from "@/types/strategy";

/** バックテスト履歴アイテム */
export interface BacktestHistoryItem {
  id: string;
  executedAt: string;
  startDate: string;
  endDate: string;
  timeframe: string;
  status: string;
  summary?: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
  };
}

// ============================================
// StrategyNote API
// Phase C: 勝ちパターンノート機能
// ============================================

/** ストラテジーノートのステータス */
export type StrategyNoteStatus = 'draft' | 'active' | 'archived';

/** バックテストアウトカム */
export type BacktestOutcome = 'win' | 'loss' | 'timeout';

/** ストラテジーノートサマリー */
export interface StrategyNoteSummary {
  id: string;
  strategyId: string;
  strategyName: string;
  entryTime: string;
  entryPrice: number;
  outcome: BacktestOutcome;
  pnl: number | null;
  status: StrategyNoteStatus;
  tags: string[];
  createdAt: string;
}

/** ストラテジーノート詳細 */
export interface StrategyNoteDetail {
  id: string;
  strategyId: string;
  strategyName: string;
  entryTime: string;
  entryPrice: number;
  conditionSnapshot: object;
  indicatorValues: IndicatorValues;
  outcome: BacktestOutcome;
  pnl: number | null;
  notes: string | null;
  status: StrategyNoteStatus;
  tags: string[];
  featureVector: number[];
  createdAt: string;
  updatedAt: string;
}

/** インジケーター値の型定義 */
export interface IndicatorValues {
  rsi?: {
    value: number;
    direction: 'rising' | 'falling' | 'flat';
    zone: 'overbought' | 'oversold' | 'neutral';
  };
  macd?: {
    macdLine: number;
    signalLine: number;
    histogram: number;
    histogramSign: 'positive' | 'negative';
    histogramSlope: 'increasing' | 'decreasing' | 'flat';
    zeroLinePosition: 'above' | 'below';
    macdSlope: 'up' | 'down' | 'flat';
  };
  bb?: {
    upper: number;
    middle: number;
    lower: number;
    percentB: number;
    bandWidthTrend: 'expanding' | 'contracting' | 'flat';
    zone: 'upperStick' | 'upperApproach' | 'middle' | 'lowerApproach' | 'lowerStick';
  };
  sma?: {
    value: number;
    deviationRate: number;
    slopeDirection: 'up' | 'down' | 'flat';
    trendStrength: number;
    pricePosition: 'above' | 'below';
    period: number;
  };
  ema?: {
    value: number;
    deviationRate: number;
    slopeDirection: 'up' | 'down' | 'flat';
    trendStrength: number;
    emaVsSmaPosition: 'above' | 'below';
    period: number;
  };
}

/** ストラテジーノート統計 */
export interface StrategyNoteStats {
  total: number;
  active: number;
  draft: number;
  archived: number;
  byOutcome: {
    win: number;
    loss: number;
    timeout: number;
  };
}

/** 類似ノート検索結果 */
export interface SimilarNoteResult {
  noteId: string;
  strategyId: string;
  strategyName: string;
  entryTime: string;
  outcome: string;
  pnl: number | null;
  similarity: number;
  similarityDetails: {
    indicator: string;
    score: number;
    weight: number;
    weightedScore: number;
  }[];
}

/** ストラテジーノート一覧取得パラメータ */
export interface ListStrategyNotesParams {
  status?: StrategyNoteStatus;
  outcome?: BacktestOutcome;
  tags?: string[];
  limit?: number;
  offset?: number;
}

/**
 * ストラテジーのノート一覧を取得
 * GET /api/strategies/:id/notes
 */
export async function fetchStrategyNotes(
  strategyId: string,
  params: ListStrategyNotesParams = {}
): Promise<StrategyNoteSummary[]> {
  const queryParams = new URLSearchParams();
  if (params.status) queryParams.set('status', params.status);
  if (params.outcome) queryParams.set('outcome', params.outcome);
  if (params.tags?.length) queryParams.set('tags', params.tags.join(','));
  if (params.limit) queryParams.set('limit', params.limit.toString());
  if (params.offset) queryParams.set('offset', params.offset.toString());

  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/notes?${queryParams}`,
    { cache: 'no-store' }
  );

  if (!response.ok) {
    throw new Error('ノート一覧の取得に失敗しました');
  }

  const payload = await response.json();
  return payload.data?.notes ?? [];
}

/**
 * ストラテジーのノート統計を取得
 * GET /api/strategies/:id/notes/stats
 */
export async function fetchStrategyNoteStats(
  strategyId: string
): Promise<StrategyNoteStats> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/notes/stats`,
    { cache: 'no-store' }
  );

  if (!response.ok) {
    throw new Error('ノート統計の取得に失敗しました');
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * ストラテジーノート詳細を取得
 * GET /api/strategies/:id/notes/:noteId
 */
export async function fetchStrategyNoteDetail(
  strategyId: string,
  noteId: string
): Promise<StrategyNoteDetail> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/notes/${noteId}`,
    { cache: 'no-store' }
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('ノートが見つかりません');
    }
    throw new Error('ノート詳細の取得に失敗しました');
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * ストラテジーノートを更新
 * PUT /api/strategies/:id/notes/:noteId
 */
export async function updateStrategyNoteDetail(
  strategyId: string,
  noteId: string,
  data: {
    status?: StrategyNoteStatus;
    tags?: string[];
    notes?: string;
  }
): Promise<StrategyNoteDetail> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/notes/${noteId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  );

  if (!response.ok) {
    throw new Error('ノートの更新に失敗しました');
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * ストラテジーノートのステータスを変更
 * PUT /api/strategies/:id/notes/:noteId/status
 */
export async function updateStrategyNoteStatus(
  strategyId: string,
  noteId: string,
  status: StrategyNoteStatus
): Promise<StrategyNoteDetail> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/notes/${noteId}/status`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }
  );

  if (!response.ok) {
    throw new Error('ステータスの更新に失敗しました');
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * ストラテジーノートを削除
 * DELETE /api/strategies/:id/notes/:noteId
 */
export async function deleteStrategyNote(
  strategyId: string,
  noteId: string
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/notes/${noteId}`,
    { method: 'DELETE' }
  );

  if (!response.ok) {
    throw new Error('ノートの削除に失敗しました');
  }
}

/**
 * バックテスト結果からノートを一括作成
 * POST /api/strategies/:id/notes/from-backtest/:runId
 */
export async function createNotesFromBacktest(
  strategyId: string,
  runId: string,
  onlyWins: boolean = true
): Promise<{ createdCount: number }> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/notes/from-backtest/${runId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onlyWins }),
    }
  );

  if (!response.ok) {
    throw new Error('ノートの作成に失敗しました');
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * 特定のノートに類似したノートを検索
 * POST /api/strategies/:id/notes/:noteId/similar
 */
export async function searchSimilarNotes(
  strategyId: string,
  noteId: string,
  threshold: number = 0.7,
  limit: number = 10
): Promise<SimilarNoteResult[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/notes/${noteId}/similar`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threshold, limit }),
    }
  );

  if (!response.ok) {
    throw new Error('類似ノート検索に失敗しました');
  }

  const payload = await response.json();
  return payload.data?.results ?? [];
}

/**
 * インジケーター値から類似ノートを検索
 * POST /api/strategies/notes/search-similar
 */
export async function searchSimilarByIndicators(
  indicatorValues: IndicatorValues,
  options: {
    strategyId?: string;
    status?: StrategyNoteStatus;
    threshold?: number;
    limit?: number;
  } = {}
): Promise<SimilarNoteResult[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/notes/search-similar`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indicatorValues,
        ...options,
      }),
    }
  );

  if (!response.ok) {
    throw new Error('類似検索に失敗しました');
  }

  const payload = await response.json();
  return payload.data?.results ?? [];
}

// ============================================
// Phase D: アラートAPI
// ============================================

/** アラート通知チャネル */
export type AlertChannel = 'in_app' | 'web_push';

/** アラートステータス */
export type AlertStatus = 'enabled' | 'disabled' | 'paused';

/** アラート設定 */
export interface StrategyAlert {
  id: string;
  strategyId: string;
  enabled: boolean;
  status: AlertStatus;
  cooldownMinutes: number;
  channels: AlertChannel[];
  minMatchScore: number;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** アラート発火ログ */
export interface AlertLog {
  id: string;
  alertId: string;
  matchScore: number;
  indicatorValues: Record<string, unknown>;
  channel: AlertChannel;
  success: boolean;
  errorMessage: string | null;
  triggeredAt: string;
}

/**
 * ストラテジーのアラート設定を取得
 * GET /api/strategies/:id/alerts
 */
export async function fetchStrategyAlert(strategyId: string): Promise<StrategyAlert | null> {
  const response = await fetch(`${API_BASE_URL}/api/strategies/${strategyId}/alerts`);
  
  if (!response.ok) {
    throw new Error('アラート設定の取得に失敗しました');
  }

  const payload = await response.json();
  return payload.data?.alert ?? null;
}

/**
 * ストラテジーのアラート設定を作成
 * POST /api/strategies/:id/alerts
 */
export async function createStrategyAlert(
  strategyId: string,
  settings: {
    enabled?: boolean;
    cooldownMinutes?: number;
    channels?: AlertChannel[];
    minMatchScore?: number;
  }
): Promise<StrategyAlert> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/alerts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }
  );

  if (!response.ok) {
    throw new Error('アラート設定の作成に失敗しました');
  }

  const payload = await response.json();
  return payload.data.alert;
}

/**
 * ストラテジーのアラート設定を更新
 * PUT /api/strategies/:id/alerts
 */
export async function updateStrategyAlert(
  strategyId: string,
  settings: {
    enabled?: boolean;
    cooldownMinutes?: number;
    channels?: AlertChannel[];
    minMatchScore?: number;
  }
): Promise<StrategyAlert> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/alerts`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }
  );

  if (!response.ok) {
    throw new Error('アラート設定の更新に失敗しました');
  }

  const payload = await response.json();
  return payload.data.alert;
}

/**
 * ストラテジーのアラート設定を削除
 * DELETE /api/strategies/:id/alerts
 */
export async function deleteStrategyAlert(strategyId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/alerts`,
    { method: 'DELETE' }
  );

  if (!response.ok) {
    throw new Error('アラート設定の削除に失敗しました');
  }
}

/**
 * アラート発火履歴を取得
 * GET /api/strategies/:id/alerts/logs
 */
export async function fetchAlertLogs(
  strategyId: string,
  limit: number = 50
): Promise<AlertLog[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/alerts/logs?limit=${limit}`
  );

  if (!response.ok) {
    throw new Error('アラート履歴の取得に失敗しました');
  }

  const payload = await response.json();
  return payload.data?.logs ?? [];
}

/**
 * アラートを一時停止
 * PUT /api/strategies/:id/alerts/pause
 */
export async function pauseAlert(strategyId: string): Promise<StrategyAlert> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/alerts/pause`,
    { method: 'PUT' }
  );

  if (!response.ok) {
    throw new Error('アラートの一時停止に失敗しました');
  }

  const payload = await response.json();
  return payload.data.alert;
}

/**
 * アラートを再開
 * PUT /api/strategies/:id/alerts/resume
 */
export async function resumeAlert(strategyId: string): Promise<StrategyAlert> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/alerts/resume`,
    { method: 'PUT' }
  );

  if (!response.ok) {
    throw new Error('アラートの再開に失敗しました');
  }

  const payload = await response.json();
  return payload.data.alert;
}

// ============================================
// Phase D: ウォークフォワードAPI
// ============================================

/** ウォークフォワード分割結果 */
export interface WalkForwardSplit {
  splitNumber: number;
  inSamplePeriod: { start: string; end: string };
  outOfSamplePeriod: { start: string; end: string };
  inSample: {
    winRate: number;
    tradeCount: number;
    profitFactor: number | null;
  };
  outOfSample: {
    winRate: number;
    tradeCount: number;
    profitFactor: number | null;
  };
  winRateDiff: number;
}

/** ウォークフォワードテスト結果 */
export interface WalkForwardResult {
  id: string;
  strategyId: string;
  type: 'fixed_split' | 'rolling_window';
  splitCount: number;
  splits: WalkForwardSplit[];
  overfitScore: number;
  overfitWarning: boolean;
  summary: {
    avgInSampleWinRate: number;
    avgOutOfSampleWinRate: number;
    avgWinRateDiff: number;
    totalInSampleTrades: number;
    totalOutOfSampleTrades: number;
  };
  status: 'completed' | 'failed';
  errorMessage?: string;
}

/**
 * ウォークフォワードテストを実行
 * POST /api/strategies/:id/walkforward
 */
export async function runWalkForwardTest(
  strategyId: string,
  params: {
    startDate: string;
    endDate: string;
    splitCount?: number;
    inSampleDays?: number;
    outOfSampleDays?: number;
    timeframe?: string;
    initialCapital?: number;
    positionSize?: number;
  }
): Promise<WalkForwardResult> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/walkforward`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }
  );

  if (!response.ok) {
    throw new Error('ウォークフォワードテストの実行に失敗しました');
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * ウォークフォワードテスト履歴を取得
 * GET /api/strategies/:id/walkforward/history
 */
export async function fetchWalkForwardHistory(
  strategyId: string,
  limit: number = 10
): Promise<WalkForwardResult[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/walkforward/history?limit=${limit}`
  );

  if (!response.ok) {
    throw new Error('ウォークフォワード履歴の取得に失敗しました');
  }

  const payload = await response.json();
  return payload.data?.history ?? [];
}

/**
 * ウォークフォワードテスト結果詳細を取得
 * GET /api/strategies/:id/walkforward/:runId
 */
export async function fetchWalkForwardResult(
  strategyId: string,
  runId: string
): Promise<WalkForwardResult | null> {
  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/walkforward/${runId}`
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error('ウォークフォワード結果の取得に失敗しました');
  }

  const payload = await response.json();
  return payload.data;
}

// ============================================
// Phase D: バージョン比較API
// ============================================

/** バージョン比較データ */
export interface VersionComparisonData {
  versionNumber: number;
  versionId: string;
  changeNote: string | null;
  createdAt: string;
  backtest: {
    runId: string;
    executedAt: string;
    startDate: string;
    endDate: string;
    timeframe: string;
    metrics: {
      setupCount: number;
      winCount: number;
      lossCount: number;
      winRate: number;
      profitFactor: number | null;
      totalProfit: number;
      totalLoss: number;
      averagePnL: number;
      expectancy: number;
      maxDrawdown: number | null;
    };
  } | null;
}

/** バージョン比較結果 */
export interface VersionComparisonResult {
  strategyId: string;
  strategyName: string;
  versions: VersionComparisonData[];
  summary: {
    bestWinRate: { versionNumber: number; value: number };
    bestProfitFactor: { versionNumber: number; value: number };
    bestExpectancy: { versionNumber: number; value: number };
    lowestDrawdown: { versionNumber: number; value: number };
  } | null;
}

/**
 * バージョン比較データを取得
 * GET /api/strategies/:id/versions/compare
 */
export async function fetchVersionComparison(
  strategyId: string,
  versionNumbers?: number[]
): Promise<VersionComparisonResult> {
  const params = versionNumbers?.length
    ? `?versionNumbers=${versionNumbers.join(',')}`
    : '';

  const response = await fetch(
    `${API_BASE_URL}/api/strategies/${strategyId}/versions/compare${params}`
  );

  if (!response.ok) {
    throw new Error('バージョン比較データの取得に失敗しました');
  }

  const payload = await response.json();
  return payload.data;
}
