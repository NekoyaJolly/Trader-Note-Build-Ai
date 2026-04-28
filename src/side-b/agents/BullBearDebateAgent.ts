/**
 * Bull vs Bear 討論エージェント
 *
 * 目的: Strategy Thinker の意思決定直前に、ロング派（Bull）とショート派（Bear）が
 *       それぞれのベストシナリオを提示し、まとめ役が両方のシナリオを時間軸や
 *       フェーズで整理・統合する。
 *
 * 設計思想:
 * - 無理な対立はしない。市場状況を認識した上で各派がシナリオを出す
 * - まとめ役は「どちらかを選ぶ」のではなく、両方のシナリオを統合する
 * - 各派の主張には確信度を含める
 * - 出力は構造化された情報（シナリオ、確信度、根拠、合意事項など）
 * - 既存のレンズ分析結果を討論の入力として使う
 * - AIProvider パターンを踏襲（OpenAI 互換 API）
 *
 * 統合ポイント:
 *   aiOrchestrator.ts の generatePlan() 内、
 *   専門家分析が出揃った後 → Strategy Thinker 呼び出し前
 *
 * @see docs/design/phase_1_specification.md
 */

import { config, modelFor } from '../../config';
import { loadPromptWithGlobal } from '../prompts/loader';
import { serializeLensSnapshot, type LensFeatureSnapshot } from '../lenses';
import type { SpecialistBundle } from './specialists/types';
import type { EdgeHypothesis } from '../models/edgeHypothesis';
import { extractJson } from './llmJsonExtract';

// ===========================================
// 型定義
// ===========================================

/** 討論における各派（Bull/Bear）のシナリオ */
export interface DebateSideOutput {
  /** ベストシナリオの説明 */
  scenario: string;
  /** 確信度（0-100） */
  confidence: number;
  /** 根拠の配列 */
  rationale: string[];
  /** シナリオが有効になる条件 */
  keyConditions: string[];
  /** リスク要因 */
  risks: string[];
  /** 時間軸 */
  timeHorizon: 'short_term' | 'medium_term' | 'both';
}

/** 統合分析のフェーズ */
export interface DebatePhaseAnalysis {
  /** フェーズ名 */
  phase: string;
  /** 方向 */
  direction: 'long' | 'short' | 'wait';
  /** 有効条件 */
  condition: string;
  /** 確信度（0-100） */
  confidence: number;
}

/** 討論の統合結果 */
export interface DebateSynthesis {
  /** 優勢な方向 */
  preferredDirection: 'long' | 'short' | 'neutral';
  /** 優勢方向の確信度 */
  preferredConfidence: number;
  /** 統合判断の根拠 */
  reasoning: string;
  /** フェーズ別分析 */
  phaseAnalysis: DebatePhaseAnalysis[];
  /** 両派の合意事項 */
  consensusPoints: string[];
  /** 両派の分岐点 */
  divergencePoints: string[];
  /** Strategy Thinker への示唆 */
  actionableInsight: string;
}

/** 市場コンテキスト */
export interface DebateMarketContext {
  /** 市場状況の要約 */
  summary: string;
  /** 優勢なバイアス */
  dominantBias: 'bullish' | 'bearish' | 'neutral';
  /** バイアスの強さ（0-100） */
  biasStrength: number;
}

/** 討論の全出力 */
export interface BullBearDebateOutput {
  marketContext: DebateMarketContext;
  bull: DebateSideOutput;
  bear: DebateSideOutput;
  synthesis: DebateSynthesis;
}

/** 討論実行結果（トークン使用量等のメタ情報付き） */
export interface BullBearDebateResult {
  output: BullBearDebateOutput;
  tokenUsage: number;
  model: string;
}

/** 討論エージェントへの入力 */
export interface BullBearDebateInput {
  symbol: string;
  timeframe: string;
  lensSnapshot?: LensFeatureSnapshot;
  candidateHypotheses?: EdgeHypothesis[];
  specialistAnalyses?: {
    trend?: unknown;
    oscillator?: unknown;
    volatilityVolume?: unknown;
  };
}

// ===========================================
// バリデーション
// ===========================================

const VALID_DIRECTIONS = ['long', 'short', 'neutral'] as const;
const VALID_BIASES = ['bullish', 'bearish', 'neutral'] as const;
const VALID_TIME_HORIZONS = ['short_term', 'medium_term', 'both'] as const;
const VALID_PHASE_DIRECTIONS = ['long', 'short', 'wait'] as const;

/**
 * DebateSideOutput をバリデーションする
 */
function validateSideOutput(data: unknown, side: string): DebateSideOutput {
  if (!data || typeof data !== 'object') {
    throw new Error(`${side}: must be an object`);
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj.scenario !== 'string' || obj.scenario.length < 5) {
    throw new Error(`${side}.scenario: must be a non-empty string`);
  }
  if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 100) {
    throw new Error(`${side}.confidence: must be a number 0-100`);
  }
  if (!Array.isArray(obj.rationale) || obj.rationale.length === 0) {
    throw new Error(`${side}.rationale: must be a non-empty array`);
  }
  const rationale = (obj.rationale as unknown[]).map(String);

  const keyConditions = Array.isArray(obj.keyConditions)
    ? (obj.keyConditions as unknown[]).map(String)
    : [];
  const risks = Array.isArray(obj.risks)
    ? (obj.risks as unknown[]).map(String)
    : [];

  const timeHorizon = VALID_TIME_HORIZONS.includes(obj.timeHorizon as typeof VALID_TIME_HORIZONS[number])
    ? (obj.timeHorizon as DebateSideOutput['timeHorizon'])
    : 'both';

  return {
    scenario: obj.scenario as string,
    confidence: obj.confidence as number,
    rationale,
    keyConditions,
    risks,
    timeHorizon,
  };
}

/**
 * AI レスポンスを BullBearDebateOutput にバリデーションして変換する
 */
export function validateBullBearDebateOutput(data: unknown): BullBearDebateOutput {
  if (!data || typeof data !== 'object') {
    throw new Error('Bull vs Bear debate output must be an object');
  }
  const obj = data as Record<string, unknown>;

  // marketContext
  const mc = obj.marketContext as Record<string, unknown> | undefined;
  if (!mc || typeof mc !== 'object') {
    throw new Error('marketContext must be an object');
  }
  const marketContext: DebateMarketContext = {
    summary: typeof mc.summary === 'string' ? mc.summary : '',
    dominantBias: VALID_BIASES.includes(mc.dominantBias as typeof VALID_BIASES[number])
      ? (mc.dominantBias as DebateMarketContext['dominantBias'])
      : 'neutral',
    biasStrength: typeof mc.biasStrength === 'number'
      ? Math.max(0, Math.min(100, mc.biasStrength))
      : 50,
  };

  // bull & bear
  const bull = validateSideOutput(obj.bull, 'bull');
  const bear = validateSideOutput(obj.bear, 'bear');

  // synthesis
  const syn = obj.synthesis as Record<string, unknown> | undefined;
  if (!syn || typeof syn !== 'object') {
    throw new Error('synthesis must be an object');
  }

  const phaseAnalysis: DebatePhaseAnalysis[] = Array.isArray(syn.phaseAnalysis)
    ? (syn.phaseAnalysis as unknown[]).map((raw, idx) => {
        const p = raw as Record<string, unknown>;
        return {
          phase: typeof p.phase === 'string' ? p.phase : `Phase ${idx + 1}`,
          direction: VALID_PHASE_DIRECTIONS.includes(p.direction as typeof VALID_PHASE_DIRECTIONS[number])
            ? (p.direction as DebatePhaseAnalysis['direction'])
            : 'wait',
          condition: typeof p.condition === 'string' ? p.condition : '',
          confidence: typeof p.confidence === 'number'
            ? Math.max(0, Math.min(100, p.confidence))
            : 50,
        };
      })
    : [];

  const synthesis: DebateSynthesis = {
    preferredDirection: VALID_DIRECTIONS.includes(syn.preferredDirection as typeof VALID_DIRECTIONS[number])
      ? (syn.preferredDirection as DebateSynthesis['preferredDirection'])
      : 'neutral',
    preferredConfidence: typeof syn.preferredConfidence === 'number'
      ? Math.max(0, Math.min(100, syn.preferredConfidence))
      : 50,
    reasoning: typeof syn.reasoning === 'string' ? syn.reasoning : '',
    phaseAnalysis,
    consensusPoints: Array.isArray(syn.consensusPoints)
      ? (syn.consensusPoints as unknown[]).map(String)
      : [],
    divergencePoints: Array.isArray(syn.divergencePoints)
      ? (syn.divergencePoints as unknown[]).map(String)
      : [],
    actionableInsight: typeof syn.actionableInsight === 'string' ? syn.actionableInsight : '',
  };

  return { marketContext, bull, bear, synthesis };
}

// ===========================================
// エージェント本体
// ===========================================

export interface BullBearDebateAgentConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export class BullBearDebateAgent {
  private apiKey: string;
  private baseURL: string;
  private model: string;

  constructor(cfg?: BullBearDebateAgentConfig) {
    this.apiKey = cfg?.apiKey !== undefined
      ? cfg.apiKey
      : (process.env.AI_API_KEY || config.ai.apiKey || '');
    this.baseURL = cfg?.baseURL !== undefined
      ? cfg.baseURL
      : (process.env.AI_BASE_URL || config.ai.baseURL || 'https://api.openai.com/v1');
    this.model = cfg?.model !== undefined
      ? cfg.model
      : modelFor('bull_bear_debate');
  }

  /**
   * Bull vs Bear 討論を実行する。
   *
   * API キー未設定時は安全なデフォルト（neutral）を返し、
   * 上位ロジックを壊さないようにする。
   */
  async debate(input: BullBearDebateInput): Promise<BullBearDebateResult> {
    if (!this.apiKey) {
      console.warn('[BullBearDebate] APIキー未設定。neutral の safe-default を返します。');
      return this.fallback('APIキー未設定のため、Bull vs Bear 討論をスキップしました。');
    }

    try {
      const systemPrompt = loadPromptWithGlobal('bull_bear_debate');
      const userPrompt = this.buildUserPrompt(input);
      const raw = await this.callAI(systemPrompt, userPrompt);
      const validated = validateBullBearDebateOutput(raw.content);
      return {
        output: validated,
        tokenUsage: raw.tokenUsage,
        model: raw.model,
      };
    } catch (error) {
      console.error('[BullBearDebate] 討論失敗:', error);
      return this.fallback('Bull vs Bear 討論の呼び出しに失敗しました。');
    }
  }

  /**
   * ユーザープロンプトを組み立てる
   */
  private buildUserPrompt(input: BullBearDebateInput): string {
    const sections: string[] = [];

    sections.push(`# Bull vs Bear 討論リクエスト`);
    sections.push(`## 対象銘柄: ${input.symbol} (${input.timeframe})`);
    sections.push('');
    sections.push('以下の市場データを基に、Bull（ロング派）と Bear（ショート派）それぞれのベストシナリオを生成し、統合してください。');

    // レンズスナップショット
    if (input.lensSnapshot) {
      const serialized = serializeLensSnapshot(input.lensSnapshot);
      sections.push('');
      sections.push('## レンズ分析結果');
      sections.push('```json');
      sections.push(JSON.stringify(serialized, null, 2));
      sections.push('```');
    }

    // 専門家分析
    if (input.specialistAnalyses) {
      const { trend, oscillator, volatilityVolume } = input.specialistAnalyses;
      if (trend || oscillator || volatilityVolume) {
        sections.push('');
        sections.push('## 専門家分析');
        if (trend) {
          sections.push('### トレンド分析');
          sections.push('```json');
          sections.push(JSON.stringify(trend, null, 2));
          sections.push('```');
        }
        if (oscillator) {
          sections.push('### オシレーター分析');
          sections.push('```json');
          sections.push(JSON.stringify(oscillator, null, 2));
          sections.push('```');
        }
        if (volatilityVolume) {
          sections.push('### ボラティリティ・ボリューム分析');
          sections.push('```json');
          sections.push(JSON.stringify(volatilityVolume, null, 2));
          sections.push('```');
        }
      }
    }

    // 候補仮説
    if (input.candidateHypotheses && input.candidateHypotheses.length > 0) {
      sections.push('');
      sections.push('## 候補仮説');
      for (const h of input.candidateHypotheses) {
        sections.push(`- **${h.statement}** (方向: ${h.expectedDirection}, カテゴリ: ${h.category})`);
      }
    }

    sections.push('');
    sections.push('出力は指定された JSON 形式のみ。');

    return sections.join('\n');
  }

  /**
   * LLM API を呼び出す
   */
  private async callAI(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<{ content: unknown; tokenUsage: number; model: string }> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Bull vs Bear Debate API エラー: ${response.status} - ${body}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { total_tokens?: number };
      model?: string;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Bull vs Bear Debate API からの応答が空です');
    }

    const extracted = extractJson(content);
    if (!extracted.ok) {
      throw new Error(
        `Bull vs Bear Debate 応答を JSON として解釈できませんでした: ${extracted.error}`,
      );
    }

    return {
      content: extracted.data,
      tokenUsage: data.usage?.total_tokens || 0,
      model: data.model || this.model,
    };
  }

  /**
   * フォールバック（API 未設定・エラー時）
   */
  private fallback(reason: string): BullBearDebateResult {
    return {
      output: {
        marketContext: {
          summary: reason,
          dominantBias: 'neutral',
          biasStrength: 50,
        },
        bull: {
          scenario: '討論スキップのため未評価',
          confidence: 50,
          rationale: [reason],
          keyConditions: [],
          risks: [],
          timeHorizon: 'both',
        },
        bear: {
          scenario: '討論スキップのため未評価',
          confidence: 50,
          rationale: [reason],
          keyConditions: [],
          risks: [],
          timeHorizon: 'both',
        },
        synthesis: {
          preferredDirection: 'neutral',
          preferredConfidence: 50,
          reasoning: reason,
          phaseAnalysis: [],
          consensusPoints: [],
          divergencePoints: [],
          actionableInsight: '討論がスキップされたため、Strategy Thinker は独自判断で戦略を立案してください。',
        },
      },
      tokenUsage: 0,
      model: 'fallback',
    };
  }
}

export const bullBearDebateAgent = new BullBearDebateAgent();
