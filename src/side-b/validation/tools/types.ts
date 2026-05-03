/**
 * ValidationTool 共通型 (Phase 4c + Critical-4 段階 4a.1)
 *
 * 4 ツール (screening / WalkForward / MonteCarlo / BuyAndHold) は **analysis-engine 経由
 * の `ScreeningBacktestRun` を入力源とする `kind: 'hypothesis'` 経路のみで動く**。
 *
 * 段階 4a.1 で旧 `kind: 'strategy'` 経路 (進化計算用 SurrogateFitnessSimulator 結果を直接
 * 受け取る経路) は撤廃済み。本番判定 (confirmed 昇格 / ユーザー表示 / 永続化) は常に
 * analysis-engine の正式 BT 結果のみを正とする (Critical-4 §13)。
 *
 * 進化計算側 (`EvolutionLoop`) は `SurrogateFitnessSimulator.evaluateFitness()` を直接呼ぶ
 * (validation tools を経由しない) ため、本ファイルから戦略検証用 union を持つ必要がない。
 *
 * @see docs/design/phase_4c_specification.md §4.4
 * @see docs/design/critical_4_bt_unification.md §13 / 段階 4a.1
 */

import type { EdgeHypothesis } from '../../models/edgeHypothesis';

export type ValidationAdditionalParamValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly number[]
  | readonly boolean[];

export type ValidationAdditionalParams = Record<string, ValidationAdditionalParamValue>;

// ===========================================
// ツール共通入力 (Critical-4 段階 4a.1: 単一型化、kind: 'strategy' 撤廃済み)
// ===========================================

/** 仮説 + ScreeningBacktestRun (analysis-engine 経由 BT を入力源とする標準径路) */
export interface HypothesisValidationInput {
  kind: 'hypothesis';
  /** 検証対象の仮説 */
  hypothesis: EdgeHypothesis;
  /** 検証対象期間 (ISO8601 日付) */
  period: { start: string; end: string };
  /**
   * Critical-4 段階 1: analysis-engine 経由で実行された ScreeningBacktestRun の ID。
   * MonteCarlo / BuyAndHold / WalkForward の入力源 (trades 配列) を読み込むキー。
   */
  screeningBacktestRunId: string;
  /** ツール独自パラメーター */
  additionalParams?: ValidationAdditionalParams;
}

/**
 * 段階 4a.1 で `kind: 'strategy'` 経路を撤廃したため、`ValidationToolInput` は単一型に。
 * 将来別経路を追加する場合のために型エイリアスは残す (union 化を再導入する余地)。
 */
export type ValidationToolInput = HypothesisValidationInput;

// ===========================================
// ツール共通出力
// ===========================================

/**
 * ツール 1 回分の結果
 *
 * - success=true: ツールが最後まで動き、metrics / passed が有効
 * - success=false: 実行自体が失敗 (error に理由)、passed は常に false
 * - passed: このツール単独の判定 (ConsolidatedValidationReport 側で集約される)
 */
export interface ValidationToolResult {
  /** ツール識別子 (重複検出・レポート表示用) */
  toolName: string;
  /** ツール自体が最後まで動いたか */
  success: boolean;
  /** このツール単独での通過判定 */
  passed: boolean;
  /** 数値・文字列・真偽値のみ許可するフラットな指標バッグ */
  metrics: Record<string, number | string | boolean>;
  /** 結果の人間可読サマリー (テンプレートベース、LLM 不使用) */
  interpretation?: string;
  /** success=false 時の理由 */
  error?: string;
  /** 実行時間 (ms) */
  durationMs: number;
}

// ===========================================
// ツールインターフェース
// ===========================================

export type ValidationToolImplementation = 'native_ts' | 'python_bridge';

export interface ValidationTool {
  readonly name: string;
  readonly implementation: ValidationToolImplementation;
  /** 推奨必須キー */
  readonly requiredInputs: readonly string[];

  /** 実行本体 */
  execute(input: ValidationToolInput): Promise<ValidationToolResult>;

  /** 呼び出し可能状態か (Python コンテナ起動確認等) */
  isAvailable(): Promise<boolean>;
}
