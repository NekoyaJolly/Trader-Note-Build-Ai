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
 * - fetch で OpenAI 互換 API に直接接続し、OpenAIChatCompletionResponseSchema で安全にパース
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
import type {
  TrendAnalysis,
  OscillatorAnalysis,
  VolatilityVolumeAnalysis,
} from './specialists/types';
import type { EdgeHypothesis } from '../models/edgeHypothesis';
import { extractJson } from './llmJsonExtract';
import {
  DebateSideOutputSchema,
  DebateMarketContextSchema,
  DebateSynthesisSchema,
  type DebateSideOutput,
  type DebatePhaseAnalysis,
  type DebateSynthesis,
  type DebateMarketContext,
  type BullBearDebateOutput,
} from '../../schemas/api/sideB';
import {
  parseOpenAIResponse,
  OpenAIChatCompletionResponseSchema,
} from '../../schemas/external/openai';

// ===========================================
// 型定義（sideB.ts で Zod スキーマから推論された型を再エクスポート）
// ===========================================

// 外部から参照できるように再エクスポート
export type { DebateSideOutput, DebatePhaseAnalysis, DebateSynthesis, DebateMarketContext, BullBearDebateOutput };

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
  /** 専門家分析の結果（具体型を使用して型安全を確保） */
  specialistAnalyses?: {
    trend?: TrendAnalysis;
    oscillator?: OscillatorAnalysis;
    volatilityVolume?: VolatilityVolumeAnalysis;
  };
}

// ===========================================
// バリデーション
// ===========================================

/**
 * 各派（bull/bear）の出力を Zod スキーマでバリデーションする。
 * エラー時はフィールドパスを含むカスタムメッセージで再スローする。
 */
function parseSideOutput(data: unknown, side: 'bull' | 'bear'): DebateSideOutput {
  const result = DebateSideOutputSchema.safeParse(data);
  if (!result.success) {
    // 最初のエラーのパスを "bull.scenario" などの形式で組み立てて再スロー
    const issue = result.error.issues[0];
    const fieldPath = [side, ...issue.path.map(String)].join('.');
    throw new Error(`${fieldPath}: ${issue.message}`);
  }
  return result.data;
}

/**
 * AI レスポンスを BullBearDebateOutput にバリデーションして変換する。
 *
 * - null/非オブジェクト、marketContext・synthesis 欠落は throw（必須フィールド）
 * - bull/bear の scenario/confidence/rationale 不正は Zod エラーとしてフィールドパス付きで throw
 * - dominantBias・timeHorizon 不正は neutral/'both' にフォールバック
 * - biasStrength・preferredConfidence は 0-100 にクランプ
 * - phaseAnalysis 欠落または要素が非オブジェクト（null 等）は空配列/デフォルト値にフォールバック
 */
export function validateBullBearDebateOutput(data: unknown): BullBearDebateOutput {
  // 最上位の型チェック
  if (!data || typeof data !== 'object') {
    throw new Error('Bull vs Bear debate output must be an object');
  }
  const obj = data as Record<string, unknown>;

  // marketContext の存在チェック（Zod は内部フィールドをフォールバックで扱う）
  if (!obj.marketContext || typeof obj.marketContext !== 'object') {
    throw new Error('marketContext must be an object');
  }

  // synthesis の存在チェック
  if (!obj.synthesis || typeof obj.synthesis !== 'object') {
    throw new Error('synthesis must be an object');
  }

  return {
    marketContext: DebateMarketContextSchema.parse(obj.marketContext),
    bull: parseSideOutput(obj.bull, 'bull'),
    bear: parseSideOutput(obj.bear, 'bear'),
    synthesis: DebateSynthesisSchema.parse(obj.synthesis),
  };
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

    const rawData: unknown = await response.json();

    // OpenAIChatCompletionResponseSchema で安全にパースしてメタ情報を取得
    const chatResult = OpenAIChatCompletionResponseSchema.safeParse(rawData);
    const tokenUsage = chatResult.success ? (chatResult.data.usage?.total_tokens ?? 0) : 0;
    const model = chatResult.success ? chatResult.data.model : this.model;

    // parseOpenAIResponse でコンテンツ文字列を安全に抽出（未知の形式は throw）
    const content = parseOpenAIResponse(rawData);

    const extracted = extractJson(content);
    if (!extracted.ok) {
      throw new Error(
        `Bull vs Bear Debate 応答を JSON として解釈できませんでした: ${extracted.error}`,
      );
    }

    return {
      content: extracted.data,
      tokenUsage,
      model,
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
