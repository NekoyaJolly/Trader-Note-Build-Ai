/**
 * AI 要約サービス
 * 
 * 目的: トレードデータから日本語の要約を生成する
 * 
 * 重要原則:
 * - トークン使用量を最小化 (コスト削減)
 * - 日本語で 3〜5 行の簡潔な要約
 * - AI にロジック判断を委ねない (入力は構造化 JSON のみ)
 * - 冗長な表現は禁止
 * 
 * 制約:
 * - 最大トークン数: 150 (要約は短文であるべき)
 * - API キーがない場合は基本要約にフォールバック
 */

import { config } from '../config';

/**
 * トレードデータの構造化入力
 */
export interface TradeDataForSummary {
  symbol: string;           // 銘柄シンボル (例: 'BTCUSD')
  side: 'buy' | 'sell';     // 売買区分
  price: number;            // 約定価格
  quantity: number;         // 数量
  timestamp: Date;          // 約定日時
  marketContext?: {         // 市場コンテキスト (オプション)
    trend?: 'uptrend' | 'downtrend' | 'neutral';  // トレンド
    rsi?: number;           // RSI 指標
    macd?: number;          // MACD 指標
    timeframe?: string;     // タイムフレーム
  };
}

/**
 * AI API レスポンス (トークン使用量を含む)
 */
export interface AISummaryResult {
  summary: string;          // 生成された要約 (日本語)
  promptTokens?: number;    // プロンプトで使用したトークン数
  completionTokens?: number; // 完了で使用したトークン数
  model?: string;           // 使用したモデル名
}

/**
 * AI 要約サービス
 */
export class AISummaryService {
  private apiKey: string;
  private model: string;
  private baseURL: string;

  constructor() {
    this.apiKey = config.ai.apiKey;
    this.model = config.ai.model;
    this.baseURL = config.ai.baseURL || 'https://api.openai.com/v1';
  }

  /**
   * トレードの日本語要約を生成する
   * 
   * @param tradeData - トレードデータ (構造化)
   * @returns AI 要約結果 (日本語要約とトークン使用量)
   * 
   * 前提条件:
   * - tradeData は必須フィールドがすべて入力されていること
   * 
   * 副作用:
   * - AI API を呼び出す (外部通信)
   * - トークンを消費する (コスト発生)
   * 
   * エラーハンドリング:
   * - API キーがない場合: 基本要約にフォールバック
   * - API エラーの場合: 基本要約にフォールバック
   */
  async generateTradeSummary(tradeData: TradeDataForSummary): Promise<AISummaryResult> {
    // API キーが設定されていない場合は基本要約を返す
    if (!this.apiKey) {
      console.warn('AI API キーが設定されていません。基本要約を使用します。');
      return {
        summary: this.generateBasicSummary(tradeData),
        model: 'fallback',
      };
    }

    try {
      // トークン効率的なプロンプトを構築
      const prompt = this.buildJapanesePrompt(tradeData);
      
      // AI API を呼び出して要約を生成
      const result = await this.callAIAPI(prompt);
      
      return result;
    } catch (error) {
      console.error('AI 要約生成エラー:', error);
      
      // エラー時は基本要約にフォールバック
      return {
        summary: this.generateBasicSummary(tradeData),
        model: 'fallback-error',
      };
    }
  }

  /**
   * 日本語要約用のプロンプトを構築する
   * 
   * @param tradeData - トレードデータ
   * @returns AI に送信するプロンプト (日本語)
   * 
   * トークン最小化のポイント:
   * - 構造化されたデータのみを送信
   * - 冗長な説明は含めない
   * - 要約は 3〜5 行に制限
   */
  private buildJapanesePrompt(tradeData: TradeDataForSummary): string {
    const { symbol, side, price, quantity, timestamp, marketContext } = tradeData;
    
    // 売買区分を日本語に変換
    const sideLabel = side === 'buy' ? '買い' : '売り';
    
    // 日時をフォーマット
    const dateStr = timestamp.toLocaleString('ja-JP', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    // トークン効率的なプロンプト (構造化データのみ)
    let prompt = '以下のトレードを 3〜5 行で簡潔に要約してください。\n\n';
    prompt += `【トレード情報】\n`;
    prompt += `- 銘柄: ${symbol}\n`;
    prompt += `- 売買: ${sideLabel}\n`;
    prompt += `- 価格: ${price}\n`;
    prompt += `- 数量: ${quantity}\n`;
    prompt += `- 日時: ${dateStr}\n`;
    
    // 市場コンテキストがあれば追加
    if (marketContext) {
      prompt += '\n【市場状況】\n';
      
      if (marketContext.trend) {
        const trendLabel = 
          marketContext.trend === 'uptrend' ? '上昇トレンド' :
          marketContext.trend === 'downtrend' ? '下降トレンド' : '横ばい';
        prompt += `- トレンド: ${trendLabel}\n`;
      }
      
      if (marketContext.rsi !== undefined) {
        prompt += `- RSI: ${marketContext.rsi.toFixed(1)}\n`;
      }
      
      if (marketContext.macd !== undefined) {
        prompt += `- MACD: ${marketContext.macd.toFixed(2)}\n`;
      }
      
      if (marketContext.timeframe) {
        prompt += `- 時間軸: ${marketContext.timeframe}\n`;
      }
    }
    
    prompt += '\n【要件】\n';
    prompt += '- 日本語で記述すること\n';
    prompt += '- トレードの背景・市場状況・判断根拠を含めること\n';
    prompt += '- 冗長な表現は避け、簡潔に記述すること\n';
    
    return prompt;
  }

  /**
   * AI API を呼び出す
   * 
   * @param prompt - プロンプト
   * @returns AI 要約結果
   * 
   * 実装:
   * - OpenAI API (Chat Completions) を使用
   * - max_tokens を 150 に制限 (短文要約)
   * - temperature を 0.3 に設定 (安定した出力)
   */
  private async callAIAPI(prompt: string): Promise<AISummaryResult> {
    // 開発環境では実際の API 呼び出しをスキップ可能
    if (process.env.NODE_ENV === 'development' && !this.apiKey.startsWith('sk-')) {
      console.log('AI API 呼び出し (シミュレーション)');
      return {
        summary: this.generateBasicSummary({
          symbol: 'TEST',
          side: 'buy',
          price: 0,
          quantity: 0,
          timestamp: new Date(),
        }),
        promptTokens: 100,
        completionTokens: 50,
        model: 'simulated',
      };
    }

    // OpenAI API を呼び出す
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'あなたはトレード分析の専門家です。トレードデータから簡潔で分かりやすい要約を日本語で生成してください。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 150,      // トークン使用量を制限
        temperature: 0.3,     // 安定した出力
      }),
    });

    if (!response.ok) {
      throw new Error(`AI API エラー: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    
    return {
      summary: data.choices[0].message.content.trim(),
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      model: data.model,
    };
  }

  /**
   * 基本要約を生成する (AI を使わない)
   * 
   * @param tradeData - トレードデータ
   * @returns 日本語の基本要約
   * 
   * 用途:
   * - API キーがない場合のフォールバック
   * - API エラー時のフォールバック
   * - テスト環境
   */
  private generateBasicSummary(tradeData: TradeDataForSummary): string {
    const { symbol, side, price, quantity, timestamp, marketContext } = tradeData;
    
    const sideLabel = side === 'buy' ? '買い' : '売り';
    const dateStr = timestamp.toLocaleDateString('ja-JP');
    
    let summary = `${dateStr} に ${symbol} を ${sideLabel} (価格: ${price}, 数量: ${quantity})`;
    
    if (marketContext?.trend) {
      const trendLabel = 
        marketContext.trend === 'uptrend' ? '上昇トレンド' :
        marketContext.trend === 'downtrend' ? '下降トレンド' : '横ばい';
      summary += `。市場は${trendLabel}。`;
    }
    
    return summary;
  }
}
