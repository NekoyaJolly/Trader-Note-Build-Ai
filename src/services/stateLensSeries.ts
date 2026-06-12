/**
 * 状態レンズの per-bar 系列化 (レンズ条件タイプ #3 第2弾、設計書 NOTE_SIMILARITY_FOUNDATION.md §12.3)
 *
 * 責務:
 * - TS 側だけで計算可能な状態レンズ (time_session / dow_theory / volatility_regime) の特徴を
 *   「1 バー 1 値」の per-bar 系列として計算し、条件評価器のキャッシュ
 *   (`lens:<lensId>:<featureKey>`、数値エンコード済み) に載せる
 * - analysis-engine 拡張が必要な状態レンズ (smc / chart_pattern / wyckoff) は本モジュールの
 *   対象外 (第2弾後半)。pattern (ローソク足12種) は既存の PatternCondition が同機能のため対象外
 *
 * 不変条件 (lookahead 禁止、§12.2): バー i の値は bars[0..i] のみから計算する。
 * 実装上はバー i を末尾とする直近 STATE_LENS_CONTEXT_BARS 本の窓で各レンズの compute() を呼ぶ。
 * ピボット確定 (rightBars 本後) 等の「後で確定する」性質は、窓が i で終わることで
 * 構造的に未来参照できない。
 *
 * 窓幅はノート側スナップショット (lensSnapshotBuilder の DEFAULT_WINDOW_BARS=150) と同じ
 * 150 本に固定する。これにより per-bar 値は「その瞬間にスナップショットを作ったら見えたはずの
 * 状態」と一致し、柱1(ノート類似)と柱2(条件)が同じ状態definitionを共有する。
 *
 * 新規ファイルの理由: 「状態レンズの per-bar 系列化」という恒久的な独立責務
 * (lensSnapshotBuilder = 1 時点 snapshot 生成 / 本モジュール = 系列生成)。
 * 削除条件: レンズ条件タイプの廃止時。
 */

import { DowTheoryLens } from '../side-b/lenses/DowTheoryLens';
import { TimeSessionLens } from '../side-b/lenses/TimeSessionLens';
import { VolatilityRegimeLens } from '../side-b/lenses/VolatilityRegimeLens';
import type { Lens, LensInput } from '../side-b/lenses/types';
import type { LensFeatureValue } from '../shared/similarity/lensSnapshotTypes';
import {
  encodeLensFeatureValueAsNumber,
  getLensComparisonDefinition,
  getLensFeatureComparator,
} from '../shared/similarity/lensComparators';
import { makeLensCacheKey, type LensCondition } from '../backend/services/strategyConditionEvaluator';

/**
 * per-bar 計算の窓幅。lensSnapshotBuilder の DEFAULT_WINDOW_BARS と同値に保つこと
 * (ノート側スナップショットと同じ「見え方」を per-bar 値にするため。ドリフト注意)。
 */
export const STATE_LENS_CONTEXT_BARS = 150;

/** TS 側だけで per-bar 計算可能な状態レンズの lensId 集合 */
export const TS_COMPUTABLE_STATE_LENS_IDS = [
  'time_session',
  'dow_theory',
  'volatility_regime',
] as const;

export type TsComputableStateLensId = (typeof TS_COMPUTABLE_STATE_LENS_IDS)[number];

/** lensId が TS 側で per-bar 計算可能な状態レンズかどうか */
export function isTsComputableStateLensId(lensId: string): lensId is TsComputableStateLensId {
  return (TS_COMPUTABLE_STATE_LENS_IDS as readonly string[]).includes(lensId);
}

/** 評価バー (条件評価器の OHLCV / side-b の OHLCVBar と構造互換) */
export interface StateLensBar {
  readonly timestamp: Date;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
}

/** lensId → レンズ実装 (純粋関数なのでモジュール内で共有してよい) */
const STATE_LENS_INSTANCES: Record<TsComputableStateLensId, Lens> = {
  time_session: new TimeSessionLens(),
  dow_theory: new DowTheoryLens(),
  volatility_regime: new VolatilityRegimeLens(),
};

/**
 * 状態レンズ 1 つ分の特徴を per-bar 系列として計算する。
 *
 * 各バー i について「バー i を末尾とする直近 STATE_LENS_CONTEXT_BARS 本」を窓として
 * レンズの compute() を呼ぶ (= 先読みなし)。カタログ (lensComparators) に定義された
 * featureKey のみを返し、計算不能・型不一致は null (呼び出し側が条件不成立に倒す)。
 */
export async function computeStateLensFeatureSeries(
  lensId: TsComputableStateLensId,
  params: {
    symbol: string;
    timeframe: string;
    bars: ReadonlyArray<StateLensBar>;
  }
): Promise<Record<string, Array<LensFeatureValue | null>>> {
  const lens = STATE_LENS_INSTANCES[lensId];
  const definition = getLensComparisonDefinition(lensId);
  const featureKeys = definition ? Object.keys(definition.features) : [];
  const length = params.bars.length;

  const result: Record<string, Array<LensFeatureValue | null>> = {};
  for (const key of featureKeys) {
    result[key] = new Array<LensFeatureValue | null>(length).fill(null);
  }
  if (featureKeys.length === 0) {
    return result;
  }

  for (let i = 0; i < length; i += 1) {
    // バー i を末尾とする有界窓 (先読みなし。窓幅の根拠は STATE_LENS_CONTEXT_BARS 参照)
    const from = Math.max(0, i - STATE_LENS_CONTEXT_BARS + 1);
    const windowBars = params.bars.slice(from, i + 1);
    const input: LensInput = {
      symbol: params.symbol,
      timeframe: params.timeframe,
      timestamp: params.bars[i].timestamp,
      ohlcvBars: windowBars,
    };
    try {
      const feature = await lens.compute(input);
      for (const key of featureKeys) {
        const value = feature.features[key];
        result[key][i] =
          typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
            ? value
            : null;
      }
    } catch {
      // 1 バーの計算失敗 (不正 timestamp 等) は当該バーのみ null = 条件不成立に倒す
    }
  }
  return result;
}

/**
 * 状態レンズ条件 (#3 第2弾) の per-bar 系列を evaluator キャッシュに追加する。
 *
 * インジケーターレンズの appendLensSeriesToCache (strategyBacktestService) と対になる
 * 状態レンズ版。backtest / live / プレビューが同じ本関数を通ることで評価 1 経路を維持する。
 * analysis-engine は呼ばない (TS 側計算のみ)。
 *
 * - 対応レンズ: time_session / dow_theory / volatility_regime
 * - 未対応の状態レンズ (smc / chart_pattern / wyckoff = analysis-engine 拡張待ち、
 *   pattern = 既存 PatternCondition と同機能) は警告してスキップ (= 条件は不成立評価)
 */
export async function appendStateLensSeriesToCache(params: {
  indicatorCache: Map<string, number[]>;
  /** レンズ条件 (lensId のみ参照する) */
  lensConditions: ReadonlyArray<Pick<LensCondition, 'lensId'>>;
  symbol: string;
  timeframe: string;
  bars: ReadonlyArray<StateLensBar>;
}): Promise<void> {
  const stateLensIds = new Set<TsComputableStateLensId>();
  for (const condition of params.lensConditions) {
    if (condition.lensId.startsWith('ind:')) {
      continue; // インジケーターレンズは appendLensSeriesToCache の担当
    }
    if (isTsComputableStateLensId(condition.lensId)) {
      stateLensIds.add(condition.lensId);
    } else {
      console.warn(
        `[StateLensSeries] 未対応の状態レンズのため条件をスキップします (第2弾後半で対応予定): ${condition.lensId}`
      );
    }
  }

  for (const lensId of stateLensIds) {
    const featureSeries = await computeStateLensFeatureSeries(lensId, {
      symbol: params.symbol,
      timeframe: params.timeframe,
      bars: params.bars,
    });
    for (const [featureKey, values] of Object.entries(featureSeries)) {
      const comparator = getLensFeatureComparator(lensId, featureKey);
      const encoded = values.map((value) => {
        if (value === null) return Number.NaN;
        const numeric = encodeLensFeatureValueAsNumber(comparator, value);
        // エンコード不能 (skip kind 等) は欠損と同じ扱い = 条件不成立に倒す
        return numeric === null ? Number.NaN : numeric;
      });
      params.indicatorCache.set(makeLensCacheKey(lensId, featureKey), encoded);
    }
  }
}
