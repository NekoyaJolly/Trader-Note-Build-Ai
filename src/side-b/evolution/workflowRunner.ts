/**
 * Evolution 実行基盤の差し替え境界 (PR-5 / Phase 8: ADK 導入判断のための境界整理)
 *
 * SideBScheduler 責務分離リファクタリングの最終 PR で導入する**型定義のみ**のモジュール。
 * 現時点では実装を行わない (= Step 1〜5 で必要になった時点で実装を加える)。
 *
 * ## 設計意図
 *
 * 将来 ADK (Google Agent Development Kit) を Evolution 系に PoC として導入する場合、
 * 既存の `EvolutionLoop` + `runMultiGenerationEvolutionV1` 経由の実装と切り替えられる
 * ようにするための境界を予め用意する。
 *
 * - 現行実装 (PR-1 で切り出した EvolutionJob 内) は `LocalEvolutionWorkflowRunner` として扱う
 * - ADK 採用時は `AdkEvolutionWorkflowRunner` を別実装として追加
 * - EvolutionJob.run() は `EvolutionWorkflowRunner` を受け取って実行 (将来の改修ポイント)
 *
 * ## 現行 PR (PR-5) でやらないこと
 *
 * - EvolutionJob の実装を本 interface に切り替えること (= 既存挙動完全互換維持)
 * - ADK の package 追加 (`@google/adk` の install) — ADK_ADOPTION.md §5 撤退基準 / Step 1 着手前判断
 * - `AdkEvolutionWorkflowRunner` の実装
 *
 * ## 関連設計書
 *
 * - `docs/side-b/sideb_scheduler_refactor_agent_prompt.md` Phase 8
 * - `docs/architecture/ADK_ADOPTION.md` §2 採用範囲 + §5 撤退基準
 * - `docs/architecture/STEP_0_ADK_INSTALL_DRYRUN.md` § peer dep 対応方針
 */

import type { MultiGenerationRunReport } from './multiGenerationRunner';
import type { GenerationReport } from './EvolutionLoop';

/**
 * Evolution 実行の入力オプション。
 *
 * EvolutionJob の現行 run() が消費する config 値の minimum set を抽出。
 * 将来の AdkEvolutionWorkflowRunner も同じ形を受け取ることで差し替え可能にする。
 */
export interface EvolutionRunOptions {
  /** 対象レジーム名 */
  regime: string;
  /** 世代数 (1〜MULTI_GENERATION_DEFAULTS.maxGenerations) */
  generations: number;
  /** Adaptive Repair / Mutation Budget を有効化するか */
  adaptiveRepairBudget: boolean;
  /** Quality-Diversity Archive を有効化するか */
  qualityDiversityArchive: boolean;
  /** QD-Archive parent injection 上限 */
  qualityDiversityArchiveParentLimit: number;
}

/**
 * Evolution 実行の結果。
 *
 * 単世代経路では `MultiGenerationRunReport` を持たず、`generationReport` のみ返す。
 * Multi-gen 経路では `runReport` を返す。両モード共通の判別 union 型。
 */
export type EvolutionRunResult =
  | {
      mode: 'single-gen';
      generationReport: GenerationReport;
    }
  | {
      mode: 'multi-gen';
      runReport: MultiGenerationRunReport;
    };

/**
 * Evolution 実行基盤の差し替え境界。
 *
 * EvolutionJob は将来本 interface を inject 可能にして、現行実装 (LocalEvolutionWorkflowRunner)
 * と ADK 実装 (AdkEvolutionWorkflowRunner) を切り替えられるようにする。
 *
 * **現行 PR (PR-5) では本 interface の implements を作らない**。
 * Step 1 以降の ADK PoC で必要になった時点で:
 * - `LocalEvolutionWorkflowRunner` (現行 EvolutionLoop ラップ) を実装
 * - EvolutionJob.run() の中で本 runner を呼ぶ形に refactor
 * - PoC として `AdkEvolutionWorkflowRunner` を別 PR で追加
 *
 * を行う。
 */
export interface EvolutionWorkflowRunner {
  run(options: EvolutionRunOptions): Promise<EvolutionRunResult>;
}
