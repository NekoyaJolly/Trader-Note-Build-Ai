/**
 * RunLedger リポジトリ
 *
 * AgentRun / AgentRunStep の Prisma 操作を閉じ込める。
 * 状態遷移ルールや冪等性は呼び出し側 (RunLedgerService) で保証する責務。
 * このファイルは「言われた通り DB を読み書きする」だけ。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §7 (Phase 2.1)
 */

import type {
  PrismaClient,
  AgentRun,
  AgentRunStep,
  AgentRunStatus,
  AgentRunStepStatus,
  AgentRunStepNextAction,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../backend/db/client';

/** AgentRun / AgentRunStep の Prisma client を最小限に切り出した型 */
type LedgerPrisma = Pick<PrismaClient, 'agentRun' | 'agentRunStep'>;

/**
 * Repository factory.
 *
 * production では `defaultPrisma` を使うが、test では in-memory な
 * `LedgerPrisma` 互換オブジェクトを渡せるようにする。
 */
export function createRunLedgerRepository(client: LedgerPrisma = defaultPrisma) {
  return {
    /**
     * 新規 AgentRun を作成する。`idempotencyKey` 衝突時は Prisma の
     * P2002 (Unique constraint) を上位に伝播させる (Service 層で
     * 既存 run を返すか throw するかを決める)。
     */
    async createRun(input: {
      kind: string;
      triggeredBy: string;
      status?: AgentRunStatus;
      summary?: string | null;
      idempotencyKey?: string | null;
    }): Promise<AgentRun> {
      return client.agentRun.create({
        data: {
          kind: input.kind,
          triggeredBy: input.triggeredBy,
          status: input.status,
          summary: input.summary,
          idempotencyKey: input.idempotencyKey,
        },
      });
    },

    /**
     * idempotencyKey から既存 run を検索する。
     */
    async findRunByIdempotencyKey(idempotencyKey: string): Promise<AgentRun | null> {
      return client.agentRun.findUnique({
        where: { idempotencyKey },
      });
    },

    /**
     * id から run を取得する。
     */
    async findRunById(runId: string): Promise<AgentRun | null> {
      return client.agentRun.findUnique({
        where: { id: runId },
      });
    },

    /**
     * AgentRun の status / finishedAt / summary / error を更新する。
     * 状態遷移チェックは Service 層の責務。
     */
    async updateRun(
      runId: string,
      patch: {
        status?: AgentRunStatus;
        finishedAt?: Date | null;
        summary?: string | null;
        errorCode?: string | null;
        errorMessage?: string | null;
      },
    ): Promise<AgentRun> {
      return client.agentRun.update({
        where: { id: runId },
        data: patch,
      });
    },

    /**
     * 新規 AgentRunStep を作成する。
     * `runId + stepName + attempt` 衝突時は P2002 を伝播。
     */
    async createStep(input: {
      runId: string;
      stepName: string;
      attempt: number;
      status?: AgentRunStepStatus;
      traceKind?: string | null;
    }): Promise<AgentRunStep> {
      return client.agentRunStep.create({
        data: {
          runId: input.runId,
          stepName: input.stepName,
          attempt: input.attempt,
          status: input.status,
          traceKind: input.traceKind,
        },
      });
    },

    /**
     * 同一 runId + stepName の最新 attempt を取得する。
     * 存在しない場合は null。retry 時の次 attempt 番号を決めるのに使う。
     */
    async findLatestStep(
      runId: string,
      stepName: string,
    ): Promise<AgentRunStep | null> {
      return client.agentRunStep.findFirst({
        where: { runId, stepName },
        orderBy: { attempt: 'desc' },
      });
    },

    /**
     * AgentRunStep の status / finishedAt / summary / error / nextAction を更新する。
     */
    async updateStep(
      stepId: string,
      patch: {
        status?: AgentRunStepStatus;
        finishedAt?: Date | null;
        durationMs?: number | null;
        summary?: string | null;
        errorCode?: string | null;
        errorMessage?: string | null;
        nextAction?: AgentRunStepNextAction | null;
      },
    ): Promise<AgentRunStep> {
      return client.agentRunStep.update({
        where: { id: stepId },
        data: patch,
      });
    },

    /**
     * Run + 紐づく Step を時系列順で取得する (UI / 調査用)。
     */
    async findRunWithSteps(
      runId: string,
    ): Promise<(AgentRun & { steps: AgentRunStep[] }) | null> {
      return client.agentRun.findUnique({
        where: { id: runId },
        include: {
          steps: {
            orderBy: [{ startedAt: 'asc' }, { attempt: 'asc' }],
          },
        },
      });
    },

    /**
     * status 別の AgentRun 一覧 (UI / API 用、Phase 9 で追加)。新しい順、limit 上限あり。
     */
    async listRunsByStatus(
      status: AgentRunStatus,
      limit = 50,
    ): Promise<AgentRun[]> {
      return client.agentRun.findMany({
        where: { status },
        orderBy: { startedAt: 'desc' },
        take: limit,
      });
    },
  };
}

export type RunLedgerRepository = ReturnType<typeof createRunLedgerRepository>;
