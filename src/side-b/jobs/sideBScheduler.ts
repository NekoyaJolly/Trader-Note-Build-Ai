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
  createTradeFromPlan,
  expirePendingTrades,
} from '../services/virtualTradeService';
import {
  verifyTradeState,
  summarizeVerificationResult,
  type MinuteOHLCV,
} from '../services/tradeVerificationService';
import { generateNoteFromTrade } from '../services/aiNoteService';
import { agentMemory } from '../agent/agentMemory';
import { discoveryAgent } from '../agents/DiscoveryAgent';
import { strategistAgent } from '../agents/StrategistAgent';
import { screeningOrchestrator } from '../bridge';
import { edgeLedger } from '../ledger';
import { findAITradeNotesInPeriod } from '../repositories/aiNoteRepository';
import { summarySchedulerService } from '../services/summarySchedulerService';
import { executeCleanup, type CleanupConfig } from '../services/dataCleanupService';
import { CronSimilarityService } from '../services/cronSimilarityService';
import * as aiNoteRepository from '../repositories/aiNoteRepository';
import {
  planRepository,
  researchRepository,
  findVirtualTrades,
  updateTradeToOpen,
  closeTrade,
} from '../repositories';
import { calculatePnL, type CloseVirtualTradeInput, type TradeDirection, type ExitReason } from '../models';
import { AIOrchestrator } from '../orchestrator/aiOrchestrator';
import { MarketDataService } from '../../services/marketDataService';
import { CTraderAuthService } from '../../backend/services/ctrader/ctraderAuthService';
import type { OHLCVData } from '../../services/indicators/indicatorService';
import { pdcaLoop } from '../agent';
import { PrismaClient } from '@prisma/client';
import { ohlcvRepository } from '../../backend/repositories/ohlcvRepository';
import path from 'path';
import { CrossoverAgent } from '../agents/CrossoverAgent';
import { MutationAgent } from '../agents/MutationAgent';
import { DiversityEnforcer } from '../evolution/DiversityEnforcer';
import { EvolutionLoop, type GenerationReport } from '../evolution/EvolutionLoop';
import { defaultOosBacktestRunner } from '../evolution/analysisEngineRobustnessAdapter';
import {
  MULTI_GENERATION_DEFAULTS,
  runMultiGenerationEvolutionV1,
  type MultiGenerationRunReport,
} from '../evolution/multiGenerationRunner';
import { evolutionInstanceCarryRepository } from '../../backend/repositories/evolutionInstanceCarryRepository';
import { StrategyPopulation } from '../evolution/StrategyPopulation';
import { SurrogateFitnessSimulator } from '../strategy_dsl/SurrogateFitnessSimulator';
import {
  runPromptEvolutionCycle,
  type PromptEvolutionResult,
} from '../prompts/registry/promptEvolutionJob';
import type { JsonValue } from '../../utils/jsonValue';

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
  /** 分析する時間足（執行足） */
  timeframe: string;
  /** 上位足の時間足（MTF分析用） */
  higherTimeframe: string;
  /** 監視間隔（ミリ秒） */
  monitorIntervalMs: number;
  /** プラン生成間隔（時間）- 0=日次のみ */
  planIntervalHours: number;
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
  /** Phase 4b 縮小版: 日次スクリーニング（unverified 仮説の事前評価）を有効にするか */
  autoScreening: boolean;
  /** 1回のスクリーニングジョブで処理する最大仮説数（コスト管理） */
  screeningMaxPerRun: number;
  /** Phase 4c: 日次フル検証（screening_passed 仮説の本格検証）を有効にするか */
  autoFullValidation: boolean;
  /** 1回のフル検証ジョブで処理する最大仮説数（Python 起動 + LLM コスト管理） */
  fullValidationMaxPerRun: number;
  /** Phase 5: 日次で戦略 DSL 進化ループを回すか（LLM+BT コスト大） */
  autoEvolution: boolean;
  /** 進化ループ対象レジーム（StrategyDSL.regimeTarget と対応） */
  evolutionRegimes: string[];
  /**
   * Phase A (2026-05-09): 1 cron 実行あたりの世代数。
   * - default 1 = 単世代経路 (= 後方互換、従来挙動)
   * - 2 以上 = `runMultiGenerationEvolutionV1` 経由で世代間に
   *   tradesByDslId / RepairHint / RepairOutcome baseline を引き継ぐ
   * - 上限 5 (= multiGenerationRunner の MULTI_GENERATION_DEFAULTS.maxGenerations)
   *
   * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.A
   */
  evolutionGenerations: number;
  /**
   * Phase A: Adaptive Repair / Mutation Budget v1 を有効化するか (default false)。
   * `evolutionGenerations >= 2` でのみ機能する (= 単世代では observation のみ)。
   */
  evolutionAdaptiveBudget: boolean;
  /**
   * Phase A: Quality-Diversity Archive Lite v1 を有効化するか (default false)。
   * `evolutionGenerations >= 2` でのみ機能する。
   */
  evolutionQDArchive: boolean;
  /** Phase A: QD-Archive parent injection 上限 (default 2)。 */
  evolutionQDParentLimit: number;
  /** Phase 6: 月次プロンプト進化ジョブを自動トリガーするか(既定 false、手動のみ) */
  autoTriggerPromptEvolution: boolean;
  /** cTrader アカウントID（cTraderデータソース有効化用） */
  ctraderAccountId?: string;
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
  higherTimeframe: '4h',      // MTF上位足: 4時間足
  monitorIntervalMs: 60 * 60 * 1000,  // 1時間間隔（高安値ベース検証）
  planIntervalHours: 4,       // 4時間ごとにプラン再生成
  dailyPlanTimeUTC: '00:00',  // UTC 00:00 = JST 09:00（初回プラン）
  autoGenerateNote: true,
  autoSummary: true,          // 週次/月次サマリー自動生成
  autoExpireTrades: true,     // 期限切れ自動キャンセル
  autoCleanup: true,          // 古いデータ自動クリーンアップ
  planRetentionDays: 30,      // プランは30日保持
  tradeRetentionDays: 90,     // 完了トレードは90日保持
  autoSimilarityCheck: true,  // AIノート類似度チェック自動実行
  similarityThreshold: 0.85,  // 類似度閾値（85%以上で通知）
  autoScreening: true,        // Phase 4b: 日次スクリーニング自動実行
  screeningMaxPerRun: 10,     // 1回の実行で最大10件
  autoFullValidation: true,   // Phase 4c: 日次フル検証自動実行
  fullValidationMaxPerRun: 5, // Python + LLM のコストを考慮して控えめに
  autoEvolution: false, // Phase 5: 意図的に無効（有効化時は LLM×複数レジームでコスト注意）
  evolutionRegimes: [
    'trending_with_pullback',
    'breakout',
    'consolidation',
    'reversal',
  ],
  // Phase A: 既定は単世代 (= 後方互換)。env EVOLUTION_GENERATIONS で上書き可能。
  evolutionGenerations: 1,
  evolutionAdaptiveBudget: false,
  evolutionQDArchive: false,
  evolutionQDParentLimit: 2,
  autoTriggerPromptEvolution: false, // Phase 6: 既定は手動のみ(CLI / UI からの明示的トリガー)
};

/**
 * Filter Evolution Phase B-3 (2026-05-09): EvolutionInstanceCarry の retention 期限。
 *
 * 既定 14 日。日次クリーンアップ (= autoCleanup) のループで `deleteOlderThan(14)` を呼ぶ。
 * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.4
 *
 * 必要なら env で上書きする経路を将来追加可能 (現状は固定値で運用)。14 日より短くすると
 * 「途中で評価が長引いた regime の carry が消える」リスクがあり、長くすると DB 容量が
 * 線形に増える (= 設計書 §8.2 の容量試算 168MB / 14d を超過)。
 */
const EVOLUTION_CARRY_RETENTION_DAYS = 14;

/**
 * Phase A: 環境変数から進化ループの世代数 / Adaptive Budget / QD-Archive 切り替えを読む。
 *
 * 環境変数 (すべて optional、未指定時は DEFAULT_CONFIG を使う):
 *   - EVOLUTION_GENERATIONS: 1〜5 の整数。範囲外は ignore + warning。
 *   - EVOLUTION_ADAPTIVE_BUDGET: 'true' / 'false' (case-insensitive)。
 *   - EVOLUTION_QD_ARCHIVE: 'true' / 'false'。
 *   - EVOLUTION_QD_PARENT_LIMIT: 0 以上の整数。負数は ignore。
 *
 * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.A.2
 *
 * @see SideBSchedulerConfig
 */
/**
 * 環境変数値が「整数表現の文字列」であることを厳密に検証する。
 *
 * `parseInt` だと '2abc' / '2.9' / '  2 ' を 2 として受理してしまう。本関数は
 * trim 後に `^-?\d+$` 全体一致でなければ null を返し、設定ミスを silent fail
 * させない (= PR #138 Copilot review で指摘された運用事故防止)。
 */
function parseStrictInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * 環境変数値を `'true' | 'false'` で厳密に判定する。trim + toLowerCase 後に
 * 'true' / 'false' でなければ null (= 想定外文字列、warning 対象)。
 */
function parseStrictBool(raw: string): boolean | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return null;
}

function readEvolutionEnvOverrides(): Partial<SideBSchedulerConfig> {
  const out: Partial<SideBSchedulerConfig> = {};

  const gensRaw = process.env.EVOLUTION_GENERATIONS;
  if (gensRaw !== undefined && gensRaw !== '') {
    const parsed = parseStrictInt(gensRaw);
    if (
      parsed !== null &&
      parsed >= 1 &&
      parsed <= MULTI_GENERATION_DEFAULTS.maxGenerations
    ) {
      out.evolutionGenerations = parsed;
    } else {
      console.warn(
        `[SideBScheduler] EVOLUTION_GENERATIONS=${gensRaw} は不正値 (1〜${MULTI_GENERATION_DEFAULTS.maxGenerations} の整数のみ)、無視します`,
      );
    }
  }

  const adaptiveRaw = process.env.EVOLUTION_ADAPTIVE_BUDGET;
  if (adaptiveRaw !== undefined && adaptiveRaw !== '') {
    const parsed = parseStrictBool(adaptiveRaw);
    if (parsed === null) {
      console.warn(
        `[SideBScheduler] EVOLUTION_ADAPTIVE_BUDGET=${adaptiveRaw} は不正値 ('true' | 'false' のみ)、無視します`,
      );
    } else {
      out.evolutionAdaptiveBudget = parsed;
    }
  }

  const qdRaw = process.env.EVOLUTION_QD_ARCHIVE;
  if (qdRaw !== undefined && qdRaw !== '') {
    const parsed = parseStrictBool(qdRaw);
    if (parsed === null) {
      console.warn(
        `[SideBScheduler] EVOLUTION_QD_ARCHIVE=${qdRaw} は不正値 ('true' | 'false' のみ)、無視します`,
      );
    } else {
      out.evolutionQDArchive = parsed;
    }
  }

  const qdLimitRaw = process.env.EVOLUTION_QD_PARENT_LIMIT;
  if (qdLimitRaw !== undefined && qdLimitRaw !== '') {
    const parsed = parseStrictInt(qdLimitRaw);
    if (parsed !== null && parsed >= 0) {
      out.evolutionQDParentLimit = parsed;
    } else {
      console.warn(
        `[SideBScheduler] EVOLUTION_QD_PARENT_LIMIT=${qdLimitRaw} は不正値 (>=0 の整数のみ)、無視します`,
      );
    }
  }

  return out;
}

/**
 * ジョブ実行結果
 */
export interface JobResult {
  success: boolean;
  message: string;
  data?: JsonValue;
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
  private planIntervalId?: NodeJS.Timeout;
  private discoveryIntervalId?: NodeJS.Timeout;
  private screeningIntervalId?: NodeJS.Timeout;
  private fullValidationIntervalId?: NodeJS.Timeout;
  private evolutionIntervalId?: NodeJS.Timeout;
  private promptEvolutionIntervalId?: NodeJS.Timeout;
  private lastPlanRun: Map<string, Date> = new Map();
  private lastMonitorRun?: Date;
  private lastCleanupRun?: Date;
  private lastDiscoveryRun?: Date;
  private lastScreeningRun?: Date;
  private lastFullValidationRun?: Date;
  private lastEvolutionRun?: Date;
  private lastPromptEvolutionRun?: Date;
  private errors: string[] = [];
  private readonly isProduction: boolean;

  // サービス
  private orchestrator: AIOrchestrator;
  private marketDataService: MarketDataService;
  private cronSimilarityService: CronSimilarityService;
  private prisma: PrismaClient;

  constructor(configOverride?: Partial<SideBSchedulerConfig>) {
    // Phase A: env からの override を DEFAULT_CONFIG と configOverride の中間に挟む。
    // 優先順位 (高 → 低): configOverride 引数 > 環境変数 > DEFAULT_CONFIG。
    const envOverrides = readEvolutionEnvOverrides();
    this.config = { ...DEFAULT_CONFIG, ...envOverrides, ...configOverride };
    this.isProduction = process.env.NODE_ENV === 'production';

    // サービス初期化
    this.prisma = new PrismaClient();
    this.orchestrator = new AIOrchestrator();
    this.marketDataService = new MarketDataService();
    this.cronSimilarityService = new CronSimilarityService({
      similarityThreshold: this.config.similarityThreshold,
      debug: !this.isProduction,
    });
  }

  /**
   * cTrader データソースを自動検出・設定
   * 
   * 優先順位:
   * 1. config.ctraderAccountId（手動指定）
   * 2. CTraderToken テーブルから最新のトークンを自動検出
   * 
   * cTrader認証済みユーザーがいれば自動的にcTrader優先データ取得が有効になる
   */
  private async initCTraderDataSource(): Promise<void> {
    try {
      let accountId = this.config.ctraderAccountId;

      // 手動指定がない場合、DBから自動検出
      if (!accountId) {
        const latestToken = await this.prisma.cTraderToken.findFirst({
          orderBy: { updatedAt: 'desc' },
          select: { accountId: true },
        });

        if (latestToken) {
          accountId = latestToken.accountId;
          this.log(`cTrader アカウント自動検出: ${accountId}`);
        } else {
          this.log('cTrader トークン未登録 → Twelve Dataのみ使用');
          return;
        }
      }

      const authService = new CTraderAuthService(this.prisma);
      this.marketDataService.configureCTrader(accountId, authService);
      this.log('cTrader データソースを有効化しました');
    } catch (error) {
      this.log(`cTrader データソース設定エラー（Twelve Dataで続行）: ${String(error)}`);
    }
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

    // cTrader データソースを自動検出してから起動
    this.initCTraderDataSource().then(() => {
      this.startInternal();
    }).catch((err) => {
      this.log(`cTrader初期化エラー（Twelve Dataで続行）: ${err}`);
      this.startInternal();
    });
  }

  /**
   * 内部起動処理（cTrader初期化後に呼ばれる）
   */
  private startInternal(): void {

    this.log('Side-Bスケジューラーを開始します');
    this.log(`  対象シンボル: ${this.config.symbols.join(', ')}`);
    this.log(`  執行足: ${this.config.timeframe} / 上位足: ${this.config.higherTimeframe}`);
    this.log(`  監視間隔: ${this.config.monitorIntervalMs / 1000}秒`);
    this.log(`  プラン生成間隔: ${this.config.planIntervalHours}時間ごと`);
    this.log(`  cTrader: ${this.marketDataService.isCTraderAvailable() ? '有効' : '無効（Twelve Data使用）'}`);
    this.log(`  Note自動生成: ${this.config.autoGenerateNote ? '有効' : '無効'}`);
    this.log(`  サマリー自動生成: ${this.config.autoSummary ? '有効' : '無効'}`);
    this.log(`  期限切れ自動キャンセル: ${this.config.autoExpireTrades ? '有効' : '無効'}`);
    this.log(`  類似度チェック: ${this.config.autoSimilarityCheck ? '有効' : '無効'} (閾値: ${this.config.similarityThreshold})`);

    // 市場状態をログ
    const marketInfo = getMarketStatusJST();
    this.log(`  市場状態: ${marketInfo.message}`);

    // 監視ジョブを開始
    this.startMonitorJob();

    // 定期プランジョブを開始
    this.startPlanJob();

    // 週次 DiscoveryAgent ジョブを開始（Phase 4a）
    this.startDiscoveryJob();

    // 日次スクリーニングジョブを開始（Phase 4b 縮小版）
    if (this.config.autoScreening) {
      this.startScreeningJob();
    }

    // 日次フル検証ジョブを開始（Phase 4c）
    if (this.config.autoFullValidation) {
      this.startFullValidationJob();
    }

    // Phase 5: 日次進化ループ（戻り間にスリープあり）
    if (this.config.autoEvolution) {
      this.startEvolutionJob();
    }

    // Phase 6: 月次プロンプト進化ジョブ(既定は無効)
    if (this.config.autoTriggerPromptEvolution) {
      this.startPromptEvolutionJob();
    }

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

    if (this.planIntervalId) {
      clearInterval(this.planIntervalId);
      this.planIntervalId = undefined;
    }

    if (this.discoveryIntervalId) {
      clearInterval(this.discoveryIntervalId);
      this.discoveryIntervalId = undefined;
    }

    if (this.screeningIntervalId) {
      clearInterval(this.screeningIntervalId);
      this.screeningIntervalId = undefined;
    }

    if (this.fullValidationIntervalId) {
      clearInterval(this.fullValidationIntervalId);
      this.fullValidationIntervalId = undefined;
    }

    if (this.evolutionIntervalId) {
      clearInterval(this.evolutionIntervalId);
      this.evolutionIntervalId = undefined;
    }

    if (this.promptEvolutionIntervalId) {
      clearInterval(this.promptEvolutionIntervalId);
      this.promptEvolutionIntervalId = undefined;
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

    // 最新のプラン実行日時を特定
    let latestPlanRun: Date | undefined;
    for (const [, date] of this.lastPlanRun) {
      if (!latestPlanRun || date > latestPlanRun) latestPlanRun = date;
    }

    return {
      isRunning: this.isRunning,
      config: this.config,
      lastDailyPlanRun: latestPlanRun,
      lastMonitorRun: this.lastMonitorRun,
      marketStatus: getMarketStatusJST(),
      errors: [...this.errors].slice(-10),
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
    return this.executePlanJob();
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
   * 定期プランジョブを開始
   *
   * planIntervalHours ごとにプラン再生成（デフォルト: 4時間）
   * 市場閉場中はスキップ
   */
  private startPlanJob(): void {
    const checkIntervalMs = 60 * 60 * 1000; // 1時間ごとにチェック

    this.planIntervalId = setInterval(() => {
      this.checkAndExecutePlan().catch((err) => {
        this.addError(`プランチェックエラー: ${err}`);
      });
    }, checkIntervalMs);

    // 開始時にも即時チェック
    this.checkAndExecutePlan().catch((err) => {
      this.addError(`プラン初回チェックエラー: ${err}`);
    });
  }

  /**
   * 週次 DiscoveryAgent ジョブを開始（Phase 4a）
   *
   * 1時間ごとにチェックし、前回実行から7日以上経過していたら実行する。
   * 過去7日分の AITradeNote を集計して EdgeLedger に新仮説を登録。
   */
  private startDiscoveryJob(): void {
    const checkIntervalMs = 60 * 60 * 1000;
    const weeklyMs = 7 * 24 * 60 * 60 * 1000;

    this.discoveryIntervalId = setInterval(() => {
      const now = Date.now();
      if (
        !this.lastDiscoveryRun ||
        now - this.lastDiscoveryRun.getTime() >= weeklyMs
      ) {
        this.runDiscoveryNow().catch((err) => {
          this.addError(`Discoveryジョブエラー: ${err}`);
        });
      }
    }, checkIntervalMs);
  }

  /**
   * Phase 4b 縮小版: 日次スクリーニングジョブを開始
   *
   * 1時間ごとにチェックし、前回実行から24時間以上経過していたら
   * unverified 仮説を最大 `screeningMaxPerRun` 件取り出してスクリーニングする。
   */
  private startScreeningJob(): void {
    const checkIntervalMs = 60 * 60 * 1000;
    const dailyMs = 24 * 60 * 60 * 1000;

    this.screeningIntervalId = setInterval(() => {
      const now = Date.now();
      if (
        !this.lastScreeningRun ||
        now - this.lastScreeningRun.getTime() >= dailyMs
      ) {
        this.runScreeningNow().catch((err) => {
          this.addError(`スクリーニングジョブエラー: ${err}`);
        });
      }
    }, checkIntervalMs);

    // 起動時の即時チェック（初回運用時のためのジャンプスタート）
    this.runScreeningNow().catch((err) => {
      this.addError(`スクリーニング初回実行エラー: ${err}`);
    });
  }

  /**
   * Phase 4b 縮小版 + Critical-4 段階 1.6: スクリーニングを手動実行
   *
   * unverified 仮説を最大 `limit` 件取り出し、
   * ScreeningOrchestrator.runScreening で順次評価する。
   * 各仮説の失敗は他仮説に影響させない（best-effort）。
   *
   * @param options.limit  config.screeningMaxPerRun の override (運用側で 1 回分の処理量を絞る)
   * @param options.period BT 対象期間 override (env SCREENING_PERIOD_DAYS のデフォルトを上書き)
   */
  async runScreeningNow(options?: {
    limit?: number;
    period?: { start: string; end: string };
  }): Promise<{
    processed: number;
    passed: number;
    rejected: number;
    notTestable: number;
    errors: number;
  }> {
    const limit = Math.max(1, options?.limit ?? this.config.screeningMaxPerRun);
    const periodLog = options?.period ? ` period=${options.period.start}〜${options.period.end}` : '';
    this.log(`[Screening] 事前スクリーニングを開始 (上限 ${limit}件)${periodLog}`);

    const summary = { processed: 0, passed: 0, rejected: 0, notTestable: 0, errors: 0 };

    try {
      const unverified = await edgeLedger.findByStatus('unverified');
      const targets = unverified.slice(0, limit);
      this.log(`[Screening] 対象仮説: ${targets.length}件`);

      for (const hyp of targets) {
        summary.processed++;
        try {
          const symbol = hyp.symbols[0];
          const lensSnapshot = symbol ? agentMemory.getCurrentLensSnapshot(symbol) : undefined;
          const result = await screeningOrchestrator.runScreening(hyp.id, {
            lensSnapshot,
            ...(options?.period ? { period: options.period } : {}),
          });

          if (result.verdict === 'screening_passed') {
            summary.passed++;
            this.log(`[Screening] passed: ${hyp.id} pf=${result.metrics.pf.toFixed(3)} winRate=${result.metrics.winRate.toFixed(3)} trades=${result.metrics.tradeCount}`);
          } else if (result.verdict === 'rejected') {
            summary.rejected++;
            this.log(`[Screening] rejected: ${hyp.id} reasons=[${result.reasons.join(', ')}]`);
          } else {
            summary.notTestable++;
            this.log(`[Screening] not_testable: ${hyp.id} reason=${result.reason}`);
          }
        } catch (err) {
          summary.errors++;
          const message = err instanceof Error ? err.message : String(err);
          this.addError(`[Screening] ${hyp.id} 失敗: ${message}`);
        }
      }
      this.lastScreeningRun = new Date();
      this.log(`[Screening] 完了: processed=${summary.processed} passed=${summary.passed} rejected=${summary.rejected} not_testable=${summary.notTestable} errors=${summary.errors}`);
      try {
        pdcaLoop.notifyValidationBatchComplete('screening', summary);
      } catch { /* PDCAループ未起動時は無視 */ }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.addError(`[Screening] 仮説取得失敗: ${message}`);
    }

    return summary;
  }

  /**
   * Phase 4c: 日次フル検証ジョブを開始
   *
   * 1時間ごとにチェックし、前回実行から 24 時間以上経過していたら
   * screening_passed 仮説を最大 fullValidationMaxPerRun 件ピックして
   * StrategistAgent.validate で confirmed / rejected に遷移させる。
   */
  private startFullValidationJob(): void {
    const checkIntervalMs = 60 * 60 * 1000;
    const dailyMs = 24 * 60 * 60 * 1000;

    this.fullValidationIntervalId = setInterval(() => {
      const now = Date.now();
      if (
        !this.lastFullValidationRun ||
        now - this.lastFullValidationRun.getTime() >= dailyMs
      ) {
        this.runFullValidationNow().catch((err) => {
          this.addError(`フル検証ジョブエラー: ${err}`);
        });
      }
    }, checkIntervalMs);

    // 起動時の初回実行
    this.runFullValidationNow().catch((err) => {
      this.addError(`フル検証初回実行エラー: ${err}`);
    });
  }

  /**
   * Phase 4c: 本格検証を手動実行
   *
   * screening_passed 仮説を最大 fullValidationMaxPerRun 件取り出し、
   * StrategistAgent.validate で順次評価する。Python 起動 + LLM コストを
   * 抑えるため各仮説間にクールダウンを挟む（10秒）。
   */
  async runFullValidationNow(): Promise<{
    processed: number;
    confirmed: number;
    rejected: number;
    notTestable: number;
    errors: number;
  }> {
    const limit = Math.max(1, this.config.fullValidationMaxPerRun);
    this.log(`[FullValidation] 本格検証を開始 (上限 ${limit}件)`);

    const summary = { processed: 0, confirmed: 0, rejected: 0, notTestable: 0, errors: 0 };

    try {
      const targets = await edgeLedger.findByStatus('screening_passed');
      const limited = targets.slice(0, limit);
      this.log(`[FullValidation] 対象仮説: ${limited.length}件`);

      for (let i = 0; i < limited.length; i++) {
        const hyp = limited[i];
        summary.processed++;
        try {
          const verdict = await strategistAgent.validate(hyp.id);
          if (verdict.verdict === 'confirmed') {
            summary.confirmed++;
            this.log(`[FullValidation] confirmed: ${hyp.id}`);
          } else if (verdict.verdict === 'rejected') {
            summary.rejected++;
            this.log(`[FullValidation] rejected: ${hyp.id} reasons=[${verdict.baseCriteriaReasons.join(', ')}]`);
          } else {
            summary.notTestable++;
            this.log(`[FullValidation] ${verdict.verdict}: ${hyp.id}`);
          }
        } catch (err) {
          summary.errors++;
          const message = err instanceof Error ? err.message : String(err);
          this.addError(`[FullValidation] ${hyp.id} 失敗: ${message}`);
        }

        // クールダウン（Python コンテナ / LLM API 保護）。最後は不要
        if (i < limited.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 10000));
        }
      }

      this.lastFullValidationRun = new Date();
      this.log(
        `[FullValidation] 完了: processed=${summary.processed} confirmed=${summary.confirmed} rejected=${summary.rejected} not_testable=${summary.notTestable} errors=${summary.errors}`,
      );
      try {
        pdcaLoop.notifyValidationBatchComplete('full_validation', summary);
      } catch { /* PDCAループ未起動時は無視 */ }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.addError(`[FullValidation] 対象取得失敗: ${message}`);
    }

    return summary;
  }

  /**
   * Phase 5: 日次進化ループジョブ（1時間ごとにチェックし 24h ごとに実行）
   */
  private startEvolutionJob(): void {
    const checkIntervalMs = 60 * 60 * 1000;
    const dailyMs = 24 * 60 * 60 * 1000;

    this.evolutionIntervalId = setInterval(() => {
      const now = Date.now();
      if (!this.lastEvolutionRun || now - this.lastEvolutionRun.getTime() >= dailyMs) {
        this.runEvolutionNow().catch((err) => {
          this.addError(`進化ループジョブエラー: ${err}`);
        });
      }
    }, checkIntervalMs);
  }

  /**
   * Phase 6: 月次プロンプト進化ジョブを開始する。
   * 1 時間ごとにチェックし、最終実行から 30 日経過していたら実行する。
   * autoTriggerPromptEvolution=false(既定)なら呼ばれない。
   */
  private startPromptEvolutionJob(): void {
    const checkIntervalMs = 60 * 60 * 1000;
    const monthlyMs = 30 * 24 * 60 * 60 * 1000;
    this.promptEvolutionIntervalId = setInterval(() => {
      const now = Date.now();
      if (
        !this.lastPromptEvolutionRun ||
        now - this.lastPromptEvolutionRun.getTime() >= monthlyMs
      ) {
        this.runPromptEvolutionNow().catch((err) => {
          this.addError(`プロンプト進化ジョブエラー: ${err}`);
        });
      }
    }, checkIntervalMs);
  }

  /**
   * Phase 6: プロンプト進化を手動実行する。
   * - 全エージェントの experimental 成績を評価
   * - 昇格候補のレポートを返す(自動昇格はしない = 人間承認は approveCli.ts 経由)
   * - 成績不振の experimental は reject
   * - PromptMutationAgent で新 experimental を 3 件/エージェント 生成
   */
  async runPromptEvolutionNow(): Promise<PromptEvolutionResult> {
    this.log('[PromptEvolution] 月次プロンプト進化を実行');
    const result = await runPromptEvolutionCycle();
    this.lastPromptEvolutionRun = new Date();
    for (const r of result.reports) {
      this.log(
        `[PromptEvolution] agent=${r.agentName} new=${r.newExperimentalIds.length} rejected=${r.rejectedIds.length} promotionCandidates=${r.promotionCandidates.length} errors=${r.errors.length}`,
      );
    }
    return result;
  }

  /**
   * Phase 5 + Phase A: 進化ループを手動実行（全レジーム順、各レジームで N 世代）
   *
   * Phase A (2026-05-09): `evolutionGenerations >= 2` で `runMultiGenerationEvolutionV1`
   * 経由になり、世代間で tradesByDslId / RepairHint / RepairOutcome baseline が引き継がれる。
   * `=1` (default) では従来単世代経路を維持 (= 完全な後方互換)。
   *
   * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.A
   */
  async runEvolutionNow(): Promise<{ regimeReports: number; errors: string[] }> {
    const regimes = this.config.evolutionRegimes?.length
      ? this.config.evolutionRegimes
      : DEFAULT_CONFIG.evolutionRegimes;
    const persistPath = path.join(process.cwd(), 'data', 'evolution', 'strategy-population.json');
    const population = new StrategyPopulation(persistPath);
    await population.load();

    const end = new Date();
    const start = new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);
    const defaultPeriod = {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };

    // Phase 5A: EdgeLedger への自動登録は撤廃（候補抽出のみ）
    // PR #110: 本番 scheduler では analysis-engine `/v1/oos-validation` を叩く
    //   `defaultOosBacktestRunner` を注入し、validation_candidate に対する OOS 観測を
    //   実データで動かす (= validation_confirmed / oos_passed / oos_failed が trend に出る)
    const loop = new EvolutionLoop({
      population,
      adapter: new SurrogateFitnessSimulator(),
      mutationAgent: new MutationAgent(),
      crossoverAgent: new CrossoverAgent(),
      enforcer: new DiversityEnforcer(),
      defaultPeriod,
      oosBacktestRunner: defaultOosBacktestRunner,
      // Phase B-2 (2026-05-09): cron 起動を跨いだ in-memory cache 復元を有効化。
      // EvolutionLoop は既定 null だが、本番 scheduler では DB 接続済 repo を明示注入する。
      evolutionInstanceCarryRepo: evolutionInstanceCarryRepository,
    });

    // PR #138 Copilot review #4: configOverride 経由で 0 や maxGenerations 超過の値が渡されると
    // runner 側で clamp される一方で scheduler のログ表示や useMultiGen 判定がズレる。
    // ここで [1, MULTI_GENERATION_DEFAULTS.maxGenerations] に clamp してから dispatch する。
    const rawGenerations = this.config.evolutionGenerations ?? 1;
    const generations = Math.max(
      1,
      Math.min(MULTI_GENERATION_DEFAULTS.maxGenerations, Math.floor(rawGenerations)),
    );
    if (generations !== rawGenerations) {
      this.log(
        `[Evolution] 設定 evolutionGenerations=${rawGenerations} を [1, ${MULTI_GENERATION_DEFAULTS.maxGenerations}] に clamp して ${generations} で実行`,
      );
    }
    const useMultiGen = generations >= 2;
    const errors: string[] = [];
    let n = 0;
    this.log(
      `[Evolution] 進化ループ開始: ${regimes.length} レジーム, ` +
        `期間 ${defaultPeriod.start}〜${defaultPeriod.end}, ` +
        `世代数=${generations} (${useMultiGen ? 'multi-gen' : 'single-gen'}), ` +
        `adaptive=${this.config.evolutionAdaptiveBudget} qd=${this.config.evolutionQDArchive}`,
    );

    for (let i = 0; i < regimes.length; i++) {
      const regime = regimes[i];
      try {
        if (useMultiGen) {
          const runReport = await this.runEvolutionMultiGen(loop, regime, generations);
          // multi-gen runner の trend summary をログに残す + 個別 generation report も流す
          for (const g of runReport.generations) {
            n++;
            if (g.report) {
              this.log(
                `[Evolution] regime=${regime} gen=${g.generationIndex + 1}/${generations} ` +
                  `elites=${g.report.eliteIds.length} mut=${g.report.mutantsReceived} ` +
                  `cross=${g.report.crossoversReceived} ` +
                  `candidates=${g.report.promotionCandidates.length} ` +
                  `divBoost=${g.report.lowDiversityBoost} status=${g.status}`,
              );
              if (g.report.errors.length > 0) errors.push(...g.report.errors);
              // Phase E (2026-05-09): 各世代終了時に PDCA に通知して実 loop の thinking log に記録。
              // 例外は飲んで世代結果に影響させない。
              this.notifyPdcaEvolutionGeneration(
                regime,
                g.generationIndex,
                generations,
                g.report,
              );
            } else {
              this.log(
                `[Evolution] regime=${regime} gen=${g.generationIndex + 1}/${generations} ` +
                  `status=${g.status} error=${g.errorMessage ?? 'unknown'}`,
              );
              if (g.errorMessage) errors.push(`${regime} gen ${g.generationIndex + 1}: ${g.errorMessage}`);
            }
          }
          this.log(
            `[Evolution] regime=${regime} multi-gen trend: ` +
              `formalBtPassed=[${runReport.trendSummary.formalBtPassedByGeneration.join(',')}] ` +
              `validationConfirmed=[${runReport.trendSummary.validationConfirmedByGeneration.join(',')}] ` +
              `repairImproved=[${runReport.trendSummary.repairOutcomeImprovedByGeneration.join(',')}] ` +
              `stoppedEarly=${runReport.trendSummary.stoppedEarly}` +
              (runReport.trendSummary.stopReason ? ` reason=${runReport.trendSummary.stopReason}` : ''),
          );
        } else {
          // 後方互換: 単世代経路 (= evolutionGenerations === 1)
          const report = await loop.runOneGeneration(regime);
          n++;
          this.log(
            `[Evolution] regime=${regime} elites=${report.eliteIds.length} ` +
              `mut=${report.mutantsReceived} cross=${report.crossoversReceived} ` +
              `candidates=${report.promotionCandidates.length} divBoost=${report.lowDiversityBoost}`,
          );
          if (report.errors.length > 0) errors.push(...report.errors);
          // Phase E (2026-05-09): 単世代経路でも PDCA に世代完了通知を送る (= multi-gen と同じ経路)。
          this.notifyPdcaEvolutionGeneration(regime, 0, 1, report);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${regime}: ${msg}`);
        this.addError(`[Evolution] ${regime} 失敗: ${msg}`);
      }
      if (i < regimes.length - 1) {
        await new Promise((r) => setTimeout(r, 30_000));
      }
    }

    this.lastEvolutionRun = new Date();
    this.log(`[Evolution] 進化ループ完了: レジーム×世代の合計実行=${n}件`);
    return { regimeReports: n, errors };
  }

  /**
   * Phase A: multi-generation runner 経由の 1 regime 実行。
   *
   * `runMultiGenerationEvolutionV1` に loop.runOneGeneration を adapter で渡し、
   * 世代間で tradesByDslId / RepairHint / RepairOutcome baseline を引き継ぐ。
   * QD-Archive / Adaptive Budget は config で個別に切り替え可能。
   */
  private async runEvolutionMultiGen(
    loop: EvolutionLoop,
    regime: string,
    generations: number,
  ): Promise<MultiGenerationRunReport> {
    return await runMultiGenerationEvolutionV1({
      options: {
        generations,
        regime,
        adaptiveRepairBudget: this.config.evolutionAdaptiveBudget,
        qualityDiversityArchive: this.config.evolutionQDArchive,
        qualityDiversityArchiveParentLimit: this.config.evolutionQDParentLimit,
        // 世代間引き継ぎは default ON のまま (= Filter Evolution M2/M3 が成立する条件)
      },
      runOneGeneration: async ({
        repairHintsForMutation,
        repairBaselinesForOutcome,
        mutationBudgetAllocation,
        qualityDiversityArchiveParents,
      }) =>
        loop.runOneGeneration(regime, {
          repairHintsForMutation,
          repairBaselinesForOutcome,
          mutationBudgetAllocation,
          qualityDiversityArchiveParents,
        }),
    });
  }

  /**
   * Filter Evolution Phase E (2026-05-09): 進化ループ世代完了を PDCA に通知。
   *
   * GenerationReport から最低限の集計値を抜粋して PDCA loop の通知 hook に渡す。
   * pdcaLoop 側の `notifyEvolutionGenerationComplete` で thinking log に記録される。
   *
   * 例外は飲んで世代結果に影響させない (= 通知失敗で進化ループが停止しないよう保護)。
   * Phase D の GenerationReflectionAgent が完成したら `reflectionLessons` 引数も渡す経路を増やす。
   *
   * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.E.1
   */
  private notifyPdcaEvolutionGeneration(
    regime: string,
    generationIndex: number,
    generationsTotal: number,
    report: GenerationReport,
  ): void {
    try {
      const formalBtPassed = report.formalBtVerifiedCandidates.filter((c) => c.formalBtPassed).length;
      pdcaLoop.notifyEvolutionGenerationComplete(regime, {
        generationIndex,
        generationsTotal,
        promotionCandidates: report.promotionCandidates.length,
        validationConfirmed: report.oosAwarePromotionSummary.validationConfirmed,
        formalBtPassed,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.addError(`[Phase E] PDCA 通知失敗: regime=${regime} gen=${generationIndex} error=${msg}`);
    }
  }

  /**
   * Filter Evolution Phase B-3 (2026-05-09): EvolutionInstanceCarry retention 実行。
   *
   * 14 日より古い carry 行を `evolutionInstanceCarryRepository.deleteOlderThan()` で削除し、
   * 削除件数 > 0 のときは `console.info` で本番 (NODE_ENV=production) でも Cloud Logging に
   * 残るログを出す (PR #142 Copilot review #1: `this.log()` は production で no-op のため不適)。
   *
   * 例外は飲んで全体クリーンアップを止めない (= 他種データ削除はそのまま継続)。
   * 例外時は `this.addError` でスケジューラエラーリストに記録する。
   *
   * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.4
   */
  async runEvolutionCarryRetentionNow(): Promise<{ deleted: number; error?: string }> {
    try {
      const carryDeleted = await evolutionInstanceCarryRepository.deleteOlderThan(
        EVOLUTION_CARRY_RETENTION_DAYS,
      );
      if (carryDeleted > 0) {
        console.info(
          `[SideBScheduler] [Phase B-3] EvolutionInstanceCarry retention: ${carryDeleted} 件削除 ` +
            `(${EVOLUTION_CARRY_RETENTION_DAYS} 日より古い行)`,
        );
      }
      return { deleted: carryDeleted };
    } catch (carryErr) {
      const carryMsg = carryErr instanceof Error ? carryErr.message : String(carryErr);
      this.addError(`[Phase B-3] EvolutionInstanceCarry retention 失敗: ${carryMsg}`);
      return { deleted: 0, error: carryMsg };
    }
  }

  /**
   * DiscoveryAgent を手動実行（外部 API / デバッグ用）
   */
  async runDiscoveryNow(): Promise<void> {
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

    this.log(
      `[Discovery] 週次エッジ分析を実行: ${periodStart.toISOString()} 〜 ${periodEnd.toISOString()}`,
    );

    try {
      const notes = await findAITradeNotesInPeriod(
        periodStart.toISOString().split('T')[0],
        periodEnd.toISOString().split('T')[0],
      );
      this.log(`[Discovery] 対象ノート数: ${notes.length}`);

      if (notes.length === 0) {
        this.log('[Discovery] 分析対象ノートなし。スキップします。');
        this.lastDiscoveryRun = new Date();
        return;
      }

      const report = await discoveryAgent.analyze(notes, periodStart, periodEnd);
      this.log(
        `[Discovery] 完了: 新規仮説 ${report.newHypotheses.length}個 / レンズ ${report.lensInsights.length}件 / tokens ${report.tokenUsage}`,
      );
      this.lastDiscoveryRun = new Date();
    } catch (err) {
      this.addError(`[Discovery] 失敗: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * プラン実行タイミングをチェック
   * 
   * planIntervalHours が 0 の場合は日次のみ（従来動作）
   * それ以外は N 時間ごとに再実行
   */
  private async checkAndExecutePlan(): Promise<void> {
    const now = new Date();

    // 市場が閉まっている場合はスキップ
    if (!isFXMarketOpen(now)) {
      return;
    }

    const intervalHours = this.config.planIntervalHours || 24;
    const intervalMs = intervalHours * 60 * 60 * 1000;

    // 各シンボルについて最終実行からの経過を確認
    let shouldRun = false;
    for (const symbol of this.config.symbols) {
      const lastRun = this.lastPlanRun.get(symbol);
      if (!lastRun || (now.getTime() - lastRun.getTime()) >= intervalMs) {
        shouldRun = true;
        break;
      }
    }

    if (!shouldRun) {
      return;
    }

    await this.executePlanJob();
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
                  symbol,
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
                symbol,
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
    symbol: string,
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

    // PDCAループに通知
    try {
      pdcaLoop.notifyTradeCompleted({
        id: tradeId,
        symbol,
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
    } catch { /* PDCAループ未起動時は無視 */ }
  }

  /**
   * プラン生成ジョブを実行（4時間ごと / MTF対応）
   * 
   * 1. 執行足OHLCV取得（cTrader優先 → Twelve Dataフォールバック）
   * 2. 上位足OHLCV取得（MTF分析用）
   * 3. Orchestrator に higherTFData を渡してプラン生成
   * 4. Trade作成（pending）
   */
  private async executePlanJob(): Promise<JobResult> {
    const intervalLabel = this.config.planIntervalHours
      ? `${this.config.planIntervalHours}時間ごと`
      : '日次';
    this.log(`${intervalLabel}プラン生成を開始します`);

    const results: { symbol: string; success: boolean; error?: string }[] = [];

    for (const symbol of this.config.symbols) {
      try {
        // 最終実行チェック（間隔内なら該シンボルはスキップ）
        const lastRun = this.lastPlanRun.get(symbol);
        const intervalMs = (this.config.planIntervalHours || 24) * 60 * 60 * 1000;
        if (lastRun && (Date.now() - lastRun.getTime()) < intervalMs) {
          this.log(`[${symbol}] 間隔内のためスキップ（最終: ${lastRun.toISOString()}）`);
          continue;
        }

        // 1. 執行足OHLCVデータ取得
        this.log(`[${symbol}] 執行足(${this.config.timeframe})OHLCV取得中...`);
        const ohlcvData = await this.marketDataService.getHistoricalData(
          symbol,
          this.config.timeframe,
          100,
        );

        if (!ohlcvData || ohlcvData.length === 0) {
          throw new Error('執行足OHLCVデータの取得に失敗');
        }

        // 1b. 執行足OHLCVをDBに永続化（バックテスト・ストラテジー分析で再利用）
        try {
          const normalizedSymbol = symbol.replace('/', '');
          const source = this.marketDataService.isCTraderAvailable() ? 'ctrader' : 'twelvedata';
          const insertCount = await ohlcvRepository.bulkInsert(
            ohlcvData.map(d => ({
              symbol: normalizedSymbol,
              timeframe: this.config.timeframe,
              timestamp: new Date(d.timestamp),
              open: d.open,
              high: d.high,
              low: d.low,
              close: d.close,
              volume: d.volume ?? 0,
              source,
            }))
          );
          if (insertCount > 0) {
            this.log(`[${symbol}] 執行足 ${insertCount}本をDBに保存`);
          }
        } catch (persistError) {
          this.log(`[${symbol}] 執行足DB保存エラー（AI処理は続行）: ${String(persistError)}`);
        }

        // 2. 上位足OHLCVデータ取得（MTF分析用）
        let higherTFData: { timeframe: string; ohlcvData: { timestamp: Date; open: number; high: number; low: number; close: number; volume?: number }[] } | undefined;
        try {
          this.log(`[${symbol}] 上位足(${this.config.higherTimeframe})OHLCV取得中...`);
          const htfOhlcv = await this.marketDataService.getHistoricalData(
            symbol,
            this.config.higherTimeframe,
            100,
          );
          if (htfOhlcv && htfOhlcv.length > 0) {
            higherTFData = {
              timeframe: this.config.higherTimeframe,
              ohlcvData: htfOhlcv.map(d => ({
                timestamp: new Date(d.timestamp),
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
                volume: d.volume,
              })),
            };
            this.log(`[${symbol}] 上位足 ${htfOhlcv.length}本取得成功`);

            // 2b. 上位足OHLCVもDBに永続化
            try {
              const normalizedSymbol = symbol.replace('/', '');
              const source = this.marketDataService.isCTraderAvailable() ? 'ctrader' : 'twelvedata';
              const insertCount = await ohlcvRepository.bulkInsert(
                htfOhlcv.map(d => ({
                  symbol: normalizedSymbol,
                  timeframe: this.config.higherTimeframe,
                  timestamp: new Date(d.timestamp),
                  open: d.open,
                  high: d.high,
                  low: d.low,
                  close: d.close,
                  volume: d.volume ?? 0,
                  source,
                }))
              );
              if (insertCount > 0) {
                this.log(`[${symbol}] 上位足 ${insertCount}本をDBに保存`);
              }
            } catch (persistError) {
              this.log(`[${symbol}] 上位足DB保存エラー（AI処理は続行）: ${String(persistError)}`);
            }
          }
        } catch (htfError) {
          this.log(`[${symbol}] 上位足取得失敗（単一TFで続行）: ${String(htfError)}`);
        }

        // 3. オーケストレーターでプラン生成（Research → Plan + MTF）
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
          higherTFData,
        });

        if (!planResult.success || !planResult.data) {
          throw new Error(planResult.error || 'プラン生成に失敗');
        }

        // 4. Tradeを作成（pending状態）
        this.log(`[${symbol}] 仮想トレードを作成中...`);
        const tradeResult = await createTradeFromPlan(planResult.data.id);

        if (!tradeResult.success) {
          throw new Error(tradeResult.error || 'トレード作成に失敗');
        }

        this.lastPlanRun.set(symbol, new Date());
        // ノートレード判断(シナリオ 0 件)は skipped で来るため、エラーにせず
        // 正常完了として記録する。trade オブジェクトは存在しない。
        if (tradeResult.skipped) {
          this.log(
            `[${symbol}] プラン完了: ${tradeResult.skipReason ?? 'ノートレード判断'} (Trade 作成はスキップ)`,
          );
        } else {
          this.log(`[${symbol}] プラン完了: Trade ID ${tradeResult.trade?.id}`);
        }
        results.push({ symbol, success: true });

        // PDCAループに戦略完了を通知
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
              }))
            );
          }
        } catch { /* PDCAループ未起動時は無視 */ }

      } catch (error) {
        const message = error instanceof Error ? error.message : '不明なエラー';
        this.addError(`[${symbol}] プラン失敗: ${message}`);
        results.push({ symbol, success: false, error: message });
      }
    }

    // クリーンアップ（1日に1回、最初のプラン実行時のみ）
    if (this.config.autoCleanup) {
      const anyFirstRun = results.some(r => r.success);
      const cleanupDue = !this.lastCleanupRun
        || (Date.now() - this.lastCleanupRun.getTime()) > 24 * 60 * 60 * 1000;
      if (anyFirstRun && cleanupDue) {
        try {
          this.log('クリーンアップを実行中...');
          const cleanupConfig: Partial<CleanupConfig> = {
            cleanupExpiredResearch: true,
            cleanupOldPlans: true,
            planRetentionDays: this.config.planRetentionDays,
            cleanupOldTrades: true,
            tradeRetentionDays: this.config.tradeRetentionDays,
          };
          const cleanupResult = await executeCleanup(cleanupConfig);
          this.lastCleanupRun = new Date();

          const totalDeleted = cleanupResult.expiredResearchCount
            + cleanupResult.oldPlansCount
            + cleanupResult.oldTradesCount;
          if (totalDeleted > 0) {
            this.log(`クリーンアップ完了: リサーチ ${cleanupResult.expiredResearchCount}件, ` +
              `プラン ${cleanupResult.oldPlansCount}件, ` +
              `トレード ${cleanupResult.oldTradesCount}件 削除`);
          }

          // Filter Evolution Phase B-3 (2026-05-09): EvolutionInstanceCarry retention 14 日。
          // Phase B-2 で永続化した carry 行を retention 期限超で削除する。
          // テスト可能化のため public method `runEvolutionCarryRetentionNow` に切り出し。
          await this.runEvolutionCarryRetentionNow();
        } catch (error) {
          const message = error instanceof Error ? error.message : '不明なエラー';
          this.addError(`クリーンアップエラー: ${message}`);
        }
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const message = `${intervalLabel}プラン生成完了: ${successCount}/${results.length} シンボル成功`;
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
          // Phase 3: Plan 時点で AgentMemory に保存したレンズスナップショットを取得
          const lensSnapshot = agentMemory.getCurrentLensSnapshot(trade.symbol);

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
            },
            lensSnapshot,
          );
          this.log(`[Note生成] Trade ${trade.id} のNote生成完了${lensSnapshot ? ' (lensSnapshot付き)' : ''}`);
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
