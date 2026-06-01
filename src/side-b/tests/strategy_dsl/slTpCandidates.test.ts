/**
 * 進化ループ再設計 Phase 2: slTpCandidatesFromDsl のユニットテスト。
 */

import { slTpCandidatesFromDsl } from '../../strategy_dsl/slTpCandidates';
import type { StrategyDSL } from '../../strategy_dsl/schema';

function makeDsl(overrides?: Partial<StrategyDSL>): StrategyDSL {
  const base: StrategyDSL = {
    id: 'dsl-1',
    generation: 0,
    parentIds: [],
    regimeTarget: 'trend',
    symbol: 'XAUUSD',
    timeframe: '15m',
    entry: {
      direction: 'long',
      trigger: { logic: 'AND', conditions: [{ lens: 'rsi', feature: 'value', op: '<', value: 30 }] },
      orderType: 'market',
    },
    stopLoss: { type: 'atr_multiple', value: 1.5 },
    takeProfit: { type: 'rr_ratio', value: 2.0 },
    parameters: {},
    metadata: { createdAt: '2026-06-02T00:00:00.000Z', createdBy: 'mutation' },
  };
  return { ...base, ...overrides };
}

describe('slTpCandidatesFromDsl', () => {
  it('atr_multiple SL=1.5 / rr_ratio TP=2.0 を ±20%/3点で振る', () => {
    const res = slTpCandidatesFromDsl(makeDsl());
    // SL: [1.2, 1.5, 1.8], TP: [1.6, 2.0, 2.4]
    expect(res.slValues).toEqual([1.2, 1.5, 1.8]);
    expect(res.tpValues).toEqual([1.6, 2.0, 2.4]);
    expect(res.slValues).toContain(1.5); // current 含む
    expect(res.tpValues).toContain(2.0);
  });

  it('swing_point SL は value を持たないため slValues は空', () => {
    const res = slTpCandidatesFromDsl(
      makeDsl({ stopLoss: { type: 'swing_point', lookbackBars: 20 } }),
    );
    expect(res.slValues).toEqual([]);
    expect(res.tpValues).toEqual([1.6, 2.0, 2.4]); // TP は生成される
  });

  it('ParamRef ($sl) は parameters の default で解決して候補生成', () => {
    const res = slTpCandidatesFromDsl(
      makeDsl({
        stopLoss: { type: 'atr_multiple', value: '$sl' },
        parameters: { sl: { range: [1, 3], default: 2.0, type: 'float' } },
      }),
    );
    expect(res.slValues).toEqual([1.6, 2.0, 2.4]);
  });

  it('解決不能な ParamRef は候補なし（空配列）', () => {
    const res = slTpCandidatesFromDsl(
      makeDsl({ stopLoss: { type: 'atr_multiple', value: '$missing' }, parameters: {} }),
    );
    expect(res.slValues).toEqual([]);
  });

  it('points / pct を指定でき、5点・±30% も生成できる', () => {
    const res = slTpCandidatesFromDsl(makeDsl(), { pct: 0.3, points: 5 });
    // SL=1.5 ±30% 5点。端点と中央（current）を検証（中間点は float 丸めに依存）。
    expect(res.slValues).toHaveLength(5);
    expect(res.slValues[0]).toBe(1.05); // 1.5*0.7
    expect(res.slValues[4]).toBe(1.95); // 1.5*1.3
    expect(res.slValues).toContain(1.5); // current
    expect(res.slValues.every((v) => v > 0)).toBe(true);
    // 昇順・小数 2 桁
    expect([...res.slValues].sort((a, b) => a - b)).toEqual(res.slValues);
  });

  it('偶数 points は奇数に正規化される（current を中央に含む）', () => {
    const res = slTpCandidatesFromDsl(makeDsl(), { points: 4 });
    expect(res.slValues).toContain(1.5);
    expect(res.slValues.length).toBe(5); // 4→5 に正規化
  });

  it('非 finite な points / pct は既定にフォールバックしてハングしない', () => {
    const res = slTpCandidatesFromDsl(makeDsl(), { points: Infinity, pct: Infinity });
    // Infinity 混入や無限ループにならず、既定 ±20%/3点で生成される。
    expect(res.slValues).toEqual([1.2, 1.5, 1.8]);
    expect(res.slValues.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('負の pct は既定にフォールバック（反転レンジを防ぐ）', () => {
    const res = slTpCandidatesFromDsl(makeDsl(), { pct: -0.5 });
    expect(res.slValues).toEqual([1.2, 1.5, 1.8]);
  });
});
