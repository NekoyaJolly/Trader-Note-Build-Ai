/**
 * MonteCarloTool（Phase 4c）
 *
 * Side-A BacktestRun のトレード損益列をランダムにリサンプリング（既定
 * 1000回）し、最終 PnL と最大ドローダウンの分布を推定する。
 *
 * 判定基準:
 *   5%信頼区間下側の最終 PnL が 0 以上（= 悪いほうの 5% が損失でない）
 *
 * TypeScript 自前実装を採用（Python 起動コスト不要、数十行で完結）。
 *
 * @see docs/design/phase_4c_specification.md §4.6
 */

import { backtestService as defaultBacktestService, type BacktestService } from '../../../services/backtestService';
import { VALIDATION_THRESHOLDS } from '../../config/validationThresholds';
import type {
    ValidationTool,
    ValidationToolInput,
    ValidationToolResult,
} from './types';

// ===========================================
// 確率的ユーティリティ（DI 可能）
// ===========================================

/** 乱数生成器。テストで決定的乱数を注入できるよう interface 化 */
export type RandomSource = () => number;

/**
 * Fisher-Yates シャッフル（非破壊）
 * インプレース版を避けて呼び出し側で配列を共有しやすくする。
 */
export function shuffle<T>(arr: readonly T[], rand: RandomSource = Math.random): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/**
 * 1回のパスでの最終 PnL と最大ドローダウンを算出する。
 * ドローダウンは累積 PnL のピークからの下落幅（正の値）。
 */
export function simulatePath(pnls: readonly number[]): { finalPnl: number; maxDrawdown: number } {
    let cum = 0;
    let peak = 0;
    let maxDD = 0;
    for (const pnl of pnls) {
        cum += pnl;
        if (cum > peak) peak = cum;
        const dd = peak - cum;
        if (dd > maxDD) maxDD = dd;
    }
    return { finalPnl: cum, maxDrawdown: maxDD };
}

/**
 * 事前ソート不要のパーセンタイル計算（補間なし、nearest-rank）
 * q は 0-1 の区間。空配列の場合は NaN を返す。
 */
export function percentile(sortedAsc: readonly number[], q: number): number {
    if (sortedAsc.length === 0) return Number.NaN;
    const clamped = Math.min(Math.max(q, 0), 1);
    const index = Math.min(
        sortedAsc.length - 1,
        Math.max(0, Math.floor(clamped * sortedAsc.length)),
    );
    return sortedAsc[index];
}

// ===========================================
// Tool 本体
// ===========================================

export interface MonteCarloToolConfig {
    rng?: RandomSource;
    /** リサンプリング回数（省略時は VALIDATION_THRESHOLDS.monteCarlo.simulationCount） */
    simulationCount?: number;
    /** p5 最低許容値（省略時は VALIDATION_THRESHOLDS.monteCarlo.p5MinFinalPnl） */
    p5MinFinalPnl?: number;
    /** 最小トレード数（省略時は VALIDATION_THRESHOLDS.common.minTradeCount） */
    minTradeCount?: number;
}

export class MonteCarloTool implements ValidationTool {
    readonly name = 'monte_carlo';
    readonly implementation = 'native_ts' as const;
    readonly requiredInputs: (keyof ValidationToolInput)[] = ['hypothesis', 'backtestRunId'];

    private readonly rng: RandomSource;
    private readonly simulationCount: number;
    private readonly p5MinFinalPnl: number;
    private readonly minTradeCount: number;

    constructor(
        private readonly backtestService: BacktestService = defaultBacktestService,
        config: MonteCarloToolConfig = {},
    ) {
        this.rng = config.rng ?? Math.random;
        this.simulationCount = config.simulationCount ?? VALIDATION_THRESHOLDS.monteCarlo.simulationCount;
        this.p5MinFinalPnl = config.p5MinFinalPnl ?? VALIDATION_THRESHOLDS.monteCarlo.p5MinFinalPnl;
        this.minTradeCount = config.minTradeCount ?? VALIDATION_THRESHOLDS.common.minTradeCount;
    }

    async execute(input: ValidationToolInput): Promise<ValidationToolResult> {
        const start = Date.now();

        if (!input.backtestRunId) {
            return this.fail('backtestRunId が未指定（Phase 4b screening 結果が必要）', start);
        }

        let summary;
        try {
            summary = await this.backtestService.getResult(input.backtestRunId);
        } catch (err) {
            return this.fail(`BT 結果取得失敗: ${err instanceof Error ? err.message : String(err)}`, start);
        }
        if (!summary) {
            return this.fail(`BT 結果が見つからない (runId=${input.backtestRunId})`, start);
        }

        const pnls = summary.events
            .map((e) => e.pnl)
            .filter((p): p is number => typeof p === 'number' && Number.isFinite(p));

        if (pnls.length < this.minTradeCount) {
            return {
                toolName: this.name,
                success: true,
                passed: false,
                metrics: {
                    tradeCount: pnls.length,
                    reason: 'insufficient_trades',
                },
                interpretation: `トレード数不足: ${pnls.length} < ${this.minTradeCount}`,
                durationMs: Date.now() - start,
            };
        }

        // N 回リサンプリング
        const finalPnls: number[] = [];
        const maxDrawdowns: number[] = [];
        for (let i = 0; i < this.simulationCount; i++) {
            const shuffled = shuffle(pnls, this.rng);
            const { finalPnl, maxDrawdown } = simulatePath(shuffled);
            finalPnls.push(finalPnl);
            maxDrawdowns.push(maxDrawdown);
        }

        const finalPnlsSorted = finalPnls.slice().sort((a, b) => a - b);
        const drawdownsSorted = maxDrawdowns.slice().sort((a, b) => a - b);

        const p5FinalPnl = percentile(finalPnlsSorted, 0.05);
        const medianFinalPnl = percentile(finalPnlsSorted, 0.5);
        const p95FinalPnl = percentile(finalPnlsSorted, 0.95);
        const medianMaxDrawdown = percentile(drawdownsSorted, 0.5);
        const p95MaxDrawdown = percentile(drawdownsSorted, 0.95);

        const passed = p5FinalPnl > this.p5MinFinalPnl;

        return {
            toolName: this.name,
            success: true,
            passed,
            metrics: {
                tradeCount: pnls.length,
                simulationCount: this.simulationCount,
                p5FinalPnl,
                medianFinalPnl,
                p95FinalPnl,
                medianMaxDrawdown,
                p95MaxDrawdown,
            },
            interpretation: passed
                ? `下側5%最終PnL=${p5FinalPnl.toFixed(2)} > ${this.p5MinFinalPnl}（下振れでも損失にならない）`
                : `下側5%最終PnL=${p5FinalPnl.toFixed(2)} <= ${this.p5MinFinalPnl}（下振れ時に損失の可能性）`,
            durationMs: Date.now() - start,
        };
    }

    async isAvailable(): Promise<boolean> {
        return true; // TS 自前実装のため常に利用可能
    }

    private fail(reason: string, start: number): ValidationToolResult {
        return {
            toolName: this.name,
            success: false,
            passed: false,
            metrics: {},
            error: reason,
            durationMs: Date.now() - start,
        };
    }
}

export const monteCarloTool = new MonteCarloTool();
