/**
 * NoteEvaluator インターフェース定義
 * 
 * 目的:
 * - ノートを「評価の主語」として扱うための抽象インターフェース
 * - 市場データを入力として受け取り、ノート固有の評価ロジックを適用する
 * - 共通特徴量ベースの旧実装を破壊せず、新しい設計への移行を可能にする
 * 
 * 設計方針:
 * - ノートが必要とするインジケーターを動的に定義可能
 * - 特徴量ベクトルの次元はノートごとに可変
 * - 類似度計算・発火条件もノート固有にカスタマイズ可能
 * 
 * @see AGENTS.md - プロジェクト方針
 * @see trader_assist_mvp｜意図の棚卸し - 「ノートを評価の主語に」
 */

import { IndicatorId, IndicatorParams, IndicatorConfig } from '../models/indicatorConfig';

// ============================================================================
// 基本型定義
// ============================================================================

/**
 * インジケーター仕様
 * ノートが評価に必要とするインジケーターを定義する
 */
export interface IndicatorSpec {
  /** インジケーターID */
  indicatorId: IndicatorId;
  /** パラメータ設定 */
  params: IndicatorParams;
  /** 評価に必須かどうか（false の場合、取得できなくてもスキップ可能） */
  required: boolean;
}

/**
 * 市場スナップショット
 * ある時点の市場データとインジケーター値を含む
 */
export interface MarketSnapshot {
  /** シンボル（例: BTCUSDT） */
  symbol: string;
  /** タイムスタンプ（UTC） */
  timestamp: Date;
  /** 時間足（例: '15m', '1h', '4h'） */
  timeframe: string;
  /** OHLCV データ */
  ohlcv: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
  /** 計算済みインジケーター値（キー: インジケーターラベル） */
  indicators: Record<string, number | null>;
}

/**
 * 類似度レベル
 * マッチ判定時に使用する閾値カテゴリ
 */
export type SimilarityLevel = 'strong' | 'medium' | 'weak' | 'none';

/**
 * 評価結果
 * ノートと市場スナップショットの比較結果
 */
export interface EvaluationResult {
  /** ノートID */
  noteId: string;
  /** 類似度スコア（0.0〜1.0） */
  similarity: number;
  /** 類似度レベル */
  level: SimilarityLevel;
  /** 発火条件を満たすか */
  triggered: boolean;
  /** 類似度計算に使用したベクトル次元数 */
  vectorDimension: number;
  /** 計算に使用したインジケーターラベル一覧 */
  usedIndicators: string[];
  /** 評価日時 */
  evaluatedAt: Date;
  /** 追加の診断情報（デバッグ用） */
  diagnostics?: {
    noteVector: number[];
    marketVector: number[];
    missingIndicators?: string[];
  };
}

// ============================================================================
// NoteEvaluator インターフェース
// ============================================================================

/**
 * ノート評価器インターフェース
 * 
 * このインターフェースを実装することで、ノートごとに異なる評価ロジックを定義できる。
 * 
 * 設計の核心:
 * - 市場は「入力」
 * - ノートは「評価器」
 * - 共通特徴量は「オプション依存物」
 * 
 * @example
 * ```typescript
 * const evaluator = noteEvaluatorFactory.create(note);
 * const indicators = evaluator.requiredIndicators();
 * const marketSnapshot = await marketService.fetch(note.symbol, indicators);
 * const result = evaluator.evaluate(marketSnapshot);
 * if (result.triggered) {
 *   await notificationService.notify(note, result);
 * }
 * ```
 */
export interface NoteEvaluator {
  /** 
   * ノートID
   * 評価対象となるノートの一意識別子
   */
  readonly noteId: string;

  /** 
   * ノートのシンボル
   * 例: 'BTCUSDT', 'ETHUSDT'
   */
  readonly symbol: string;

  /**
   * このノートが評価に必要とするインジケーター仕様を返す
   * 
   * ノートの indicatorConfig に基づいて、市場データ取得時に必要な
   * インジケーターを動的に決定する。
   * 
   * @returns インジケーター仕様の配列
   * 
   * @example
   * ```typescript
   * const specs = evaluator.requiredIndicators();
   * // => [
   * //   { indicatorId: 'rsi', params: { period: 14 }, required: true },
   * //   { indicatorId: 'sma', params: { period: 20 }, required: true },
   * //   { indicatorId: 'macd', params: { ... }, required: false }
   * // ]
   * ```
   */
  requiredIndicators(): IndicatorSpec[];

  /**
   * 市場スナップショットからノート固有の特徴量ベクトルを構築する
   * 
   * ノートが持つインジケーター設定に基づいて、市場データから
   * 数値ベクトルを生成する。ベクトルの次元はノートごとに可変。
   * 
   * @param snapshot 市場スナップショット
   * @returns 特徴量ベクトル（ノート固有の次元数）
   * 
   * @example
   * ```typescript
   * const vector = evaluator.buildFeatureVector(marketSnapshot);
   * // => [0.52, 150.3, 43000, 42500] // 次元はノートにより異なる
   * ```
   */
  buildFeatureVector(snapshot: MarketSnapshot): number[];

  /**
   * 2つの特徴量ベクトル間の類似度を計算する
   * 
   * デフォルトはコサイン類似度だが、ノートごとに異なる
   * 距離メトリクスを使用可能（ユークリッド距離、マンハッタン距離等）。
   * 
   * @param vectorA 比較元ベクトル（通常はノートの保存済みベクトル）
   * @param vectorB 比較先ベクトル（通常は現在の市場から生成）
   * @returns 類似度（0.0〜1.0）
   * 
   * @example
   * ```typescript
   * const sim = evaluator.similarity(noteVector, marketVector);
   * // => 0.87
   * ```
   */
  similarity(vectorA: number[], vectorB: number[]): number;

  /**
   * 与えられた類似度が発火条件を満たすか判定する
   * 
   * ノートごとに異なる閾値や条件ロジックを定義可能。
   * 
   * @param similarity 類似度スコア
   * @returns 発火するか否か
   * 
   * @example
   * ```typescript
   * if (evaluator.isTriggered(0.87)) {
   *   // 通知を発行
   * }
   * ```
   */
  isTriggered(similarity: number): boolean;

  /**
   * 評価閾値を取得する
   * 
   * @returns { strong, medium, weak } 形式の閾値オブジェクト
   */
  getThresholds(): {
    strong: number;
    medium: number;
    weak: number;
  };

  /**
   * 市場スナップショットを使ってノートを評価する（便利メソッド）
   * 
   * requiredIndicators(), buildFeatureVector(), similarity(), isTriggered() を
   * 内部で呼び出し、一括で評価結果を返す。
   * 
   * @param snapshot 市場スナップショット
   * @param noteVector ノートの保存済み特徴量ベクトル（オプション）
   * @returns 評価結果
   */
  evaluate(snapshot: MarketSnapshot, noteVector?: number[]): EvaluationResult;
}

// ============================================================================
// ノート固有設定の型定義
// ============================================================================

/**
 * ノート固有のインジケーター設定
 * 
 * TradeNote.indicatorConfig フィールドに保存される JSON 構造。
 * グローバル設定とは別に、各ノートが独自のインジケーター構成を持てる。
 */
export interface NoteIndicatorConfig {
  /** 設定バージョン（マイグレーション用） */
  version: number;
  /** 使用するインジケーター設定の配列 */
  indicators: IndicatorConfig[];
  /** 発火閾値（0.0〜1.0） */
  threshold: number;
  /** 類似度計算方式 */
  similarityMethod: 'cosine' | 'euclidean' | 'manhattan';
  /** 作成日時 */
  createdAt: Date;
  /** 更新日時 */
  updatedAt: Date;
}

/**
 * デフォルトのノート設定を生成する
 * 
 * グローバル設定からノート固有設定への初期変換に使用。
 * 
 * @param globalConfigs グローバルのインジケーター設定配列
 * @param threshold 発火閾値（デフォルト: 0.75）
 * @returns ノート固有設定
 */
export function createDefaultNoteConfig(
  globalConfigs: IndicatorConfig[],
  threshold = 0.75
): NoteIndicatorConfig {
  return {
    version: 1,
    indicators: globalConfigs.filter(c => c.enabled),
    threshold,
    similarityMethod: 'cosine',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ============================================================================
// 類似度ユーティリティ
// ============================================================================

/**
 * コサイン類似度を計算する
 * 
 * @param vecA ベクトルA
 * @param vecB ベクトルB
 * @returns 類似度（0.0〜1.0）、次元が異なる場合は 0
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) {
    console.warn(`ベクトル次元数が一致しません: ${vecA.length} vs ${vecB.length}`);
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i] ?? 0;
    const b = vecB[i] ?? 0;
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 類似度レベルを判定する
 * 
 * @param similarity 類似度スコア
 * @param thresholds 閾値設定
 * @returns 類似度レベル
 */
export function getSimilarityLevel(
  similarity: number,
  thresholds: { strong: number; medium: number; weak: number }
): SimilarityLevel {
  if (similarity >= thresholds.strong) return 'strong';
  if (similarity >= thresholds.medium) return 'medium';
  if (similarity >= thresholds.weak) return 'weak';
  return 'none';
}

// ============================================================================
// デフォルト閾値定数
// ============================================================================

/**
 * 類似度のデフォルト閾値
 */
export const DEFAULT_THRESHOLDS = {
  /** 強い一致（90%以上） */
  STRONG: 0.90,
  /** 中程度の一致（80%以上） */
  MEDIUM: 0.80,
  /** 弱い一致（70%以上） */
  WEAK: 0.70,
} as const;

/**
 * 通知発火のデフォルト閾値
 */
export const DEFAULT_TRIGGER_THRESHOLD = 0.75;
