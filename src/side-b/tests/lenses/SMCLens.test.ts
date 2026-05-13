/**
 * SMCLens 単体テスト (Phase 7a)
 *
 * 設計書: docs/design/phase_7_specification.md §5.1 / §6.1 (Phase 7a DoD)
 *
 * 検証項目 (Phase 7a §6.1 DoD):
 * 1. SMCLens が Lens interface を実装している
 * 2. payload 未指定時に sentinel features + confidence 0 を返す
 * 3. payload 指定時に正しく features にマッピングされる
 * 4. 全 10 features (§5.1) が出力される
 * 5. 決定論性 (同入力 → 同出力)
 * 6. features 型制約遵守 (number / string / boolean のみ、null / array なし)
 * 7. sentinel value の扱い (-1.0 / -1 / 'NONE')
 * 8. edge case (極端な payload 値)
 */

import { SMCLens, SMC_LENS_FEATURE_KEYS } from '../../lenses/SMCLens';
import type { LensInput, SmcStructuresPayload } from '../../lenses/types';

// ============================================================================
// テスト用 payload ファクトリ
// ============================================================================

function makeFullPayload(overrides: Partial<SmcStructuresPayload> = {}): SmcStructuresPayload {
  return {
    nearestObBullDistancePips: 12.5,
    nearestObBearDistancePips: 8.3,
    liquidityAboveCount: 3,
    liquidityBelowCount: 2,
    fvgBullCountLast20: 4,
    fvgBearCountLast20: 1,
    lastStructureEvent: 'BOS_BULL',
    barsSinceLastStructureEvent: 7,
    currentZone: 'PREMIUM',
    zonePositionPct: 0.72,
    ...overrides,
  };
}

function makeMinimalInput(payload?: SmcStructuresPayload): LensInput {
  return {
    symbol: 'XAUUSD',
    timeframe: '15m',
    timestamp: new Date('2026-05-14T00:00:00Z'),
    precomputedSmcStructures: payload,
  };
}

// ============================================================================
// テストケース
// ============================================================================

describe('SMCLens: Lens interface 実装', () => {
  it('Lens interface のメタデータが正しい', () => {
    const lens = new SMCLens();
    expect(lens.name).toBe('smc');
    expect(lens.version).toBe('1.0.0');
    expect(lens.dependencies).toEqual(['symbol', 'precomputedSmcStructures']);
  });

  it('SMC_LENS_FEATURE_KEYS が 10 個 (§5.1 仕様通り)', () => {
    expect(SMC_LENS_FEATURE_KEYS.length).toBe(10);
  });
});

describe('SMCLens: payload 未指定時 (sentinel + confidence 0)', () => {
  it('precomputedSmcStructures が undefined なら confidence: 0', async () => {
    const lens = new SMCLens();
    const result = await lens.compute(makeMinimalInput(undefined));
    expect(result.confidence).toBe(0);
    expect(result.lensName).toBe('smc');
    expect(result.lensVersion).toBe('1.0.0');
  });

  it('payload 未指定時の features は全 10 keys を sentinel 値で埋める', async () => {
    const lens = new SMCLens();
    const result = await lens.compute(makeMinimalInput(undefined));
    expect(Object.keys(result.features).sort()).toEqual([...SMC_LENS_FEATURE_KEYS].sort());

    // sentinel 設計 (Copilot review PR #186 で改善):
    // payload なしと実データの 0 / 中央値を区別できる sentinel 値を採用
    expect(result.features.nearest_ob_bull_distance_pips).toBe(-1.0);
    expect(result.features.nearest_ob_bear_distance_pips).toBe(-1.0);
    expect(result.features.liquidity_above_count).toBe(-1); // 実データ 0 と区別
    expect(result.features.liquidity_below_count).toBe(-1);
    expect(result.features.fvg_bull_count_last_20).toBe(-1);
    expect(result.features.fvg_bear_count_last_20).toBe(-1);
    expect(result.features.last_structure_event).toBe('NONE'); // 実データの「なし」と意味共通
    expect(result.features.bars_since_last_structure_event).toBe(-1);
    expect(result.features.current_zone).toBe('EQUILIBRIUM'); // 実データの中央と意味共通
    expect(result.features.zone_position_pct).toBe(-1.0); // 実データ範囲 [0, 1] 外で区別
  });

  it('sentinel 設計: payload なし時の count 系 / zone_position_pct は実データの 0 / 0.5 と区別可', async () => {
    const lens = new SMCLens();

    // payload なし時
    const emptyResult = await lens.compute(makeMinimalInput(undefined));
    expect(emptyResult.confidence).toBe(0);

    // 実データで count 0 / zone 中央 0.5 を持つ payload
    const realDataPayload = makeFullPayload({
      liquidityAboveCount: 0,
      liquidityBelowCount: 0,
      fvgBullCountLast20: 0,
      fvgBearCountLast20: 0,
      zonePositionPct: 0.5,
      currentZone: 'EQUILIBRIUM',
    });
    const realResult = await lens.compute(makeMinimalInput(realDataPayload));
    expect(realResult.confidence).toBe(1.0);

    // confidence !== の他、scalar feature でも区別可能
    expect(emptyResult.features.liquidity_above_count).toBe(-1);
    expect(realResult.features.liquidity_above_count).toBe(0);
    expect(emptyResult.features.zone_position_pct).toBe(-1.0);
    expect(realResult.features.zone_position_pct).toBe(0.5);
  });
});

describe('SMCLens: payload 指定時 (features マッピング)', () => {
  it('payload の全フィールドが features に正しくマッピングされる', async () => {
    const lens = new SMCLens();
    const payload = makeFullPayload();
    const result = await lens.compute(makeMinimalInput(payload));

    expect(result.confidence).toBe(1.0);
    expect(result.features.nearest_ob_bull_distance_pips).toBe(12.5);
    expect(result.features.nearest_ob_bear_distance_pips).toBe(8.3);
    expect(result.features.liquidity_above_count).toBe(3);
    expect(result.features.liquidity_below_count).toBe(2);
    expect(result.features.fvg_bull_count_last_20).toBe(4);
    expect(result.features.fvg_bear_count_last_20).toBe(1);
    expect(result.features.last_structure_event).toBe('BOS_BULL');
    expect(result.features.bars_since_last_structure_event).toBe(7);
    expect(result.features.current_zone).toBe('PREMIUM');
    expect(result.features.zone_position_pct).toBe(0.72);
  });

  it('payload の features 数が SMC_LENS_FEATURE_KEYS と一致', async () => {
    const lens = new SMCLens();
    const result = await lens.compute(makeMinimalInput(makeFullPayload()));
    expect(Object.keys(result.features).length).toBe(SMC_LENS_FEATURE_KEYS.length);
  });
});

describe('SMCLens: features 型制約遵守', () => {
  it('features の全 value は number / string / boolean のみ (null / array なし)', async () => {
    const lens = new SMCLens();
    const result = await lens.compute(makeMinimalInput(makeFullPayload()));
    for (const [key, value] of Object.entries(result.features)) {
      const valueType = typeof value;
      expect(valueType === 'number' || valueType === 'string' || valueType === 'boolean').toBe(
        true,
      );
      expect(value).not.toBeNull();
      expect(Array.isArray(value)).toBe(false);
      // SMC では現状 boolean features は無い (= 全 number / string)
      if (valueType !== 'number' && valueType !== 'string') {
        throw new Error(`Unexpected boolean feature: ${key}`);
      }
    }
  });

  it('JSON.stringify で全 features が serializable', async () => {
    const lens = new SMCLens();
    const result = await lens.compute(makeMinimalInput(makeFullPayload()));
    const json = JSON.stringify(result.features);
    expect(json).toBeDefined();
    expect(JSON.parse(json)).toEqual(result.features);
  });
});

describe('SMCLens: sentinel value の扱い', () => {
  it('payload で OB なし (nearestObBullDistancePips=-1.0) はそのまま features へ', async () => {
    const lens = new SMCLens();
    const payload = makeFullPayload({
      nearestObBullDistancePips: -1.0,
      nearestObBearDistancePips: -1.0,
    });
    const result = await lens.compute(makeMinimalInput(payload));
    expect(result.features.nearest_ob_bull_distance_pips).toBe(-1.0);
    expect(result.features.nearest_ob_bear_distance_pips).toBe(-1.0);
  });

  it('payload で structure event なし (lastStructureEvent=NONE) はそのまま features へ', async () => {
    const lens = new SMCLens();
    const payload = makeFullPayload({
      lastStructureEvent: 'NONE',
      barsSinceLastStructureEvent: -1,
    });
    const result = await lens.compute(makeMinimalInput(payload));
    expect(result.features.last_structure_event).toBe('NONE');
    expect(result.features.bars_since_last_structure_event).toBe(-1);
  });

  it('全 structure event 種別が許容される', async () => {
    const lens = new SMCLens();
    const events: Array<SmcStructuresPayload['lastStructureEvent']> = [
      'BOS_BULL',
      'BOS_BEAR',
      'CHOCH_BULL',
      'CHOCH_BEAR',
      'NONE',
    ];
    for (const ev of events) {
      const payload = makeFullPayload({ lastStructureEvent: ev });
      const result = await lens.compute(makeMinimalInput(payload));
      expect(result.features.last_structure_event).toBe(ev);
    }
  });

  it('全 zone 種別が許容される', async () => {
    const lens = new SMCLens();
    const zones: Array<SmcStructuresPayload['currentZone']> = [
      'PREMIUM',
      'DISCOUNT',
      'EQUILIBRIUM',
    ];
    for (const z of zones) {
      const payload = makeFullPayload({ currentZone: z });
      const result = await lens.compute(makeMinimalInput(payload));
      expect(result.features.current_zone).toBe(z);
    }
  });
});

describe('SMCLens: 決定論性 (同入力 → 同出力)', () => {
  it('同じ payload を 2 回 compute して features が同一', async () => {
    const lens = new SMCLens();
    const payload = makeFullPayload();
    const r1 = await lens.compute(makeMinimalInput(payload));
    const r2 = await lens.compute(makeMinimalInput(payload));
    expect(r1.features).toEqual(r2.features);
  });

  it('payload 未指定でも 2 回 compute して features が同一 (sentinel 値の安定性)', async () => {
    const lens = new SMCLens();
    const r1 = await lens.compute(makeMinimalInput(undefined));
    const r2 = await lens.compute(makeMinimalInput(undefined));
    expect(r1.features).toEqual(r2.features);
  });
});

describe('SMCLens: edge case', () => {
  it('zonePositionPct 境界値 (0.0 / 1.0) で features に正しく反映', async () => {
    const lens = new SMCLens();
    const r1 = await lens.compute(
      makeMinimalInput(makeFullPayload({ zonePositionPct: 0.0, currentZone: 'DISCOUNT' })),
    );
    expect(r1.features.zone_position_pct).toBe(0.0);

    const r2 = await lens.compute(
      makeMinimalInput(makeFullPayload({ zonePositionPct: 1.0, currentZone: 'PREMIUM' })),
    );
    expect(r2.features.zone_position_pct).toBe(1.0);
  });

  it('barsSinceLastStructureEvent が大きな値 (= 古いイベント) でも features に反映', async () => {
    const lens = new SMCLens();
    const payload = makeFullPayload({ barsSinceLastStructureEvent: 9999 });
    const result = await lens.compute(makeMinimalInput(payload));
    expect(result.features.bars_since_last_structure_event).toBe(9999);
  });

  it('liquidity count が 0 の場合も features に正しく反映 (sentinel ではない)', async () => {
    const lens = new SMCLens();
    const payload = makeFullPayload({ liquidityAboveCount: 0, liquidityBelowCount: 0 });
    const result = await lens.compute(makeMinimalInput(payload));
    expect(result.features.liquidity_above_count).toBe(0);
    expect(result.features.liquidity_below_count).toBe(0);
  });

  it('computedAt が Date 型、computeDurationMs が number で返る', async () => {
    const lens = new SMCLens();
    const result = await lens.compute(makeMinimalInput(makeFullPayload()));
    expect(result.computedAt).toBeInstanceOf(Date);
    expect(typeof result.computeDurationMs).toBe('number');
    expect(result.computeDurationMs).toBeGreaterThanOrEqual(0);
  });
});
