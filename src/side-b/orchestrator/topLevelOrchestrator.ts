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

/**
 * PR #248 Copilot review #6 対応: 未使用フィールド (maxLlmTokens / timeoutMs) を削除し、
 * 実際に dispatchAction で消費される `maxParallel` のみに絞る。将来 timeout / token
 * 制御を導入したらフィールドを足す。
 */
const RunAllBudgetSchema = z.object({
  maxParallel: z.number().int().min(1).max(5),
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
/** PR #248 Copilot review #1: AgentRun から自身の履歴を取得する際の agentName 識別子 */
const AGENT_RUN_KIND = 'top_level_orchestrator';
/** PR #248 Copilot review #2: 既定の run_all budget (= LLM が指定しなかった時の fallback) */
const DEFAULT_RUN_ALL_BUDGET: z.infer<typeof RunAllBudgetSchema> = { maxParallel: 3 };

/**
 * PR #248 Copilot review #3 対応: 環境変数の rate-limit 値を厳密パース。
 * 不正値 (NaN / 負数 / 文字列) は warning を出して default にフォールバック。
 * `evolutionJobConfig.ts:parseStrictInt` と同じ慣行に揃える。
 */
function parseRateLimitEnv(raw: string | undefined, defaultValue: number, log: (msg: string) => void): number {
  if (raw === undefined) return defaultValue;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    log(`TOP_LEVEL_ORCHESTRATOR_RATE_LIMIT_PER_HOUR='${raw}' は不正値、default=${defaultValue} を使用`);
    return defaultValue;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 1) {
    log(`TOP_LEVEL_ORCHESTRATOR_RATE_LIMIT_PER_HOUR='${raw}' は不正値 (< 1)、default=${defaultValue} を使用`);
    return defaultValue;
  }
  return n;
}

/**
 * Phase 2 (2026-05-24): Prisma `AgentRunStatus` enum (= pending/running/succeeded/
 * failed/skipped/cancelled) を rules モジュールの論理 status (= running/completed/
 * failed/blocked) にマップする。
 *
 * - pending / running → 'running' (= まだ動いてる)
 * - succeeded / skipped → 'completed' (= 完走、成功扱い)
 * - cancelled → 'blocked' (= strictBlocked or token-budget で閉じた run)
 * - failed → 'failed' (= 例外で閉じた run)
 */
function mapAgentRunStatusToRuleStatus(
  status: string,
): 'running' | 'completed' | 'failed' | 'blocked' {
  switch (status) {
    case 'pending':
    case 'running':
      return 'running';
    case 'succeeded':
    case 'skipped':
      return 'completed';
    case 'cancelled':
      return 'blocked';
    case 'failed':
      return 'failed';
    default:
      // 想定外の Prisma enum 拡張時は 'completed' に倒して安全側
      return 'completed';
  }
}

/**
 * PR #248 Copilot review #4/#10 対応: LLM 応答からコードフェンス (```json ... ```) を
 * 剥がして生 JSON を抽出する。fence が無ければ元文字列を返す。
 */
function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  // ```json\n...\n``` または ```\n...\n```
  const fencedMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fencedMatch) return fencedMatch[1].trim();
  return trimmed;
}

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
    this.log = deps.log ?? ((msg) => console.log(`[TopLevelOrchestrator] ${msg}`));
    // PR #248 Copilot review #3: env を厳密パース、不正値は warning + default
    this.rateLimitPerHour =
      deps.rateLimitPerHour ??
      parseRateLimitEnv(process.env.TOP_LEVEL_ORCHESTRATOR_RATE_LIMIT_PER_HOUR, 3, this.log);
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
   *
   * Phase 2 (2026-05-24): AgentRun の永続化を追加。
   *   - サイクル開始時に AgentRun.create (status='pending')
   *   - LLM 判断後に AgentRunStep.create (= 判断履歴)
   *   - サイクル完了時に AgentRun.update (status='succeeded' / 'cancelled' / 'failed')
   *   - 例外時は AgentRun.update (status='failed', errorCode='fatal_*', errorMessage=...)
   *
   * これにより `fetchRecentAgentRuns` が実データを返し、禁止事項 #1 (連続 3 fatal) /
   * #3 (連打) / #6 (running 競合) が実運用で発火するようになる。
   */
  async decideAndExecute(
    trigger: 'cron' | 'manual' | 'test' = 'cron',
  ): Promise<TopLevelOrchestratorResult> {
    // Phase 2: サイクル開始時に AgentRun を作成 (status='pending')
    const agentRun = await this.prisma.agentRun.create({
      data: {
        kind: AGENT_RUN_KIND,
        triggeredBy: trigger,
        status: 'pending',
        startedAt: new Date(),
      },
    });

    try {
      const input = await this.collectInput(trigger);

      // 禁止事項 check (= LLM 呼び出し前)。fetchRecentAgentRuns は **自身を除外** するため、
      // 直前に作成した自分の AgentRun (= agentRun.id) を除外したリストを使う。
      const ruleResult = evaluateInputRules(
        {
          recentAgentRuns: await this.fetchRecentAgentRuns(agentRun.id),
          edgeLedgerByStatus: input.edgeLedger.byStatus,
          now: new Date(),
        },
        this.rateLimitPerHour,
      );

      if (ruleResult.strictBlocked) {
        const reason = ruleResult.strictBlockedReason ?? 'unknown';
        this.log(`strictBlocked → wait (${reason})`);
        // AgentRun を 'cancelled' で閉じる (= DB enum に 'blocked' は無いので summary で表現)
        await this.prisma.agentRun.update({
          where: { id: agentRun.id },
          data: {
            status: 'cancelled',
            finishedAt: new Date(),
            summary: `blocked: ${reason}`,
          },
        });
        return { output: null, strictBlockedReason: reason, executedJobs: [] };
      }

      // blockedActions を input に反映
      input.blockedActions = Array.from(ruleResult.blockedActions);
      input.blockedReasons = ruleResult.blockedReasons;

      // LLM 判断
      const llmStartedAt = new Date();
      let output = await this.invokeLlm(input);

      // PR #248 Copilot review #2 対応: LLM が blockedActions を無視した場合、
      // 機械的に 'wait' に強制する (= 禁止事項 #4 が確実に enforce される)。
      if (ruleResult.blockedActions.has(output.action)) {
        const reason = ruleResult.blockedReasons[output.action] ?? 'blocked action';
        this.log(`LLM が blocked action=${output.action} を選んだ → 'wait' に強制 (${reason})`);
        output = {
          action: 'wait',
          reasoning: `機械的に 'wait' に強制 (LLM 選択=${output.action}、理由: ${reason})`,
        };
      }

      // Phase 2: 判断結果を AgentRunStep に保存 (= recentDecisions 取得用)
      await this.prisma.agentRunStep.create({
        data: {
          runId: agentRun.id,
          stepName: 'decide',
          status: 'succeeded',
          startedAt: llmStartedAt,
          finishedAt: new Date(),
          summary: `action=${output.action} reasoning=${output.reasoning.slice(0, 400)}`,
        },
      });

      // 出力後 check (= 禁止事項 #2 トークン推定)
      const estimatedTokens = JSON.stringify(input).length / 4 + JSON.stringify(output).length / 4;
      const tokenCheck = checkLlmTokenBudget(Math.ceil(estimatedTokens));
      if (tokenCheck.blocked) {
        this.log(`token budget exceeded → wait に切替 (${tokenCheck.reason})`);
        const tokenWait: TopLevelOrchestratorOutput = {
          action: 'wait',
          reasoning: tokenCheck.reason ?? 'token budget',
        };
        await this.prisma.agentRun.update({
          where: { id: agentRun.id },
          data: {
            status: 'cancelled',
            finishedAt: new Date(),
            summary: `token-budget-exceeded: ${tokenCheck.reason}`,
          },
        });
        return { output: tokenWait, executedJobs: [] };
      }

      // dispatchAction
      const executedJobs = await this.dispatchAction(output);
      this.log(`action=${output.action} 完了、executed=${executedJobs.join(',')}`);

      // AgentRun を 'succeeded' で閉じる
      await this.prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: 'succeeded',
          finishedAt: new Date(),
          summary: `action=${output.action} executed=[${executedJobs.join(',')}]`,
        },
      });

      return { output, executedJobs };
    } catch (err) {
      // Phase 2: 例外時は 'failed' + errorCode='fatal_decideAndExecute' で AgentRun を閉じる。
      // 'fatal_' プレフィックスは禁止事項 #1 (連続 3 fatal) の判定に使われる。
      const errMessage = err instanceof Error ? err.message : String(err);
      this.log(`decideAndExecute 例外: ${errMessage}`);
      await this.prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          errorCode: 'fatal_decideAndExecute',
          errorMessage: errMessage.slice(0, 500),
        },
      });
      throw err;
    }
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

    // Phase 2 (2026-05-24): 直近 5 件の判断履歴を AgentRunStep から取得。
    // `stepName='decide'` でフィルタし、summary に `action=X reasoning=Y` 形式で
    // 保存された値を parse して構造化して返す。
    const recentDecisions = await this.fetchRecentDecisions(5);

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
   * Phase 2 (2026-05-24): 自身の直近 N 件の判断履歴を AgentRunStep から取得。
   *
   * `AgentRunStep` で `stepName='decide'` かつ親 AgentRun が `kind='top_level_orchestrator'`
   * のものを取得。summary は `decideAndExecute` で `action=X reasoning=Y` 形式に
   * 保存しているので、それを parse して構造化する。
   */
  private async fetchRecentDecisions(
    limit: number,
  ): Promise<TopLevelOrchestratorInput['recentDecisions']> {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const steps = await this.prisma.agentRunStep.findMany({
      where: {
        stepName: 'decide',
        startedAt: { gte: dayAgo },
        run: { kind: AGENT_RUN_KIND },
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: { startedAt: true, summary: true },
    });

    return steps.map((s) => {
      const summary = s.summary ?? '';
      // 'action=X reasoning=Y' の単純 parse (= 失敗時は wait + summary 全文を reasoning に格納)
      const actionMatch = summary.match(/^action=([a-z_]+)/);
      const reasoningMatch = summary.match(/reasoning=(.+)$/);
      const action = (actionMatch?.[1] ?? 'wait') as TopLevelAction;
      const reasoning = reasoningMatch?.[1] ?? summary;
      return {
        decidedAt: s.startedAt.toISOString(),
        action,
        reasoning,
      };
    });
  }

  /**
   * 自身の AgentRun 直近を取得 (Phase 2: 2026-05-24 で実データ取得を完成)。
   *
   * `AgentRun.kind = 'top_level_orchestrator'` でフィルタした直近 24h の run を
   * startedAt 降順で 20 件取得。ここで取得した結果が:
   *   - 連続 3 fatal → 禁止事項 #1 (強制 'wait')
   *   - 1h 内 4 回起動 → 禁止事項 #3 (連打防止)
   *   - running が混在 → 禁止事項 #6 (競合防止)
   * の判定に使われる。
   *
   * `excludeRunId` は自身の AgentRun (= サイクル開始時に create したもの) を除外する
   * ための ID。これがないと「自身の running を見て #6 で常に強制 wait」になる。
   *
   * Prisma `AgentRunStatus` enum (= pending/running/succeeded/failed/skipped/cancelled)
   * を rules の論理型 (= running/completed/failed/blocked) にマップ:
   *   - pending / running → 'running'
   *   - succeeded / skipped → 'completed'
   *   - cancelled → 'blocked' (= strictBlocked / token-budget で閉じた run)
   *   - failed → 'failed'
   *
   * `isFatal` 判定: status='failed' かつ errorCode が 'fatal_' プレフィックス。
   */
  private async fetchRecentAgentRuns(
    excludeRunId?: string,
  ): Promise<
    Array<{ finishedAt: Date | null; status: 'running' | 'completed' | 'failed' | 'blocked'; isFatal: boolean }>
  > {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.prisma.agentRun.findMany({
      where: {
        kind: AGENT_RUN_KIND,
        startedAt: { gte: dayAgo },
        ...(excludeRunId ? { id: { not: excludeRunId } } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: 20,
      select: { finishedAt: true, status: true, errorCode: true },
    });
    return rows.map((r) => ({
      finishedAt: r.finishedAt,
      status: mapAgentRunStatusToRuleStatus(r.status),
      isFatal: r.status === 'failed' && (r.errorCode?.startsWith('fatal') ?? false),
    }));
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

    // PR #248 Copilot review #4/#10 対応: コードフェンス (```json ... ```) を剥がしてから
    // JSON parse する (= LLM が prompt の指示を逸脱してフェンスで囲んでも壊れない)
    const stripped = stripCodeFence(content);
    try {
      return TopLevelOrchestratorOutputSchema.parse(JSON.parse(stripped));
    } catch (err) {
      throw new Error(
        `Top-Level Orchestrator: JSON parse or schema 検証失敗: ${String(err)} content=${stripped.slice(0, 200)}`,
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
        // PR #248 Copilot review #5/#6/#9/#11 対応: runAllBudget は optional のまま
        // 維持 (= スキーマ・プロンプト・テスト全部整合済)、未指定時は
        // DEFAULT_RUN_ALL_BUDGET (= maxParallel=3) を使う
        const budget = output.runAllBudget ?? DEFAULT_RUN_ALL_BUDGET;
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
