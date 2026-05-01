/**
 * BuyAndHoldTool（Phase 4c）
 *
 * 戦略が「市場全体の動きに乗っただけ」でないかを検証する。
 * 対象期間の始値・終値から BH リターンを算出し、戦略の累積リターンと比較する。
 *
 * 判定基準（暫定、運用後に調整予定）:
 *   戦略リターン − BH リターン > 0.005（0.5%）
 *
 * 実装注意:
 * - 戦略リターンは簡易推定: sum(event.pnl) / 始値。
 *   これは「1単位のポジションサイズで累積したときの始値比での比率」で、
 *   厳密な複利リターンではない。Phase 4c で運用開始してから必要に応じて改善。
 * - OHLCV は Side-A の OHLCVRepository から取得（symbol は `/` を除去して正規化）。
 *
 * @see docs/design/phase_4c_specification.md §4.7
 */

import { backtestService as defaultBacktestService, type BacktestService } from '../../../services/backtestService';
import { OHLCVRepository } from '../../../backend/repositories/ohlcvRepository';
import { VALIDATION_THRESHOLDS } from '../../config/validationThresholds';
import type {
    HypothesisValidationInput,
    StrategyValidationInput,
    ValidationTool,
    ValidationToolInput,
    ValidationToolResult,
} from './types';
import { isStrategyValidationInput } from './types';

// ===========================================
// ヘルパー
// ===========================================

/** 取引所表記のシンボルを OHLCV 保存形式に合わせる（XAU/USD → XAUUSD） */
function normalizeSymbol(symbol: string): string {
    return symbol.replace('/', '');
}

// ===========================================
// Tool 本体
// ===========================================

export interface BuyAndHoldToolConfig {
    /** 優位性（比率）の下限。省略時は VALIDATION_THRESHOLDS.buyAndHold.minOutperformance */
    minOutperformance?: number;
}

export class BuyAndHoldTool implements ValidationTool {
    readonly name = 'buy_and_hold';
    readonly implementation = 'native_ts' as const;
    readonly requiredInputs: readonly string[] = ['kind', 'hypothesis', 'backtestRunId', 'period'];

    private readonly minOutperformance: number;

    constructor(
        private readonly backtestService: BacktestService = defaultBacktestService,
        private readonly ohlcvRepo: OHLCVRepository = new OHLCVRepository(),
        config: BuyAndHoldToolConfig = {},
    ) {
        this.minOutperformance = config.minOutperformance ?? VALIDATION_THRESHOLDS.buyAndHold.minOutperformance;
    }

    async execute(input: ValidationToolInput): Promise<ValidationToolResult> {
        if (isStrategyValidationInput(input)) {
            return this.executeStrategy(input, Date.now());
        }
        return this.executeHypothesis(input, Date.now());
    }

    private async executeHypothesis(
        input: HypothesisValidationInput,
        start: number,
    ): Promise<ValidationToolResult> {
        if (!input.backtestRunId) {
            return this.fail('backtestRunId が未指定（Phase 4b screening 結果が必要）', start);
        }
        const symbol = input.hypothesis.symbols[0];
        const timeframe = input.hypothesis.timeframes[0];
        if (!symbol || !timeframe) {
            return this.fail('hypothesis.symbols / timeframes が空', start);
        }

        // 1. BH: 期間の始値と終値
        const normalizedSymbol = normalizeSymbol(symbol);
        const startDate = new Date(input.period.start);
        const endDate = new Date(input.period.end);
        if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
            return this.fail(`period が不正: ${input.period.start} ~ ${input.period.end}`, start);
        }

        let firstBar, lastBar;
        try {
            [firstBar, lastBar] = await Promise.all([
                this.ohlcvRepo
                    .findMany({ symbol: normalizedSymbol, timeframe, startTime: startDate, orderBy: 'asc', limit: 1 })
                    .then((rows) => rows[0] ?? null),
                this.ohlcvRepo
                    .findMany({ symbol: normalizedSymbol, timeframe, endTime: endDate, orderBy: 'desc', limit: 1 })
                    .then((rows) => rows[0] ?? null),
            ]);
        } catch (err) {
            return this.fail(`OHLCV 取得失敗: ${err instanceof Error ? err.message : String(err)}`, start);
        }

        if (!firstBar || !lastBar) {
            return this.fail(
                `OHLCV データ不足 (symbol=${normalizedSymbol} tf=${timeframe} ${input.period.start}~${input.period.end})`,
                start,
            );
        }
        const startClose = Number(firstBar.close);
        const endClose = Number(lastBar.close);
        if (!(startClose > 0)) {
            return this.fail(`startClose が不正: ${startClose}`, start);
        }
        const buyAndHoldReturn = (endClose - startClose) / startClose;

        // 2. 戦略リターン: BT 結果から sum(event.pnl) / startClose
        let summary;
        try {
            summary = await this.backtestService.getResult(input.backtestRunId);
        } catch (err) {
            return this.fail(`BT 結果取得失敗: ${err instanceof Error ? err.message : String(err)}`, start);
        }
        if (!summary) {
            return this.fail(`BT 結果が見つからない (runId=${input.backtestRunId})`, start);
        }

        const totalPnl = summary.events.reduce((sum, e) => {
            return typeof e.pnl === 'number' && Number.isFinite(e.pnl) ? sum + e.pnl : sum;
        }, 0);
        const strategyReturn = totalPnl / startClose;

        // ショート仮説の場合は BH 逆張りと比較（下落相場で BH は損だが戦略は勝てる想定）
        // 簡易実装としては、direction='short' の仮説は -bhReturn を基準に比較する。
        const direction = input.hypothesis.expectedDirection;
        const comparableBhReturn = direction === 'short' ? -buyAndHoldReturn : buyAndHoldReturn;

        const outperformance = strategyReturn - comparableBhReturn;
        const passed = outperformance > this.minOutperformance;

        const periodDays = Math.max(
            1,
            Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
        );

        return {
            toolName: this.name,
            success: true,
            passed,
            metrics: {
                buyAndHoldReturn,
                strategyReturn,
                outperformance,
                startClose,
                endClose,
                tradeCount: summary.setupCount,
                periodDays,
                comparisonDirection: direction,
            },
            interpretation: passed
                ? `戦略が BH を +${(outperformance * 100).toFixed(2)}pt 上回る（通過）`
                : `戦略が BH 対比 ${(outperformance * 100).toFixed(2)}pt で閾値 ${(this.minOutperformance * 100).toFixed(2)}pt 未達`,
            durationMs: Date.now() - start,
        };
    }

    /**
     * Phase 6.7b: DSLBacktestResult.finalReturn（検証期間）と B&H を比較
     */
    private async executeStrategy(
        input: StrategyValidationInput,
        start: number,
    ): Promise<ValidationToolResult> {
        const { strategy, period, dslResult } = input;
        const symbol = strategy.symbol;
        const timeframe = strategy.timeframe;
        if (!symbol || !timeframe) {
            return this.fail('strategy.symbol / timeframe が空', start);
        }
        const normalizedSymbol = normalizeSymbol(symbol);
        const startDate = new Date(period.start);
        const endDate = new Date(period.end);
        if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
            return this.fail(`period が不正: ${period.start} ~ ${period.end}`, start);
        }

        let firstBar, lastBar;
        try {
            [firstBar, lastBar] = await Promise.all([
                this.ohlcvRepo
                    .findMany({ symbol: normalizedSymbol, timeframe, startTime: startDate, orderBy: 'asc', limit: 1 })
                    .then((rows) => rows[0] ?? null),
                this.ohlcvRepo
                    .findMany({ symbol: normalizedSymbol, timeframe, endTime: endDate, orderBy: 'desc', limit: 1 })
                    .then((rows) => rows[0] ?? null),
            ]);
        } catch (err) {
            return this.fail(`OHLCV 取得失敗: ${err instanceof Error ? err.message : String(err)}`, start);
        }

        if (!firstBar || !lastBar) {
            return this.fail(
                `OHLCV データ不足 (symbol=${normalizedSymbol} tf=${timeframe} ${period.start}~${period.end})`,
                start,
            );
        }
        const startClose = Number(firstBar.close);
        const endClose = Number(lastBar.close);
        if (!(startClose > 0)) {
            return this.fail(`startClose が不正: ${startClose}`, start);
        }
        const buyAndHoldReturn = (endClose - startClose) / startClose;
        const strategyReturn = dslResult.finalReturn;
        const direction = strategy.entry.direction;
        const comparableBhReturn = direction === 'short' ? -buyAndHoldReturn : buyAndHoldReturn;
        const outperformance = strategyReturn - comparableBhReturn;
        const passed = outperformance > this.minOutperformance;
        const periodDays = Math.max(
            1,
            Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
        );
        return {
            toolName: this.name,
            success: true,
            passed,
            metrics: {
                buyAndHoldReturn,
                strategyReturn,
                outperformance,
                startClose,
                endClose,
                tradeCount: dslResult.events.length,
                periodDays,
                comparisonDirection: direction,
                executionModel: dslResult.executionModel,
                executionConfigHash: dslResult.executionConfigHash,
            },
            interpretation: passed
                ? `戦略が BH を +${(outperformance * 100).toFixed(2)}pt 上回る（通過）`
                : `戦略が BH 対比 ${(outperformance * 100).toFixed(2)}pt で閾値 ${(this.minOutperformance * 100).toFixed(2)}pt 未達`,
            durationMs: Date.now() - start,
        };
    }

    async isAvailable(): Promise<boolean> {
        return true;
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

export const buyAndHoldTool = new BuyAndHoldTool();
