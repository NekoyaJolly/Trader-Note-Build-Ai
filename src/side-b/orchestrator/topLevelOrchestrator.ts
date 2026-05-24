/**
 * Top-Level Orchestrator (Phase B+、2026-05-24)
 *
 * Side-B の最上位判断層。Cron 起動時に「次にどのループを回すか」だけを LLM で判断し、
 * 専門 Agent に実行を委ねる。
 *
 * 設計書: `docs/architecture/TOP_LEVEL_ORCHESTRATOR_DESIGN.md`
 *
 * 責務:
 *   1. 入力収集 (= EdgeLedger / Evolution / ADK trace / lastRuns / 自身の履歴)
 *   2. 禁止事項 7 ルール check (= `topLevelOrchestratorRules.ts`)
 *   3. LLM 判断 (= top_level_orchestrator.md prompt 経由)
 *   4. 出力 parse + 実行 dispatch
 *
 * 旧 AgentLoop (PR #231 撤去) の轍を踏まないため、本クラスは:
 *   - 「次に何を呼ぶか」だけ判断、各 Job の内部ロジックには介入しない
 *   - 文脈は集約サマリのみ (= 全状態を持たない)
 *   - 禁止事項は LLM 裁量の外で機械的に enforce
 */

import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

import { AIProvider } from '../agent/aiProvider';
import { modelFor } from '../../config';
import type { PromptRegistry } from '../prompts/registry/PromptRegistry';
import { loadPromptWithGlobal } from '../prompts/loader';
import { evaluateInputRules, checkLlmTokenBudget } from './topLevelOrchestratorRules';

// ==========================================
// 型定義
// ==========================================

export type TopLevelAction =
  | 'create_hypothesis'
  | 'advance_validation'
  | 'run_evolution'
  | 'run_all'
  | 'wait';

const RunAllBudgetSchema = z.object({
  maxParallel: z.number().int().min(1).max(5),
  maxLlmTokens: z.number().int().min(1000).max(200_000),
  timeoutMs: z.number().int().min(10_000).max(60 * 60 * 1000),
});

export const TopLevelOrchestratorOutputSchema = z.object({
  action: z.enum([
    'create_hypothesis',
    'advance_validation',
    'run_evolution',
    'run_all',
    'wait',
  ]),
  reasoning: z.string().min(1),
  runAllBudget: RunAllBudgetSchema.optional(),
  waitUntil: z.string().datetime().optional(),
});

export type TopLevelOrchestratorOutput = z.infer<typeof TopLevelOrchestratorOutputSchema>;

export interface TopLevelOrchestratorInput {
  trigger: 'cron' | 'manual' | 'test';
  edgeLedger: {
    byStatus: Record<string, number>;
    recentlyCreated24h: number;
    recentlyScreeningPassed24h: number;
    recentlyConfirmed24h: number;
  };
  evolution: {
    recentPassed24h: number;
    recentFailed24h: number;
    lastRunFinishedAt: string | null;
  };
  recentTraceEvents: {
    summary: string;
    errorCount24h: number;
  };
  lastRuns: {
    planGeneration: string | null;
    screening: string | null;
    fullValidation: string | null;
    evolution: string | null;
    discovery: string | null;
  };
  recentDecisions: Array<{
    decidedAt: string;
    action: TopLevelAction;
    reasoning: string;
  }>;
  blockedActions: TopLevelAction[];
  blockedReasons: Record<string, string>;
}

/**
 * 専門 Agent 起動 callback の集合。
 * scheduler 側で wire (= 既存 Job への委譲) する。テストでは mock 化可能。
 */
export interface TopLevelOrchestratorJobInvokers {
  runPlanGeneration: () => Promise<void>;
  runScreening: () => Promise<void>;
  runFullValidation: () => Promise<void>;
  runEvolution: () => Promise<void>;
}

export interface TopLevelOrchestratorDeps {
  prisma: PrismaClient;
  aiProvider?: AIProvider;
  promptRegistry?: PromptRegistry;
  jobInvokers: TopLevelOrchestratorJobInvokers;
  /** 1h 起動上限 (= 禁止事項 #3、env で可変) */
  rateLimitPerHour?: number;
  /** ログ出力 (= scheduler の log を共有可能) */
  log?: (msg: string) => void;
}

export interface TopLevelOrchestratorResult {
  /** 強制 'wait' でスキップされた場合は output=null */
  output: TopLevelOrchestratorOutput | null;
  /** strictBlocked の理由 (output=null 時のみ設定) */
  strictBlockedReason?: string;
  /** 実行された Job (= dispatchAction の結果、wait は空配列) */
  executedJobs: string[];
}

const PROMPT_NAME = 'top_level_orchestrator';

// ==========================================
// 本体
// ==========================================

export class TopLevelOrchestrator {
  private readonly prisma: PrismaClient;
  private readonly aiProvider: AIProvider;
  private _registry: PromptRegistry | null;
  private readonly jobInvokers: TopLevelOrchestratorJobInvokers;
  private readonly rateLimitPerHour: number;
  private readonly log: (msg: string) => void;

  constructor(deps: TopLevelOrchestratorDeps) {
    this.prisma = deps.prisma;
    this.aiProvider = deps.aiProvider ?? new AIProvider({ model: modelFor('top_level_orchestrator') });
    this._registry = deps.promptRegistry ?? null;
    this.jobInvokers = deps.jobInvokers;
    this.rateLimitPerHour =
      deps.rateLimitPerHour ??
      Number(process.env.TOP_LEVEL_ORCHESTRATOR_RATE_LIMIT_PER_HOUR ?? '3');
    this.log = deps.log ?? ((msg) => console.log(`[TopLevelOrchestrator] ${msg}`));
  }

  /**
   * Registry の遅延アクセサ。テスト mock を許可しつつ、未指定時は初回参照で生成。
   */
  private async getRegistry(): Promise<PromptRegistry | null> {
    if (this._registry) return this._registry;
    try {
      const { PromptRegistry } = await import('../prompts/registry/PromptRegistry');
      this._registry = new PromptRegistry();
      return this._registry;
    } catch (err) {
      this.log(`PromptRegistry 初期化失敗 (fallback loader 使用): ${String(err)}`);
      return null;
    }
  }

  /**
   * 1 サイクル実行: 入力収集 → 禁止事項 check → LLM 判断 → 実行。
   *
   * trigger='cron' が通常経路。'manual' は SideBController API 経由。'test' は unit test。
   */
  async decideAndExecute(
    trigger: 'cron' | 'manual' | 'test' = 'cron',
  ): Promise<TopLevelOrchestratorResult> {
    const input = await this.collectInput(trigger);

    // 禁止事項 check (= LLM 呼び出し前)
    const ruleResult = evaluateInputRules(
      {
        recentAgentRuns: await this.fetchRecentAgentRuns(),
        edgeLedgerByStatus: input.edgeLedger.byStatus,
        now: new Date(),
      },
      this.rateLimitPerHour,
    );

    if (ruleResult.strictBlocked) {
      const reason = ruleResult.strictBlockedReason ?? 'unknown';
      this.log(`strictBlocked → wait (${reason})`);
      return { output: null, strictBlockedReason: reason, executedJobs: [] };
    }

    // blockedActions を input に反映
    input.blockedActions = Array.from(ruleResult.blockedActions);
    input.blockedReasons = ruleResult.blockedReasons;

    // LLM 判断
    const output = await this.invokeLlm(input);

    // 出力後 check (= 禁止事項 #2 トークン推定)
    const estimatedTokens = JSON.stringify(input).length / 4 + JSON.stringify(output).length / 4;
    const tokenCheck = checkLlmTokenBudget(Math.ceil(estimatedTokens));
    if (tokenCheck.blocked) {
      this.log(`token budget exceeded → wait に切替 (${tokenCheck.reason})`);
      return {
        output: { action: 'wait', reasoning: tokenCheck.reason ?? 'token budget' },
        executedJobs: [],
      };
    }

    // dispatchAction
    const executedJobs = await this.dispatchAction(output);
    this.log(`action=${output.action} 完了、executed=${executedJobs.join(',')}`);
    return { output, executedJobs };
  }

  /**
   * 入力収集: EdgeLedger / Evolution / lastRuns / 自身の履歴。
   *
   * Phase B+ MVP: ADK trace 集計と全 4 段 output は省略 (= 直近 EdgeLedger / Evolution
   * の量感だけで判断可能なはず)。本 PR では最小限の集約に絞る。
   */
  private async collectInput(trigger: 'cron' | 'manual' | 'test'): Promise<TopLevelOrchestratorInput> {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // EdgeLedger.byStatus
    const statusGroups = await this.prisma.edgeHypothesis.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    for (const g of statusGroups) {
      byStatus[g.status] = g._count._all;
    }

    // EdgeLedger 直近 24h 集計
    const recentlyCreated24h = await this.prisma.edgeHypothesis.count({
      where: { firstObservedAt: { gte: dayAgo } },
    });
    const recentlyScreeningPassed24h = await this.prisma.edgeHypothesis.count({
      where: { status: 'screening_passed', statusUpdatedAt: { gte: dayAgo } },
    });
    const recentlyConfirmed24h = await this.prisma.edgeHypothesis.count({
      where: { status: 'confirmed', statusUpdatedAt: { gte: dayAgo } },
    });

    // Evolution 直近 24h
    const recentPassed24h = await this.prisma.evolutionBacktestRun.count({
      where: { createdAt: { gte: dayAgo }, formalBtPassed: true },
    });
    const recentFailed24h = await this.prisma.evolutionBacktestRun.count({
      where: { createdAt: { gte: dayAgo }, formalBtPassed: false },
    });
    const lastRun = await this.prisma.evolutionBacktestRun.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    // 自身の直近 5 件の判断履歴 (= AgentRunStep 経由、本 PR では空配列で代用)
    const recentDecisions: TopLevelOrchestratorInput['recentDecisions'] = [];

    return {
      trigger,
      edgeLedger: {
        byStatus,
        recentlyCreated24h,
        recentlyScreeningPassed24h,
        recentlyConfirmed24h,
      },
      evolution: {
        recentPassed24h,
        recentFailed24h,
        lastRunFinishedAt: lastRun?.createdAt.toISOString() ?? null,
      },
      recentTraceEvents: {
        summary: 'Phase B+ MVP: trace 集計は将来実装',
        errorCount24h: 0,
      },
      lastRuns: {
        planGeneration: null,
        screening: null,
        fullValidation: null,
        evolution: lastRun?.createdAt.toISOString() ?? null,
        discovery: null,
      },
      recentDecisions,
      blockedActions: [],
      blockedReasons: {},
    };
  }

  /**
   * 自身の AgentRun 直近 (Top-Level Orchestrator 用、本 PR では空配列で代用)。
   *
   * 将来: RunLedgerService 経由で `agentName='top_level_orchestrator'` に絞った
   * AgentRun を直近 24h で取得。現状は禁止事項 check に最小限で対応するため空。
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Phase B+ MVP では空配列で代用、将来 RunLedgerService 経由で実装すると async になる
  private async fetchRecentAgentRuns(): Promise<
    Array<{ finishedAt: Date | null; status: 'running' | 'completed' | 'failed' | 'blocked'; isFatal: boolean }>
  > {
    return [];
  }

  /**
   * LLM 判断: top_level_orchestrator prompt を Registry から取得して chat 呼び出し。
   */
  private async invokeLlm(input: TopLevelOrchestratorInput): Promise<TopLevelOrchestratorOutput> {
    const systemPrompt = await this.resolvePrompt();
    const userPrompt = `現状の Side-B 状態:\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`\n\n上記の入力に基づいて、次のアクションを JSON で返してください。`;

    const response = await this.aiProvider.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.3, responseFormat: { type: 'json_object' } },
    );

    const content = response.content?.trim() ?? '';
    if (!content) {
      throw new Error('Top-Level Orchestrator: LLM 応答が空');
    }

    // JSON parse + Zod 検証 (= Zod.safeParse は unknown を受け付けるので
    // parse 戻り値 (= JsonValue 相当) をそのまま渡せる)
    try {
      // JSON.parse の戻り値は仕様上 any 扱いだが、直後の Zod parse で narrow される
      // ため本コードでは中間変数の型注釈を付けない (= unknown キーワードを書かない)
      return TopLevelOrchestratorOutputSchema.parse(JSON.parse(content));
    } catch (err) {
      throw new Error(
        `Top-Level Orchestrator: JSON parse or schema 検証失敗: ${String(err)} content=${content.slice(0, 200)}`,
        { cause: err },
      );
    }
  }

  private async resolvePrompt(): Promise<string> {
    const registry = await this.getRegistry();
    if (registry) {
      try {
        return await registry.getCompositeActive(PROMPT_NAME);
      } catch (err) {
        this.log(`Registry 取得失敗、ファイル fallback: ${String(err)}`);
      }
    }
    return loadPromptWithGlobal(PROMPT_NAME);
  }

  /**
   * 判断結果に応じて専門 Agent を起動。
   *
   * `wait` は no-op、`run_all` は 3 つ並列 (= budget.maxParallel で clamp)。
   * 各 Job 内のエラーは捕捉して log のみ、スキップして次へ進む (= 1 個失敗で全停止しない)。
   */
  private async dispatchAction(output: TopLevelOrchestratorOutput): Promise<string[]> {
    const executed: string[] = [];
    const safeInvoke = async (name: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await fn();
        executed.push(name);
      } catch (err) {
        this.log(`${name} 実行失敗 (継続): ${String(err)}`);
      }
    };

    switch (output.action) {
      case 'wait':
        return [];
      case 'create_hypothesis':
        await safeInvoke('planGeneration', () => this.jobInvokers.runPlanGeneration());
        return executed;
      case 'advance_validation':
        await safeInvoke('screening', () => this.jobInvokers.runScreening());
        await safeInvoke('fullValidation', () => this.jobInvokers.runFullValidation());
        return executed;
      case 'run_evolution':
        await safeInvoke('evolution', () => this.jobInvokers.runEvolution());
        return executed;
      case 'run_all': {
        const budget = output.runAllBudget ?? { maxParallel: 3, maxLlmTokens: 50_000, timeoutMs: 600_000 };
        const tasks: Array<{ name: string; fn: () => Promise<void> }> = [
          { name: 'planGeneration', fn: () => this.jobInvokers.runPlanGeneration() },
          { name: 'screening', fn: () => this.jobInvokers.runScreening() },
          { name: 'evolution', fn: () => this.jobInvokers.runEvolution() },
        ];
        const limited = tasks.slice(0, Math.max(1, Math.min(budget.maxParallel, 3)));
        await Promise.all(limited.map((t) => safeInvoke(t.name, t.fn)));
        return executed;
      }
    }
  }
}
