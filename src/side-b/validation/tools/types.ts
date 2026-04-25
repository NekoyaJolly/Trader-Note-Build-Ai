/**
 * ValidationTool 共通型（Phase 4c + 6.7b 戦略 BT 径路）
 *
 * 4ツール＋仮想 screening を共有。
 * `kind: 'hypothesis' | 'strategy'` で Side-A 連携と DSL 直結を切り替える。
 *
 * @see docs/design/phase_4c_specification.md セクション4.4
 * @see docs/design/phase_6_7b_bt_layer.md
 */

import type { EdgeHypothesis } from '../../models/edgeHypothesis';
import type { StrategyDSL } from '../../strategy_dsl/schema';
import type { DSLBacktestResult } from '../../strategy_dsl/DSLBacktestAdapter';

// ===========================================
// ツール共通入力（union）
// ===========================================

/** 仮説 + Side-A BacktestRun（従来 Phase 4c） */
export interface HypothesisValidationInput {
  kind: 'hypothesis';
  /** 検証対象の仮説 */
  hypothesis: EdgeHypothesis;
  /** Phase 4b でこの仮説から materialize された Side-A TradeNote の ID */
  tradeNoteId: string;
  /** 検証対象期間（ISO8601 日付） */
  period: { start: string; end: string };
  /**
   * Phase 4b で走った Side-A BacktestRun の ID（流用して再走を避ける）
   * MonteCarlo / BuyAndHold / WalkForward（仮説径）の参照先。
   */
  backtestRunId?: string;
  /** ツール独自パラメーター */
  additionalParams?: Record<string, unknown>;
}

/** 戦略 DSL + DSL BT 要約（Phase 6.7b。Side-A 非依存） */
export interface StrategyValidationInput {
  kind: 'strategy';
  strategy: StrategyDSL;
  dslResult: DSLBacktestResult;
  period: { start: string; end: string };
  additionalParams?: Record<string, unknown>;
}

export type ValidationToolInput = HypothesisValidationInput | StrategyValidationInput;

export function isHypothesisValidationInput(
  input: ValidationToolInput,
): input is HypothesisValidationInput {
  return input.kind === 'hypothesis';
}

export function isStrategyValidationInput(
  input: ValidationToolInput,
): input is StrategyValidationInput {
  return input.kind === 'strategy';
}

// ===========================================
// ツール共通出力
// ===========================================

/**
 * ツール1回分の結果
 *
 * - success=true: ツールが最後まで動き、metrics / passed が有効
 * - success=false: 実行自体が失敗（error に理由）、passed は常に false
 * - passed: このツール単独の判定（ConsolidatedValidationReport 側で集約される）
 */
export interface ValidationToolResult {
  /** ツール識別子（重複検出・レポート表示用） */
  toolName: string;
  /** ツール自体が最後まで動いたか */
  success: boolean;
  /** このツール単独での通過判定 */
  passed: boolean;
  /** 数値・文字列・真偽値のみ許可するフラットな指標バッグ */
  metrics: Record<string, number | string | boolean>;
  /** 結果の人間可読サマリー（テンプレートベース、LLM 不使用） */
  interpretation?: string;
  /** success=false 時の理由 */
  error?: string;
  /** 実行時間（ms） */
  durationMs: number;
}

// ===========================================
// ツールインターフェース
// ===========================================

export type ValidationToolImplementation = 'native_ts' | 'python_bridge';

export interface ValidationTool {
  readonly name: string;
  readonly implementation: ValidationToolImplementation;
  /**
   * 推奨必須キー（`kind: hypothesis` 時の主な検証用）。
   * `strategy` 径は execute 内で個別に検証する。
   */
  readonly requiredInputs: readonly string[];

  /** 実行本体 */
  execute(input: ValidationToolInput): Promise<ValidationToolResult>;

  /** 呼び出し可能状態か（Python コンテナ起動確認等） */
  isAvailable(): Promise<boolean>;
}
