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
  ResearchOutputRepository,
  ResearchOutputWithTypes,
  PlanRepository,
  AITradePlanWithTypes} from '../repositories';
import {
  researchOutputRepository,
  planRepository
} from '../repositories';
import type {
  AITradeScenario} from '../models';
import {
  buildHigherTFContext
} from '../knowledge';
import type { HigherTimeframeContext } from '../knowledge';
import {
  defaultLensAggregator,
  registerDefaultLenses,
  type LensFeatureSnapshot,
} from '../lenses';
import { agentMemory } from '../agent/agentMemory';
import { edgeLedger } from '../ledger';
import { decideExistingPlanAction } from './existingPlanDecision';
import { applyDebateDirectionToScenarios } from './debateDirectionHookup';
import type { EdgeHypothesis } from '../models/edgeHypothesis';
import { IndicatorSpecialist } from '../agents/specialists/IndicatorSpecialist';
import { fetchIndicatorBundleForMTF } from '../agents/specialists/analysisEngineIndicatorFetch';
import type { IndicatorAnalysis } from '../agents/specialists/types';
import { deriveHigherTimeframe } from '../evolution/seedDescriptor';
import { isSupportedTimeframe } from '../constants/timeframes';
import {
  type BullBearDebateAgent,
  bullBearDebateAgent,
  type BullBearDebateResult,
} from '../agents/BullBearDebateAgent';
// Phase A: EODHD 外部要因 context 取得
import { fetchEodhdContextsForResearch } from '../research/eodhdContextFetcher';
// P3: Plan 多段 trace 配線
import { randomUUID } from 'crypto';
import {
  NoopTraceSink,
  tracePlanStep,
  type PlanStepTraceContext,
  type TraceSink,
} from '../adk/tracing';

/** P3: Plan 多段 trace の agentName 固定値 (= AdkTraceEvent.agentName)。 */
const PLAN_AGENT_NAME = 'aiOrchestrator';
/** P3: Plan 多段 trace の callerReason 固定値 (= AdkTraceEvent.callerReason)。 */
const PLAN_CALLER_REASON = 'plan-multi-stage';

// ===========================================
// 型定義
// ===========================================

/**
 * DB 永続化されたプラン＋直近の Bull vs Bear 討論結果（メモリ上のみ）
 *
 * Step A-3: 旧 `strategyBacktest` フィールドは廃止。StrategyBacktester は Plan フェーズ
 * から切り出され、後続 Step D-3 で Action フロー末尾 (= 戦略の削り落とし) に再配置予定。
 */
export type AITradePlanWithOptionalBacktest = AITradePlanWithTypes & {
  /** Phase 7: Bull vs Bear 討論結果（メモリ上のみ） */
  bullBearDebate?: BullBearDebateResult;
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
  /**
   * Phase A: ResearchOutput.id を指定して既存リサーチを再利用
   * (旧 researchId と命名互換: 内部は ResearchOutput を参照)
   */
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
  private researchOutputRepo: ResearchOutputRepository;
  private planRepo: PlanRepository;
  private bullBearDebate: BullBearDebateAgent;
  /** P3: Plan 多段 step 単位の trace 投入先。デフォルトは NoopTraceSink (= 配線済だが no-op)。 */
  private traceSink: TraceSink;

  constructor(
    researchAI?: ResearchAIService,
    planAI?: PlanAIService,
    researchOutputRepo?: ResearchOutputRepository,
    planRepo?: PlanRepository,
    bullBearDebate?: BullBearDebateAgent,
    traceSink?: TraceSink,
  ) {
    this.researchAI = researchAI || researchAIService;
    this.planAI = planAI || planAIService;
    this.researchOutputRepo = researchOutputRepo || researchOutputRepository;
    this.planRepo = planRepo || planRepository;
    this.bullBearDebate = bullBearDebate || bullBearDebateAgent;
    // P3: traceSink は test / 観測機構から差し替え可能。未指定時は NoopTraceSink で
    // 機能等価 (= 記録は何も残らず本処理は同じ結果)。tracePlanStep は呼出毎に UUID
    // 生成 + payloadToSummary + event object 構築のコストが発生するため、厳密な「完全
    // 等価」ではない (PR #242 Copilot review 対応)。本番では NoopTraceSink で支配的
    // コストとはならない (10 step × ~数 μs = 数十 μs / generatePlan) ことを確認済。
    this.traceSink = traceSink || new NoopTraceSink();
  }

  /**
   * リサーチを生成（キャッシュ対応）
   * 
   * フロー:
   * 1. forceRefresh=false かつ有効なキャッシュがあれば再利用
   * 2. なければ Research AI 呼び出し
   * 3. DB保存
   */
  async generateResearch(request: OrchestratorResearchRequest): Promise<OrchestratorResult<ResearchOutputWithTypes>> {
    const { symbol, timeframe, ohlcvData, indicators, forceRefresh = false } = request;

    console.log(`[Orchestrator] リサーチ生成開始: ${symbol}`);

    try {
      // 1. キャッシュ確認
      if (!forceRefresh) {
        const cached = await this.researchOutputRepo.findValidBySymbol(symbol);
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

      // Phase A: EODHD 外部要因 context を並列取得 (各失敗は graceful、OHLCV だけで継続可能)
      const eodhdContexts = await fetchEodhdContextsForResearch(symbol);

      // 2. Research AI 呼び出し
      console.log(`[Orchestrator] Research AI 呼び出し`);
      const aiInput: ResearchAIInput = {
        symbol,
        timeframe,
        ohlcvData,
        indicators: indicators,
        ...eodhdContexts,
      };

      const aiResult = await this.researchAI.generateResearch(aiInput);

      // 3. DB保存 (Phase A: ResearchOutput に marketAnalysis のみを構造化保存。
      //    featureVector は読み取り時に analysisToLegacyFeatureVector() で派生)
      const saved = await this.researchOutputRepo.create({
        symbol,
        timeframe,
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
      // P3: 本 generatePlan 呼出全体に紐づく trace context。invocationId 1 つで Plan
      // 多段の 10 step を貫き、Observer MVP (P1a) からは「同じ invocationId の step
      // 群」で集計できる。各 step は tracePlanStep に渡し start/complete/fail event
      // を emit する (NoopTraceSink がデフォルトのため既存挙動は不変)。
      const traceCtx: PlanStepTraceContext = {
        sink: this.traceSink,
        agentName: PLAN_AGENT_NAME,
        invocationId: randomUUID(),
        callerReason: PLAN_CALLER_REASON,
      };

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
      let research: ResearchOutputWithTypes | null = null;
      let researchTokens = 0;

      if (researchId) {
        // 指定されたリサーチを使用
        research = await this.researchOutputRepo.findById(researchId);
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

        const researchResult = await tracePlanStep(
          traceCtx,
          'research_primary',
          { symbol, hasIndicators: indicators !== undefined },
          () =>
            this.generateResearch({
              symbol,
              ohlcvData,
              indicators,
            }),
        );

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
          const htfResult = await tracePlanStep(
            traceCtx,
            'research_higher_tf',
            { symbol, timeframe: higherTFData.timeframe },
            () =>
              this.researchAI.generateResearch({
                symbol,
                timeframe: higherTFData.timeframe,
                ohlcvData: higherTFData.ohlcvData,
                indicators: higherTFData.indicators,
              }),
          );
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
      // MTF 文脈は必須 (feedback_timeframe_mandatory): TF 無しの research 出力は誤りなので、
      // 黙って '15m' に倒さず明示的にエラー化する (generatePlan の try/catch が {success:false} に degrade)。
      const planTimeframe = research.timeframe;
      if (!planTimeframe) {
        throw new Error(
          `[Orchestrator] research.timeframe が未設定のため plan を生成できません (symbol=${symbol})。` +
            `MTF 文脈 (執行足 + 上位足) は plan→trade→note を通じて必須。`,
        );
      }
      // 永続化用に上位足を常時算出 (IndicatorSpecialist 分岐の有無に依らず plan に残す)。
      const planHigherTimeframe = deriveHigherTimeframe(planTimeframe);
      registerDefaultLenses();
      let lensSnapshot: LensFeatureSnapshot | undefined;
      try {
        lensSnapshot = await tracePlanStep(
          traceCtx,
          'lens_aggregation',
          { symbol, timeframe: planTimeframe },
          () =>
            defaultLensAggregator.computeAll({
              symbol,
              timeframe: planTimeframe,
              timestamp: new Date(),
              ohlcvBars: ohlcvData, // researchId 経由時は undefined の可能性あり（レンズ側で unclear/unknown を返す）
              existingAnalysis: research.marketAnalysis,
            }),
        );
        console.log(`[Orchestrator] レンズ計算完了: ${lensSnapshot.features.size}個 / ${lensSnapshot.totalComputeDurationMs}ms`);
        // Reflection 用に AgentMemory へ保存
        agentMemory.setCurrentLensSnapshot(symbol, lensSnapshot);
      } catch (lensError) {
        console.warn(`[Orchestrator] レンズ計算失敗（戦略生成は続行）:`, lensError);
      }

      // 4b. 既存仮説候補を集める (= EdgeLedger マッチのみ)
      //
      // Step A-1: HypothesisGenerator は Plan フェーズから完全切出 (= 別枠 dormant 化、
      // class は src/side-b/agents/HypothesisGeneratorAgent.ts に残置)。新規仮説生成は
      // 今後別経路 (= 将来 Top-Level Orchestrator action 経由 or 手動呼出) で実施する。
      let candidateHypotheses: EdgeHypothesis[] = [];
      /**
       * Phase 6.8 (2026-05-27): IndicatorSpecialist 統合。MTF (現在 TF + 上位 TF) で
       * 17 indicator のうち P0+P1 の 10 種を見て解釈する。BullBearDebate / Plan AI に
       * 同じ `indicatorAnalysis` を渡す。
       * Step A-1: HypothesisGen 切出に伴い「matched.length < 3 の時だけ呼ぶ」条件を撤廃、
       * IndicatorSpecialist は常時呼出に変更 (= シナリオ生成の前提として常に必要)。
       */
      let indicatorAnalysis: IndicatorAnalysis | null = null;
      let indicatorSpecialistTokens = 0;
      if (lensSnapshot) {
        try {
          const matched = await edgeLedger.findMatching(symbol, lensSnapshot, {
            statuses: ['confirmed', 'testing', 'unverified'],
          });
          console.log(`[Orchestrator] 既存マッチ仮説: ${matched.length}個`);

          // Phase 6.8: IndicatorSpecialist で MTF テクニカル分析を取得 (常時呼出)
          try {
            const specialistResult = await tracePlanStep(
              traceCtx,
              'indicator_specialist',
              { symbol, timeframe: planTimeframe },
              async () => {
                // 上位 TF を導出 (= PR #246 deriveHigherTimeframe を流用)
                if (!isSupportedTimeframe(planTimeframe)) {
                  console.warn(
                    `[Orchestrator] planTimeframe=${planTimeframe} は SupportedTimeframe 外、` +
                      `IndicatorSpecialist スキップ`,
                  );
                  return null;
                }
                // ohlcvData は本経路 (research 未生成) に到達する時には必ず非 null
                // (= L331 でガード済) だが、TS 型は optional なのでここで再確認
                if (!ohlcvData || ohlcvData.length === 0) {
                  console.warn(
                    '[Orchestrator] ohlcvData が空、IndicatorSpecialist スキップ',
                  );
                  return null;
                }
                const higherTimeframe = deriveHigherTimeframe(planTimeframe);
                // analysis-engine 2 並列 batch 取得
                const specialistInput = await fetchIndicatorBundleForMTF({
                  symbol,
                  currentTimeframe: planTimeframe,
                  higherTimeframe,
                  currentOhlcv: ohlcvData,
                  higherOhlcv: higherTFData?.ohlcvData,
                });
                if (!specialistInput) return null;
                // P0 必須 indicator (= sma/ema/rsi/macd/atr) が現在 TF で 1 つでも
                // 欠落していたら LLM 呼び出しを skip (= 低品質出力 + 無駄コスト回避)
                if (!IndicatorSpecialist.hasMinimumDataForAnalysis(specialistInput)) {
                  console.warn(
                    '[Orchestrator] P0 必須 indicator 欠落、IndicatorSpecialist スキップ',
                  );
                  return null;
                }
                // LLM 解釈
                const specialist = new IndicatorSpecialist();
                return await specialist.analyze(specialistInput);
              },
            );
            if (specialistResult) {
              indicatorAnalysis = specialistResult.output;
              indicatorSpecialistTokens = specialistResult.tokenUsage;
              console.log(
                `[Orchestrator] IndicatorSpecialist 完了: ` +
                  `current=${indicatorAnalysis.current.trendState}/${indicatorAnalysis.current.momentum}, ` +
                  `mtf=${indicatorAnalysis.mtfAlignment.trendAlignment}, ` +
                  `confidence=${indicatorAnalysis.confidence}`,
              );
            } else {
              console.log('[Orchestrator] IndicatorSpecialist null (= 取得失敗 or 解釈失敗)');
            }
          } catch (err) {
            console.warn('[Orchestrator] IndicatorSpecialist 失敗(続行):', err);
          }

          candidateHypotheses = matched;
        } catch (err) {
          console.warn('[Orchestrator] 候補仮説収集失敗（戦略生成は続行）:', err);
        }
      }

      // 4c. Plan AI 呼び出し
      //
      // Step A-2: 順序入替。旧フロー (Debate → PlanAI) では Debate output が PlanAI に
      // 渡されておらず、Debate が意思決定に寄与しない設計の歪みがあった。新フロー
      // (PlanAI → Debate) ではシナリオを先に生成し、生成シナリオに対する優勢判定を
      // Debate で行う流れに整理する。Debate output を採用方向として hookup するのは
      // 後続 Step A-4 で実施。本 PR ではあくまで「順序入替」のみ行う。
      console.log(`[Orchestrator] Plan AI 呼び出し (候補仮説: ${candidateHypotheses.length}個)`);
      const planInput: PlanAIInput = {
        research,
        targetDate: dateStr,
        userPreferences,
        higherTF: higherTFContext,
        lensSnapshot,
        candidateHypotheses,
        // Phase 6.8: IndicatorSpecialist の MTF テクニカル分析を Plan AI にも渡す
        indicatorAnalysis: indicatorAnalysis ?? undefined,
      };

      const planResult = await tracePlanStep(
        traceCtx,
        'plan_ai',
        { symbol, dateStr, candidateCount: candidateHypotheses.length },
        () => this.planAI.generatePlan(planInput),
      );

      // 4d. Bull vs Bear 討論
      // テスト環境では外部 LLM 呼び出しを防ぐためスキップ（DI でモックを渡さない場合の安全弁）
      // Step A-2 ではあくまで呼出順を PlanAI の後ろに移動するだけ。Debate の input は
      // 従来通り (candidateHypotheses / lensSnapshot / indicatorAnalysis) で PlanAI が
      // 生成した scenarios は参照しない。Debate output (= 優勢判定) も planResult や
      // 保存内容には反映されず、記録のみ。Debate input に scenarios を渡す + output を
      // 採用方向として hookup するのは Step A-4 で実施予定。
      let debateResult: BullBearDebateResult | undefined;
      let debateTokens = 0;
      if (process.env.NODE_ENV !== 'test') {
        try {
          const tDebate = Date.now();
          debateResult = await tracePlanStep(
            traceCtx,
            'bull_bear_debate',
            { symbol, timeframe: planTimeframe, candidateCount: candidateHypotheses.length },
            () =>
              this.bullBearDebate.debate({
                symbol,
                timeframe: planTimeframe,
                lensSnapshot,
                candidateHypotheses,
                indicatorAnalysis: indicatorAnalysis ?? undefined,
              }),
          );
          debateTokens = debateResult.tokenUsage;
          console.log(
            `[Orchestrator] Bull vs Bear 討論完了: ${String(Date.now() - tDebate)}ms, ` +
            `preferred=${debateResult.output.synthesis.preferredDirection}, ` +
            `confidence=${String(debateResult.output.synthesis.preferredConfidence)}`,
          );
        } catch (debateErr) {
          console.warn('[Orchestrator] Bull vs Bear 討論失敗（続行）:', debateErr);
        }
      }

      // シナリオにIDを付与
      const scenariosWithId: AITradeScenario[] = planResult.output.scenarios.map((s, index: number) => ({
        ...s,
        id: `${symbol}-${dateStr}-${index + 1}`,
      }));

      // Step A-3: Plan フェーズから StrategyBacktester (= DSL+BT) を切出。
      // Plan は「シナリオ作りに専念」する設計に整理する。strategyBacktesterAgent class
      // は残置 (src/side-b/agents/StrategyBacktesterAgent.ts)、後続 Step D-3 で Action
      // フロー末尾の「削り落とし」役として再配置予定。
      const aggregatedWarnings: string[] = [...(planResult.output.warnings ?? [])];

      // Step A-4: BullBearDebate の優勢判定を採用方向として PlanAI シナリオに hookup。
      //
      // Nekoさん 設計意図: 「ディベートが結果としてどっち優勢かを出してくる。その優勢な方向を
      // そのままシナリオの採用方向として使う」。実体は `debateDirectionHookup.ts` の純粋関数
      // (= ユニットテスト可能 + NaN ガード組込) に委譲。
      let adjustedScenarios = scenariosWithId;
      if (debateResult) {
        const { adjustedScenarios: adjusted, aggregatedWarnings: debateWarnings } =
          applyDebateDirectionToScenarios(scenariosWithId, {
            preferredDirection: debateResult.output.synthesis.preferredDirection,
            preferredConfidence: debateResult.output.synthesis.preferredConfidence,
          });
        adjustedScenarios = adjusted;
        aggregatedWarnings.push(...debateWarnings);
        // 採用方向との照合結果をログ出力 (= warnings に反映されなかった一致ケースも観測可能に)
        const preferred = debateResult.output.synthesis.preferredDirection;
        for (const s of scenariosWithId) {
          if (preferred !== 'neutral' && s.direction === preferred) {
            console.log(`[Orchestrator] Debate 採用方向一致: ${s.name} (${preferred})`);
          }
        }
      }

      // 5. DB保存（Plan AIが解釈を含む新設計）
      // cron 先行で同日 Plan が存在する場合 (POST /scheduler/run-daily-plan の
      // 手動再発火) に Unique constraint 衝突しないよう upsertByDateSymbol を使う。
      // 手動発火 = 上書き再生成の意味として動作する。
      const saved = await tracePlanStep(
        traceCtx,
        'plan_persist',
        { symbol, dateStr, scenarioCount: adjustedScenarios.length },
        () =>
          this.planRepo.upsertByDateSymbol({
            // Phase A: 新規 plan は ResearchOutput を参照 (旧 researchId は Deprecated)
            researchOutputId: research.id,
            targetDate: date,
            symbol,
            timeframe: planTimeframe,
            higherTimeframe: planHigherTimeframe,
            marketAnalysis: planResult.output.marketAnalysis,
            scenarios: adjustedScenarios,
            overallConfidence: planResult.output.overallConfidence,
            warnings: aggregatedWarnings,
            aiModel: planResult.model,
            // debateTokens + indicatorSpecialistTokens を加算してコスト追跡値を API 返却値と揃える
            tokenUsage: planResult.tokenUsage + indicatorSpecialistTokens + debateTokens,
          }),
      );

      console.log(`[Orchestrator] プラン保存完了: ${saved.id}`);

      return {
        success: true,
        data: { ...saved, bullBearDebate: debateResult },
        cached: false,
        tokenUsage:
          researchTokens +
          planResult.tokenUsage +
          indicatorSpecialistTokens +
          debateTokens,
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
    research?: ResearchOutputWithTypes;
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
    const deleted = await this.researchOutputRepo.deleteExpired();
    console.log(`[Orchestrator] 期限切れリサーチ削除: ${deleted}件`);
    return deleted;
  }
}

// デフォルトインスタンス
export const aiOrchestrator = new AIOrchestrator();
