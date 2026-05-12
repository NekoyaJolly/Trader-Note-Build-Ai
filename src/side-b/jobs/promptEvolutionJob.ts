/**
 * PromptEvolutionJob (Scheduler 連携用の薄いラッパー)
 *
 * SideBScheduler 責務分離リファクタリング PR-4 (Phase 5) で sideBScheduler.ts から
 * 切り出した月次プロンプト進化ジョブ。
 *
 * 移行元 (sideBScheduler.ts):
 * - runPromptEvolutionNow() (約 15 行)
 *
 * 設計上の位置づけ:
 * - 既存の `src/side-b/prompts/registry/promptEvolutionJob.ts` に
 *   `runPromptEvolutionCycle()` 関数として実装が存在する (本体はそちら)
 * - 本ファイルは「Scheduler から呼び出す Job クラス」としての薄いラッパー
 * - 旧 SideBScheduler.runPromptEvolutionNow() のログ整形・lastRun 更新を Job 内に集約
 *
 * 設計書: docs/side-b/sideb_scheduler_refactor_agent_prompt.md Phase 5
 */

import {
  runPromptEvolutionCycle,
  type PromptEvolutionResult,
} from '../prompts/registry/promptEvolutionJob';

import type { SideBJobDeps, SideBJobName, SideBJobRunner } from './types';
import type { SideBSchedulerConfig } from './sideBScheduler';

/**
 * Scheduler から呼び出すための PromptEvolutionJob 薄ラッパー。
 *
 * 本体は `prompts/registry/promptEvolutionJob.runPromptEvolutionCycle()`。
 * 本クラスは:
 * - 起動ログ出力
 * - エージェント別サマリログ出力
 * - lastPromptEvolutionRun の更新コールバック
 * を担う。
 */
export class PromptEvolutionJob
  implements SideBJobRunner<SideBSchedulerConfig, PromptEvolutionResult>
{
  readonly name: SideBJobName = 'prompt-evolution';

  private readonly deps: SideBJobDeps;
  private readonly onCompleted?: (completedAt: Date) => void;

  constructor(deps: SideBJobDeps, options: { onCompleted?: (completedAt: Date) => void } = {}) {
    this.deps = deps;
    this.onCompleted = options.onCompleted;
  }

  /**
   * 月次プロンプト進化を実行。
   *
   * - 全エージェントの experimental 成績を評価
   * - 昇格候補のレポートを返す (自動昇格はしない = 人間承認は approveCli.ts 経由)
   * - 成績不振の experimental は reject
   * - PromptMutationAgent で新 experimental を 3 件/エージェント 生成
   */
  async run(_config: SideBSchedulerConfig): Promise<PromptEvolutionResult> {
    this.deps.log('[PromptEvolution] 月次プロンプト進化を実行');
    const result = await runPromptEvolutionCycle();
    this.onCompleted?.(new Date());
    for (const r of result.reports) {
      this.deps.log(
        `[PromptEvolution] agent=${r.agentName} new=${r.newExperimentalIds.length} rejected=${r.rejectedIds.length} promotionCandidates=${r.promotionCandidates.length} errors=${r.errors.length}`,
      );
    }
    return result;
  }
}
