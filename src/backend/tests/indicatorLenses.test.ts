/**
 * インジケーターレンズ(src/shared/similarity/indicatorLenses.ts)のユニットテスト
 *
 * 検証観点:
 * - Profile 設定 → レンズ仕様の決定論的解決(lensId にパラメータが含まれること = §5.3)
 * - 各コアレンズ(rsi/macd/ma/ma_cross/bb)の特徴計算(正常系・境界値・異常系)
 * - 決定性: 同じ入力で同じ出力(AGENTS.md テストポリシー)
 * - 欠損耐性: データ不足時に confidence を下げ、計算不能なら confidence=0
 */

import {
  BARS_SINCE_SENTINEL,
  DESIRED_VALID_BARS,
  computeIndicatorLens,
  detectDivergence,
  resolveIndicatorLensSpecs,
  type IndicatorLensComputeInput,
  type IndicatorLensSpec,
} from '../../shared/similarity/indicatorLenses';

/** 長さ n の定数配列を作る */
function constantSeries(value: number, n: number): number[] {
  return Array.from({ length: n }, () => value);
}

/** kind 指定でレンズ仕様を 1 件取り出すヘルパ */
function specOf(kind: IndicatorLensSpec['kind'], specs: IndicatorLensSpec[]): IndicatorLensSpec {
  const found = specs.find((s) => s.kind === kind);
  if (!found) {
    throw new Error(`spec not found: ${kind}`);
  }
  return found;
}

describe('resolveIndicatorLensSpecs(Profile → レンズ仕様の解決)', () => {
  test('rsi/macd/bb の lensId にパラメータ識別子が含まれる(作成時=照合時のキー一致保証)', () => {
    const specs = resolveIndicatorLensSpecs([
      { indicatorId: 'rsi', params: { period: 14 }, enabled: true },
      {
        indicatorId: 'macd',
        params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
        enabled: true,
      },
      { indicatorId: 'bb', params: { period: 20 }, enabled: true },
    ]);
    const lensIds = specs.map((s) => s.lensId);
    expect(lensIds).toContain('ind:rsi#p14');
    expect(lensIds).toContain('ind:macd#f12s26g9');
    expect(lensIds).toContain('ind:bb#p20');
  });

  test('複数 MA から期間昇順の隣接ペアで ma_cross レンズが生成される(短×中、中×長)', () => {
    const specs = resolveIndicatorLensSpecs([
      { indicatorId: 'ema', params: { period: 200 }, enabled: true },
      { indicatorId: 'ema', params: { period: 20 }, enabled: true },
      { indicatorId: 'sma', params: { period: 75 }, enabled: true },
    ]);
    const lensIds = specs.map((s) => s.lensId);
    expect(lensIds).toContain('ind:ma#ema20');
    expect(lensIds).toContain('ind:ma#sma75');
    expect(lensIds).toContain('ind:ma#ema200');
    expect(lensIds).toContain('ind:ma_cross#ema20xsma75');
    expect(lensIds).toContain('ind:ma_cross#sma75xema200');
    // 非隣接ペア(短×長)は作らない
    expect(lensIds).not.toContain('ind:ma_cross#ema20xema200');
  });

  test('enabled=false とコアセット外の指標は無視される(エラーにしない)', () => {
    const specs = resolveIndicatorLensSpecs([
      { indicatorId: 'rsi', params: { period: 14 }, enabled: false },
      { indicatorId: 'atr', params: { period: 14 }, enabled: true },
      { indicatorId: 'ichimoku', params: {}, enabled: true },
    ]);
    expect(specs).toHaveLength(0);
  });

  test('同一設定の重複は 1 レンズに排除される', () => {
    const specs = resolveIndicatorLensSpecs([
      { indicatorId: 'rsi', params: { period: 14 }, enabled: true },
      { indicatorId: 'rsi', params: { period: 14 }, enabled: true },
    ]);
    expect(specs).toHaveLength(1);
  });

  test('パラメータ未指定・不正値は既定値に正規化される', () => {
    const specs = resolveIndicatorLensSpecs([
      { indicatorId: 'rsi', params: {}, enabled: true },
      { indicatorId: 'macd', params: { fastPeriod: -5 }, enabled: true },
    ]);
    const lensIds = specs.map((s) => s.lensId);
    expect(lensIds).toContain('ind:rsi#p14');
    expect(lensIds).toContain('ind:macd#f12s26g9');
  });
});

describe('computeIndicatorLens — ind:rsi', () => {
  const spec = specOf(
    'rsi',
    resolveIndicatorLensSpecs([{ indicatorId: 'rsi', params: { period: 14 }, enabled: true }])
  );

  test.each([
    [25, 'oversold'],
    [50, 'neutral'],
    [75, 'overbought'],
    [30, 'oversold'],
    [70, 'overbought'],
  ])('RSI=%p のとき rsi_zone=%p(境界値含む)', (rsiValue, expectedZone) => {
    const n = DESIRED_VALID_BARS + 5;
    const input: IndicatorLensComputeInput = {
      close: constantSeries(100, n),
      series: { rsi: constantSeries(rsiValue, n) },
    };
    const entry = computeIndicatorLens(spec, input);
    expect(entry.features['rsi_zone']).toBe(expectedZone);
    expect(entry.features['rsi_value']).toBeCloseTo(rsiValue / 100, 5);
    expect(entry.confidence).toBe(1);
  });

  test('rsi 系列が無い場合は confidence=0 / features 空(全体を壊さない)', () => {
    const entry = computeIndicatorLens(spec, { close: constantSeries(100, 40), series: {} });
    expect(entry.confidence).toBe(0);
    expect(Object.keys(entry.features)).toHaveLength(0);
  });

  test('有効バー数が浅いと confidence が比例して下がる', () => {
    const shallow = 6;
    const input: IndicatorLensComputeInput = {
      close: constantSeries(100, shallow),
      series: { rsi: constantSeries(50, shallow) },
    };
    const entry = computeIndicatorLens(spec, input);
    expect(entry.confidence).toBeCloseTo(shallow / DESIRED_VALID_BARS, 5);
  });

  test('決定性: 同じ入力で同じ出力を返す', () => {
    const n = 40;
    const input: IndicatorLensComputeInput = {
      close: Array.from({ length: n }, (_, i) => 100 + Math.sin(i)),
      series: { rsi: Array.from({ length: n }, (_, i) => 40 + (i % 20)) },
    };
    expect(computeIndicatorLens(spec, input)).toEqual(computeIndicatorLens(spec, input));
  });
});

describe('computeIndicatorLens — ind:macd', () => {
  const spec = specOf(
    'macd',
    resolveIndicatorLensSpecs([
      {
        indicatorId: 'macd',
        params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
        enabled: true,
      },
    ])
  );

  test('直近のゴールデンクロスを bull イベントとして検出する(bars_since=0)', () => {
    const n = 40;
    // signal は常に 0、macd は最後の 1 本で - → + に転換
    const macd = [...constantSeries(-1, n - 1), 1];
    const input: IndicatorLensComputeInput = {
      close: constantSeries(100, n),
      series: { macd, signal: constantSeries(0, n), histogram: constantSeries(0, n) },
    };
    const entry = computeIndicatorLens(spec, input);
    expect(entry.features['macd_cross']).toBe('bull');
    expect(entry.features['macd_bars_since_cross']).toBe(0);
  });

  test('クロスが古い(イベント窓の外)場合は cross=none だが bars_since には残る', () => {
    const n = 40;
    // 10 本前にデッドクロス
    const macd = [...constantSeries(1, n - 11), ...constantSeries(-1, 11)];
    const input: IndicatorLensComputeInput = {
      close: constantSeries(100, n),
      series: { macd, signal: constantSeries(0, n), histogram: constantSeries(0, n) },
    };
    const entry = computeIndicatorLens(spec, input);
    expect(entry.features['macd_cross']).toBe('none');
    expect(entry.features['macd_bars_since_cross']).toBe(10);
  });

  test('遡り範囲内にクロスが無い場合は sentinel(-1)', () => {
    const n = 40;
    const input: IndicatorLensComputeInput = {
      close: constantSeries(100, n),
      series: {
        macd: constantSeries(1, n),
        signal: constantSeries(0, n),
        histogram: constantSeries(0.5, n),
      },
    };
    const entry = computeIndicatorLens(spec, input);
    expect(entry.features['macd_cross']).toBe('none');
    expect(entry.features['macd_bars_since_cross']).toBe(BARS_SINCE_SENTINEL);
  });

  test('ヒストグラムの上昇傾きは正、下降傾きは負になる', () => {
    const n = 40;
    const rising = Array.from({ length: n }, (_, i) => i * 0.05);
    const falling = Array.from({ length: n }, (_, i) => -i * 0.05);
    const base = {
      close: constantSeries(100, n),
    };
    const risingEntry = computeIndicatorLens(spec, {
      ...base,
      series: { macd: constantSeries(1, n), signal: constantSeries(0, n), histogram: rising },
    });
    const fallingEntry = computeIndicatorLens(spec, {
      ...base,
      series: { macd: constantSeries(1, n), signal: constantSeries(0, n), histogram: falling },
    });
    expect(risingEntry.features['macd_hist_slope']).toBeGreaterThan(0);
    expect(fallingEntry.features['macd_hist_slope']).toBeLessThan(0);
  });
});

describe('computeIndicatorLens — ind:ma / ind:ma_cross', () => {
  const maSpec = specOf(
    'ma',
    resolveIndicatorLensSpecs([{ indicatorId: 'ema', params: { period: 20 }, enabled: true }])
  );
  const crossSpec = specOf(
    'ma_cross',
    resolveIndicatorLensSpecs([
      { indicatorId: 'ema', params: { period: 20 }, enabled: true },
      { indicatorId: 'sma', params: { period: 75 }, enabled: true },
    ])
  );

  test('上昇 MA + 価格が MA より上 → ma_slope > 0 かつ ma_distance_norm > 0', () => {
    const n = 40;
    const ma = Array.from({ length: n }, (_, i) => 100 + i * 0.1);
    const close = constantSeries(110, n);
    const entry = computeIndicatorLens(maSpec, { close, series: { ma } });
    const slope = entry.features['ma_slope'];
    const distance = entry.features['ma_distance_norm'];
    expect(typeof slope).toBe('number');
    expect(typeof distance).toBe('number');
    expect(slope).toBeGreaterThan(0);
    expect(distance).toBeGreaterThan(0);
  });

  test('短期線が長期線を上抜けたら ma_cross=bull / ma_fast_above_slow=true', () => {
    const n = 40;
    const fast = [...constantSeries(99, n - 1), 101];
    const slow = constantSeries(100, n);
    const entry = computeIndicatorLens(crossSpec, {
      close: constantSeries(100, n),
      series: { fast, slow },
    });
    expect(entry.features['ma_cross']).toBe('bull');
    expect(entry.features['ma_fast_above_slow']).toBe(true);
  });
});

describe('computeIndicatorLens — ind:bb', () => {
  const spec = specOf(
    'bb',
    resolveIndicatorLensSpecs([{ indicatorId: 'bb', params: { period: 20 }, enabled: true }])
  );

  test('バンド内位置と相対バンド幅が [0,1] で出る', () => {
    const n = 40;
    const entry = computeIndicatorLens(spec, {
      close: constantSeries(105, n),
      series: {
        upper: constantSeries(110, n),
        middle: constantSeries(100, n),
        lower: constantSeries(90, n),
      },
    });
    expect(entry.features['bb_position']).toBeCloseTo(0.75, 5);
    // 幅 20 / 中心 100 = 20% → 5% で飽和して 1.0
    expect(entry.features['bb_width_norm']).toBe(1);
  });

  test('バンド外の価格は位置がクランプされる', () => {
    const n = 40;
    const entry = computeIndicatorLens(spec, {
      close: constantSeries(120, n),
      series: {
        upper: constantSeries(110, n),
        middle: constantSeries(100, n),
        lower: constantSeries(90, n),
      },
    });
    expect(entry.features['bb_position']).toBe(1);
  });
});

describe('detectDivergence(ダイバージェンス検出)', () => {
  test('価格 HH + オシレーター LH で bear divergence', () => {
    // ピボット高値: idx2(12) → idx7(13) で価格切り上げ、RSI は 80 → 70 に切り下げ
    const close = [10, 11, 12, 11, 10, 11, 12, 13, 12, 11];
    const rsi = [50, 60, 80, 60, 50, 55, 60, 70, 60, 50];
    expect(detectDivergence(close, rsi)).toBe('bear');
  });

  test('価格 LL + オシレーター HL で bull divergence', () => {
    const close = [10, 9, 8, 9, 10, 9, 8, 7, 8, 9];
    const rsi = [50, 40, 20, 40, 50, 45, 40, 30, 40, 50];
    expect(detectDivergence(close, rsi)).toBe('bull');
  });

  test('ダイバージェンス無し(順行)では none', () => {
    const close = [10, 11, 12, 11, 10, 11, 12, 13, 12, 11];
    const rsi = [50, 60, 70, 60, 50, 55, 60, 80, 60, 50];
    expect(detectDivergence(close, rsi)).toBe('none');
  });

  test('データ不足(10 本未満)では none', () => {
    expect(detectDivergence([1, 2, 3], [1, 2, 3])).toBe('none');
  });
});
