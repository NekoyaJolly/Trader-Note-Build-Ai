/**
 * Step A-4: BullBearDebate の優勢判定を PlanAI シナリオに hookup する純粋関数。
 *
 * 純粋関数として切り出した理由 (PR #271 Copilot review #2):
 * - aiOrchestrator.generatePlan 内では NODE_ENV='test' で Debate 自体がスキップされ、
 *   この hookup ロジックが Jest で実質未実行 (= 回帰検知不能) になる。
 * - 純粋関数化することで入力を固定したユニットテストが書ける。
 *
 * NaN ガード理由 (PR #271 Copilot review #1):
 * - planAIService の出力バリデーションは scenario.confidence の型/範囲を検証しないため、
 *   欠損や非数値が来ると NaN が入り、JSON 保存時に null になって後段/UI を壊す可能性。
 * - 演算前に number 確認 + 0-100 クランプで安全化。
 */

import type { AITradeScenario } from '../models';

export interface DebateDirectionInput {
  /** Debate output が示す優勢方向 ('long' / 'short' / 'neutral')。 */
  preferredDirection: 'long' | 'short' | 'neutral';
  /** Debate output の確信度 (0-100 想定)。 */
  preferredConfidence: number;
}

export interface DebateHookupResult {
  /** 採用方向に基づいて confidence / warnings を調整したシナリオ配列。 */
  adjustedScenarios: AITradeScenario[];
  /** Plan 全体の warnings に追加すべきメッセージ (= `[シナリオ名] 内容`)。 */
  aggregatedWarnings: string[];
}

/**
 * 入力 confidence を 0-100 範囲の有限数値にクランプする。NaN / Infinity / 範囲外は 0 を返す。
 * 型は `number` (AITradeScenario.confidence と一致) だが、PlanAI 出力の Zod 検証が
 * 未実装のため runtime で NaN / Infinity が紛れ込む可能性に備える。
 */
function safeClampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/**
 * Debate 優勢判定を PlanAI 生成シナリオに hookup する。
 *
 * - `preferred === 'neutral'`: 全シナリオに「中立判定」warning を付与 (confidence は据置)
 * - `scenario.direction !== preferred`: confidence を 50% 抑制 + warning 付与
 * - `scenario.direction === preferred`: 据置 (= ログ目的の no-op)
 *
 * 元の `scenarios` 配列は変更しない (= shallow copy で新規配列を返す)。
 */
export function applyDebateDirectionToScenarios(
  scenarios: AITradeScenario[],
  debate: DebateDirectionInput,
): DebateHookupResult {
  const adjustedScenarios: AITradeScenario[] = [];
  const aggregatedWarnings: string[] = [];

  for (const scenario of scenarios) {
    const adjusted: AITradeScenario = { ...scenario };

    if (debate.preferredDirection === 'neutral') {
      const warn = `BullBear Debate: 中立判定 (confidence ${String(debate.preferredConfidence)}%)`;
      adjusted.warnings = [...(scenario.warnings ?? []), warn];
      aggregatedWarnings.push(`[${scenario.name}] ${warn}`);
    } else if (scenario.direction !== debate.preferredDirection) {
      const safeConf = safeClampConfidence(scenario.confidence);
      const newConf = Math.round(safeConf * 0.5);
      adjusted.confidence = newConf;
      const warn =
        `BullBear Debate 採用方向: ${debate.preferredDirection} ` +
        `(confidence ${String(debate.preferredConfidence)}%) と不一致、` +
        `confidence ${String(safeConf)} → ${String(newConf)} に抑制`;
      adjusted.warnings = [...(scenario.warnings ?? []), warn];
      aggregatedWarnings.push(`[${scenario.name}] ${warn}`);
    }

    adjustedScenarios.push(adjusted);
  }

  return { adjustedScenarios, aggregatedWarnings };
}
