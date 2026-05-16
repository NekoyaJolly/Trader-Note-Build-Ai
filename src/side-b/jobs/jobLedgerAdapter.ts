/**
 * JobLedgerAdapter helper
 *
 * 既存 Job を JobPort 化する際の「RunLedger 連携 + エラー正規化」を一箇所に集約する。
 * 各 Job adapter は本 helper を呼ぶだけで、startStep / 結果分岐 / 例外捕捉が共通化される。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §8 (Phase 3.5 / 3.6)
 */

import type {
  AgentRunStepStatus,
  AgentRunStepNextAction,
} from '@prisma/client';
import type { JobPortContext, JobResultEnvelope } from './jobPort';

/**
 * 既存 Job を呼ぶための spec。adapter は本 spec を作って runJobWithLedger に渡す。
 */
export interface JobAdapterSpec<TResult> {
  /** RunLedger step 名 (例: 'cleanup', 'discovery') */
  readonly stepName: string;
  /** 既存 Job.run() などを呼んで TResult を取得する */
  invoke(): Promise<TResult>;
  /**
   * 既存 Job の戻り値を JobResultEnvelope 部分形 (stepName を除く) に変換する。
   * status / nextAction / summary / errorCode などをここで決める。
   */
  mapResult(result: TResult): MappedEnvelope;
  /**
   * 例外を JobResultEnvelope 部分形に変換する (省略時は defaultMapError を使う)。
   */
  mapError?(error: Error): MappedEnvelope;
  /** trace 発生元 (省略時 'job') */
  readonly traceKind?: string;
}

/** mapResult / mapError が返す中間形 (stepName は helper 側で付与) */
export type MappedEnvelope = Omit<JobResultEnvelope, 'stepName'>;

/**
 * 既存 Job を JobPort 互換で実行し、RunLedger に step を残す。
 *
 * 動作:
 *   1. ledger.startStep(runId, { stepName, traceKind })
 *   2. spec.invoke() を呼ぶ
 *   3. 戻り値 / 例外を envelope に変換
 *   4. status に応じて succeedStep / failStep / skipStep を呼ぶ
 *   5. envelope を返す
 *
 * 例外は内部で catch して JobResultEnvelope (status='failed') として返す。
 * 「Job 単位の失敗が ADK Orchestrator 全体を壊さない」を保証する設計。
 */
export async function runJobWithLedger<TResult>(
  context: JobPortContext,
  spec: JobAdapterSpec<TResult>,
): Promise<JobResultEnvelope> {
  const { ledger, runId } = context;

  await ledger.startStep(runId, {
    stepName: spec.stepName,
    traceKind: spec.traceKind ?? 'job',
  });

  let envelope: JobResultEnvelope;
  try {
    const result = await spec.invoke();
    envelope = { ...spec.mapResult(result), stepName: spec.stepName };
  } catch (rawError) {
    // catch 変数は TypeScript default の unknown 推論に任せ、ここで narrow する
    // (AGENTS.md §2 「unknown 型を書かない」と整合)。
    let error: Error;
    if (rawError instanceof Error) {
      error = rawError;
    } else if (typeof rawError === 'string') {
      error = new Error(rawError);
    } else {
      error = new Error('Unknown Job error (non-Error thrown)');
    }
    const mapped = spec.mapError ? spec.mapError(error) : defaultMapError(error);
    envelope = { ...mapped, stepName: spec.stepName };
  }

  await recordStepOutcome(context, envelope);
  return envelope;
}

/**
 * spec.mapError が省略されたときの fallback。
 * 「failed + nextAction=stop + errorCode='JOB_UNCAUGHT'」を返す保守的な動作。
 */
export function defaultMapError(error: Error): MappedEnvelope {
  return {
    ok: false,
    status: 'failed',
    summary: null,
    errorCode: 'JOB_UNCAUGHT',
    errorMessage: error.message,
    nextAction: 'stop',
  };
}

/**
 * envelope.status に応じて RunLedger の終端 API を呼ぶ。
 */
async function recordStepOutcome(
  context: JobPortContext,
  envelope: JobResultEnvelope,
): Promise<void> {
  const { ledger, runId } = context;
  const status: AgentRunStepStatus = envelope.status;
  const nextAction: AgentRunStepNextAction | null = envelope.nextAction;

  if (status === 'succeeded') {
    await ledger.succeedStep(runId, envelope.stepName, {
      summary: envelope.summary,
      nextAction,
    });
    return;
  }

  if (status === 'failed') {
    await ledger.failStep(runId, envelope.stepName, {
      errorCode: envelope.errorCode ?? null,
      errorMessage: envelope.errorMessage ?? null,
      summary: envelope.summary,
      nextAction,
    });
    return;
  }

  if (status === 'skipped') {
    await ledger.skipStep(runId, envelope.stepName, {
      reason: envelope.summary ?? envelope.errorMessage ?? `${envelope.stepName} skipped`,
      nextAction,
    });
    return;
  }
}
