/**
 * ノートの承認状態を表す型
 * - draft: AI 生成直後。ユーザーが「承認/非承認/編集」可能
 * - approved: マッチング対象。検索・通知・バックテスト対象
 * - rejected: アーカイブ扱い。マッチング対象外
 */
export type NoteStatus = 'draft' | 'approved' | 'rejected';

/**
 * Trade data structure from CSV/API import
 */
export interface Trade {
  id: string;
  timestamp: Date;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  fee?: number;
  exchange?: string;
}

/**
 * トレード時点の市場コンテキスト
 * ノート生成時に使用する市場情報の型定義
 */
export interface MarketContext {
  timeframe: string; // 例: '15m', '1h', '4h'
  trend: 'bullish' | 'bearish' | 'neutral';
  // 基本インジケーター（後方互換性のため維持）
  indicators?: {
    rsi?: number;
    macd?: number;
    volume?: number;
  };
  // ユーザー設定インジケーターの計算結果
  // キー例: 'RSI(14)', 'SMA(20)', 'BB(20,2)'
  calculatedIndicators?: Record<string, number | null>;
}

/**
 * Structured trade note with AI summary
 * トレード履歴から生成される構造化ノート
 */
export interface TradeNote {
  id: string;
  tradeId: string;
  timestamp: Date;
  symbol: string;
  side: 'buy' | 'sell';
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  profitLoss?: number;
  
  // トレード時点の市場コンテキスト
  marketContext: MarketContext;
  
  // AI が生成した要約
  aiSummary: string;
  
  // 一致判定用の特徴量ベクトル
  features: number[];
  
  createdAt: Date;
  
  // 承認状態（draft: 下書き、approved: 承認済み、rejected: 非承認）
  status: NoteStatus;
  
  // 状態遷移のタイムスタンプ
  approvedAt?: Date;
  rejectedAt?: Date;
  lastEditedAt?: Date;
  
  // ユーザーによる編集内容（AI要約の上書き等）
  userNotes?: string;
  tags?: string[];
}

/**
 * Market data structure
 */
export interface MarketData {
  symbol: string;
  timestamp: Date;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  indicators?: {
    rsi?: number;
    macd?: number;
    trend?: 'bullish' | 'bearish' | 'neutral';
  };
}

/**
 * Match result between historical note and current market
 */
export interface MatchResult {
  noteId: string;
  symbol: string;
  matchScore: number;
  threshold: number;
  isMatch: boolean;
  currentMarket: MarketData;
  historicalNote: TradeNote;
  timestamp: Date;
}

/**
 * Notification data
 */
export interface Notification {
  id: string;
  type: 'match' | 'info' | 'warning';
  title: string;
  message: string;
  matchResult?: MatchResult;
  timestamp: Date;
  read: boolean;
}

/**
 * Order preset for UI
 */
export interface OrderPreset {
  symbol: string;
  side: 'buy' | 'sell';
  suggestedPrice: number;
  suggestedQuantity: number;
  basedOnNoteId: string;
  confidence: number;
}
