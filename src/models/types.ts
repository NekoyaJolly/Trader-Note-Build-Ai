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
 * Structured trade note with AI summary
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
  
  // Market context at time of trade
  marketContext: {
    timeframe: string; // e.g., '15m', '1h'
    trend: 'bullish' | 'bearish' | 'neutral';
    indicators?: {
      rsi?: number;
      macd?: number;
      volume?: number;
    };
  };
  
  // AI-generated summary
  aiSummary: string;
  
  // Feature vector for matching
  features: number[];
  
  createdAt: Date;
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
