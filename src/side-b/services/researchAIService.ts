/**
 * Research AI サービス
 * 
 * 目的: 市場データを12次元特徴量に変換する「数値変換器」
 * 
 * 設計思想:
 * - OHLCVデータから12次元特徴量のみを算出
 * - 解釈（トレンド判断、価格レベル）はPlan AIに委ねる
 * - gpt-4o-miniの能力範囲内に収めたシンプルなタスク
 * 
 * 使用モデル: gpt-4o-mini（コスト最適化）
 */

import { config } from '../../config';
import {
  FeatureVector12D,
  ResearchAIOutput,
  validateResearchAIOutput,
  calculateExpiryDate,
} from '../models';
import { OHLCVSnapshot } from '../models/marketResearch';

// ===========================================
// 型定義
// ===========================================

/**
 * Research AI への入力データ
 */
export interface ResearchAIInput {
  symbol: string;
  timeframe?: string;
  ohlcvData: OHLCVData[];
  indicators?: IndicatorData;
}

/**
 * OHLCVデータ
 */
export interface OHLCVData {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * インジケーターデータ（事前計算済み）
 */
export interface IndicatorData {
  rsi?: number;
  macd?: { value: number; signal: number; histogram: number };
  sma20?: number;
  sma50?: number;
  sma200?: number;
  ema20?: number;
  atr?: number;
  bbUpper?: number;
  bbLower?: number;
  bbMiddle?: number;
}

/**
 * Research AI の結果
 */
export interface ResearchAIResult {
  output: ResearchAIOutput;
  ohlcvSnapshot: OHLCVSnapshot;
  expiresAt: Date;
  tokenUsage: number;
  model: string;
}

// ===========================================
// サービスクラス
// ===========================================

export class ResearchAIService {
  private apiKey: string;
  private model: string;
  private baseURL: string;

  constructor() {
    this.apiKey = process.env.AI_API_KEY || '';
    this.model = 'gpt-4o-mini';  // Research AIはコスト最適化のため軽量モデル
    this.baseURL = config.ai.baseURL || 'https://api.openai.com/v1';
  }

  /**
   * 市場リサーチを生成
   */
  async generateResearch(input: ResearchAIInput): Promise<ResearchAIResult> {
    // OHLCVスナップショットを事前計算
    const ohlcvSnapshot = this.createOHLCVSnapshot(input.ohlcvData);
    
    if (!this.apiKey) {
      console.warn('[ResearchAI] APIキーが設定されていません。ダミーデータを返します。');
      return this.generateFallbackResult(input.symbol, ohlcvSnapshot);
    }

    try {
      const prompt = this.buildPrompt(input, ohlcvSnapshot);
      const result = await this.callAI(prompt);
      
      // バリデーション
      const validated = validateResearchAIOutput(result.content);
      
      return {
        output: validated,
        ohlcvSnapshot,
        expiresAt: calculateExpiryDate(4),  // 4時間有効
        tokenUsage: result.tokenUsage,
        model: result.model,
      };
    } catch (error) {
      console.error('[ResearchAI] エラー:', error);
      
      // リトライ（最大3回）
      for (let i = 0; i < 2; i++) {
        try {
          console.log(`[ResearchAI] リトライ ${i + 1}/2`);
          const prompt = this.buildPrompt(input, ohlcvSnapshot);
          const result = await this.callAI(prompt);
          const validated = validateResearchAIOutput(result.content);
          
          return {
            output: validated,
            ohlcvSnapshot,
            expiresAt: calculateExpiryDate(4),
            tokenUsage: result.tokenUsage,
            model: result.model,
          };
        } catch (retryError) {
          console.error(`[ResearchAI] リトライ ${i + 1} 失敗:`, retryError);
        }
      }
      
      // 全リトライ失敗時はフォールバック
      return this.generateFallbackResult(input.symbol, ohlcvSnapshot);
    }
  }

  /**
   * OHLCVスナップショットを作成（Plan AI用）
   */
  private createOHLCVSnapshot(ohlcvData: OHLCVData[]): OHLCVSnapshot {
    const recentData = ohlcvData.slice(-100);
    const latestPrice = recentData[recentData.length - 1]?.close || 0;
    
    const highs = recentData.map(d => d.high);
    const lows = recentData.map(d => d.low);
    const closes = recentData.map(d => d.close);
    
    return {
      latestPrice,
      recentHigh: Math.max(...highs),
      recentLow: Math.min(...lows),
      dataPoints: recentData.length,
      recentCloses: closes.slice(-10),
    };
  }

  /**
   * プロンプトを構築（シンプル化: 12次元特徴量のみ）
   */
  private buildPrompt(input: ResearchAIInput, snapshot: OHLCVSnapshot): string {
    const { symbol, indicators } = input;

    return `# 12次元特徴量算出リクエスト

## 対象
- シンボル: ${symbol}
- データ数: ${snapshot.dataPoints}本

## 価格データ
- 現在値: ${snapshot.latestPrice}
- 直近高値: ${snapshot.recentHigh}
- 直近安値: ${snapshot.recentLow}
- 直近終値(10本): ${snapshot.recentCloses.join(', ')}

## テクニカル指標
${indicators ? `
- RSI: ${indicators.rsi ?? 'N/A'}
- MACD: ${indicators.macd ? `${indicators.macd.value} (シグナル: ${indicators.macd.signal})` : 'N/A'}
- SMA20: ${indicators.sma20 ?? 'N/A'}
- SMA50: ${indicators.sma50 ?? 'N/A'}
- SMA200: ${indicators.sma200 ?? 'N/A'}
- ATR: ${indicators.atr ?? 'N/A'}
- BB上: ${indicators.bbUpper ?? 'N/A'}, BB下: ${indicators.bbLower ?? 'N/A'}
` : '事前計算なし（OHLCVから推定してください）'}

## タスク
上記のデータから12次元特徴量を算出してください。
各値は0-100の正規化スコアです。

## 出力形式（JSON）

\`\`\`json
{
  "featureVector": {
    "trendStrength": <0-100: トレンド強度（ADX相当）>,
    "trendDirection": <0-100: 0=強い下降, 50=横ばい, 100=強い上昇>,
    "maAlignment": <0-100: MA配列の整列度>,
    "pricePosition": <0-100: MA群に対する価格位置>,
    "rsiLevel": <0-100: RSI値>,
    "macdMomentum": <0-100: MACDモメンタム>,
    "momentumDivergence": <0-100: ダイバージェンス強度>,
    "volatilityLevel": <0-100: ボラティリティレベル>,
    "bbWidth": <0-100: ボリンジャーバンド幅>,
    "volatilityTrend": <0-100: ボラ傾向（拡大方向なら高い）>,
    "supportProximity": <0-100: サポートへの近さ>,
    "resistanceProximity": <0-100: レジスタンスへの近さ>
  }
}
\`\`\`

重要: featureVectorのみを出力してください。解釈や説明は不要です。`;
  }

  /**
   * AI APIを呼び出し
   */
  private async callAI(prompt: string): Promise<{ content: unknown; tokenUsage: number; model: string }> {
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
            content: `あなたは市場データを数値化する専門家です。与えられたOHLCVデータとテクニカル指標から、12次元特徴量を算出してください。
重要: 
- 必ず有効なJSONのみを出力してください
- featureVectorオブジェクトのみを出力
- 解釈や説明文は不要
- 各値は0-100の整数`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,  // 数値変換なのでより決定的に
        max_tokens: 500,   // 出力が小さくなったのでトークン削減
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`AI API エラー: ${response.status} - ${errorBody}`);
    }

    const data = await response.json() as {
      choices?: { message?: { content?: string } }[];
      usage?: { total_tokens?: number };
      model?: string;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('AI APIからの応答が空です');
    }

    // JSONパース
    const parsed = JSON.parse(content);

    return {
      content: parsed,
      tokenUsage: data.usage?.total_tokens || 0,
      model: data.model || this.model,
    };
  }

  /**
   * フォールバック結果を生成（API失敗時）
   */
  private generateFallbackResult(symbol: string, ohlcvSnapshot: OHLCVSnapshot): ResearchAIResult {
    // 中立的な特徴量（すべて50）
    const fallbackOutput: ResearchAIOutput = {
      featureVector: {
        trendStrength: 50,
        trendDirection: 50,
        maAlignment: 50,
        pricePosition: 50,
        rsiLevel: 50,
        macdMomentum: 50,
        momentumDivergence: 0,
        volatilityLevel: 50,
        bbWidth: 50,
        volatilityTrend: 50,
        supportProximity: 50,
        resistanceProximity: 50,
      },
    };

    console.warn(`[ResearchAI] ${symbol}: フォールバックデータを使用`);

    return {
      output: fallbackOutput,
      ohlcvSnapshot,
      expiresAt: calculateExpiryDate(1),  // フォールバックは1時間のみ有効
      tokenUsage: 0,
      model: 'fallback',
    };
  }
}

// デフォルトインスタンス
export const researchAIService = new ResearchAIService();
