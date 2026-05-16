/**
 * RunLedgerService
 *
 * Side-B 全実行経路の共通実行台帳サービス。
 * SideBScheduler / ADK Orchestrator Wrapper / 手動実行 / 各 Job adapter から
 * 同じ API で呼ばれる。
 *
 * 責務:
 *   - AgentRun / AgentRunStep の create / update を repository 経由で行う
 *   - 状態遷移ルール (WBS §2.3) を強制する
 *   - idempotencyKey による二重実行抑止 (WBS §2.4)
 *   - retry を attempt 番号で表現 (WBS §2.5)
 *   - redaction (raw payload を保存しない、WBS §2.6 / §17) を強制する
 *
 * 持たない責務:
 *   - 実行順序の意思決定 (= ADK Orchestrator Wrapper の責務)
 *   - Evolution 候補の業務承認 (= StrategyDraftService の責務)
 *   - ADK SDK への直接依存 (WBS §17)
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §7 (Phase 2)
 */

import type {
  AgentRun,
  AgentRunStep,
  AgentRunStatus,
  AgentRunStepStatus,
  AgentRunStepNextAction,
} from '@prisma/client';
import {
  createRunLedgerRepository,
  type RunLedgerRepository,
} from '../repositories/runLedgerRepository';
import {
  redactSummary,
  redactErrorMessage,
  redactErrorCode,
} from './runLedgerRedaction';

// ============================================================
// 状態遷移ルール (WBS §1.2 / §2.3)
// ============================================================

/** AgentRun の許可遷移マップ。終端 (succeeded/failed/skipped/cancelled) からは出られない */
const RUN_TRANSITIONS: Readonly<Record<AgentRunStatus, ReadonlyArray<AgentRunStatus>>> = {
  pending: ['running', 'cancelled', 'skipped'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  skipped: [],
  cancelled: [],
};

/** AgentRunStep の許可遷移マップ。終端 (succeeded/failed/skipped) からは出られない */
const STEP_TRANSITIONS: Readonly<Record<AgentRunStepStatus, ReadonlyArray<AgentRunStepStatus>>> = {
  pending: ['running', 'skipped'],
  running: ['succeeded', 'failed', 'skipped'],
  succeeded: [],
  failed: [],
  skipped: [],
};

/** run の状態遷移が許可されているか */
export function canTransitionRun(from: AgentRunStatus, to: AgentRunStatus): boolean {
  if (from === to) return false;
  return RUN_TRANSITIONS[from].includes(to);
}

/** step の状態遷移が許可されているか */
export function canTransitionStep(from: AgentRunStepStatus, to: AgentRunStepStatus): boolean {
  if (from === to) return false;
  return STEP_TRANSITIONS[from].includes(to);
}

/** 状態遷移違反 / その他 RunLedger 不正操作のエラー */
export class RunLedgerStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunLedgerStateError';
  }
}

/** 重複した idempotencyKey で startRun が呼ばれたことを示す。既存 run を expose する */
export class RunLedgerDuplicateRunError extends Error {
  readonly existingRun: AgentRun;
  constructor(existingRun: AgentRun) {
    super(`AgentRun with idempotencyKey=${existingRun.idempotencyKey ?? ''} already exists`);
    this.name = 'RunLedgerDuplicateRunError';
    this.existingRun = existingRun;
  }
}

// ============================================================
// Service API
// ============================================================

export interface StartRunInput {
  /** 実行種別 (例: side_b_cycle, manual, dry_run) */
  kind: string;
  /** 起動元 (例: scheduler, manual, test, adk) */
  triggeredBy: string;
  /** 冪等性キー (同一値で startRun が再度呼ばれた場合は既存 run を返す) */
  idempotencyKey?: string;
  /** 開始時 summary (redaction 済み) */
  summary?: string | null;
}

export interface FinishRunInput {
  /** 終了状態 (succeeded / failed / cancelled / skipped のいずれか) */
  status: AgentRunStatus;
  /** 完了時 summary (redaction 済み) */
  summary?: string | null;
  /** 失敗時の短縮エラーコード */
  errorCode?: string | null;
  /** 失敗時の短縮エラーメッセージ */
  errorMessage?: string | null;
}

export interface StartStepInput {
  /** step 名 (readiness / plan / monitor / evolution / draft / validation 等) */
  stepName: string;
  /** trace の発生元 (例: adk, job, service) */
  traceKind?: string | null;
}

export interface SucceedStepInput {
  /** redaction 済み step 要約 */
  summary?: string | null;
  /** 次アクション (なし時は null) */
  nextAction?: AgentRunStepNextAction | null;
}

export interface FailStepInput {
  /** 失敗時の短縮エラーコード */
  errorCode?: string | null;
  /** 失敗時の短縮エラーメッセージ */
  errorMessage?: string | null;
  /** 次アクション (retry / stop / manual_review など) */
  nextAction?: AgentRunStepNextAction | null;
  /** redaction 済み step 要約 (失敗時の補足) */
  summary?: string | null;
}

export interface SkipStepInput {
  /** skip 理由 (summary に保存される) */
  reason: string;
  /** 次アクション (skip 後 stop / manual_review など) */
  nextAction?: AgentRunStepNextAction | null;
}

export type StartStepResult =
  | { kind: 'created'; step: AgentRunStep }
  | { kind: 'retry'; step: AgentRunStep; previousAttempt: number };

/**
 * RunLedgerService factory.
 *
 * @param repo Repository (省略時は default Prisma)
 * @param clock 現在時刻 (test 用に injectable、省略時は `Date.now()`)
 */
export function createRunLedgerService(options?: {
  repository?: RunLedgerRepository;
  clock?: () => Date;
}) {
  const repository = options?.repository ?? createRunLedgerRepository();
  const clock = options?.clock ?? (() => new Date());

  /**
   * 新規 AgentRun を開始する。
   *
   * idempotencyKey が指定されており既存 run があれば `RunLedgerDuplicateRunError` を throw する。
   * 呼び出し側は catch して既存 run を再利用するか、エラーとして扱うかを選ぶ。
   */
  async function startRun(input: StartRunInput): Promise<AgentRun> {
    if (input.idempotencyKey) {
      const existing = await repository.findRunByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        throw new RunLedgerDuplicateRunError(existing);
      }
    }

    return repository.createRun({
      kind: input.kind,
      triggeredBy: input.triggeredBy,
      status: 'running',
      summary: redactSummary(input.summary ?? null),
      idempotencyKey: input.idempotencyKey ?? null,
    });
  }

  /**
   * 既存 run を終端状態に遷移させる。`succeeded` / `failed` / `cancelled` / `skipped` のみ受け付ける。
   * `pending` / `running` への遷移を試みると `RunLedgerStateError` を throw する。
   */
  async function finishRun(runId: string, input: FinishRunInput): Promise<AgentRun> {
    const terminal: ReadonlyArray<AgentRunStatus> = ['succeeded', 'failed', 'skipped', 'cancelled'];
    if (!terminal.includes(input.status)) {
      throw new RunLedgerStateError(
        `finishRun の status は終端状態のみ許可される (受信: ${input.status})`,
      );
    }

    const current = await repository.findRunById(runId);
    if (!current) {
      throw new RunLedgerStateError(`AgentRun(id=${runId}) が存在しない`);
    }
    if (!canTransitionRun(current.status, input.status)) {
      throw new RunLedgerStateError(
        `不正な run 状態遷移: ${current.status} -> ${input.status} (runId=${runId})`,
      );
    }

    return repository.updateRun(runId, {
      status: input.status,
      finishedAt: clock(),
      summary: redactSummary(input.summary ?? null),
      errorCode: redactErrorCode(input.errorCode ?? null),
      errorMessage: redactErrorMessage(input.errorMessage ?? null),
    });
  }

  /**
   * step を開始する。
   *
   * 同一 runId + stepName の前回 attempt が **終端状態** であれば、attempt を +1 して
   * 新規 step を作成する (retry)。終端ではない (pending / running 残り) の場合は
   * `RunLedgerStateError` を throw する。
   *
   * 戻り値の `kind` は test / debugging 用 (`created` か `retry` かを区別)。
   */
  async function startStep(
    runId: string,
    input: StartStepInput,
  ): Promise<StartStepResult> {
    const run = await repository.findRunById(runId);
    if (!run) {
      throw new RunLedgerStateError(`AgentRun(id=${runId}) が存在しない`);
    }
    if (run.status !== 'running') {
      throw new RunLedgerStateError(
        `run.status=${run.status} の状態で step を開始できない (runId=${runId})`,
      );
    }

    const latest = await repository.findLatestStep(runId, input.stepName);
    let attempt = 0;
    let kind: 'created' | 'retry' = 'created';
    if (latest) {
      const stillOpen = latest.status === 'pending' || latest.status === 'running';
      if (stillOpen) {
        throw new RunLedgerStateError(
          `step(${input.stepName}) は未完了 attempt=${latest.attempt} が残っている`,
        );
      }
      attempt = latest.attempt + 1;
      kind = 'retry';
    }

    const created = await repository.createStep({
      runId,
      stepName: input.stepName,
      attempt,
      status: 'running',
      traceKind: input.traceKind ?? null,
    });

    if (kind === 'retry' && latest) {
      return { kind, step: created, previousAttempt: latest.attempt };
    }
    return { kind: 'created', step: created };
  }

  /**
   * step を成功で閉じる。`pending` / `running` 以外から `succeeded` 遷移は拒否される。
   * durationMs は startedAt と現在時刻から自動計算する。
   */
  async function succeedStep(
    runId: string,
    stepName: string,
    input: SucceedStepInput = {},
  ): Promise<AgentRunStep> {
    const step = await mustGetActiveStep(runId, stepName);
    assertTransitionStep(step.status, 'succeeded');
    return repository.updateStep(step.id, {
      status: 'succeeded',
      finishedAt: clock(),
      durationMs: durationMsFrom(step.startedAt),
      summary: redactSummary(input.summary ?? null),
      nextAction: input.nextAction ?? null,
    });
  }

  /**
   * step を失敗で閉じる。`pending` / `running` から `failed` 遷移のみ許可。
   */
  async function failStep(
    runId: string,
    stepName: string,
    input: FailStepInput,
  ): Promise<AgentRunStep> {
    const step = await mustGetActiveStep(runId, stepName);
    assertTransitionStep(step.status, 'failed');
    return repository.updateStep(step.id, {
      status: 'failed',
      finishedAt: clock(),
      durationMs: durationMsFrom(step.startedAt),
      summary: redactSummary(input.summary ?? null),
      errorCode: redactErrorCode(input.errorCode ?? null),
      errorMessage: redactErrorMessage(input.errorMessage ?? null),
      nextAction: input.nextAction ?? null,
    });
  }

  /**
   * step を skip 扱いで閉じる。`pending` / `running` から `skipped` 遷移のみ許可。
   * skip 理由は summary に redaction 済みで保存される。
   */
  async function skipStep(
    runId: string,
    stepName: string,
    input: SkipStepInput,
  ): Promise<AgentRunStep> {
    const step = await mustGetActiveStep(runId, stepName);
    assertTransitionStep(step.status, 'skipped');
    return repository.updateStep(step.id, {
      status: 'skipped',
      finishedAt: clock(),
      durationMs: durationMsFrom(step.startedAt),
      summary: redactSummary(input.reason),
      nextAction: input.nextAction ?? null,
    });
  }

  /**
   * UI / 調査用に run + step を時系列で取得する。
   */
  async function findRunWithSteps(runId: string) {
    return repository.findRunWithSteps(runId);
  }

  // ----- internal helpers -----

  async function mustGetActiveStep(runId: string, stepName: string): Promise<AgentRunStep> {
    const latest = await repository.findLatestStep(runId, stepName);
    if (!latest) {
      throw new RunLedgerStateError(
        `step(runId=${runId}, stepName=${stepName}) が存在しない`,
      );
    }
    return latest;
  }

  function assertTransitionStep(from: AgentRunStepStatus, to: AgentRunStepStatus): void {
    if (!canTransitionStep(from, to)) {
      throw new RunLedgerStateError(`不正な step 状態遷移: ${from} -> ${to}`);
    }
  }

  function durationMsFrom(startedAt: Date): number {
    return Math.max(0, clock().getTime() - startedAt.getTime());
  }

  return {
    startRun,
    finishRun,
    startStep,
    succeedStep,
    failStep,
    skipStep,
    findRunWithSteps,
  };
}

export type RunLedgerService = ReturnType<typeof createRunLedgerService>;
