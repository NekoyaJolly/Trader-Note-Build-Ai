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
 * 値は実機検証 (gpt-5.4-mini で 10 件戦略生成) を踏まえて段階的に調整する。
 */
export const AI_MAX_TOKENS = {
  /**
   * 重い生成: 10 件 JSON 戦略 / プロンプト全体変異 / メタ分析等。
   * 4096 → 65536 (16x)。reasoning model の思考分も含む。
   * 適用先: MutationAgent / PromptMutationAgent / StrategistAgent / MetaEvolutionAgent
   */
  HEAVY: 65536,
  /**
   * 中程度: 単発戦略生成 / 専門家分析 / トレード判断。
   * 4096 → 32768 (8x)。
   * 適用先: CrossoverAgent / specialistCommon / agentLoop
   */
  MEDIUM: 32768,
} as const;
