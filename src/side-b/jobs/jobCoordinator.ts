/**
 * Side-B ジョブ実行コーディネーター
 *
 * 排他制御・実行ログ・エラー処理を集約する。業務ロジックは持たない。
 * SideBScheduler 責務分離リファクタリング (PR-1) の最小実装として開始し、
 * 後続 PR (PR-2 以降) で必要に応じて拡張する (timeout / retry など)。
 *
 * 設計書: docs/side-b/sideb_scheduler_refactor_agent_prompt.md §共通インターフェース案
 */

import type { SideBJobName, SideBJobDeps } from './types';

/**
 * 各ジョブの排他制御フラグ。
 *
 * 既存 SideBScheduler では `isEvolutionRunning` 等の private フィールドで
 * 排他制御していた。Job 化後は本 coordinator に集約する。
 */
type RunningFlags = Partial<Record<SideBJobName, boolean>>;

/**
 * ジョブの排他制御・ログを集約する coordinator。
 *
 * 業務ロジックは持たない: 「いつ実行できるか」「実行中のフラグ管理」「ログ整形」
 * のみを担当する。実行する処理は呼び出し側 (fn) で渡す。
 */
export class SideBJobCoordinator {
  private readonly running: RunningFlags = {};
  private readonly deps: SideBJobDeps;

  constructor(deps: SideBJobDeps) {
    this.deps = deps;
  }

  /**
   * ジョブを排他制御の下で実行する。
   *
   * - 同じ jobName が既に実行中なら `null` を返し、二重起動を抑止する
   * - 実行開始 / 完了 / 失敗を log / addError 経由で記録する
   * - 例外は呼び出し側に再 throw する (= 既存挙動互換、エラーハンドリングは fn 側で行う)
   *
   * @returns fn の結果、または既に実行中の場合 `null`
   */
  async run<T>(jobName: SideBJobName, fn: () => Promise<T>): Promise<T | null> {
    if (this.running[jobName]) {
      this.deps.log(`[Job:${jobName}] 既に実行中のためスキップ`);
      return null;
    }

    this.running[jobName] = true;
    const startedAt = Date.now();
    this.deps.log(`[Job:${jobName}] 開始`);

    try {
      const result = await fn();
      const elapsed = Date.now() - startedAt;
      this.deps.log(`[Job:${jobName}] 完了 (${elapsed}ms)`);
      return result;
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      const msg = err instanceof Error ? err.message : String(err);
      this.deps.addError(`[Job:${jobName}] 失敗 (${elapsed}ms): ${msg}`);
      throw err;
    } finally {
      this.running[jobName] = false;
    }
  }

  /**
   * ジョブが現在実行中かを返す。Scheduler の dispatcher で「既に走っているなら
   * skip」判定に使う想定 (将来用)。
   */
  isRunning(jobName: SideBJobName): boolean {
    return this.running[jobName] === true;
  }
}
