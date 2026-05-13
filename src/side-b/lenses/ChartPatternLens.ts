/**
 * ChartPatternLens - Chart Pattern (N-bar 構造) 検出レンズ (Phase 7b)
 *
 * 設計原則 (CLAUDE.md / AGENTS.md ドメイン原則 §4): 副作用なし / 他レンズ非依存 / 決定性あり。
 *
 * **実装ポリシー (PatternLens / SMCLens (Phase 7a) と同パターン)**:
 * - 真実は **analysis-engine `compute_chart_patterns`** (`chart_patterns.py`)
 *   (= 本格 BT で使われる pandas/numpy 実装)。
 * - Side-B の進化ループは `EvolutionLoop` が世代開始時に
 *   `/v1/indicator-series` (`includeChartPatterns: true`) で取得し、
 *   `LensInput.precomputedChartPatterns` 経由で本 lens に渡す。
 * - 本 lens は `LensInput` の OHLCV から chart pattern を再計算しない
 *   (= TS 側で重複実装しない)。
 * - `precomputedChartPatterns` 未指定なら sentinel features + confidence 0 を返す。
 *
 * **「Pattern」(ローソク足、既存 PatternLens) と「Chart Pattern」(本 lens) の階層**
 * (user 哲学 2026-05-14):
 * - `lensName: 'pattern'` (既存 PatternLens) = ローソク足 = 基本
 * - `lensName: 'chart_pattern'` (本 lens) = N-bar 構造 = 応用 / 組み合わせ
 *
 * 命名階層が `lensName` に直接表れるため、rename は不要 (user 判断、Phase 7b 着手前)。
 *
 * 設計書: `docs/design/phase_7_specification.md` §5.2
 * 関連: `docs/design/phase_7b_chart_pattern_notes.md` (実測結果)
 */

import type { ChartPatternsPayload, Lens, LensFeature, LensInput } from './types';

/**
 * ChartPatternLens の features key 一覧 (`LensFeature.features` の Record key)。
 *
 * `LensFeature.features` の型制約 (`Record<string, number | string | boolean>`、
 * null 不可、配列不可) に合わせ、すべて scalar 型のみで構成する。
 */
export const CHART_PATTERN_LENS_FEATURE_KEYS = [
  'pattern_detected',
  'pattern_confidence',
  'pattern_break_imminent',
  'pattern_bars_count',
  'pattern_direction_bias',
] as const;

export class ChartPatternLens implements Lens {
  readonly name = 'chart_pattern';
  readonly version = '1.0.0';
  // `compute` 内では `precomputedChartPatterns` のみを参照する。`ohlcvBars` は
  // 上位層 (= analysis-engine 側) で計算済みの payload を作る前提のため、
  // 本 lens の dependencies には含めない (Phase 7a SMCLens Copilot review #186 と同方針)。
  readonly dependencies = ['symbol', 'precomputedChartPatterns'] as const;

  // eslint-disable-next-line @typescript-eslint/require-await
  async compute(input: LensInput): Promise<LensFeature> {
    const start = Date.now();
    const computedAt = new Date();
    const payload = input.precomputedChartPatterns;

    if (payload === undefined) {
      return {
        lensName: this.name,
        lensVersion: this.version,
        features: emptyChartPatternFeatures(),
        computedAt,
        computeDurationMs: Date.now() - start,
        confidence: 0,
      };
    }

    return {
      lensName: this.name,
      lensVersion: this.version,
      features: payloadToFeatures(payload),
      computedAt,
      computeDurationMs: Date.now() - start,
      // パターン検出失敗時 (NONE) は confidence 0、それ以外は payload.patternConfidence
      confidence: payload.patternDetected === 'NONE' ? 0 : payload.patternConfidence,
    };
  }
}

/**
 * `ChartPatternsPayload` を `LensFeature.features` 形式にマッピングする。
 */
function payloadToFeatures(
  payload: ChartPatternsPayload,
): Record<string, number | string | boolean> {
  return {
    pattern_detected: payload.patternDetected,
    pattern_confidence: payload.patternConfidence,
    pattern_break_imminent: payload.patternBreakImminent,
    pattern_bars_count: payload.patternBarsCount,
    pattern_direction_bias: payload.patternDirectionBias,
  };
}

/**
 * payload 未指定時の sentinel features。
 *
 * **設計方針 (Phase 7a SMCLens sentinel 設計 PR #186 を踏襲)**:
 *
 * payload なしと実データの「パターンなし (NONE)」を区別したいが、本 lens の
 * `patternDetected` は payload 側でも `'NONE'` を取り得るため、enum 系では完全な
 * 区別は不可能。**`confidence === 0` で payload 未指定を判定**する想定。
 *
 * その他の scalar features:
 * - `pattern_bars_count: 0` ... 実データの「形成 0 バー」と sentinel が衝突するが、
 *   `pattern_bars_count > 0` なら確実に「実データ」であることが分かる。
 * - `pattern_break_imminent: false` ... 実データの「imminent でない」と共通だが、
 *   imminent=true は payload あり時のみ発生するため非対称的な情報量は持つ。
 *
 * 完全な区別が必要な DSL 用途では **`confidence === 0` で判定**する。
 */
function emptyChartPatternFeatures(): Record<string, number | string | boolean> {
  return {
    pattern_detected: 'NONE',
    pattern_confidence: 0,
    pattern_break_imminent: false,
    pattern_bars_count: 0,
    pattern_direction_bias: 'NEUTRAL',
  };
}
