/**
 * Side-B Orchestrator Wrapper
 *
 * `Readiness → Plan → Monitor → Evolution → Draft → Validation` の Golden Path を
 * ADK 外側の Custom Orchestrator として束ねる。既存 Job / PDCALoop / Lens / Evolution
 * の内部は置き換えず、JobPort 経由で呼ぶだけ。
 *
 * 責務:
 *   - RunLedgerService.startRun() で run を作る
 *   - 順序通り JobPort.execute() を呼び、nextAction で分岐 (stop / skip / retry / manual_review)
 *   - Evolution 候補があれば StrategyDraftService.createFromEvolutionCandidate() を呼ぶ
 *   - 承認済み Draft (autoQueueApprovedDrafts=true 時) を queueForValidation する
 *   - Validation Job を JobPort 経由で呼ぶ (queue にある Draft 件数だけ)
 *   - run 終了時に finishRun()
 *
 * 持たない責務:
 *   - 各 Job の内部実装 (= adapter で wrap、本ファイルは JobPort interface しか触らない)
 *   - PDCALoop / EvolutionLoop / Lens 等の置き換え (WBS §17)
 *   - DB CRUD 直接 (= RunLedgerService / StrategyDraftService 経由のみ)
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §11 (Phase 6)
 */

import type { AgentRun, StrategyDraft } from '@prisma/client';
import type { JobPort, JobResultEnvelope } from '../../jobs/jobPort';
import type { RunLedgerService } from '../../services/runLedgerService';
import type {
  StrategyDraftService,
  EvolutionCandidateInput,
} from '../../services/strategyDraftService';
import {
  RunLedgerDuplicateRunError,
  type TerminalRunStatus,
} from '../../services/runLedgerService';

// ============================================================
// Types
// ============================================================

/**
 * Golden Path で呼ぶ Job 群。すべて optional: 未指定の step は skip される。
 *
 * - readiness: 実行可否チェック (失敗で stop)
 * - plan: プラン生成
 * - monitor: 約定検証 / トレード監視
 * - evolution: 進化ループ実行 (候補を返す)
 * - validation: Validation Job (queued_for_validation の Draft を回す)
 */
export interface SideBOrchestratorJobs {
  readonly readiness?: JobPort;
  readonly plan?: JobPort;
  readonly monitor?: JobPort;
  readonly evolution?: JobPort;
  readonly validation?: JobPort;
}

/**
 * Evolution の戻り envelope から候補リストを抽出する関数。
 *
 * 既存 EvolutionJob の戻り値 (`EvolutionJobResult`) には DSL の hash や summary が
 * 直接含まれていないため、呼び出し側が「Evolution の生成物 (population repository 等)
 * から取り出す」適切な実装を渡す。本 PR では interface だけ用意し、実 adapter は
 * Phase 7 / 後続で wire する。
 */
export type ExtractEvolutionCandidatesFn = (
  evolutionEnvelope: JobResultEnvelope,
  context: { runId: string; stepId: string },
) => Promise<EvolutionCandidateInput[]>;

/**
 * Orchestrator の起動オプション。
 */
export interface SideBOrchestratorOptions {
  /** 必須: RunLedgerService */
  readonly ledger: RunLedgerService;
  /** 必須: StrategyDraftService */
  readonly draftService: StrategyDraftService;
  /** Golden Path 各 step の Job (未指定 step は skip) */
  readonly jobs: SideBOrchestratorJobs;
  /** 実行種別 (デフォルト 'side_b_cycle') */
  readonly kind?: string;
  /** 起動元 (デフォルト 'adk') */
  readonly triggeredBy?: string;
  /** 冪等性キー (同一値で重複起動を防ぐ) */
  readonly idempotencyKey?: string;
  /** Evolution → Draft 抽出関数 (省略時は Draft step を skip) */
  readonly extractCandidates?: ExtractEvolutionCandidatesFn;
  /**
   * 自動で approved Draft を queue へ流すか (デフォルト false)。
   * 「動いたから本番へ流そう」事故を避けるため保守的なデフォルト (WBS §3 末尾)。
   */
  readonly autoQueueApprovedDrafts?: boolean;
  /** Draft step / Validation step の上限 (1 run あたり処理する Draft 数、デフォルト 10) */
  readonly draftBatchSize?: number;
}

/**
 * Orchestrator 実行結果。
 */
export interface SideBOrchestratorResult {
  /** 作成された AgentRun (idempotency 重複で既存 run を再利用した場合も含む) */
  readonly run: AgentRun;
  /** 各 step の envelope (skip も含む)。順序は実行順 */
  readonly stepEnvelopes: ReadonlyArray<JobResultEnvelope | OrchestratorSkipEnvelope>;
  /** 作成された Draft (新規 + duplicate)。Draft step を skip した場合は空 */
  readonly drafts: ReadonlyArray<StrategyDraft>;
  /** run の終了状態 */
  readonly finalStatus: TerminalRunStatus;
  /** 冪等性で既存 run が再利用された場合 true */
  readonly idempotentReuse: boolean;
}

/**
 * step が skip された場合の envelope (JobResultEnvelope と区別するため別型)。
 */
export interface OrchestratorSkipEnvelope {
  readonly kind: 'skipped';
  readonly stepName: string;
  readonly reason: string;
}

const DRAFT_STEP_NAME = 'draft';
const VALIDATION_QUEUE_STEP_NAME = 'validation-queue';

// ============================================================
// Golden Path entry point
// ============================================================

/**
 * Side-B Golden Path を 1 サイクル実行する。
 *
 * 失敗分岐 (WBS §6.8):
 *   - nextAction='stop' → 後続 step をすべて skip、finishRun(failed)
 *   - nextAction='skip' → その step を skip 記録、後続継続
 *   - nextAction='retry' → 本 Orchestrator では retry しない (上位呼び出し側で再起動の判断)
 *   - nextAction='manual_review' → step を残し、後続 step を skip、finishRun(failed)
 *   - nextAction='proceed' → 通常通り次 step
 *
 * 冪等性 (WBS §2.4):
 *   - idempotencyKey 指定時、既存 run があれば `RunLedgerDuplicateRunError` を catch し、
 *     既存 run を再利用 (`idempotentReuse=true`)
 */
export async function runSideBOrchestratedCycle(
  options: SideBOrchestratorOptions,
): Promise<SideBOrchestratorResult> {
  const { ledger, draftService, jobs } = options;
  const batchSize = options.draftBatchSize ?? 10;

  // ----- run 作成 (冪等性対応) -----
  let run: AgentRun;
  let idempotentReuse = false;
  try {
    run = await ledger.startRun({
      kind: options.kind ?? 'side_b_cycle',
      triggeredBy: options.triggeredBy ?? 'adk',
      idempotencyKey: options.idempotencyKey,
    });
  } catch (err) {
    if (err instanceof RunLedgerDuplicateRunError) {
      run = err.existingRun;
      idempotentReuse = true;
      // 既存 run の場合は早期 return: ADK Orchestrator は cycle を二重実行しない
      return {
        run,
        stepEnvelopes: [],
        drafts: [],
        finalStatus: terminalStatusOf(run),
        idempotentReuse,
      };
    }
    throw err;
  }

  const ctx = { runId: run.id, ledger };
  const stepEnvelopes: Array<JobResultEnvelope | OrchestratorSkipEnvelope> = [];
  const drafts: StrategyDraft[] = [];
  let shouldStop = false;

  // ----- step 順次実行 -----
  const steps: Array<{ name: string; job?: JobPort }> = [
    { name: 'readiness', job: jobs.readiness },
    { name: 'plan', job: jobs.plan },
    { name: 'monitor', job: jobs.monitor },
    { name: 'evolution', job: jobs.evolution },
  ];

  let evolutionEnvelope: JobResultEnvelope | null = null;
  for (const step of steps) {
    if (shouldStop) {
      stepEnvelopes.push(skipEnvelope(step.name, 'previous step requested stop'));
      continue;
    }
    if (!step.job) {
      stepEnvelopes.push(skipEnvelope(step.name, 'job not wired'));
      continue;
    }
    const env = await step.job.execute(ctx);
    stepEnvelopes.push(env);
    if (env.nextAction === 'stop' || env.nextAction === 'manual_review') {
      shouldStop = true;
    }
    if (step.name === 'evolution' && env.status === 'succeeded') {
      evolutionEnvelope = env;
    }
  }

  // ----- Draft 抽出 step -----
  if (!shouldStop && evolutionEnvelope && options.extractCandidates) {
    const draftEnvelope = await runDraftStep(
      ctx,
      evolutionEnvelope,
      options.extractCandidates,
      draftService,
      drafts,
    );
    stepEnvelopes.push(draftEnvelope);
    if (draftEnvelope.nextAction === 'stop' || draftEnvelope.nextAction === 'manual_review') {
      shouldStop = true;
    }
  } else {
    stepEnvelopes.push(skipEnvelope(DRAFT_STEP_NAME,
      !evolutionEnvelope ? 'no evolution candidate' : 'extractCandidates not provided',
    ));
  }

  // ----- Validation queue step (自動 queue が有効な場合のみ) -----
  if (!shouldStop && options.autoQueueApprovedDrafts) {
    const queueEnvelope = await runValidationQueueStep(ctx, draftService, batchSize);
    stepEnvelopes.push(queueEnvelope);
    if (queueEnvelope.nextAction === 'stop' || queueEnvelope.nextAction === 'manual_review') {
      shouldStop = true;
    }
  } else {
    stepEnvelopes.push(skipEnvelope(VALIDATION_QUEUE_STEP_NAME,
      options.autoQueueApprovedDrafts ? 'previous step requested stop' : 'autoQueueApprovedDrafts disabled',
    ));
  }

  // ----- Validation Job step -----
  if (!shouldStop && jobs.validation) {
    const validationEnv = await jobs.validation.execute(ctx);
    stepEnvelopes.push(validationEnv);
    if (validationEnv.nextAction === 'stop' || validationEnv.nextAction === 'manual_review') {
      shouldStop = true;
    }
  } else {
    stepEnvelopes.push(skipEnvelope('validation',
      !jobs.validation ? 'validation job not wired' : 'previous step requested stop',
    ));
  }

  // ----- run finish -----
  const finalStatus: TerminalRunStatus = shouldStop ? 'failed' : 'succeeded';
  const finishedRun = await ledger.finishRun(run.id, {
    status: finalStatus,
    summary: composeRunSummary(stepEnvelopes),
  });

  return {
    run: finishedRun,
    stepEnvelopes,
    drafts,
    finalStatus,
    idempotentReuse,
  };
}

// ============================================================
// internal helpers
// ============================================================

function skipEnvelope(stepName: string, reason: string): OrchestratorSkipEnvelope {
  return { kind: 'skipped', stepName, reason };
}

function terminalStatusOf(run: AgentRun): TerminalRunStatus {
  const status = run.status;
  if (status === 'succeeded' || status === 'failed' || status === 'skipped' || status === 'cancelled') {
    return status;
  }
  // 進行中の run を再利用した場合は failed 扱い (cycle 二重起動を上位に通知)
  return 'failed';
}

/**
 * Evolution 候補を抽出し Draft 化する step。
 * 各 candidate を `createFromEvolutionCandidate` に流し、新規 / 重複の両方を `drafts` に push する。
 * 1 candidate でも throw した場合は failed envelope を返す。
 */
async function runDraftStep(
  ctx: { runId: string; ledger: RunLedgerService },
  evolutionEnvelope: JobResultEnvelope,
  extractCandidates: ExtractEvolutionCandidatesFn,
  draftService: StrategyDraftService,
  draftsOut: StrategyDraft[],
): Promise<JobResultEnvelope> {
  const { ledger, runId } = ctx;
  const stepName = DRAFT_STEP_NAME;
  await ledger.startStep(runId, { stepName, traceKind: 'orchestrator' });

  try {
    const evolutionStepId = await findLatestStepId(ledger, runId, 'evolution');
    const candidates = await extractCandidates(evolutionEnvelope, {
      runId,
      stepId: evolutionStepId,
    });

    let created = 0;
    let duplicate = 0;
    for (const candidate of candidates) {
      const result = await draftService.createFromEvolutionCandidate(candidate, {
        sourceRunId: runId,
        sourceStepId: evolutionStepId,
      });
      draftsOut.push(result.kind === 'created' ? result.draft : result.existing);
      if (result.kind === 'created') created += 1;
      else duplicate += 1;
    }

    const summary = `candidates=${candidates.length}, created=${created}, duplicate=${duplicate}`;
    await ledger.succeedStep(runId, stepName, { summary, nextAction: 'proceed' });
    return {
      ok: true,
      status: 'succeeded',
      stepName,
      summary,
      nextAction: 'proceed',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown draft step error';
    await ledger.failStep(runId, stepName, {
      errorCode: 'DRAFT_STEP_FAILED',
      errorMessage: message,
      nextAction: 'stop',
    });
    return {
      ok: false,
      status: 'failed',
      stepName,
      summary: null,
      errorCode: 'DRAFT_STEP_FAILED',
      errorMessage: message,
      nextAction: 'stop',
    };
  }
}

/**
 * approved Draft を queue へ流す step (autoQueueApprovedDrafts=true 時のみ呼ばれる)。
 */
async function runValidationQueueStep(
  ctx: { runId: string; ledger: RunLedgerService },
  draftService: StrategyDraftService,
  batchSize: number,
): Promise<JobResultEnvelope> {
  const { ledger, runId } = ctx;
  const stepName = VALIDATION_QUEUE_STEP_NAME;
  await ledger.startStep(runId, { stepName, traceKind: 'orchestrator' });

  try {
    const approved = await draftService.listByStatus('approved', batchSize);
    let queued = 0;
    for (const draft of approved) {
      await draftService.queueForValidation(draft.id);
      queued += 1;
    }
    const summary = `approvedScanned=${approved.length}, queued=${queued}`;
    await ledger.succeedStep(runId, stepName, { summary, nextAction: 'proceed' });
    return {
      ok: true,
      status: 'succeeded',
      stepName,
      summary,
      nextAction: 'proceed',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown validation queue step error';
    await ledger.failStep(runId, stepName, {
      errorCode: 'VALIDATION_QUEUE_FAILED',
      errorMessage: message,
      nextAction: 'stop',
    });
    return {
      ok: false,
      status: 'failed',
      stepName,
      summary: null,
      errorCode: 'VALIDATION_QUEUE_FAILED',
      errorMessage: message,
      nextAction: 'stop',
    };
  }
}

/**
 * RunLedger の findRunWithSteps から最新の指定 step ID を取得する。
 * Draft step の sourceStepId として渡す。見つからない場合は throw (step が存在しないのは
 * Orchestrator の設計違反)。
 */
async function findLatestStepId(
  ledger: RunLedgerService,
  runId: string,
  stepName: string,
): Promise<string> {
  const detail = await ledger.findRunWithSteps(runId);
  if (!detail) throw new Error(`run not found: ${runId}`);
  const matching = detail.steps.filter((s) => s.stepName === stepName);
  if (matching.length === 0) {
    throw new Error(`step not found in run: ${stepName} (runId=${runId})`);
  }
  // 最新 attempt を採用
  matching.sort((a, b) => b.attempt - a.attempt);
  const latest = matching[0];
  if (!latest) {
    throw new Error(`step list empty after filter: ${stepName} (runId=${runId})`);
  }
  return latest.id;
}

function composeRunSummary(
  envelopes: ReadonlyArray<JobResultEnvelope | OrchestratorSkipEnvelope>,
): string {
  const parts = envelopes.map((e) => {
    if ('kind' in e && e.kind === 'skipped') {
      return `${e.stepName}:skipped`;
    }
    if ('status' in e) {
      return `${e.stepName}:${e.status}`;
    }
    return e.stepName;
  });
  return parts.join(', ');
}
