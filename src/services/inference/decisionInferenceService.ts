import type { Trade } from '@prisma/client';
import { config, modelFor } from '../../config';
import { AIProvider } from '../../side-b/agent/aiProvider';
import type { MarketContext } from '../note-generator/featureExtractor';

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
    this.model = modelFor('decision_inference');
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

    // if/else 全分岐で必ず代入されるため初期値は付けない
    let inferredMode: InferredMode;
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
      // Prisma の Decimal 型は template literal で直接展開できないため明示的に文字列化する
      `- 約定価格: ${trade.price.toString()}`,
      `- 数量: ${trade.quantity.toString()}`,
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
   * AIProvider 経由で OpenAI 互換 API を呼び出し、JSON 応答をパースする
   */
  private async callAI(prompt: string): Promise<Omit<DecisionInferenceResult, 'prompt'>> {
    const provider = new AIProvider({
      apiKey: this.apiKey,
      model: this.model,
      baseURL: this.baseURL,
    });

    const aiResponse = await provider.chat(
      [
        { role: 'system', content: 'あなたはトレード判断モードの推定に特化したアシスタントです。必ず JSON のみを返してください。' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.2, maxTokens: 300, responseFormat: { type: 'json_object' } },
    );

    interface ParsedInferenceResult {
      primaryTimeframe?: string;
      secondaryTimeframes?: string[];
      inferredMode?: string;
      rationale?: string;
    }

    const content = aiResponse.content || '{}';
    let parsed: ParsedInferenceResult;
    try {
      parsed = JSON.parse(content) as ParsedInferenceResult;
    } catch {
      throw new Error('AI 応答の JSON パースに失敗しました');
    }

    return {
      primaryTimeframe: parsed.primaryTimeframe || '1h',
      secondaryTimeframes: parsed.secondaryTimeframes || ['15m', '4h'],
      inferredMode: validateInferredMode(parsed.inferredMode),
      rationale: parsed.rationale || 'AI 推定結果',
      promptTokens: aiResponse.promptTokens,
      completionTokens: aiResponse.completionTokens,
      model: aiResponse.model,
    };
  }
}

/**
 * AI が返す `inferredMode` が enum (InferredMode) のいずれかであるかをランタイムで検証する。
 * 想定外文字列 (例: 'trendish') が来たら 'other' にフォールバック。
 * 型 assertion だけでは契約違反を見逃すため、明示的な値チェックで防御する。
 */
const VALID_INFERRED_MODES: readonly InferredMode[] = ['trend', 'meanReversion', 'other'];
// AI 由来の任意文字列を InferredMode enum に narrow する境界関数のため unknown を受ける。
// eslint-disable-next-line no-restricted-syntax -- AI 出力の任意値を enum に narrow する境界関数
function validateInferredMode(value: unknown): InferredMode {
  if (typeof value === 'string' && (VALID_INFERRED_MODES as readonly string[]).includes(value)) {
    return value as InferredMode;
  }
  return 'other';
}
