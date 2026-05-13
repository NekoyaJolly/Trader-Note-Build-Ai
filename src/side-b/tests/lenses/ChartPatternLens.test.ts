/**
 * ChartPatternLens 単体テスト (Phase 7b)
 *
 * 設計書: docs/design/phase_7_specification.md §5.2 / §6.2 (Phase 7b DoD)
 *
 * 検証項目 (Phase 7b §6.2 DoD):
 * 1. ChartPatternLens が Lens interface を実装している
 * 2. payload 未指定時に sentinel features + confidence 0 を返す
 * 3. 11 種パターン全てが features に正しくマッピングされる
 * 4. NONE 時は confidence 0 になる (payload あっても)
 * 5. 決定論性 (同入力 → 同出力)
 * 6. features 型制約遵守 (number / string / boolean のみ、null / array なし)
 * 7. 既存 PatternLens (ローソク足、`'pattern'`) との階層命名整合性
 */

import { ChartPatternLens, CHART_PATTERN_LENS_FEATURE_KEYS } from '../../lenses/ChartPatternLens';
import { PatternLens } from '../../lenses/PatternLens';
import type { ChartPatternsPayload, LensInput } from '../../lenses/types';

// ============================================================================
// テスト用 payload ファクトリ
// ============================================================================

function makeFullPayload(overrides: Partial<ChartPatternsPayload> = {}): ChartPatternsPayload {
  return {
    patternDetected: 'TRIANGLE_ASC',
    patternConfidence: 0.75,
    patternBreakImminent: true,
    patternBarsCount: 12,
    patternDirectionBias: 'BULL',
    ...overrides,
  };
}

function makeMinimalInput(payload?: ChartPatternsPayload): LensInput {
  return {
    symbol: 'XAUUSD',
    timeframe: '15m',
    timestamp: new Date('2026-05-14T00:00:00Z'),
    precomputedChartPatterns: payload,
  };
}

// ============================================================================
// テストケース
// ============================================================================

describe('ChartPatternLens: Lens interface 実装', () => {
  it('Lens interface のメタデータが正しい', () => {
    const lens = new ChartPatternLens();
    expect(lens.name).toBe('chart_pattern');
    expect(lens.version).toBe('1.0.0');
    expect(lens.dependencies).toEqual(['symbol', 'precomputedChartPatterns']);
  });

  it('CHART_PATTERN_LENS_FEATURE_KEYS が 5 個 (§5.2 仕様通り)', () => {
    expect(CHART_PATTERN_LENS_FEATURE_KEYS.length).toBe(5);
  });
});

describe('ChartPatternLens: payload 未指定時 (sentinel + confidence 0)', () => {
  it('precomputedChartPatterns が undefined なら confidence: 0', async () => {
    const lens = new ChartPatternLens();
    const result = await lens.compute(makeMinimalInput(undefined));
    expect(result.confidence).toBe(0);
    expect(result.lensName).toBe('chart_pattern');
    expect(result.lensVersion).toBe('1.0.0');
  });

  it('payload 未指定時の features は全 5 keys を sentinel 値で埋める', async () => {
    const lens = new ChartPatternLens();
    const result = await lens.compute(makeMinimalInput(undefined));
    expect(Object.keys(result.features).sort()).toEqual([...CHART_PATTERN_LENS_FEATURE_KEYS].sort());

    expect(result.features.pattern_detected).toBe('NONE');
    expect(result.features.pattern_confidence).toBe(0);
    expect(result.features.pattern_break_imminent).toBe(false);
    expect(result.features.pattern_bars_count).toBe(0);
    expect(result.features.pattern_direction_bias).toBe('NEUTRAL');
  });
});

describe('ChartPatternLens: payload 指定時 (features マッピング)', () => {
  it('payload の全フィールドが features に正しくマッピングされる', async () => {
    const lens = new ChartPatternLens();
    const payload = makeFullPayload();
    const result = await lens.compute(makeMinimalInput(payload));

    expect(result.confidence).toBe(0.75);
    expect(result.features.pattern_detected).toBe('TRIANGLE_ASC');
    expect(result.features.pattern_confidence).toBe(0.75);
    expect(result.features.pattern_break_imminent).toBe(true);
    expect(result.features.pattern_bars_count).toBe(12);
    expect(result.features.pattern_direction_bias).toBe('BULL');
  });

  it('NONE 時は confidence 0 (payload あっても)', async () => {
    const lens = new ChartPatternLens();
    const payload = makeFullPayload({
      patternDetected: 'NONE',
      patternConfidence: 0,
      patternBreakImminent: false,
      patternBarsCount: 0,
      patternDirectionBias: 'NEUTRAL',
    });
    const result = await lens.compute(makeMinimalInput(payload));
    expect(result.confidence).toBe(0);
  });
});

describe('ChartPatternLens: 11 種パターン全て許容', () => {
  it('FLAG / PENNANT / TRIANGLE_ASC / DESC / SYM / HEAD_SHOULDER / INV_HEAD_SHOULDER / DOUBLE_TOP / BOTTOM / WEDGE_RISE / FALL', async () => {
    const lens = new ChartPatternLens();
    const patterns: Array<ChartPatternsPayload['patternDetected']> = [
      'FLAG',
      'PENNANT',
      'TRIANGLE_ASC',
      'TRIANGLE_DESC',
      'TRIANGLE_SYM',
      'HEAD_SHOULDER',
      'INV_HEAD_SHOULDER',
      'DOUBLE_TOP',
      'DOUBLE_BOTTOM',
      'WEDGE_RISE',
      'WEDGE_FALL',
    ];
    for (const p of patterns) {
      const payload = makeFullPayload({ patternDetected: p });
      const result = await lens.compute(makeMinimalInput(payload));
      expect(result.features.pattern_detected).toBe(p);
    }
  });

  it('全 direction_bias 種別が許容される', async () => {
    const lens = new ChartPatternLens();
    const biases: Array<ChartPatternsPayload['patternDirectionBias']> = [
      'BULL',
      'BEAR',
      'NEUTRAL',
    ];
    for (const b of biases) {
      const payload = makeFullPayload({ patternDirectionBias: b });
      const result = await lens.compute(makeMinimalInput(payload));
      expect(result.features.pattern_direction_bias).toBe(b);
    }
  });
});

describe('ChartPatternLens: features 型制約遵守', () => {
  it('features の全 value は number / string / boolean のみ (null / array なし)', async () => {
    const lens = new ChartPatternLens();
    const result = await lens.compute(makeMinimalInput(makeFullPayload()));
    for (const [key, value] of Object.entries(result.features)) {
      const valueType = typeof value;
      expect(
        valueType === 'number' || valueType === 'string' || valueType === 'boolean',
      ).toBe(true);
      expect(value).not.toBeNull();
      expect(Array.isArray(value)).toBe(false);
      // 確認用
      if (!['number', 'string', 'boolean'].includes(valueType)) {
        throw new Error(`Unexpected feature type: ${key} = ${valueType}`);
      }
    }
  });

  it('JSON.stringify で全 features が serializable', async () => {
    const lens = new ChartPatternLens();
    const result = await lens.compute(makeMinimalInput(makeFullPayload()));
    const json = JSON.stringify(result.features);
    expect(json).toBeDefined();
    expect(JSON.parse(json)).toEqual(result.features);
  });
});

describe('ChartPatternLens: 決定論性 (同入力 → 同出力)', () => {
  it('同じ payload を 2 回 compute して features が同一', async () => {
    const lens = new ChartPatternLens();
    const payload = makeFullPayload();
    const r1 = await lens.compute(makeMinimalInput(payload));
    const r2 = await lens.compute(makeMinimalInput(payload));
    expect(r1.features).toEqual(r2.features);
  });

  it('payload 未指定でも 2 回 compute して features が同一', async () => {
    const lens = new ChartPatternLens();
    const r1 = await lens.compute(makeMinimalInput(undefined));
    const r2 = await lens.compute(makeMinimalInput(undefined));
    expect(r1.features).toEqual(r2.features);
  });
});

describe('ChartPatternLens: 既存 PatternLens (ローソク足) との階層命名整合性', () => {
  it("PatternLens.name は 'pattern' (基本)、ChartPatternLens.name は 'chart_pattern' (応用)", () => {
    const candleLens = new PatternLens();
    const chartLens = new ChartPatternLens();
    expect(candleLens.name).toBe('pattern');
    expect(chartLens.name).toBe('chart_pattern');
    // 命名階層: pattern = 基本 (ローソク足)、chart_pattern = 応用 (N-bar)
    // user 哲学 2026-05-14: PatternLens は無改変、ChartPatternLens 新規追加
  });

  it('両 lens は異なる dependencies を持つ (independent Lens)', () => {
    const candleLens = new PatternLens();
    const chartLens = new ChartPatternLens();
    expect(candleLens.dependencies).not.toEqual(chartLens.dependencies);
  });
});

describe('ChartPatternLens: edge case', () => {
  it('patternConfidence 境界値 (0.0 / 1.0) で features に正しく反映', async () => {
    const lens = new ChartPatternLens();
    const r1 = await lens.compute(
      makeMinimalInput(makeFullPayload({ patternConfidence: 0.0, patternDetected: 'NONE' })),
    );
    expect(r1.features.pattern_confidence).toBe(0.0);
    expect(r1.confidence).toBe(0);

    const r2 = await lens.compute(
      makeMinimalInput(makeFullPayload({ patternConfidence: 1.0 })),
    );
    expect(r2.features.pattern_confidence).toBe(1.0);
    expect(r2.confidence).toBe(1.0);
  });

  it('patternBarsCount が大きな値でも features に正しく反映', async () => {
    const lens = new ChartPatternLens();
    const payload = makeFullPayload({ patternBarsCount: 9999 });
    const result = await lens.compute(makeMinimalInput(payload));
    expect(result.features.pattern_bars_count).toBe(9999);
  });

  it('patternBreakImminent: false の時に正しく false', async () => {
    const lens = new ChartPatternLens();
    const payload = makeFullPayload({ patternBreakImminent: false });
    const result = await lens.compute(makeMinimalInput(payload));
    expect(result.features.pattern_break_imminent).toBe(false);
  });

  it('computedAt が Date 型、computeDurationMs が number で返る', async () => {
    const lens = new ChartPatternLens();
    const result = await lens.compute(makeMinimalInput(makeFullPayload()));
    expect(result.computedAt).toBeInstanceOf(Date);
    expect(typeof result.computeDurationMs).toBe('number');
    expect(result.computeDurationMs).toBeGreaterThanOrEqual(0);
  });
});
