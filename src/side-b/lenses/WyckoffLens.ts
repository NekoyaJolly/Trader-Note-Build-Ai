/**
 * WyckoffLens - Wyckoff phase / signal 検出レンズ (Phase 7c)
 *
 * 設計原則 (CLAUDE.md / AGENTS.md ドメイン原則 §4): 副作用なし / 他レンズ非依存 / 決定性あり。
 *
 * **実装ポリシー (Phase 7a SMCLens / 7b ChartPatternLens と同パターン)**:
 * - 真実は **analysis-engine `compute_wyckoff_phases`** (`wyckoff.py`)
 *   (= 本格 BT で使われる pandas/numpy 実装)。
 * - Side-B の進化ループは `EvolutionLoop` が世代開始時に
 *   `/v1/indicator-series` (`includeWyckoff: true`) で取得し、
 *   `LensInput.precomputedWyckoffPhases` 経由で本 lens に渡す。
 * - `precomputedWyckoffPhases` 未指定なら sentinel features + confidence 0 を返す。
 *
 * **SMC context 活用**: analysis-engine 側 `compute_wyckoff_phases(df, smc_context)`
 * は **SMC structures (Phase 7a) を optional input** として受け取り、BOS / CHOCH
 * 情報で phase 判定の精度を高める。本 lens は payload を受け取るだけで、SMC 連携は
 * Python 側で完結する (= side-b lens 間結合は発生しない、レンズ独立性遵守)。
 *
 * 設計書: `docs/design/phase_7_specification.md` §5.4
 * 関連: `docs/design/phase_7c_wyckoff_notes.md` (実測結果)
 */

import type { Lens, LensFeature, LensInput, WyckoffPhasesPayload } from './types';

/**
 * WyckoffLens の features key 一覧 (`LensFeature.features` の Record key)。
 *
 * `LensFeature.features` の型制約 (`Record<string, number | string | boolean>`、
 * null 不可、配列不可) に合わせ、すべて scalar 型のみで構成する。
 */
export const WYCKOFF_LENS_FEATURE_KEYS = [
  'wyckoff_phase',
  'wyckoff_phase_confidence',
  'spring_detected_in_last_20_bars',
  'upthrust_detected_in_last_20_bars',
  'last_sos_bars_ago',
  'last_sow_bars_ago',
] as const;

export class WyckoffLens implements Lens {
  readonly name = 'wyckoff';
  readonly version = '1.0.0';
  // `compute` 内では `precomputedWyckoffPhases` のみを参照する。`ohlcvBars` は
  // 上位層 (= analysis-engine 側) で計算済みの payload を作る前提のため、
  // 本 lens の dependencies には含めない (Phase 7a / 7b と同方針)。
  readonly dependencies = ['symbol', 'precomputedWyckoffPhases'] as const;

  // eslint-disable-next-line @typescript-eslint/require-await
  async compute(input: LensInput): Promise<LensFeature> {
    const start = Date.now();
    const computedAt = new Date();
    const payload = input.precomputedWyckoffPhases;

    if (payload === undefined) {
      return {
        lensName: this.name,
        lensVersion: this.version,
        features: emptyWyckoffFeatures(),
        computedAt,
        computeDurationMs: Date.now() - start,
        confidence: 0,
      };
    }

    return {
      lensName: this.name,
      lensVersion: this.version,
      features: wyckoffPayloadToFeatures(payload),
      computedAt,
      computeDurationMs: Date.now() - start,
      // phase が UNKNOWN なら confidence 0、それ以外は payload.wyckoffPhaseConfidence
      confidence: payload.wyckoffPhase === 'UNKNOWN' ? 0 : payload.wyckoffPhaseConfidence,
    };
  }
}

/**
 * `WyckoffPhasesPayload` を `LensFeature.features` 形式にマッピングする。
 */
export function wyckoffPayloadToFeatures(
  payload: WyckoffPhasesPayload,
): Record<string, number | string | boolean> {
  return {
    wyckoff_phase: payload.wyckoffPhase,
    wyckoff_phase_confidence: payload.wyckoffPhaseConfidence,
    spring_detected_in_last_20_bars: payload.springDetectedInLast20Bars,
    upthrust_detected_in_last_20_bars: payload.upthrustDetectedInLast20Bars,
    last_sos_bars_ago: payload.lastSosBarsAgo,
    last_sow_bars_ago: payload.lastSowBarsAgo,
  };
}

/**
 * payload 未指定時の sentinel features。
 *
 * **設計方針 (Phase 7a SMCLens / 7b ChartPatternLens の sentinel 設計を踏襲)**:
 *
 * | feature | 実データ値 | sentinel | 区別可? |
 * |---|---|---|---|
 * | wyckoff_phase | 7 値のうち 1 つ | 'UNKNOWN' (= 判定材料不足と意味共通) | △ |
 * | wyckoff_phase_confidence | 0.0-1.0 | 0 | △ (UNKNOWN 時も 0 になる) |
 * | spring_detected_in_last_20_bars | true / false | false (= 検出なしと意味共通) | △ |
 * | upthrust_detected_in_last_20_bars | true / false | false | △ |
 * | last_sos_bars_ago | 0 以上 | **-1** (sentinel) | ✅ |
 * | last_sow_bars_ago | 0 以上 | **-1** | ✅ |
 *
 * △ 印は実データと意味的に共通だが、`confidence === 0` + scalar `last_sos_bars_ago === -1`
 * の組合せで payload 未指定を判定できる。完全な区別が必要な DSL 用途では
 * **`confidence === 0` で判定**を推奨。
 */
function emptyWyckoffFeatures(): Record<string, number | string | boolean> {
  return {
    wyckoff_phase: 'UNKNOWN',
    wyckoff_phase_confidence: 0,
    spring_detected_in_last_20_bars: false,
    upthrust_detected_in_last_20_bars: false,
    last_sos_bars_ago: -1,
    last_sow_bars_ago: -1,
  };
}
