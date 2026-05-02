/**
 * StatusManager — エッジ仮説のステータス遷移判定（Phase 4a）
 *
 * 設計思想（CLAUDE.md 原則5）:
 * 昇格判定は「学習期間 PF > 1.5」「検証期間 PF > 1.3」「過学習スコア < 0.3」の
 * 3条件を満たす時のみ true を返す。閾値は設計書で議論される場合のみ変更可。
 *
 * Phase 4a では canPromoteToConfirmed / shouldMarkStale のロジック本体だけ実装し、
 * 実際のステータス遷移呼び出し（confirmed への昇格）は Phase 4b の EdgeValidator
 * が完了してから配線する。
 *
 * @see docs/design/phase_4_specification.md セクション4.3
 */

import type {
    EdgeHypothesis,
    ScreeningMetrics,
    ConsolidatedValidationReport,
} from '../models/edgeHypothesis';
import { VALIDATION_THRESHOLDS } from '../config/validationThresholds';

/** CLAUDE.md で規定された昇格基準（勝手に緩めない） */
export const PROMOTION_THRESHOLDS = Object.freeze({
    /** 学習期間バックテスト PF 下限 */
    trainingPF: 1.5,
    /** 検証期間バックテスト PF 下限（Phase 4b で実装時に使用） */
    validationPF: 1.3,
    /** ウォークフォワード過学習スコア上限 */
    overfitScore: 0.3,
});

/**
 * Phase 4b 縮小版: 事前スクリーニング通過基準（暫定値）
 *
 * 本昇格（confirmed）の基準より意図的に緩い粗フィルタ。
 * 明らかな損失戦略 / データ不足の仮説を弾き、
 * Phase 4c の重い検証（WF/MC/BH）に投入する前の絞り込みに使う。
 *
 * 2026-05-02 暫定緩和（PR #76、Critical-10 一環）:
 *   設計書 `docs/design/phase_4b_specification.md:594` の「閾値は暫定、運用後調整」発動。
 *   24h 観測(PR #74) で screening_passed=0 件、PDCA-2 が永続的に空回りしていたため、
 *   最低限 PDCA を一巡させる目的で以下を緩和:
 *     - minPF: 1.3 → 1.1 (PDCA 動作確認のための一時緩和)
 *     - minWinRate: 0.4 → 撤廃 (RR>=2.0 推奨で運用しているため、勝率は参考値に留める)
 *   一定期間運用してデータが集まったら、閾値を再評価して戻す前提。
 *
 * TODO(Phase 4c): 環境変数で外部化して運用後に調整できるようにする。
 */
export const SCREENING_THRESHOLDS = Object.freeze({
    /** Side-A BT PF 下限（本昇格 1.5 より緩い、2026-05-02 に 1.3→1.1 へ暫定緩和） */
    minPF: 1.1,
    /** 最低トレード数（統計的有意性の最低限） */
    minTradeCount: 20,
});

/** 劣化判定のデフォルトパラメータ */
export const STALE_DEFAULTS = Object.freeze({
    /** 直近観測で勝率評価を始める最小観測数 */
    minObservations: 10,
    /** 期待勝率との乖離幅（0.2 = 20ポイント）で stale とみなす */
    winRateDivergence: 0.2,
});

// ===========================================
// 判定結果型
// ===========================================

export interface PromoteCheck {
    ok: boolean;
    reasons: string[];
}

export interface StaleCheck {
    yes: boolean;
    reason?: string;
}

/**
 * Phase 4b 縮小版: スクリーニング判定の結果
 */
export interface ScreeningCheck {
    ok: boolean;
    reasons: string[];
}

// ===========================================
// StatusManager 本体
// ===========================================

export class StatusManager {
    /**
     * unverified / testing → confirmed への昇格可否を判定する。
     *
     * **Phase 4b（Q3 採用）**: WF 結果のみに依存する。
     * `walkForwardService` が IS/OOS で `runBacktest` を呼ぶため、
     * 学習PF（avgInSamplePF）/ 検証PF（avgOutOfSamplePF）/ 過学習スコアの3指標が
     * すべて WalkForwardSummary から取得できる。
     *
     * 全ての条件が true の場合のみ ok=true を返す。
     */
    canPromoteToConfirmed(hyp: EdgeHypothesis): PromoteCheck {
        const reasons: string[] = [];

        if (!hyp.walkForwardResults) {
            reasons.push('ウォークフォワード未実施');
            return { ok: false, reasons };
        }

        const wf = hyp.walkForwardResults;

        // 学習期間 PF（avgInSamplePF）
        if (wf.avgInSamplePF === undefined || wf.avgInSamplePF === null) {
            reasons.push('学習期間 PF が記録されていない（avgInSamplePF）');
        } else if (wf.avgInSamplePF < PROMOTION_THRESHOLDS.trainingPF) {
            reasons.push(
                `学習期間 PF 不足: ${wf.avgInSamplePF.toFixed(3)} < ${PROMOTION_THRESHOLDS.trainingPF}`,
            );
        }

        // 検証期間 PF（avgOutOfSamplePF）
        if (wf.avgOutOfSamplePF === undefined || wf.avgOutOfSamplePF === null) {
            reasons.push('検証期間 PF が記録されていない（avgOutOfSamplePF）');
        } else if (wf.avgOutOfSamplePF < PROMOTION_THRESHOLDS.validationPF) {
            reasons.push(
                `検証期間 PF 不足: ${wf.avgOutOfSamplePF.toFixed(3)} < ${PROMOTION_THRESHOLDS.validationPF}`,
            );
        }

        // 過学習スコア
        if (wf.overfitScore > PROMOTION_THRESHOLDS.overfitScore) {
            reasons.push(
                `過学習スコア超過: ${wf.overfitScore.toFixed(3)} > ${PROMOTION_THRESHOLDS.overfitScore}`,
            );
        }

        // トレード数（統計的有意性の最低限）
        const tradeCount = wf.totalTradeCount ?? 0;
        if (tradeCount < 20) {
            reasons.push(`総トレード数不足: ${tradeCount} (必要20以上)`);
        }

        return { ok: reasons.length === 0, reasons };
    }

    /**
     * Phase 4b 縮小版: 事前スクリーニング通過可否を判定する。
     *
     * 本昇格（confirmed）とは別の粗いフィルタ。Side-A BacktestService の結果
     * （PF / tradeCount）に対して `SCREENING_THRESHOLDS` を適用する。
     *
     * 2026-05-02 暫定緩和（PR #76）以降、勝率閾値は撤廃。winRate は ScreeningResult
     * の metrics に参考値として保持されるが、screening 通過判定には使わない。
     *
     * @param metrics Side-A BT の要約メトリクス
     * @returns ok=true の場合のみ `screening_passed` に昇格可能
     */
    canPromoteToScreeningPassed(metrics: ScreeningMetrics): ScreeningCheck {
        const reasons: string[] = [];

        // PF
        if (!Number.isFinite(metrics.pf)) {
            reasons.push('PF が不正');
        } else if (metrics.pf <= SCREENING_THRESHOLDS.minPF) {
            reasons.push(
                `PF不足: ${metrics.pf.toFixed(3)} <= ${SCREENING_THRESHOLDS.minPF}`,
            );
        }

        // trade count
        if (metrics.tradeCount < SCREENING_THRESHOLDS.minTradeCount) {
            reasons.push(
                `トレード数不足: ${metrics.tradeCount} < ${SCREENING_THRESHOLDS.minTradeCount}`,
            );
        }

        return { ok: reasons.length === 0, reasons };
    }

    /**
     * Phase 4c: 4ツール統合レポートに基づく confirmed 昇格判定。
     *
     * Phase 4b 縮小版の `canPromoteToScreeningPassed` を通過した仮説に対し、
     * BacktesterAgent が算出した ConsolidatedValidationReport を評価する。
     *
     * 判定基準（全て true で ok=true）:
     *   1. screening が passed
     *   2. walkForward が実行され passed（overfitScore < 0.3 相当）
     *   3. monteCarlo が実行され passed（下側5%PnL > 0 相当）
     *   4. buyAndHold が実行され passed（BH 比 +0.5% 以上相当）
     *   5. スクリーニング時のトレード数が最低 `MIN_TRADE_COUNT` 以上
     *
     * 各ツールの passed 判定そのものは個別ツール内で行う（ここでは
     * 「走ったか」「通ったか」だけをチェックする）。
     */
    canPromoteToConfirmedFull(
        _hyp: EdgeHypothesis,
        report: ConsolidatedValidationReport,
    ): PromoteCheck {
        const reasons: string[] = [];

        // 1. screening
        if (!report.screening) {
            reasons.push('スクリーニング未実施');
        } else if (!report.screening.passed) {
            reasons.push('事前スクリーニング未通過');
        }

        // 2. walkForward
        if (!report.walkForward) {
            reasons.push('WalkForward 未実施 or 実行失敗');
        } else if (!report.walkForward.passed) {
            const m = report.walkForward.metrics;
            const score = typeof m.overfitScore === 'number' ? m.overfitScore.toFixed(3) : String(m.overfitScore ?? 'N/A');
            reasons.push(`過学習スコア超過: ${score}`);
        }

        // 3. monteCarlo
        if (!report.monteCarlo) {
            reasons.push('MonteCarlo 未実施 or 実行失敗');
        } else if (!report.monteCarlo.passed) {
            const m = report.monteCarlo.metrics;
            const p5 = typeof m.p5FinalPnl === 'number' ? m.p5FinalPnl.toFixed(2) : String(m.p5FinalPnl ?? 'N/A');
            reasons.push(`MonteCarlo 下側5%PnL マイナス: ${p5}`);
        }

        // 4. buyAndHold
        if (!report.buyAndHold) {
            reasons.push('BuyAndHold 未実施 or 実行失敗');
        } else if (!report.buyAndHold.passed) {
            const m = report.buyAndHold.metrics;
            const op = typeof m.outperformance === 'number' ? (m.outperformance * 100).toFixed(2) + '%' : String(m.outperformance ?? 'N/A');
            reasons.push(`BuyAndHold を上回れず: ${op}`);
        }

        // 5. 最低トレード数（screening の metrics.tradeCount を参照）
        const screeningTradeCount = report.screening?.metrics?.tradeCount;
        const tradeCount = typeof screeningTradeCount === 'number' ? screeningTradeCount : 0;
        if (tradeCount < VALIDATION_THRESHOLDS.common.minTradeCount) {
            reasons.push(`トレード数不足: ${tradeCount} < ${VALIDATION_THRESHOLDS.common.minTradeCount}`);
        }

        return { ok: reasons.length === 0, reasons };
    }

    /**
     * confirmed 仮説が劣化（stale）したか判定する。
     *
     * 直近観測で実績勝率が期待勝率を大きく下回った場合に yes=true。
     * 観測数が不足している場合は yes=false（早すぎる判定を避ける）。
     */
    shouldMarkStale(
        hyp: EdgeHypothesis,
        options?: { minObservations?: number; winRateDivergence?: number },
    ): StaleCheck {
        const minObs = options?.minObservations ?? STALE_DEFAULTS.minObservations;
        const divergence = options?.winRateDivergence ?? STALE_DEFAULTS.winRateDivergence;

        if (hyp.observationCount < minObs) {
            return { yes: false };
        }

        // Phase 4b: WF の avgOutOfSampleWinRate を期待勝率の主とする
        // 既存 backtestResults.winRate にもフォールバック（Phase 4a 互換）
        const expected =
            hyp.walkForwardResults?.avgOutOfSampleWinRate ?? hyp.backtestResults?.winRate;
        if (expected === undefined) {
            // 期待勝率が無ければ劣化判定は保留
            return { yes: false };
        }

        const decided = hyp.winCount + hyp.lossCount;
        if (decided === 0) return { yes: false };

        const actual = hyp.winCount / decided;
        if (actual < expected - divergence) {
            return {
                yes: true,
                reason: `実績勝率が期待値を大幅に下回る: 期待 ${expected.toFixed(2)} / 実績 ${actual.toFixed(2)}`,
            };
        }

        return { yes: false };
    }
}

export const statusManager = new StatusManager();
