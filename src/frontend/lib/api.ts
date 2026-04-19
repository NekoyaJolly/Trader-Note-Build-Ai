/**
 * 通知 API クライアント
 * Phase4 で実装された API エンドポイントとの連携
 */

import type {
  NotificationListItem,
  NotificationDetail,
} from "@/types/notification";
import type { NoteDetail, NoteUpdatePayload, NoteStatusCounts, NoteStatus, NoteSummary } from "@/types/note";
import { getPublicApiBaseUrl } from "./publicApiBaseUrl";

/**
 * バックエンド API のベース URL は getPublicApiBaseUrl() で解決する。
 * 環境変数未設定でも localhost 上では http://localhost:3100 を既定にする。
 */

/**
 * 類似度閾値の定数（12次元統一ベクトル + コサイン類似度）
 * バックエンドの SIMILARITY_THRESHOLDS と同期
 */
export const SIMILARITY_THRESHOLDS = {
  /** 強マッチ: 高い信頼度でパターン一致 */
  STRONG: 0.90,
  /** 中マッチ: 参考レベルの一致 */
  MEDIUM: 0.80,
  /** 弱マッチ: 注意が必要な一致 */
  WEAK: 0.70,
} as const;

/**
 * 12次元特徴量ベクトルの次元数
 * バックエンドの VECTOR_DIMENSION と同期
 */
export const VECTOR_DIMENSION = 12;

/**
 * 通知一覧を取得
 * GET /api/notifications
 */
export async function fetchNotifications(): Promise<NotificationListItem[]> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/notifications`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/notifications/${id}`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/notifications/${id}/read`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/notifications/read-all`, {
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error(
      `全通知の既読化に失敗しました: ${response.status} ${response.statusText}`
    );
  }
}

/**
 * 未読通知数を取得
 * GET /api/notifications/unread-count
 */
export async function fetchUnreadNotificationCount(): Promise<number> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/notifications/unread-count`, {
    cache: "no-store",
  });

  if (!response.ok) {
    // エラー時は0を返す（UIが壊れないように）
    console.error(`未読数取得エラー: ${response.status} ${response.statusText}`);
    return 0;
  }

  const payload = await response.json();
  return payload?.data?.unreadCount ?? 0;
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
  const url = new URL(`${getPublicApiBaseUrl()}/api/trades/notes`);

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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/trades/notes/${id}`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/trades/import/upload-text`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/trades/notes/${id}/approve`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/trades/notes/${id}/reject`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/trades/notes/${id}/revert-to-draft`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/trades/notes/${id}`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/trades/notes/status-counts`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/health`, { cache: "no-store" });
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/daily-status`, { cache: "no-store" });
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/orders/preset/${noteId}`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/orders/confirmation`, {
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
  ParamConstraints,
} from "@/types/indicator";

/**
 * インジケーター設定を取得
 * GET /api/indicators/settings
 */
export async function fetchIndicatorSettings(): Promise<UserIndicatorSettings> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/indicators/settings`, {
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
 * 
 * 注意: APIが利用できない場合は、フロントエンドの定義を使用
 */
export async function fetchIndicatorMetadata(category?: string): Promise<{
  indicators: IndicatorMetadata[];
  categories: string[];
}> {
  const url = category
    ? `${getPublicApiBaseUrl()}/api/indicators/metadata?category=${category}`
    : `${getPublicApiBaseUrl()}/api/indicators/metadata`;

  try {
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
  } catch (error) {
    // APIが利用できない場合は、フロントエンドの定義を使用
    console.warn('[fetchIndicatorMetadata] APIエラー、フロントエンド定義を使用:', error);
    const { INDICATOR_DEFINITIONS, getAllCategories } = await import('@/lib/indicatorDefinitions');

    let indicators = INDICATOR_DEFINITIONS.map(def => ({
      id: def.id,
      name: def.name,
      category: def.category,
      description: def.description || '',
      defaultParams: def.defaultParams,
      paramDescriptions: def.paramDescriptions,
      paramConstraints: {} as ParamConstraints, // フロントエンド定義には制約情報がないため空オブジェクト
    }));

    // カテゴリでフィルタリング
    if (category) {
      indicators = indicators.filter(ind => ind.category === category);
    }

    return {
      indicators: indicators.map(ind => ({
        ...ind,
        displayName: ind.name, // IndicatorDefinitionのnameをdisplayNameとしてマッピング
      })) as IndicatorMetadata[],
      categories: getAllCategories(),
    };
  }
}

/**
 * インジケーター設定を保存
 * POST /api/indicators/settings
 */
export async function saveIndicatorConfig(
  request: SaveIndicatorConfigRequest
): Promise<IndicatorConfig> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/indicators/settings`, {
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
    `${getPublicApiBaseUrl()}/api/indicators/settings/${indicatorId}`,
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/indicators/settings/reset`, {
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
    `${getPublicApiBaseUrl()}/api/indicators/settings/setup-status`,
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
// ユーザー設定 API
// ========================================

/**
 * 時間足タイプ
 */
export type SettingsTimeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

/**
 * ユーザー設定の型
 */
export interface UserSettings {
  notification: {
    enabled: boolean;
    scoreThreshold: number;
    maxPerDay: number;
  };
  timeframes: {
    primary: SettingsTimeframe;
    secondary: SettingsTimeframe[];
  };
  display: {
    darkMode: boolean;
    compactView: boolean;
    showAiSuggestions: boolean;
  };
  updatedAt: string;
}

/**
 * ユーザー設定を取得
 * GET /api/settings
 */
export async function fetchUserSettings(): Promise<UserSettings> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/settings`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("設定の取得に失敗しました");
  }
  const payload = await response.json();
  return payload.data;
}

/**
 * ユーザー設定を更新
 * PUT /api/settings
 */
export async function saveUserSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "設定の保存に失敗しました");
  }
  const payload = await response.json();
  return payload.data;
}

/**
 * ユーザー設定をリセット
 * POST /api/settings/reset
 */
export async function resetUserSettings(): Promise<UserSettings> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/settings/reset`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("設定のリセットに失敗しました");
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/backtest/execute`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/backtest/${runId}`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/backtest/history/${noteId}`, {
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
  const url = new URL(`${getPublicApiBaseUrl()}/api/strategies`);

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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/strategies/${id}`, {
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/versions/${versionNumber}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error("バージョン情報の取得に失敗しました");
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * ストラテジーを指定バージョンへロールバック
 * PUT /api/strategies/:id/rollback/:versionNumber
 */
export async function rollbackStrategyVersion(
  strategyId: string,
  versionNumber: number,
  changeNote?: string
): Promise<Strategy> {
  const response = await fetch(
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/rollback/${versionNumber}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changeNote }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'ストラテジーのロールバックに失敗しました');
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/strategies`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/strategies/${id}`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/strategies/${id}`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/strategies/${id}/status`, {
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/strategies/${id}/duplicate`, {
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
  stage1Timeframe: "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";
  enableStage2: boolean;
  initialCapital: number;
  lotSize: number;
  /** 固定ロット入力の単位（デフォルト: 'currency'） */
  lotSizeUnit?: 'currency' | 'lots';
  leverage: number;
  symbol?: string;
  /** ロットモード（デフォルト: 'fixed'） */
  lotMode?: 'fixed' | 'variable';
  /** リスク割合 % (lotMode='variable' 時) */
  riskPercent?: number;
  /** リスク固定金額 (lotMode='variable' 時) */
  riskAmount?: number;
  /** 同時ポジション上限 (1〜15、デフォルト: 1) */
  maxPositions?: number;
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/backtest`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({})) as { error?: string; details?: string; issues?: Array<{ path: string; message: string }>; validationErrors?: Array<{ location: string; details: string }> };
    const details = err.issues?.map((i) => (i.path ? `${i.path}: ` : '') + i.message).join('; ')
      || err.validationErrors?.map((e) => e.details).join('; ')
      || err.details;
    const msg = err.error || "バックテストの実行に失敗しました";
    throw new Error(details ? `${msg}: ${details}` : msg);
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/backtest/history?${params}`,
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/backtest/${runId}`,
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/notes?${queryParams}`,
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/notes/stats`,
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/notes/${noteId}`,
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/notes/${noteId}`,
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/notes/${noteId}/status`,
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/notes/${noteId}`,
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/notes/from-backtest/${runId}`,
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
  const response = await fetch(`${getPublicApiBaseUrl()}/api/strategies/${strategyId}/alerts`);

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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/alerts`,
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/alerts`,
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/alerts`,
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/alerts/logs?limit=${limit}`
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/alerts/pause`,
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/alerts/resume`,
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
  // フロントエンドの positionSize をバックエンドの lotSize にマッピング
  const requestBody = {
    startDate: params.startDate,
    endDate: params.endDate,
    splitCount: params.splitCount,
    inSampleDays: params.inSampleDays,
    outOfSampleDays: params.outOfSampleDays,
    timeframe: params.timeframe,
    initialCapital: params.initialCapital,
    lotSize: params.positionSize, // positionSize → lotSize
  };

  const response = await fetch(
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/walkforward`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/walkforward/history?limit=${limit}`
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/walkforward/${runId}`
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
// Phase 15: モンテカルロシミュレーションAPI
// ============================================

/** モンテカルロシミュレーションパラメータ */
export interface MonteCarloParams {
  iterations: 100 | 500 | 1000;
  startDate: string;
  endDate: string;
  timeframe?: string;
  takeProfit?: number;
  stopLoss?: number;
  maxHoldingMinutes?: number;
  initialCapital?: number;
  lotSize?: number;
  entryProbability?: number;
  /** 比較対象のバックテストRunID（指定されない場合は最新のバックテスト結果を使用） */
  backtestRunId?: string;
}

/** ヒストグラムビン */
export interface HistogramBin {
  min: number;
  max: number;
  count: number;
  percentage: number;
}

/** 分布統計 */
export interface DistributionStats {
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  percentiles: {
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
  histogram: HistogramBin[];
}

/** モンテカルロ統計 */
export interface MonteCarloStatistics {
  winRate: DistributionStats;
  profitFactor: DistributionStats;
  maxDrawdownRate: DistributionStats;
  netProfitRate: DistributionStats;
}

/** 戦略比較結果 */
export interface StrategyComparison {
  winRatePercentile: number;
  profitFactorPercentile: number;
  maxDrawdownPercentile: number;
  netProfitRatePercentile: number;
  overallAssessment: 'excellent' | 'good' | 'average' | 'poor' | 'very_poor';
  comment: string;
}

/** 個別シミュレーション結果 */
export interface SimulationResult {
  id: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownRate: number;
  netProfitRate: number;
  totalTrades: number;
}

/** モンテカルロ結果 */
export interface MonteCarloResult {
  iterations: number;
  simulations: SimulationResult[];
  statistics: MonteCarloStatistics;
  comparison?: StrategyComparison;
}

/** モンテカルロ履歴エントリ */
export interface MonteCarloHistoryEntry {
  id: string;
  iterations: number;
  timeframe: string;
  expectedWinRate: number;
  expectedProfitFactor: number | null;
  simulatedMeanWinRate: number;
  simulatedMeanProfitFactor: number | null;
  percentiles: {
    winRate: number;
    profitFactor: number | null;
    maxDrawdown: number | null;
    totalProfit: number | null;
  };
  createdAt: string;
}

/**
 * モンテカルロシミュレーションを実行
 * POST /api/strategies/:id/montecarlo
 */
export async function runMonteCarloSimulation(
  strategyId: string,
  params: MonteCarloParams
): Promise<MonteCarloResult> {
  const response = await fetch(
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/montecarlo`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'モンテカルロシミュレーションに失敗しました');
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * モンテカルロシミュレーション履歴を取得
 * GET /api/strategies/:id/montecarlo/history
 */
export async function fetchMonteCarloHistory(
  strategyId: string,
  limit: number = 10
): Promise<MonteCarloHistoryEntry[]> {
  const response = await fetch(
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/montecarlo/history?limit=${limit}`,
    { cache: 'no-store' }
  );

  if (!response.ok) {
    throw new Error('モンテカルロ履歴の取得に失敗しました');
  }

  const payload = await response.json();
  return payload.data?.history ?? [];
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
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/versions/compare${params}`
  );

  if (!response.ok) {
    throw new Error('バージョン比較データの取得に失敗しました');
  }

  const payload = await response.json();
  return payload.data;
}

// ============================================
// フィルター分析 API
// ============================================

/** 分析対象インジケーター */
export type AnalysisIndicator =
  | 'SMA_20'
  | 'SMA_50'
  | 'SMA_200'
  | 'EMA_20'
  | 'EMA_50'
  | 'RSI_14'
  | 'MACD_HIST'
  | 'BB_UPPER'
  | 'BB_LOWER'
  | 'BB_POSITION';

/** インジケーター分析結果 */
export interface IndicatorAnalysis {
  indicator: AnalysisIndicator;
  displayName: string;
  winAverage: number;
  loseAverage: number;
  difference: number;
  significanceScore: number;
  suggestedCondition: string;
  estimatedImprovement: number;
}

/** フィルター提案 */
export interface FilterSuggestion {
  filters: AnalysisIndicator[];
  displayName: string;
  estimatedWinRate: number;
  estimatedPF: number;
  estimatedTradeCount: number;
}

/** フィルター分析結果 */
export interface FilterAnalysisResult {
  totalTrades: number;
  winTrades: number;
  loseTrades: number;
  indicators: IndicatorAnalysis[];
  recommendedFilters: FilterSuggestion[];
}

/** フィルター条件 */
export interface FilterCondition {
  indicator: AnalysisIndicator;
  operator: '<' | '<=' | '>' | '>=' | '=';
  value: number;
}

/** フィルター検証結果 */
export interface FilterVerifyResult {
  before: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    netProfit: number;
  };
  after: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    netProfit: number;
    filteredOutTrades: number;
  };
  improvement: {
    winRateChange: number;
    pfChange: number;
    tradeReduction: number;
  };
}

/**
 * フィルター分析を取得
 * GET /api/strategies/:id/backtest/:runId/filter-analysis
 */
export async function fetchFilterAnalysis(
  strategyId: string,
  runId: string
): Promise<FilterAnalysisResult> {
  const response = await fetch(
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/backtest/${runId}/filter-analysis`
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'フィルター分析の取得に失敗しました');
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * フィルター適用効果を検証
 * POST /api/strategies/:id/backtest/:runId/filter-verify
 */
export async function verifyFilters(
  strategyId: string,
  runId: string,
  filters: FilterCondition[]
): Promise<FilterVerifyResult> {
  const response = await fetch(
    `${getPublicApiBaseUrl()}/api/strategies/${strategyId}/backtest/${runId}/filter-verify`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'フィルター検証に失敗しました');
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * 利用可能なフィルターインジケーター一覧
 * GET /api/strategies/filters/indicators
 */
export async function fetchFilterIndicators(): Promise<{
  id: AnalysisIndicator;
  name: string;
  description: string;
}[]> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/strategies/filters/indicators`);

  if (!response.ok) {
    throw new Error('フィルターインジケーター一覧の取得に失敗しました');
  }

  const payload = await response.json();
  return payload.data;
}

// ============================================
// フェーズ9: ノートパフォーマンス API
// ============================================

/**
 * 時間帯別パフォーマンス
 */
export interface HourlyPerformance {
  hour: number;
  triggerRate: number;
  avgSimilarity: number;
  evaluationCount: number;
}

/**
 * 相場状況
 */
export type MarketCondition = 'trending_up' | 'trending_down' | 'ranging' | 'volatile';

/**
 * 相場状況別パフォーマンス
 */
export interface ConditionPerformance {
  condition: MarketCondition;
  triggerRate: number;
  avgSimilarity: number;
  evaluationCount: number;
}

/**
 * 弱いパターン
 */
export interface WeakPattern {
  description: string;
  occurrences: number;
  avgSimilarity: number;
  details?: Record<string, unknown>;
}

/**
 * ノートパフォーマンスレポート
 */
export interface NotePerformanceReport {
  noteId: string;
  symbol: string;
  totalEvaluations: number;
  triggeredCount: number;
  triggerRate: number;
  avgSimilarity: number;
  maxSimilarity: number;
  minSimilarity: number;
  performanceByHour: HourlyPerformance[];
  performanceByMarketCondition: ConditionPerformance[];
  weakPatterns: WeakPattern[];
  firstEvaluatedAt: string | null;
  lastEvaluatedAt: string | null;
  generatedAt: string;
}

/**
 * ノートランキングエントリ
 */
export interface NoteRankingEntry {
  noteId: string;
  symbol: string;
  triggerRate: number;
  totalEvaluations: number;
  avgSimilarity: number;
  overallScore: number;
  rank: number;
}

/**
 * ノートのパフォーマンスレポートを取得
 * GET /api/trades/notes/:id/performance
 * 
 * @param noteId - ノート ID
 * @param options - 集計オプション
 */
export async function fetchNotePerformance(
  noteId: string,
  options: {
    from?: Date;
    to?: Date;
    timeframe?: string;
    weakThreshold?: number;
  } = {}
): Promise<NotePerformanceReport | null> {
  const params = new URLSearchParams();

  if (options.from) {
    params.set('from', options.from.toISOString());
  }
  if (options.to) {
    params.set('to', options.to.toISOString());
  }
  if (options.timeframe) {
    params.set('timeframe', options.timeframe);
  }
  if (options.weakThreshold !== undefined) {
    params.set('weakThreshold', options.weakThreshold.toString());
  }

  const url = `${getPublicApiBaseUrl()}/api/trades/notes/${noteId}/performance${params.toString() ? '?' + params.toString() : ''}`;
  const response = await fetch(url, { cache: 'no-store' });

  if (response.status === 404) {
    // 評価ログがない場合
    return null;
  }

  if (!response.ok) {
    throw new Error(`パフォーマンスレポートの取得に失敗しました: ${response.status}`);
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * ノートランキングを取得
 * GET /api/trades/notes/performance/ranking
 * 
 * @param options - 取得オプション
 */
export async function fetchNoteRanking(options: {
  limit?: number;
  from?: Date;
  to?: Date;
  timeframe?: string;
} = {}): Promise<NoteRankingEntry[]> {
  const params = new URLSearchParams();

  if (options.limit) {
    params.set('limit', options.limit.toString());
  }
  if (options.from) {
    params.set('from', options.from.toISOString());
  }
  if (options.to) {
    params.set('to', options.to.toISOString());
  }
  if (options.timeframe) {
    params.set('timeframe', options.timeframe);
  }

  const url = `${getPublicApiBaseUrl()}/api/trades/notes/performance/ranking${params.toString() ? '?' + params.toString() : ''}`;
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`ノートランキングの取得に失敗しました: ${response.status}`);
  }

  const payload = await response.json();
  return payload.data;
}

// ============================================
// データカバレッジチェック API
// ============================================

/**
 * データカバレッジチェック結果
 */
export interface CoverageCheckResult {
  hasEnoughData: boolean;
  coverageRatio: number;
  missingBars: number;
  expectedBars: number;
  actualBars: number;
}

/**
 * バックテスト実行前にデータカバレッジをチェック
 * POST /api/backtest/check-coverage
 * 
 * @param symbol - シンボル（例: "USD/JPY"）
 * @param timeframe - 時間足（例: "1h"）
 * @param startDate - 開始日時
 * @param endDate - 終了日時
 * @returns カバレッジチェック結果
 */
export async function checkBacktestDataCoverage(
  symbol: string,
  timeframe: string,
  startDate: string,
  endDate: string
): Promise<CoverageCheckResult> {
  const response = await fetch(
    `${getPublicApiBaseUrl()}/api/backtest/check-coverage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        timeframe,
        startDate,
        endDate,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({})) as { error?: string; details?: string; issues?: Array<{ path: string; message: string }> };
    const details = err.issues?.map((i) => (i.path ? `${i.path}: ` : '') + i.message).join('; ') || err.details;
    const msg = err.error || "カバレッジチェックに失敗しました";
    throw new Error(details ? `${msg}: ${details}` : msg);
  }

  const payload = await response.json();
  return payload.data;
}

/**
 * 利用可能なシンボル一覧を取得
 * GET /api/strategies/symbols
 */
export async function fetchAvailableSymbols(): Promise<{ symbolName: string; symbolId: number }[]> {
  try {
    const response = await fetch(`${getPublicApiBaseUrl()}/api/strategies/symbols`, {
      cache: "no-store",
    });

    if (!response.ok) {
      console.warn("[fetchAvailableSymbols] API Error:", response.status);
      return [];
    }

    const payload = await response.json();
    return payload.data || [];
  } catch (error) {
    console.warn("[fetchAvailableSymbols] Failed:", error);
    return [];
  }
}

/**
 * OHLCVデータ取得・キャッシュ結果
 */
export interface FetchOhlcvResult {
  success: boolean;
  cachedCount: number;
  details?: {
    symbol: string;
    timeframe: string;
    startDate: string;
    endDate: string;
    fetchedCount: number;
  };
  error?: string;
}

/** データフェッチ進捗 */
export interface DataFetchProgress {
  status: 'running' | 'completed' | 'error';
  progress: {
    current: number;
    total: number;
    message: string;
    source: string;
    percent: number;
  };
  result?: {
    success: boolean;
    cachedCount: number;
    source?: string;
    error?: string;
  };
}

/**
 * OHLCVデータ取得ジョブを開始（バックグラウンド実行）
 * POST /api/strategies/ohlcv/fetch-and-cache
 * 
 * @returns jobId
 */
export async function startOhlcvFetchJob(
  symbol: string,
  timeframe: string,
  startDate: string,
  endDate: string
): Promise<{ jobId: string }> {
  const response = await fetch(
    `${getPublicApiBaseUrl()}/api/strategies/ohlcv/fetch-and-cache`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, timeframe, startDate, endDate }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "OHLCVデータ取得ジョブの開始に失敗しました");
  }

  const payload = await response.json();
  return { jobId: payload.data.jobId };
}

/**
 * OHLCVデータ取得の進捗をSSEで購読
 * GET /api/strategies/ohlcv/fetch-progress/:jobId
 * 
 * @param jobId - ジョブID
 * @param onProgress - 進捗コールバック
 * @returns EventSource（呼び出し元でclose()すること）
 */
export function subscribeOhlcvFetchProgress(
  jobId: string,
  onProgress: (progress: DataFetchProgress) => void,
  onError?: (error: Event) => void
): EventSource {
  const es = new EventSource(
    `${getPublicApiBaseUrl()}/api/strategies/ohlcv/fetch-progress/${jobId}`
  );

  es.onmessage = (event) => {
    try {
      const data: DataFetchProgress = JSON.parse(event.data);
      onProgress(data);

      // 完了・エラー時は自動的に閉じる
      if (data.status !== 'running') {
        es.close();
      }
    } catch {
      console.warn('[subscribeOhlcvFetchProgress] パースエラー:', event.data);
    }
  };

  es.onerror = (error) => {
    onError?.(error);
    es.close();
  };

  return es;
}

/**
 * OHLCVデータ取得（バックグラウンド実行 + 進捗コールバック）
 * ジョブ開始 → SSE購読 → 完了まで待つ
 */
export async function fetchAndCacheOhlcvData(
  symbol: string,
  timeframe: string,
  startDate: string,
  endDate: string,
  onProgress?: (progress: DataFetchProgress) => void
): Promise<FetchOhlcvResult> {
  // 1. ジョブ開始
  const { jobId } = await startOhlcvFetchJob(symbol, timeframe, startDate, endDate);

  // 2. SSEで完了を待つ
  return new Promise<FetchOhlcvResult>((resolve) => {
    const es = subscribeOhlcvFetchProgress(
      jobId,
      (data) => {
        onProgress?.(data);
        if (data.status === 'completed') {
          resolve({
            success: true,
            cachedCount: data.result?.cachedCount ?? 0,
          });
        } else if (data.status === 'error') {
          resolve({
            success: false,
            cachedCount: 0,
            error: data.result?.error ?? 'データ取得に失敗しました',
          });
        }
      },
      () => {
        resolve({
          success: false,
          cachedCount: 0,
          error: 'データ取得の接続が切断されました',
        });
      }
    );

    // タイムアウト（10分）
    setTimeout(() => {
      es.close();
      resolve({
        success: false,
        cachedCount: 0,
        error: 'データ取得がタイムアウトしました（10分）',
      });
    }, 10 * 60 * 1000);
  });
}

// ========================================
// OHLCV チャートデータ取得 API
// ========================================

/**
 * バックテストチャート用 OHLCV データ取得
 * GET /api/ohlcv/candles?symbol=...&timeframe=...&startDate=...&endDate=...
 * 
 * @param params - 取得パラメータ
 * @returns OHLCVデータ配列（timestamp は ms 単位）
 */
export async function fetchOhlcvCandles(params: {
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
}): Promise<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }[]> {
  const searchParams = new URLSearchParams({
    symbol: params.symbol,
    timeframe: params.timeframe,
    startDate: params.startDate,
    endDate: params.endDate,
  });

  const response = await fetch(
    `${getPublicApiBaseUrl()}/api/ohlcv/candles?${searchParams.toString()}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "OHLCVデータの取得に失敗しました");
  }

  const payload = await response.json();
  // API returns ISO string timestamps, convert to ms for CandlestickChart
  return (payload.data || []).map((c: { timestamp: string; open: number; high: number; low: number; close: number; volume: number }) => ({
    timestamp: new Date(c.timestamp).getTime(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

// ========================================
// インジケータープロファイル API
// ========================================

/**
 * プロファイル選択オプション
 * 特殊オプション（AIに任せる、プロファイルなし）とユーザープロファイルを含む
 */
export interface ProfileOption {
  id: string;
  label: string;
  description: string;
  icon: string;
  isSpecial: boolean;
  isDefault?: boolean;
}

/**
 * インジケーター設定
 */
export interface ProfileIndicatorConfig {
  configId: string;
  indicatorId: string;
  label: string;
  // IndicatorParamsと互換性を持たせるため、より緩やかな型定義
  params: {
    period?: number;
    fastPeriod?: number;
    slowPeriod?: number;
    signalPeriod?: number;
    kPeriod?: number;
    dPeriod?: number;
    step?: number;
    maxStep?: number;
    conversionPeriod?: number;
    basePeriod?: number;
    spanBPeriod?: number;
    displacement?: number;
    [key: string]: number | string | boolean | undefined;
  };
  enabled: boolean;
}

/**
 * インジケータープロファイル
 */
export interface IndicatorProfile {
  id: string;
  name: string;
  description?: string;
  indicators: ProfileIndicatorConfig[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * プロファイル作成リクエスト
 */
export interface CreateProfileRequest {
  name: string;
  description?: string;
  indicators: ProfileIndicatorConfig[];
  isDefault?: boolean;
}

/**
 * プロファイル更新リクエスト
 */
export interface UpdateProfileRequest {
  name?: string;
  description?: string;
  indicators?: ProfileIndicatorConfig[];
  isDefault?: boolean;
}

/**
 * プロファイル選択オプション一覧を取得
 * 特殊オプション（AIに任せる、プロファイルなし）を含む
 * GET /api/profiles/options
 */
export async function fetchProfileOptions(): Promise<ProfileOption[]> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/profiles/options`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      `プロファイルオプションの取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }
  const payload = await response.json();
  return payload.data.options;
}

/**
 * プロファイル一覧を取得
 * GET /api/profiles
 */
export async function fetchProfiles(): Promise<IndicatorProfile[]> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/profiles`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      `プロファイル一覧の取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }
  const payload = await response.json();
  return payload.data || [];
}

/**
 * プロファイル詳細を取得
 * GET /api/profiles/:id
 */
export async function fetchProfileById(id: string): Promise<IndicatorProfile | null> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/profiles/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `プロファイルの取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }
  const payload = await response.json();
  return payload.data.profile;
}

/**
 * プロファイルを作成
 * POST /api/profiles
 */
export async function createProfile(request: CreateProfileRequest): Promise<IndicatorProfile> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "プロファイルの作成に失敗しました");
  }
  const payload = await response.json();
  return payload.data.profile;
}

/**
 * プロファイルを更新
 * PUT /api/profiles/:id
 */
export async function updateProfile(
  id: string,
  request: UpdateProfileRequest
): Promise<IndicatorProfile> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/profiles/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "プロファイルの更新に失敗しました");
  }
  const payload = await response.json();
  return payload.data.profile;
}

/**
 * プロファイルを削除
 * DELETE /api/profiles/:id
 */
export async function deleteProfile(id: string): Promise<void> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/profiles/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "プロファイルの削除に失敗しました");
  }
}

/**
 * デフォルトプロファイルを設定
 * PUT /api/profiles/:id/default
 */
export async function setDefaultProfile(id: string): Promise<void> {
  const response = await fetch(
    `${getPublicApiBaseUrl()}/api/profiles/${encodeURIComponent(id)}/default`,
    {
      method: "PUT",
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "デフォルト設定に失敗しました");
  }
}

// ============================================
// ストラテジー横断分析 API
// ============================================

/** ストラテジー別パフォーマンス */
export interface StrategyPerformance {
  strategyId: string;
  strategyName: string;
  symbol: string;
  side: 'buy' | 'sell';
  totalTrades: number;
  winRate: number;
  profitFactor: number | null;
  netProfit: number;
  maxDrawdown: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  dailyReturns: number[];
  equityCurve: { date: string; equity: number }[];
}

/** 相関マトリクス */
export interface CorrelationMatrix {
  strategyIds: string[];
  strategyNames: string[];
  pearson: number[][];
  spearman: number[][];
  coWinRate: number[][];
  coLossRate: number[][];
}

/** 比較サマリー */
export interface ComparisonSummary {
  bestWinRate: { strategyId: string; strategyName: string; value: number };
  bestProfitFactor: { strategyId: string; strategyName: string; value: number };
  lowestDrawdown: { strategyId: string; strategyName: string; value: number };
  bestSharpe: { strategyId: string; strategyName: string; value: number };
  recommendations: string[];
}

/** 比較セッション */
export interface ComparisonSession {
  id: string;
  name: string;
  strategyIds: string[];
  startDate: string;
  endDate: string;
  timeframe: string;
  results: StrategyPerformance[];
  correlations: CorrelationMatrix;
  summary: ComparisonSummary;
  createdAt: string;
}

/** 比較セッション作成リクエスト */
export interface CreateComparisonRequest {
  name: string;
  strategyIds: string[];
  startDate: string;
  endDate: string;
  timeframe?: string;
}

/** 最適化手法 */
export type OptimizationMethod =
  | 'mean_variance'
  | 'risk_parity'
  | 'equal_weight'
  | 'minimum_variance'
  | 'max_sharpe';

/** 最適化リクエスト */
export interface OptimizeRequest {
  method: OptimizationMethod;
  riskFreeRate?: number;
}

/** 最適化結果 */
export interface OptimizationResult {
  method: OptimizationMethod;
  weights: { strategyId: string; strategyName: string; weight: number }[];
  expectedReturn: number;
  expectedRisk: number;
  sharpeRatio: number | null;
  efficientFrontier: { risk: number; return: number }[] | null;
}

/**
 * 比較セッション一覧を取得
 * GET /api/strategy-comparison
 */
export async function fetchComparisonSessions(
  limit: number = 20,
  offset: number = 0
): Promise<{ sessions: ComparisonSession[]; total: number }> {
  const response = await fetch(
    `${getPublicApiBaseUrl()}/api/strategy-comparison?limit=${limit}&offset=${offset}`,
    { cache: "no-store" }
  );
  if (!response.ok) {
    throw new Error(
      `比較セッション一覧の取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }
  const payload = await response.json();
  return payload.data;
}

/**
 * 比較セッションを作成
 * POST /api/strategy-comparison
 */
export async function createComparisonSession(
  request: CreateComparisonRequest
): Promise<ComparisonSession> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/strategy-comparison`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "比較セッションの作成に失敗しました");
  }
  const payload = await response.json();
  return payload.data;
}

/**
 * 比較セッション詳細を取得
 * GET /api/strategy-comparison/:id
 */
export async function fetchComparisonSession(
  id: string
): Promise<ComparisonSession | null> {
  const response = await fetch(
    `${getPublicApiBaseUrl()}/api/strategy-comparison/${encodeURIComponent(id)}`,
    { cache: "no-store" }
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `比較セッションの取得に失敗しました: ${response.status} ${response.statusText}`
    );
  }
  const payload = await response.json();
  return payload.data;
}

/**
 * 比較セッションを削除
 * DELETE /api/strategy-comparison/:id
 */
export async function deleteComparisonSession(id: string): Promise<void> {
  const response = await fetch(
    `${getPublicApiBaseUrl()}/api/strategy-comparison/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "比較セッションの削除に失敗しました");
  }
}

/**
 * ポートフォリオ最適化を実行
 * POST /api/strategy-comparison/:id/optimize
 */
export async function runPortfolioOptimization(
  sessionId: string,
  request: OptimizeRequest
): Promise<OptimizationResult> {
  const response = await fetch(
    `${getPublicApiBaseUrl()}/api/strategy-comparison/${encodeURIComponent(sessionId)}/optimize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "ポートフォリオ最適化に失敗しました");
  }
  const payload = await response.json();
  return payload.data;
}

// ============================================
// パターン分析 API
// ============================================

/** 12次元特徴量 */
export interface FeatureVector {
  trendStrength: number;
  trendDirection: number;
  maAlignment: number;
  pricePosition: number;
  rsiLevel: number;
  macdMomentum: number;
  momentumDivergence: number;
  volatilityLevel: number;
  bbWidth: number;
  volatilityTrend: number;
  supportProximity: number;
  resistanceProximity: number;
}

/** 勝ちパターン */
export interface WinningPattern {
  id: string;
  name: string;
  featureVector: FeatureVector;
  winRate: number;
  profitFactor: number;
  tradeCount: number;
  description?: string;
}

/** パターンマッチ結果 */
export interface PatternMatch {
  patternId: string;
  patternName: string;
  similarity: number;
  matchedDimensions: string[];
  divergentDimensions: string[];
}

/** エントリー推奨度 */
export type Recommendation = 'strong' | 'moderate' | 'weak' | 'avoid';

/** パターン分析結果 */
export interface PatternAnalysisResult {
  overallScore: number;
  recommendation: Recommendation;
  confidence: number;
  patternMatches: PatternMatch[];
  reasons: string[];
  risks: string[];
  suggestedAction: string;
  tokenUsage: number;
  model: string;
  analyzedAt: string;
}

/** 異常検知結果 */
export interface AnomalyDetectionResult {
  anomalyScore: number;
  isAnomaly: boolean;
  anomalyType: 'volatility_spike' | 'trend_reversal' | 'volume_anomaly' | 'pattern_break' | 'none';
  anomalousDimensions: string[];
  explanation: string;
  suggestedAction: string;
  tokenUsage: number;
  model: string;
  analyzedAt: string;
}

/**
 * パターン分析を実行
 * POST /api/pattern-analysis/analyze
 */
export async function analyzePattern(request: {
  symbol: string;
  currentFeatures: FeatureVector;
  winningPatterns: WinningPattern[];
  side: 'buy' | 'sell';
  context?: {
    recentPrice?: number;
    recentHigh?: number;
    recentLow?: number;
    timeframe?: string;
  };
}): Promise<PatternAnalysisResult> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/pattern-analysis/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "パターン分析に失敗しました");
  }
  const payload = await response.json();
  return payload.data;
}

/**
 * ストラテジーに対してパターン分析を実行
 * POST /api/pattern-analysis/analyze-strategy
 */
export async function analyzeStrategyPattern(request: {
  strategyId: string;
  currentFeatures: FeatureVector;
  context?: {
    recentPrice?: number;
    timeframe?: string;
  };
}): Promise<{
  strategy: { id: string; name: string; symbol: string; side: string };
  patternsCompared: number;
  analysis: PatternAnalysisResult;
}> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/pattern-analysis/analyze-strategy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "ストラテジー分析に失敗しました");
  }
  const payload = await response.json();
  return payload.data;
}

/**
 * 異常検知を実行
 * POST /api/pattern-analysis/anomaly
 */
export async function detectAnomaly(request: {
  symbol: string;
  currentFeatures: FeatureVector;
  normalPatterns: FeatureVector[];
  context?: {
    recentPrice?: number;
    timeframe?: string;
  };
}): Promise<AnomalyDetectionResult> {
  const response = await fetch(`${getPublicApiBaseUrl()}/api/pattern-analysis/anomaly`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "異常検知に失敗しました");
  }
  const payload = await response.json();
  return payload.data;
}

/**
 * ストラテジーの勝ちパターンを取得
 * GET /api/pattern-analysis/patterns/:strategyId
 */
export async function fetchWinningPatterns(
  strategyId: string,
  options?: { minWinRate?: number; limit?: number }
): Promise<{
  strategyId: string;
  strategyName: string;
  patterns: WinningPattern[];
  totalPatterns: number;
}> {
  const params = new URLSearchParams();
  if (options?.minWinRate !== undefined) {
    params.set("minWinRate", options.minWinRate.toString());
  }
  if (options?.limit !== undefined) {
    params.set("limit", options.limit.toString());
  }

  const url = `${getPublicApiBaseUrl()}/api/pattern-analysis/patterns/${encodeURIComponent(strategyId)}?${params}`;
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "勝ちパターンの取得に失敗しました");
  }
  const payload = await response.json();
  return payload.data;
}
