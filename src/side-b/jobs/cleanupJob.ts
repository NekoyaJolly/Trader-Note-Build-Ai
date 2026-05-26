/**
 * CleanupJob
 *
 * SideBScheduler 責務分離リファクタリング PR-4 (Phase 5) で sideBScheduler.ts から
 * 切り出した cleanup ジョブ。
 *
 * 移行元 (sideBScheduler.ts):
 * - executePlanJob() 内の cleanup 部分 (約 40 行、L1341-1376 相当)
 *
 * 含まれる処理:
 * - dataCleanupService.executeCleanup() 呼び出し
 *   (期限切れリサーチ / 古いプラン / 古いトレードの削除)
 * - 削除件数のログ出力
 * - EvolutionInstanceCarry retention 連携 (EvolutionJob 経由)
 * - lastCleanupRun の更新
 *
 * 設計上の位置づけ:
 * - 旧実装では「プラン生成後の autoCleanup フラグ + 24h ガード」で実行されていた
 * - Job 化により、cleanup のトリガー条件 (24h ガード) を Job 内に集約
 * - cleanup 単体テスト可能に
 *
 * 設計書: docs/side-b/sideb_scheduler_refactor_agent_prompt.md Phase 5
 */

import { executeCleanup, type CleanupConfig } from '../services/dataCleanupService';
import { pruneOldCacheEntries } from '../agents/specialists/indicatorSeriesCacheRepository';

import type { SideBJobDeps, SideBJobName, SideBJobRunner } from './types';
import type { SideBSchedulerConfig } from './sideBScheduler';
import type { EvolutionCarryRetentionResult } from './evolutionJob';

/**
 * IndicatorSeriesCache の各 key (= symbol×timeframe×indicator×params×field) ごとに
 * 保持する件数。cron 4h ごとに 1 件溜まるので 12 件 = 2 日分の history。
 *
 * Step 3b で「前回 / 前々回」しか参照しないため最低 3 件で動くが、analysis-engine
 * 障害時のフォールバック (= Step 4 で実装、cache + 現 OHLCV から推定) で多くの履歴が
 * 役立つ可能性があるため、当面 12 件保持で運用観察。
 */
const INDICATOR_CACHE_KEEP_COUNT = 12;

/**
 * CleanupJob の戻り値型。
 */
export interface CleanupJobResult {
  /** cleanup を実行したかどうか (24h ガードで skip された場合 false) */
  executed: boolean;
  /** 削除されたリサーチ件数 (executed=false の場合 0) */
  expiredResearchCount: number;
  /** 削除された古いプラン件数 */
  oldPlansCount: number;
  /** 削除された古いトレード件数 */
  oldTradesCount: number;
  /** EvolutionInstanceCarry retention の結果 */
  carryRetention: EvolutionCarryRetentionResult;
  /**
   * IndicatorSeriesCache の retention 結果 (Phase 6.8 Step 3c)。
   * 削除件数 + 失敗時のエラーメッセージ (= 失敗しても本体 cleanup は続行)。
   */
  indicatorCacheRetention: { deleted: number; error?: string };
  /** エラーがあった場合のメッセージ (executed=true でも一部失敗ありえる) */
  error?: string;
}

/**
 * Cleanup Job が必要とする依存。
 *
 * EvolutionInstanceCarry retention は EvolutionJob.runCarryRetention() に
 * delegation するため、Scheduler 側に factory を持ってもらう。
 */
export interface CleanupJobServices {
  /** EvolutionJob.runCarryRetention() を呼ぶための delegation */
  runEvolutionCarryRetention: () => Promise<EvolutionCarryRetentionResult>;
}

/**
 * 1 日に 1 回 (24h 間隔) のクリーンアップを担当する Job。
 *
 * 旧実装ではプラン生成後の autoCleanup フラグで実行されていたが、Job 化により
 * トリガー条件を Job 内に集約。Scheduler は `shouldRun()` で実行可否を判定し
 * てから `run()` を呼ぶ。
 */
export class CleanupJob
  implements SideBJobRunner<SideBSchedulerConfig, CleanupJobResult>
{
  readonly name: SideBJobName = 'cleanup';

  private readonly deps: SideBJobDeps;
  private readonly servicesFactory: () => CleanupJobServices;
  private readonly onCompleted?: (completedAt: Date) => void;

  constructor(
    deps: SideBJobDeps,
    options: {
      servicesFactory: () => CleanupJobServices;
      onCompleted?: (completedAt: Date) => void;
    },
  ) {
    this.deps = deps;
    this.onCompleted = options.onCompleted;
    this.servicesFactory = options.servicesFactory;
  }

  /**
   * 24h ガードを判定する。旧実装の `cleanupDue` 判定と完全互換。
   *
   * @param lastCleanupRun Scheduler が保持する最終実行日時 (undefined = 一度も実行していない)
   */
  static shouldRun(lastCleanupRun: Date | undefined): boolean {
    if (!lastCleanupRun) return true;
    return Date.now() - lastCleanupRun.getTime() > 24 * 60 * 60 * 1000;
  }

  /**
   * クリーンアップ本体。autoCleanup チェックは呼び出し側の責任 (Scheduler が判定済み)。
   *
   * 旧実装と互換維持のため:
   * - executeCleanup を呼び、戻り値のサマリログを出力
   * - 削除件数 > 0 の場合のみログ
   * - EvolutionInstanceCarry retention を呼ぶ (失敗してもキャッチして CleanupJobResult に記録)
   */
  async run(config: SideBSchedulerConfig): Promise<CleanupJobResult> {
    const result: CleanupJobResult = {
      executed: false,
      expiredResearchCount: 0,
      oldPlansCount: 0,
      oldTradesCount: 0,
      carryRetention: { deleted: 0 },
      indicatorCacheRetention: { deleted: 0 },
    };

    try {
      this.deps.log('クリーンアップを実行中...');
      const cleanupConfig: Partial<CleanupConfig> = {
        cleanupExpiredResearch: true,
        cleanupOldPlans: true,
        planRetentionDays: config.planRetentionDays,
        cleanupOldTrades: true,
        tradeRetentionDays: config.tradeRetentionDays,
      };
      const cleanupResult = await executeCleanup(cleanupConfig);

      result.executed = true;
      result.expiredResearchCount = cleanupResult.expiredResearchCount;
      result.oldPlansCount = cleanupResult.oldPlansCount;
      result.oldTradesCount = cleanupResult.oldTradesCount;

      const totalDeleted =
        cleanupResult.expiredResearchCount +
        cleanupResult.oldPlansCount +
        cleanupResult.oldTradesCount;
      if (totalDeleted > 0) {
        this.deps.log(
          `クリーンアップ完了: リサーチ ${cleanupResult.expiredResearchCount}件, ` +
            `プラン ${cleanupResult.oldPlansCount}件, ` +
            `トレード ${cleanupResult.oldTradesCount}件 削除`,
        );
      }

      // Filter Evolution Phase B-3: EvolutionInstanceCarry retention 14 日。
      // 例外は EvolutionJob 側でキャッチされ result.error で返る (上には投げない)。
      const services = this.servicesFactory();
      result.carryRetention = await services.runEvolutionCarryRetention();

      // Phase 6.8 Step 3c: IndicatorSeriesCache retention (各 key 直近 12 件保持)。
      // 失敗してもキャッチして cleanup 全体は続行 (= cleanup 一部失敗で他の retention を
      // 止めない方針、EvolutionInstanceCarry retention と同じ扱い)。
      try {
        const deleted = await pruneOldCacheEntries({ keepCount: INDICATOR_CACHE_KEEP_COUNT });
        result.indicatorCacheRetention = { deleted };
        if (deleted > 0) {
          this.deps.log(`IndicatorSeriesCache retention 完了: ${deleted}件削除`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Scheduler errors[] / JobPort failed 判定に乗せるため log + addError 両方で記録
        // (PR #265 Copilot review #4 対応、EvolutionInstanceCarry retention と同等)
        this.deps.log(`IndicatorSeriesCache retention 失敗: ${msg}`);
        this.deps.addError(`IndicatorSeriesCache retention エラー: ${msg}`);
        result.indicatorCacheRetention = { deleted: 0, error: msg };
      }

      this.onCompleted?.(new Date());
    } catch (error) {
      const message = error instanceof Error ? error.message : '不明なエラー';
      this.deps.addError(`クリーンアップエラー: ${message}`);
      result.error = message;
    }

    return result;
  }
}
