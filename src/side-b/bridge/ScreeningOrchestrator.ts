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

import axios, { type AxiosError } from 'axios';
import type { ScreeningResult } from '../models/edgeHypothesis';
import { safeStringify } from '../../utils/safeStringify';
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
        private readonly ohlcvRepo: Pick<OHLCVRepository, 'count'> = new DefaultOHLCVRepository(),
        private readonly fetchAndCache: (
            symbol: string,
            timeframe: string,
            startDate: Date,
            endDate: Date,
        ) => Promise<FetchAndCacheResult> = fetchAndCacheOhlcv,
    ) {}

    // -----------------------------------------
    // OHLCV カバレッジ判定 (Critical-4 段階 1.6)
    //
    // 旧: period の first/last bar が指定範囲を覆っていれば OK (穴の有無を見ない)。
    //     forex 週末ギャップ + endDate=現在時刻 で常に NG になる欠陥があった。
    // 新: 「期間内の期待バー数(forex 5/7 割引)に対し、実バー数が 90% 以上」を OK とする。
    //     週末や祝日で取れない範囲を最初から期待値から除外しているため、判定が現実に即す。
    // -----------------------------------------

    /** forex 取引時間ベースの期待バー数 (週末は除外) */
    private static readonly FOREX_OPEN_RATIO = 5 / 7;
    /** OHLCV カバレッジの最低許容率 (Nekoさん 判断: 90%) */
    private static readonly COVERAGE_THRESHOLD = 0.9;

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

        const period = options.period ?? this.defaultScreeningPeriod();
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
            // 旧実装 (`err.message` のみ採取) では AxiosError でも `message` が `'Error'` 単体に
            // 潰れ、Python 側 / Cloud Run / 認証 / payload 不整合 等の真因を区別できなかった
            // (P0 真因実測で 12/12 件が `analysis-engine BT 実行失敗: Error` に終端していた)。
            // AxiosError の場合は status / code / response body 先頭 200 文字までを reason に含め、
            // 再発時に runScreening を再走させなくても statusNote だけで原因が見える状態にする。
            //
            // catch の err は型システム上 unknown だが、本番コードで `unknown` を直接持ち回らないため、
            // ここで具体型に narrow した上で helper に渡す (AGENTS.md §2.1 準拠)。
            const narrowed: AxiosError | Error | string = axios.isAxiosError(err)
                ? err
                : err instanceof Error
                  ? err
                  : String(err);
            const reason = this.buildBacktestErrorReason(narrowed);
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
     * デフォルトのスクリーニング対象期間。
     *
     * 期間日数は `SCREENING_PERIOD_DAYS` 環境変数で運用側が制御する(既定 365)。
     * orchestrator は内部にハードコード値を持たず、呼び出し側 (cron / skill) からの
     * 明示的な `options.period` を最優先する設計 (§段階 1.6)。
     */
    private defaultScreeningPeriod(): { start: string; end: string } {
        const raw = process.env.SCREENING_PERIOD_DAYS;
        const parsed = raw ? parseInt(raw, 10) : NaN;
        const days = Number.isFinite(parsed) && parsed > 0 ? parsed : 365;

        const end = new Date();
        const start = new Date(end);
        start.setDate(start.getDate() - days);
        return {
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0],
        };
    }

    /**
     * 指定期間において forex 取引時間ベースで期待される OHLCV バー数を計算する。
     * 平日のみ取引(土日 closed)= 期間の 5/7 が有効。
     */
    private expectedBars(periodStart: Date, periodEnd: Date, timeframe: string): number {
        const periodMs = Math.max(0, periodEnd.getTime() - periodStart.getTime());
        const intervalMs = this.timeframeToMs(timeframe);
        if (intervalMs <= 0) return 0;
        return Math.floor((periodMs * ScreeningOrchestrator.FOREX_OPEN_RATIO) / intervalMs);
    }

    /**
     * 指定期間の OHLCV 実バー数 / 期待バー数 / カバレッジ率 を返す。
     *
     * 期待バー数が 0 (= 期間が短すぎて1バーも収まらない、例: 1w 足で 3 日期間) の場合は
     * カバレッジ判定対象外として ratio=1 (= 通過扱い) を返す。
     * 「データ密度ではなく BT そのものが成立しないケース」は backtest.py 側の
     * 最低バー数チェック (len(df) < 30) で別途弾く。
     */
    private async coverageStats(
        symbol: string,
        timeframe: string,
        startDate: Date,
        endDate: Date,
    ): Promise<{ expected: number; actual: number; ratio: number }> {
        const expected = this.expectedBars(startDate, endDate, timeframe);
        const actual = await this.ohlcvRepo.count({
            symbol,
            timeframe,
            startTime: startDate,
            endTime: endDate,
        });
        const ratio = expected > 0 ? actual / expected : 1;
        return { expected, actual, ratio };
    }

    /**
     * BT 前に指定期間の OHLCV カバレッジを確認し、不足していれば cTrader/Twelve Data から補完する。
     *
     * カバレッジ判定:
     *   actual >= expected × 0.9 → OK
     *   それ未満 → not_testable (理由を具体的に返す)
     */
    private async ensureOhlcvData(
        symbol: string,
        timeframe: string,
        startDate: Date,
        endDate: Date,
    ): Promise<{ ok: true } | { ok: false; reason: string }> {
        const initial = await this.coverageStats(symbol, timeframe, startDate, endDate);
        if (initial.ratio >= ScreeningOrchestrator.COVERAGE_THRESHOLD) {
            return { ok: true };
        }

        const result = await this.fetchAndCache(symbol, timeframe, startDate, endDate);
        if (!result.success) {
            return {
                ok: false,
                reason: this.buildCoverageReason({
                    symbol,
                    timeframe,
                    startDate,
                    endDate,
                    stats: initial,
                    fetchError: result.error,
                    fetchSource: undefined,
                    fetchedCount: undefined,
                }),
            };
        }

        const after = await this.coverageStats(symbol, timeframe, startDate, endDate);
        if (after.ratio >= ScreeningOrchestrator.COVERAGE_THRESHOLD) {
            return { ok: true };
        }

        return {
            ok: false,
            reason: this.buildCoverageReason({
                symbol,
                timeframe,
                startDate,
                endDate,
                stats: after,
                fetchError: undefined,
                fetchSource: result.source,
                fetchedCount: result.cachedCount,
            }),
        };
    }

    /** カバレッジ不足時の人間可読な理由文字列を組み立てる */
    private buildCoverageReason(args: {
        symbol: string;
        timeframe: string;
        startDate: Date;
        endDate: Date;
        stats: { expected: number; actual: number; ratio: number };
        fetchError: string | undefined;
        fetchSource: string | undefined;
        fetchedCount: number | undefined;
    }): string {
        const { symbol, timeframe, startDate, endDate, stats, fetchError, fetchSource, fetchedCount } = args;
        const periodStr = `${startDate.toISOString()} 〜 ${endDate.toISOString()}`;
        const ratioPct = (stats.ratio * 100).toFixed(1);
        const thresholdPct = (ScreeningOrchestrator.COVERAGE_THRESHOLD * 100).toFixed(0);

        if (fetchError) {
            return (
                `OHLCV 取得不能: ${fetchError} ` +
                `(symbol=${symbol} tf=${timeframe} period=${periodStr}, ` +
                `現状 ${stats.actual}/${stats.expected} 本 ${ratioPct}%、閾値 ${thresholdPct}%)`
            );
        }
        return (
            `OHLCV カバレッジ不足: ${stats.actual}/${stats.expected} 本 ${ratioPct}% < 閾値 ${thresholdPct}% ` +
            `(symbol=${symbol} tf=${timeframe} period=${periodStr}, ` +
            `forex 5/7 期待値ベース、source=${fetchSource ?? 'unknown'}, fetched=${fetchedCount ?? 0})`
        );
    }

    /**
     * analysis-engine 通信エラー時の reason 文字列を組み立てる (P0 観測性改善)。
     *
     * AxiosError の場合は `code` / HTTP status / message / response.data の先頭 200 文字を
     * 列挙する。response.data の文字列化は **既存 `safeStringify` util に委譲** し、本関数
     * 自身は try/catch を持たない。`safeStringify` 側で BigInt / 循環参照 / toJSON throw を
     * すべて吸収し「2 次例外で元のエラーを潰さない」契約を満たしている (PR #240 Copilot
     * review #1 で実装とコメントを一致させた)。
     *
     * AxiosError 以外の Error は `name: message` 形式、それ以外は `String(err)` で fallback。
     *
     * Why: `markNotTestable` に保存される `statusNote` を見ただけで真因が判別できる状態を作る。
     * Evolution 経路は 82% 成功・Screening 経路は 100% 失敗という非対称が観測されているが、
     * 旧実装では reason が `'Error'` 単体に潰れていたため経路差の根本原因を追跡できなかった。
     */
    private buildBacktestErrorReason(err: AxiosError | Error | string): string {
        const prefix = 'analysis-engine BT 実行失敗';
        if (typeof err === 'string') {
            return `${prefix}: ${err}`;
        }
        if (axios.isAxiosError(err)) {
            const parts: string[] = [];
            if (err.code) parts.push(`code=${err.code}`);
            const status = err.response?.status;
            if (status !== undefined) parts.push(`status=${status}`);
            if (err.message) parts.push(`message=${err.message}`);
            // err.response?.data は axios 型定義上 any (= 任意 body 構造を許容するため意図的)。
            // 直接保持せず、循環参照 / BigInt / toJSON throw に既に対応している safeStringify
            // (utils 内で eslint-disable 1 行付き) に委譲し、本ファイル側では any を持ち回さない。
            if (err.response?.data !== undefined && err.response?.data !== null) {
                parts.push(`body=${safeStringify(err.response.data).slice(0, 200)}`);
            }
            return parts.length > 0 ? `${prefix}: ${parts.join(' / ')}` : `${prefix}: (axios error, no detail)`;
        }
        // err instanceof Error (catch 側で narrow 済み)
        return `${prefix}: ${err.name}: ${err.message || '(empty)'}`;
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
