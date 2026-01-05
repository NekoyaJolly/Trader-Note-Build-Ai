/**
 * Plan AI サービス
 * 
 * 目的: リサーチ結果を基に解釈・戦略立案を行う
 * 
 * 設計思想:
 * - Research AIから12次元特徴量を受け取る
 * - OHLCVスナップショットも参照して総合判断
 * - トレンド解釈、価格レベル判定、シナリオ生成を行う
 * - gpt-4oの高い推論能力を活用
 * 
 * 責務:
 * - 市場レジームの判定
 * - 重要価格レベルの特定
 * - 1-3個のトレードシナリオ生成
 * - リスクリワード比の計算
 * 
 * 使用モデル: gpt-4o（高品質な推論が必要）
 */

import { config } from '../../config';
import {
  FeatureVector12D,
  AITradeScenario,
  PlanAIOutput,
  validatePlanAIOutput,
} from '../models';
import { OHLCVSnapshot } from '../models/marketResearch';
import { MarketResearchWithTypes } from '../repositories';

// ===========================================
// 型定義
// ===========================================

/**
 * Plan AI への入力データ
 */
export interface PlanAIInput {
  research: MarketResearchWithTypes;
  targetDate: string;
  userPreferences?: UserTradingPreferences;
}

/**
 * ユーザーのトレード設定
 */
export interface UserTradingPreferences {
  preferredDirection?: 'long' | 'short' | 'both';
  maxRiskPips?: number;
  minRiskReward?: number;
  tradingStyle?: 'scalping' | 'daytrading' | 'swing';
}

/**
 * Plan AI の結果
 */
export interface PlanAIResult {
  output: PlanAIOutput;
  tokenUsage: number;
  model: string;
}

// ===========================================
// サービスクラス
// ===========================================

export class PlanAIService {
  private apiKey: string;
  private model: string;
  private baseURL: string;

  constructor() {
    this.apiKey = process.env.AI_API_KEY || '';
    this.model = 'gpt-4o';  // Plan AIは高品質モデル
    this.baseURL = config.ai.baseURL || 'https://api.openai.com/v1';
  }

  /**
   * トレードプランを生成
   */
  async generatePlan(input: PlanAIInput): Promise<PlanAIResult> {
    if (!this.apiKey) {
      console.warn('[PlanAI] APIキーが設定されていません。ダミーデータを返します。');
      return this.generateFallbackResult(input.research);
    }

    try {
      const prompt = this.buildPrompt(input);
      const result = await this.callAI(prompt);
      
      // バリデーション
      const validated = validatePlanAIOutput(result.content);
      
      return {
        output: validated,
        tokenUsage: result.tokenUsage,
        model: result.model,
      };
    } catch (error) {
      console.error('[PlanAI] エラー:', error);
      
      // リトライ（最大2回）
      for (let i = 0; i < 2; i++) {
        try {
          console.log(`[PlanAI] リトライ ${i + 1}/2`);
          const prompt = this.buildPrompt(input);
          const result = await this.callAI(prompt);
          const validated = validatePlanAIOutput(result.content);
          
          return {
            output: validated,
            tokenUsage: result.tokenUsage,
            model: result.model,
          };
        } catch (retryError) {
          console.error(`[PlanAI] リトライ ${i + 1} 失敗:`, retryError);
        }
      }
      
      // 全リトライ失敗時はフォールバック
      return this.generateFallbackResult(input.research);
    }
  }

  /**
   * プロンプトを構築（解釈・戦略立案を含む）
   */
  private buildPrompt(input: PlanAIInput): string {
    const { research, targetDate, userPreferences } = input;
    const fv = research.featureVector;
    const snapshot = research.ohlcvSnapshot;

    return `# トレードプラン生成リクエスト

## 対象日
${targetDate}

## シンボル
${research.symbol}

## 12次元特徴量（0-100スコア）

トレンド系:
- 強度(trendStrength): ${fv.trendStrength}
- 方向(trendDirection): ${fv.trendDirection} (0=強い下降, 50=横ばい, 100=強い上昇)
- MA配列(maAlignment): ${fv.maAlignment}
- 価格位置(pricePosition): ${fv.pricePosition}

モメンタム系:
- RSI(rsiLevel): ${fv.rsiLevel}
- MACDモメンタム(macdMomentum): ${fv.macdMomentum}
- ダイバージェンス(momentumDivergence): ${fv.momentumDivergence}

ボラティリティ系:
- レベル(volatilityLevel): ${fv.volatilityLevel}
- BB幅(bbWidth): ${fv.bbWidth}
- 傾向(volatilityTrend): ${fv.volatilityTrend}

価格構造系:
- サポート近接(supportProximity): ${fv.supportProximity}
- レジスタンス近接(resistanceProximity): ${fv.resistanceProximity}

## 価格データ
${snapshot ? `
- 現在値: ${snapshot.latestPrice}
- 直近高値: ${snapshot.recentHigh}
- 直近安値: ${snapshot.recentLow}
- 直近終値(10本): ${snapshot.recentCloses.join(', ')}
` : '価格データなし'}

${userPreferences ? `
## ユーザー設定
- 希望方向: ${userPreferences.preferredDirection || 'なし'}
- 最大リスク: ${userPreferences.maxRiskPips || '制限なし'} pips
- 最小RR: ${userPreferences.minRiskReward || '1.5'}
- スタイル: ${userPreferences.tradingStyle || 'daytrading'}
` : ''}

## タスク
上記の12次元特徴量と価格データから:
1. 市場レジームを判定
2. 重要価格レベルを特定
3. 1-3個のトレードシナリオを生成

## 出力形式（JSON）

\`\`\`json
{
  "marketAnalysis": {
    "regime": "<strong_uptrend|uptrend|range|downtrend|strong_downtrend|volatile>",
    "regimeConfidence": <0-100: レジーム判定の確信度>,
    "trendDirection": "<up|down|sideways>",
    "volatility": "<low|medium|high>",
    "keyLevels": {
      "strongResistance": [<価格>],
      "resistance": [<価格>],
      "support": [<価格>],
      "strongSupport": [<価格>]
    },
    "summary": "<日本語100文字以内の市場分析サマリー>",
    "additionalInsights": ["<追加の洞察1>", "<追加の洞察2>"]
  },
  "scenarios": [
    {
      "name": "<シナリオ名（日本語例: 押し目買いシナリオ）>",
      "direction": "<long|short>",
      "priority": "<primary|secondary|alternative>",
      "entry": {
        "type": "<limit|market|stop>",
        "price": <エントリー価格>,
        "condition": "<エントリー条件（日本語）>",
        "triggerIndicators": ["RSI", "MACD"]
      },
      "stopLoss": {
        "price": <SL価格>,
        "pips": <SL pips>,
        "reason": "<SL設定理由（日本語）>"
      },
      "takeProfit": {
        "price": <TP価格>,
        "pips": <TP pips>,
        "reason": "<TP設定理由（日本語）>"
      },
      "riskReward": <RR比（例: 2.5）>,
      "confidence": <信頼度 0-100>,
      "rationale": "<このシナリオを選んだ理由（日本語100-200文字）>",
      "invalidationConditions": ["<無効化条件1>", "<無効化条件2>"]
    }
  ],
  "overallConfidence": <全体の信頼度 0-100>,
  "warnings": ["<注意事項1>", "<注意事項2>"]
}
\`\`\`

## 重要な制約
- シナリオは1-3個
- primaryは必ず1つ
- RR比は最低1.5以上を推奨
- 価格レベルは直近高値/安値を参考に
- 日本語で記述`;
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
            content: `あなたは経験豊富なトレーダー兼市場アナリストです。
12次元特徴量（数値データ）と価格データから、市場状況を解釈し、実践的なトレードプランを生成してください。

あなたの役割:
1. 数値データから市場レジームを判定
2. 価格データから重要なサポート/レジスタンスを特定
3. 具体的なトレードシナリオを1-3個提案

重要: 必ず有効なJSONのみを出力してください。説明文は不要です。`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5,
        max_tokens: 3000,
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
  private generateFallbackResult(research: MarketResearchWithTypes): PlanAIResult {
    const fallbackOutput: PlanAIOutput = {
      marketAnalysis: {
        regime: 'range',
        regimeConfidence: 0,
        trendDirection: 'sideways',
        volatility: 'medium',
        keyLevels: {
          strongResistance: [],
          resistance: [],
          support: [],
          strongSupport: [],
        },
        summary: `${research.symbol}のプラン生成に失敗しました。フォールバックデータです。`,
        additionalInsights: [],
      },
      scenarios: [],
      overallConfidence: 0,
      warnings: ['プラン生成に失敗したため、トレードは推奨しません。'],
    };

    return {
      output: fallbackOutput,
      tokenUsage: 0,
      model: 'fallback',
    };
  }
}

// デフォルトインスタンス
export const planAIService = new PlanAIService();
