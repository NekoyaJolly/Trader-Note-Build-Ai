/**
 * ノートの承認状態を表す型
 * - draft: AI 生成直後。ユーザーが「承認/非承認/編集」可能
 * - active: マッチング対象。検索・通知・バックテスト対象
 * - archived: アーカイブ扱い。マッチング対象外
 */
export type NoteStatus = 'draft' | 'active' | 'archived';

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
  
  // 承認状態（draft: 下書き、active: 有効、archived: アーカイブ）
  status: NoteStatus;
  
  // 状態遷移のタイムスタンプ
  activatedAt?: Date;
  archivedAt?: Date;
  lastEditedAt?: Date;
  
  // ユーザーによる編集内容（AI要約の上書き等）
  userNotes?: string;
  tags?: string[];

  // フェーズ8: 複数ノート運用フィールド（マッチング対象の制御）
  /** 優先度（1-10、高いほど優先。同時ヒット時のソートに使用） */
  priority?: number;
  /** 有効フラグ（false の場合、マッチング対象から除外） */
  enabled?: boolean;
  /** 一時停止期限（この日時まで監視対象外。未設定 (undefined) は停止なし） */
  pausedUntil?: Date;
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
  /// strategy_alert はストラテジー条件成立通知 (Phase γ-1 で追加。matchResult を持たない)
  type: 'match' | 'info' | 'warning' | 'strategy_alert';
  title: string;
  message: string;
  matchResult?: MatchResult;
  timestamp: Date;
  read: boolean;
}

/**
 * 注文プリセット信頼度の主な算出元
 * - latest_match: 最新の一致判定スコアを主軸にした信頼度
 * - note_quality: 最新マッチが無い場合にノート情報量から推定した信頼度
 */
export type OrderPresetConfidenceSource = 'latest_match' | 'note_quality';

/**
 * Order preset for UI
 * 発注支援画面に表示する参考プリセット。実発注は行わない。
 */
export interface OrderPreset {
  symbol: string;
  side: 'buy' | 'sell';
  suggestedPrice: number;
  suggestedQuantity: number;
  basedOnNoteId: string;
  /** 0.0〜1.0 の参考信頼度 */
  confidence: number;
  /** 信頼度がどの情報を主軸に算出されたか */
  confidenceSource: OrderPresetConfidenceSource;
  /** ユーザーに表示する信頼度算出の主要根拠 */
  confidenceReasons: string[];
}
