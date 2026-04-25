/**
 * Phase 6: MetaEvolutionAgent
 *
 * エージェント構成の再編成を **提案** するエージェント。
 *
 * 重要原則 (§3.3):
 * - 提案のみ、実行は人間承認必須 (executeProposal の approval 引数で保証)
 * - 自動スケジューラー統合はしない(手動トリガーのみ、CLI / UI から明示的に呼ぶ)
 * - 月あたり新規エージェント追加上限: 1 体
 * - 削除は絶対に自動化しない(deprecate 提案も人間承認経由)
 * - 全提案を AgentRestructureProposal テーブルに永続化
 *
 * モデル: Opus 4.7(構造再編成は最重要判断)
 */

import { PrismaClient } from '@prisma/client';
import { AIProvider, type ChatMessage } from '../agent/aiProvider';
import { loadPromptWithGlobal } from '../prompts/loader';
import { modelFor } from '../../config';
import {
  PromptRegistry,
  GLOBAL_AGENT_NAME,
  SPECIALIST_COMMON_AGENT_NAME,
} from '../prompts/registry/PromptRegistry';
import { extractJson } from './llmJsonExtract';

export interface AgentPerformance {
  agentName: string;
  avgScore: number;
  usageCount: number;
  successCount: number;
}

/** Discovery / Reflection の要約(メモリから受け取る想定)。 */
export interface DiscoveryReportSummary {
  weekStart: string;
  keyFindings: string[];
  topLenses: string[];
}

export interface ReflectionLessonSummary {
  recordedAt: string;
  lesson: string;
  source?: string;
}

export interface MetaEvolutionInput {
  recentPerformance: AgentPerformance[];
  recentDiscoveryReports: DiscoveryReportSummary[];
  recentReflections: ReflectionLessonSummary[];
}

export interface ProposalItem {
  type: 'add' | 'modify' | 'deprecate';
  agentName: string;
  role: string;
  reasoning: string;
  expectedImprovement: string;
  /** add のときのみ設定される */
  initialPrompt?: string;
}

export interface AgentRestructureProposal {
  proposedAt: Date;
  analysis: {
    currentAgents: string[];
    coverageGaps: string[];
    underperformers: string[];
  };
  proposals: ProposalItem[];
  confidence: number;
}

/** 提案実行時の人間承認情報。CLI ユーザー名などを記録する。 */
export interface HumanApproval {
  approvedBy: string;
  approvedAt: Date;
  notes?: string;
}

export interface ExecuteProposalResult {
  applied: string[];
  skipped: Array<{ proposal: ProposalItem; reason: string }>;
}

/** 月あたり新規エージェント追加上限。§3.3.4。 */
export const MONTHLY_ADD_LIMIT = 1;

let defaultPrisma: PrismaClient | null = null;
function getDefaultPrisma(): PrismaClient {
  if (!defaultPrisma) defaultPrisma = new PrismaClient();
  return defaultPrisma;
}

async function withRetries<T>(fn: () => Promise<T>, times = 3): Promise<T | null> {
  let last: unknown;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
    }
  }
  console.error('[MetaEvolutionAgent] リトライ尽くし', last);
  return null;
}

/**
 * Phase 6 hotfix: `extractJson` 経由で 3 段階 fallback (raw → fence → bracket) を使う。
 * 応答が max_tokens で打ち切られ Unterminated string になった場合は null を返す。
 */
function parseProposalJson(content: string): AgentRestructureProposal | null {
  const extracted = extractJson(content);
  if (!extracted.ok) return null;
  return normalizeProposal(extracted.data);
}

function normalizeProposal(raw: unknown): AgentRestructureProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const analysisRaw = (r.analysis ?? {}) as Record<string, unknown>;
  const analysis = {
    currentAgents: toStringArray(analysisRaw.currentAgents),
    coverageGaps: toStringArray(analysisRaw.coverageGaps),
    underperformers: toStringArray(analysisRaw.underperformers),
  };
  const proposalsRaw = Array.isArray(r.proposals) ? r.proposals : [];
  const proposals: ProposalItem[] = [];
  for (const p of proposalsRaw) {
    if (!p || typeof p !== 'object') continue;
    const pr = p as Record<string, unknown>;
    if (
      typeof pr.type !== 'string' ||
      !['add', 'modify', 'deprecate'].includes(pr.type)
    )
      continue;
    if (typeof pr.agentName !== 'string' || pr.agentName.length === 0) continue;
    const item: ProposalItem = {
      type: pr.type as ProposalItem['type'],
      agentName: pr.agentName,
      role: typeof pr.role === 'string' ? pr.role : '',
      reasoning: typeof pr.reasoning === 'string' ? pr.reasoning : '',
      expectedImprovement:
        typeof pr.expectedImprovement === 'string' ? pr.expectedImprovement : '',
      ...(typeof pr.initialPrompt === 'string'
        ? { initialPrompt: pr.initialPrompt }
        : {}),
    };
    // add なのに initialPrompt が空 / 短すぎるものは弾く(安全装置)
    if (item.type === 'add' && (!item.initialPrompt || item.initialPrompt.length < 50)) {
      continue;
    }
    proposals.push(item);
  }
  const confidence = typeof r.confidence === 'number' ? clamp01(r.confidence) : 0.3;
  return {
    proposedAt: new Date(),
    analysis,
    proposals,
    confidence,
  };
}

function toStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter((v): v is string => typeof v === 'string');
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export interface MetaEvolutionAgentOptions {
  ai?: AIProvider;
  prisma?: PrismaClient;
  registry?: PromptRegistry;
}

export class MetaEvolutionAgent {
  private readonly ai: AIProvider;
  private readonly prisma: PrismaClient;
  private readonly registry: PromptRegistry;

  constructor(options: MetaEvolutionAgentOptions = {}) {
    this.ai = options.ai ?? new AIProvider({ model: modelFor('meta_evolution') });
    this.prisma = options.prisma ?? getDefaultPrisma();
    this.registry = options.registry ?? new PromptRegistry(this.prisma);
  }

  /**
   * 再編成提案を LLM に生成させる。
   * 永続化は `recordProposal` で別ステップとして行う(純粋性を保つため)。
   * 失敗時は null。
   */
  async propose(input: MetaEvolutionInput): Promise<AgentRestructureProposal | null> {
    const system = loadPromptWithGlobal('meta_evolution');
    const user = this.buildUserPrompt(input);

    const res = await withRetries(() =>
      this.ai.chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ] as ChatMessage[],
        { temperature: 0.4, maxTokens: 4096 },
      ),
    );
    if (!res?.content) return null;
    return parseProposalJson(res.content);
  }

  /**
   * 提案を DB に永続化する。ステータス='pending' で記録。
   * 返り値: 作成された AgentRestructureProposal.id
   */
  async recordProposal(proposal: AgentRestructureProposal): Promise<string> {
    const row = await this.prisma.agentRestructureProposal.create({
      data: {
        proposal: proposal as unknown as object,
        confidence: proposal.confidence,
        status: 'pending',
      },
    });
    return row.id;
  }

  /**
   * 承認された提案を実行する。人間承認が **必須**。
   *
   * 安全装置:
   * - `add` 提案は月あたり最大 1 件(MONTHLY_ADD_LIMIT)
   * - `deprecate` 提案は全て skipped に回す(このメソッドでは絶対に自動化しない)
   * - `modify` 提案はログに記録するのみで実行はしない(プロンプト改修は PromptMutationAgent 側の責務)
   *
   * 実行結果は AgentRestructureProposal テーブルに executionResult として保存される。
   */
  async executeProposal(
    proposalId: string,
    approval: HumanApproval,
  ): Promise<ExecuteProposalResult> {
    const row = await this.prisma.agentRestructureProposal.findUniqueOrThrow({
      where: { id: proposalId },
    });
    if (row.status !== 'pending' && row.status !== 'approved') {
      throw new Error(
        `executeProposal: 既に処理済みの提案です (status=${row.status}, id=${proposalId})`,
      );
    }
    const parsed = row.proposal as unknown as AgentRestructureProposal;

    const result: ExecuteProposalResult = { applied: [], skipped: [] };

    // 月あたり追加上限チェック
    const addsUsedThisMonth = await this.countAddsThisMonth();
    let remainingAddBudget = Math.max(0, MONTHLY_ADD_LIMIT - addsUsedThisMonth);

    for (const p of parsed.proposals ?? []) {
      // Phase 6.7a/6.7c: グローバル・専門家共通テンプレは自動変更不可
      if (p.agentName === GLOBAL_AGENT_NAME) {
        result.skipped.push({
          proposal: p,
          reason: `${GLOBAL_AGENT_NAME} はグローバルルール予約識別子のため自動変更不可`,
        });
        continue;
      }
      if (p.agentName === SPECIALIST_COMMON_AGENT_NAME) {
        result.skipped.push({
          proposal: p,
          reason: `${SPECIALIST_COMMON_AGENT_NAME} は専門家共通テンプレ予約のため自動変更不可`,
        });
        continue;
      }
      if (p.type === 'deprecate') {
        result.skipped.push({
          proposal: p,
          reason: 'deprecate は自動実行しない(人間が個別に PromptRegistry.deprecate を呼ぶこと)',
        });
        continue;
      }
      if (p.type === 'modify') {
        result.skipped.push({
          proposal: p,
          reason: 'modify は PromptMutationAgent + approveCli で対応する',
        });
        continue;
      }
      if (p.type === 'add') {
        if (remainingAddBudget <= 0) {
          result.skipped.push({
            proposal: p,
            reason: `月あたり追加上限 (${MONTHLY_ADD_LIMIT}) に到達済み (today=${addsUsedThisMonth})`,
          });
          continue;
        }
        if (!p.initialPrompt) {
          result.skipped.push({ proposal: p, reason: 'initialPrompt が空のためスキップ' });
          continue;
        }
        try {
          await this.registry.registerNewAgent(p.agentName, {
            agentName: p.agentName,
            version: 'initial-meta',
            content: p.initialPrompt,
            createdBy: 'meta_evolution',
            notes: `role: ${p.role}\nreasoning: ${p.reasoning}\nexpectedImprovement: ${p.expectedImprovement}`,
            status: 'active',
          });
          result.applied.push(p.agentName);
          remainingAddBudget--;
        } catch (err) {
          result.skipped.push({
            proposal: p,
            reason: `registerNewAgent 失敗: ${fmtErr(err)}`,
          });
        }
      }
    }

    await this.prisma.agentRestructureProposal.update({
      where: { id: proposalId },
      data: {
        status: 'executed',
        approvedBy: approval.approvedBy,
        approvedAt: approval.approvedAt,
        approvalNotes: approval.notes,
        executedAt: new Date(),
        executionResult: {
          applied: result.applied,
          skipped: result.skipped.map((s) => ({
            agentName: s.proposal.agentName,
            type: s.proposal.type,
            reason: s.reason,
          })),
        },
      },
    });

    return result;
  }

  /**
   * 人間が明示的に rejected にするための便宜メソッド。
   */
  async rejectProposal(proposalId: string, approval: HumanApproval): Promise<void> {
    await this.prisma.agentRestructureProposal.update({
      where: { id: proposalId },
      data: {
        status: 'rejected',
        approvedBy: approval.approvedBy,
        approvedAt: approval.approvedAt,
        approvalNotes: approval.notes,
      },
    });
  }

  private async countAddsThisMonth(): Promise<number> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const rows = await this.prisma.agentRestructureProposal.findMany({
      where: {
        status: 'executed',
        executedAt: { gte: monthStart },
      },
      select: { executionResult: true },
    });
    let count = 0;
    for (const r of rows) {
      const er = (r.executionResult ?? {}) as { applied?: string[] };
      if (Array.isArray(er.applied)) count += er.applied.length;
    }
    return count;
  }

  private buildUserPrompt(input: MetaEvolutionInput): string {
    const perfDump = input.recentPerformance
      .map(
        (p) =>
          `- ${p.agentName}: avgScore=${p.avgScore.toFixed(3)}, usage=${p.usageCount}, success=${p.successCount}`,
      )
      .join('\n');
    const discoveryDump =
      input.recentDiscoveryReports.length === 0
        ? '(なし)'
        : input.recentDiscoveryReports
            .slice(0, 8)
            .map(
              (d) =>
                `- [${d.weekStart}] topLenses=${d.topLenses.join(',')}, keyFindings=${d.keyFindings.join(' / ')}`,
            )
            .join('\n');
    const reflectionDump =
      input.recentReflections.length === 0
        ? '(なし)'
        : input.recentReflections
            .slice(0, 15)
            .map((r) => `- [${r.recordedAt}]${r.source ? ` (${r.source})` : ''} ${r.lesson}`)
            .join('\n');

    return `# エージェント構成再編成リクエスト

## 現在のエージェント成績
${perfDump || '(データなし)'}

## 直近の Discovery レポート要約
${discoveryDump}

## 直近の Reflection 学び
${reflectionDump}

## 依頼
システムプロンプトで指定された形式の JSON オブジェクトだけを返してください。
月あたり add 提案は最大 1 件。deprecate 提案は最終手段として慎重に。`;
  }
}

function fmtErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
