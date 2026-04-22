/**
 * Phase 6: ABTestRunner の型定義
 *
 * 同一入力を複数のプロンプトバリアントで並行実行し、結果を比較する。
 *
 * スコアリング関数は agent 毎に定義する(§3.1.2):
 * - Phase 6 MVP では以下 4 種のみ実装(Q5 回答)
 *   - hypothesis_generator
 *   - trend_specialist
 *   - oscillator_specialist
 *   - volatility_volume_specialist
 * - 他エージェント分は将来追加
 */

/** 1 バリアントの実行結果。output は任意型。 */
export interface AbVariantResult<TOutput = unknown> {
  promptVersionId: string;
  output: TOutput;
  /** エージェント毎のスコアリング関数が返す 0-1 のスコア */
  score: number;
  durationMs: number;
  /** 例外が発生した場合の詳細(その場合は score=0 として記録) */
  error?: string;
}

/** A/B テスト全体の結果。 */
export interface AbTestResult<TOutput = unknown> {
  agentName: string;
  testedAt: Date;
  variants: AbVariantResult<TOutput>[];
  /** 勝者の promptVersionId。判定不能なら undefined。 */
  winnerVersionId?: string;
  /** 判定の根拠(有意差なし / トップがスコア差 X 以上など) */
  winnerReason?: string;
}

/** バリアント実行の実体: プロンプトを受け取って出力 + スコアを返す。 */
export type VariantExecutor<TInput, TOutput> = (
  promptContent: string,
  input: TInput,
) => Promise<TOutput>;

/** スコアリング関数: 入力と出力からスコア 0-1 を返す(決定論)。 */
export type ScoringFunction<TInput, TOutput> = (
  input: TInput,
  output: TOutput,
) => number;
