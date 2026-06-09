/**
 * トレードノート関連の型定義
 * バックエンドの TradeNote 型と整合させる
 */

/**
 * ノートの承認状態を表す型
 * - draft: AI 生成直後。ユーザーが「承認/アーカイブ/編集」可能
 * - active: マッチング対象。検索・通知・バックテスト対象
 * - archived: アーカイブ扱い。マッチング対象外
 */
export type NoteStatus = "draft" | "active" | "archived";

/**
 * ノート一覧用の簡易型
 */
export interface NoteListItem {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  timestamp: string; // ISO 8601 形式
  aiSummary?: string | null;
  status: NoteStatus;
}

/**
 * ノート一覧用の型（バックテストページ等で使用）
 * NoteListItem に追加フィールドを含む
 */
export interface NoteSummary {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  entryPrice: number;
  timestamp: string;
  createdAt: string;
  aiSummary?: string | null;
  status: NoteStatus;
  // フェーズ8: 運用フィールド（一覧で監視状態を表示するため）
  priority?: number;
  enabled?: boolean;
  /** 一時停止期限（ISO 8601）。null/未設定は停止なし */
  pausedUntil?: string | null;
}

/**
 * ノート詳細用の型（バックエンドの TradeNote に整合）
 */
export interface NoteDetail {
  id: string;
  tradeId: string;
  timestamp: string;
  symbol: string;
  side: "buy" | "sell";
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  profitLoss?: number;
  marketContext: {
    timeframe: string;
    trend: "bullish" | "bearish" | "neutral";
    indicators?: {
      rsi?: number;
      macd?: number;
      volume?: number;
    };
    /** ユーザー設定に基づいて計算されたインジケーター値 */
    calculatedIndicators?: Record<string, number | null>;
  };
  aiSummary: string;
  features: number[];
  createdAt: string;
  status: NoteStatus;
  activatedAt?: string; // 有効化日時（ISO 8601）
  archivedAt?: string; // アーカイブ日時（ISO 8601）
  lastEditedAt?: string; // 最終編集日時（ISO 8601）
  userNotes?: string; // ユーザーによる追記
  tags?: string[]; // タグ
  // フェーズ8: 運用フィールド（詳細で監視状態を表示・操作するため）
  /** 優先度（1-10、高いほど優先。同時ヒット時のソートに使用） */
  priority?: number;
  /** 有効フラグ（false の場合、マッチング対象から除外） */
  enabled?: boolean;
  /** 一時停止期限（ISO 8601）。null/未設定は停止なし */
  pausedUntil?: string | null;
}

/**
 * ノート更新用のペイロード
 */
export interface NoteUpdatePayload {
  aiSummary?: string;
  userNotes?: string;
  tags?: string[];
}

/**
 * ノートステータス集計
 */
export interface NoteStatusCounts {
  draft: number;
  active: number;
  archived: number;
  total: number;
}
