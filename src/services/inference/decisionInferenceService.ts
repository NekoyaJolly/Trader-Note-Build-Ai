import { Trade } from '@prisma/client';
import { config } from '../../config';
import { MarketContext } from '../note-generator/featureExtractor';

export type InferredMode = 'trend' | 'meanReversion' | 'other';

export interface DecisionInferenceInput {
  trade: Trade;
  featureVector: number[];
  marketContext?: MarketContext;
}

export interface DecisionInferenceResult {
  primaryTimeframe: string;
  secondaryTimeframes: string[];
  inferredMode: InferredMode;
  rationale: string;
  promptTokens?: number;
  completionTokens?: number;
  model?: string;
  prompt?: string;
}

/**
 * 判断モードと時間足を推定する軽量サービス
 * - AI キー未設定時はヒューリスティックで安全に推定
 * - AI キー設定時は JSON 形式の出力を要求し、曖昧な場合は "other" を返させる
 */
export class DecisionInferenceService {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseURL: string;

  constructor() {
    this.apiKey = config.ai.apiKey;
    this.model = config.ai.model;
    this.baseURL = config.ai.baseURL || 'https://api.openai.com/v1';
  }

  /**
   * 時間足と判断モードを推定するエントリポイント
   */
  async infer(input: DecisionInferenceInput): Promise<DecisionInferenceResult> {
    const heuristic = this.heuristicInference(input);

    if (!this.apiKey) {
      // API キーがない場合はヒューリスティック結果をそのまま返す
      return heuristic;
    }

    try {
      const prompt = this.buildPrompt(input);
      const aiResult = await this.callAI(prompt);

      return {
        primaryTimeframe: aiResult.primaryTimeframe || heuristic.primaryTimeframe,
        secondaryTimeframes: aiResult.secondaryTimeframes || heuristic.secondaryTimeframes,
        inferredMode: aiResult.inferredMode || heuristic.inferredMode,
        rationale: aiResult.rationale || heuristic.rationale,
        promptTokens: aiResult.promptTokens,
        completionTokens: aiResult.completionTokens,
        model: aiResult.model,
        prompt,
      };
    } catch (error) {
      // AI 呼び出し失敗時はヒューリスティックにフォールバック
      console.warn('AI 推定に失敗したためヒューリスティック結果を使用します:', error);
      return heuristic;
    }
  }

  /**
   * ヒューリスティックな推定（AI なしでも決定可能なロジック）
   */
  private heuristicInference(input: DecisionInferenceInput): DecisionInferenceResult {
    const rsi = input.marketContext?.rsi ?? (input.featureVector[2] !== undefined ? input.featureVector[2] * 100 : 50);
    const primaryTimeframe = input.marketContext?.timeframe || '15m';
    const secondaryTimeframes = ['60m', '240m'].filter((tf) => tf !== primaryTimeframe).slice(0, 2);

    let inferredMode: InferredMode = 'other';
    let rationale: string;

    if (rsi >= 60) {
      inferredMode = 'trend';
      rationale = 'RSI が高めのため順張り傾向と推定';
    } else if (rsi <= 40) {
      inferredMode = 'meanReversion';
      rationale = 'RSI が低めのため逆張り傾向と推定';
    } else {
      inferredMode = 'other';
      rationale = 'RSI が中立域のため判断モードは不明';
    }

    return {
      primaryTimeframe,
      secondaryTimeframes,
      inferredMode,
      rationale,
    };
  }

  /**
   * AI に渡すプロンプトを生成する（日本語）
   */
  buildPrompt(input: DecisionInferenceInput): string {
    const { trade, featureVector, marketContext } = input;
    const rsi = marketContext?.rsi ?? (featureVector[2] !== undefined ? Math.round(featureVector[2] * 100) : '不明');
    const macd = marketContext?.macd ?? featureVector[3] ?? '不明';
    const timeframe = marketContext?.timeframe || '15m';

    return [
      '以下のトレード履歴と特徴量から、主時間足・補助時間足（最大2）・判断モードを推定してください。',
      '必ず JSON で返し、曖昧な場合は inferredMode を "other" にしてください。',
      'fields: { primaryTimeframe: string, secondaryTimeframes: string[], inferredMode: "trend"|"meanReversion"|"other", rationale: string }',
      '',
      '【入力】',
      `- 銘柄: ${trade.symbol}`,
      `- 売買: ${trade.side}`,
      `- 約定価格: ${trade.price}`,
      `- 数量: ${trade.quantity}`,
      `- 約定日時: ${trade.timestamp.toISOString()}`,
      `- 暗黙の時間足: ${timeframe}`,
      `- RSI(推定): ${rsi}`,
      `- MACD(推定): ${macd}`,
      `- 特徴量ベクトル: [${featureVector.map((v) => Number(v).toFixed(4)).join(', ')}]`,
      '',
      '【ルール】',
      '- trend: トレンドフォロー / meanReversion: 逆張り / other: 不明',
      '- primaryTimeframe は 15m / 60m / 240m など一般的な時間足に限定',
      '- secondaryTimeframes は 0〜2 件、primary と重複させない',
      '- rationale は 1 行以内の日本語で簡潔に記述',
    ].join('\n');
  }

  /**
   * OpenAI API を呼び出し JSON をパースする
   */
  private async callAI(prompt: string): Promise<Omit<DecisionInferenceResult, 'prompt'>> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: 'あなたはトレード判断モードの推定に特化したアシスタントです。必ず JSON のみを返してください。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI 推定 API エラー: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content || '{}';

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error('AI 応答の JSON パースに失敗しました');
    }

    return {
      primaryTimeframe: parsed.primaryTimeframe,
      secondaryTimeframes: parsed.secondaryTimeframes,
      inferredMode: parsed.inferredMode,
      rationale: parsed.rationale,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      model: data.model,
    };
  }
}
