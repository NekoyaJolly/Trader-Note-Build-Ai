/**
 * Golden Path 1-cycle smoke (再利用可能 check スクリプト、scripts/check/ 配下)
 *
 * 目的:
 *   - SideBScheduler 経由を経ず、bridge `runScheduledOrchestratedCycle` を
 *     `forceEnabled: true` / `jobs: {}` (全 step skip) で直接叩く
 *   - AgentRun / AgentRunStep に何が書き込まれるかを観察する
 *   - 市場依存 Job (Plan / Monitor) は wire しないので週末でも安全
 *
 * 実行: npx tsx scripts/check/golden-path-smoke.ts
 *
 * 用途: Job adapter wire-up 進捗のたびに 1 cycle 観測したい場面 (Step 5 着手前後)
 * で再利用する。本番経路 (cron) には組み込まない。`scripts/README.md` §3 登録表
 * を参照。削除条件は登録表参照。
 */

import 'dotenv/config';

import { runScheduledOrchestratedCycle } from '../../src/side-b/jobs/sideBSchedulerOrchestratorBridge';

async function main(): Promise<void> {
  console.log('[golden-path-smoke] start');
  const startedAt = Date.now();
  const bridgeResult = await runScheduledOrchestratedCycle({
    forceEnabled: true,
    jobs: {},
  });

  console.log(`[golden-path-smoke] kind=${bridgeResult.kind}`);
  if (bridgeResult.kind === 'disabled') {
    console.log('[golden-path-smoke] DISABLED (forceEnabled 経路に入らなかった)');
    return;
  }

  const { result } = bridgeResult;
  const elapsed = Date.now() - startedAt;
  console.log(JSON.stringify({
    elapsedMs: elapsed,
    runId: result.run.id,
    runKind: result.run.kind,
    runStatus: result.run.status,
    triggeredBy: result.run.triggeredBy,
    finalStatus: result.finalStatus,
    idempotentReuse: result.idempotentReuse,
    summary: result.run.summary,
    errorCode: result.run.errorCode,
    stepEnvelopeCount: result.stepEnvelopes.length,
    stepEnvelopes: result.stepEnvelopes.map((e) => {
      if ((e as { kind?: string }).kind === 'skipped') {
        const skip = e as { kind: 'skipped'; stepName: string; reason: string };
        return { kind: 'skipped', stepName: skip.stepName, reason: skip.reason };
      }
      const env = e as { stepName?: string; status?: string; summary?: string; errorCode?: string };
      return {
        kind: 'job-result',
        stepName: env.stepName,
        status: env.status,
        summary: env.summary,
        errorCode: env.errorCode,
      };
    }),
    draftsCreated: result.drafts?.length ?? 0,
  }, null, 2));
}

void main().then(
  () => {
    console.log('[golden-path-smoke] done');
    process.exit(0);
  },
  (err: unknown) => {
    console.error('[golden-path-smoke] failed:', err);
    process.exit(1);
  },
);
