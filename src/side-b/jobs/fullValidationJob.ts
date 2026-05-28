/**
 * FullValidationJob
 *
 * SideBScheduler 責務分離リファクタリング PR-2 (Phase 3) で sideBScheduler.ts から
 * 切り出した本格検証ジョブ。
 *
 * 移行元:
 * - sideBScheduler.ts の `runFullValidationNow()` (約 50 行)
 *
 * 既存挙動互換のため、戻り値形 / ログ文言 / PDCA 通知 key (`'full_validation'`) /
 * クールダウン (10 秒) / `fullValidationMaxPerRun` 制限はすべて維持する。
 * `sideBScheduler.fullValidation.test.ts` (6 ケース) を通すことが完了条件。
 *
 * 設計書: docs/side-b/sideb_scheduler_refactor_agent_prompt.md Phase 3
 */

import { edgeLedger } from '../ledger';
import { validateHypothesis } from '../services/hypothesisValidationService';
import { pdcaLoop } from '../agent';

import type { SideBJobDeps, SideBJobName, SideBJobRunner } from './types';
import type { SideBSchedulerConfig } from './sideBScheduler';

/**
 * FullValidationJob の戻り値型。
 *
 * 旧 `runFullValidationNow()` 戻り値と完全互換 (sideBScheduler.fullValidation.test.ts
 * が直接検証)。
 */
export interface FullValidationJobResult {
  processed: number;
  confirmed: number;
  rejected: number;
  notTestable: number;
  errors: number;
}

/**
 * 仮説間クールダウン (Python コンテナ / LLM API 保護)。
 *
 * テストでは `setTimeout` を即時解決にモックしているため、本値は実時間には影響しない。
 * 本番では 10 秒スリープが入る。
 */
const FULL_VALIDATION_COOLDOWN_MS = 10_000;

/**
 * 本格検証 (フル検証) を担当する Job。
 *
 * SideBScheduler から依存注入 (SideBJobDeps) を受け取り、Scheduler の private state
 * (errors[], log 経路) には直接触らない。Scheduler は本 Job のインスタンスを保持し、
 * `runFullValidationNow()` を delegation する。
 */
export class FullValidationJob
  implements SideBJobRunner<SideBSchedulerConfig, FullValidationJobResult>
{
  readonly name: SideBJobName = 'full-validation';

  private readonly deps: SideBJobDeps;
  /**
   * 最終実行日時の更新を Scheduler 側に伝えるためのコールバック。
   * Scheduler の `lastFullValidationRun` フィールドを更新する。
   */
  private readonly onCompleted?: (completedAt: Date) => void;

  constructor(deps: SideBJobDeps, options: { onCompleted?: (completedAt: Date) => void } = {}) {
    this.deps = deps;
    this.onCompleted = options.onCompleted;
  }

  /**
   * 本格検証本体。旧 `SideBScheduler.runFullValidationNow()` の中身を完全互換で実装。
   *
   * 戻り値形 `{ processed, confirmed, rejected, notTestable, errors }` は変更しない。
   * `pdcaLoop.notifyValidationBatchComplete('full_validation', result)` の呼び出しも維持。
   */
  async run(config: SideBSchedulerConfig): Promise<FullValidationJobResult> {
    const limit = Math.max(1, config.fullValidationMaxPerRun);
    this.deps.log(`[FullValidation] 本格検証を開始 (上限 ${limit}件)`);

    const summary: FullValidationJobResult = {
      processed: 0,
      confirmed: 0,
      rejected: 0,
      notTestable: 0,
      errors: 0,
    };

    try {
      // PR #160 Copilot review: findByStatus に limit を渡して DB 側で take を効かせる
      // (件数増加時のメモリ/DB 負荷を抑制)。安全のため取得後も slice で念のため絞る。
      const targets = await edgeLedger.findByStatus('screening_passed', limit);
      const limited = targets.slice(0, limit);
      this.deps.log(`[FullValidation] 対象仮説: ${limited.length}件`);

      for (let i = 0; i < limited.length; i++) {
        const hyp = limited[i];
        summary.processed++;
        try {
          const verdict = await validateHypothesis(hyp.id);
          if (verdict.verdict === 'confirmed') {
            summary.confirmed++;
            this.deps.log(`[FullValidation] confirmed: ${hyp.id}`);
          } else if (verdict.verdict === 'rejected') {
            summary.rejected++;
            this.deps.log(
              `[FullValidation] rejected: ${hyp.id} reasons=[${verdict.baseCriteriaReasons.join(', ')}]`,
            );
          } else {
            summary.notTestable++;
            this.deps.log(`[FullValidation] ${verdict.verdict}: ${hyp.id}`);
          }
        } catch (err) {
          summary.errors++;
          const message = err instanceof Error ? err.message : String(err);
          this.deps.addError(`[FullValidation] ${hyp.id} 失敗: ${message}`);
        }

        // クールダウン (Python コンテナ / LLM API 保護)。最後は不要。
        if (i < limited.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, FULL_VALIDATION_COOLDOWN_MS));
        }
      }

      this.onCompleted?.(new Date());
      this.deps.log(
        `[FullValidation] 完了: processed=${summary.processed} confirmed=${summary.confirmed} rejected=${summary.rejected} not_testable=${summary.notTestable} errors=${summary.errors}`,
      );
      try {
        pdcaLoop.notifyValidationBatchComplete('full_validation', summary);
      } catch {
        /* PDCAループ未起動時は無視 */
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.addError(`[FullValidation] 仮説取得失敗: ${message}`);
    }

    return summary;
  }
}
