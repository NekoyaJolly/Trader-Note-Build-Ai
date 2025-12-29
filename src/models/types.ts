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
  indicators?: {
    rsi?: number;
    macd?: number;
    volume?: number;
  };
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
  
  // 承認状態
  status?: 'draft' | 'approved';
  approvedAt?: Date;
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
