/**
 * Critical-3 残スコープ PR-2: 死蔵 8 体エージェント向け recordUsage 共通ヘルパー。
 *
 * 各エージェントが LLM 呼び出し後に出力をスコアリングして PromptRegistry に
 * `recordUsage` する経路を、agent ごとに重複コードを書かずに 1 行で済ませる。
 *
 * 設計原則:
 *   - 失敗時は本体の流れを止めない(既存 HypothesisGeneratorAgent /
 *     specialistCommon の safeRecordUsage パターンを踏襲)
 *   - 失敗時のログは観測値として残すため、warn を出す
 *   - スコア値は 0-1 にクランプ(scoringFunctions.ts の規約どおり)
 *
 * 各経路の挙動:
 *   - active prompt が存在しない(getActive が null) → silent に skip(未 seed 環境用)
 *   - getActive が throw → warn を出して skip(DB 接続失敗の診断用)
 *   - scoring 関数未登録(SCORING_FUNCTIONS に未登録の agentName) → output 有なら score=1 で
 *     後方互換的に記録、output 無しなら score=0 を記録
 *   - recordUsage が throw → warn を出して握りつぶす(本体の流れは止めない)
 *
 * LLM 呼び出し失敗時の取扱い(本 PR 仕様):
 *   - 各エージェント内で LLM 呼び出しが失敗した場合は output=null で本ヘルパーを呼ぶ
 *     → score=0, success=false で記録される
 *   - これは「プロンプトの失敗率」を avgScore 経由で観測するための仕様
 *   - OpenRouter 共通キー前提のため、「キー無し / 401 / レート制限」のような環境問題は
 *     全 12 エージェントで同期して score=0 が積み上がる → 環境問題の診断値として読める
 *
 * 想定使い方:
 *   const verdict = await this.buildVerdict(...);
 *   await recordAgentUsage('strategist', {}, verdict);
 *   return verdict;
 */

import { promptRegistry, type PromptRegistry } from '../prompts/registry/PromptRegistry';
import { getScoringFunction } from '../prompts/abtest/scoringFunctions';

/**
 * scoring + recordUsage を 1 関数で実行する。
 *
 * @param agentName - PromptRegistry に登録されているエージェント名
 * @param scoringInput - スコア関数に渡す input(`{ count }` など、不要なら `{}`)
 * @param output - LLM 出力(`null` は失敗扱いで score=0)
 * @param registry - DI 用(テスト時に差し替え可)
 */
export async function recordAgentUsage(
  agentName: string,
  scoringInput: object,
  output: object | null,
  registry: PromptRegistry = promptRegistry,
): Promise<void> {
  // 1. active prompt の versionId を取得(失敗 / 未 seed は silent skip)
  let versionId: string | null;
  try {
    const active = await registry.getActive(agentName);
    versionId = active?.id ?? null;
  } catch (err) {
    console.warn(
      `[scoringRecorder] ${agentName}: getActive 失敗、recordUsage をスキップ:`,
      err instanceof Error ? err.message : err,
    );
    return;
  }
  if (!versionId) return;

  // 2. スコア計算(scoring 関数未登録なら、output 有=success 扱いで score=1)
  const scoreFn = getScoringFunction(agentName);
  let score: number;
  let success: boolean;
  if (!output) {
    score = 0;
    success = false;
  } else if (scoreFn) {
    const raw = scoreFn(scoringInput, output);
    score = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
    success = score >= 0.3;
  } else {
    score = 1;
    success = true;
  }

  // 3. recordUsage(失敗は warn のみ)
  try {
    await registry.recordUsage(versionId, { score, success });
  } catch (err) {
    console.warn(
      `[scoringRecorder] ${agentName}: recordUsage 失敗 (id=${versionId}):`,
      err instanceof Error ? err.message : err,
    );
  }
}
