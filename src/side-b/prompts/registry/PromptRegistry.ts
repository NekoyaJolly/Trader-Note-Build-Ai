/**
 * Phase 6: PromptRegistry
 *
 * エージェントのシステムプロンプトをバージョン管理する中央台帳。
 * Prisma の PromptVersion テーブルを永続化層とし、
 * 月次プロンプト進化 / A/B テスト / 人間承認フローの基盤として利用する。
 *
 * 設計原則:
 * - agentName は列挙型で固定しない(将来 MetaEvolutionAgent が新エージェントを追加する)
 * - active は 1 エージェント 1 件(promote() 時に既存 active を deprecated に自動遷移)
 * - 使用成績集計は recordUsage() で逐次更新(avgScore は単純平均)
 * - 握りつぶし禁止: エラーは呼び出し側に伝播
 */

import { PrismaClient } from '@prisma/client';
import type {
  PromptVersion,
  PromptStatus,
  RegisterPromptInput,
  RecordUsageInput,
} from './types';
import { expandMacros, type PromptMacros } from '../loader';

/**
 * Phase 6.7a: グローバルルール専用の特殊 agentName。
 *
 * - `__global__` は全エージェント共通のプロンプトで、実エージェントとしては扱わない
 * - PromptMutationAgent / MetaEvolutionAgent は本定数を使って変異・再編成対象から除外する
 * - seed.ts が initial を投入
 */
export const GLOBAL_AGENT_NAME = '__global__';

/**
 * 既定の Prisma シングルトン(テストで差し替え可)。
 *
 * 遅延初期化:
 *   `new PromptRegistry()` をモジュールロード時に実行しても、`PrismaClient` は
 *   ここでは生成されない。最初の DB 操作(getActive 等)で初めて生成される。
 *   そのため DB 設定が不要なユニットテスト / 型チェックでは副作用ゼロ。
 */
let defaultPrisma: PrismaClient | null = null;

function getDefaultPrisma(): PrismaClient {
  if (!defaultPrisma) {
    defaultPrisma = new PrismaClient();
  }
  return defaultPrisma;
}

/** Prisma 行 → アプリ層型への変換。 */
function toDomain(row: {
  id: string;
  agentName: string;
  version: string;
  content: string;
  parentVersionId: string | null;
  createdBy: string;
  status: string;
  notes: string | null;
  usageCount: number;
  successCount: number;
  avgScore: number;
  lastUsedAt: Date | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PromptVersion {
  return {
    id: row.id,
    agentName: row.agentName,
    version: row.version,
    content: row.content,
    parentVersionId: row.parentVersionId ?? undefined,
    createdBy: row.createdBy as PromptVersion['createdBy'],
    status: row.status as PromptStatus,
    notes: row.notes ?? undefined,
    usageCount: row.usageCount,
    successCount: row.successCount,
    avgScore: row.avgScore,
    lastUsedAt: row.lastUsedAt ?? undefined,
    approvedAt: row.approvedAt ?? undefined,
    approvedBy: row.approvedBy ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PromptRegistry {
  private readonly prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma ?? getDefaultPrisma();
  }

  /** 新しいプロンプトバージョンを登録する。既定ステータスは 'experimental'。 */
  async register(input: RegisterPromptInput): Promise<PromptVersion> {
    const row = await this.prisma.promptVersion.create({
      data: {
        agentName: input.agentName,
        version: input.version,
        content: input.content,
        parentVersionId: input.parentVersionId,
        createdBy: input.createdBy,
        status: input.status ?? 'experimental',
        notes: input.notes,
      },
    });
    return toDomain(row);
  }

  /** エージェントの active プロンプトを取得する(なければ null)。 */
  async getActive(agentName: string): Promise<PromptVersion | null> {
    const row = await this.prisma.promptVersion.findFirst({
      where: { agentName, status: 'active' },
      orderBy: { updatedAt: 'desc' },
    });
    return row ? toDomain(row) : null;
  }

  /** active が存在することを前提に取得(存在しなければ例外)。 */
  async getActiveOrThrow(agentName: string): Promise<PromptVersion> {
    const active = await this.getActive(agentName);
    if (!active) {
      throw new Error(`No active prompt for agent="${agentName}"`);
    }
    return active;
  }

  /**
   * Phase 6.7a: グローバル + エージェント固有プロンプトを合成して返す(C案)。
   *
   * 取得内容:
   *   `${global content(macros 展開後)}\n\n${agent content(macros 展開後)}`
   *
   * フォールバック挙動(安全側):
   *   - `__global__` の active が存在しない → グローバル部分を空文字で合成し、agent content のみ返す
   *     (seed 未実施のローカル開発/テスト環境で落ちないようにする)
   *   - 指定 agent の active が存在しない → 例外(従来の getActiveOrThrow と同じ動作)
   *
   * マクロ展開:
   *   global / agent の両方の content に同じ macros 辞書を適用する。
   *   Registry に保存された content がファイルのマクロプレースホルダーを
   *   そのまま保持していた場合に、ここで展開する。
   */
  async getCompositeActive(
    agentName: string,
    macros?: PromptMacros,
  ): Promise<string> {
    if (agentName === GLOBAL_AGENT_NAME) {
      throw new Error(
        `getCompositeActive: ${GLOBAL_AGENT_NAME} を通常エージェントとして取得できない。getActive を使うこと`,
      );
    }
    const [globalPrompt, localPrompt] = await Promise.all([
      this.getActive(GLOBAL_AGENT_NAME),
      this.getActiveOrThrow(agentName),
    ]);

    const localExpanded = expandMacros(localPrompt.content, macros);
    if (!globalPrompt) {
      console.warn(
        `[PromptRegistry] ${GLOBAL_AGENT_NAME} active が存在しません。agent=${agentName} 単独で返します`,
      );
      return localExpanded;
    }
    const globalExpanded = expandMacros(globalPrompt.content, macros);
    return `${globalExpanded}\n\n${localExpanded}`;
  }

  /** エージェントの experimental プロンプト一覧。 */
  async getExperimental(agentName: string): Promise<PromptVersion[]> {
    const rows = await this.prisma.promptVersion.findMany({
      where: { agentName, status: 'experimental' },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDomain);
  }

  /** ID でプロンプトを取得(存在しなければ null)。 */
  async getById(id: string): Promise<PromptVersion | null> {
    const row = await this.prisma.promptVersion.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  /**
   * 使用成績を記録する。
   * avgScore は単純平均で逐次更新:
   *   new = (old * usageCount + score) / (usageCount + 1)
   */
  async recordUsage(versionId: string, input: RecordUsageInput): Promise<PromptVersion> {
    const current = await this.prisma.promptVersion.findUniqueOrThrow({
      where: { id: versionId },
    });
    const newUsageCount = current.usageCount + 1;
    const newAvgScore =
      (current.avgScore * current.usageCount + input.score) / newUsageCount;
    const row = await this.prisma.promptVersion.update({
      where: { id: versionId },
      data: {
        usageCount: newUsageCount,
        successCount: current.successCount + (input.success ? 1 : 0),
        avgScore: newAvgScore,
        lastUsedAt: new Date(),
      },
    });
    return toDomain(row);
  }

  /**
   * experimental → active 昇格。既存 active は deprecated に遷移させる。
   * 人間承認フロー経由でのみ呼ぶこと(CLI から起動する想定)。
   */
  async promote(
    versionId: string,
    approval: { approvedBy: string; notes?: string },
  ): Promise<PromptVersion> {
    const target = await this.prisma.promptVersion.findUniqueOrThrow({
      where: { id: versionId },
    });
    if (target.status !== 'experimental') {
      throw new Error(
        `promote: only experimental can be promoted, got status="${target.status}" for id=${versionId}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 既存 active を deprecated に
      await tx.promptVersion.updateMany({
        where: { agentName: target.agentName, status: 'active' },
        data: { status: 'deprecated' },
      });
      const updated = await tx.promptVersion.update({
        where: { id: versionId },
        data: {
          status: 'active',
          approvedAt: new Date(),
          approvedBy: approval.approvedBy,
          notes: approval.notes ?? target.notes,
        },
      });
      return toDomain(updated);
    });
  }

  /** active → deprecated。安全装置: 必ず別 active が存在してから呼ぶこと。 */
  async deprecate(versionId: string, reason?: string): Promise<PromptVersion> {
    const row = await this.prisma.promptVersion.update({
      where: { id: versionId },
      data: {
        status: 'deprecated',
        notes: reason,
      },
    });
    return toDomain(row);
  }

  /** experimental → rejected(成績不振などによる即時中止)。 */
  async reject(versionId: string, reason: string): Promise<PromptVersion> {
    const row = await this.prisma.promptVersion.update({
      where: { id: versionId },
      data: {
        status: 'rejected',
        notes: reason,
      },
    });
    return toDomain(row);
  }

  /**
   * 動的エージェント追加(MetaEvolutionAgent 用)。
   * 初期プロンプトを active として登録する。
   * 既に同エージェントの active が存在する場合は例外。
   */
  async registerNewAgent(
    agentName: string,
    initialPrompt: RegisterPromptInput,
  ): Promise<PromptVersion> {
    if (initialPrompt.agentName !== agentName) {
      throw new Error(
        `registerNewAgent: agentName mismatch (arg=${agentName}, input=${initialPrompt.agentName})`,
      );
    }
    const existing = await this.getActive(agentName);
    if (existing) {
      throw new Error(
        `registerNewAgent: agent "${agentName}" already has active prompt (id=${existing.id})`,
      );
    }
    return this.register({ ...initialPrompt, status: 'active' });
  }

  /** 登録されているエージェント名の一覧(重複排除)。 */
  async listAgents(): Promise<string[]> {
    const rows = await this.prisma.promptVersion.findMany({
      select: { agentName: true },
      distinct: ['agentName'],
      orderBy: { agentName: 'asc' },
    });
    return rows.map((r) => r.agentName);
  }

  /** active + experimental の全バリアントを返す(A/B テスト用)。 */
  async listActiveAndExperimental(agentName: string): Promise<PromptVersion[]> {
    const rows = await this.prisma.promptVersion.findMany({
      where: {
        agentName,
        status: { in: ['active', 'experimental'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDomain);
  }
}

/** 既定の共有レジストリ(テストでは new PromptRegistry(prisma) を渡す)。 */
export const promptRegistry = new PromptRegistry();
