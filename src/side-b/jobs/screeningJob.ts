/**
 * ScreeningJob
 *
 * SideBScheduler 責務分離リファクタリング PR-2 (Phase 3) で sideBScheduler.ts から
 * 切り出した日次スクリーニングジョブ。
 *
 * 移行元:
 * - sideBScheduler.ts の `runScreeningNow()` (約 60 行)
 *
 * 既存挙動互換のため、戻り値形 / ログ文言 / PDCA 通知 key (`'screening'`) /
 * lensSnapshot 取得 / `screeningMaxPerRun` 制限 / period override はすべて維持する。
 *
 * 設計書: docs/side-b/sideb_scheduler_refactor_agent_prompt.md Phase 3
 */

import { edgeLedger } from '../ledger';
import { screeningOrchestrator } from '../bridge';
import { agentMemory } from '../agent/agentMemory';
import { pdcaLoop } from '../agent';

import type { SideBJobDeps, SideBJobName, SideBJobRunner } from './types';
import type { SideBSchedulerConfig } from './sideBScheduler';

/**
 * ScreeningJob.run() の追加オプション。
 *
 * 旧 `runScreeningNow(options?)` の引数と完全互換。
 */
export interface ScreeningJobOptions {
  /** config.screeningMaxPerRun の override (運用側で 1 回分の処理量を絞る) */
  limit?: number;
  /** BT 対象期間 override (env SCREENING_PERIOD_DAYS のデフォルトを上書き) */
  period?: { start: string; end: string };
}

/**
 * ScreeningJob の戻り値型。
 *
 * 旧 `runScreeningNow()` 戻り値と完全互換。
 */
export interface ScreeningJobResult {
  processed: number;
  passed: number;
  rejected: number;
  notTestable: number;
  errors: number;
}

/**
 * 日次スクリーニング (Phase 4b 縮小版 + Critical-4 段階 1.6) を担当する Job。
 *
 * unverified 仮説を最大 `limit` 件取り出し、ScreeningOrchestrator.runScreening で順次評価する。
 * 各仮説の失敗は他仮説に影響させない (best-effort)。
 */
export class ScreeningJob
  implements SideBJobRunner<SideBSchedulerConfig, ScreeningJobResult>
{
  readonly name: SideBJobName = 'screening';

  private readonly deps: SideBJobDeps;
  /**
   * 最終実行日時の更新を Scheduler 側に伝えるためのコールバック。
   * Scheduler の `lastScreeningRun` フィールドを更新する。
   */
  private readonly onCompleted?: (completedAt: Date) => void;

  constructor(deps: SideBJobDeps, options: { onCompleted?: (completedAt: Date) => void } = {}) {
    this.deps = deps;
    this.onCompleted = options.onCompleted;
  }

  /**
   * `SideBJobRunner` 規約に従った run() メソッド。
   *
   * 追加 options を取らないシンプル形。options 付きの呼び出しは `runWithOptions()` を使う。
   */
  async run(config: SideBSchedulerConfig): Promise<ScreeningJobResult> {
    return this.runWithOptions(config);
  }

  /**
   * スクリーニング本体。旧 `SideBScheduler.runScreeningNow(options?)` の中身を
   * 完全互換で実装。
   *
   * 戻り値形 `{ processed, passed, rejected, notTestable, errors }` は変更しない。
   * `pdcaLoop.notifyValidationBatchComplete('screening', summary)` の呼び出しも維持。
   */
  async runWithOptions(
    config: SideBSchedulerConfig,
    options?: ScreeningJobOptions,
  ): Promise<ScreeningJobResult> {
    const limit = Math.max(1, options?.limit ?? config.screeningMaxPerRun);
    const periodLog = options?.period
      ? ` period=${options.period.start}〜${options.period.end}`
      : '';
    this.deps.log(`[Screening] 事前スクリーニングを開始 (上限 ${limit}件)${periodLog}`);

    const summary: ScreeningJobResult = {
      processed: 0,
      passed: 0,
      rejected: 0,
      notTestable: 0,
      errors: 0,
    };

    try {
      const unverified = await edgeLedger.findByStatus('unverified');
      const targets = unverified.slice(0, limit);
      this.deps.log(`[Screening] 対象仮説: ${targets.length}件`);

      for (const hyp of targets) {
        summary.processed++;
        try {
          const symbol = hyp.symbols[0];
          const lensSnapshot = symbol ? agentMemory.getCurrentLensSnapshot(symbol) : undefined;
          const result = await screeningOrchestrator.runScreening(hyp.id, {
            lensSnapshot,
            ...(options?.period ? { period: options.period } : {}),
          });

          if (result.verdict === 'screening_passed') {
            summary.passed++;
            this.deps.log(
              `[Screening] passed: ${hyp.id} pf=${result.metrics.pf.toFixed(3)} winRate=${result.metrics.winRate.toFixed(3)} trades=${result.metrics.tradeCount}`,
            );
          } else if (result.verdict === 'rejected') {
            summary.rejected++;
            this.deps.log(
              `[Screening] rejected: ${hyp.id} reasons=[${result.reasons.join(', ')}]`,
            );
          } else {
            summary.notTestable++;
            this.deps.log(`[Screening] not_testable: ${hyp.id} reason=${result.reason}`);
          }
        } catch (err) {
          summary.errors++;
          const message = err instanceof Error ? err.message : String(err);
          this.deps.addError(`[Screening] ${hyp.id} 失敗: ${message}`);
        }
      }
      this.onCompleted?.(new Date());
      this.deps.log(
        `[Screening] 完了: processed=${summary.processed} passed=${summary.passed} rejected=${summary.rejected} not_testable=${summary.notTestable} errors=${summary.errors}`,
      );
      try {
        pdcaLoop.notifyValidationBatchComplete('screening', summary);
      } catch {
        /* PDCAループ未起動時は無視 */
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.addError(`[Screening] 仮説取得失敗: ${message}`);
    }

    return summary;
  }
}
