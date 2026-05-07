/**
 * PatternLens - ローソク足パターンの真偽判定レンズ (PR ②-1)。
 *
 * `src/shared/patterns` の TS 実装 (= Python `compute_candlestick_pattern_flags`
 * と同期) を呼び出して、現バーの 12 種パターン真偽を boolean features として
 * 返す。Side-B DSL Evaluator は `pattern.<patternId> is_true` (PR ①-B で導入
 * した op) で評価する。
 *
 * 設計原則 (CLAUDE.md 原則 4):
 * - 副作用なし / 他レンズ非依存 / 決定性あり
 * - bars が不足 (= 1 バー未満) の場合は全 false features を返す
 *
 * 真実の所在:
 * - 本格 BT (= Side-A の最終評価) は analysis-engine `compute_candlestick_pattern_flags`
 * - 本 lens は **surrogate / progressive 評価用の TS port**。Python と式が
 *   同期していることはユニットテストで担保。
 */

import {
  ALL_CANDLE_PATTERN_IDS,
  patternFlagsAtIndex,
  type CandlePatternId,
  type PatternBar,
} from '../../shared/patterns';
import type { Lens, LensFeature, LensInput } from './types';
import type { OHLCVBar } from './utils/pivotDetection';

export class PatternLens implements Lens {
  readonly name = 'pattern';
  readonly version = '1.0.0';
  readonly dependencies = ['symbol', 'ohlcvBars'] as const;

  // eslint-disable-next-line @typescript-eslint/require-await
  async compute(input: LensInput): Promise<LensFeature> {
    const start = Date.now();
    const computedAt = new Date();
    const bars = input.ohlcvBars;

    if (!bars || bars.length < 1) {
      return {
        lensName: this.name,
        lensVersion: this.version,
        features: emptyPatternFeatures(),
        computedAt,
        computeDurationMs: Date.now() - start,
        confidence: 0,
      };
    }

    // 最新バーが現バー (= snapshot 構築時の評価対象)。
    // Side-B 既存レンズ (VolatilityRegimeLens 等) と同じ慣例で末尾を採用する。
    const idx = bars.length - 1;
    const flags = patternFlagsAtIndex(toPatternBars(bars), idx);

    return {
      lensName: this.name,
      lensVersion: this.version,
      features: flags,
      computedAt,
      computeDurationMs: Date.now() - start,
      confidence: 1.0,
    };
  }
}

function emptyPatternFeatures(): Record<CandlePatternId, boolean> {
  const out = {} as Record<CandlePatternId, boolean>;
  for (const id of ALL_CANDLE_PATTERN_IDS) out[id] = false;
  return out;
}

function toPatternBars(bars: readonly OHLCVBar[]): readonly PatternBar[] {
  return bars.map((b) => ({
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
  }));
}
