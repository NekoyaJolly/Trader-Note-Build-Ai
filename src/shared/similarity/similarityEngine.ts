/**
 * ノート類似度基盤 — 類似度エンジン
 *
 * 正本設計: docs/architecture/NOTE_SIMILARITY_FOUNDATION.md §6
 *
 * 責務:
 * - 2 つの NoteLensSnapshot(ノート側 vs 現在市場側)の近さを 0〜1 で測る
 * - 共通 lensId のみで比較し、欠損・プロファイル差に強くする(§6.1)
 * - レンズ単位類似度(§6.2) → confidence 連動の層重み付き集計(§6.3) → 閾値発火(§6.4)
 *
 * 集計モデル(§6.3 の「状態層/指標層の 2 層に層重み」を実装):
 * - 層内: レンズ重み w = lensWeightOverride × min(note.conf, market.conf) の加重平均
 * - 層間: 層重みプリセット(既定 = 指標層重め)で加重平均。存在しない層は除外して再正規化
 *   ※ レンズ数の多寡(状態 8 vs 指標数本)で層バランスが崩れないよう 2 段にしている
 *
 * 比較不能(共通レンズ実質ゼロ)の場合は score=0 ではなく「比較不能」を返し、
 * 呼び出し側が skipReason `no_comparable_lenses` として記録する(§6.1)。
 */

import type { NoteLensSnapshot } from './lensSnapshotTypes';
import type { FeatureComparator, LensLayer } from './lensComparators';
import { getLensComparisonDefinition, getLensLayer } from './lensComparators';

/** 層重みプリセット(§6.3 確定: 既定は指標層重め、ユーザー設定可) */
export type LensWeightPreset = 'indicator_focused' | 'balanced' | 'state_focused';

/** 既定プリセット(Neko 決定 2026-06-09: 指標層重め) */
export const DEFAULT_WEIGHT_PRESET: LensWeightPreset = 'indicator_focused';

/** プリセット → 層重み */
export const LAYER_WEIGHT_PRESETS: Readonly<
  Record<LensWeightPreset, Readonly<Record<LensLayer, number>>>
> = {
  indicator_focused: { indicator: 0.65, state: 0.35 },
  balanced: { indicator: 0.5, state: 0.5 },
  state_focused: { indicator: 0.35, state: 0.65 },
};

/**
 * 既定の発火しきい値・一致レベル帯。
 * 既存実装(src/domain/noteEvaluator.ts DEFAULT_THRESHOLDS / DEFAULT_TRIGGER_THRESHOLD)
 * の値を踏襲する(設計書 付録「getSimilarityLevel/閾値定数は流用可」)。
 */
export const DEFAULT_SIMILARITY_TRIGGER_THRESHOLD = 0.75;
export const DEFAULT_SIMILARITY_LEVELS = {
  strong: 0.9,
  medium: 0.8,
  weak: 0.7,
} as const;

/** 一致レベル(通知粒度のユーザー選択単位。§6.4) */
export type SimilarityMatchLevel = 'strong' | 'medium' | 'weak' | 'none';

/** 類似度計算オプション(通知粒度のユーザー設定層が将来ここに値を渡す) */
export interface SnapshotSimilarityOptions {
  /** 層重みプリセット(既定: indicator_focused) */
  readonly preset?: LensWeightPreset;
  /** レンズ個別の重み倍率(上級者向け微調整。未指定レンズは 1.0) */
  readonly lensWeightOverrides?: Readonly<Record<string, number>>;
  /** 発火しきい値(既定: 0.75) */
  readonly threshold?: number;
  /** 一致レベル帯(既定: strong 0.9 / medium 0.8 / weak 0.7) */
  readonly levels?: { readonly strong: number; readonly medium: number; readonly weak: number };
}

/** レンズ 1 つ分の比較内訳(観測性・UI 表示用) */
export interface LensSimilarityBreakdownEntry {
  readonly lensId: string;
  readonly layer: LensLayer;
  /** このレンズの類似度(0〜1) */
  readonly similarity: number;
  /** 集計に使った重み(override × min(conf)) */
  readonly weight: number;
  /** 比較できた featureKey 数 */
  readonly comparedKeys: number;
  /** スキップした featureKey 数(sentinel・型不一致・skip 定義等) */
  readonly skippedKeys: number;
  readonly noteConfidence: number;
  readonly marketConfidence: number;
}

/** スナップショット比較の結果 */
export interface SnapshotSimilarityResult {
  /** 比較が成立したか(false なら score/level は null) */
  readonly comparable: boolean;
  /** 類似度スコア(0〜1)。比較不能時は null */
  readonly score: number | null;
  /** 一致レベル。比較不能時は null */
  readonly level: SimilarityMatchLevel | null;
  /** score >= threshold か(比較不能時は false) */
  readonly triggered: boolean;
  /** 適用したしきい値 */
  readonly threshold: number;
  /** 適用したプリセット */
  readonly preset: LensWeightPreset;
  /** 両スナップショットに共通して存在した lensId 数 */
  readonly commonLensCount: number;
  /** 実際に比較に寄与したレンズの内訳 */
  readonly breakdown: ReadonlyArray<LensSimilarityBreakdownEntry>;
  /** 比較不能時の理由コード(MatchingPipelineRun.skipReasons に流せる形) */
  readonly skipReason?: 'no_common_lenses' | 'no_comparable_lenses';
}

/**
 * 2 つの LensSnapshot の類似度を計算する(§6.1 のメイン入口)。
 *
 * note 側・market 側どちらが欠けたレンズもスキップされる。
 * 戻り値の breakdown は「なぜこのスコアになったか」の説明可能性を担保する。
 */
export function compareLensSnapshots(
  note: NoteLensSnapshot,
  market: NoteLensSnapshot,
  options?: SnapshotSimilarityOptions
): SnapshotSimilarityResult {
  const preset = options?.preset ?? DEFAULT_WEIGHT_PRESET;
  const threshold = options?.threshold ?? DEFAULT_SIMILARITY_TRIGGER_THRESHOLD;
  const levels = options?.levels ?? DEFAULT_SIMILARITY_LEVELS;
  const overrides = options?.lensWeightOverrides ?? {};

  const commonLensIds = Object.keys(note.lenses).filter((lensId) =>
    Object.prototype.hasOwnProperty.call(market.lenses, lensId)
  );

  if (commonLensIds.length === 0) {
    return notComparable(preset, threshold, 0, 'no_common_lenses');
  }

  const breakdown: LensSimilarityBreakdownEntry[] = [];

  for (const lensId of commonLensIds.sort()) {
    const noteEntry = note.lenses[lensId];
    const marketEntry = market.lenses[lensId];
    const confidenceWeight = Math.min(noteEntry.confidence, marketEntry.confidence);
    if (confidenceWeight <= 0) {
      continue;
    }
    const override = overrides[lensId] ?? 1;
    if (!(override > 0)) {
      continue;
    }
    const lensResult = compareLensFeatures(lensId, noteEntry.features, marketEntry.features);
    if (lensResult === null) {
      continue;
    }
    breakdown.push({
      lensId,
      layer: getLensLayer(lensId),
      similarity: lensResult.similarity,
      weight: override * confidenceWeight,
      comparedKeys: lensResult.comparedKeys,
      skippedKeys: lensResult.skippedKeys,
      noteConfidence: noteEntry.confidence,
      marketConfidence: marketEntry.confidence,
    });
  }

  if (breakdown.length === 0) {
    return notComparable(preset, threshold, commonLensIds.length, 'no_comparable_lenses');
  }

  // 層内加重平均 → 層間プリセット加重平均の 2 段集計
  const layerWeights = LAYER_WEIGHT_PRESETS[preset];
  let layerWeightedSum = 0;
  let layerWeightTotal = 0;
  for (const layer of ['state', 'indicator'] as const) {
    const entries = breakdown.filter((entry) => entry.layer === layer);
    if (entries.length === 0) {
      continue;
    }
    const weightSum = entries.reduce((sum, entry) => sum + entry.weight, 0);
    if (weightSum <= 0) {
      continue;
    }
    const layerScore =
      entries.reduce((sum, entry) => sum + entry.similarity * entry.weight, 0) / weightSum;
    layerWeightedSum += layerScore * layerWeights[layer];
    layerWeightTotal += layerWeights[layer];
  }

  if (layerWeightTotal <= 0) {
    return notComparable(preset, threshold, commonLensIds.length, 'no_comparable_lenses');
  }

  const score = clamp01(layerWeightedSum / layerWeightTotal);
  return {
    comparable: true,
    score,
    level: resolveMatchLevel(score, levels),
    triggered: score >= threshold,
    threshold,
    preset,
    commonLensCount: commonLensIds.length,
    breakdown,
  };
}

/** スコア → 一致レベル(strong/medium/weak/none) */
export function resolveMatchLevel(
  score: number,
  levels: { readonly strong: number; readonly medium: number; readonly weak: number } =
    DEFAULT_SIMILARITY_LEVELS
): SimilarityMatchLevel {
  if (score >= levels.strong) {
    return 'strong';
  }
  if (score >= levels.medium) {
    return 'medium';
  }
  if (score >= levels.weak) {
    return 'weak';
  }
  return 'none';
}

/** レンズ単位比較の戻り値 */
interface LensFeatureComparisonResult {
  readonly similarity: number;
  readonly comparedKeys: number;
  readonly skippedKeys: number;
}

/**
 * レンズ単位の類似度(§6.2)。
 * 両側に存在する featureKey を比較定義に従って部分類似度化し、レンズ内で平均する。
 * 比較できたキーが 0 のレンズは null(集計から除外)。
 */
export function compareLensFeatures(
  lensId: string,
  noteFeatures: Readonly<Record<string, number | string | boolean>>,
  marketFeatures: Readonly<Record<string, number | string | boolean>>,
  definitionOverride?: Readonly<Record<string, FeatureComparator>>
): LensFeatureComparisonResult | null {
  const definition = definitionOverride ?? getLensComparisonDefinition(lensId)?.features;

  let sum = 0;
  let compared = 0;
  let skipped = 0;

  for (const key of Object.keys(noteFeatures)) {
    if (!Object.prototype.hasOwnProperty.call(marketFeatures, key)) {
      skipped += 1;
      continue;
    }
    const noteValue = noteFeatures[key];
    const marketValue = marketFeatures[key];
    const comparator = resolveComparator(definition, key, noteValue);
    if (comparator === null) {
      skipped += 1;
      continue;
    }
    const similarity = compareFeatureValue(comparator, noteValue, marketValue);
    if (similarity === null) {
      skipped += 1;
      continue;
    }
    sum += similarity;
    compared += 1;
  }

  if (compared === 0) {
    return null;
  }
  return { similarity: clamp01(sum / compared), comparedKeys: compared, skippedKeys: skipped };
}

/**
 * featureKey の comparator を解決する。
 * カタログ未定義キーのフォールバック: boolean のみ一致/不一致で比較し、
 * 数値・文字列は意味が保証できないため比較しない(加算的拡張時にカタログへ追記する)。
 */
function resolveComparator(
  definition: Readonly<Record<string, FeatureComparator>> | undefined,
  key: string,
  noteValue: number | string | boolean
): FeatureComparator | null {
  const fromCatalog = definition ? definition[key] : undefined;
  if (fromCatalog) {
    return fromCatalog.kind === 'skip' ? null : fromCatalog;
  }
  if (typeof noteValue === 'boolean') {
    return { kind: 'bool' };
  }
  return null;
}

/**
 * featureKey 1 つ分の部分類似度(§6.2 の型別ルール)。
 * null = このキーは比較不能(型不一致・sentinel・未知 enum 値)としてスキップ。
 */
export function compareFeatureValue(
  comparator: FeatureComparator,
  noteValue: number | string | boolean,
  marketValue: number | string | boolean
): number | null {
  switch (comparator.kind) {
    case 'skip':
      return null;

    case 'bool': {
      if (typeof noteValue !== 'boolean' || typeof marketValue !== 'boolean') {
        return null;
      }
      return noteValue === marketValue ? 1 : 0;
    }

    case 'linear': {
      if (!isFiniteNumber(noteValue) || !isFiniteNumber(marketValue)) {
        return null;
      }
      const range = comparator.max - comparator.min;
      if (range <= 0) {
        return null;
      }
      const a = clamp(noteValue, comparator.min, comparator.max);
      const b = clamp(marketValue, comparator.min, comparator.max);
      return 1 - Math.abs(a - b) / range;
    }

    case 'normalizedLinear': {
      if (!isFiniteNumber(noteValue) || !isFiniteNumber(marketValue)) {
        return null;
      }
      if (
        comparator.sentinel !== undefined &&
        (noteValue === comparator.sentinel || marketValue === comparator.sentinel)
      ) {
        return null;
      }
      if (comparator.cap <= 0) {
        return null;
      }
      const a = clamp01(noteValue / comparator.cap);
      const b = clamp01(marketValue / comparator.cap);
      return 1 - Math.abs(a - b);
    }

    case 'tanhLinear': {
      if (!isFiniteNumber(noteValue) || !isFiniteNumber(marketValue)) {
        return null;
      }
      if (comparator.scale <= 0) {
        return null;
      }
      const a = Math.tanh(noteValue / comparator.scale);
      const b = Math.tanh(marketValue / comparator.scale);
      return 1 - Math.abs(a - b) / 2;
    }

    case 'orderedEnum': {
      if (typeof noteValue !== 'string' || typeof marketValue !== 'string') {
        return null;
      }
      if (
        comparator.skipValues?.includes(noteValue) ||
        comparator.skipValues?.includes(marketValue)
      ) {
        return null;
      }
      const indexA = comparator.order.indexOf(noteValue);
      const indexB = comparator.order.indexOf(marketValue);
      if (indexA < 0 || indexB < 0) {
        return null;
      }
      const maxDistance = comparator.order.length - 1;
      if (maxDistance <= 0) {
        return 1;
      }
      return 1 - Math.abs(indexA - indexB) / maxDistance;
    }

    case 'categoricalEnum': {
      if (typeof noteValue !== 'string' || typeof marketValue !== 'string') {
        return null;
      }
      if (
        comparator.skipValues?.includes(noteValue) ||
        comparator.skipValues?.includes(marketValue)
      ) {
        return null;
      }
      if (noteValue === marketValue) {
        return 1;
      }
      const fromTable = comparator.table?.[noteValue]?.[marketValue];
      return fromTable !== undefined ? clamp01(fromTable) : 0;
    }

    case 'event': {
      if (typeof noteValue !== 'string' || typeof marketValue !== 'string') {
        return null;
      }
      if (!isEventValue(noteValue) || !isEventValue(marketValue)) {
        return null;
      }
      if (noteValue === marketValue) {
        // 同方向 = 1、none 同士 = 0.5(§6.2 の表どおり)
        return noteValue === 'none' ? 0.5 : 1;
      }
      if (noteValue === 'none' || marketValue === 'none') {
        return 0.25;
      }
      return 0;
    }

    case 'cyclic': {
      if (!isFiniteNumber(noteValue) || !isFiniteNumber(marketValue)) {
        return null;
      }
      if (comparator.modulo <= 0) {
        return null;
      }
      const half = comparator.modulo / 2;
      const rawDistance = Math.abs(noteValue - marketValue) % comparator.modulo;
      const distance = Math.min(rawDistance, comparator.modulo - rawDistance);
      return 1 - distance / half;
    }
  }
}

// ============================================================
// 内部ヘルパ
// ============================================================

/** 比較不能の結果を組み立てる */
function notComparable(
  preset: LensWeightPreset,
  threshold: number,
  commonLensCount: number,
  skipReason: 'no_common_lenses' | 'no_comparable_lenses'
): SnapshotSimilarityResult {
  return {
    comparable: false,
    score: null,
    level: null,
    triggered: false,
    threshold,
    preset,
    commonLensCount,
    breakdown: [],
    skipReason,
  };
}

function isFiniteNumber(value: number | string | boolean): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isEventValue(value: string): value is 'bull' | 'none' | 'bear' {
  return value === 'bull' || value === 'none' || value === 'bear';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
