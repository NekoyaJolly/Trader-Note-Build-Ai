/**
 * CleanupJob → JobPort adapter
 *
 * 既存 CleanupJob (src/side-b/jobs/cleanupJob.ts) を改変せずに JobPort 互換で wrap する。
 * CleanupJobResult を JobResultEnvelope に正規化し、RunLedger に step を残す。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §8 (Phase 3)
 */

import type { CleanupJob, CleanupJobResult } from '../cleanupJob';
import type { SideBSchedulerConfig } from '../sideBScheduler';
import type { JobPort, JobPortContext, JobResultEnvelope } from '../jobPort';
import { runJobWithLedger, type MappedEnvelope } from '../jobLedgerAdapter';

export const CLEANUP_STEP_NAME = 'cleanup';

/**
 * CleanupJob を JobPort に変換するファクトリ。
 *
 * @param job  既存 CleanupJob インスタンス (DI のため呼び出し側で作成)
 * @param config Job.run に渡す SideBSchedulerConfig (cleanup の閾値設定など)
 */
export function createCleanupJobAdapter(
  job: CleanupJob,
  config: SideBSchedulerConfig,
): JobPort {
  return {
    stepName: CLEANUP_STEP_NAME,
    execute(context: JobPortContext): Promise<JobResultEnvelope> {
      return runJobWithLedger(context, {
        stepName: CLEANUP_STEP_NAME,
        invoke: () => job.run(config),
        mapResult: mapCleanupResult,
      });
    },
  };
}

/**
 * CleanupJobResult を MappedEnvelope に変換する。
 *
 * - executed=false → skipped (24h ガードでスキップされたケース)
 * - executed=true && error → failed + errorCode='CLEANUP_PARTIAL'
 * - executed=true && !error → succeeded + summary は削除件数
 */
export function mapCleanupResult(result: CleanupJobResult): MappedEnvelope {
  if (!result.executed) {
    return {
      ok: false,
      status: 'skipped',
      summary: 'cleanup skipped (24h guard)',
      nextAction: 'proceed',
    };
  }
  if (result.error) {
    return {
      ok: false,
      status: 'failed',
      summary: summarizeCounts(result),
      errorCode: 'CLEANUP_PARTIAL',
      errorMessage: result.error,
      nextAction: 'proceed',
    };
  }
  return {
    ok: true,
    status: 'succeeded',
    summary: summarizeCounts(result),
    nextAction: 'proceed',
  };
}

function summarizeCounts(result: CleanupJobResult): string {
  return [
    `expiredResearch=${result.expiredResearchCount}`,
    `oldPlans=${result.oldPlansCount}`,
    `oldTrades=${result.oldTradesCount}`,
    `evolutionCarryDeleted=${result.carryRetention.deleted}`,
  ].join(', ');
}
