/**
 * ScreeningOrchestrator (Critical-4 段階 1: BT 一本化)
 *
 * EdgeHypothesis に対する事前スクリーニング BT を analysis-engine 経由で実行する。
 *
 * 旧経路 (Phase 4b): MaterializationService → TradeNote 生成 → Side-A backtestService.execute
 *   → BacktestRun テーブルに保存 (BT 系統が複数並列に存在する状態だった)
 *
 * 新経路 (本実装): 仮説の defaultRiskManagement / conditions / 指標スペックを
 *   そのまま `notePayload` として analysis-engine の `/v1/screening-backtest` に POST。
 *   analysis-engine 内で `backtesting.py` により BT が走り、結果は `ScreeningBacktestRun`
 *   テーブルに保存される。
 *
 * 設計原則:
 * - BT エンジンはアプリ全体で 1 つだけ (analysis-engine + backtesting.py)
 * - 変換アダプタを作らない (notePayload を素直に渡す、§12.3)
 * - OHLCV は analysis-engine が DB から直読みするため、Node 側で渡さない
 * - 決定論的判定 (StatusManager.canPromoteToScreeningPassed)、LLM 不使用
 *
 * @see docs/design/critical_4_bt_unification.md §3 段階 1 / §6 / §11.4 / §12
 */

import type { ScreeningResult } from '../models/edgeHypothesis';
import {
    DEFAULT_RISK_MANAGEMENT,
    type EdgeHypothesis,
    type DefaultRiskManagement,
} from '../models/edgeHypothesis';
import type { LensFeatureSnapshot } from '../lenses';
import type { EdgeLedger } from '../ledger/EdgeLedger';
import { edgeLedger as defaultEdgeLedger } from '../ledger/EdgeLedger';
import type { StatusManager } from '../ledger/statusManager';
import { statusManager as defaultStatusManager } from '../ledger/statusManager';
import type { OHLCVRepository } from '../../backend/repositories/ohlcvRepository';
import { OHLCVRepository as DefaultOHLCVRepository } from '../../backend/repositories/ohlcvRepository';
import {
    fetchAndCacheOhlcv,
    type FetchAndCacheResult,
} from '../../backend/services/fetchAndCacheOhlcv';
import { normalizeCTraderSymbol } from '../../utils/symbolNormalization';
import { normalizeTimeframe, DEFAULT_TIMEFRAME } from '../constants/timeframes';
import type { ScreeningBacktestRunRepository } from '../../backend/repositories/screeningBacktestRunRepository';
import { screeningBacktestRunRepository as defaultScreeningBacktestRepo } from '../../backend/repositories/screeningBacktestRunRepository';
import { runScreeningBacktest as defaultRunScreeningBacktest } from '../../backend/services/analysisEngineClient';
import type { ScreeningBacktestNotePayload } from '../../schemas/external/analysisEngine';

// ===========================================
// 型
// ===========================================

export interface ScreeningOrchestratorOptions {
    /** スクリーニング対象期間(既定: 直近1年) */
    period?: { start: string; end: string };
    /** unverified 以外のステータスに対しても強制実行する(テスト / 再スクリーニング用) */
    force?: boolean;
    /**
     * 旧 API との互換: 段階 1 では analysis-engine が ATR を内部計算するため未使用。
     * Phase 4b 当時の呼び出し元(skill / scheduler)が渡してくる可能性があるため受けるだけ。
     */
    matchThreshold?: number;
    /** 旧 API との互換: 同上、無視される(scheduler が agentMemory から取得して渡してくる) */
    lensSnapshot?: LensFeatureSnapshot;
}

/**
 * スクリーニング1回分の結果(Orchestrator が呼び出し元に返す)
 */
export type ScreeningRunResult =
    | {
        hypothesisId: string;
        verdict: 'screening_passed';
        metrics: ScreeningResult['metrics'];
        screeningBacktestRunId: string;
    }
    | {
        hypothesisId: string;
        verdict: 'rejected';
        metrics: ScreeningResult['metrics'];
        screeningBacktestRunId: string;
        reasons: string[];
    }
    | {
        hypothesisId: string;
        verdict: 'not_testable';
        reason: string;
    };

/**
 * BT を実際に走らせる関数の型 (依存注入用)。
 * 既定では analysis-engine HTTP API を叩く `runScreeningBacktest`。テストではモックを差し替える。
 */
export type RunScreeningBacktestFn = typeof defaultRunScreeningBacktest;

// ===========================================
// ScreeningOrchestrator 本体
// ===========================================

export class ScreeningOrchestrator {
    constructor(
        private readonly edgeLedger: EdgeLedger = defaultEdgeLedger,
        private readonly statusManager: StatusManager = defaultStatusManager,
        private readonly screeningBacktestRepo: ScreeningBacktestRunRepository = defaultScreeningBacktestRepo,
        private readonly runBacktest: RunScreeningBacktestFn = defaultRunScreeningBacktest,
        private readonly ohlcvRepo: Pick<OHLCVRepository, 'findManyAsOHLCVData'> = new DefaultOHLCVRepository(),
        private readonly fetchAndCache: (
            symbol: string,
            timeframe: string,
            startDate: Date,
            endDate: Date,
        ) => Promise<FetchAndCacheResult> = fetchAndCacheOhlcv,
    ) {}

    /**
     * 仮説に対して事前スクリーニングを実行する。
     *
     * 例外:
     * - 仮説が見つからない場合は Error を投げる
     * - analysis-engine 通信エラーは内部で捕捉し、verdict='not_testable' として返す
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

        // Critical-1.5: 過去仮説には timeframes=['multi'] が混入している場合があるため正規化
        const rawTimeframe = hypothesis.timeframes[0] ?? DEFAULT_TIMEFRAME;
        const timeframe = normalizeTimeframe(rawTimeframe);
        const symbol = normalizeCTraderSymbol(hypothesis.symbols[0] ?? '');
        if (!symbol) {
            const reason = '仮説に symbols が設定されていない';
            await this.edgeLedger.markNotTestable(hypothesisId, reason);
            return { hypothesisId, verdict: 'not_testable', reason };
        }

        // OHLCV を analysis-engine 側で読むので、ここでは「カバレッジが足りなければ補完して DB に入れておく」のみ。
        const ensure = await this.ensureOhlcvData(symbol, timeframe, periodStart, periodEnd);
        if (!ensure.ok) {
            const reason = `OHLCV補完失敗: ${ensure.reason}`;
            await this.edgeLedger.markNotTestable(hypothesisId, reason);
            return { hypothesisId, verdict: 'not_testable', reason };
        }

        // notePayload を構築(変換アダプタは作らない、仮説フィールドをそのまま積む)
        const notePayload = this.buildNotePayload(hypothesis);

        // analysis-engine BT 実行
        let btResponse;
        try {
            btResponse = await this.runBacktest({
                hypothesisId,
                symbol,
                timeframe,
                startDate: periodStart.toISOString(),
                endDate: periodEnd.toISOString(),
                notePayload,
                config: {
                    initialCapital: 10_000,
                    leverage: 1,
                    tradingCost: 0,
                },
            });
        } catch (err) {
            const reason = `analysis-engine BT 実行失敗: ${
                err instanceof Error ? err.message : String(err)
            }`;
            await this.edgeLedger.markNotTestable(hypothesisId, reason);
            return { hypothesisId, verdict: 'not_testable', reason };
        }

        // 結果を ScreeningBacktestRun に永続化
        const persisted = await this.screeningBacktestRepo.create({
            hypothesisId,
            symbol,
            timeframe,
            periodStart,
            periodEnd,
            notePayload,
            summary: btResponse.summary,
            trades: btResponse.trades,
            equity: btResponse.equity ?? null,
            engineVersion: btResponse.engineVersion,
        });

        // メトリクスから判定 (StatusManager は決定論的)
        const metrics: ScreeningResult['metrics'] = {
            pf: btResponse.summary.pf,
            winRate: btResponse.summary.winRate,
            tradeCount: btResponse.summary.tradeCount,
        };
        const check = this.statusManager.canPromoteToScreeningPassed(metrics);

        const result: ScreeningResult = {
            executedAt: new Date().toISOString(),
            passed: check.ok,
            metrics,
            ...(check.ok ? {} : { reasons: check.reasons }),
            screeningBacktestRunId: persisted.id,
        };

        await this.edgeLedger.recordScreeningResult(hypothesisId, result);

        if (check.ok) {
            return {
                hypothesisId,
                verdict: 'screening_passed',
                metrics,
                screeningBacktestRunId: persisted.id,
            };
        }
        return {
            hypothesisId,
            verdict: 'rejected',
            metrics,
            screeningBacktestRunId: persisted.id,
            reasons: check.reasons,
        };
    }

    /**
     * notePayload を仮説から構築する。
     *
     * 「変換アダプタを作らない」(§12.3) 方針に従い、仮説のフィールドをそのまま積む。
     * Python 側 (analysis-engine/app/backtest.py) で評価する。
     */
    private buildNotePayload(hypothesis: EdgeHypothesis): ScreeningBacktestNotePayload {
        const rm: DefaultRiskManagement =
            hypothesis.defaultRiskManagement ?? DEFAULT_RISK_MANAGEMENT;

        return {
            direction: hypothesis.expectedDirection,
            conditions: hypothesis.conditions.map((c) => ({
                lensName: c.lensName,
                featureKey: c.featureKey,
                op: c.op,
                value: c.value,
            })),
            stopLoss: rm.stopLoss,
            takeProfit: rm.takeProfit,
            indicators: [],
            ...(rm.maxHoldingBars !== undefined ? { maxHoldingBars: rm.maxHoldingBars } : {}),
        };
    }

    /**
     * スクリーニング対象期間のデフォルト(直近1年)
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
     * BT 前に DB 上の OHLCV が指定期間をカバーしているか確認し、不足分は補完する。
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
                reason: result.error ?? 'cTrader/Twelve Data から OHLCV を取得できませんでした',
            };
        }

        if (await this.hasOhlcvCoverage(symbol, timeframe, startDate, endDate)) {
            return { ok: true };
        }

        return {
            ok: false,
            reason: `補完後も DB に十分な OHLCV がありません (source=${result.source ?? 'unknown'}, cached=${result.cachedCount})`,
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
 * 既定シングルトン(依存性を注入する場合は new で別インスタンスを作ること)
 */
export const screeningOrchestrator = new ScreeningOrchestrator();
