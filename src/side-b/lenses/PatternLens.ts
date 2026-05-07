/**
 * PatternLens - ローソク足パターンの真偽判定レンズ (PR ②-1, PR ④F で内部実装簡素化)。
 *
 * 設計原則 (CLAUDE.md 原則 4): 副作用なし / 他レンズ非依存 / 決定性あり。
 *
 * **実装ポリシー (PR ④F)**:
 * - 真実は **analysis-engine `compute_candlestick_pattern_flags` / `compute_pinbar_flags`**
 *   (= 本格 BT で使われる pandas/numpy 実装)。
 * - Side-B の進化ループは `EvolutionLoop` が世代開始時に
 *   `/v1/indicator-series` でまとめて pattern flags を取得し、surrogate に
 *   `DslSimulationOptions.patternFlagsCache` 経由で渡す。
 * - 本 lens は `LensInput` 単体からは pattern を判定しない (= TS で再計算しない)。
 *   `LensInput.precomputedPatternFlags` が指定されたとき **末尾バーの flags** を
 *   features として返すだけの薄い wrapper。
 * - 未指定 (= cache なし) なら全 false を返す。
 *
 * 旧 PR ②-1 の TS 計算経路 (`shared/patterns/index.ts` の `patternFlagsAtIndex` 等)
 * は PR ④F で撤廃。Side-B 進化以外の経路 (= 直接 PatternLens を呼ぶ箇所) では
 * 上位層が事前に flags を渡す必要がある。
 */

import { ALL_CANDLE_PATTERN_IDS, type CandlePatternId } from '../../shared/patterns';
import type { Lens, LensFeature, LensInput } from './types';

export class PatternLens implements Lens {
  readonly name = 'pattern';
  readonly version = '1.0.0';
  readonly dependencies = ['symbol', 'ohlcvBars'] as const;

  // eslint-disable-next-line @typescript-eslint/require-await
  async compute(input: LensInput): Promise<LensFeature> {
    const start = Date.now();
    const computedAt = new Date();
    const bars = input.ohlcvBars;
    // PR ④F: 上位層 (= EvolutionLoop / 呼び出し側) が事前に算出して渡す
    // pattern flag 配列。bar index ごとの 12 種 boolean 配列を Record で持つ。
    const cache = input.precomputedPatternFlags;

    if (!bars || bars.length < 1 || !cache) {
      return {
        lensName: this.name,
        lensVersion: this.version,
        features: emptyPatternFeatures(),
        computedAt,
        computeDurationMs: Date.now() - start,
        confidence: 0,
      };
    }

    // 末尾バー (= snapshot 構築時の評価対象) の flags を返す。
    const idx = bars.length - 1;
    const features = {} as Record<CandlePatternId, boolean>;
    for (const id of ALL_CANDLE_PATTERN_IDS) {
      const arr = cache[id];
      features[id] = Array.isArray(arr) && idx < arr.length ? Boolean(arr[idx]) : false;
    }

    return {
      lensName: this.name,
      lensVersion: this.version,
      features,
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
