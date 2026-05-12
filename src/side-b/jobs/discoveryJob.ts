/**
 * DiscoveryJob
 *
 * SideBScheduler 責務分離リファクタリング PR-4 (Phase 5) で sideBScheduler.ts から
 * 切り出した週次 Discovery ジョブ。
 *
 * 移行元 (sideBScheduler.ts):
 * - runDiscoveryNow() (約 30 行)
 *
 * 含まれる処理:
 * - 直近 7 日分の AI トレードノート取得
 * - DiscoveryAgent.analyze 呼び出し (新規仮説 / レンズ insights / token 集計)
 * - lastDiscoveryRun の更新
 *
 * 設計書: docs/side-b/sideb_scheduler_refactor_agent_prompt.md Phase 5
 */

import { discoveryAgent } from '../agents/DiscoveryAgent';
import { findAITradeNotesInPeriod } from '../repositories/aiNoteRepository';

import type { SideBJobDeps, SideBJobName, SideBJobRunner } from './types';
import type { SideBSchedulerConfig } from './sideBScheduler';

/**
 * DiscoveryJob の戻り値型。旧 runDiscoveryNow() は void 返しだったが、Job 化で
 * 構造化された結果を返す。後方互換のため Scheduler.runDiscoveryNow() は
 * void を返し続ける。
 */
export interface DiscoveryJobResult {
  noteCount: number;
  newHypothesesCount: number;
  lensInsightsCount: number;
  tokenUsage: number;
  /** 処理が分析対象 0 件で早期 return したか */
  skipped: boolean;
}

/**
 * 週次 Discovery を担当する Job。
 *
 * AI トレードノートを期間で取得し DiscoveryAgent で分析。新規仮説 / レンズ insights を生成。
 */
export class DiscoveryJob
  implements SideBJobRunner<SideBSchedulerConfig, DiscoveryJobResult>
{
  readonly name: SideBJobName = 'discovery';

  private readonly deps: SideBJobDeps;
  private readonly onCompleted?: (completedAt: Date) => void;

  constructor(deps: SideBJobDeps, options: { onCompleted?: (completedAt: Date) => void } = {}) {
    this.deps = deps;
    this.onCompleted = options.onCompleted;
  }

  /**
   * Discovery 本体。旧 SideBScheduler.runDiscoveryNow() の中身を完全互換で実装。
   *
   * 直近 7 日間のノートを対象とし、ノートが 0 件ならスキップ。
   * 例外はキャッチして addError に記録 (= 上に投げない、定期実行を止めない)。
   */
  async run(_config: SideBSchedulerConfig): Promise<DiscoveryJobResult> {
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

    this.deps.log(
      `[Discovery] 週次エッジ分析を実行: ${periodStart.toISOString()} 〜 ${periodEnd.toISOString()}`,
    );

    const result: DiscoveryJobResult = {
      noteCount: 0,
      newHypothesesCount: 0,
      lensInsightsCount: 0,
      tokenUsage: 0,
      skipped: false,
    };

    try {
      const notes = await findAITradeNotesInPeriod(
        periodStart.toISOString().split('T')[0],
        periodEnd.toISOString().split('T')[0],
      );
      result.noteCount = notes.length;
      this.deps.log(`[Discovery] 対象ノート数: ${notes.length}`);

      if (notes.length === 0) {
        this.deps.log('[Discovery] 分析対象ノートなし。スキップします。');
        result.skipped = true;
        this.onCompleted?.(new Date());
        return result;
      }

      const report = await discoveryAgent.analyze(notes, periodStart, periodEnd);
      result.newHypothesesCount = report.newHypotheses.length;
      result.lensInsightsCount = report.lensInsights.length;
      result.tokenUsage = report.tokenUsage;
      this.deps.log(
        `[Discovery] 完了: 新規仮説 ${report.newHypotheses.length}個 / レンズ ${report.lensInsights.length}件 / tokens ${report.tokenUsage}`,
      );
      this.onCompleted?.(new Date());
    } catch (err) {
      this.deps.addError(`[Discovery] 失敗: ${err instanceof Error ? err.message : String(err)}`);
    }

    return result;
  }
}
