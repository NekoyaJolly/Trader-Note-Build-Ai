/**
 * WyckoffLens 単体テスト (Phase 7c)
 *
 * 設計書: docs/design/phase_7_specification.md §5.4 / §6.3 (Phase 7c DoD)
 *
 * 検証項目 (Phase 7c §6.3 DoD):
 * 1. WyckoffLens が Lens interface を実装している
 * 2. payload 未指定時に sentinel features + confidence 0 を返す
 * 3. 7 種 phase 全てが features にマッピングされる
 * 4. UNKNOWN 時は confidence 0
 * 5. Spring / Upthrust / SOS / SOW シグナルが正しく反映
 * 6. 決定論性 (同入力 → 同出力)
 * 7. features 型制約遵守
 * 8. SMC context との連携は payload に取り込まれた前提 (= 本 Lens は payload のみ参照)
 */

import { WyckoffLens, WYCKOFF_LENS_FEATURE_KEYS } from '../../lenses/WyckoffLens';
import type { LensInput, WyckoffPhasesPayload } from '../../lenses/types';

// ============================================================================
// テスト用 payload ファクトリ
// ============================================================================

function makeFullPayload(overrides: Partial<WyckoffPhasesPayload> = {}): WyckoffPhasesPayload {
  return {
    wyckoffPhase: 'MARKUP',
    wyckoffPhaseConfidence: 0.85,
    springDetectedInLast20Bars: false,
    upthrustDetectedInLast20Bars: false,
    lastSosBarsAgo: 3,
    lastSowBarsAgo: -1,
    ...overrides,
  };
}

function makeMinimalInput(payload?: WyckoffPhasesPayload): LensInput {
  return {
    symbol: 'XAUUSD',
    timeframe: '15m',
    timestamp: new Date('2026-05-14T00:00:00Z'),
    precomputedWyckoffPhases: payload,
  };
}

// ============================================================================
// テストケース
// ============================================================================

describe('WyckoffLens: Lens interface 実装', () => {
  it('Lens interface のメタデータが正しい', () => {
    const lens = new WyckoffLens();
    expect(lens.name).toBe('wyckoff');
    expect(lens.version).toBe('1.0.0');
    expect(lens.dependencies).toEqual(['symbol', 'precomputedWyckoffPhases']);
  });

  it('WYCKOFF_LENS_FEATURE_KEYS が 6 個 (§5.4 仕様通り)', () => {
    expect(WYCKOFF_LENS_FEATURE_KEYS.length).toBe(6);
  });
});

describe('WyckoffLens: payload 未指定時 (sentinel + confidence 0)', () => {
  it('precomputedWyckoffPhases が undefined なら confidence: 0', async () => {
    const lens = new WyckoffLens();
    const result = await lens.compute(makeMinimalInput(undefined));
    expect(result.confidence).toBe(0);
    expect(result.lensName).toBe('wyckoff');
    expect(result.lensVersion).toBe('1.0.0');
  });

  it('payload 未指定時の features は全 6 keys を sentinel 値で埋める', async () => {
    const lens = new WyckoffLens();
    const result = await lens.compute(makeMinimalInput(undefined));
    expect(Object.keys(result.features).sort()).toEqual([...WYCKOFF_LENS_FEATURE_KEYS].sort());

    expect(result.features.wyckoff_phase).toBe('UNKNOWN');
    expect(result.features.wyckoff_phase_confidence).toBe(0);
    expect(result.features.spring_detected_in_last_20_bars).toBe(false);
    expect(result.features.upthrust_detected_in_last_20_bars).toBe(false);
    expect(result.features.last_sos_bars_ago).toBe(-1);
    expect(result.features.last_sow_bars_ago).toBe(-1);
  });
});

describe('WyckoffLens: payload 指定時 (features マッピング)', () => {
  it('payload の全フィールドが features に正しくマッピングされる', async () => {
    const lens = new WyckoffLens();
    const payload = makeFullPayload();
    const result = await lens.compute(makeMinimalInput(payload));

    expect(result.confidence).toBe(0.85);
    expect(result.features.wyckoff_phase).toBe('MARKUP');
    expect(result.features.wyckoff_phase_confidence).toBe(0.85);
    expect(result.features.spring_detected_in_last_20_bars).toBe(false);
    expect(result.features.upthrust_detected_in_last_20_bars).toBe(false);
    expect(result.features.last_sos_bars_ago).toBe(3);
    expect(result.features.last_sow_bars_ago).toBe(-1);
  });

  it('UNKNOWN 時は confidence 0 (payload があっても)', async () => {
    const lens = new WyckoffLens();
    const payload = makeFullPayload({
      wyckoffPhase: 'UNKNOWN',
      wyckoffPhaseConfidence: 0,
    });
    const result = await lens.compute(makeMinimalInput(payload));
    expect(result.confidence).toBe(0);
  });
});

describe('WyckoffLens: 7 種 phase 全て許容', () => {
  it('ACCUMULATION / MARKUP / DISTRIBUTION / MARKDOWN / RE_ACCUMULATION / RE_DISTRIBUTION / UNKNOWN', async () => {
    const lens = new WyckoffLens();
    const phases: Array<WyckoffPhasesPayload['wyckoffPhase']> = [
      'ACCUMULATION',
      'MARKUP',
      'DISTRIBUTION',
      'MARKDOWN',
      'RE_ACCUMULATION',
      'RE_DISTRIBUTION',
      'UNKNOWN',
    ];
    for (const p of phases) {
      const payload = makeFullPayload({ wyckoffPhase: p });
      const result = await lens.compute(makeMinimalInput(payload));
      expect(result.features.wyckoff_phase).toBe(p);
    }
  });
});

describe('WyckoffLens: Spring / Upthrust シグナル', () => {
  it('springDetectedInLast20Bars: true が features に反映', async () => {
    const lens = new WyckoffLens();
    const payload = makeFullPayload({ springDetectedInLast20Bars: true });
    const result = await lens.compute(makeMinimalInput(payload));
    expect(result.features.spring_detected_in_last_20_bars).toBe(true);
  });

  it('upthrustDetectedInLast20Bars: true が features に反映', async () => {
    const lens = new WyckoffLens();
    const payload = makeFullPayload({ upthrustDetectedInLast20Bars: true });
    const result = await lens.compute(makeMinimalInput(payload));
    expect(result.features.upthrust_detected_in_last_20_bars).toBe(true);
  });

  it('Spring + Upthrust 両方検出 (まれだが許容される)', async () => {
    const lens = new WyckoffLens();
    const payload = makeFullPayload({
      springDetectedInLast20Bars: true,
      upthrustDetectedInLast20Bars: true,
    });
    const result = await lens.compute(makeMinimalInput(payload));
    expect(result.features.spring_detected_in_last_20_bars).toBe(true);
    expect(result.features.upthrust_detected_in_last_20_bars).toBe(true);
  });
});

describe('WyckoffLens: SOS / SOW 経過バー数', () => {
  it('SOS あり (0 bar 前) / SOW なし (sentinel -1)', async () => {
    const lens = new WyckoffLens();
    const payload = makeFullPayload({ lastSosBarsAgo: 0, lastSowBarsAgo: -1 });
    const result = await lens.compute(makeMinimalInput(payload));
    expect(result.features.last_sos_bars_ago).toBe(0);
    expect(result.features.last_sow_bars_ago).toBe(-1);
  });

  it('SOW あり (5 bars 前) / SOS なし', async () => {
    const lens = new WyckoffLens();
    const payload = makeFullPayload({ lastSosBarsAgo: -1, lastSowBarsAgo: 5 });
    const result = await lens.compute(makeMinimalInput(payload));
    expect(result.features.last_sos_bars_ago).toBe(-1);
    expect(result.features.last_sow_bars_ago).toBe(5);
  });

  it('SOS と SOW が両方記録される (異なるバー)', async () => {
    const lens = new WyckoffLens();
    const payload = makeFullPayload({ lastSosBarsAgo: 2, lastSowBarsAgo: 25 });
    const result = await lens.compute(makeMinimalInput(payload));
    expect(result.features.last_sos_bars_ago).toBe(2);
    expect(result.features.last_sow_bars_ago).toBe(25);
  });
});

describe('WyckoffLens: features 型制約遵守', () => {
  it('features の全 value は number / string / boolean のみ (null / array なし)', async () => {
    const lens = new WyckoffLens();
    const result = await lens.compute(makeMinimalInput(makeFullPayload()));
    for (const [key, value] of Object.entries(result.features)) {
      const valueType = typeof value;
      expect(
        valueType === 'number' || valueType === 'string' || valueType === 'boolean',
      ).toBe(true);
      expect(value).not.toBeNull();
      expect(Array.isArray(value)).toBe(false);
      if (!['number', 'string', 'boolean'].includes(valueType)) {
        throw new Error(`Unexpected feature type: ${key} = ${valueType}`);
      }
    }
  });

  it('JSON.stringify で全 features が serializable', async () => {
    const lens = new WyckoffLens();
    const result = await lens.compute(makeMinimalInput(makeFullPayload()));
    const json = JSON.stringify(result.features);
    expect(json).toBeDefined();
    expect(JSON.parse(json)).toEqual(result.features);
  });
});

describe('WyckoffLens: 決定論性 (同入力 → 同出力)', () => {
  it('同じ payload を 2 回 compute して features が同一', async () => {
    const lens = new WyckoffLens();
    const payload = makeFullPayload();
    const r1 = await lens.compute(makeMinimalInput(payload));
    const r2 = await lens.compute(makeMinimalInput(payload));
    expect(r1.features).toEqual(r2.features);
  });

  it('payload 未指定でも 2 回 compute して features が同一', async () => {
    const lens = new WyckoffLens();
    const r1 = await lens.compute(makeMinimalInput(undefined));
    const r2 = await lens.compute(makeMinimalInput(undefined));
    expect(r1.features).toEqual(r2.features);
  });
});

describe('WyckoffLens: edge case', () => {
  it('wyckoffPhaseConfidence 境界値 (0.0 / 1.0) で features に反映', async () => {
    const lens = new WyckoffLens();
    const r1 = await lens.compute(
      makeMinimalInput(
        makeFullPayload({ wyckoffPhaseConfidence: 0.0, wyckoffPhase: 'UNKNOWN' }),
      ),
    );
    expect(r1.features.wyckoff_phase_confidence).toBe(0.0);
    expect(r1.confidence).toBe(0);

    const r2 = await lens.compute(
      makeMinimalInput(makeFullPayload({ wyckoffPhaseConfidence: 1.0 })),
    );
    expect(r2.features.wyckoff_phase_confidence).toBe(1.0);
    expect(r2.confidence).toBe(1.0);
  });

  it('SOS / SOW 大きなバー数 (古いシグナル) でも features に反映', async () => {
    const lens = new WyckoffLens();
    const payload = makeFullPayload({ lastSosBarsAgo: 999, lastSowBarsAgo: 500 });
    const result = await lens.compute(makeMinimalInput(payload));
    expect(result.features.last_sos_bars_ago).toBe(999);
    expect(result.features.last_sow_bars_ago).toBe(500);
  });

  it('computedAt が Date 型、computeDurationMs が number で返る', async () => {
    const lens = new WyckoffLens();
    const result = await lens.compute(makeMinimalInput(makeFullPayload()));
    expect(result.computedAt).toBeInstanceOf(Date);
    expect(typeof result.computeDurationMs).toBe('number');
    expect(result.computeDurationMs).toBeGreaterThanOrEqual(0);
  });
});
