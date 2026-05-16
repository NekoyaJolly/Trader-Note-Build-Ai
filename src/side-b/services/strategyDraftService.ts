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
 *   - redaction (raw payload を保存しない)
 *
 * 持たない責務:
 *   - ADK orchestration (= ADK Orchestrator Wrapper)
 *   - AgentRunStep の汎用 CRUD (= RunLedgerService)
 *   - ADK SDK への直接依存 (WBS §17)
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §9 (Phase 4)
 */

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

/** Draft 状態遷移違反 / 不正操作のエラー */
export class StrategyDraftStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrategyDraftStateError';
  }
}

/**
 * Evolution 候補。Service の入力境界で受ける形。
 * candidateHash は呼び出し側が DSL から決定論的に算出する想定 (例: sha256(dsl-canonical))。
 */
export interface EvolutionCandidateInput {
  /** 候補の同一性ハッシュ (sha256 hex 等) */
  candidateHash: string;
  /** 戦略の人間語要約 (redaction 済み) */
  strategySummary: string;
  /** リスクの人間語要約 (redaction 済み、任意) */
  riskSummary?: string | null;
}

/**
 * Draft 生成時のコンテキスト (どの run / step から派生したか)。
 */
export interface EvolutionCandidateContext {
  /** 生成元 AgentRun.id */
  sourceRunId: string;
  /** 生成元 AgentRunStep.id (= AgentRunStep.runId と一致する必要あり、DB 複合 FK で強制) */
  sourceStepId: string;
}

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
   * candidateHash が既に存在する場合は新規作成せず、`kind: 'duplicate'` と既存 Draft を返す。
   * 並行呼び出しによる unique 違反 (race) にも対応: createDraft 失敗時に再検索する。
   */
  async function createFromEvolutionCandidate(
    candidate: EvolutionCandidateInput,
    context: EvolutionCandidateContext,
  ): Promise<CreateDraftResult> {
    const existing = await repository.findByCandidateHash(candidate.candidateHash);
    if (existing) {
      return { kind: 'duplicate', existing };
    }

    try {
      const draft = await repository.createDraft({
        sourceRunId: context.sourceRunId,
        sourceStepId: context.sourceStepId,
        candidateHash: candidate.candidateHash,
        strategySummary: requireSummary(candidate.strategySummary),
        riskSummary: redactSummary(candidate.riskSummary ?? null),
      });
      return { kind: 'created', draft };
    } catch (rawError) {
      // race 対応: createDraft が unique 違反した場合、再検索して existing を返す。
      const raced = await repository.findByCandidateHash(candidate.candidateHash);
      if (raced) {
        return { kind: 'duplicate', existing: raced };
      }
      throw rawError;
    }
  }

  /** Draft を承認状態に遷移させる */
  async function approveDraft(
    draftId: string,
    reviewer: string,
    reason?: string,
  ): Promise<StrategyDraft> {
    await mustTransition(draftId, 'approved');
    return repository.updateDraft(draftId, {
      status: 'approved',
      reviewer,
      approvalReason: redactSummary(reason ?? null),
    });
  }

  /** Draft を却下状態に遷移させる (理由必須) */
  async function rejectDraft(
    draftId: string,
    reviewer: string,
    reason: string,
  ): Promise<StrategyDraft> {
    await mustTransition(draftId, 'rejected');
    return repository.updateDraft(draftId, {
      status: 'rejected',
      reviewer,
      rejectionReason: redactErrorMessage(reason),
    });
  }

  /**
   * 承認済み Draft を Validation 投入キューに乗せる。
   * 状態遷移: approved → queued_for_validation
   */
  async function queueForValidation(draftId: string): Promise<StrategyDraft> {
    await mustTransition(draftId, 'queued_for_validation');
    return repository.updateDraft(draftId, {
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
    await mustTransition(draftId, 'validated');
    return repository.updateDraft(draftId, {
      status: 'validated',
      validatedAt: clock(),
      validationResultId: validationResultId ?? null,
    });
  }

  /**
   * Draft を archive する。任意の非終端 / 終端状態から遷移可 (rejected / validated 等の整理用)。
   * 状態遷移マップ上は archived から戻れない (終端)。
   */
  async function archiveDraft(
    draftId: string,
    reason: string,
  ): Promise<StrategyDraft> {
    await mustTransition(draftId, 'archived');
    return repository.updateDraft(draftId, {
      status: 'archived',
      archiveReason: redactSummary(reason),
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

  async function mustTransition(
    draftId: string,
    to: StrategyDraftStatus,
  ): Promise<StrategyDraft> {
    const current = await repository.findById(draftId);
    if (!current) {
      throw new StrategyDraftStateError(`StrategyDraft(id=${draftId}) が存在しない`);
    }
    if (!canTransitionDraft(current.status, to)) {
      throw new StrategyDraftStateError(
        `不正な Draft 状態遷移: ${current.status} -> ${to} (draftId=${draftId})`,
      );
    }
    return current;
  }

  function requireSummary(summary: string): string {
    const trimmed = summary.trim();
    if (trimmed === '') {
      throw new StrategyDraftStateError(
        'strategySummary は必須 (空文字 / 空白のみは許可されない)',
      );
    }
    const redacted = redactSummary(trimmed);
    if (redacted === null) {
      throw new StrategyDraftStateError('strategySummary の redaction 結果が null');
    }
    return redacted;
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
