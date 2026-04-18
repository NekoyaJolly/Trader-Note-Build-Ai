/**
 * MachineReadableCondition 評価エンジンのテスト（Phase 4a）
 */

import { evaluateCondition, evaluateConditions } from '../../ledger/conditionMatcher';
import type { LensFeatureSnapshot, LensFeature } from '../../lenses';

function makeSnapshot(
    features: Record<string, Record<string, number | string | boolean>>,
): LensFeatureSnapshot {
    const map = new Map<string, LensFeature>();
    for (const [lensName, ff] of Object.entries(features)) {
        map.set(lensName, {
            lensName,
            lensVersion: '1.0.0',
            features: ff,
            computedAt: new Date(),
            computeDurationMs: 1,
            confidence: 0.9,
        });
    }
    return {
        timestamp: new Date(),
        symbol: 'XAUUSD',
        features: map,
        totalComputeDurationMs: 1,
    };
}

describe('evaluateCondition - 数値比較', () => {
    const snap = makeSnapshot({ volatility_regime: { bb_width_percentile: 25 } });

    it('< で成立', () => {
        expect(
            evaluateCondition(
                { lensName: 'volatility_regime', featureKey: 'bb_width_percentile', op: '<', value: 30 },
                snap,
            ),
        ).toBe(true);
    });

    it('< で不成立', () => {
        expect(
            evaluateCondition(
                { lensName: 'volatility_regime', featureKey: 'bb_width_percentile', op: '<', value: 20 },
                snap,
            ),
        ).toBe(false);
    });

    it('>= で境界値成立', () => {
        expect(
            evaluateCondition(
                { lensName: 'volatility_regime', featureKey: 'bb_width_percentile', op: '>=', value: 25 },
                snap,
            ),
        ).toBe(true);
    });

    it('between で範囲内', () => {
        expect(
            evaluateCondition(
                { lensName: 'volatility_regime', featureKey: 'bb_width_percentile', op: 'between', value: [20, 30] },
                snap,
            ),
        ).toBe(true);
    });

    it('between で範囲外', () => {
        expect(
            evaluateCondition(
                { lensName: 'volatility_regime', featureKey: 'bb_width_percentile', op: 'between', value: [30, 50] },
                snap,
            ),
        ).toBe(false);
    });
});

describe('evaluateCondition - カテゴリ', () => {
    const snap = makeSnapshot({ dow_theory: { trend_state: 'uptrend' } });

    it('== で成立', () => {
        expect(
            evaluateCondition(
                { lensName: 'dow_theory', featureKey: 'trend_state', op: '==', value: 'uptrend' },
                snap,
            ),
        ).toBe(true);
    });

    it('!= で成立', () => {
        expect(
            evaluateCondition(
                { lensName: 'dow_theory', featureKey: 'trend_state', op: '!=', value: 'range' },
                snap,
            ),
        ).toBe(true);
    });

    it('in で成立', () => {
        expect(
            evaluateCondition(
                {
                    lensName: 'dow_theory',
                    featureKey: 'trend_state',
                    op: 'in',
                    value: ['uptrend', 'downtrend'],
                },
                snap,
            ),
        ).toBe(true);
    });

    it('in で不成立', () => {
        expect(
            evaluateCondition(
                {
                    lensName: 'dow_theory',
                    featureKey: 'trend_state',
                    op: 'in',
                    value: ['range', 'unclear'],
                },
                snap,
            ),
        ).toBe(false);
    });
});

describe('evaluateCondition - 欠損値', () => {
    const snap = makeSnapshot({ dow_theory: { trend_state: 'uptrend' } });

    it('レンズが存在しないと false', () => {
        expect(
            evaluateCondition(
                { lensName: 'unknown_lens', featureKey: 'x', op: '==', value: 'y' },
                snap,
            ),
        ).toBe(false);
    });

    it('feature が存在しないと false', () => {
        expect(
            evaluateCondition(
                { lensName: 'dow_theory', featureKey: 'unknown_key', op: '==', value: 'y' },
                snap,
            ),
        ).toBe(false);
    });

    it('型ミスマッチ（文字列 < 数値）は false', () => {
        expect(
            evaluateCondition(
                { lensName: 'dow_theory', featureKey: 'trend_state', op: '<', value: 5 },
                snap,
            ),
        ).toBe(false);
    });
});

describe('evaluateConditions - AND 評価', () => {
    const snap = makeSnapshot({
        dow_theory: { trend_state: 'uptrend' },
        volatility_regime: { bb_width_percentile: 25 },
    });

    it('全て成立で true', () => {
        expect(
            evaluateConditions(
                [
                    { lensName: 'dow_theory', featureKey: 'trend_state', op: '==', value: 'uptrend' },
                    {
                        lensName: 'volatility_regime',
                        featureKey: 'bb_width_percentile',
                        op: '<',
                        value: 30,
                    },
                ],
                snap,
            ),
        ).toBe(true);
    });

    it('1つでも不成立で false', () => {
        expect(
            evaluateConditions(
                [
                    { lensName: 'dow_theory', featureKey: 'trend_state', op: '==', value: 'uptrend' },
                    {
                        lensName: 'volatility_regime',
                        featureKey: 'bb_width_percentile',
                        op: '>',
                        value: 50,
                    },
                ],
                snap,
            ),
        ).toBe(false);
    });

    it('空配列は false（意味のない仮説）', () => {
        expect(evaluateConditions([], snap)).toBe(false);
    });
});
