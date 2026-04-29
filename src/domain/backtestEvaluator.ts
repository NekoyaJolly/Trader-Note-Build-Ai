/**
 * BacktestEvaluator 統合インターフェース
 * 
 * 目的:
 * - 条件判定（完全一致）と類似度判定（特徴量ベース）を統一的に扱う
 * - BacktestEngine が評価方式を意識せずに使用可能にする
 * 
 * 設計思想:
 * - 市場は「入力」
 * - 評価器は「判定ロジック」
 * - 条件判定 = 類似度100%（完全一致）
 * - 類似度判定 = 閾値でのマッチ（抽象化）
 * 
 * @see docs/DESIGN_PHILOSOPHY.md
 */

import type { MarketSnapshot } from './noteEvaluator';

// ============================================================================
// 評価モード
// ============================================================================

/**
 * 評価モード
 * - exact: 条件判定（完全一致 = 100% or 0%）
 * - similarity: 類似度判定（0〜100%）
 */
export type EvaluationMode = 'exact' | 'similarity';

// ============================================================================
// 共通型定義
// ============================================================================

/**
 * エントリー評価結果
 */
export interface EntryResult {
  /** エントリーすべきか */
  shouldEnter: boolean;
  /** トレード方向 */
  direction: 'long' | 'short';
  /** 信頼度/類似度スコア（0.0〜1.0） */
  score: number;
  /** 評価モード */
  mode: EvaluationMode;
  /** 使用したインジケーター */
  usedIndicators: string[];
  /** メタデータ（デバッグ用） */
  metadata?: {
    /** 条件判定の場合: マッチした条件 */
    matchedConditions?: string[];
    /** 類似度判定の場合: 類似度レベル */
    similarityLevel?: 'strong' | 'medium' | 'weak' | 'none';
    /** ベクトル情報 */
    vectors?: {
      note: number[];
      market: number[];
    };
  };
}

/**
 * エグジット評価結果
 */
export interface ExitResult {
  /** エグジットすべきか */
  shouldExit: boolean;
  /** エグジット理由 */
  reason: 'take_profit' | 'stop_loss' | 'timeout' | 'condition' | 'trailing_stop' | 'none';
  /** エグジット価格 */
  exitPrice: number;
  /** メタデータ */
  metadata?: {
    holdingMinutes?: number;
    pnlPercent?: number;
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
// BacktestEvaluator インターフェース
// ============================================================================

/**
 * バックテスト評価器インターフェース
 * 
 * シンプルさを重視し、必要最小限のメソッドのみ定義。
 * 評価方式（条件判定/類似度）は実装クラス内部で処理。
 * 
 * @example
 * ```typescript
 * // 条件判定モード（ユーザー定義）
 * const exactEvaluator = createExactEvaluator(note);
 * 
 * // 類似度モード（AI/抽象化）
 * const similarityEvaluator = createSimilarityEvaluator(note);
 * 
 * // BacktestEngine は同じインターフェースで使用
 * const result = evaluator.evaluateEntry(snapshot);
 * if (result.shouldEnter) {
 *   // エントリー処理
 * }
 * ```
 */
export interface BacktestEvaluator {
  /** 評価器ID（ノートID or 戦略ID） */
  readonly id: string;
  
  /** 対象シンボル */
  readonly symbol: string;
  
  /** 評価モード */
  readonly mode: EvaluationMode;
  
  /** トレード方向（固定の場合） */
  readonly direction: 'long' | 'short' | 'both';

  /**
   * エントリー条件を評価
   * 
   * - exact モード: 条件判定（100% or 0%）
   * - similarity モード: 類似度計算（0〜100%）
   * 
   * @param snapshot 市場スナップショット
   * @returns エントリー評価結果
   */
  evaluateEntry(snapshot: MarketSnapshot): EntryResult;

  /**
   * エグジット条件を評価
   * 
   * TP/SL/タイムアウトの共通ロジック + 評価器固有の条件
   * 
   * @param snapshot 市場スナップショット
   * @param position ポジション情報
   * @param settings エグジット設定
   * @returns エグジット評価結果
   */
  evaluateExit(
    snapshot: MarketSnapshot,
    position: Position,
    settings: ExitSettings,
  ): ExitResult;
}

// ============================================================================
// ヘルパー関数
// ============================================================================

/**
 * 共通のエグジット判定（TP/SL/タイムアウト）
 * 
 * BacktestEvaluator の evaluateExit 内で使用可能。
 */
export function checkBasicExit(
  snapshot: MarketSnapshot,
  position: Position,
  settings: ExitSettings,
): ExitResult {
  const { direction, entryPrice, entryTime } = position;
  const currentPrice = snapshot.ohlcv.close;
  const holdingMinutes = (snapshot.timestamp.getTime() - entryTime.getTime()) / 60000;

  // TP/SL価格を計算
  const tpPrice = calculateExitPrice(entryPrice, settings.takeProfit, direction, 'tp', snapshot.symbol);
  const slPrice = calculateExitPrice(entryPrice, settings.stopLoss, direction, 'sl', snapshot.symbol);

  // タイムアウト判定
  if (settings.maxHoldingMinutes && holdingMinutes >= settings.maxHoldingMinutes) {
    return {
      shouldExit: true,
      reason: 'timeout',
      exitPrice: currentPrice,
      metadata: { holdingMinutes },
    };
  }

  const { high, low } = snapshot.ohlcv;

  // ロングの場合
  if (direction === 'long') {
    if (high >= tpPrice) {
      return { shouldExit: true, reason: 'take_profit', exitPrice: tpPrice };
    }
    if (low <= slPrice) {
      return { shouldExit: true, reason: 'stop_loss', exitPrice: slPrice };
    }
  }
  // ショートの場合
  else {
    if (low <= tpPrice) {
      return { shouldExit: true, reason: 'take_profit', exitPrice: tpPrice };
    }
    if (high >= slPrice) {
      return { shouldExit: true, reason: 'stop_loss', exitPrice: slPrice };
    }
  }

  return {
    shouldExit: false,
    reason: 'none',
    exitPrice: currentPrice,
    metadata: { holdingMinutes },
  };
}

/**
 * エグジット価格を計算
 */
function calculateExitPrice(
  entryPrice: number,
  target: { value: number; unit: 'percent' | 'pips' | 'price' },
  direction: 'long' | 'short',
  type: 'tp' | 'sl',
  symbol: string,
): number {
  if (target.unit === 'price') {
    return target.value;
  }

  let distance: number;
  if (target.unit === 'percent') {
    distance = entryPrice * (target.value / 100);
  } else {
    // pips → 価格変動に変換
    const pipValue = symbol.includes('JPY') ? 0.01 : 0.0001;
    distance = target.value * pipValue;
  }

  if (direction === 'long') {
    return type === 'tp' ? entryPrice + distance : entryPrice - distance;
  } else {
    return type === 'tp' ? entryPrice - distance : entryPrice + distance;
  }
}

// ============================================================================
// ファクトリ関数の型定義
// ============================================================================

/**
 * 条件判定用 Evaluator を生成
 */
export type ExactEvaluatorFactory = (config: {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  conditions: unknown; // IndicatorCondition[] or ConditionGroup
}) => BacktestEvaluator;

/**
 * 類似度判定用 Evaluator を生成
 */
export type SimilarityEvaluatorFactory = (config: {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  featureVector: number[];
  threshold: number;
}) => BacktestEvaluator;
