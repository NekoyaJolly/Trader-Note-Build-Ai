/**
 * StatusManager.canPromoteToScreeningPassed のテスト（Phase 4b 縮小版）
 *
 * 事前スクリーニング判定（PF / トレード数 >= 20）を検証する。
 *
 * 2026-05-02 暫定緩和（PR #76）以降:
 *   - minPF: 1.3 → 1.1
 *   - minWinRate: 撤廃（勝率は ScreeningResult の参考値として保持されるが判定には使わない）
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

    // PR #76 暫定緩和: 勝率閾値を撤廃したため、低勝率でも PF が閾値を超えれば通過する
    it('勝率が低くても PF と tradeCount を満たせば ok=true（勝率閾値撤廃後）', () => {
        const result = sm.canPromoteToScreeningPassed({
            pf: 1.5,
            winRate: 0.25,
            tradeCount: 30,
        });
        expect(result.ok).toBe(true);
        expect(result.reasons.some((r) => r.includes('勝率'))).toBe(false);
    });

    it('PF 1.1 ジャストは閾値判定（>）で弾かれる', () => {
        const result = sm.canPromoteToScreeningPassed({
            ...basePassing,
            pf: 1.1,
        });
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('PF不足'))).toBe(true);
    });

    it('PF が 1.1 を超えれば（例: 1.15）通過する', () => {
        const result = sm.canPromoteToScreeningPassed({
            pf: 1.15,
            winRate: 0.30, // 勝率 30% でも通過するようになった
            tradeCount: 30,
        });
        expect(result.ok).toBe(true);
    });

    it('複数の問題があれば全ての理由が返る（PF 不足 + トレード数不足）', () => {
        const result = sm.canPromoteToScreeningPassed({
            pf: 1.0,
            winRate: 0.3,
            tradeCount: 5,
        });
        expect(result.ok).toBe(false);
        // 勝率閾値撤廃後は最大 2 件（PF 不足 / トレード数不足）になる
        expect(result.reasons.length).toBeGreaterThanOrEqual(2);
        expect(result.reasons.some((r) => r.includes('PF不足'))).toBe(true);
        expect(result.reasons.some((r) => r.includes('トレード数不足'))).toBe(true);
    });
});
