/**
 * AI オーケストレーター
 * 
 * 目的: Research AI → DB → Plan AI のパイプラインを統合管理
 * 
 * 責務:
 * - リサーチのキャッシュ確認・再利用
 * - Research AI / Plan AI の呼び出し順序制御
 * - DB永続化の管理
 * - エラーハンドリングとロギング
 * 
 * フロー:
 * 1. キャッシュ確認（有効なリサーチがあれば再利用）
 * 2. なければ Research AI 呼び出し → DB保存
 * 3. Plan AI 呼び出し → DB保存
 * 4. 結果を返却
 */

import type {
  ResearchAIService,
  ResearchAIInput,
  PlanAIService,
  PlanAIInput,
  UserTradingPreferences,
  IndicatorData,
} from '../services';
import {
  researchAIService,
  planAIService
} from '../services';
import type {
  ResearchRepository,
  MarketResearchWithTypes,
  PlanRepository,
  AITradePlanWithTypes} from '../repositories';
import {
  researchRepository,
  planRepository
} from '../repositories';
import type {
  AITradeScenario} from '../models';
import {
  buildHigherTFContext
} from '../knowledge';
import type { HigherTimeframeContext } from '../knowledge';
import type { DevilsAdvocateAgent} from '../agents/DevilsAdvocateAgent';
import { devilsAdvocateAgent } from '../agents/DevilsAdvocateAgent';
import {
  defaultLensAggregator,
  registerDefaultLenses,
  type LensFeatureSnapshot,
} from '../lenses';
import { agentMemory } from '../agent/agentMemory';
import { edgeLedger } from '../ledger';
import { decideExistingPlanAction } from './existingPlanDecision';
import type {
  HypothesisGeneratorAgent} from '../agents/HypothesisGeneratorAgent';
import {
  hypothesisGeneratorAgent,
} from '../agents/HypothesisGeneratorAgent';
import type { EdgeHypothesis } from '../models/edgeHypothesis';
import {
  runAllSpecialists,
  type SpecialistBundle,
} from '../agents/specialists';
import type {
  StrategyBacktesterAgent} from '../agents/StrategyBacktesterAgent';
import {
  strategyBacktesterAgent,
  type StrategyBacktesterRunResult,
} from '../agents/StrategyBacktesterAgent';

// ===========================================
// 型定義
// ===========================================

/**
 * DB 永続化されたプラン＋直近の戦略 BT 結果（メモリ上のみ。Phase 6.7b）
 */
export type AITradePlanWithOptionalBacktest = AITradePlanWithTypes & {
  strategyBacktest?: StrategyBacktesterRunResult;
};

/**
 * リサーチ生成リクエスト
 */
export interface OrchestratorResearchRequest {
  symbol: string;
  timeframe?: string;
  ohlcvData: { timestamp: Date; open: number; high: number; low: number; close: number; volume?: number }[];
  indicators?: IndicatorData;
  forceRefresh?: boolean;
}

/**
 * プラン生成リクエスト
 */
export interface OrchestratorPlanRequest {
  symbol: string;
  targetDate?: string;
  researchId?: string;
  userPreferences?: UserTradingPreferences;
  ohlcvData?: { timestamp: Date; open: number; high: number; low: number; close: number; volume?: number }[];
  indicators?: IndicatorData;
  forceRefresh?: boolean;
  /** 上位足データ（MTF分析用、オプショナル） */
  higherTFData?: {
    timeframe: string;
    ohlcvData: { timestamp: Date; open: number; high: number; low: number; close: number; volume?: number }[];
    indicators?: IndicatorData;
  };
}

/**
 * オーケストレーター結果
 */
export interface OrchestratorResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  cached?: boolean;
  tokenUsage?: number;
}

// ===========================================
// オーケストレータークラス
// ===========================================

export class AIOrchestrator {
  private researchAI: ResearchAIService;
  private planAI: PlanAIService;
  private researchRepo: ResearchRepository;
  private planRepo: PlanRepository;
  private devilsAdvocate: DevilsAdvocateAgent;
  private hypothesisGenerator: HypothesisGeneratorAgent;
  private strategyBacktester: StrategyBacktesterAgent;

  constructor(
    researchAI?: ResearchAIService,
    planAI?: PlanAIService,
    researchRepo?: ResearchRepository,
    planRepo?: PlanRepository,
    devilsAdvocate?: DevilsAdvocateAgent,
    hypothesisGenerator?: HypothesisGeneratorAgent,
    strategyBacktester?: StrategyBacktesterAgent,
  ) {
    this.researchAI = researchAI || researchAIService;
    this.planAI = planAI || planAIService;
    this.researchRepo = researchRepo || researchRepository;
    this.planRepo = planRepo || planRepository;
    this.devilsAdvocate = devilsAdvocate || devilsAdvocateAgent;
    this.hypothesisGenerator = hypothesisGenerator || hypothesisGeneratorAgent;
    this.strategyBacktester = strategyBacktester || strategyBacktesterAgent;
  }

  /**
   * リサーチを生成（キャッシュ対応）
   * 
   * フロー:
   * 1. forceRefresh=false かつ有効なキャッシュがあれば再利用
   * 2. なければ Research AI 呼び出し
   * 3. DB保存
   */
  async generateResearch(request: OrchestratorResearchRequest): Promise<OrchestratorResult<MarketResearchWithTypes>> {
    const { symbol, timeframe, ohlcvData, indicators, forceRefresh = false } = request;

    console.log(`[Orchestrator] リサーチ生成開始: ${symbol}`);

    try {
      // 1. キャッシュ確認
      if (!forceRefresh) {
        const cached = await this.researchRepo.findValidBySymbol(symbol);
        if (cached) {
          console.log(`[Orchestrator] キャッシュヒット: ${cached.id}`);
          return {
            success: true,
            data: cached,
            cached: true,
            tokenUsage: 0,
          };
        }
      }

      // 2. Research AI 呼び出し
      console.log(`[Orchestrator] Research AI 呼び出し`);
      const aiInput: ResearchAIInput = {
        symbol,
        timeframe,
        ohlcvData,
        indicators: indicators,
      };

      const aiResult = await this.researchAI.generateResearch(aiInput);

      // 3. DB保存（MarketAnalysis 対応）
      const saved = await this.researchRepo.create({
        symbol,
        timeframe,
        featureVector: aiResult.output.featureVector,
        marketAnalysis: aiResult.marketAnalysis,
        ohlcvSnapshot: aiResult.ohlcvSnapshot,
        aiModel: aiResult.model,
        tokenUsage: aiResult.tokenUsage,
        expiresAt: aiResult.expiresAt,
      });

      console.log(`[Orchestrator] リサーチ保存完了: ${saved.id}`);

      return {
        success: true,
        data: saved,
        cached: false,
        tokenUsage: aiResult.tokenUsage,
      };
    } catch (error) {
      console.error(`[Orchestrator] リサーチ生成エラー:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * プランを生成
   * 
   * フロー:
   * 1. researchId指定あればそれを使用、なければリサーチ生成
   * 2. 今日のプランが既存かチェック（1日1シンボル1プラン）
   * 3. Plan AI 呼び出し
   * 4. DB保存
   */
  async generatePlan(
    request: OrchestratorPlanRequest,
  ): Promise<OrchestratorResult<AITradePlanWithOptionalBacktest>> {
    const { symbol, targetDate, researchId, userPreferences, ohlcvData, indicators, higherTFData, forceRefresh = false } = request;

    // 対象日の決定
    const date = targetDate ? new Date(targetDate) : new Date();
    date.setHours(0, 0, 0, 0);
    const dateStr = date.toISOString().split('T')[0];

    console.log(`[Orchestrator] プラン生成開始: ${symbol} / ${dateStr} (forceRefresh=${forceRefresh})`);

    try {
      // 1. 既存プランチェック(hotfix: shouldReuseExistingPlan で判定)
      const existingPlan = await this.planRepo.findByDateAndSymbol(date, symbol);
      if (existingPlan) {
        const decision = decideExistingPlanAction(existingPlan, forceRefresh);
        if (decision.action === 'reuse') {
          console.log(`[Orchestrator] 既存プラン発見: ${existingPlan.id}`);
          return {
            success: true,
            data: existingPlan,
            cached: true,
            tokenUsage: 0,
          };
        }
        console.log(`[Orchestrator] 既存プラン削除 (${decision.reason}): ${existingPlan.id}`);
        await this.planRepo.delete(existingPlan.id);
      }

      // 2. リサーチ取得または生成
      let research: MarketResearchWithTypes | null = null;
      let researchTokens = 0;

      if (researchId) {
        // 指定されたリサーチを使用
        research = await this.researchRepo.findById(researchId);
        if (!research) {
          return {
            success: false,
            error: `Research not found: ${researchId}`,
          };
        }
      } else {
        // リサーチ生成
        if (!ohlcvData || ohlcvData.length === 0) {
          return {
            success: false,
            error: 'ohlcvData is required when researchId is not provided',
          };
        }

        const researchResult = await this.generateResearch({
          symbol,
          ohlcvData,
          indicators,
        });

        if (!researchResult.success || !researchResult.data) {
          return {
            success: false,
            error: researchResult.error || 'Research generation failed',
          };
        }

        research = researchResult.data;
        researchTokens = researchResult.tokenUsage || 0;
      }

      // 3. 上位足Research（MTF分析）
      let higherTFContext: HigherTimeframeContext | undefined;
      if (higherTFData) {
        console.log(`[Orchestrator] 上位足Research AI 呼び出し: ${higherTFData.timeframe}`);
        try {
          const htfResult = await this.researchAI.generateResearch({
            symbol,
            timeframe: higherTFData.timeframe,
            ohlcvData: higherTFData.ohlcvData,
            indicators: higherTFData.indicators,
          });
          higherTFContext = buildHigherTFContext(
            higherTFData.timeframe,
            htfResult.output.featureVector,
          );
          console.log(`[Orchestrator] 上位足バイアス: ${higherTFContext.bias}`);
        } catch (htfError) {
          console.warn(`[Orchestrator] 上位足Research失敗（単一TFで継続）:`, htfError);
        }
      }

      // 4a. 並列レンズ計算（Phase 3）— Strategy Thinker 呼び出し前に実行
      const planTimeframe = research.timeframe || '15m';
      registerDefaultLenses();
      let lensSnapshot: LensFeatureSnapshot | undefined;
      try {
        lensSnapshot = await defaultLensAggregator.computeAll({
          symbol,
          timeframe: planTimeframe,
          timestamp: new Date(),
          ohlcvBars: ohlcvData, // researchId 経由時は undefined の可能性あり（レンズ側で unclear/unknown を返す）
          existingAnalysis: research.marketAnalysis,
        });
        console.log(`[Orchestrator] レンズ計算完了: ${lensSnapshot.features.size}個 / ${lensSnapshot.totalComputeDurationMs}ms`);
        // Reflection 用に AgentMemory へ保存
        agentMemory.setCurrentLensSnapshot(symbol, lensSnapshot);
      } catch (lensError) {
        console.warn(`[Orchestrator] レンズ計算失敗（戦略生成は続行）:`, lensError);
      }

      // 4b. 候補仮説を集める（Phase 4a: EdgeLedger マッチ + HypothesisGenerator 新規）
      let candidateHypotheses: EdgeHypothesis[] = [];
      let hypothesisGeneratorTokens = 0;
      /**
       * Phase 6: 下位専門家 3 体の分析バンドル。HypothesisGenerator と Plan AI
       * の両方に渡すため、条件分岐の外側で保持する。HypothesisGenerator を実際に
       * 呼び出すパスに入った時だけ計算する(LLM コスト配慮、§5.3)。
       */
      let specialistBundle: SpecialistBundle | undefined;
      if (lensSnapshot) {
        try {
          const matched = await edgeLedger.findMatching(symbol, lensSnapshot, {
            statuses: ['confirmed', 'testing', 'unverified'],
          });
          console.log(`[Orchestrator] 既存マッチ仮説: ${matched.length}個`);

          // マッチが少ない時だけ新規候補を生成（LLMコスト制御）
          if (matched.length < 3) {
            // Phase 6: 3 専門家を並列実行して分析バンドルを作る
            try {
              specialistBundle = await runAllSpecialists({
                symbol,
                timeframe: planTimeframe,
                lensSnapshot,
              });
              const filled = [
                specialistBundle.trend && 'trend',
                specialistBundle.oscillator && 'oscillator',
                specialistBundle.volatilityVolume && 'volatilityVolume',
              ].filter(Boolean);
              console.log(
                `[Orchestrator] 専門家分析完了: ${filled.length}/3 (${filled.join(',')})`,
              );
            } catch (err) {
              console.warn('[Orchestrator] 専門家分析失敗(仮説生成は続行):', err);
            }

            const genResult = await this.hypothesisGenerator.generate({
              symbol,
              timeframe: planTimeframe,
              lensSnapshot,
              existingHypotheses: matched,
              specialistAnalyses: specialistBundle
                ? {
                    trend: specialistBundle.trend ?? undefined,
                    oscillator: specialistBundle.oscillator ?? undefined,
                    volatilityVolume: specialistBundle.volatilityVolume ?? undefined,
                  }
                : undefined,
            });
            hypothesisGeneratorTokens = genResult.tokenUsage;
            const createInputs = this.hypothesisGenerator.toCreateInputs(
              genResult.output,
              {
                symbol,
                timeframe: planTimeframe,
                lensSnapshot,
                existingHypotheses: matched,
              },
            );
            for (const ci of createInputs) {
              try {
                const created = await edgeLedger.create(ci);
                matched.push(created);
              } catch (err) {
                console.warn('[Orchestrator] EdgeLedger.create 失敗:', err);
              }
            }
            console.log(`[Orchestrator] 新規仮説登録: ${createInputs.length}個`);
          }

          candidateHypotheses = matched;
        } catch (err) {
          console.warn('[Orchestrator] 候補仮説収集失敗（戦略生成は続行）:', err);
        }
      }

      // 4c. Plan AI 呼び出し
      console.log(`[Orchestrator] Plan AI 呼び出し (候補仮説: ${candidateHypotheses.length}個)`);
      const planInput: PlanAIInput = {
        research,
        targetDate: dateStr,
        userPreferences,
        higherTF: higherTFContext,
        lensSnapshot,
        candidateHypotheses,
        // Phase 6: 専門家バンドルを再利用(この直前のサイクルで計算済みなら)
        specialistAnalyses: specialistBundle
          ? {
              trend: specialistBundle.trend ?? undefined,
              oscillator: specialistBundle.oscillator ?? undefined,
              volatilityVolume: specialistBundle.volatilityVolume ?? undefined,
            }
          : undefined,
      };

      const planResult = await this.planAI.generatePlan(planInput);

      // シナリオにIDを付与
      const scenariosWithId: AITradeScenario[] = planResult.output.scenarios.map((s, index: number) => ({
        ...s,
        id: `${symbol}-${dateStr}-${index + 1}`,
      }));

      // 4d. シナリオを StrategyDSL に落とし即時 BT（Phase 6.7b、Devil's Advocate より前）
      let strategyBacktest: StrategyBacktesterRunResult | undefined;
      if (scenariosWithId.length > 0) {
        const tBt = Date.now();
        try {
          strategyBacktest = await this.strategyBacktester.run(scenariosWithId, {
            symbol,
            timeframe: planTimeframe,
          });
          console.log(
            `[Orchestrator] 戦略BT 完了: ${String(Date.now() - tBt)}ms, overallPassed=${String(
              strategyBacktest.overallPassed,
            )}, scenarios=${String(scenariosWithId.length)}`,
          );
        } catch (btErr) {
          console.warn('[Orchestrator] 戦略BT 全体失敗（DevilsAdvocate へ続行）:', btErr);
        }
      }

      // 5. Devil's Advocate で各シナリオをレビュー（Phase 2）
      //    abandon 判定なら confidence を 20 に抑え、warnings に追加する。
      //    代替戦略は提案させない（反証専任）。
      let devilsAdvocateTokens = 0;
      const aggregatedWarnings: string[] = [...(planResult.output.warnings ?? [])];
      for (const scenario of scenariosWithId) {
        try {
          const critique = await this.devilsAdvocate.critique(scenario, planResult.output.marketAnalysis);
          devilsAdvocateTokens += critique.tokenUsage;

          if (critique.output.recommendation.action === 'abandon') {
            scenario.confidence = Math.min(scenario.confidence, 20);
            const warn = `Devil's Advocate: ${critique.output.recommendation.rationale}`;
            scenario.warnings = [...(scenario.warnings ?? []), warn];
            aggregatedWarnings.push(`[${scenario.name}] ${warn}`);
            console.log(`[Orchestrator] Devil's Advocate abandon: ${scenario.name}`);
          } else if (critique.output.recommendation.action === 'modify') {
            const warn = `Devil's Advocate(modify): ${critique.output.recommendation.rationale}`;
            scenario.warnings = [...(scenario.warnings ?? []), warn];
            console.log(`[Orchestrator] Devil's Advocate modify: ${scenario.name}`);
          }
        } catch (daError) {
          console.warn(`[Orchestrator] Devil's Advocate 失敗（スキップ）:`, daError);
        }
      }

      // 6. DB保存（Plan AIが解釈を含む新設計）
      const saved = await this.planRepo.create({
        researchId: research.id,
        targetDate: date,
        symbol,
        marketAnalysis: planResult.output.marketAnalysis,
        scenarios: scenariosWithId,
        overallConfidence: planResult.output.overallConfidence,
        warnings: aggregatedWarnings,
        aiModel: planResult.model,
        tokenUsage: planResult.tokenUsage + devilsAdvocateTokens,
      });

      console.log(`[Orchestrator] プラン保存完了: ${saved.id}`);

      return {
        success: true,
        data: { ...saved, strategyBacktest },
        cached: false,
        tokenUsage:
          researchTokens +
          planResult.tokenUsage +
          devilsAdvocateTokens +
          hypothesisGeneratorTokens,
      };
    } catch (error) {
      console.error(`[Orchestrator] プラン生成エラー:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * フルパイプライン実行（リサーチ → プラン一括生成）
   */
  async runFullPipeline(request: {
    symbol: string;
    ohlcvData: { timestamp: Date; open: number; high: number; low: number; close: number; volume?: number }[];
    indicators?: IndicatorData;
    userPreferences?: UserTradingPreferences;
    forceRefresh?: boolean;
  }): Promise<{
    success: boolean;
    research?: MarketResearchWithTypes;
    plan?: AITradePlanWithOptionalBacktest;
    error?: string;
    totalTokenUsage: number;
    researchCached: boolean;
  }> {
    const { symbol, ohlcvData, indicators, userPreferences, forceRefresh = false } = request;

    console.log(`[Orchestrator] フルパイプライン開始: ${symbol}`);

    let totalTokens = 0;

    // 1. リサーチ生成
    const researchResult = await this.generateResearch({
      symbol,
      ohlcvData,
      indicators,
      forceRefresh,
    });

    if (!researchResult.success || !researchResult.data) {
      return {
        success: false,
        error: researchResult.error || 'Research failed',
        totalTokenUsage: 0,
        researchCached: false,
      };
    }

    totalTokens += researchResult.tokenUsage || 0;

    // 2. プラン生成
    const planResult = await this.generatePlan({
      symbol,
      researchId: researchResult.data.id,
      userPreferences,
    });

    if (!planResult.success || !planResult.data) {
      return {
        success: false,
        research: researchResult.data,
        error: planResult.error || 'Plan failed',
        totalTokenUsage: totalTokens,
        researchCached: researchResult.cached || false,
      };
    }

    totalTokens += planResult.tokenUsage || 0;

    console.log(`[Orchestrator] フルパイプライン完了: トークン合計 ${totalTokens}`);

    return {
      success: true,
      research: researchResult.data,
      plan: planResult.data,
      totalTokenUsage: totalTokens,
      researchCached: researchResult.cached || false,
    };
  }

  /**
   * 期限切れリサーチをクリーンアップ
   */
  async cleanupExpiredResearch(): Promise<number> {
    const deleted = await this.researchRepo.deleteExpired();
    console.log(`[Orchestrator] 期限切れリサーチ削除: ${deleted}件`);
    return deleted;
  }
}

// デフォルトインスタンス
export const aiOrchestrator = new AIOrchestrator();
