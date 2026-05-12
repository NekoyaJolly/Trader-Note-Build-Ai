/**
 * PlanGenerationJob
 *
 * SideBScheduler 責務分離リファクタリング PR-3 (Phase 4) で sideBScheduler.ts から
 * 切り出したプラン生成ジョブ。
 *
 * 移行元 (sideBScheduler.ts):
 * - executePlanJob() のプラン生成部分 (約 175 行、L1166-1339)
 *
 * 含まれる処理:
 * - シンボルごとの最終実行チェック (lastPlanRun の経過時間で skip 判定)
 * - 執行足 OHLCV 取得 (marketDataService.getHistoricalData)
 * - OHLCV の DB 永続化 (ohlcvRepository.bulkInsert)
 * - 上位足 OHLCV 取得 + 永続化 (MTF 分析用)
 * - プラン生成 (orchestrator.generatePlan)
 * - 仮想トレード作成 (createTradeFromPlan)
 * - PDCA 通知 (notifyAnalysisComplete / notifyStrategyComplete)
 *
 * 含まれない処理 (PR-4 で CleanupJob として独立予定):
 * - autoCleanup の cleanup 処理 (旧 executePlanJob L1341-1376) → Scheduler 側に残す
 *
 * 設計書: docs/side-b/sideb_scheduler_refactor_agent_prompt.md Phase 4
 */

import { createTradeFromPlan } from '../services/virtualTradeService';
import { researchRepository } from '../repositories';
import { ohlcvRepository } from '../../backend/repositories/ohlcvRepository';
import { pdcaLoop } from '../agent';
import type { AIOrchestrator } from '../orchestrator/aiOrchestrator';
import type { MarketDataService } from '../../services/marketDataService';

import type { SideBJobDeps, SideBJobName, SideBJobRunner } from './types';
import type { SideBSchedulerConfig } from './sideBScheduler';

/**
 * PlanGenerationJob が依存する外部サービス群。
 */
export interface PlanGenerationJobServices {
  marketDataService: MarketDataService;
  orchestrator: AIOrchestrator;
}

/**
 * シンボル別の結果。
 */
export interface PlanGenerationSymbolResult {
  symbol: string;
  success: boolean;
  error?: string;
}

/**
 * PlanGenerationJob の戻り値型。
 *
 * 旧 `executePlanJob()` の戻り値 `JobResult` (data: SymbolResult[]) を型安全に拡張。
 * Scheduler 側で cleanup 判定 (`results.some(r => r.success)`) を型安全にアクセスするため
 * `results` をトップレベルに持つ。
 */
export interface PlanGenerationRunReport {
  success: boolean;
  message: string;
  results: PlanGenerationSymbolResult[];
}

/**
 * 日次プラン生成を担当する Job (4 時間ごと / MTF 対応)。
 *
 * 1. 執行足 OHLCV 取得 (cTrader 優先 → Twelve Data フォールバック)
 * 2. 上位足 OHLCV 取得 (MTF 分析用)
 * 3. Orchestrator に higherTFData を渡してプラン生成
 * 4. Trade 作成 (pending)
 */
export class PlanGenerationJob
  implements SideBJobRunner<SideBSchedulerConfig, PlanGenerationRunReport>
{
  readonly name: SideBJobName = 'plan-generation';

  private readonly deps: SideBJobDeps;
  /**
   * シンボル毎の最終実行日時を Scheduler 側で記録するためのコールバック。
   * Scheduler の `lastPlanRun: Map<string, Date>` を更新する。
   */
  private readonly onSymbolCompleted?: (symbol: string, completedAt: Date) => void;

  /**
   * シンボル毎の前回実行日時を取得するためのコールバック。
   * Scheduler の `lastPlanRun.get(symbol)` を参照する。
   */
  private readonly getLastSymbolRun?: (symbol: string) => Date | undefined;

  /**
   * Services を遅延取得するファクトリ (PR #161 Copilot review #3 対応)。
   * 詳細は TradeMonitoringJob と同じ。
   */
  private readonly servicesFactory: () => PlanGenerationJobServices;

  constructor(
    deps: SideBJobDeps,
    options: {
      servicesFactory: () => PlanGenerationJobServices;
      onSymbolCompleted?: (symbol: string, completedAt: Date) => void;
      getLastSymbolRun?: (symbol: string) => Date | undefined;
    },
  ) {
    this.deps = deps;
    this.onSymbolCompleted = options.onSymbolCompleted;
    this.getLastSymbolRun = options.getLastSymbolRun;
    this.servicesFactory = options.servicesFactory;
  }

  /**
   * SideBJobRunner 規約に従った run。services は constructor の factory から都度取得。
   */
  async run(config: SideBSchedulerConfig): Promise<PlanGenerationRunReport> {
    return this.runWithServices(config, this.servicesFactory());
  }

  /**
   * プラン生成本体。旧 `SideBScheduler.executePlanJob()` のプラン生成部分を
   * 完全互換で実装 (cleanup 部分は Scheduler 側に残す)。
   */
  async runWithServices(
    config: SideBSchedulerConfig,
    services: PlanGenerationJobServices,
  ): Promise<PlanGenerationRunReport> {
    const intervalLabel = config.planIntervalHours
      ? `${config.planIntervalHours}時間ごと`
      : '日次';
    this.deps.log(`${intervalLabel}プラン生成を開始します`);

    const results: PlanGenerationSymbolResult[] = [];

    for (const symbol of config.symbols) {
      try {
        // 最終実行チェック (間隔内なら該シンボルはスキップ)
        const lastRun = this.getLastSymbolRun?.(symbol);
        const intervalMs = (config.planIntervalHours || 24) * 60 * 60 * 1000;
        if (lastRun && Date.now() - lastRun.getTime() < intervalMs) {
          this.deps.log(`[${symbol}] 間隔内のためスキップ（最終: ${lastRun.toISOString()}）`);
          continue;
        }

        // 1. 執行足 OHLCV データ取得
        this.deps.log(`[${symbol}] 執行足(${config.timeframe})OHLCV取得中...`);
        const ohlcvData = await services.marketDataService.getHistoricalData(
          symbol,
          config.timeframe,
          100,
        );

        if (!ohlcvData || ohlcvData.length === 0) {
          throw new Error('執行足OHLCVデータの取得に失敗');
        }

        // 1b. 執行足 OHLCV を DB に永続化
        try {
          const normalizedSymbol = symbol.replace('/', '');
          const source = services.marketDataService.isCTraderAvailable()
            ? 'ctrader'
            : 'twelvedata';
          const insertCount = await ohlcvRepository.bulkInsert(
            ohlcvData.map((d) => ({
              symbol: normalizedSymbol,
              timeframe: config.timeframe,
              timestamp: new Date(d.timestamp),
              open: d.open,
              high: d.high,
              low: d.low,
              close: d.close,
              volume: d.volume ?? 0,
              source,
            })),
          );
          if (insertCount > 0) {
            this.deps.log(`[${symbol}] 執行足 ${insertCount}本をDBに保存`);
          }
        } catch (persistError) {
          this.deps.log(
            `[${symbol}] 執行足DB保存エラー（AI処理は続行）: ${String(persistError)}`,
          );
        }

        // 2. 上位足 OHLCV データ取得 (MTF 分析用)
        let higherTFData:
          | {
              timeframe: string;
              ohlcvData: {
                timestamp: Date;
                open: number;
                high: number;
                low: number;
                close: number;
                volume?: number;
              }[];
            }
          | undefined;
        try {
          this.deps.log(`[${symbol}] 上位足(${config.higherTimeframe})OHLCV取得中...`);
          const htfOhlcv = await services.marketDataService.getHistoricalData(
            symbol,
            config.higherTimeframe,
            100,
          );
          if (htfOhlcv && htfOhlcv.length > 0) {
            higherTFData = {
              timeframe: config.higherTimeframe,
              ohlcvData: htfOhlcv.map((d) => ({
                timestamp: new Date(d.timestamp),
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
                volume: d.volume,
              })),
            };
            this.deps.log(`[${symbol}] 上位足 ${htfOhlcv.length}本取得成功`);

            try {
              const normalizedSymbol = symbol.replace('/', '');
              const source = services.marketDataService.isCTraderAvailable()
                ? 'ctrader'
                : 'twelvedata';
              const insertCount = await ohlcvRepository.bulkInsert(
                htfOhlcv.map((d) => ({
                  symbol: normalizedSymbol,
                  timeframe: config.higherTimeframe,
                  timestamp: new Date(d.timestamp),
                  open: d.open,
                  high: d.high,
                  low: d.low,
                  close: d.close,
                  volume: d.volume ?? 0,
                  source,
                })),
              );
              if (insertCount > 0) {
                this.deps.log(`[${symbol}] 上位足 ${insertCount}本をDBに保存`);
              }
            } catch (persistError) {
              this.deps.log(
                `[${symbol}] 上位足DB保存エラー（AI処理は続行）: ${String(persistError)}`,
              );
            }
          }
        } catch (htfError) {
          this.deps.log(`[${symbol}] 上位足取得失敗（単一TFで続行）: ${String(htfError)}`);
        }

        // 3. オーケストレーターでプラン生成 (Research → Plan + MTF)
        this.deps.log(`[${symbol}] AI分析を実行中...`);
        const planResult = await services.orchestrator.generatePlan({
          symbol,
          targetDate: new Date().toISOString().split('T')[0],
          ohlcvData: ohlcvData.map((d) => ({
            timestamp: new Date(d.timestamp),
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume,
          })),
          higherTFData,
        });

        if (!planResult.success || !planResult.data) {
          throw new Error(planResult.error || 'プラン生成に失敗');
        }

        // 4. Trade を作成 (pending 状態)
        this.deps.log(`[${symbol}] 仮想トレードを作成中...`);
        const tradeResult = await createTradeFromPlan(planResult.data.id);

        if (!tradeResult.success) {
          throw new Error(tradeResult.error || 'トレード作成に失敗');
        }

        this.onSymbolCompleted?.(symbol, new Date());

        // ノートレード判断 (シナリオ 0 件) は skipped で来るため、エラーにせず
        // 正常完了として記録する。
        if (tradeResult.skipped) {
          this.deps.log(
            `[${symbol}] プラン完了: ${tradeResult.skipReason ?? 'ノートレード判断'} (Trade 作成はスキップ)`,
          );
        } else {
          this.deps.log(`[${symbol}] プラン完了: Trade ID ${tradeResult.trade?.id}`);
        }
        results.push({ symbol, success: true });

        // PDCA ループに戦略完了を通知
        try {
          const planData = planResult.data;
          const research = planData?.researchId
            ? await researchRepository.findById(planData.researchId)
            : null;
          if (research?.marketAnalysis) {
            pdcaLoop.notifyAnalysisComplete(symbol, research.marketAnalysis);
          }
          if (planData?.scenarios) {
            pdcaLoop.notifyStrategyComplete(
              symbol,
              planData.scenarios.map((s) => ({
                name: s.name,
                direction: s.direction,
                entryPrice: s.entry.price,
                confidence: s.confidence,
              })),
            );
          }
        } catch {
          /* PDCAループ未起動時は無視 */
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '不明なエラー';
        this.deps.addError(`[${symbol}] プラン失敗: ${message}`);
        results.push({ symbol, success: false, error: message });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const message = `${intervalLabel}プラン生成完了: ${successCount}/${results.length} シンボル成功`;
    this.deps.log(message);

    return {
      success: successCount > 0,
      message,
      results,
    };
  }
}
