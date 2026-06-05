/**
 * 認知層出力の評価ハーネス (LLM-as-judge) — P1
 *
 * BT で測れない認知層の解釈・提案出力 (MarketAnalysis / 将来の FundamentalsThesis 等) を、
 * rubric の各次元で LLM に 0..1 採点させ、**総合スコアと合否は決定論的に集計**する。
 * ドメイン原則「LLM=採点(解釈)のみ、判定=決定論」を評価層でも貫く。
 *
 * 設計の出典: Anthropic「Building Effective Agents」/「Multi-agent research system」
 * (LLM-as-judge で factual accuracy/completeness 等を 0-1 + pass/fail 採点)。
 */
import { config, modelFor } from '../../config';
import { AI_MAX_TOKENS } from '../../config/aiTokenLimits';
import { AIProvider } from '../agent/aiProvider';
import { extractJson } from '../agents/llmJsonExtract';
import { loadPrompt } from '../prompts/loader';
import { safeStringify } from '../../utils/safeStringify';
import type { JsonValue } from '../../utils/jsonValue';
import {
  type CognitiveRubric,
  type CognitiveEvalVerdict,
  type DimensionScore,
  type RawDimensionScore,
  type JudgeRawOutput,
  JudgeRawOutputSchema,
} from '../models/cognitiveEval';

const JUDGE_PROMPT_NAME = 'cognitive_output_judge';
/** judge 応答のパース/検証失敗時の最大試行回数 (既存サービスと同様の堅牢化)。 */
const JUDGE_MAX_ATTEMPTS = 3;

/** judge LLM の抽象 (テスト差し替え用 DI)。 */
export interface CognitiveJudge {
  scoreDimensions(input: { systemPrompt: string; userPrompt: string }): Promise<JudgeRawOutput>;
}

/**
 * 既定 judge: AIProvider で `cognitive_judge` モデルを呼び、応答から JSON を堅牢抽出して
 * JudgeRawOutputSchema で Zod 検証する。
 * - AI_API_KEY 未設定は空文字で叩かず明示エラー。
 * - パース/検証失敗は最大 JUDGE_MAX_ATTEMPTS 回リトライ (extractJson で fence/前置き混入を吸収)。
 */
export class AIProviderCognitiveJudge implements CognitiveJudge {
  async scoreDimensions(input: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<JudgeRawOutput> {
    const apiKey = process.env.AI_API_KEY || '';
    if (!apiKey) {
      throw new Error('cognitive judge: AI_API_KEY が未設定です');
    }
    const provider = new AIProvider({
      apiKey,
      model: modelFor('cognitive_judge'),
      baseURL: process.env.AI_BASE_URL || config.ai.baseURL || 'https://api.openai.com/v1',
    });

    let lastError = '';
    for (let attempt = 1; attempt <= JUDGE_MAX_ATTEMPTS; attempt++) {
      // temperature=0: 採点の再現性を最大化する。
      const res = await provider.chat(
        [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.userPrompt },
        ],
        { temperature: 0, maxTokens: AI_MAX_TOKENS.MEDIUM, responseFormat: { type: 'json_object' } },
      );
      if (!res.content) {
        lastError = 'AI 応答が空';
        continue;
      }
      // 生 JSON → fence → bracket の 3 段で堅牢抽出 (前置き/Markdown フェンス混入に耐性)。
      const extracted = extractJson(res.content);
      if (!extracted.ok) {
        lastError = `JSON 抽出失敗: ${extracted.error}`;
        continue;
      }
      const validated = JudgeRawOutputSchema.safeParse(extracted.data);
      if (validated.success) {
        return validated.data;
      }
      lastError = `スキーマ検証失敗: ${safeStringify(validated.error.issues)}`;
    }
    throw new Error(`cognitive judge: ${JUDGE_MAX_ATTEMPTS} 回試行しても有効な採点を得られず (${lastError})`);
  }
}

export interface EvaluateCognitiveOutputInput {
  rubric: CognitiveRubric;
  /** 評価対象 (AI が生成した解釈・提案)。 */
  output: JsonValue;
  /** AI に与えられた入力データ (接地=捏造でないかの検証材料)。 */
  context: JsonValue;
}

export interface CognitiveEvaluatorDeps {
  judge?: CognitiveJudge;
  /** judge システムプロンプトの読込 (テスト差し替え用)。既定は prompts/cognitive_output_judge.md。 */
  loadJudgePrompt?: () => string;
}

/** judge へ渡す user メッセージを組み立てる (rubric + 評価対象 + context)。 */
export function buildJudgeUserPrompt(input: EvaluateCognitiveOutputInput): string {
  const dims = input.rubric.dimensions
    .map((d) => `- key="${d.key}" (${d.label}): ${d.description}`)
    .join('\n');
  return [
    `# 評価対象の種別\n${input.rubric.targetDescription}`,
    `# 採点する次元 (各次元を 1 つずつ 0.0〜1.0 で採点)\n${dims}`,
    `# context (AI に与えられた入力データ。これに無い言及は捏造として減点)\n\`\`\`json\n${JSON.stringify(input.context)}\n\`\`\``,
    `# 評価対象 (この出力を採点する)\n\`\`\`json\n${JSON.stringify(input.output)}\n\`\`\``,
  ].join('\n\n');
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * judge の次元別採点を rubric の重みで集計し、総合スコア・合否を**決定論的に**決める。
 * - judge が採点しなかった rubric 次元は score=0 で補完し missingDimensions に記録する。
 * - overallScore = Σ(score×weight) / Σ(weight) (重み正規化した加重平均)。
 * - passed = overallScore >= rubric.passThreshold。
 */
export function aggregateVerdict(
  rubric: CognitiveRubric,
  raw: JudgeRawOutput,
): CognitiveEvalVerdict {
  const byDim = new Map<string, RawDimensionScore>(
    raw.dimensionScores.map((d) => [d.dimension, d]),
  );
  const dimensionScores: DimensionScore[] = [];
  const missingDimensions: string[] = [];
  let weightedSum = 0;
  let weightTotal = 0;

  for (const dim of rubric.dimensions) {
    const found = byDim.get(dim.key);
    const score = found ? clamp01(found.score) : 0;
    if (!found) missingDimensions.push(dim.key);
    dimensionScores.push({
      dimension: dim.key,
      score,
      reason: found?.reason ?? '(judge 未採点のため 0 で補完)',
    });
    weightedSum += score * dim.weight;
    weightTotal += dim.weight;
  }

  const overallScore = weightTotal > 0 ? weightedSum / weightTotal : 0;
  return {
    rubricName: rubric.name,
    dimensionScores,
    overallScore,
    passed: overallScore >= rubric.passThreshold,
    passThreshold: rubric.passThreshold,
    summary: raw.summary,
    missingDimensions,
  };
}

/**
 * 認知層出力を rubric で評価する。LLM judge を呼んで次元採点 → 決定論集計。
 */
export async function evaluateCognitiveOutput(
  input: EvaluateCognitiveOutputInput,
  deps: CognitiveEvaluatorDeps = {},
): Promise<CognitiveEvalVerdict> {
  const judge = deps.judge ?? new AIProviderCognitiveJudge();
  const loadJudgePrompt = deps.loadJudgePrompt ?? (() => loadPrompt(JUDGE_PROMPT_NAME));
  const systemPrompt = loadJudgePrompt();
  const userPrompt = buildJudgeUserPrompt(input);
  const raw = await judge.scoreDimensions({ systemPrompt, userPrompt });
  return aggregateVerdict(input.rubric, raw);
}

/**
 * MarketAnalysis (researchAIService 出力) 用 rubric。
 * 重みは「接地 > 因果 > 整合 > 網羅 > 根拠具体性」の順 (捏造防止を最重視)。
 */
export const MARKET_ANALYSIS_RUBRIC: CognitiveRubric = {
  name: 'market_analysis_v1',
  targetDescription:
    'AI が OHLCV + 指標スナップショットから生成した市場解釈 (MarketAnalysis: regime/direction/volatility/confidence/keyLevels/reasoning/quickScores)。',
  passThreshold: 0.6,
  dimensions: [
    {
      key: 'grounding',
      label: '接地',
      description:
        'reasoning と keyLevels が context の OHLCV/指標に接地しているか。context に無い数値・事実への言及 (捏造/幻覚) があれば 0 に近づける。',
      weight: 0.3,
    },
    {
      key: 'causal_validity',
      label: '因果妥当性',
      description:
        'keyObservation と riskFactors の因果・論理が市場的に妥当か。飛躍・矛盾した因果づけは減点。',
      weight: 0.25,
    },
    {
      key: 'internal_consistency',
      label: '整合性',
      description:
        'direction / regime / volatility / quickScores / reasoning が相互に矛盾しないか (例: direction=bullish なのに reasoning が弱気一辺倒、は減点)。',
      weight: 0.2,
    },
    {
      key: 'completeness',
      label: '網羅性',
      description:
        'trend / momentum / volatility / risk / keyLevels の重要観点を空疎でなく具体的に埋めているか。空文・定型文は減点。',
      weight: 0.15,
    },
    {
      key: 'level_basis',
      label: '根拠の具体性',
      description:
        'keyLevels[].basis が「直近高値」程度の薄い根拠でなく、指標合流などの具体的根拠を示しているか。',
      weight: 0.1,
    },
  ],
};
