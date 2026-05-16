/**
 * StrategyDraftService
 *
 * Evolution 候補の Draft lifecycle を管理する。Evolution Job → Validation Job への
 * 直行を防ぎ、業務境界 (承認 / 却下 / Validation 投入) を一箇所に集約する。
 *
 * 責務:
 *   - Evolution 候補を Draft 化 (createFromEvolutionCandidate)
 *   - candidateHash で重複排除 (dedupeDraft)
 *   - 承認 / 却下 / Validation 投入 / Validated / Archive の lifecycle 遷移
 *   - WBS §1.3 の状態遷移ルールを強制
 *   - 入力境界での Zod ランタイム検証 (PR #220 Copilot review #4 対応)
 *   - TOCTOU 解消のための DB 条件付き更新 (PR #220 Copilot review #5/6 対応)
 *   - redaction (raw payload を保存しない)
 *
 * 持たない責務:
 *   - ADK orchestration (= ADK Orchestrator Wrapper)
 *   - AgentRunStep の汎用 CRUD (= RunLedgerService)
 *   - ADK SDK への直接依存 (WBS §17)
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §9 (Phase 4)
 */

import { z } from 'zod';
import type { StrategyDraft, StrategyDraftStatus } from '@prisma/client';
import {
  createStrategyDraftRepository,
  type StrategyDraftRepository,
} from '../repositories/strategyDraftRepository';
import { redactSummary, redactErrorMessage } from './runLedgerRedaction';

// ============================================================
// 状態遷移ルール (WBS §1.3)
// ============================================================

/** StrategyDraft の許可遷移マップ */
const DRAFT_TRANSITIONS: Readonly<
  Record<StrategyDraftStatus, ReadonlyArray<StrategyDraftStatus>>
> = {
  draft: ['approved', 'rejected', 'archived'],
  approved: ['queued_for_validation', 'archived'],
  queued_for_validation: ['validated', 'rejected', 'archived'],
  validated: ['archived'],
  rejected: ['archived'],
  archived: [],
};

/** Draft 状態遷移が許可されているかをチェックする純関数 */
export function canTransitionDraft(
  from: StrategyDraftStatus,
  to: StrategyDraftStatus,
): boolean {
  if (from === to) return false;
  return DRAFT_TRANSITIONS[from].includes(to);
}

/**
 * 期待 status の集合 (canTransition で「to」へ遷移可能な「from」状態すべて) を返す純関数。
 * 条件付き更新で「現在 status が想定範囲内」を確認するのに使う。
 */
function statesAllowedToTransitionTo(
  to: StrategyDraftStatus,
): ReadonlyArray<StrategyDraftStatus> {
  const allowed: StrategyDraftStatus[] = [];
  for (const from of Object.keys(DRAFT_TRANSITIONS) as StrategyDraftStatus[]) {
    if (canTransitionDraft(from, to)) {
      allowed.push(from);
    }
  }
  return allowed;
}

/** Draft 状態遷移違反 / 不正操作のエラー */
export class StrategyDraftStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrategyDraftStateError';
  }
}

// ============================================================
// 入力境界 Zod schema (PR #220 Copilot review #4 対応)
// ============================================================

/**
 * Service の入力境界で受ける Zod schema 群。type interface ではなく schema を
 * 一次定義として持ち、`z.infer` で型を派生させる (AGENTS.md §3.5)。
 */
export const EvolutionCandidateInputSchema = z.object({
  /** 候補の同一性ハッシュ。短すぎ / 長すぎを弾く (sha256 hex 64 文字を含む幅) */
  candidateHash: z.string().min(8).max(256),
  /** 戦略の人間語要約 (空白のみ / 空文字は拒否) */
  strategySummary: z.string().min(1),
  /** リスク要約 (任意) */
  riskSummary: z.string().nullish(),
});
export type EvolutionCandidateInput = z.infer<typeof EvolutionCandidateInputSchema>;

export const EvolutionCandidateContextSchema = z.object({
  sourceRunId: z.string().uuid(),
  sourceStepId: z.string().uuid(),
});
export type EvolutionCandidateContext = z.infer<typeof EvolutionCandidateContextSchema>;

const NonEmptyReasonSchema = z.string().trim().min(1, '理由 (reason) は空文字 / 空白のみ不可');
const ReviewerSchema = z.string().trim().min(1, 'reviewer は空文字 / 空白のみ不可').max(128);

/** createFromEvolutionCandidate の戻り値 */
export type CreateDraftResult =
  | { kind: 'created'; draft: StrategyDraft }
  | { kind: 'duplicate'; existing: StrategyDraft };

// ============================================================
// Service API
// ============================================================

export function createStrategyDraftService(options?: {
  repository?: StrategyDraftRepository;
  clock?: () => Date;
}) {
  const repository = options?.repository ?? createStrategyDraftRepository();
  const clock = options?.clock ?? (() => new Date());

  /**
   * Evolution 候補から Draft を作る。
   *
   * 入力は EvolutionCandidateInputSchema / ContextSchema で safeParse される。
   * candidateHash が既に存在する場合は新規作成せず、`kind: 'duplicate'` を返す。
   * 並行呼び出しによる unique 違反は createDraft 試行直前に絞った try/catch で
   * 再検索する (P2002 等のみを拾い、入力エラーは漏れない設計)。
   */
  async function createFromEvolutionCandidate(
    rawCandidate: EvolutionCandidateInput,
    rawContext: EvolutionCandidateContext,
  ): Promise<CreateDraftResult> {
    const candidate = EvolutionCandidateInputSchema.parse(rawCandidate);
    const context = EvolutionCandidateContextSchema.parse(rawContext);

    const existing = await repository.findByCandidateHash(candidate.candidateHash);
    if (existing) {
      return { kind: 'duplicate', existing };
    }

    const summary = redactSummary(candidate.strategySummary);
    if (summary === null) {
      // Zod の min(1) で空文字は弾くが、redaction 後に null になるケース (全角空白 + trim 等) も拒否。
      throw new StrategyDraftStateError(
        'strategySummary の redaction 結果が null (空文字 / 空白のみ不可)',
      );
    }
    const riskSummary = redactSummary(candidate.riskSummary ?? null);

    // race 安全のため、createDraft の呼び出しのみを try/catch で囲む。
    // requireSummary / redaction の入力エラーは catch の対象外で、原因がそのまま伝播する。
    try {
      const draft = await repository.createDraft({
        sourceRunId: context.sourceRunId,
        sourceStepId: context.sourceStepId,
        candidateHash: candidate.candidateHash,
        strategySummary: summary,
        riskSummary,
      });
      return { kind: 'created', draft };
    } catch (createError) {
      // catch 直後で同一 hash 再検索。並行作成された Draft が見つかれば duplicate 扱い。
      // 見つからなければ createError をそのまま再 throw (Prisma 接続エラー等の本物の DB 障害)。
      const raced = await repository.findByCandidateHash(candidate.candidateHash);
      if (raced) {
        return { kind: 'duplicate', existing: raced };
      }
      throw createError;
    }
  }

  /** Draft を承認状態に遷移させる */
  async function approveDraft(
    draftId: string,
    rawReviewer: string,
    reason?: string,
  ): Promise<StrategyDraft> {
    const reviewer = ReviewerSchema.parse(rawReviewer);
    return transitionWithCondition(draftId, 'approved', {
      status: 'approved',
      reviewer,
      approvalReason: redactSummary(reason ?? null),
    });
  }

  /**
   * Draft を却下状態に遷移させる。理由 (reason) は必須・空文字不可。
   */
  async function rejectDraft(
    draftId: string,
    rawReviewer: string,
    rawReason: string,
  ): Promise<StrategyDraft> {
    const reviewer = ReviewerSchema.parse(rawReviewer);
    const reason = NonEmptyReasonSchema.parse(rawReason);
    const redactedReason = redactErrorMessage(reason);
    if (redactedReason === null) {
      throw new StrategyDraftStateError('rejection reason の redaction 結果が null');
    }
    return transitionWithCondition(draftId, 'rejected', {
      status: 'rejected',
      reviewer,
      rejectionReason: redactedReason,
    });
  }

  /**
   * 承認済み Draft を Validation 投入キューに乗せる。
   * 状態遷移: approved → queued_for_validation
   */
  async function queueForValidation(draftId: string): Promise<StrategyDraft> {
    return transitionWithCondition(draftId, 'queued_for_validation', {
      status: 'queued_for_validation',
    });
  }

  /**
   * 検証結果を紐付けて validated に遷移する。
   * 状態遷移: queued_for_validation → validated
   */
  async function markValidated(
    draftId: string,
    validationResultId?: string,
  ): Promise<StrategyDraft> {
    return transitionWithCondition(draftId, 'validated', {
      status: 'validated',
      validatedAt: clock(),
      validationResultId: validationResultId ?? null,
    });
  }

  /**
   * Draft を archive する。理由 (reason) は必須・空文字不可。
   * 状態遷移マップ上は archived から戻れない (終端)。
   */
  async function archiveDraft(
    draftId: string,
    rawReason: string,
  ): Promise<StrategyDraft> {
    const reason = NonEmptyReasonSchema.parse(rawReason);
    const redactedReason = redactSummary(reason);
    if (redactedReason === null) {
      throw new StrategyDraftStateError('archive reason の redaction 結果が null');
    }
    return transitionWithCondition(draftId, 'archived', {
      status: 'archived',
      archiveReason: redactedReason,
    });
  }

  /** status 別の一覧を返す (UI 用) */
  async function listByStatus(
    status: StrategyDraftStatus,
    limit?: number,
  ): Promise<StrategyDraft[]> {
    return repository.listByStatus(status, limit);
  }

  /** id で Draft を取得する */
  async function findById(draftId: string): Promise<StrategyDraft | null> {
    return repository.findById(draftId);
  }

  // ----- internal helpers -----

  /**
   * TOCTOU 安全な状態遷移。
   *
   * 「to へ遷移可能な from 状態」の集合を計算し、その中の各候補で updateDraftIfStatus
   * を呼ぶ。一致したものがあればそれが更新後 Draft、なければ「現在 status が遷移不可」
   * として StrategyDraftStateError を throw する。
   *
   * Prisma の updateMany({ where: { id, status: expectedStatus } }) で count=1 を
   * 確認することで、並行操作による上書きを構造的に防ぐ (Copilot review #5/6 対応)。
   */
  async function transitionWithCondition(
    draftId: string,
    to: StrategyDraftStatus,
    patch: Parameters<StrategyDraftRepository['updateDraftIfStatus']>[2],
  ): Promise<StrategyDraft> {
    const allowedFroms = statesAllowedToTransitionTo(to);
    if (allowedFroms.length === 0) {
      throw new StrategyDraftStateError(`to=${to} は遷移先として未定義`);
    }

    for (const from of allowedFroms) {
      const updated = await repository.updateDraftIfStatus(draftId, from, patch);
      if (updated) return updated;
    }

    // どの from でも一致しなかった: 存在しない / 終端 / 並行操作で別状態に遷移済み。
    const current = await repository.findById(draftId);
    if (!current) {
      throw new StrategyDraftStateError(`StrategyDraft(id=${draftId}) が存在しない`);
    }
    throw new StrategyDraftStateError(
      `不正な Draft 状態遷移: ${current.status} -> ${to} (draftId=${draftId})`,
    );
  }

  return {
    createFromEvolutionCandidate,
    approveDraft,
    rejectDraft,
    queueForValidation,
    markValidated,
    archiveDraft,
    listByStatus,
    findById,
  };
}

export type StrategyDraftService = ReturnType<typeof createStrategyDraftService>;
