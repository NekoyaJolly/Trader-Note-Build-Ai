/**
 * Phase 6: エージェント別スコアリング関数
 *
 * Phase 6 MVP の 4 体に加え、Critical-3 残スコープで死蔵 8 体分のスコア関数を追加した。
 * これにより全 12 エージェント分の scoring 関数が揃う(別 PR で各エージェントから
 * recordUsage を呼び出す経路を配線する)。
 *
 * 実装済みエージェント:
 * - hypothesis_generator (Phase 6 MVP)
 * - trend_specialist (Phase 6 MVP)
 * - oscillator_specialist (Phase 6 MVP)
 * - volatility_volume_specialist (Phase 6 MVP)
 * - strategist (Critical-3)
 * - devils_advocate (Critical-3)
 * - discovery (Critical-3)
 * - mutation (Critical-3)
 * - crossover (Critical-3)
 * - prompt_mutation (Critical-3)
 * - meta_evolution (Critical-3)
 * - bull_bear_debate (Critical-3)
 *
 * 未定義エージェントに対しては null が返る(`getScoringFunction` の返り値仕様)。
 *
 * スコアリング原則:
 * - 決定論的である(同じ入出力に対して同じスコア)
 * - 0-1 の範囲(ABTestRunner 側でもクランプされる)
 * - 「出力がスキーマを満たしているか」「構造が豊富か」など *客観評価可能* な観点のみ
 * - 将来の「confirmed 到達率」「勝率」などは recordUsage() 側で別途記録する
 */

import type { ScoringFunction } from './types';
import type { JsonValue } from '../../../utils/jsonValue';

/**
 * HypothesisGenerator: 構造バリデーション通過率 + 仮説件数 + 推論長 の合成スコア。
 *
 * - 仮説が 0 件なら 0
 * - 仮説 3 件以上 + 全て reasoning に 20 文字以上 なら高スコア
 * - lensRelevance を含む仮説の比率でボーナス
 */
export const hypothesisGeneratorScoreFn: ScoringFunction<
  object,
  {
    hypotheses?: Array<{
      statement?: string;
      reasoning?: string;
      conditions?: JsonValue[];
      lensRelevance?: Record<string, number>;
    }>;
  }
> = (_input, output) => {
  const hypotheses = output?.hypotheses ?? [];
  if (hypotheses.length === 0) return 0;

  const countScore = Math.min(hypotheses.length / 3, 1); // 3 件以上で満点
  const reasoningScore =
    hypotheses.filter((h) => (h.reasoning ?? '').length >= 20).length /
    hypotheses.length;
  const conditionScore =
    hypotheses.filter((h) => Array.isArray(h.conditions) && h.conditions.length >= 2)
      .length / hypotheses.length;
  const relevanceScore =
    hypotheses.filter(
      (h) => h.lensRelevance && Object.keys(h.lensRelevance).length > 0,
    ).length / hypotheses.length;

  return 0.3 * countScore + 0.3 * reasoningScore + 0.3 * conditionScore + 0.1 * relevanceScore;
};

/**
 * 専門家(Trend/Oscillator/VolatilityVolume)共通のスコア関数。
 *
 * - interpretation の長さ(人間語翻訳の充実度)
 * - confidence が妥当な範囲(0.1-0.95)にあるか
 * - 必須フィールドが揃っているか
 */
function specialistScoreBase(
  output: {
    interpretation?: string;
    confidence?: number;
  },
  requiredFields: string[],
): number {
  const obj = output as Record<string, JsonValue | undefined>;
  const fieldsFilled =
    requiredFields.filter((k) => obj[k] !== undefined && obj[k] !== null).length /
    requiredFields.length;
  const interpretation = output?.interpretation ?? '';
  const interpScore = Math.min(interpretation.length / 80, 1); // 80 文字で満点
  const conf = output?.confidence ?? 0;
  const confInRange = conf >= 0.1 && conf <= 0.95 ? 1 : 0.3;

  return 0.5 * fieldsFilled + 0.3 * interpScore + 0.2 * confInRange;
}

export const trendSpecialistScoreFn: ScoringFunction<
  object,
  {
    trendState?: string;
    trendStrength?: number;
    trendMaturity?: string;
    keyLevels?: { support?: number[]; resistance?: number[] };
    interpretation?: string;
    confidence?: number;
  }
> = (_input, output) =>
  specialistScoreBase(output, [
    'trendState',
    'trendStrength',
    'trendMaturity',
    'keyLevels',
    'interpretation',
    'confidence',
  ]);

export const oscillatorSpecialistScoreFn: ScoringFunction<
  object,
  {
    momentum?: string;
    divergence?: string;
    interpretation?: string;
    confidence?: number;
  }
> = (_input, output) =>
  specialistScoreBase(output, ['momentum', 'divergence', 'interpretation', 'confidence']);

export const volatilityVolumeSpecialistScoreFn: ScoringFunction<
  object,
  {
    volatilityRegime?: string;
    breakoutRisk?: string;
    volumeSignal?: string;
    interpretation?: string;
    confidence?: number;
  }
> = (_input, output) =>
  specialistScoreBase(output, [
    'volatilityRegime',
    'breakoutRisk',
    'volumeSignal',
    'interpretation',
    'confidence',
  ]);

// ============================================================
// Critical-3 残スコープ: 死蔵 8 体のスコア関数
// ============================================================

/** 共通ユーティリティ: 文字列が指定文字数以上なら 1.0、未満なら比例で減少。 */
function lengthScore(text: string | undefined, fullScoreLength: number): number {
  if (!text) return 0;
  return Math.min(text.length / fullScoreLength, 1);
}

/**
 * Strategist (PromotionVerdict): verdict 必須 + 解釈と改善提案の充実度。
 *
 * - verdict が 4 値のいずれかにある(必須)
 * - baseCriteriaReasons の存在(rejected/insufficient_data/not_testable では non-empty 期待)
 * - interpretation の長さ
 * - actionableInsights の数
 */
export const strategistScoreFn: ScoringFunction<
  object,
  {
    verdict?: string;
    baseCriteriaReasons?: string[];
    interpretation?: string;
    actionableInsights?: string[];
  }
> = (_input, output) => {
  const VALID_VERDICTS = new Set(['confirmed', 'rejected', 'insufficient_data', 'not_testable']);
  const isValidVerdict =
    typeof output?.verdict === 'string' && VALID_VERDICTS.has(output.verdict);
  const verdictScore = isValidVerdict ? 1 : 0;
  const reasons = output?.baseCriteriaReasons ?? [];
  // verdict が不正なら理由を加点しない(verdict と reasons は独立評価しない)。
  // confirmed は理由空でも OK、それ以外は >=1 で満点。
  const reasonsScore = !isValidVerdict
    ? 0
    : output.verdict === 'confirmed'
      ? 1
      : Math.min(reasons.length, 1);
  const interpScore = lengthScore(output?.interpretation, 80);
  const insights = output?.actionableInsights ?? [];
  const insightsScore = Math.min(insights.length / 2, 1);

  return 0.3 * verdictScore + 0.2 * reasonsScore + 0.3 * interpScore + 0.2 * insightsScore;
};

/**
 * DevilsAdvocate: 失敗シナリオの数と詳細さ + 弱点記述の深さ + 推奨アクションの説得力。
 */
export const devilsAdvocateScoreFn: ScoringFunction<
  object,
  {
    failureScenarios?: Array<{
      description?: string;
      triggerConditions?: string;
      estimatedLikelihood?: string;
    }>;
    weakestAssumption?: {
      description?: string;
      whyVulnerable?: string;
    };
    recommendation?: {
      action?: string;
      rationale?: string;
      suggestedModifications?: string[];
    };
  }
> = (_input, output) => {
  const VALID_LIKELIHOODS = new Set(['low', 'medium', 'high']);
  const VALID_ACTIONS = new Set(['proceed', 'modify', 'abandon']);

  const scenarios = output?.failureScenarios ?? [];
  const scenarioCountScore = Math.min(scenarios.length / 2, 1);
  const scenarioQualityScore =
    scenarios.length === 0
      ? 0
      : scenarios.filter(
          (s) =>
            (s.description ?? '').length >= 30 &&
            (s.triggerConditions ?? '').length >= 20 &&
            VALID_LIKELIHOODS.has(s.estimatedLikelihood ?? ''),
        ).length / scenarios.length;
  const scenariosScore = 0.5 * scenarioCountScore + 0.5 * scenarioQualityScore;

  const weakest = output?.weakestAssumption;
  const weakestScore = weakest
    ? 0.5 * (lengthScore(weakest.description, 30) +
        lengthScore(weakest.whyVulnerable, 30))
    : 0;

  const recommendation = output?.recommendation;
  const recScore = recommendation
    ? 0.5 *
        (VALID_ACTIONS.has(recommendation.action ?? '') ? 1 : 0) +
      0.5 * lengthScore(recommendation.rationale, 30)
    : 0;

  return 0.4 * scenariosScore + 0.2 * weakestScore + 0.4 * recScore;
};

/**
 * Discovery: 解釈の数 + 新仮説の数 + HG 向けヒント + 週次ノート。
 */
export const discoveryScoreFn: ScoringFunction<
  object,
  {
    interpretations?: Array<{ interpretation?: string }>;
    newHypotheses?: Array<{ statement?: string; reasoning?: string; conditions?: object[] }>;
    hintsForHG?: Array<{ promisingDirection?: string; lensFocusAreas?: string[]; rationale?: string }>;
    weeklyNote?: string;
  }
> = (_input, output) => {
  const interpretations = output?.interpretations ?? [];
  const interpCountScore = Math.min(interpretations.length / 3, 1);
  const interpQualityScore =
    interpretations.length === 0
      ? 0
      : interpretations.filter((i) => (i.interpretation ?? '').length >= 30).length /
        interpretations.length;
  const interpScore = 0.5 * interpCountScore + 0.5 * interpQualityScore;

  const hypotheses = output?.newHypotheses ?? [];
  const hypCountScore = Math.min(hypotheses.length / 2, 1);
  const hypQualityScore =
    hypotheses.length === 0
      ? 0
      : hypotheses.filter(
          (h) =>
            typeof h.statement === 'string' &&
            h.statement.length > 0 &&
            (h.reasoning ?? '').length >= 20 &&
            Array.isArray(h.conditions) &&
            h.conditions.length >= 1,
        ).length / hypotheses.length;
  const hypScore = 0.5 * hypCountScore + 0.5 * hypQualityScore;

  const hints = output?.hintsForHG ?? [];
  const hintsCountScore = Math.min(hints.length, 1);
  const hintsQualityScore =
    hints.length === 0
      ? 0
      : hints.filter(
          (h) =>
            typeof h.promisingDirection === 'string' &&
            h.promisingDirection.length > 0 &&
            Array.isArray(h.lensFocusAreas) &&
            h.lensFocusAreas.length > 0,
        ).length / hints.length;
  const hintsScore = 0.5 * hintsCountScore + 0.5 * hintsQualityScore;

  const noteScore = lengthScore(output?.weeklyNote, 80);

  return 0.3 * interpScore + 0.3 * hypScore + 0.2 * hintsScore + 0.2 * noteScore;
};

/**
 * Mutation: 戦略 DSL 配列の充実度。
 *
 * 入力で要求された count に対する達成率 + 各要素の必須フィールド充填。
 * 入力 count が不明なら配列が 1 件以上で満点(配列存在性のみ評価)。
 */
export const mutationScoreFn: ScoringFunction<
  { count?: number },
  Array<{ id?: string; generation?: number; parentIds?: string[] }>
> = (input, output) => {
  if (!Array.isArray(output) || output.length === 0) return 0;
  const requestedCount = input?.count ?? output.length;
  const countScore =
    requestedCount > 0 ? Math.min(output.length / requestedCount, 1) : 1;
  const fieldsScore =
    output.filter(
      (s) =>
        typeof s.id === 'string' &&
        s.id.length > 0 &&
        typeof s.generation === 'number' &&
        Array.isArray(s.parentIds),
    ).length / output.length;
  return 0.5 * countScore + 0.5 * fieldsScore;
};

/**
 * Crossover: 戦略 DSL 配列、各要素は parentIds.length === 2 が本質。
 *
 * 入力で要求された pairCount に対する達成率 + 各要素の親 ID 2 件確認。
 */
export const crossoverScoreFn: ScoringFunction<
  { pairCount?: number },
  Array<{ id?: string; generation?: number; parentIds?: string[] }>
> = (input, output) => {
  if (!Array.isArray(output) || output.length === 0) return 0;
  const requestedCount = input?.pairCount ?? output.length;
  const countScore =
    requestedCount > 0 ? Math.min(output.length / requestedCount, 1) : 1;
  const parentScore =
    output.filter(
      (s) =>
        typeof s.id === 'string' &&
        s.id.length > 0 &&
        Array.isArray(s.parentIds) &&
        s.parentIds.length === 2,
    ).length / output.length;
  return 0.5 * countScore + 0.5 * parentScore;
};

/**
 * PromptMutation: 改善案配列の充実度。
 *
 * - 配列長(既定 3 件で満点)
 * - 各 content の長さ(>=100 で満点)
 * - notes / expectedImprovement の充填率
 */
export const promptMutationScoreFn: ScoringFunction<
  { count?: number },
  Array<{
    version?: string;
    content?: string;
    notes?: string;
    expectedImprovement?: string;
  }>
> = (input, output) => {
  if (!Array.isArray(output) || output.length === 0) return 0;
  const requestedCount = input?.count ?? 3;
  const countScore =
    requestedCount > 0 ? Math.min(output.length / requestedCount, 1) : 1;
  const contentScore =
    output.filter((p) => (p.content ?? '').length >= 100).length / output.length;
  const metadataScore =
    output.filter(
      (p) =>
        typeof p.version === 'string' &&
        p.version.length > 0 &&
        ((p.notes ?? '').length > 0 || (p.expectedImprovement ?? '').length > 0),
    ).length / output.length;
  return 0.4 * countScore + 0.4 * contentScore + 0.2 * metadataScore;
};

/**
 * MetaEvolution (AgentRestructureProposal): 提案の数と質 + 分析の網羅性 + confidence。
 */
export const metaEvolutionScoreFn: ScoringFunction<
  object,
  {
    proposals?: Array<{
      type?: string;
      agentName?: string;
      reasoning?: string;
      expectedImprovement?: string;
    }>;
    analysis?: {
      currentAgents?: string[];
      coverageGaps?: string[];
      underperformers?: string[];
    };
    confidence?: number;
  }
> = (_input, output) => {
  const VALID_TYPES = new Set(['add', 'modify', 'deprecate']);

  const proposals = output?.proposals ?? [];
  const proposalCountScore = Math.min(proposals.length, 1);
  const proposalQualityScore =
    proposals.length === 0
      ? 0
      : proposals.filter(
          (p) =>
            VALID_TYPES.has(p.type ?? '') &&
            typeof p.agentName === 'string' &&
            p.agentName.length > 0 &&
            (p.reasoning ?? '').length >= 30 &&
            (p.expectedImprovement ?? '').length >= 20,
        ).length / proposals.length;
  const proposalsScore = 0.5 * proposalCountScore + 0.5 * proposalQualityScore;

  const analysis = output?.analysis;
  const analysisScore = analysis
    ? (Array.isArray(analysis.currentAgents) && analysis.currentAgents.length > 0 ? 1 : 0) *
        (1 / 3) +
      (Array.isArray(analysis.coverageGaps) ? 1 : 0) * (1 / 3) +
      (Array.isArray(analysis.underperformers) ? 1 : 0) * (1 / 3)
    : 0;

  const conf = output?.confidence ?? 0;
  const confInRange = conf >= 0.1 && conf <= 0.95 ? 1 : 0.3;

  return 0.5 * proposalsScore + 0.3 * analysisScore + 0.2 * confInRange;
};

/**
 * BullBearDebate: bull/bear 双方の論拠 + 統合解釈 + 市場文脈。
 */
export const bullBearDebateScoreFn: ScoringFunction<
  object,
  {
    marketContext?: { summary?: string; dominantBias?: string; biasStrength?: number };
    bull?: { scenario?: string; rationale?: string[] };
    bear?: { scenario?: string; rationale?: string[] };
    synthesis?: {
      preferredDirection?: string;
      preferredConfidence?: number;
      reasoning?: string;
      actionableInsight?: string;
      phaseAnalysis?: object[];
    };
  }
> = (_input, output) => {
  const sideScore = (side: { scenario?: string; rationale?: string[] } | undefined): number => {
    if (!side) return 0;
    const scenarioScore = lengthScore(side.scenario, 30);
    const rationaleScore =
      Array.isArray(side.rationale) && side.rationale.length >= 2 ? 1 : 0;
    return 0.5 * scenarioScore + 0.5 * rationaleScore;
  };
  const bullScore = sideScore(output?.bull);
  const bearScore = sideScore(output?.bear);
  const sideAvgScore = (bullScore + bearScore) / 2;

  const synthesis = output?.synthesis;
  const synthesisScore = synthesis
    ? 0.4 * lengthScore(synthesis.reasoning, 30) +
      0.3 * lengthScore(synthesis.actionableInsight, 20) +
      0.3 *
        (Array.isArray(synthesis.phaseAnalysis) && synthesis.phaseAnalysis.length >= 1
          ? 1
          : 0)
    : 0;

  const market = output?.marketContext;
  const marketScore = market
    ? 0.5 * lengthScore(market.summary, 20) +
      0.5 *
        (typeof market.dominantBias === 'string' &&
        ['bullish', 'bearish', 'neutral'].includes(market.dominantBias)
          ? 1
          : 0)
    : 0;

  return 0.4 * sideAvgScore + 0.4 * synthesisScore + 0.2 * marketScore;
};

/** エージェント名 → スコア関数 のマッピング(全 12 体、Phase 6 MVP + Critical-3 残)。 */
export const SCORING_FUNCTIONS: Record<string, ScoringFunction<object, object>> = {
  // Phase 6 MVP
  hypothesis_generator: hypothesisGeneratorScoreFn,
  trend_specialist: trendSpecialistScoreFn,
  oscillator_specialist: oscillatorSpecialistScoreFn,
  volatility_volume_specialist: volatilityVolumeSpecialistScoreFn,
  // Critical-3 残スコープ(死蔵 8 体)
  strategist: strategistScoreFn,
  devils_advocate: devilsAdvocateScoreFn,
  discovery: discoveryScoreFn,
  // mutation/crossover/prompt_mutation は input 型が { count? } / { pairCount? } のため
  // Record<string, ScoringFunction<object, object>> に直接代入できず型アサーションが必要。
  mutation: mutationScoreFn as ScoringFunction<object, object>,
  crossover: crossoverScoreFn as ScoringFunction<object, object>,
  prompt_mutation: promptMutationScoreFn as ScoringFunction<object, object>,
  meta_evolution: metaEvolutionScoreFn,
  bull_bear_debate: bullBearDebateScoreFn,
};

/**
 * エージェント名に対応するスコア関数を返す。未実装エージェントは null。
 * 新規エージェントを追加する場合はスコア関数を実装し SCORING_FUNCTIONS に登録する。
 */
export function getScoringFunction(
  agentName: string,
): ScoringFunction<object, object> | null {
  return SCORING_FUNCTIONS[agentName] ?? null;
}
