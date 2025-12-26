/**
 * 通知システム関連の型定義
 * Phase4 API 仕様に準拠
 */

/**
 * 通知ログの基本情報
 */
export interface NotificationLog {
  id: string;
  matchResultId: string;
  sentAt: string; // ISO 8601 形式の日時文字列
  channel: string; // "in_app" など
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

/**
 * 一致結果の詳細情報
 */
export interface MatchResult {
  id: string;
  tradeNoteId: string;
  evaluatedAt: string; // ISO 8601 形式の日時文字列
  score: number; // 0.0 〜 1.0
  matched: boolean;
  reasons: MatchReason[];
  marketSnapshotId15m: string;
  marketSnapshotId60m: string;
  createdAt: string;
}

/**
 * 一致判定理由（個別特徴量の評価）
 */
export interface MatchReason {
  featureName: string; // 特徴量名（例: "priceChange", "trendDirection"）
  noteValue: number; // トレードノート時の値
  currentValue: number; // 現在の市場の値
  diff: number; // 差分
  weight: number; // 重み係数
  contribution: number; // スコアへの寄与度
  description: string; // 日本語での説明
}

/**
 * 市場スナップショット（15分足または60分足）
 */
export interface MarketSnapshot {
  id: string;
  symbol: string;
  timeframe: string; // "15m" または "60m"
  timestamp: string; // ISO 8601 形式の日時文字列
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  atr: number | null;
  ema20: number | null;
  ema50: number | null;
  bollingerUpper: number | null;
  bollingerMiddle: number | null;
  bollingerLower: number | null;
  createdAt: string;
}

/**
 * トレードノートのメタ情報
 */
export interface TradeNote {
  id: string;
  tradeId: string;
  symbol: string;
  side: "BUY" | "SELL";
  timeframe: string; // "15m" など
  entryConditions: string; // JSON 文字列
  exitConditions: string; // JSON 文字列
  aiSummary: string | null;
  createdAt: string;
}

/**
 * 通知一覧画面用の統合データ型
 */
export interface NotificationListItem extends NotificationLog {
  matchResult: {
    score: number;
    evaluatedAt: string;
  };
  tradeNote: {
    symbol: string;
    side: "BUY" | "SELL";
    timeframe: string;
  };
  reasonSummary: string; // 判定理由の要約（1行）
}

/**
 * 通知詳細画面用の統合データ型
 */
export interface NotificationDetail extends NotificationLog {
  matchResult: MatchResult;
  tradeNote: TradeNote;
  marketSnapshot15m: MarketSnapshot;
  marketSnapshot60m: MarketSnapshot;
}
