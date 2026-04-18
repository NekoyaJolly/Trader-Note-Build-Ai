/**
 * ValidationTool 共通型（Phase 4c）
 *
 * 4つの検証ツール（Screening / WalkForward / MonteCarlo / BuyAndHold）が
 * 共有するインターフェース。BacktesterAgent はこの型だけを知っていれば
 * ツール群を差し替え可能に扱える。
 *
 * 設計原則:
 * - 個別ツールは決定論的実装（LLM 不使用）
 * - Side-A 検証基盤は外部 API としてのみ呼び出し、内部は触らない
 * - success=false でも BacktesterAgent 側で他ツールの結果は保持する
 *   （Promise.allSettled の単位失敗許容）
 *
 * @see docs/design/phase_4c_specification.md セクション4.4
 */

import type { EdgeHypothesis } from '../../models/edgeHypothesis';

// ===========================================
// ツール共通入力
// ===========================================

export interface ValidationToolInput {
    /** 検証対象の仮説 */
    hypothesis: EdgeHypothesis;
    /** Phase 4b でこの仮説から materialize された Side-A TradeNote の ID */
    tradeNoteId: string;
    /** 検証対象期間（ISO8601 日付） */
    period: { start: string; end: string };
    /**
     * Phase 4b で走った Side-A BacktestRun の ID（流用して再走を避ける）
     * MonteCarlo / BuyAndHold はこの runId 経由で事前算出済みのメトリクスを参照する。
     */
    backtestRunId?: string;
    /** ツール独自パラメーター */
    additionalParams?: Record<string, unknown>;
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
    /** 必須入力の列挙（欠落時は success=false を早期に返すための宣言） */
    readonly requiredInputs: (keyof ValidationToolInput)[];

    /** 実行本体 */
    execute(input: ValidationToolInput): Promise<ValidationToolResult>;

    /** 呼び出し可能状態か（Python コンテナ起動確認等） */
    isAvailable(): Promise<boolean>;
}
