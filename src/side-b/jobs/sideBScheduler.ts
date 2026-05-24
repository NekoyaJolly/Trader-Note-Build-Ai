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

import { getMarketStatusJST, isFXMarketOpen } from '../utils/marketHours';
import { summarySchedulerService } from '../services/summarySchedulerService';
import { CronSimilarityService } from '../services/cronSimilarityService';
import { AIOrchestrator } from '../orchestrator/aiOrchestrator';
import { MarketDataService } from '../../services/marketDataService';
import { CTraderAuthService } from '../../backend/services/ctrader/ctraderAuthService';
import type { PrismaClient } from '@prisma/client';
// canonical singleton (PR #152)
import { prisma as canonicalPrisma } from '../../backend/db/client';
import type { PromptEvolutionResult } from '../prompts/registry/promptEvolutionJob';
import type { JsonValue } from '../../utils/jsonValue';
// PR-1 (sideb-refactor): Evolution 系を切り出し
import {
  EvolutionJob,
  readEvolutionEnvOverrides,
  DEFAULT_EVOLUTION_REGIMES,
  type EvolutionJobResult,
  type EvolutionCarryRetentionResult,
} from './evolutionJob';
// PR-2 (sideb-refactor): FullValidation / Screening 系を切り出し
import { FullValidationJob, type FullValidationJobResult } from './fullValidationJob';
import {
  ScreeningJob,
  type ScreeningJobOptions,
  type ScreeningJobResult,
} from './screeningJob';
// PR-3 (sideb-refactor): TradeMonitoring / PlanGeneration 系を切り出し
import { TradeMonitoringJob } from './tradeMonitoringJob';
import { PlanGenerationJob } from './planGenerationJob';
// PR-4 (sideb-refactor): Discovery / PromptEvolution / Cleanup 系を切り出し
import { DiscoveryJob } from './discoveryJob';
import { PromptEvolutionJob } from './promptEvolutionJob';
import { CleanupJob } from './cleanupJob';
// Phase B (2026-05-22): symbols は Watchlist から動的取得するため正規化関数を import
import { normalizeCTraderSymbol } from '../../utils/symbolNormalization';
// Phase B+ (2026-05-24): Top-Level Orchestrator (= 薄い最上位判断層) の型 import
// 実体は遅延 import (= 循環依存回避のため `import('../orchestrator')` を使用)
import type {
  TopLevelOrchestrator as TopLevelOrchestratorType,
  TopLevelOrchestratorResult,
} from '../orchestrator';
// Phase 7 (orch): ADK Orchestrator Wrapper bridge
import {
  runScheduledOrchestratedCycle,
  type BridgeOptions,
  type BridgeResult,
} from './sideBSchedulerOrchestratorBridge';

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
  // Watchlist 連携が無い場合の fallback。表記は内部規約 (cTrader 形式 = スラッシュなし大文字)
  // に整合させる (Phase B 2026-05-22)。実運用では start() で Watchlist から動的取得した
  // symbols で上書きされる。
  symbols: ['XAUUSD'],
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
  evolutionRegimes: [...DEFAULT_EVOLUTION_REGIMES],
  // Phase A: デフォルトは最大5世代。env EVOLUTION_GENERATIONS で上書き可能。
  evolutionGenerations: 5,
  evolutionAdaptiveBudget: false,
  evolutionQDArchive: false,
  evolutionQDParentLimit: 2,
  autoTriggerPromptEvolution: false, // Phase 6: 既定は手動のみ(CLI / UI からの明示的トリガー)
};

// EVOLUTION_CARRY_RETENTION_DAYS は EvolutionJob 側に移動 (`./evolutionJob.ts`)。
// readEvolutionEnvOverrides / parseStrictInt / parseStrictBool も同様に移動。
// 旧 sideBScheduler.ts に存在した env 解釈と clamp ロジックは PR-1 で EvolutionJob 配下に集約。

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
  private isEvolutionRunning: boolean = false;
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

  // PR-1 (sideb-refactor): Evolution 系 Job を保持し、runEvolutionNow / runEvolutionCarryRetentionNow を delegation。
  private evolutionJob: EvolutionJob;
  // PR-2 (sideb-refactor): FullValidation / Screening を delegation。
  private fullValidationJob: FullValidationJob;
  private screeningJob: ScreeningJob;
  // PR-3 (sideb-refactor): TradeMonitoring / PlanGeneration を delegation。
  private tradeMonitoringJob: TradeMonitoringJob;
  private planGenerationJob: PlanGenerationJob;
  // PR-4 (sideb-refactor): Discovery / PromptEvolution / Cleanup を delegation。
  private discoveryJob: DiscoveryJob;
  private promptEvolutionJob: PromptEvolutionJob;
  private cleanupJob: CleanupJob;

  /**
   * Phase B (2026-05-22): symbols が外部から明示的に指定されたかを記録する。
   * - constructor で configOverride.symbols !== undefined ならセット
   * - updateConfig() で symbols が渡されたら true に更新 (= 後付けの明示指定)
   * - false のままなら start() で Watchlist テーブルから動的に取得する
   *
   * `readonly` を外して updateConfig 経由の更新を許可している (= PR #247
   * Copilot review #1 対応: SideBController からの設定更新が無効化されないため)。
   */
  private explicitSymbolsOverride: boolean;

  constructor(configOverride?: Partial<SideBSchedulerConfig>) {
    // Phase A: env からの override を DEFAULT_CONFIG と configOverride の中間に挟む。
    // 優先順位 (高 → 低): configOverride 引数 > 環境変数 > DEFAULT_CONFIG。
    // env 解釈は EvolutionJob 側 (`readEvolutionEnvOverrides`) に集約済み。
    const envOverrides = readEvolutionEnvOverrides();
    this.config = { ...DEFAULT_CONFIG, ...envOverrides, ...configOverride };
    // Phase B (2026-05-22): symbols が明示指定されたかを判定。未指定なら start() で
    // Watchlist から動的取得する経路に乗せる。「明示指定」は Partial で undefined を
    // 渡されていない場合 (= 配列値が来た) を意味する。
    // 注 (PR #247 Copilot review #2): envOverrides.symbols は現状 readEvolutionEnvOverrides()
    // が返さないため常に undefined だが、将来 env 経路で symbols を追加する余地を残すなら
    // ここでチェックすべき。現時点で意図を明確にするため configOverride のみ判定する。
    this.explicitSymbolsOverride = configOverride?.symbols !== undefined;
    this.isProduction = process.env.NODE_ENV === 'production';

    // サービス初期化 (PR #152: canonical singleton 経由で connection pool 共有)
    this.prisma = canonicalPrisma;
    this.orchestrator = new AIOrchestrator();
    this.marketDataService = new MarketDataService();
    this.cronSimilarityService = new CronSimilarityService({
      similarityThreshold: this.config.similarityThreshold,
      debug: !this.isProduction,
    });

    // PR-1 / PR-2 (sideb-refactor): 各 Job を Scheduler の addError / log を依存注入して構築。
    // 完了時に lastXxxRun を Scheduler 側で更新する。
    const deps = {
      addError: (msg: string) => this.addError(msg),
      log: (msg: string) => this.log(msg),
    };
    this.evolutionJob = new EvolutionJob(deps, {
      onCompleted: (completedAt: Date) => {
        this.lastEvolutionRun = completedAt;
      },
    });
    this.fullValidationJob = new FullValidationJob(deps, {
      onCompleted: (completedAt: Date) => {
        this.lastFullValidationRun = completedAt;
      },
    });
    this.screeningJob = new ScreeningJob(deps, {
      onCompleted: (completedAt: Date) => {
        this.lastScreeningRun = completedAt;
      },
    });
    this.tradeMonitoringJob = new TradeMonitoringJob(deps, {
      // PR #161 Copilot review: services をクロージャで遅延取得 (= テスト時の
      // private 書き換え (`(scheduler as any).marketDataService = mock`) に追従)
      servicesFactory: () => ({
        marketDataService: this.marketDataService,
        cronSimilarityService: this.cronSimilarityService,
      }),
      onStarted: (startedAt: Date) => {
        this.lastMonitorRun = startedAt;
      },
    });
    this.planGenerationJob = new PlanGenerationJob(deps, {
      servicesFactory: () => ({
        marketDataService: this.marketDataService,
        orchestrator: this.orchestrator,
      }),
      onSymbolCompleted: (symbol: string, completedAt: Date) => {
        this.lastPlanRun.set(symbol, completedAt);
      },
      getLastSymbolRun: (symbol: string) => this.lastPlanRun.get(symbol),
    });
    this.discoveryJob = new DiscoveryJob(deps, {
      onCompleted: (completedAt: Date) => {
        this.lastDiscoveryRun = completedAt;
      },
    });
    this.promptEvolutionJob = new PromptEvolutionJob(deps, {
      onCompleted: (completedAt: Date) => {
        this.lastPromptEvolutionRun = completedAt;
      },
    });
    this.cleanupJob = new CleanupJob(deps, {
      servicesFactory: () => ({
        runEvolutionCarryRetention: () => this.evolutionJob.runCarryRetention(),
      }),
      onCompleted: (completedAt: Date) => {
        this.lastCleanupRun = completedAt;
      },
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

    // Phase B (2026-05-22): cTrader 初期化 → Watchlist 解決 → startInternal の順で進める。
    // Watchlist 解決は symbols が明示指定されていない場合のみ動的取得 (= ハードコード排除)。
    // 旧 start() 同様 fire-and-forget なので void で明示的に non-awaited を伝える。
    void this.initCTraderDataSource()
      .catch((err) => {
        this.log(`cTrader初期化エラー（market data fallback で続行）: ${err}`);
      })
      .then(() => this.resolveWatchlistSymbolsIfNeeded())
      .catch((err) => {
        this.log(`Watchlist 解決エラー (DEFAULT_CONFIG fallback): ${err}`);
      })
      .then(() => this.startInternal());
  }

  /**
   * Phase B (2026-05-22): symbols が明示指定されていない場合、Watchlist テーブルから
   * `active=true` の symbol を集約して `this.config.symbols` を上書きする。
   *
   * 「リストから動的取得」原則 (Nekoさん 2026-05-22) に従い、scheduler 起動経路の
   * symbol を hardcode から DB ベースに切替。明示指定 (configOverride.symbols /
   * envOverrides.symbols) があれば動的取得をスキップして指定値を尊重する。
   *
   * 取得した symbol は `normalizeCTraderSymbol()` で正規化済 (= スラッシュ無し大文字)。
   * Watchlist が空 / 取得失敗の場合は DEFAULT_CONFIG.symbols (= ['XAUUSD']) を維持。
   */
  private async resolveWatchlistSymbolsIfNeeded(): Promise<void> {
    if (this.explicitSymbolsOverride) {
      this.log(
        `symbols は明示指定済 (= ${this.config.symbols.join(', ')})、Watchlist 連携をスキップ`,
      );
      return;
    }

    try {
      const rows = await this.prisma.watchlist.findMany({
        where: { active: true },
        select: { symbol: true },
      });
      const symbols = Array.from(
        new Set(
          rows
            .map((r) => normalizeCTraderSymbol(r.symbol))
            .filter((s): s is string => Boolean(s)),
        ),
      );
      if (symbols.length > 0) {
        this.config = { ...this.config, symbols };
        this.log(
          `Watchlist から ${symbols.length} 件の symbol を読み込み: ${symbols.join(', ')}`,
        );
      } else {
        this.log(
          `Watchlist が空のため DEFAULT_CONFIG (${this.config.symbols.join(', ')}) を fallback として使用`,
        );
      }
    } catch (err) {
      // DB 取得失敗時は fallback を維持して継続 (= 起動を妨げない)
      this.log(`Watchlist 取得エラー (DEFAULT_CONFIG fallback): ${String(err)}`);
    }
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
   *
   * PR #247 Copilot review #1: symbols が newConfig で渡されたら
   * explicitSymbolsOverride を true に更新する。これにより updateConfig 経由で
   * symbols を明示指定した場合 (= SideBController などからの設定変更) 、
   * start() で Watchlist 取得に上書きされない。
   */
  updateConfig(newConfig: Partial<SideBSchedulerConfig>): void {
    const wasRunning = this.isRunning;

    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...newConfig };
    if (newConfig.symbols !== undefined) {
      this.explicitSymbolsOverride = true;
    }
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

  // ============================================
  // Phase B+ (2026-05-24): Top-Level Orchestrator 経由のサイクル実行
  // ============================================

  /** TopLevelOrchestrator の遅延 init keeper */
  private _topLevelOrchestrator: TopLevelOrchestratorType | null = null;

  private async getTopLevelOrchestrator(): Promise<TopLevelOrchestratorType> {
    if (this._topLevelOrchestrator) return this._topLevelOrchestrator;
    const { TopLevelOrchestrator } = await import('../orchestrator');
    this._topLevelOrchestrator = new TopLevelOrchestrator({
      prisma: this.prisma,
      jobInvokers: {
        runPlanGeneration: async () => {
          await this.runDailyPlanNow();
        },
        runScreening: async () => {
          await this.runScreeningNow();
        },
        runFullValidation: async () => {
          await this.runFullValidationNow();
        },
        runEvolution: async () => {
          await this.runEvolutionNow();
        },
      },
      log: (msg) => this.log(`[TopLevelOrchestrator] ${msg}`),
    });
    return this._topLevelOrchestrator;
  }

  /**
   * Top-Level Orchestrator 経由で 1 サイクル実行 (Phase B+、2026-05-24)。
   *
   * cron route から `TOP_LEVEL_ORCHESTRATOR_ENABLED=true` の場合に呼ばれる。
   * Orchestrator が「次にどのループを回すか」を LLM 判断し、判断結果に応じて
   * 既存 Job (runDailyPlanNow / runScreeningNow / runFullValidationNow / runEvolutionNow)
   * を委ねて呼ぶ。
   *
   * `runDailyPlanNow` 等の旧経路は維持される (= env false なら従来通り)。
   *
   * 設計書: docs/architecture/TOP_LEVEL_ORCHESTRATOR_DESIGN.md
   */
  async runOrchestratedCycle(
    trigger: 'cron' | 'manual' | 'test' = 'cron',
  ): Promise<TopLevelOrchestratorResult> {
    const orchestrator = await this.getTopLevelOrchestrator();
    return orchestrator.decideAndExecute(trigger);
  }

  /**
   * ADK Orchestrator Wrapper 経由で 1 サイクル実行する (Phase 7 で追加)。
   *
   * feature flag (env `SIDE_B_ADK_ORCHESTRATOR_ENABLED`) が ON の場合のみ動作し、
   * OFF の場合は何もせず `{ kind: 'disabled' }` を返す (= 旧経路は cron で並走)。
   *
   * 既存の `runDailyPlanNow` / `runMonitorNow` / `runEvolutionNow` 等の旧経路は
   * 一切変更しない (本メソッドは新規 entry point のみ)。
   *
   * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §12 (Phase 7.3)
   */
  async runOrchestratedCycleNow(
    options?: BridgeOptions,
  ): Promise<BridgeResult> {
    return runScheduledOrchestratedCycle(options ?? {});
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
   * PR-2 (sideb-refactor): 本体は `ScreeningJob.runWithOptions()` へ移行済み。
   * 本メソッドは互換 API として残し delegation のみを行う。
   *
   * @param options.limit  config.screeningMaxPerRun の override
   * @param options.period BT 対象期間 override (env SCREENING_PERIOD_DAYS のデフォルトを上書き)
   */
  async runScreeningNow(options?: ScreeningJobOptions): Promise<ScreeningJobResult> {
    return this.screeningJob.runWithOptions(this.config, options);
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
   * PR-2 (sideb-refactor): 本体は `FullValidationJob.run()` へ移行済み。
   * 本メソッドは互換 API として残し delegation のみを行う。
   * `sideBScheduler.fullValidation.test.ts` が直接検証。
   */
  async runFullValidationNow(): Promise<FullValidationJobResult> {
    return this.fullValidationJob.run(this.config);
  }

  /**
   * Phase 5: 日次進化ループジョブ（1時間ごとにチェックし 24h ごとに実行）
   */
  private startEvolutionJob(): void {
    // チェック cadence は 15 分で統一 (起動 → 15min, 30min, 45min, 60min, ...)。
    // - 旧実装は 60 分間隔だったが deploy 直後の動作確認に長すぎた
    // - 中間案として「初回 15 min one-shot + 以降 60 min」としたが、cadence が混在すると
    //   どの足を参照しているか不明瞭になる (Nekoさん指摘、2026-05-11)。
    // - 15 分一貫で刻むことで「15 分足」相当の規則的な timing になる
    // 実行は dailyMs (24h) ガードで 1 日 1 回に絞られているため、check 頻度が増えても
    // Evolution 本体 (LLM 呼び出し等) のコストは増加しない。
    const checkIntervalMs = 15 * 60 * 1000;       // 15 分間隔チェック
    const dailyMs = 24 * 60 * 60 * 1000;          // 24 h 経過時のみ実行 (= 1 日 1 回)

    const runIfDue = async (): Promise<void> => {
      if (this.isEvolutionRunning) {
        this.log('[Evolution] 既に実行中のためスキップします');
        return;
      }

      const now = Date.now();
      if (!this.lastEvolutionRun || now - this.lastEvolutionRun.getTime() >= dailyMs) {
        this.isEvolutionRunning = true;
        // 実行開始時に暫定的にlastEvolutionRunを更新して二重起動の確率をさらに下げる
        this.lastEvolutionRun = new Date();
        try {
          await this.runEvolutionNow();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.addError(`進化ループジョブエラー: ${msg}`);
        } finally {
          this.isEvolutionRunning = false;
        }
      }
    };

    this.evolutionIntervalId = setInterval(() => { runIfDue().catch(console.error); }, checkIntervalMs);
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
    return this.promptEvolutionJob.run(this.config);
  }

  /**
   * Phase 5 + Phase A: 進化ループを手動実行（全レジーム順、各レジームで N 世代）。
   *
   * PR-1 (sideb-refactor): 本体は `EvolutionJob.run()` へ移行済み。本メソッドは
   * 互換 API として残し delegation のみを行う。詳細・設計書:
   * - `./evolutionJob.ts` の `EvolutionJob.run()`
   * - docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.A
   *
   * 戻り値形 `{ regimeReports: number; errors: string[] }` は維持
   * (`evolutionMultiGen.test.ts` が直接検証)。
   */
  async runEvolutionNow(): Promise<EvolutionJobResult> {
    return this.evolutionJob.run(this.config);
  }

  /**
   * Filter Evolution Phase B-3 (2026-05-09): EvolutionInstanceCarry retention 実行。
   *
   * PR-1 (sideb-refactor): 本体は `EvolutionJob.runCarryRetention()` へ移行済み。
   * console.info 経路 (PR #142 Copilot review #1: production で `this.log()` no-op 対応) は
   * EvolutionJob 側で維持されている。`evolutionCarryRetention.test.ts` が直接検証。
   *
   * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.4
   */
  async runEvolutionCarryRetentionNow(): Promise<EvolutionCarryRetentionResult> {
    return this.evolutionJob.runCarryRetention();
  }

  /**
   * DiscoveryAgent を手動実行（外部 API / デバッグ用）
   */
  async runDiscoveryNow(): Promise<void> {
    await this.discoveryJob.run(this.config);
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
   * 監視ジョブを実行 (高安値ベース検証)。
   *
   * PR-3 (sideb-refactor): 本体は TradeMonitoringJob.runWithServices() へ移行済み。
   * テスト互換のため private 名を維持し、`(scheduler as any).executeMonitorJob()` の
   * 直呼び出しを引き続き機能させる (sideBScheduler.similarity.test.ts)。
   *
   * services は Scheduler の private field を引数経由で渡すことで、テスト時の
   * `(scheduler as any).marketDataService = mock` などの書き換えが反映される。
   */
  private async executeMonitorJob(): Promise<JobResult> {
    return this.tradeMonitoringJob.run(this.config);
  }

  /**
   * プラン生成ジョブを実行。
   *
   * PR-3 (sideb-refactor): プラン生成本体は PlanGenerationJob.runWithServices() へ
   * 移行済み。cleanup 部分は Phase 5 (PR-4) で CleanupJob として独立予定のため、
   * 一旦 Scheduler 側に残し本メソッド内で Job 呼び出し後に実行する。
   */
  private async executePlanJob(): Promise<JobResult> {
    const planResult = await this.planGenerationJob.run(this.config);

    // クリーンアップ (1 日に 1 回、最初のプラン実行時のみ)。
    // PR-4 (sideb-refactor): CleanupJob に移行済み。Scheduler は autoCleanup フラグ +
    // プラン成功有無 + 24h ガードを判定して Job を呼ぶ責任のみ。
    if (this.config.autoCleanup) {
      const anyFirstRun = planResult.results.some((r) => r.success);
      if (anyFirstRun && CleanupJob.shouldRun(this.lastCleanupRun)) {
        await this.cleanupJob.run(this.config);
      }
    }

    // PlanGenerationSymbolResult[] を JsonValue 互換に変換 (JobResult.data の型整合)
    const dataAsJson: JsonValue = planResult.results.map((r) => {
      const obj: { [key: string]: JsonValue } = {
        symbol: r.symbol,
        success: r.success,
      };
      if (r.error !== undefined) {
        obj.error = r.error;
      }
      return obj;
    });

    return {
      success: planResult.success,
      message: planResult.message,
      data: dataAsJson,
    };
  }

  /**
   * ログ出力
   */
  private log(message: string): void {
    console.log(`[SideBScheduler] ${message}`);
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
