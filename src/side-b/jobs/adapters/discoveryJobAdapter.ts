/**
 * DiscoveryJob → JobPort adapter
 *
 * 既存 DiscoveryJob (src/side-b/jobs/discoveryJob.ts) を改変せずに JobPort 互換で wrap する。
 * DiscoveryJobResult を JobResultEnvelope に正規化し、RunLedger に step を残す。
 *
 * 設計書: docs/architecture/adk_run_ledger_strategy_draft_完全版wbs.md §8 (Phase 3)
 */

import type { DiscoveryJob, DiscoveryJobResult } from '../discoveryJob';
import type { SideBSchedulerConfig } from '../sideBScheduler';
import type { JobPort, JobPortContext, JobResultEnvelope } from '../jobPort';
import { runJobWithLedger, type MappedEnvelope } from '../jobLedgerAdapter';

export const DISCOVERY_STEP_NAME = 'discovery';

/**
 * DiscoveryJob を JobPort に変換するファクトリ。
 *
 * @param job  既存 DiscoveryJob インスタンス
 * @param config Job.run に渡す SideBSchedulerConfig
 */
export function createDiscoveryJobAdapter(
  job: DiscoveryJob,
  config: SideBSchedulerConfig,
): JobPort {
  return {
    stepName: DISCOVERY_STEP_NAME,
    execute(context: JobPortContext): Promise<JobResultEnvelope> {
      return runJobWithLedger(context, {
        stepName: DISCOVERY_STEP_NAME,
        invoke: () => job.run(config),
        mapResult: mapDiscoveryResult,
      });
    },
  };
}

/**
 * DiscoveryJobResult を MappedEnvelope に変換する。
 *
 * - skipped=true → skipped (分析対象 0 件)
 * - 成功 → succeeded + summary に counts を載せる
 */
export function mapDiscoveryResult(result: DiscoveryJobResult): MappedEnvelope {
  if (result.skipped) {
    return {
      ok: false,
      status: 'skipped',
      summary: 'discovery skipped (no notes in last 7d)',
      nextAction: 'proceed',
    };
  }
  return {
    ok: true,
    status: 'succeeded',
    summary: [
      `noteCount=${result.noteCount}`,
      `newHypotheses=${result.newHypothesesCount}`,
      `lensInsights=${result.lensInsightsCount}`,
      `tokens=${result.tokenUsage}`,
    ].join(', '),
    nextAction: 'proceed',
  };
}
