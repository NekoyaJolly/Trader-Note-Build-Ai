/**
 * 進化ループ再設計 Phase 3: generateCrossoverIndicatorVariants のユニットテスト。
 */

import {
  generateCrossoverIndicatorVariants,
} from '../../strategy_dsl/crossoverVariants';
import {
  CROSSOVER_EDGE_TEMPLATES,
} from '../../strategy_dsl/crossoverIndicatorTemplates';
import {
  StrategyDSLSchema,
  type Condition,
  type ConditionGroup,
  type StrategyDSL,
} from '../../strategy_dsl/schema';
import { getPythonSupportedIndicators } from '../../../shared/indicators/registry';

function makeDsl(direction: 'long' | 'short' = 'long'): StrategyDSL {
  return {
    id: 'p1',
    generation: 1,
    parentIds: [],
    regimeTarget: 'trend',
    symbol: 'XAUUSD',
    timeframe: '15m',
    entry: {
      direction,
      trigger: {
        logic: 'AND',
        conditions: [{ lens: 'ohlcv', feature: 'close', op: '>', value: 2000 }],
      },
      orderType: 'market',
    },
    stopLoss: { type: 'atr_multiple', value: 1.5 },
    takeProfit: { type: 'rr_ratio', value: 2.0 },
    parameters: {},
    metadata: { createdAt: '2026-06-02T00:00:00.000Z', createdBy: 'initial_random' },
  };
}

function triggerConditions(dsl: StrategyDSL): ConditionGroup['conditions'] {
  const e = dsl.entry as { trigger: ConditionGroup };
  return e.trigger.conditions;
}

describe('generateCrossoverIndicatorVariants', () => {
  it('rsi のみ long: 売られ過ぎ閾値×period をスイープし、親条件を保ったまま AND 追加', () => {
    const res = generateCrossoverIndicatorVariants(makeDsl('long'), {
      indicatorIds: ['rsi'],
      maxVariantsPerIndicator: 99,
    });
    // rsi long: thresholds [25,30,35] × periods [9,14,21] = 9
    expect(res.variants).toHaveLength(9);
    expect(res.indicatorsUsed).toEqual(['rsi']);
    for (const v of res.variants) {
      const conds = triggerConditions(v.variant);
      expect(conds).toHaveLength(2); // 親 1 + 追加 1
      const added = conds[1] as Condition;
      expect(added.feature).toBe('rsi');
      expect(added.op).toBe('<'); // long = 売られ過ぎ
      expect([25, 30, 35]).toContain(added.value);
      // 親の SL/TP は不変
      expect(v.variant.stopLoss).toEqual({ type: 'atr_multiple', value: 1.5 });
      expect(v.variant.takeProfit).toEqual({ type: 'rr_ratio', value: 2.0 });
    }
  });

  it('short 戦略には買われ過ぎ側（op 反転）の閾値が使われる', () => {
    const res = generateCrossoverIndicatorVariants(makeDsl('short'), {
      indicatorIds: ['rsi'],
      maxVariantsPerIndicator: 99,
    });
    const added = triggerConditions(res.variants[0].variant)[1] as Condition;
    expect(added.op).toBe('>');
    expect([65, 70, 75]).toContain(added.value);
  });

  it('price_vs_ma (ema) は close vs ema(period) を compareTarget で追加', () => {
    const res = generateCrossoverIndicatorVariants(makeDsl('long'), { indicatorIds: ['ema'] });
    const added = triggerConditions(res.variants[0].variant)[1] as Condition;
    expect(added.feature).toBe('close');
    expect(added.op).toBe('>'); // long
    expect(added.compareTarget?.feature).toBe('ema');
    expect(typeof added.compareTarget?.params?.period).toBe('number');
  });

  it('maxVariantsPerIndicator で per-indicator 上限がかかり truncated になる', () => {
    const res = generateCrossoverIndicatorVariants(makeDsl('long'), {
      indicatorIds: ['rsi'],
      maxVariantsPerIndicator: 2,
    });
    expect(res.variants).toHaveLength(2);
    expect(res.totalCombos).toBe(9);
    expect(res.truncated).toBe(true);
  });

  it('maxTotalVariants で全体上限がかかる', () => {
    const res = generateCrossoverIndicatorVariants(makeDsl('long'), {
      indicatorIds: ['rsi', 'ema', 'sma'],
      maxTotalVariants: 5,
    });
    expect(res.variants).toHaveLength(5);
    expect(res.truncated).toBe(true);
  });

  it('Python 対応20指標はすべて CrossoverEdgeTemplate でカバーされる', () => {
    const pythonSupportedIds = getPythonSupportedIndicators().map((i) => i.id).sort();
    const templatedIds = CROSSOVER_EDGE_TEMPLATES.map((tpl) => tpl.indicatorId).sort();
    expect(templatedIds).toEqual(pythonSupportedIds);
    expect(templatedIds).toHaveLength(20);
  });

  it('field 別 indicator は alias feature で variant 化され、SL/TP は変更されない', () => {
    const res = generateCrossoverIndicatorVariants(makeDsl('long'), {
      indicatorIds: ['macd', 'bb', 'kc', 'stochastic', 'ichimoku'],
      maxVariantsPerIndicator: 99,
    });
    expect(res.skippedIndicators).toEqual([]);
    expect(res.indicatorsUsed.sort()).toEqual(['bb', 'ichimoku', 'kc', 'macd', 'stochastic']);

    const addedConditions = res.variants.map((v) => triggerConditions(v.variant)[1] as Condition);
    expect(addedConditions.some((c) => c.feature === 'macd_histogram')).toBe(true);
    expect(addedConditions.some((c) => c.feature === 'stochastic_k')).toBe(true);
    expect(addedConditions.some((c) => c.compareTarget?.feature === 'bb_upper')).toBe(true);
    expect(addedConditions.some((c) => c.compareTarget?.feature === 'kc_upper')).toBe(true);
    expect(addedConditions.some((c) => c.compareTarget?.feature === 'ichimoku_kijun')).toBe(true);

    for (const v of res.variants) {
      expect(v.variant.stopLoss).toEqual({ type: 'atr_multiple', value: 1.5 });
      expect(v.variant.takeProfit).toEqual({ type: 'rr_ratio', value: 2.0 });
    }
  });

  it('生成 variant は全て schema-valid', () => {
    const res = generateCrossoverIndicatorVariants(makeDsl('long'), { indicatorIds: ['rsi', 'ema'] });
    for (const v of res.variants) {
      expect(() => StrategyDSLSchema.parse(v.variant)).not.toThrow();
    }
  });

  it('variant は親や他 variant と ConditionGroup 参照を共有しない（隔離）', () => {
    const parent = makeDsl('long');
    const res = generateCrossoverIndicatorVariants(parent, { indicatorIds: ['rsi'], maxVariantsPerIndicator: 3 });
    // 親の trigger 条件数は不変（追加されていない）。
    expect(triggerConditions(parent)).toHaveLength(1);
    // 各 variant の追加条件を書き換えても他 variant / 親に波及しない。
    const v0 = res.variants[0].variant;
    const v0conds = (v0.entry as { trigger: ConditionGroup }).trigger.conditions;
    (v0conds[1] as Condition).value = 999;
    expect((triggerConditions(res.variants[1].variant)[1] as Condition).value).not.toBe(999);
    expect(triggerConditions(parent)).toHaveLength(1);
  });

  it('OR ルートの trigger は sub-group 化して AND 追加（既存 OR 意味を保全）', () => {
    const dsl = makeDsl('long');
    (dsl.entry as { trigger: ConditionGroup }).trigger = {
      logic: 'OR',
      conditions: [
        { lens: 'ohlcv', feature: 'close', op: '>', value: 2000 },
        { lens: 'ohlcv', feature: 'close', op: '<', value: 1000 },
      ],
    };
    const res = generateCrossoverIndicatorVariants(dsl, { indicatorIds: ['rsi'], maxVariantsPerIndicator: 1 });
    const root = (res.variants[0].variant.entry as { trigger: ConditionGroup }).trigger;
    expect(root.logic).toBe('AND');
    expect(root.conditions).toHaveLength(2);
    // 先頭は元の OR グループ、2 番目が追加条件
    expect('logic' in root.conditions[0] && root.conditions[0].logic).toBe('OR');
  });
});
