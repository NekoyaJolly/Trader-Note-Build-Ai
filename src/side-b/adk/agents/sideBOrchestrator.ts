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
 *   - skip された step も RunLedger に startStep + skipStep を残す (observability 確保)
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
 */
export type ExtractEvolutionCandidatesFn = (
  evolutionEnvelope: JobResultEnvelope,
  context: { runId: string; stepId: string },
) => Promise<EvolutionCandidateInput[]>;

/**
 * Orchestrator の起動オプション。
 */
export interface SideBOrchestratorOptions {
  readonly ledger: RunLedgerService;
  readonly draftService: StrategyDraftService;
  readonly jobs: SideBOrchestratorJobs;
  readonly kind?: string;
  readonly triggeredBy?: string;
  readonly idempotencyKey?: string;
  readonly extractCandidates?: ExtractEvolutionCandidatesFn;
  readonly autoQueueApprovedDrafts?: boolean;
  /**
   * 1 run で処理する Draft 数の上限。Draft step / Validation queue step の **両方** に適用される。
   * - Draft step: extractCandidates 戻り値の先頭から batchSize 件のみ処理
   * - Validation queue step: listByStatus('approved', batchSize) で取得した Draft を queueForValidation
   * デフォルト 10。極端に多い候補による DB 圧迫を防ぐ。
   */
  readonly draftBatchSize?: number;
}

/**
 * Orchestrator 実行結果。
 *
 * `finalStatus` は新規実行時のみ `TerminalRunStatus` を持ち、idempotency reuse 時は
 * `null` を返す (= 既存 run の状態を加工せず透過。誤検知防止)。`idempotentReuse=true`
 * のとき呼び出し側は `run.status` を見て自身で判断する。
 */
export interface SideBOrchestratorResult {
  readonly run: AgentRun;
  readonly stepEnvelopes: ReadonlyArray<JobResultEnvelope | OrchestratorSkipEnvelope>;
  readonly drafts: ReadonlyArray<StrategyDraft>;
  readonly finalStatus: TerminalRunStatus | null;
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
 *   - nextAction='skip' → Orchestrator は no-op として透過 (= proceed と同等の挙動)。
 *     Job 自身が status=skipped を RunLedger に記録する想定。Orchestrator の loop には
 *     skip 専用の分岐を入れない (将来 metrics が必要になったら追加)。
 *   - nextAction='retry' → 本 Orchestrator では retry しない (上位呼び出し側で再起動の判断)
 *   - nextAction='manual_review' → step を残し、後続 step を skip、finishRun(failed)
 *   - nextAction='proceed' → 通常通り次 step
 *
 * 冪等性 (WBS §2.4):
 *   - idempotencyKey 指定時、既存 run があれば `RunLedgerDuplicateRunError` を catch し、
 *     既存 run を再利用 (`idempotentReuse=true`)。`finalStatus` は `null` で返す
 *     (= 既存 run の状態を加工せず透過、呼び出し側は run.status を参照)。
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
      // 既存 run の場合は早期 return: cycle を二重実行しない。
      // finalStatus は null で透過 (Copilot review #4 対応: failed 誤判定の回避)。
      return {
        run,
        stepEnvelopes: [],
        drafts: [],
        finalStatus: null,
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
      stepEnvelopes.push(
        await recordSkipAsStep(ctx, step.name, 'previous step requested stop'),
      );
      continue;
    }
    if (!step.job) {
      stepEnvelopes.push(
        await recordSkipAsStep(ctx, step.name, 'job not wired'),
      );
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
      batchSize,
    );
    stepEnvelopes.push(draftEnvelope);
    if (draftEnvelope.nextAction === 'stop' || draftEnvelope.nextAction === 'manual_review') {
      shouldStop = true;
    }
  } else {
    // 理由文は shouldStop を最優先 (Copilot review #2 対応)
    const reason = shouldStop
      ? 'previous step requested stop'
      : !evolutionEnvelope
        ? 'no evolution candidate'
        : 'extractCandidates not provided';
    stepEnvelopes.push(await recordSkipAsStep(ctx, DRAFT_STEP_NAME, reason));
  }

  // ----- Validation queue step (自動 queue が有効な場合のみ) -----
  if (!shouldStop && options.autoQueueApprovedDrafts) {
    const queueEnvelope = await runValidationQueueStep(ctx, draftService, batchSize);
    stepEnvelopes.push(queueEnvelope);
    if (queueEnvelope.nextAction === 'stop' || queueEnvelope.nextAction === 'manual_review') {
      shouldStop = true;
    }
  } else {
    // shouldStop を最優先 (Copilot review #2 対応)
    const reason = shouldStop
      ? 'previous step requested stop'
      : 'autoQueueApprovedDrafts disabled';
    stepEnvelopes.push(await recordSkipAsStep(ctx, VALIDATION_QUEUE_STEP_NAME, reason));
  }

  // ----- Validation Job step -----
  if (!shouldStop && jobs.validation) {
    const validationEnv = await jobs.validation.execute(ctx);
    stepEnvelopes.push(validationEnv);
    if (validationEnv.nextAction === 'stop' || validationEnv.nextAction === 'manual_review') {
      shouldStop = true;
    }
  } else {
    // shouldStop を最優先 (Copilot review #2 対応)
    const reason = shouldStop
      ? 'previous step requested stop'
      : 'validation job not wired';
    stepEnvelopes.push(await recordSkipAsStep(ctx, 'validation', reason));
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

/**
 * skip された step を RunLedger にも記録する (Copilot review #1 対応)。
 * startStep → skipStep を呼び、in-memory envelope と同じ stepName / reason を残す。
 * Ledger 側エラーは catch せず伝播 (Orchestrator 本体の整合性を優先)。
 */
async function recordSkipAsStep(
  ctx: { runId: string; ledger: RunLedgerService },
  stepName: string,
  reason: string,
): Promise<OrchestratorSkipEnvelope> {
  await ctx.ledger.startStep(ctx.runId, { stepName, traceKind: 'orchestrator' });
  await ctx.ledger.skipStep(ctx.runId, stepName, { reason, nextAction: 'proceed' });
  return { kind: 'skipped', stepName, reason };
}

/**
 * Evolution 候補を抽出し Draft 化する step。
 * - candidates.slice(0, batchSize) で Draft step にも cap を適用 (Copilot review #3 対応)
 * - 候補ループの途中で throw した場合、failed envelope の summary に partial 進捗を含める
 *   (Copilot review #6 対応): `candidates=N, created=K, duplicate=D, failedAt=index`
 */
async function runDraftStep(
  ctx: { runId: string; ledger: RunLedgerService },
  evolutionEnvelope: JobResultEnvelope,
  extractCandidates: ExtractEvolutionCandidatesFn,
  draftService: StrategyDraftService,
  draftsOut: StrategyDraft[],
  batchSize: number,
): Promise<JobResultEnvelope> {
  const { ledger, runId } = ctx;
  const stepName = DRAFT_STEP_NAME;
  await ledger.startStep(runId, { stepName, traceKind: 'orchestrator' });

  let processedIndex = -1;
  let created = 0;
  let duplicate = 0;
  let totalCandidates = 0;

  try {
    const evolutionStepId = await findLatestStepId(ledger, runId, 'evolution');
    const rawCandidates = await extractCandidates(evolutionEnvelope, {
      runId,
      stepId: evolutionStepId,
    });
    // batchSize 上限を適用 (Copilot review #3)
    const candidates = rawCandidates.slice(0, batchSize);
    totalCandidates = candidates.length;

    for (let i = 0; i < candidates.length; i += 1) {
      processedIndex = i;
      const candidate = candidates[i];
      if (!candidate) continue;
      const result = await draftService.createFromEvolutionCandidate(candidate, {
        sourceRunId: runId,
        sourceStepId: evolutionStepId,
      });
      draftsOut.push(result.kind === 'created' ? result.draft : result.existing);
      if (result.kind === 'created') created += 1;
      else duplicate += 1;
    }

    const summaryParts = [
      `candidates=${totalCandidates}`,
      `created=${created}`,
      `duplicate=${duplicate}`,
    ];
    if (rawCandidates.length > totalCandidates) {
      summaryParts.push(`truncatedFrom=${rawCandidates.length}`);
    }
    const summary = summaryParts.join(', ');
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
    const partialSummary = [
      `candidates=${totalCandidates}`,
      `created=${created}`,
      `duplicate=${duplicate}`,
      `failedAt=${processedIndex}`,
    ].join(', ');
    await ledger.failStep(runId, stepName, {
      errorCode: 'DRAFT_STEP_FAILED',
      errorMessage: message,
      summary: partialSummary,
      nextAction: 'stop',
    });
    return {
      ok: false,
      status: 'failed',
      stepName,
      summary: partialSummary,
      errorCode: 'DRAFT_STEP_FAILED',
      errorMessage: message,
      nextAction: 'stop',
    };
  }
}

/**
 * approved Draft を queue へ流す step (autoQueueApprovedDrafts=true 時のみ呼ばれる)。
 * batchSize で 1 run の処理件数を制限。
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
