/**
 * dslToBacktestNotePayload のユニットテスト (Critical-4 段階 2)
 */

import { dslToBacktestNotePayload } from '../../strategy_dsl/dslToBacktestNotePayload';
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
            trigger: {
                logic: 'AND',
                conditions: [
                    { lens: 'rsi', feature: 'value', op: '<', value: 30 },
                ],
            },
            orderType: 'market',
        },
        stopLoss: { type: 'atr_multiple', value: 1.5 },
        takeProfit: { type: 'rr_ratio', value: 2.0 },
        parameters: {},
        metadata: { createdAt: new Date().toISOString(), createdBy: 'llm_generated' },
    };
    return { ...base, ...overrides };
}

describe('dslToBacktestNotePayload', () => {
    it('immediate entry の trigger を flat に展開して conditions[] に積む', () => {
        const payload = dslToBacktestNotePayload(makeDsl(), {});
        expect(payload.direction).toBe('long');
        expect(payload.conditions).toEqual([
            { lensName: 'rsi', featureKey: 'value', op: '<', value: 30 },
        ]);
        expect(payload.stopLoss).toEqual({ type: 'atr_multiple', value: 1.5 });
        expect(payload.takeProfit).toEqual({ type: 'rr_ratio', value: 2.0 });
        expect(payload.indicators).toEqual([]);
    });

    it('wait_for_trigger entry の triggerConditions も同様に flat 展開される', () => {
        const dsl = makeDsl({
            entry: {
                type: 'wait_for_trigger',
                direction: 'short',
                triggerConditions: {
                    logic: 'AND',
                    conditions: [
                        { lens: 'ohlcv', feature: 'close', op: '>', value: 2000 },
                    ],
                },
                maxWaitBars: 10,
                executionType: 'market',
            },
        });
        const payload = dslToBacktestNotePayload(dsl, {});
        expect(payload.direction).toBe('short');
        expect(payload.conditions).toEqual([
            { lensName: 'ohlcv', featureKey: 'close', op: '>', value: 2000 },
        ]);
    });

    it('ネストした ConditionGroup (AND の中の OR) も flat に展開', () => {
        const dsl = makeDsl({
            entry: {
                direction: 'long',
                trigger: {
                    logic: 'AND',
                    conditions: [
                        { lens: 'a', feature: 'f', op: '>', value: 1 },
                        {
                            logic: 'OR',
                            conditions: [
                                { lens: 'b', feature: 'g', op: '==', value: 2 },
                                { lens: 'c', feature: 'h', op: '<', value: 3 },
                            ],
                        },
                    ],
                },
                orderType: 'market',
            },
        });
        const payload = dslToBacktestNotePayload(dsl, {});
        expect(payload.conditions).toHaveLength(3);
        expect(payload.conditions.map((c) => c.lensName)).toEqual(['a', 'b', 'c']);
    });

    it('SL/TP の ParamRef ($p) は resolvedParams で数値に差し戻し', () => {
        const dsl = makeDsl({
            stopLoss: { type: 'atr_multiple', value: '$slMul' },
            takeProfit: { type: 'rr_ratio', value: '$rr' },
        });
        const payload = dslToBacktestNotePayload(dsl, { slMul: 2.5, rr: 3.0 });
        expect(payload.stopLoss).toEqual({ type: 'atr_multiple', value: 2.5 });
        expect(payload.takeProfit).toEqual({ type: 'rr_ratio', value: 3.0 });
    });

    it('解決できない ParamRef は型ごとの fallback 値に倒す', () => {
        const dsl = makeDsl({
            stopLoss: { type: 'atr_multiple', value: '$undefinedKey' },
            takeProfit: { type: 'rr_ratio', value: '$undefinedKey' },
        });
        const payload = dslToBacktestNotePayload(dsl, {});
        expect(payload.stopLoss).toEqual({ type: 'atr_multiple', value: 1.5 });
        expect(payload.takeProfit).toEqual({ type: 'rr_ratio', value: 2.0 });
    });

    it('swing_point の lookbackBars も resolve + 整数化', () => {
        const dsl = makeDsl({
            stopLoss: { type: 'swing_point', lookbackBars: '$lb' },
        });
        const payload = dslToBacktestNotePayload(dsl, { lb: 30 });
        expect(payload.stopLoss).toEqual({ type: 'swing_point', lookbackBars: 30 });
    });

    it('fixed_pips SL: 解決できない ParamRef でも positive value で fallback (Zod positive() を満たす)', () => {
        const dsl = makeDsl({
            stopLoss: { type: 'fixed_pips', value: '$missing' },
        });
        const payload = dslToBacktestNotePayload(dsl, {});
        expect(payload.stopLoss.type).toBe('fixed_pips');
        // fallback 1.0 で positive 確保
        expect(payload.stopLoss).toEqual({ type: 'fixed_pips', value: 1.0 });
    });

    it('SL/TP に 0 や負数が解決される場合も positive で clamp', () => {
        const dsl = makeDsl({
            stopLoss: { type: 'atr_multiple', value: '$zero' },
            takeProfit: { type: 'rr_ratio', value: '$negative' },
        });
        const payload = dslToBacktestNotePayload(dsl, { zero: 0, negative: -1.5 });
        // 0 / 負数 → fallback (atr_multiple→1.5, rr_ratio→2.0)
        expect(payload.stopLoss).toEqual({ type: 'atr_multiple', value: 1.5 });
        expect(payload.takeProfit).toEqual({ type: 'rr_ratio', value: 2.0 });
    });

    it('Condition.value の number 配列 (in 演算子用) は string[] に正規化', () => {
        const dsl = makeDsl({
            entry: {
                direction: 'long',
                trigger: {
                    logic: 'AND',
                    conditions: [
                        // 3 要素の number[] (tuple ではない、in 演算子相当)
                        { lens: 'state', feature: 'phase', op: 'in', value: [1, 2, 3] as unknown as string[] },
                    ],
                },
                orderType: 'market',
            },
        });
        const payload = dslToBacktestNotePayload(dsl, {});
        // analysis-engine の Zod schema は string[] のみ受けるので number → string 化
        expect(payload.conditions[0].value).toEqual(['1', '2', '3']);
    });

    it('Condition.value が ParamRef の場合も resolve、tuple/array はそのまま', () => {
        const dsl = makeDsl({
            entry: {
                direction: 'long',
                trigger: {
                    logic: 'AND',
                    conditions: [
                        { lens: 'rsi', feature: 'value', op: '<', value: '$threshold' },
                        { lens: 'a', feature: 'b', op: 'between', value: [10, 20] },
                    ],
                },
                orderType: 'market',
            },
        });
        const payload = dslToBacktestNotePayload(dsl, { threshold: 25 });
        expect(payload.conditions[0]).toEqual({
            lensName: 'rsi', featureKey: 'value', op: '<', value: 25,
        });
        expect(payload.conditions[1]).toEqual({
            lensName: 'a', featureKey: 'b', op: 'between', value: [10, 20],
        });
    });
});
