/**
 * Strategy Thinker AI サービス（旧 Plan AI）
 * 
 * 目的: Market Analyst の分析結果を基に、条件付きトレード戦略を生成
 * 
 * 設計思想:
 * - 旧: 12次元featureVector → 固定シナリオ（entry/SL/TP）
 * - 新: MarketAnalysis (リッチ分析) → 条件付き戦略 + 監視ルール
 * - AIが「なぜこのエントリーか」「何を監視すべきか」を明確に思考
 * - 自律エージェントが監視ループで使える構造化出力
 * 
 * 使用モデル: 環境変数 AI_MODEL / AI_BASE_URL から取得（OpenAI互換 API）
 */

import { config } from '../../config';
import {
  PlanAIOutput,
  validatePlanAIOutput,
} from '../models';
import type { MarketAnalysis } from '../models/marketAnalysis';
import { MarketResearchWithTypes } from '../repositories';
import {
  CORE_TRADING_RULES,
  getPlanIndicatorContext,
  MACRO_ENVIRONMENT_RULES,
  getMacroContext,
  MTF_ANALYSIS_RULES,
  getMTFContext,
} from '../knowledge';
import type { MacroEnvironmentData, HigherTimeframeContext } from '../knowledge';

// ===========================================
// 型定義
// ===========================================

/**
 * Strategy Thinker への入力データ
 */
export interface PlanAIInput {
  research: MarketResearchWithTypes;
  targetDate: string;
  userPreferences?: UserTradingPreferences;
  macroData?: MacroEnvironmentData;
  higherTF?: HigherTimeframeContext;
  /** エージェントの過去の学び（Phase 3で活用） */
  agentLessons?: string[];
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
    this.model = process.env.AI_MODEL || 'gpt-4o';
    this.baseURL = process.env.AI_BASE_URL || config.ai.baseURL || 'https://api.openai.com/v1';
  }

  /**
   * トレード戦略を生成
   */
  async generatePlan(input: PlanAIInput): Promise<PlanAIResult> {
    if (!this.apiKey) {
      console.warn('[StrategyThinker] APIキーが設定されていません。フォールバックを返します。');
      return this.generateFallbackResult(input.research);
    }

    try {
      const prompt = this.buildPrompt(input);
      const result = await this.callAI(prompt);
      const validated = validatePlanAIOutput(result.content);

      return {
        output: validated,
        tokenUsage: result.tokenUsage,
        model: result.model,
      };
    } catch (error) {
      console.error('[StrategyThinker] エラー:', error);

      for (let i = 0; i < 2; i++) {
        try {
          console.log(`[StrategyThinker] リトライ ${i + 1}/2`);
          const prompt = this.buildPrompt(input);
          const result = await this.callAI(prompt);
          const validated = validatePlanAIOutput(result.content);

          return {
            output: validated,
            tokenUsage: result.tokenUsage,
            model: result.model,
          };
        } catch (retryError) {
          console.error(`[StrategyThinker] リトライ ${i + 1} 失敗:`, retryError);
        }
      }

      return this.generateFallbackResult(input.research);
    }
  }

  /**
   * プロンプトを構築 — MarketAnalysis ベースの戦略思考
   */
  private buildPrompt(input: PlanAIInput): string {
    const { research, targetDate, userPreferences, macroData, higherTF, agentLessons } = input;
    const fv = research.featureVector;
    const snapshot = research.ohlcvSnapshot;
    const analysis = research.marketAnalysis;

    // MarketAnalysis がある場合のリッチコンテキスト
    const analysisContext = analysis ? `
## Market Analyst の分析結果

### 市場環境
- レジーム: ${analysis.regime}
- 方向性: ${analysis.direction}
- ボラティリティ: ${analysis.volatility}
- 信頼度: ${analysis.confidence}%

### AIの分析
- トレンド: ${analysis.reasoning.trendAnalysis}
- モメンタム: ${analysis.reasoning.momentumAnalysis}
- ボラティリティ: ${analysis.reasoning.volatilityAnalysis}
- 重要観察: ${analysis.reasoning.keyObservation}
- リスク要因: ${analysis.reasoning.riskFactors.join('; ')}

### キーレベル
${analysis.keyLevels.map(l => `- ${l.type === 'support' ? 'S' : 'R'} [${l.strength}]: ${l.price.toFixed(2)} — ${l.basis}`).join('\n')}

### クイックスコア
- トレンド強度: ${analysis.quickScores.trendStrength}/100
- モメンタム: ${analysis.quickScores.momentum}/100
- ボラティリティ: ${analysis.quickScores.volatility}/100
- サポート近接: ${analysis.quickScores.supportProximity}/100
- レジスタンス近接: ${analysis.quickScores.resistanceProximity}/100
` : `
## 12次元特徴量（旧形式）
トレンド: 強度=${fv.trendStrength}, 方向=${fv.trendDirection}, MA配列=${fv.maAlignment}, 価格位置=${fv.pricePosition}
モメンタム: RSI=${fv.rsiLevel}, MACD=${fv.macdMomentum}, ダイバージェンス=${fv.momentumDivergence}
ボラティリティ: レベル=${fv.volatilityLevel}, BB幅=${fv.bbWidth}, 傾向=${fv.volatilityTrend}
価格構造: サポート近接=${fv.supportProximity}, レジスタンス近接=${fv.resistanceProximity}
`;

    // エージェントの学び
    const lessonsContext = agentLessons && agentLessons.length > 0 ? `
## 過去のトレードからの学び
${agentLessons.map((l, i) => `${i + 1}. ${l}`).join('\n')}

上記の学びを踏まえて戦略を立ててください。同じ失敗を繰り返さないようにしてください。
` : '';

    return `# トレード戦略立案リクエスト

## あなたの役割
あなたは自律型トレーディングAIの「戦略思考」担当です。
Market Analyst の分析結果に基づいて、**再現性のある**トレード戦略を立案してください。

重要: あなたの戦略は自動実行されます。条件を明確に、曖昧さなく定義してください。

## 対象日: ${targetDate}
## シンボル: ${research.symbol}

${analysisContext}

## 価格データ
${snapshot ? `
- 現在値: ${snapshot.latestPrice}
- 直近高値: ${snapshot.recentHigh}
- 直近安値: ${snapshot.recentLow}
- 直近終値(10本): ${snapshot.recentCloses.map(c => c.toFixed(2)).join(', ')}
` : '価格データなし'}

${userPreferences ? `
## ユーザー設定
- 希望方向: ${userPreferences.preferredDirection || 'both'}
- 最大リスク: ${userPreferences.maxRiskPips || '制限なし'} pips
- 最小RR: ${userPreferences.minRiskReward || '1.5'}
- スタイル: ${userPreferences.tradingStyle || 'daytrading'}
` : ''}

${lessonsContext}

## 戦略立案のルール

### 再現性の原則
- 「なぜこのエントリーか」を必ず明記（rationale）
- 「いつこの戦略が無効になるか」を必ず明記（invalidationConditions）
- 感覚的判断ではなく、テクニカル根拠に基づく

### エントリー条件
- 「価格が〇〇に到達し、かつRSIが〇〇以下の場合」のように、具体的な条件を記述
- 自動監視で判定可能な条件にすること

### リスク管理
- SLは必ずテクニカル根拠のある場所に
- RR比は最低1.5以上を推奨
- 「エントリーしない」という判断も正しい

## 出力形式（JSON）

\`\`\`json
{
  "marketAnalysis": {
    "regime": "<strong_uptrend|uptrend|range|downtrend|strong_downtrend|volatile>",
    "regimeConfidence": <0-100>,
    "trendDirection": "<up|down|sideways>",
    "volatility": "<low|medium|high>",
    "keyLevels": {
      "strongResistance": [<価格>],
      "resistance": [<価格>],
      "support": [<価格>],
      "strongSupport": [<価格>]
    },
    "summary": "<日本語100文字以内の市場分析サマリー>",
    "additionalInsights": ["<追加の洞察>"]
  },
  "scenarios": [
    {
      "name": "<シナリオ名（日本語）>",
      "direction": "<long|short>",
      "priority": "<primary|secondary|alternative>",
      "entry": {
        "type": "<limit|market|stop>",
        "price": <エントリー価格>,
        "condition": "<エントリー条件（具体的に。例: RSIが35を下回り、BB下限に接触した場合）>",
        "triggerIndicators": ["RSI", "BB"]
      },
      "stopLoss": {
        "price": <SL価格>,
        "pips": <SL pips>,
        "reason": "<SL設定根拠>"
      },
      "takeProfit": {
        "price": <TP価格>,
        "pips": <TP pips>,
        "reason": "<TP設定根拠>"
      },
      "riskReward": <RR比>,
      "confidence": <0-100>,
      "rationale": "<この戦略の論理的根拠（なぜこの方向、このレベルか）100-200文字>",
      "invalidationConditions": [
        "<無効化条件（例: 価格がSMA200を下回った場合）>"
      ]
    }
  ],
  "overallConfidence": <0-100>,
  "warnings": ["<注意事項>"]
}
\`\`\`

## 重要な制約
- シナリオは0-3個（条件が悪ければ0個 = ノートレード推奨）
- primaryは最大1つ
- confidence 30未満のシナリオは出さない
- 日本語で記述
- 有効なJSONのみを出力${getPlanIndicatorContext(fv as Record<string, number>)}${getMacroContext(macroData)}${getMTFContext(higherTF, fv.trendDirection)}`;
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
            content: `あなたは自律型トレーディングAIの戦略立案エンジンです。
Market Analystの分析結果を基に、再現性のあるトレード戦略を立案してください。

${CORE_TRADING_RULES}

${MACRO_ENVIRONMENT_RULES}

${MTF_ANALYSIS_RULES}

あなたの戦略の特徴:
1. 再現性 — 同じ条件なら同じ判断をする
2. 条件明確 — 自動監視で判定できる具体的な条件
3. リスク管理 — 常にSL/TPの根拠を明記
4. 学習反映 — 過去の失敗から学んだことを反映
5. 見送り判断 — 条件が悪ければシナリオ0個もあり

重要: 必ず有効なJSONのみを出力してください。`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
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
        summary: `${research.symbol}の戦略生成に失敗しました。フォールバックデータです。`,
        additionalInsights: [],
      },
      scenarios: [],
      overallConfidence: 0,
      warnings: ['戦略生成に失敗したため、トレードは推奨しません。'],
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
