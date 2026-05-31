/**
 * TradeMonitoringJob
 *
 * SideBScheduler 責務分離リファクタリング PR-3 (Phase 4) で sideBScheduler.ts から
 * 切り出した監視ジョブ。
 *
 * 移行元 (sideBScheduler.ts):
 * - executeMonitorJob() (約 250 行)
 * - closeTradeInternal() (約 40 行、内部 helper)
 * - generateNotesForClosedTrades() (約 70 行、内部 helper)
 *
 * 含まれる処理:
 * - 市場開閉判定 (isFXMarketOpen) によるスキップ
 * - 期限切れ pending トレードの自動キャンセル (expirePendingTrades)
 * - 1 分足 OHLCV 取得 (marketDataService 経由)
 * - pending → open 約定検証 (verifyTradeState + updateTradeToOpen)
 * - open → closed 決済検証 (closeTradeInternal + closeTrade)
 * - AI ノート類似度チェック (cronSimilarityService.checkSimilarityAndNotify)
 * - PDCA 通知 (pdcaLoop.notifyTradeCompleted)
 * - 決済後 Note 自動生成 (generateNoteFromTrade)
 *
 * 既存挙動互換のため、戻り値形 / ログ文言 / エラー記録の粒度 / 通知 key は維持する。
 * `sideBScheduler.similarity.test.ts` (11 ケース) を通すことが完了条件。
 *
 * 設計書: docs/side-b/sideb_scheduler_refactor_agent_prompt.md Phase 4
 */

import { isFXMarketOpen } from '../utils/marketHours';
import { expirePendingTrades } from '../services/virtualTradeService';
import {
  verifyTradeState,
  summarizeVerificationResult,
  type MinuteOHLCV,
} from '../services/tradeVerificationService';
import { generateNoteFromTrade } from '../services/aiNoteService';
import { agentMemory } from '../agent/agentMemory';
import {
  planRepository,
  findVirtualTrades,
  updateTradeToOpen,
  closeTrade,
} from '../repositories';
import * as aiNoteRepository from '../repositories/aiNoteRepository';
// ポートフォリオ統計の再集計。自動決済後に呼ばないと永続化 stats / 残高が更新されず UI に反映されない。
import { refreshPortfolioStats } from '../services/virtualTradeService';
import {
  calculatePnL,
  type CloseVirtualTradeInput,
  type TradeDirection,
  type ExitReason,
} from '../models';
import { pdcaLoop } from '../agent';
import type { MarketDataService } from '../../services/marketDataService';
import type { CronSimilarityService } from '../services/cronSimilarityService';
import type { OHLCVData } from '../../services/indicators/indicatorService';

import type { SideBJobDeps, SideBJobName, SideBJobRunner } from './types';
import type { SideBSchedulerConfig, JobResult } from './sideBScheduler';

/**
 * TradeMonitoringJob が依存する外部サービス群。
 *
 * Scheduler の private field (`marketDataService` / `cronSimilarityService`) を
 * 引数で透過するため、テスト時に `(scheduler as any).marketDataService = mock` で
 * フィールドを書き換えるパターンが引き続き機能する。
 */
export interface TradeMonitoringJobServices {
  marketDataService: MarketDataService;
  cronSimilarityService: CronSimilarityService;
}

/**
 * トレード監視を担当する Job。
 *
 * 1 時間ごとに直近 60 本の 1 分足を取得して:
 * - pending トレード: エントリー条件判定
 * - open トレード: SL/TP 到達判定
 *
 * 高安値ベース検証で終値のみより正確な約定タイミングを特定。
 */
export class TradeMonitoringJob
  implements SideBJobRunner<SideBSchedulerConfig, JobResult>
{
  readonly name: SideBJobName = 'monitor';

  private readonly deps: SideBJobDeps;
  /**
   * 最終実行日時を Scheduler 側に伝えるコールバック。
   * Scheduler の `lastMonitorRun` を更新する。
   */
  private readonly onStarted?: (startedAt: Date) => void;
  /**
   * Services を遅延取得するファクトリ (PR #161 Copilot review #2 対応)。
   *
   * run() 内で都度 services を取得することで、Scheduler の field 書き換え
   * (`(scheduler as any).marketDataService = mock`) がテスト時に反映される。
   * クロージャ経由のため、Job constructor 時に Scheduler の field を bind する
   * 旧設計より柔軟。
   */
  private readonly servicesFactory: () => TradeMonitoringJobServices;

  constructor(
    deps: SideBJobDeps,
    options: {
      servicesFactory: () => TradeMonitoringJobServices;
      onStarted?: (startedAt: Date) => void;
    },
  ) {
    this.deps = deps;
    this.onStarted = options.onStarted;
    this.servicesFactory = options.servicesFactory;
  }

  /**
   * SideBJobRunner 規約に従った run。
   *
   * services は constructor で渡された factory から都度取得する
   * (= テスト時の private 書き換えに追従する)。
   */
  async run(config: SideBSchedulerConfig): Promise<JobResult> {
    return this.runWithServices(config, this.servicesFactory());
  }

  /**
   * 監視ジョブの本体。旧 `SideBScheduler.executeMonitorJob()` の中身を完全互換で実装。
   *
   * @param config Scheduler 設定 (シンボル一覧、autoSimilarityCheck 等)
   * @param services Scheduler から透過される marketDataService / cronSimilarityService
   *                 (テスト時に private 書き換えで mock 可能にするため引数経由)
   */
  async runWithServices(
    config: SideBSchedulerConfig,
    services: TradeMonitoringJobServices,
  ): Promise<JobResult> {
    // 市場が閉まっている場合はスキップ (API 呼び出しを節約)
    if (!isFXMarketOpen()) {
      return {
        success: true,
        message: '市場が閉まっているため監視をスキップしました',
      };
    }

    this.onStarted?.(new Date());
    this.deps.log('1時間ごと検証を開始します（高安値ベース）');

    const results = {
      processed: 0,
      entries: 0,
      exits: 0,
      expired: 0,
      similarityChecks: 0,
      notificationsSent: 0,
      errors: [] as string[],
    };

    // 期限切れトレードの自動キャンセル (autoExpireTrades が有効な場合)
    if (config.autoExpireTrades) {
      try {
        const expiredCount = await expirePendingTrades();
        results.expired = expiredCount;
        if (expiredCount > 0) {
          this.deps.log(`期限切れトレードを ${expiredCount} 件キャンセルしました`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '不明なエラー';
        results.errors.push(`期限切れ処理: ${message}`);
      }
    }

    try {
      for (const symbol of config.symbols) {
        try {
          const minuteData = await services.marketDataService.getRecentMinuteOHLCV(symbol, 60);

          if (!minuteData || minuteData.length === 0) {
            results.errors.push(`${symbol}: 1分足データ取得失敗`);
            continue;
          }

          const ohlcvData: MinuteOHLCV[] = minuteData.map((d) => ({
            timestamp: d.timestamp,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume,
          }));

          // pending トレードの検証
          const pendingTrades = await findVirtualTrades({ symbol, status: 'pending' });
          for (const trade of pendingTrades) {
            results.processed++;
            const verificationResult = verifyTradeState(
              ohlcvData,
              'pending',
              trade.direction as TradeDirection,
              trade.plannedEntry,
              trade.stopLoss,
              trade.takeProfit,
            );
            this.deps.log(`[${symbol}] Trade ${trade.id}: ${summarizeVerificationResult(verificationResult)}`);

            if (verificationResult.entry?.triggered) {
              await updateTradeToOpen(
                trade.id,
                verificationResult.entry.entryPrice!,
                verificationResult.entry.entryTime,
              );
              results.entries++;
              this.deps.log(`[${symbol}] エントリー約定: ${verificationResult.entry.entryPrice}`);

              if (verificationResult.exit?.triggered) {
                await this.closeTradeInternal(
                  trade.id,
                  verificationResult.entry.entryPrice!,
                  verificationResult.exit.exitPrice!,
                  verificationResult.exit.exitReason!,
                  trade.direction as TradeDirection,
                  symbol,
                  verificationResult.exit.exitTime,
                  trade.timeframe,
                  trade.higherTimeframe,
                );
                results.exits++;
              }
            }
          }

          // open トレードの検証
          const openTrades = await findVirtualTrades({ symbol, status: 'open' });
          for (const trade of openTrades) {
            results.processed++;
            const verificationResult = verifyTradeState(
              ohlcvData,
              'open',
              trade.direction as TradeDirection,
              trade.plannedEntry,
              trade.stopLoss,
              trade.takeProfit,
            );
            this.deps.log(`[${symbol}] Trade ${trade.id}: ${summarizeVerificationResult(verificationResult)}`);

            if (verificationResult.exit?.triggered) {
              const entryPrice = trade.actualEntry ?? trade.plannedEntry;
              await this.closeTradeInternal(
                trade.id,
                entryPrice,
                verificationResult.exit.exitPrice!,
                verificationResult.exit.exitReason!,
                trade.direction as TradeDirection,
                symbol,
                verificationResult.exit.exitTime,
                trade.timeframe,
                trade.higherTimeframe,
              );
              results.exits++;
            }
          }

          // AI ノート類似度チェック (autoSimilarityCheck が有効な場合)
          if (config.autoSimilarityCheck) {
            try {
              const ohlcvForSimilarity: OHLCVData[] = minuteData.map((d) => ({
                timestamp: d.timestamp,
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
                volume: d.volume,
              }));

              const similarityResult = await services.cronSimilarityService.checkSimilarityAndNotify({
                symbol,
                ohlcvData: ohlcvForSimilarity,
                timeframe: config.timeframe,
              });

              results.similarityChecks++;
              results.notificationsSent += similarityResult.notificationsSent;

              if (similarityResult.similarNotesFound > 0) {
                this.deps.log(
                  `[${symbol}] 類似ノート検出: ${similarityResult.similarNotesFound}件, 通知送信: ${similarityResult.notificationsSent}件`,
                );
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : '不明なエラー';
              results.errors.push(`${symbol} 類似度チェック: ${message}`);
              this.deps.log(`[${symbol}] 類似度チェックエラー: ${message}`);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '不明なエラー';
          results.errors.push(`${symbol}: ${message}`);
        }
      }

      // 決済があった場合、ポートフォリオ統計を再集計する。
      // これが無いと永続化された VirtualPortfolio.stats / currentBalance が更新されず、
      // 決済が積み上がっても UI（getPortfolioSummary は永続 stats を読む）に反映されない。
      if (results.exits > 0) {
        try {
          await refreshPortfolioStats();
        } catch (error) {
          const message = error instanceof Error ? error.message : '不明なエラー';
          results.errors.push(`ポートフォリオ統計更新: ${message}`);
          this.deps.log(`ポートフォリオ統計更新エラー: ${message}`);
        }
      }

      // 決済があった場合、Note 自動生成
      if (config.autoGenerateNote && results.exits > 0) {
        await this.generateNotesForClosedTrades();
      }

      const summaryParts = [
        `処理 ${results.processed}件`,
        `エントリー ${results.entries}件`,
        `決済 ${results.exits}件`,
      ];
      if (results.expired > 0) {
        summaryParts.push(`期限切れキャンセル ${results.expired}件`);
      }
      if (config.autoSimilarityCheck && results.similarityChecks > 0) {
        summaryParts.push(`類似度チェック ${results.similarityChecks}件`);
        summaryParts.push(`通知送信 ${results.notificationsSent}件`);
      }
      const message = `監視完了: ${summaryParts.join(', ')}`;
      this.deps.log(message);

      if (results.errors.length > 0) {
        this.deps.log(`エラー: ${results.errors.join(', ')}`);
      }

      return {
        success: true,
        message,
        data: results,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '不明なエラー';
      this.deps.addError(`監視ジョブ失敗: ${message}`);
      return { success: false, message };
    }
  }

  /**
   * トレードを決済 (内部ヘルパー)。
   * 旧 SideBScheduler.closeTradeInternal() を完全互換で移植。
   */
  private async closeTradeInternal(
    tradeId: string,
    entryPrice: number,
    exitPrice: number,
    exitReason: ExitReason,
    direction: TradeDirection,
    symbol: string,
    exitTime?: Date,
    // MTF 文脈: VirtualTrade から伝播し reflection ハンドオフ (TradeResultSummary) に乗せる。
    timeframe?: string | null,
    higherTimeframe?: string | null,
  ): Promise<void> {
    const pnl = calculatePnL(direction, entryPrice, exitPrice);

    const input: CloseVirtualTradeInput = {
      exitPrice,
      exitReason,
      note: `高安値ベース検証により ${exitReason === 'stop_loss' ? 'SL' : 'TP'} 到達を検出`,
    };

    await closeTrade(tradeId, input, pnl.pips, pnl.amount);
    this.deps.log(
      `決済完了: ${tradeId} (${exitReason}, ${pnl.pips > 0 ? '+' : ''}${pnl.pips.toFixed(1)} pips)`,
    );

    // PDCA ループに通知
    try {
      pdcaLoop.notifyTradeCompleted({
        id: tradeId,
        symbol,
        timeframe: timeframe ?? undefined,
        higherTimeframe: higherTimeframe ?? undefined,
        direction,
        entryPrice,
        exitPrice,
        pnlPips: pnl.pips,
        outcome: pnl.pips > 0 ? 'win' : pnl.pips < 0 ? 'loss' : 'breakeven',
        exitReason,
        strategyRationale: `${exitReason}による決済`,
        tradedAt: exitTime ?? new Date(),
        closedAt: exitTime ?? new Date(),
      });
    } catch {
      /* PDCAループ未起動時は無視 */
    }
  }

  /**
   * 決済済みトレードの Note 自動生成 (内部ヘルパー)。
   * 旧 SideBScheduler.generateNotesForClosedTrades() を完全互換で移植。
   */
  private async generateNotesForClosedTrades(): Promise<void> {
    // Step C-1: reflection 待ちの上限 (PR #273 Copilot review #2)。
    // PDCA Loop 未起動 / 無効な環境では reflection が永遠に DB へ書き戻されないため、
    // 決済から本値を超過したトレードは reflection を待たずに従来互換で Note を生成し、
    // Note 自動生成が永久に止まるのを防ぐ。6h = 監視 cron 6 サイクル相当の安全マージン。
    const REFLECTION_WAIT_TIMEOUT_MS = 6 * 60 * 60 * 1000;
    try {
      const closedTrades = await findVirtualTrades({ status: 'closed', limit: 10 });

      for (const trade of closedTrades) {
        const existingNote = await aiNoteRepository.findAITradeNoteByVirtualTradeId(trade.id);
        if (existingNote) {
          continue;
        }

        // Step C-1: reflectionAI の分析が DB に書き戻されるまでノート生成を待つ。
        // reflection は pdcaLoop の REFLECTING (別 tick) で生成され VirtualTrade.reflection に
        // 永続化される。null の間はスキップし、次 tick で再評価する (= reflection 込みノートを保証)。
        // reflection 失敗時も簡易フォールバック構造が保存されるため、PDCA 稼働中は永久スキップしない。
        // ただし PDCA 未起動環境への保険として、決済から TIMEOUT 超過後は reflection なしで生成する。
        if (trade.reflection === null || trade.reflection === undefined) {
          const elapsedMs = trade.exitedAt ? Date.now() - trade.exitedAt.getTime() : Infinity;
          if (elapsedMs < REFLECTION_WAIT_TIMEOUT_MS) {
            this.deps.log(
              `[Note生成] Trade ${trade.id}: reflection 未生成のため次 tick まで待機 ` +
                `(決済から ${String(Math.round(elapsedMs / 60000))}分)`,
            );
            continue;
          }
          this.deps.log(
            `[Note生成] Trade ${trade.id}: reflection 待ち TIMEOUT (6h 超過)、reflection なしで生成に進む`,
          );
          // フォールスルー: reflection=null のまま従来互換で Note 生成
        }

        const plan = await planRepository.findById(trade.planId);
        if (!plan) {
          this.deps.addError(`[Note生成] Trade ${trade.id}: プランが見つかりません`);
          continue;
        }

        this.deps.log(`[Note生成] Trade ${trade.id} のNoteを生成中...`);

        try {
          // Phase 3: Plan 時点で AgentMemory に保存したレンズスナップショットを取得
          const lensSnapshot = agentMemory.getCurrentLensSnapshot(trade.symbol);

          await generateNoteFromTrade(
            {
              id: trade.id,
              planId: trade.planId,
              symbol: trade.symbol,
              direction: trade.direction as 'long' | 'short',
              plannedEntry: trade.plannedEntry,
              actualEntry: trade.actualEntry,
              stopLoss: trade.stopLoss,
              takeProfit: trade.takeProfit,
              exitPrice: trade.exitPrice,
              exitReason: trade.exitReason,
              enteredAt: trade.enteredAt,
              exitedAt: trade.exitedAt,
              pnlPips: trade.pnlPips,
              // Step C-1: reflection 分析を統合ノートに反映 (= 上のガードで non-null 保証済)
              reflection: trade.reflection,
            },
            {
              id: plan.id,
              marketAnalysis: {
                regime: plan.marketAnalysis?.regime || 'range',
                summary: plan.marketAnalysis?.summary || '',
              },
              scenarios:
                plan.scenarios?.map((s) => ({
                  direction: s.direction,
                  priority: s.priority || 'primary',
                })) || [],
            },
            lensSnapshot,
          );
          this.deps.log(
            `[Note生成] Trade ${trade.id} のNote生成完了${lensSnapshot ? ' (lensSnapshot付き)' : ''}`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : '不明なエラー';
          this.deps.addError(`[Note生成] Trade ${trade.id} 失敗: ${message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '不明なエラー';
      this.deps.addError(`Note自動生成エラー: ${message}`);
    }
  }
}
