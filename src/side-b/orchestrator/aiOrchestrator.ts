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

import { v4 as uuidv4 } from 'uuid';
import {
  ResearchAIService,
  researchAIService,
  ResearchAIInput,
  PlanAIService,
  planAIService,
  PlanAIInput,
  UserTradingPreferences,
} from '../services';
import {
  ResearchRepository,
  researchRepository,
  MarketResearchWithTypes,
  PlanRepository,
  planRepository,
  AITradePlanWithTypes,
} from '../repositories';
import {
  MarketResearch,
  AITradePlan,
  GenerateResearchResponse,
  GeneratePlanResponse,
  AITradeScenario,
} from '../models';

// ===========================================
// 型定義
// ===========================================

/**
 * リサーチ生成リクエスト
 */
export interface OrchestratorResearchRequest {
  symbol: string;
  timeframe?: string;
  ohlcvData: { timestamp: Date; open: number; high: number; low: number; close: number; volume?: number }[];
  indicators?: Record<string, unknown>;
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
  indicators?: Record<string, unknown>;
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

  constructor(
    researchAI?: ResearchAIService,
    planAI?: PlanAIService,
    researchRepo?: ResearchRepository,
    planRepo?: PlanRepository
  ) {
    this.researchAI = researchAI || researchAIService;
    this.planAI = planAI || planAIService;
    this.researchRepo = researchRepo || researchRepository;
    this.planRepo = planRepo || planRepository;
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
        indicators: indicators as ResearchAIInput['indicators'],
      };

      const aiResult = await this.researchAI.generateResearch(aiInput);

      // 3. DB保存（シンプル化）
      const saved = await this.researchRepo.create({
        symbol,
        timeframe,
        featureVector: aiResult.output.featureVector,
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
  async generatePlan(request: OrchestratorPlanRequest): Promise<OrchestratorResult<AITradePlanWithTypes>> {
    const { symbol, targetDate, researchId, userPreferences, ohlcvData, indicators } = request;

    // 対象日の決定
    const date = targetDate ? new Date(targetDate) : new Date();
    date.setHours(0, 0, 0, 0);
    const dateStr = date.toISOString().split('T')[0];

    console.log(`[Orchestrator] プラン生成開始: ${symbol} / ${dateStr}`);

    try {
      // 1. 既存プランチェック
      const existingPlan = await this.planRepo.findByDateAndSymbol(date, symbol);
      if (existingPlan) {
        console.log(`[Orchestrator] 既存プラン発見: ${existingPlan.id}`);
        return {
          success: true,
          data: existingPlan,
          cached: true,
          tokenUsage: 0,
        };
      }

      // 2. リサーチ取得または生成
      let research: MarketResearchWithTypes | null = null;
      let researchCached = false;
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
        researchCached = true;
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
        researchCached = researchResult.cached || false;
        researchTokens = researchResult.tokenUsage || 0;
      }

      // 3. Plan AI 呼び出し
      console.log(`[Orchestrator] Plan AI 呼び出し`);
      const planInput: PlanAIInput = {
        research,
        targetDate: dateStr,
        userPreferences,
      };

      const planResult = await this.planAI.generatePlan(planInput);

      // シナリオにIDを付与
      const scenariosWithId: AITradeScenario[] = planResult.output.scenarios.map((s, index: number) => ({
        ...s,
        id: `${symbol}-${dateStr}-${index + 1}`,
      }));

      // 4. DB保存（Plan AIが解釈を含む新設計）
      const saved = await this.planRepo.create({
        researchId: research.id,
        targetDate: date,
        symbol,
        marketAnalysis: planResult.output.marketAnalysis,
        scenarios: scenariosWithId,
        overallConfidence: planResult.output.overallConfidence,
        warnings: planResult.output.warnings,
        aiModel: planResult.model,
        tokenUsage: planResult.tokenUsage,
      });

      console.log(`[Orchestrator] プラン保存完了: ${saved.id}`);

      return {
        success: true,
        data: saved,
        cached: false,
        tokenUsage: researchTokens + planResult.tokenUsage,
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
    indicators?: Record<string, unknown>;
    userPreferences?: UserTradingPreferences;
    forceRefresh?: boolean;
  }): Promise<{
    success: boolean;
    research?: MarketResearchWithTypes;
    plan?: AITradePlanWithTypes;
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
