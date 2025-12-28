/**
 * トレードノート関連の型定義
 * バックエンドの Phase1 実装では空配列/404 を返す前提に合わせ、
 * UI 側では受け取り型を明示して安全に扱う。
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
  status?: "draft" | "approved"; // Phase1 では常に draft 相当
  modeEstimated?: "順張り" | "逆張り" | "未推定"; // AI 推定（任意）
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
}
