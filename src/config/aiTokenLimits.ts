/**
 * AI 呼び出しの maxTokens (= 出力トークン上限) を用途別に定義する。
 *
 * 旧コードは全エージェントで `maxTokens: 4096` をハードコードしていたが、
 * - reasoning モデル (gpt-5 系 / o 系) は思考トークンも上限から差し引かれる
 * - 10 件の戦略 JSON を一度に生成するエージェントは出力分だけで 5k tokens を超える
 * の 2 点で 4096 が短すぎ、出力途中で打ち切られて mutation が 1/10 件だけ返る等の
 * silent な不具合が出ていた。
 *
 * 用途別に値を分離する理由:
 * - 単発戦略生成 (CrossoverAgent 等) と 10 件一括生成 (MutationAgent) は要求量が異なる
 * - TPM (200K/min) 配分上、軽い呼び出しまで HEAVY にすると並列実行で TPM 制限に当たる
 *
 * 2026-05-15 更新 (本番 STEP 5 段階 2 検証で全 AI 呼び出し「応答が空」発覚):
 * - 本番 `AI_MODEL_OVERRIDE_ALL=gpt-5.4-mini` (reasoning モデル) で planAIService /
 *   HypothesisGenerator / BullBearDebate / StrategyThinker / researchAIService /
 *   reflectionAIService / DiscoveryAgent の hardcode 値 (4096 / 2000 / 1500) では
 *   reasoning step 後の出力枠が枯渇し content:null → 全件 fallback
 * - Claude Opus 4.7 / GPT-5 系 100 万トークン時代の感覚で 10 万デフォルトに引き上げ
 *
 * **重要 (model-aware 注意点)**: 本値は AIProvider が `max_tokens` (非 reasoning) /
 * `max_completion_tokens` (reasoning) としてそのまま送る共有 cap。本リポジトリは
 * `AI_MODEL_OVERRIDE_ALL=gpt-5.4-mini` 前提で運用しており、現状の全 caller が
 * reasoning モデル経路を通る想定。非 reasoning モデル (gpt-4o 等の 16K 上限モデル)
 * への切替時は本値が出力上限を超え API エラーになる可能性があるため、AIProvider
 * 層で model に応じた cap を入れるか、本ファイルに NON_REASONING 階層を追加する
 * 対応が必要 (Phase D に記録、別 KICKOFF 候補)。
 */
export const AI_MAX_TOKENS = {
  /**
   * 重い生成: 10 件 JSON 戦略 / 仮説 N 件 / Strategy 構造化等。
   * 65536 → 100000 (10 万デフォルト)。reasoning model の思考分も含む。
   * 適用先: MutationAgent / StrategistAgent / HypothesisGeneratorAgent /
   *   DiscoveryAgent / planAIService / BullBearDebateAgent
   */
  HEAVY: 100000,
  /**
   * 中程度: 単発戦略生成 / 専門家分析 / トレード判断 / 特徴量抽出 / 振り返り 1 件等。
   * 32768 → 50000。reasoning モデルでも 1 件 JSON なら十分。
   * 適用先: CrossoverAgent / specialistCommon / agentLoop / researchAIService /
   *   reflectionAIService / GenerationReflectionAgent
   */
  MEDIUM: 50000,
} as const;
