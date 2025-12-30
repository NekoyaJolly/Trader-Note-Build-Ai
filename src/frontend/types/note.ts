/**
 * トレードノート関連の型定義
 * バックエンドの TradeNote 型と整合させる
 */

/**
 * ノートの承認状態を表す型
 * - draft: AI 生成直後。ユーザーが「承認/非承認/編集」可能
 * - approved: マッチング対象。検索・通知・バックテスト対象
 * - rejected: アーカイブ扱い。マッチング対象外
 */
export type NoteStatus = "draft" | "approved" | "rejected";

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
  };
  aiSummary: string;
  features: number[];
  createdAt: string;
  status: NoteStatus;
  approvedAt?: string; // 承認日時（ISO 8601）
  rejectedAt?: string; // 非承認日時（ISO 8601）
  lastEditedAt?: string; // 最終編集日時（ISO 8601）
  userNotes?: string; // ユーザーによる追記
  tags?: string[]; // タグ
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
  approved: number;
  rejected: number;
  total: number;
}
