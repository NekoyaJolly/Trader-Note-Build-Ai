/**
 * SMCLens - SMC (Smart Money Concept) 構造観測レンズ (Phase 7a)
 *
 * 設計原則 (CLAUDE.md / AGENTS.md ドメイン原則 §4): 副作用なし / 他レンズ非依存 / 決定性あり。
 *
 * **実装ポリシー (PatternLens / PR ④F と同パターン)**:
 * - 真実は **analysis-engine `compute_smc_structures`** (`smc.py`)
 *   (= 本格 BT で使われる pandas/numpy 実装)。
 * - Side-B の進化ループは `EvolutionLoop` が世代開始時に
 *   `/v1/indicator-series` (`includeSmc: true`) で取得し、`LensInput.precomputedSmcStructures`
 *   経由で本 lens に渡す。
 * - 本 lens は `LensInput` の OHLCV から SMC を再計算しない (= TS 側で重複実装しない)。
 * - `precomputedSmcStructures` 未指定なら sentinel features + confidence 0 を返す。
 *
 * 設計書: `docs/design/phase_7_specification.md` §5.1
 * 関連: `docs/design/phase_7a_smc_notes.md` (実測結果)
 */

import type { Lens, LensFeature, LensInput, SmcStructuresPayload } from './types';

/**
 * SMCLens の features key 一覧 (`LensFeature.features` の Record key)。
 *
 * `LensFeature.features` の型制約 (`Record<string, number | string | boolean>`、
 * null 不可、配列不可) に合わせ、すべて scalar 型のみで構成する。「なし」は
 * sentinel (`-1.0` / `-1` / `'NONE'`) で表現 (`SmcStructuresPayload` と同方針)。
 */
export const SMC_LENS_FEATURE_KEYS = [
  'nearest_ob_bull_distance_pips',
  'nearest_ob_bear_distance_pips',
  'liquidity_above_count',
  'liquidity_below_count',
  'fvg_bull_count_last_20',
  'fvg_bear_count_last_20',
  'last_structure_event',
  'bars_since_last_structure_event',
  'current_zone',
  'zone_position_pct',
] as const;

export class SMCLens implements Lens {
  readonly name = 'smc';
  readonly version = '1.0.0';
  // `compute` 内では `precomputedSmcStructures` のみを参照する。`ohlcvBars` は
  // 上位層 (= analysis-engine 側) で SMC 計算済みの payload を作る前提のため、
  // 本 lens の dependencies には含めない (Copilot review PR #186 指摘で修正)。
  readonly dependencies = ['symbol', 'precomputedSmcStructures'] as const;

  // eslint-disable-next-line @typescript-eslint/require-await
  async compute(input: LensInput): Promise<LensFeature> {
    const start = Date.now();
    const computedAt = new Date();
    const payload = input.precomputedSmcStructures;

    if (payload === undefined) {
      // 上位層が SMC payload を渡さなかった場合は sentinel features + confidence 0 を返す
      return {
        lensName: this.name,
        lensVersion: this.version,
        features: emptySmcFeatures(),
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
      confidence: 1.0,
    };
  }
}

/**
 * `SmcStructuresPayload` を `LensFeature.features` (`Record<string, number | string | boolean>`)
 * 形式にマッピングする。snake_case key で TS 側 SMCLens features の標準を確立する。
 */
function payloadToFeatures(
  payload: SmcStructuresPayload,
): Record<string, number | string | boolean> {
  return {
    nearest_ob_bull_distance_pips: payload.nearestObBullDistancePips,
    nearest_ob_bear_distance_pips: payload.nearestObBearDistancePips,
    liquidity_above_count: payload.liquidityAboveCount,
    liquidity_below_count: payload.liquidityBelowCount,
    fvg_bull_count_last_20: payload.fvgBullCountLast20,
    fvg_bear_count_last_20: payload.fvgBearCountLast20,
    last_structure_event: payload.lastStructureEvent,
    bars_since_last_structure_event: payload.barsSinceLastStructureEvent,
    current_zone: payload.currentZone,
    zone_position_pct: payload.zonePositionPct,
  };
}

/**
 * payload 未指定時の sentinel features。
 *
 * **設計方針 (Copilot review PR #186 指摘で改善)**:
 *
 * SMC features は **「payload なし」と「実データの 0 / 中央値」を区別できるよう sentinel
 * を設計する**。具体的:
 *
 * | feature | 実データの最小値 | sentinel | 区別可? |
 * |---|---|---|---|
 * | nearest_ob_*_distance_pips | 0.0 (= 同バー) | -1.0 | ✅ |
 * | liquidity_*_count | 0 (= 実データの「なし」) | -1 (= payload 未指定) | ✅ |
 * | fvg_*_count_last_20 | 0 | -1 | ✅ |
 * | last_structure_event | 'NONE' (= 実データの「なし」) | 'NONE' (共通、意味も同じ) | △ |
 * | bars_since_last_structure_event | 0 (= 同バー) | -1 | ✅ |
 * | current_zone | 'EQUILIBRIUM' (= 実データの中央) | 'EQUILIBRIUM' (共通) | △ |
 * | zone_position_pct | 0.0 〜 1.0 | -1.0 (range 外) | ✅ |
 *
 * △ 印 (`last_structure_event` / `current_zone`) は sentinel と実データ値が共通になるが、
 * 意味的に「直近イベントなし」「ニュートラルな zone」を指す点で整合しているため許容。
 * 完全な区別が必要な DSL 用途では **`confidence === 0` で判定**するか、上記 ✅ 印の
 * scalar features (例: `bars_since_last_structure_event === -1`) で payload 未指定を
 * 検出する。
 */
function emptySmcFeatures(): Record<string, number | string | boolean> {
  return {
    nearest_ob_bull_distance_pips: -1.0,
    nearest_ob_bear_distance_pips: -1.0,
    liquidity_above_count: -1,
    liquidity_below_count: -1,
    fvg_bull_count_last_20: -1,
    fvg_bear_count_last_20: -1,
    last_structure_event: 'NONE',
    bars_since_last_structure_event: -1,
    current_zone: 'EQUILIBRIUM',
    zone_position_pct: -1.0,
  };
}
