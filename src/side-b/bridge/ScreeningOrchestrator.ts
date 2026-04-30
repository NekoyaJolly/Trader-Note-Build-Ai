/**
 * ScreeningOrchestrator（Phase 4b 縮小版）
 *
 * EdgeHypothesis に対して、Side-A BacktestService を使った
 * **事前スクリーニング**（粗いフィルタ）を実行する。
 *
 * 本格検証（WalkForward / MonteCarlo / BuyAndHold）は Phase 4c で実装される。
 * このフェーズでは `screening_passed` へのステータス昇格までを担う。
 *
 * フロー:
 *   1. unverified 仮説を取得
 *   2. MaterializationService で TradeNote に materialize
 *      （失敗なら 'not_testable'）
 *   3. OHLCVが不足していれば cTrader 優先で補完（失敗時のみ Twelve Data）
 *   4. Side-A BacktestService.execute + getResult で BT 実行
 *   5. StatusManager.canPromoteToScreeningPassed で判定
 *   6. EdgeLedger.recordScreeningResult でステータス遷移
 *
 * 設計原則:
 * - Side-A コードを一切変更しない（backtestService は外部 API として呼び出すのみ）
 * - best-effort: 1件の失敗が他仮説の検証を止めない
 * - 決定論的判定: LLM は使わない（判定は SCREENING_THRESHOLDS に従う）
 *
 * @see docs/design/phase_4b_specification.md セクション4.4
 */

import type { LensFeatureSnapshot } from '../lenses';
import {
    defaultLensAggregator,
    registerDefaultLenses,
    type LensAggregator,
} from '../lenses';
import type { OHLCVBar } from '../lenses/utils/pivotDetection';
import type { ScreeningResult } from '../models/edgeHypothesis';
import type { EdgeLedger } from '../ledger/EdgeLedger';
import { edgeLedger as defaultEdgeLedger } from '../ledger/EdgeLedger';
import type { StatusManager } from '../ledger/statusManager';
import { statusManager as defaultStatusManager } from '../ledger/statusManager';
import type { MaterializationService } from './MaterializationService';
import { materializationService as defaultMaterializationService } from './MaterializationService';
import { MaterializationError } from './types';
import { backtestService as defaultBacktestService, type BacktestService } from '../../services/backtestService';
import type { OHLCVRepository } from '../../backend/repositories/ohlcvRepository';
import { OHLCVRepository as DefaultOHLCVRepository } from '../../backend/repositories/ohlcvRepository';
import {
    fetchAndCacheOhlcv,
    type FetchAndCacheResult,
} from '../../backend/services/fetchAndCacheOhlcv';
import { normalizeCTraderSymbol } from '../../utils/symbolNormalization';

/**
 * Phase 3 系レンズ(volatility_regime)の必要バー数を満たすための最低本数。
 * VolatilityRegimeLens の既定設定: indicatorWindow(20) + atrChangeWindow(5) + 1 = 26。
 * パーセンタイル計算の安定性を考慮し、percentileLookback(100) と合わせて
 * 余裕を持って 150 本まで遡る。
 */
const SCREENING_LENS_LOOKBACK = 150;

// ===========================================
// 型
// ===========================================

export interface ScreeningOrchestratorOptions {
    /** ATR / エントリー価格の取得元レンズスナップショット */
    lensSnapshot?: LensFeatureSnapshot;
    /** スクリーニング対象期間（既定: 直近1年） */
    period?: { start: string; end: string };
    /** マッチ閾値（Side-A BT の入力、既定 0.6） TODO(Phase 4c): 外部化 */
    matchThreshold?: number;
    /** unverified 以外のステータスに対しても強制実行する（テスト / 再スクリーニング用） */
    force?: boolean;
}

/**
 * スクリーニング1回分の結果（Orchestrator が呼び出し元に返す）
 */
export type ScreeningRunResult =
    | {
        hypothesisId: string;
        verdict: 'screening_passed';
        tradeNoteId: string;
        metrics: ScreeningResult['metrics'];
        backtestRunId: string;
    }
    | {
        hypothesisId: string;
        verdict: 'rejected';
        tradeNoteId: string;
        metrics: ScreeningResult['metrics'];
        backtestRunId: string;
        reasons: string[];
    }
    | {
        hypothesisId: string;
        verdict: 'not_testable';
        reason: string;
    };

// ===========================================
// ScreeningOrchestrator 本体
// ===========================================

export class ScreeningOrchestrator {
    constructor(
        private readonly materialization: MaterializationService = defaultMaterializationService,
        private readonly edgeLedger: EdgeLedger = defaultEdgeLedger,
        private readonly statusManager: StatusManager = defaultStatusManager,
        private readonly backtestService: BacktestService = defaultBacktestService,
        private readonly ohlcvRepo: Pick<OHLCVRepository, 'findManyAsOHLCVData'> = new DefaultOHLCVRepository(),
        private readonly fetchAndCache: (
            symbol: string,
            timeframe: string,
            startDate: Date,
            endDate: Date,
        ) => Promise<FetchAndCacheResult> = fetchAndCacheOhlcv,
        private readonly lensAggregator: Pick<LensAggregator, 'computeAll'> = defaultLensAggregator,
    ) {
        // ScreeningOrchestrator は agentMemory に依存せず、screening 期間の OHLCV から
        // 直接 lensSnapshot を生成する(§Critical-1 修正、orchestration_health_report 参照)。
        // テストで別 aggregator を注入するケースを除き、レンズ未登録の場合は登録する。
        if (this.lensAggregator === defaultLensAggregator) {
            registerDefaultLenses();
        }
    }

    /**
     * 仮説に対して事前スクリーニングを実行する。
     *
     * 呼び出し前提:
     * - hypothesis.status === 'unverified'（force=true で回避可）
     * - hypothesis.symbols / timeframes が空でない
     *
     * 例外:
     * - 仮説が見つからない場合は Error を投げる（スケジューラーは個別にキャッチする）
     * - Side-A BT 実行で内部例外が起きた場合もそのまま投げる
     *   （呼び出し側がジョブレベルで個別対応）
     *
     * MaterializationError は内部で捕捉し、verdict='not_testable' で返す。
     */
    async runScreening(
        hypothesisId: string,
        options: ScreeningOrchestratorOptions = {},
    ): Promise<ScreeningRunResult> {
        const hypothesis = await this.edgeLedger.get(hypothesisId);
        if (!hypothesis) {
            throw new Error(`Hypothesis not found: ${hypothesisId}`);
        }

        if (!options.force && hypothesis.status !== 'unverified') {
            throw new Error(
                `Hypothesis ${hypothesisId} is not unverified (status=${hypothesis.status}). force=true で強制可能。`,
            );
        }

        const period = options.period ?? this.determineScreeningPeriod();
        const periodStart = new Date(period.start);
        const periodEnd = new Date(period.end);
        const timeframe = hypothesis.timeframes[0] ?? '15m';
        const matchThreshold = options.matchThreshold ?? 0.6;
        const symbol = normalizeCTraderSymbol(hypothesis.symbols[0] ?? '');
        if (!symbol) {
            const reason = '仮説に symbols が設定されていない';
            await this.edgeLedger.markNotTestable(hypothesisId, reason);
            return { hypothesisId, verdict: 'not_testable', reason };
        }

        // OHLCV を先に補完(materialize で必要な ATR を bars から計算するため)。
        const ensure = await this.ensureOhlcvData(symbol, timeframe, periodStart, periodEnd);
        if (!ensure.ok) {
            const reason = `OHLCV補完失敗: ${ensure.reason}`;
            await this.edgeLedger.markNotTestable(hypothesisId, reason);
            return { hypothesisId, verdict: 'not_testable', reason };
        }

        // screening 専用に fresh な lensSnapshot を計算する。
        // 呼び出し側が options.lensSnapshot を渡していて、かつ ATR が含まれている場合のみ
        // それを優先し、それ以外は OHLCV から計算した snapshot を使う。
        const lensSnapshot = await this.resolveLensSnapshot(
            symbol,
            timeframe,
            periodEnd,
            options.lensSnapshot,
        );

        // 1. Materialize
        let materialized;
        try {
            materialized = await this.materialization.materializeForValidation(hypothesis, {
                lensSnapshot,
            });
        } catch (error) {
            if (error instanceof MaterializationError) {
                const reason = error.reason;
                await this.edgeLedger.markNotTestable(hypothesisId, `Materialization失敗: ${reason}`);
                return { hypothesisId, verdict: 'not_testable', reason };
            }
            throw error;
        }

        const { tradeNoteId, stopLossPercent, takeProfitPercent, maxHoldingMinutes } = materialized;

        // 2. Side-A BacktestService で BT 実行
        const runId = await this.backtestService.execute({
            noteId: tradeNoteId,
            startDate: periodStart,
            endDate: periodEnd,
            timeframe,
            matchThreshold,
            takeProfit: takeProfitPercent,
            stopLoss: stopLossPercent,
            maxHoldingMinutes,
        });

        // 3. 結果取得
        const summary = await this.backtestService.getResult(runId);
        if (!summary) {
            // runId が取得できたのに結果が無いのは Side-A 側の異常。not_testable 扱い。
            const reason = `BT 結果取得失敗 (runId=${runId})`;
            await this.edgeLedger.markNotTestable(hypothesisId, reason);
            return { hypothesisId, verdict: 'not_testable', reason };
        }

        const pf = summary.profitFactor ?? 0;
        const winRate = summary.winRate; // Side-A は 0-1 で返す
        const tradeCount = summary.setupCount;
        const metrics: ScreeningResult['metrics'] = { pf, winRate, tradeCount };

        // 4. 判定
        const check = this.statusManager.canPromoteToScreeningPassed(metrics);

        // 5. 記録
        const result: ScreeningResult = {
            executedAt: new Date().toISOString(),
            tradeNoteId,
            passed: check.ok,
            metrics,
            reasons: check.ok ? undefined : check.reasons,
            backtestRunId: runId,
        };

        await this.edgeLedger.recordScreeningResult(hypothesisId, result);

        if (check.ok) {
            return {
                hypothesisId,
                verdict: 'screening_passed',
                tradeNoteId,
                metrics,
                backtestRunId: runId,
            };
        }
        return {
            hypothesisId,
            verdict: 'rejected',
            tradeNoteId,
            metrics,
            backtestRunId: runId,
            reasons: check.reasons,
        };
    }

    /**
     * スクリーニング対象期間のデフォルト（直近1年）
     * ISO8601 日付文字列を返す。
     */
    private determineScreeningPeriod(): { start: string; end: string } {
        const end = new Date();
        const start = new Date(end);
        start.setFullYear(start.getFullYear() - 1);
        return {
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0],
        };
    }

    /**
     * Materialize に渡す lensSnapshot を決定する。
     *
     * 優先順位:
     *   1. 呼び出し側が渡した snapshot に有効な volatility_regime.atr が入っていればそれを使う
     *   2. それ以外は screening 期間末尾の OHLCV から fresh に lensSnapshot を計算する
     *   3. OHLCV が読めない場合は undefined を返し、materialize 側のエラー処理に任せる
     *
     * これにより agentMemory.getCurrentLensSnapshot に依存せず、
     * screening ジョブ単独で ATR を解決できる(§Critical-1 修正)。
     */
    private async resolveLensSnapshot(
        symbol: string,
        timeframe: string,
        periodEnd: Date,
        provided: LensFeatureSnapshot | undefined,
    ): Promise<LensFeatureSnapshot | undefined> {
        if (provided) {
            const vol = provided.features.get('volatility_regime');
            const atr = vol?.features.atr;
            if (typeof atr === 'number' && atr > 0) {
                return provided;
            }
        }

        try {
            const lookbackMs = this.timeframeToMs(timeframe) * SCREENING_LENS_LOOKBACK;
            const lookbackStart = new Date(periodEnd.getTime() - lookbackMs);
            const recent = await this.ohlcvRepo.findManyAsOHLCVData({
                symbol,
                timeframe,
                startTime: lookbackStart,
                endTime: periodEnd,
                limit: SCREENING_LENS_LOOKBACK,
                orderBy: 'asc',
            });
            if (recent.length === 0) {
                return provided;
            }
            const ohlcvBars: OHLCVBar[] = recent.map((bar) => ({
                timestamp: bar.timestamp instanceof Date ? bar.timestamp : new Date(bar.timestamp),
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume,
            }));
            const fresh = await this.lensAggregator.computeAll({
                symbol,
                timeframe,
                timestamp: ohlcvBars[ohlcvBars.length - 1].timestamp,
                ohlcvBars,
            });
            return fresh;
        } catch (err) {
            console.warn(
                `[ScreeningOrchestrator] fresh lensSnapshot 計算失敗、provided にフォールバック: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            return provided;
        }
    }

    /**
     * Screening BT 前に、DB上のOHLCVが指定期間をカバーしているか確認する。
     * 足りない場合は cTrader 優先、失敗時のみ Twelve Data フォールバックで補完する。
     */
    private async ensureOhlcvData(
        symbol: string,
        timeframe: string,
        startDate: Date,
        endDate: Date,
    ): Promise<{ ok: true } | { ok: false; reason: string }> {
        if (await this.hasOhlcvCoverage(symbol, timeframe, startDate, endDate)) {
            return { ok: true };
        }

        const result = await this.fetchAndCache(symbol, timeframe, startDate, endDate);
        if (!result.success) {
            return {
                ok: false,
                reason: result.error ?? 'cTrader/Twelve Data からOHLCVを取得できませんでした',
            };
        }

        if (await this.hasOhlcvCoverage(symbol, timeframe, startDate, endDate)) {
            return { ok: true };
        }

        return {
            ok: false,
            reason: `補完後もDBに十分なOHLCVがありません（source=${result.source ?? 'unknown'}, cached=${result.cachedCount}）`,
        };
    }

    private async hasOhlcvCoverage(
        symbol: string,
        timeframe: string,
        startDate: Date,
        endDate: Date,
    ): Promise<boolean> {
        const [first] = await this.ohlcvRepo.findManyAsOHLCVData({
            symbol,
            timeframe,
            startTime: startDate,
            endTime: endDate,
            limit: 1,
            orderBy: 'asc',
        });
        const [last] = await this.ohlcvRepo.findManyAsOHLCVData({
            symbol,
            timeframe,
            startTime: startDate,
            endTime: endDate,
            limit: 1,
            orderBy: 'desc',
        });

        if (!first || !last) return false;

        const intervalMs = this.timeframeToMs(timeframe);
        const toleranceMs = intervalMs * 3;
        const firstTime = first.timestamp instanceof Date
            ? first.timestamp.getTime()
            : new Date(first.timestamp).getTime();
        const lastTime = last.timestamp instanceof Date
            ? last.timestamp.getTime()
            : new Date(last.timestamp).getTime();

        return firstTime <= startDate.getTime() + toleranceMs
            && lastTime >= endDate.getTime() - toleranceMs;
    }

    private timeframeToMs(timeframe: string): number {
        const match = timeframe.match(/^(\d+)([mhdw])$/);
        if (!match) return 60 * 60 * 1000;
        const value = Number(match[1]);
        const unit = match[2];
        if (unit === 'm') return value * 60 * 1000;
        if (unit === 'h') return value * 60 * 60 * 1000;
        if (unit === 'd') return value * 24 * 60 * 60 * 1000;
        return value * 7 * 24 * 60 * 60 * 1000;
    }
}

/**
 * 既定シングルトン（依存性を注入する場合は new で別インスタンスを作ること）
 */
export const screeningOrchestrator = new ScreeningOrchestrator();
