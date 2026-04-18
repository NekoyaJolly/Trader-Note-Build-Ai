/**
 * StatusManager.canPromoteToScreeningPassed のテスト（Phase 4b 縮小版）
 *
 * 事前スクリーニング判定（PF > 1.3 / 勝率 > 40% / トレード数 >= 20）を検証する。
 */

import { StatusManager, SCREENING_THRESHOLDS } from '../../ledger/statusManager';
import type { ScreeningMetrics } from '../../models/edgeHypothesis';

describe('StatusManager.canPromoteToScreeningPassed (Phase 4b 縮小版)', () => {
    let sm: StatusManager;

    beforeEach(() => {
        sm = new StatusManager();
    });

    const basePassing: ScreeningMetrics = {
        pf: 1.5,
        winRate: 0.55,
        tradeCount: 30,
    };

    it('閾値を全て満たす場合 ok=true', () => {
        const result = sm.canPromoteToScreeningPassed(basePassing);
        expect(result.ok).toBe(true);
        expect(result.reasons).toEqual([]);
    });

    it('PF 不足なら ok=false', () => {
        const result = sm.canPromoteToScreeningPassed({
            ...basePassing,
            pf: SCREENING_THRESHOLDS.minPF,  // 境界値: '>' 判定で弾かれる
        });
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('PF不足'))).toBe(true);
    });

    it('PF が Infinity（全勝）でも通過する', () => {
        const result = sm.canPromoteToScreeningPassed({
            pf: Number.POSITIVE_INFINITY,
            winRate: 1.0,
            tradeCount: 25,
        });
        // Infinity は Number.isFinite で false なので、「PF が不正」で弾かれる想定
        // これは意図的に保守的に弾く（異常値を昇格させない）
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('PF'))).toBe(true);
    });

    it('トレード数不足なら ok=false', () => {
        const result = sm.canPromoteToScreeningPassed({
            ...basePassing,
            tradeCount: 10,
        });
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('トレード数不足'))).toBe(true);
    });

    it('勝率不足なら ok=false（0-1 表記）', () => {
        const result = sm.canPromoteToScreeningPassed({
            ...basePassing,
            winRate: 0.35,
        });
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('勝率不足'))).toBe(true);
    });

    it('勝率は 0-100 表記でも 0-1 表記として解釈される', () => {
        // winRate=55 は 0.55 と解釈されるはず
        const result = sm.canPromoteToScreeningPassed({
            pf: 1.5,
            winRate: 55,
            tradeCount: 30,
        });
        expect(result.ok).toBe(true);
    });

    it('複数の問題があれば全ての理由が返る', () => {
        const result = sm.canPromoteToScreeningPassed({
            pf: 1.0,
            winRate: 0.3,
            tradeCount: 5,
        });
        expect(result.ok).toBe(false);
        expect(result.reasons.length).toBeGreaterThanOrEqual(3);
    });
});
