/**
 * Filter Evolution Phase C: lessons prompt 注入の共有 helper。
 *
 * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.C
 *
 * `agentMemory.lessonsBySymbol` を mutation/crossover の user prompt に注入するための
 * 共通ロジック。CrossoverAgent / MutationAgent の両方から import する形にして、
 * agent 間の結合 (= 一方が他方の internal helper に依存する) を避ける。
 *
 * - PR #141 Copilot review #1/#2 対応: 元は CrossoverAgent.ts に定義していたが、
 *   MutationAgent から CrossoverAgent を import する構造になっていたため切り出した。
 */

import { agentMemory } from '../agent/agentMemory';

/**
 * mutation/crossover prompt に注入する lessons の上限件数。
 *
 * token 消費を抑えつつ、確信ルール / 直近 entries / クロスシンボル / 直近負けトレード振り返り
 * を載せられる現実的な値。`agentMemory.getLessonsForStrategy(symbol)` の出力上位 N 件を採用する。
 *
 * `export` しているのでテスト側からも参照可能 (= ハードコード値テストではなく定数参照テスト)。
 */
export const LESSONS_PROMPT_LIMIT = 10;

/**
 * lessons block 生成。
 *
 * - 親 DSL の symbol を `agentMemory.getLessonsForStrategy(symbol)` のキーに使う
 * - lessons が 0 件 / undefined symbol なら null (= prompt に含めない)
 * - 上位 N 件 (= `LESSONS_PROMPT_LIMIT`) で truncate
 * - 観測ログ ([CrossoverAgent] / [MutationAgent] Phase C lessons injected) は呼び出し側で出す
 *
 * @returns lessons block (= 改行始まりの文字列、user prompt 末尾に連結する想定) / null
 */
export function buildLessonsPromptBlock(symbol: string | undefined): {
  block: string;
  count: number;
} | null {
  if (!symbol) return null;
  const lessons = agentMemory.getLessonsForStrategy(symbol);
  if (lessons.length === 0) return null;
  const truncated = lessons.slice(0, LESSONS_PROMPT_LIMIT);
  const block =
    `\n\n過去の学び (= 直近の Reflection AI / 確信ルールから抽出、symbol=${symbol}、` +
    `上位 ${truncated.length}/${lessons.length} 件):\n${truncated.join('\n')}`;
  return { block, count: truncated.length };
}
