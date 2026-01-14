/**
 * Side-B スケジューラー
 * 
 * 目的: AIトレードの自動実行サイクルを管理
 * 
 * 実行フロー:
 * 1. 日次プラン生成（毎朝の市場開始時）
 *    Research → Plan → Trade(pending) 作成
 * 
 * 2. トレード検証（1時間間隔）
 *    - 直近1時間分の1分足OHLCVを取得
 *    - 高安値ベースでエントリー/決済条件を判定
 *    - pending → open → closed の状態遷移
 *    - 決済時にAI Note自動生成
 * 
 * 3. 週次/月次サマリー自動生成
 *    - 週次: 毎週土曜 UTC 22:00（NY市場閉場）
 *    - 月次: 毎月1日 UTC 00:00
 * 
 * 4. 期限切れトレード自動キャンセル
 *    - validUntilを過ぎたpendingトレードを自動キャンセル
 * 
 * 設計思想:
 * - 高安値ベース検証: 終値のみより正確な約定判定
 * - 1時間間隔: API コスト最適化（25回/日/ペア、無料枠の3%）
 * - FX市場は平日24時間稼働、土日休場
 * - 米国サマータイム対応
 * - **人間の介在なしに完全自動運用可能**
 * 
 * @see docs/side-b/TradeAssistant-AI.md
 */

import { isFXMarketOpen, getMarketStatusJST } from '../utils/marketHours';
import {
  monitorEntryConditions,
  monitorPositions,
  createTradeFromPlan,
  expirePendingTrades,
  type MonitoringResult,
} from '../services/virtualTradeService';
import {
  verifyTradeState,
  summarizeVerificationResult,
  type MinuteOHLCV,
  type TradeVerificationResult,
} from '../services/tradeVerificationService';
import { generateNoteFromTrade } from '../services/aiNoteService';
import { summarySchedulerService } from '../services/summarySchedulerService';
import { executeCleanup, type CleanupConfig } from '../services/dataCleanupService';
import { CronSimilarityService } from '../services/cronSimilarityService';
import * as aiNoteRepository from '../repositories/aiNoteRepository';
import {
  planRepository,
  findVirtualTrades,
  updateTradeToOpen,
  closeTrade,
} from '../repositories';
import { calculatePnL, type CloseVirtualTradeInput, type TradeDirection, type ExitReason } from '../models';
import { AIOrchestrator } from '../orchestrator/aiOrchestrator';
import { MarketDataService } from '../../services/marketDataService';
import { config } from '../../config';
import type { OHLCVData } from '../../services/indicators/indicatorService';

// ===========================================
// 型定義
// ===========================================

/**
 * スケジューラー設定
 */
export interface SideBSchedulerConfig {
  /** 自動実行を有効にするか */
  enabled: boolean;
  /** 監視対象シンボル */
  symbols: string[];
  /** 分析する時間足 */
  timeframe: string;
  /** 監視間隔（ミリ秒） */
  monitorIntervalMs: number;
  /** 日次プラン生成時刻（UTC時間、例: "00:00"） */
  dailyPlanTimeUTC: string;
  /** 決済時にNote自動生成するか */
  autoGenerateNote: boolean;
  /** 週次/月次サマリーの自動生成を有効にするか */
  autoSummary: boolean;
  /** 期限切れトレードの自動キャンセルを有効にするか */
  autoExpireTrades: boolean;
  /** 古いデータの自動クリーンアップを有効にするか */
  autoCleanup: boolean;
  /** プランの保持日数（デフォルト: 30日） */
  planRetentionDays: number;
  /** 完了トレードの保持日数（デフォルト: 90日） */
  tradeRetentionDays: number;
  /** AIノート類似度チェックを有効にするか */
  autoSimilarityCheck: boolean;
  /** 類似度チェックの閾値（0-1） */
  similarityThreshold: number;
}

/**
 * デフォルト設定
 * 
 * 監視間隔の設計思想:
 * - 1時間ごとに1分足60本を取得して高安値ベース検証
 * - Twelve Data API無料枠（800回/日）で約30ペアまで運用可能
 * - 1ペア × 25回/日 = 3% の API 消費
 */
const DEFAULT_CONFIG: SideBSchedulerConfig = {
  enabled: false,  // デフォルトは無効
  symbols: ['XAU/USD'],
  timeframe: '15m',
  monitorIntervalMs: 60 * 60 * 1000,  // 1時間間隔（高安値ベース検証）
  dailyPlanTimeUTC: '00:00',  // UTC 00:00 = JST 09:00
  autoGenerateNote: true,
  autoSummary: true,          // 週次/月次サマリー自動生成
  autoExpireTrades: true,     // 期限切れ自動キャンセル
  autoCleanup: true,          // 古いデータ自動クリーンアップ
  planRetentionDays: 30,      // プランは30日保持
  tradeRetentionDays: 90,     // 完了トレードは90日保持
  autoSimilarityCheck: true,  // AIノート類似度チェック自動実行
  similarityThreshold: 0.85,  // 類似度閾値（85%以上で通知）
};

/**
 * ジョブ実行結果
 */
export interface JobResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * 市場状態の詳細
 */
export interface MarketStatusInfo {
  isOpen: boolean;
  isDST: boolean;
  message: string;
  nextEvent: string;
}

/**
 * スケジューラー状態
 */
export interface SchedulerStatus {
  isRunning: boolean;
  config: SideBSchedulerConfig;
  lastDailyPlanRun?: Date;
  lastMonitorRun?: Date;
  marketStatus: MarketStatusInfo;
  errors: string[];
  /** サマリースケジューラーの状態 */
  summaryScheduler: {
    isRunning: boolean;
    weeklyEnabled: boolean;
    monthlyEnabled: boolean;
    lastWeeklyRun?: Date;
    lastMonthlyRun?: Date;
  };
  /** 自動化機能の状態 */
  automation: {
    autoExpireTrades: boolean;
    autoCleanup: boolean;
    autoSummary: boolean;
    autoSimilarityCheck: boolean;
  };
}

// ===========================================
// スケジューラークラス
// ===========================================

export class SideBScheduler {
  private config: SideBSchedulerConfig;
  private isRunning: boolean = false;
  private monitorIntervalId?: NodeJS.Timeout;
  private dailyPlanIntervalId?: NodeJS.Timeout;
  private lastDailyPlanRun?: Date;
  private lastMonitorRun?: Date;
  private errors: string[] = [];
  private readonly isProduction: boolean;
  
  // サービス
  private orchestrator: AIOrchestrator;
  private marketDataService: MarketDataService;
  private cronSimilarityService: CronSimilarityService;

  constructor(configOverride?: Partial<SideBSchedulerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...configOverride };
    this.isProduction = process.env.NODE_ENV === 'production';
    
    // サービス初期化
    this.orchestrator = new AIOrchestrator();
    this.marketDataService = new MarketDataService();
    this.cronSimilarityService = new CronSimilarityService({
      similarityThreshold: this.config.similarityThreshold,
      debug: !this.isProduction,
    });
  }

  /**
   * スケジューラーを開始
   */
  start(): void {
    if (this.isRunning) {
      this.log('Side-Bスケジューラーは既に実行中です');
      return;
    }

    if (!this.config.enabled) {
      this.log('Side-Bスケジューラーは無効に設定されています');
      return;
    }

    this.log('Side-Bスケジューラーを開始します');
    this.log(`  対象シンボル: ${this.config.symbols.join(', ')}`);
    this.log(`  時間足: ${this.config.timeframe}`);
    this.log(`  監視間隔: ${this.config.monitorIntervalMs / 1000}秒`);
    this.log(`  日次プラン生成: ${this.config.dailyPlanTimeUTC} UTC`);
    this.log(`  Note自動生成: ${this.config.autoGenerateNote ? '有効' : '無効'}`);
    this.log(`  サマリー自動生成: ${this.config.autoSummary ? '有効' : '無効'}`);
    this.log(`  期限切れ自動キャンセル: ${this.config.autoExpireTrades ? '有効' : '無効'}`);
    this.log(`  類似度チェック: ${this.config.autoSimilarityCheck ? '有効' : '無効'} (閾値: ${this.config.similarityThreshold})`);
    
    // 市場状態をログ
    const marketInfo = getMarketStatusJST();
    this.log(`  市場状態: ${marketInfo.message}`);

    // 監視ジョブを開始（1分間隔）
    this.startMonitorJob();
    
    // 日次プランジョブを開始
    this.startDailyPlanJob();

    // 週次/月次サマリースケジューラーを連動起動
    if (this.config.autoSummary) {
      this.log('週次/月次サマリースケジューラーを連動起動します');
      summarySchedulerService.start({
        weeklyEnabled: true,
        monthlyEnabled: true,
      });
    }

    this.isRunning = true;
    this.log('Side-Bスケジューラーが開始されました');
  }

  /**
   * スケジューラーを停止
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.monitorIntervalId) {
      clearInterval(this.monitorIntervalId);
      this.monitorIntervalId = undefined;
    }

    if (this.dailyPlanIntervalId) {
      clearInterval(this.dailyPlanIntervalId);
      this.dailyPlanIntervalId = undefined;
    }

    // サマリースケジューラーも連動停止
    if (this.config.autoSummary) {
      summarySchedulerService.stop();
    }

    this.isRunning = false;
    this.log('Side-Bスケジューラーを停止しました');
  }

  /**
   * 設定を更新
   */
  updateConfig(newConfig: Partial<SideBSchedulerConfig>): void {
    const wasRunning = this.isRunning;
    
    if (wasRunning) {
      this.stop();
    }
    
    this.config = { ...this.config, ...newConfig };
    this.log('Side-Bスケジューラー設定を更新しました');
    
    if (wasRunning && this.config.enabled) {
      this.start();
    }
  }

  /**
   * 現在の状態を取得
   */
  getStatus(): SchedulerStatus {
    // サマリースケジューラーの状態を取得
    const summaryStatus = summarySchedulerService.getStatus();

    return {
      isRunning: this.isRunning,
      config: this.config,
      lastDailyPlanRun: this.lastDailyPlanRun,
      lastMonitorRun: this.lastMonitorRun,
      marketStatus: getMarketStatusJST(),
      errors: [...this.errors].slice(-10),  // 直近10件
      summaryScheduler: {
        isRunning: summaryStatus.isRunning,
        weeklyEnabled: summaryStatus.config.weeklyEnabled,
        monthlyEnabled: summaryStatus.config.monthlyEnabled,
        lastWeeklyRun: summaryStatus.lastWeeklyRun,
        lastMonthlyRun: summaryStatus.lastMonthlyRun,
      },
      automation: {
        autoExpireTrades: this.config.autoExpireTrades,
        autoCleanup: this.config.autoCleanup,
        autoSummary: this.config.autoSummary,
        autoSimilarityCheck: this.config.autoSimilarityCheck,
      },
    };
  }

  /**
   * 手動で日次プラン生成を実行
   */
  async runDailyPlanNow(): Promise<JobResult> {
    return this.executeDailyPlanJob();
  }

  /**
   * 手動で監視を実行
   */
  async runMonitorNow(): Promise<JobResult> {
    return this.executeMonitorJob();
  }

  // ===========================================
  // プライベートメソッド
  // ===========================================

  /**
   * 監視ジョブを開始
   */
  private startMonitorJob(): void {
    // 開始時に即時実行
    this.executeMonitorJob().catch((err) => {
      this.addError(`監視ジョブ初回実行エラー: ${err}`);
    });

    // 定期実行
    this.monitorIntervalId = setInterval(() => {
      this.executeMonitorJob().catch((err) => {
        this.addError(`監視ジョブエラー: ${err}`);
      });
    }, this.config.monitorIntervalMs);
  }

  /**
   * 日次プランジョブを開始
   * 
   * 1時間ごとにチェックし、指定時刻かつ市場開始時に実行
   */
  private startDailyPlanJob(): void {
    // 1時間ごとにチェック
    const checkIntervalMs = 60 * 60 * 1000;
    
    this.dailyPlanIntervalId = setInterval(() => {
      this.checkAndExecuteDailyPlan().catch((err) => {
        this.addError(`日次プランチェックエラー: ${err}`);
      });
    }, checkIntervalMs);

    // 開始時にも即時チェック
    this.checkAndExecuteDailyPlan().catch((err) => {
      this.addError(`日次プラン初回チェックエラー: ${err}`);
    });
  }

  /**
   * 日次プラン実行タイミングをチェック
   */
  private async checkAndExecuteDailyPlan(): Promise<void> {
    const now = new Date();
    const [targetHour] = this.config.dailyPlanTimeUTC.split(':').map(Number);
    const currentHourUTC = now.getUTCHours();

    // 指定時刻でない場合はスキップ
    if (currentHourUTC !== targetHour) {
      return;
    }

    // 今日既に実行済みならスキップ
    if (this.lastDailyPlanRun) {
      const lastRunDate = this.lastDailyPlanRun.toDateString();
      const todayDate = now.toDateString();
      if (lastRunDate === todayDate) {
        return;
      }
    }

    // 市場が閉まっている場合はスキップ
    if (!isFXMarketOpen(now)) {
      this.log('市場が閉まっているため日次プラン生成をスキップします');
      return;
    }

    // 日次プランを実行
    await this.executeDailyPlanJob();
  }

  /**
   * 監視ジョブを実行（高安値ベース検証）
   * 
   * 1時間ごとに直近60本の1分足を取得して:
   * 1. pending トレード: エントリー条件判定
   * 2. open トレード: SL/TP到達判定
   * 
   * 高安値を使用することで、終値のみの判定より正確な約定タイミングを特定
   */
  private async executeMonitorJob(): Promise<JobResult> {
    // 市場が閉まっている場合はスキップ（API呼び出しを節約）
    if (!isFXMarketOpen()) {
      return {
        success: true,
        message: '市場が閉まっているため監視をスキップしました',
      };
    }

    this.lastMonitorRun = new Date();
    this.log('1時間ごと検証を開始します（高安値ベース）');
    
    const results = {
      processed: 0,
      entries: 0,
      exits: 0,
      expired: 0,
      similarityChecks: 0,
      notificationsSent: 0,
      errors: [] as string[],
    };

    // 期限切れトレードの自動キャンセル（autoExpireTradesが有効な場合）
    if (this.config.autoExpireTrades) {
      try {
        const expiredCount = await expirePendingTrades();
        results.expired = expiredCount;
        if (expiredCount > 0) {
          this.log(`期限切れトレードを ${expiredCount} 件キャンセルしました`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '不明なエラー';
        results.errors.push(`期限切れ処理: ${message}`);
      }
    }

    try {
      // 各シンボルについて処理
      for (const symbol of this.config.symbols) {
        try {
          // 1分足60本を取得（1時間分）
          const minuteData = await this.marketDataService.getRecentMinuteOHLCV(symbol, 60);
          
          if (!minuteData || minuteData.length === 0) {
            results.errors.push(`${symbol}: 1分足データ取得失敗`);
            continue;
          }

          // MinuteOHLCV形式に変換
          const ohlcvData: MinuteOHLCV[] = minuteData.map(d => ({
            timestamp: d.timestamp,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume,
          }));

          // pending トレードの検証
          const pendingTrades = await findVirtualTrades({
            symbol,
            status: 'pending',
          });

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

            this.log(`[${symbol}] Trade ${trade.id}: ${summarizeVerificationResult(verificationResult)}`);

            if (verificationResult.entry?.triggered) {
              // エントリー約定
              await updateTradeToOpen(
                trade.id,
                verificationResult.entry.entryPrice!,
                verificationResult.entry.entryTime,
              );
              results.entries++;
              this.log(`[${symbol}] エントリー約定: ${verificationResult.entry.entryPrice}`);

              // 即座にSL/TPもチェック（同一バーでの決済）
              if (verificationResult.exit?.triggered) {
                await this.closeTradeInternal(
                  trade.id,
                  verificationResult.entry.entryPrice!,
                  verificationResult.exit.exitPrice!,
                  verificationResult.exit.exitReason!,
                  trade.direction as TradeDirection,
                  verificationResult.exit.exitTime,
                );
                results.exits++;
              }
            }
          }

          // open トレードの検証
          const openTrades = await findVirtualTrades({
            symbol,
            status: 'open',
          });

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

            this.log(`[${symbol}] Trade ${trade.id}: ${summarizeVerificationResult(verificationResult)}`);

            if (verificationResult.exit?.triggered) {
              const entryPrice = trade.actualEntry ?? trade.plannedEntry;
              await this.closeTradeInternal(
                trade.id,
                entryPrice,
                verificationResult.exit.exitPrice!,
                verificationResult.exit.exitReason!,
                trade.direction as TradeDirection,
                verificationResult.exit.exitTime,
              );
              results.exits++;
            }
          }

          // AIノート類似度チェック（autoSimilarityCheckが有効な場合）
          if (this.config.autoSimilarityCheck) {
            try {
              // OHLCVData形式に変換（indicatorServiceが期待する型）
              const ohlcvForSimilarity: OHLCVData[] = minuteData.map(d => ({
                timestamp: d.timestamp,
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
                volume: d.volume,
              }));

              const similarityResult = await this.cronSimilarityService.checkSimilarityAndNotify({
                symbol,
                ohlcvData: ohlcvForSimilarity,
                timeframe: this.config.timeframe,
              });

              results.similarityChecks++;
              results.notificationsSent += similarityResult.notificationsSent;

              if (similarityResult.similarNotesFound > 0) {
                this.log(`[${symbol}] 類似ノート検出: ${similarityResult.similarNotesFound}件, 通知送信: ${similarityResult.notificationsSent}件`);
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : '不明なエラー';
              results.errors.push(`${symbol} 類似度チェック: ${message}`);
              this.log(`[${symbol}] 類似度チェックエラー: ${message}`);
            }
          }

        } catch (error) {
          const message = error instanceof Error ? error.message : '不明なエラー';
          results.errors.push(`${symbol}: ${message}`);
        }
      }

      // 決済があった場合、Note自動生成
      if (this.config.autoGenerateNote && results.exits > 0) {
        await this.generateNotesForClosedTrades();
      }

      // 監視結果のサマリーメッセージを構築
      const summaryParts = [
        `処理 ${results.processed}件`,
        `エントリー ${results.entries}件`,
        `決済 ${results.exits}件`,
      ];
      if (results.expired > 0) {
        summaryParts.push(`期限切れキャンセル ${results.expired}件`);
      }
      if (this.config.autoSimilarityCheck && results.similarityChecks > 0) {
        summaryParts.push(`類似度チェック ${results.similarityChecks}件`);
        summaryParts.push(`通知送信 ${results.notificationsSent}件`);
      }
      const message = `監視完了: ${summaryParts.join(', ')}`;
      this.log(message);

      if (results.errors.length > 0) {
        this.log(`エラー: ${results.errors.join(', ')}`);
      }

      return {
        success: true,
        message,
        data: results,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '不明なエラー';
      this.addError(`監視ジョブ失敗: ${message}`);
      return { success: false, message };
    }
  }

  /**
   * トレードを決済（内部ヘルパー）
   */
  private async closeTradeInternal(
    tradeId: string,
    entryPrice: number,
    exitPrice: number,
    exitReason: ExitReason,
    direction: TradeDirection,
    exitTime?: Date,
  ): Promise<void> {
    const pnl = calculatePnL(direction, entryPrice, exitPrice);
    
    const input: CloseVirtualTradeInput = {
      exitPrice,
      exitReason,
      note: `高安値ベース検証により ${exitReason === 'stop_loss' ? 'SL' : 'TP'} 到達を検出`,
    };
    
    await closeTrade(tradeId, input, pnl.pips, pnl.amount);
    this.log(`決済完了: ${tradeId} (${exitReason}, ${pnl.pips > 0 ? '+' : ''}${pnl.pips.toFixed(1)} pips)`);
  }

  /**
   * 日次プランジョブを実行
   */
  private async executeDailyPlanJob(): Promise<JobResult> {
    this.lastDailyPlanRun = new Date();
    this.log('日次プラン生成を開始します');

    const results: { symbol: string; success: boolean; error?: string }[] = [];

    for (const symbol of this.config.symbols) {
      try {
        // 1. OHLCVデータ取得（getHistoricalDataを使用）
        this.log(`[${symbol}] OHLCVデータを取得中...`);
        const ohlcvData = await this.marketDataService.getHistoricalData(
          symbol,
          this.config.timeframe,
          100,  // 100本分
        );

        if (!ohlcvData || ohlcvData.length === 0) {
          throw new Error('OHLCVデータの取得に失敗');
        }

        // 2. オーケストレーターを使ってプラン生成（Research → Plan を一括処理）
        this.log(`[${symbol}] AI分析を実行中...`);
        const planResult = await this.orchestrator.generatePlan({
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
        });

        if (!planResult.success || !planResult.data) {
          throw new Error(planResult.error || 'プラン生成に失敗');
        }

        // 3. Tradeを作成（pending状態）
        this.log(`[${symbol}] 仮想トレードを作成中...`);
        const tradeResult = await createTradeFromPlan(planResult.data.id);

        if (!tradeResult.success) {
          throw new Error(tradeResult.error || 'トレード作成に失敗');
        }

        this.log(`[${symbol}] 日次プラン完了: Trade ID ${tradeResult.trade?.id}`);
        results.push({ symbol, success: true });

      } catch (error) {
        const message = error instanceof Error ? error.message : '不明なエラー';
        this.addError(`[${symbol}] 日次プラン失敗: ${message}`);
        results.push({ symbol, success: false, error: message });
      }
    }

    // 日次クリーンアップを実行（autoCleanupが有効な場合）
    if (this.config.autoCleanup) {
      try {
        this.log('日次クリーンアップを実行中...');
        const cleanupConfig: Partial<CleanupConfig> = {
          cleanupExpiredResearch: true,
          cleanupOldPlans: true,
          planRetentionDays: this.config.planRetentionDays,
          cleanupOldTrades: true,
          tradeRetentionDays: this.config.tradeRetentionDays,
        };
        const cleanupResult = await executeCleanup(cleanupConfig);
        
        // 何か削除された場合のみログ出力
        const totalDeleted = cleanupResult.expiredResearchCount 
          + cleanupResult.oldPlansCount 
          + cleanupResult.oldTradesCount;
        if (totalDeleted > 0) {
          this.log(`クリーンアップ完了: リサーチ ${cleanupResult.expiredResearchCount}件, ` +
                   `プラン ${cleanupResult.oldPlansCount}件, ` +
                   `トレード ${cleanupResult.oldTradesCount}件 削除`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '不明なエラー';
        this.addError(`クリーンアップエラー: ${message}`);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const message = `日次プラン生成完了: ${successCount}/${results.length} シンボル成功`;
    this.log(message);

    return {
      success: successCount > 0,
      message,
      data: results,
    };
  }

  /**
   * 決済済みトレードのNote自動生成
   */
  private async generateNotesForClosedTrades(): Promise<void> {
    try {
      // 最近決済されたトレードを取得（Note未生成のもの）
      const closedTrades = await findVirtualTrades({
        status: 'closed',
        limit: 10,
      });

      for (const trade of closedTrades) {
        // 既にNote生成済みかチェック
        const existingNote = await aiNoteRepository.findAITradeNoteByVirtualTradeId(trade.id);
        if (existingNote) {
          continue;
        }

        // プランを取得
        const plan = await planRepository.findById(trade.planId);
        if (!plan) {
          this.addError(`[Note生成] Trade ${trade.id}: プランが見つかりません`);
          continue;
        }

        this.log(`[Note生成] Trade ${trade.id} のNoteを生成中...`);
        
        try {
          // tradeとplanを正しい形式で渡す
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
            },
            {
              id: plan.id,
              marketAnalysis: {
                regime: plan.marketAnalysis?.regime || 'range',
                summary: plan.marketAnalysis?.summary || '',
              },
              scenarios: plan.scenarios?.map(s => ({
                direction: s.direction,
                priority: s.priority || 'primary',
              })) || [],
            }
          );
          this.log(`[Note生成] Trade ${trade.id} のNote生成完了`);
        } catch (error) {
          const message = error instanceof Error ? error.message : '不明なエラー';
          this.addError(`[Note生成] Trade ${trade.id} 失敗: ${message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '不明なエラー';
      this.addError(`Note自動生成エラー: ${message}`);
    }
  }

  /**
   * ログ出力
   */
  private log(message: string): void {
    if (!this.isProduction) {
      console.log(`[SideBScheduler] ${message}`);
    }
  }

  /**
   * エラーを記録
   */
  private addError(message: string): void {
    const timestamp = new Date().toISOString();
    this.errors.push(`${timestamp}: ${message}`);
    console.error(`[SideBScheduler] ${message}`);
    
    // エラーは最大100件まで保持
    if (this.errors.length > 100) {
      this.errors = this.errors.slice(-100);
    }
  }
}

// ===========================================
// シングルトンインスタンス
// ===========================================

let schedulerInstance: SideBScheduler | null = null;

/**
 * スケジューラーインスタンスを取得
 */
export function getSideBScheduler(config?: Partial<SideBSchedulerConfig>): SideBScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new SideBScheduler(config);
  }
  return schedulerInstance;
}

/**
 * スケジューラーインスタンスをリセット（テスト用）
 */
export function resetSideBScheduler(): void {
  if (schedulerInstance) {
    schedulerInstance.stop();
    schedulerInstance = null;
  }
}
