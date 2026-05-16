/**
 * StrategyDraft リポジトリ
 *
 * StrategyDraft の Prisma 操作を閉じ込める。
 * 状態遷移 / 重複排除 / 承認判定は呼び出し側 (StrategyDraftService) の責務。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §9 (Phase 4.2)
 */

import type {
  PrismaClient,
  StrategyDraft,
  StrategyDraftStatus,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../backend/db/client';

type DraftPrisma = Pick<PrismaClient, 'strategyDraft'>;

/**
 * Repository factory.
 *
 * production では `defaultPrisma` を使うが、test では `DraftPrisma` 互換オブジェクトを
 * 渡せるようにする。
 */
export function createStrategyDraftRepository(client: DraftPrisma = defaultPrisma) {
  return {
    /**
     * 新規 StrategyDraft を作成する。
     * `candidateHash` 衝突時は Prisma の P2002 を上位に伝播 (Service 層で
     * 既存 Draft を返すか throw するかを決める)。
     */
    async createDraft(input: {
      sourceRunId: string;
      sourceStepId: string;
      candidateHash: string;
      strategySummary: string;
      riskSummary?: string | null;
    }): Promise<StrategyDraft> {
      return client.strategyDraft.create({
        data: {
          sourceRunId: input.sourceRunId,
          sourceStepId: input.sourceStepId,
          candidateHash: input.candidateHash,
          strategySummary: input.strategySummary,
          riskSummary: input.riskSummary,
        },
      });
    },

    /**
     * candidateHash から既存 Draft を検索する。
     */
    async findByCandidateHash(candidateHash: string): Promise<StrategyDraft | null> {
      return client.strategyDraft.findUnique({
        where: { candidateHash },
      });
    },

    /**
     * id から Draft を取得する。
     */
    async findById(draftId: string): Promise<StrategyDraft | null> {
      return client.strategyDraft.findUnique({
        where: { id: draftId },
      });
    },

    /**
     * status / reason / validation 関連 field を更新する。
     * 状態遷移チェックは Service 層の責務。
     */
    async updateDraft(
      draftId: string,
      patch: {
        status?: StrategyDraftStatus;
        approvalReason?: string | null;
        rejectionReason?: string | null;
        archiveReason?: string | null;
        reviewer?: string | null;
        validatedAt?: Date | null;
        validationResultId?: string | null;
      },
    ): Promise<StrategyDraft> {
      return client.strategyDraft.update({
        where: { id: draftId },
        data: patch,
      });
    },

    /**
     * 期待 status との一致を条件付きで更新する (TOCTOU 解消)。
     * 並行操作で先に他の遷移が完了した場合 count=0 を返し、Service 側で
     * StrategyDraftStateError に変換される設計。
     *
     * 戻り値: 更新後の Draft (一致した場合) または null (期待 status と
     * 一致せず更新されなかった場合)。
     */
    async updateDraftIfStatus(
      draftId: string,
      expectedStatus: StrategyDraftStatus,
      patch: {
        status?: StrategyDraftStatus;
        approvalReason?: string | null;
        rejectionReason?: string | null;
        archiveReason?: string | null;
        reviewer?: string | null;
        validatedAt?: Date | null;
        validationResultId?: string | null;
      },
    ): Promise<StrategyDraft | null> {
      const updateResult = await client.strategyDraft.updateMany({
        where: { id: draftId, status: expectedStatus },
        data: patch,
      });
      if (updateResult.count !== 1) {
        return null;
      }
      return client.strategyDraft.findUnique({ where: { id: draftId } });
    },

    /**
     * status 別の Draft 一覧 (UI / 調査用)。新しい順。
     */
    async listByStatus(
      status: StrategyDraftStatus,
      limit = 50,
    ): Promise<StrategyDraft[]> {
      return client.strategyDraft.findMany({
        where: { status },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    },
  };
}

export type StrategyDraftRepository = ReturnType<typeof createStrategyDraftRepository>;
