/**
 * トレードノート関連の型定義
 * バックエンドの TradeNote 型と整合させる
 */

/**
 * ノート一覧用の簡易型
 */
export interface NoteListItem {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  timestamp: string; // ISO 8601 形式
  aiSummary?: string | null;
  status?: "draft" | "approved";
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
  status?: "draft" | "approved";
  approvedAt?: string; // 承認日時（ISO 8601）
}
