/**
 * バックテスト統合評価器インターフェース
 * 
 * 設計方針:
 * - 共通インターフェースは最小限にシンプルに
 * - ユーザー定義の表現力: ハイブリッド（条件判定/類似度）
 * - AI学習との親和性: AI学習時は特徴量変換必須
 * - バックテスト精度: 条件判定（完全一致）or 類似度判定を選択可能
 * 
 * 核心概念:
 * - 条件判定 = 類似度100% と等価
 * - ユーザー定義はデフォルトで条件判定（完全一致）
 * - 抽象化したい時に特徴量変換して類似度判定に切替
 * 
 * @see docs/DESIGN_PHILOSOPHY.md
 */

// ============================================================================
// 共通型定義
// ============================================================================

/**
 * 市場スナップショット
 * バックテスト/リアルタイム評価で使用する市場データ
 */
export interface MarketSnapshot {
  /** シンボル */
  symbol: string;
  /** タイムスタンプ */
  timestamp: Date;
  /** 時間足 */
  timeframe: string;
  /** OHLCV */
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** インジケーター値（キー: "RSI(14)", "SMA(20)" 等） */
  indicators: Record<string, number | null>;
}

/**
 * 評価モード
 * - exact: 条件判定（完全一致 = 類似度100%相当）
 * - similarity: 類似度判定（閾値でマッチ）
 */
export type EvaluationMode = 'exact' | 'similarity';

/**
 * エントリー評価結果
 */
export interface EntryEvaluationResult {
  /** エントリーすべきか */
  shouldEnter: boolean;
  /** エントリー方向 */
  direction: 'long' | 'short';
  /** 
   * 信頼度スコア（0.0〜1.0）
   * - exact モード: 1.0（条件成立）or 0.0（条件不成立）
   * - similarity モード: 類似度スコア
   */
  confidence: number;
  /** 評価モード */
  evaluationMode: EvaluationMode;
  /** 評価に使用したインジケーター */
  usedIndicators: string[];
  /** 追加情報 */
  metadata?: {
    /** similarity モード: 類似度レベル */
    similarityLevel?: 'strong' | 'medium' | 'weak' | 'none';
    /** exact モード: 成立した条件 */
    matchedConditions?: string[];
  };
}

/**
 * エグジット評価結果
 */
export interface ExitEvaluationResult {
  /** エグジットすべきか */
  shouldExit: boolean;
  /** エグジット理由 */
  reason: 'take_profit' | 'stop_loss' | 'timeout' | 'condition' | 'trailing_stop' | 'none';
  /** エグジット価格 */
  exitPrice: number;
  /** 追加情報 */
  metadata?: {
    holdingMinutes?: number;
    distanceToTp?: number;
    distanceToSl?: number;
  };
}

/**
 * エグジット設定
 */
export interface ExitSettings {
  takeProfit: { value: number; unit: 'percent' | 'pips' | 'price' };
  stopLoss: { value: number; unit: 'percent' | 'pips' | 'price' };
  maxHoldingMinutes?: number;
  trailingStop?: {
    enabled: boolean;
    distance: number;
    unit: 'percent' | 'pips';
  };
}

/**
 * ポジション情報
 */
export interface Position {
  entryPrice: number;
  entryTime: Date;
  direction: 'long' | 'short';
}

// ============================================================================
// BacktestEvaluator インターフェース（シンプルに保つ）
// ============================================================================

/**
 * バックテスト評価器インターフェース
 * 
 * 設計: 共通インターフェースは最小限に
 * - evaluateEntry(): エントリー判定
 * - evaluateExit(): エグジット判定
 * 
 * 内部で評価方式（exact/similarity）を切り替える
 * 
 * @example
 * ```typescript
 * // ノート用（条件判定 or 類似度、ノート設定による）
 * const noteEvaluator = createNoteBacktestEvaluator(note);
 * 
 * // 戦略用（条件判定）
 * const strategyEvaluator = createStrategyBacktestEvaluator(strategy);
 * 
 * // BacktestEngine は同じインターフェースで使用
 * for (const candle of ohlcvData) {
 *   const snapshot = toSnapshot(candle);
 *   const entry = evaluator.evaluateEntry(snapshot);
 *   if (entry.shouldEnter) {
 *     // エントリー処理
 *   }
 * }
 * ```
 */
export interface BacktestEvaluator {
  /** 評価器ID（ノートID or 戦略ID） */
  readonly id: string;
  
  /** 対象シンボル */
  readonly symbol: string;
  
  /** 評価器の種類 */
  readonly type: 'note' | 'strategy';
  
  /** 評価モード */
  readonly evaluationMode: EvaluationMode;
  
  /** トレード方向（固定の場合） */
  readonly direction: 'long' | 'short' | 'both';

  /**
   * エントリー条件を評価
   * 
   * - exact モード: 条件成立で confidence=1.0
   * - similarity モード: 類似度スコアを confidence に
   */
  evaluateEntry(snapshot: MarketSnapshot): EntryEvaluationResult;

  /**
   * エグジット条件を評価
   * 
   * 共通: TP/SL/タイムアウト判定
   * + 評価器固有のエグジット条件
   */
  evaluateExit(
    snapshot: MarketSnapshot,
    position: Position,
    exitSettings: ExitSettings,
  ): ExitEvaluationResult;
}

// ============================================================================
// ヘルパー: 共通エグジット判定
// ============================================================================

/**
 * 共通のTP/SL/タイムアウト判定
 * 
 * BacktestEvaluator.evaluateExit() 内で使用
 */
export function checkBasicExitConditions(
  snapshot: MarketSnapshot,
  position: Position,
  exitSettings: ExitSettings,
  pipValue: number = 0.0001, // USD系デフォルト、JPY系は0.01
): ExitEvaluationResult {
  const { direction, entryPrice, entryTime } = position;
  const currentPrice = snapshot.close;
  const holdingMinutes = (snapshot.timestamp.getTime() - entryTime.getTime()) / 60000;

  // TP/SL価格を計算
  const tpDistance = calculateDistance(exitSettings.takeProfit, entryPrice, pipValue);
  const slDistance = calculateDistance(exitSettings.stopLoss, entryPrice, pipValue);
  
  const tpPrice = direction === 'long' ? entryPrice + tpDistance : entryPrice - tpDistance;
  const slPrice = direction === 'long' ? entryPrice - slDistance : entryPrice + slDistance;

  // タイムアウト判定
  if (exitSettings.maxHoldingMinutes && holdingMinutes >= exitSettings.maxHoldingMinutes) {
    return {
      shouldExit: true,
      reason: 'timeout',
      exitPrice: currentPrice,
      metadata: { holdingMinutes },
    };
  }

  // ロングの場合
  if (direction === 'long') {
    if (snapshot.high >= tpPrice) {
      return { shouldExit: true, reason: 'take_profit', exitPrice: tpPrice };
    }
    if (snapshot.low <= slPrice) {
      return { shouldExit: true, reason: 'stop_loss', exitPrice: slPrice };
    }
  }
  // ショートの場合
  else {
    if (snapshot.low <= tpPrice) {
      return { shouldExit: true, reason: 'take_profit', exitPrice: tpPrice };
    }
    if (snapshot.high >= slPrice) {
      return { shouldExit: true, reason: 'stop_loss', exitPrice: slPrice };
    }
  }

  return {
    shouldExit: false,
    reason: 'none',
    exitPrice: currentPrice,
    metadata: {
      holdingMinutes,
      distanceToTp: Math.abs(tpPrice - currentPrice),
      distanceToSl: Math.abs(slPrice - currentPrice),
    },
  };
}

/**
 * 距離を計算
 */
function calculateDistance(
  target: { value: number; unit: 'percent' | 'pips' | 'price' },
  entryPrice: number,
  pipValue: number,
): number {
  switch (target.unit) {
    case 'percent':
      return entryPrice * (target.value / 100);
    case 'pips':
      return target.value * pipValue;
    case 'price':
      return Math.abs(target.value - entryPrice);
    default:
      return 0;
  }
}

// ============================================================================
// 型ガード
// ============================================================================

export function isExactMode(evaluator: BacktestEvaluator): boolean {
  return evaluator.evaluationMode === 'exact';
}

export function isSimilarityMode(evaluator: BacktestEvaluator): boolean {
  return evaluator.evaluationMode === 'similarity';
}
