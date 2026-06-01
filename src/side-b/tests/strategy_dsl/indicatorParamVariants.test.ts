/**
 * 進化ループ再設計 Phase 1c: generateIndicatorPeriodVariants のユニットテスト。
 *
 * variant 生成は純粋・決定論なのでここが Phase 1c の中核テスト。
 * （実際の BT/WF 評価は analysis-engine 側で CI 不在のため optimizeIndicatorPeriods は
 *  stub 注入でロジックのみ検証する別テスト。）
 */

import {
  generateIndicatorPeriodVariants,
  type IndicatorVariantOptions,
} from '../../strategy_dsl/indicatorParamVariants';
import {
  StrategyDSLSchema,
  type Condition,
  type ConditionGroup,
  type StrategyDSL,
} from '../../strategy_dsl/schema';

function makeDsl(trigger: ConditionGroup): StrategyDSL {
  return {
    id: 'dsl-1',
    generation: 0,
    parentIds: [],
    regimeTarget: 'trend',
    symbol: 'XAUUSD',
    timeframe: '15m',
    entry: { direction: 'long', trigger, orderType: 'market' },
    stopLoss: { type: 'atr_multiple', value: 1.5 },
    takeProfit: { type: 'rr_ratio', value: 2.0 },
    parameters: {},
    metadata: { createdAt: '2026-06-02T00:00:00.000Z', createdBy: 'mutation' },
  };
}

/** ema(period) を別 ema(period) と比較する leaf。 */
function emaCrossCondition(leftPeriod: number, rightPeriod: number) {
  return {
    lens: 'ohlcv',
    feature: 'ema',
    op: '>' as const,
    params: { period: leftPeriod },
    compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: rightPeriod } },
  };
}

describe('generateIndicatorPeriodVariants', () => {
  it('period 系 param が無い戦略は base 1 件のみ（axisCount=0）', () => {
    // 旧形式 lens=rsi/feature=value は params が無く lens!=ohlcv なので対象外。
    const dsl = makeDsl({
      logic: 'AND',
      conditions: [{ lens: 'rsi', feature: 'value', op: '<', value: 30 }],
    });
    const res = generateIndicatorPeriodVariants(dsl);
    expect(res.axisCount).toBe(0);
    expect(res.variants).toHaveLength(1);
    expect(res.totalCombos).toBe(1);
    expect(res.truncated).toBe(false);
    expect(res.variants[0]).toEqual(dsl);
  });

  it('単一 ema(period=20) を ±20%/3点で振る → [16,20,24] の 3 variant、base が先頭', () => {
    const dsl = makeDsl({
      logic: 'AND',
      conditions: [
        { lens: 'ohlcv', feature: 'ema', op: '>', value: 2000, params: { period: 20 } },
      ],
    });
    const res = generateIndicatorPeriodVariants(dsl);
    expect(res.axisCount).toBe(1);
    expect(res.totalCombos).toBe(3);
    expect(res.returnedCount).toBe(3);

    const periods = res.variants.map((v) => firstLeaf(v).params?.period);
    expect(periods[0]).toBe(20); // base が先頭
    expect([...periods].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([16, 20, 24]);
  });

  it('2 軸（self ema20 + compareTarget ema50）は直積 3×3=9 variant', () => {
    const dsl = makeDsl({
      logic: 'AND',
      conditions: [emaCrossCondition(20, 50)],
    });
    const res = generateIndicatorPeriodVariants(dsl);
    expect(res.axisCount).toBe(2);
    expect(res.totalCombos).toBe(9);
    expect(res.returnedCount).toBe(9);
    // base（20/50）が先頭
    const c0 = firstLeaf(res.variants[0]);
    expect(c0.params?.period).toBe(20);
    expect(c0.compareTarget?.params?.period).toBe(50);
  });

  it('registry の minPeriod でクランプ（rsi period=3, min=2）', () => {
    const dsl = makeDsl({
      logic: 'AND',
      conditions: [
        { lens: 'ohlcv', feature: 'rsi', op: '>', value: 50, params: { period: 3 } },
      ],
    });
    // ±20%: round(2.4)=2, 3, round(3.6)=4 → [2,3,4]（min=2 でクランプ）
    const res = generateIndicatorPeriodVariants(dsl);
    const periods = res.variants
      .map((v) => firstLeaf(v).params?.period ?? 0)
      .sort((a, b) => a - b);
    expect(periods).toEqual([2, 3, 4]);
    expect(periods.every((p) => p >= 2)).toBe(true);
  });

  it('maxCombos 超過時は base を含めて決定論的に間引く（truncated=true）', () => {
    const dsl = makeDsl({
      logic: 'AND',
      conditions: [emaCrossCondition(20, 50)],
    });
    const opts: IndicatorVariantOptions = { maxCombos: 4 };
    const res = generateIndicatorPeriodVariants(dsl, opts);
    expect(res.totalCombos).toBe(9);
    expect(res.truncated).toBe(true);
    expect(res.returnedCount).toBe(4);
    // base（20/50）は必ず残る = 先頭
    const c0 = firstLeaf(res.variants[0]);
    expect(c0.params?.period).toBe(20);
    expect(c0.compareTarget?.params?.period).toBe(50);
  });

  it('決定論: 同じ入力なら同じ variant 列を返す', () => {
    const dsl = makeDsl({ logic: 'AND', conditions: [emaCrossCondition(20, 50)] });
    const a = generateIndicatorPeriodVariants(dsl, { maxCombos: 5 });
    const b = generateIndicatorPeriodVariants(dsl, { maxCombos: 5 });
    expect(a.variants).toEqual(b.variants);
  });

  it('生成 variant はすべて schema-valid で整数 period のみ', () => {
    const dsl = makeDsl({ logic: 'AND', conditions: [emaCrossCondition(20, 50)] });
    const res = generateIndicatorPeriodVariants(dsl);
    for (const v of res.variants) {
      expect(() => StrategyDSLSchema.parse(v)).not.toThrow();
      const c = firstLeaf(v);
      expect(Number.isInteger(c.params?.period)).toBe(true);
      expect(Number.isInteger(c.compareTarget?.params?.period)).toBe(true);
    }
  });

  it('base 以外の元 DSL を変更しない（structuredClone で隔離）', () => {
    const dsl = makeDsl({
      logic: 'AND',
      conditions: [{ lens: 'ohlcv', feature: 'ema', op: '>', value: 2000, params: { period: 20 } }],
    });
    generateIndicatorPeriodVariants(dsl);
    expect(firstLeaf(dsl).params?.period).toBe(20); // 元 DSL は不変
  });
});

/** immediate entry の trigger 先頭 leaf を型ガードで取り出すテストヘルパ。 */
function firstLeaf(dsl: StrategyDSL): Condition {
  const entry = dsl.entry;
  const group: ConditionGroup =
    'type' in entry && entry.type === 'wait_for_trigger' ? entry.triggerConditions : entry.trigger;
  const first = group.conditions[0];
  if ('logic' in first) throw new Error('expected a leaf condition, got a group');
  return first;
}
