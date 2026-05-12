/**
 * Side-B ジョブ共通型定義
 *
 * SideBScheduler 責務分離リファクタリング (PR-1) で導入。
 * 個別ジョブの実装は各 `<name>Job.ts` ファイルに置き、本ファイルは
 * 共通インターフェースだけを定義する。
 *
 * 設計書: docs/side-b/sideb_scheduler_refactor_agent_prompt.md
 */

/**
 * Side-B ジョブ名 (= dispatch 用の識別子)。
 *
 * SideBScheduler が cron interval 内で呼び出すジョブを明示的に列挙する。
 * 新規ジョブを追加する場合は本型に追記してから実装する。
 */
export type SideBJobName =
  | 'monitor'
  | 'plan-generation'
  | 'discovery'
  | 'screening'
  | 'full-validation'
  | 'evolution'
  | 'evolution-carry-retention'
  | 'prompt-evolution'
  | 'cleanup'
  | 'summary';

/**
 * ジョブ実行結果の最小共通形。
 *
 * 既存テストが期待する戻り値形 (例: runEvolutionNow の `{ regimeReports, errors }`)
 * とは異なるため、各ジョブは独自の TResult を持つ。本型は「失敗時のフォールバック」
 * や「将来の統一」用の最小形と位置付ける。
 *
 * 任意の追加情報を持たせる場合は、各 Job 固有の TResult 型を使い、本型 `data` フィールドは
 * 設けない (AGENTS.md §2: any/unknown 禁止方針との整合)。
 */
export interface SideBJobResult {
  success: boolean;
  message?: string;
  errors?: string[];
}

/**
 * 各ジョブの共通契約。
 *
 * TConfig はジョブごとに必要な設定形状 (多くの場合 `SideBSchedulerConfig`)。
 * TResult はジョブ固有の戻り値形 (例: `EvolutionJobResult`)。
 *
 * TConfig はデフォルト型を持たない (= 実装側で具体型を必ず指定する。AGENTS.md §2 の
 * unknown 禁止方針と整合)。TResult のデフォルトは最小共通形 `SideBJobResult`。
 */
export interface SideBJobRunner<TConfig, TResult = SideBJobResult> {
  readonly name: SideBJobName;
  run(config: TConfig): Promise<TResult>;
}

/**
 * Scheduler から Job へ渡すコールバック群。
 *
 * Job は Scheduler の private state (errors[], log 経路) に直接アクセスせず、
 * 本コールバックを通じて記録する。これにより:
 * - Job 単体テストで Scheduler 全体を立ち上げる必要がない
 * - getStatus().errors への記録経路を維持できる (sideBScheduler.ts §6 互換)
 */
export interface SideBJobDeps {
  /** Scheduler の errors[] にエラーを追加する。タイムスタンプは Scheduler 側で付与。 */
  addError(message: string): void;
  /** Scheduler 名前空間のログを出力する (`[SideBScheduler] xxx`)。 */
  log(message: string): void;
}
