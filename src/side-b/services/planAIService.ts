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
import { loadPrompt } from '../prompts/loader';
import type { LensFeatureSnapshot } from '../lenses';
import type { EdgeHypothesis } from '../models/edgeHypothesis';

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
  /**
   * 並列レンズ出力（Phase 3 で導入）
   * Strategy Thinker のユーザープロンプトに注入される。
   */
  lensSnapshot?: LensFeatureSnapshot;
  /**
   * EdgeLedger + HypothesisGenerator から提示される候補仮説（Phase 4a）
   * Strategy Thinker はこの中から選択・戦略化する。
   */
  candidateHypotheses?: EdgeHypothesis[];
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
    const { research, targetDate, userPreferences, macroData, higherTF, agentLessons, lensSnapshot, candidateHypotheses } = input;
    const fv = research.featureVector;
    const snapshot = research.ohlcvSnapshot;
    const analysis = research.marketAnalysis;
    const lensContext = this.buildLensContext(lensSnapshot);
    const candidateContext = this.buildCandidateHypothesesContext(candidateHypotheses);

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

システムプロンプトに記載した**3ステップ（仮説生成 → 自己反証 → 戦略化）**で思考し、指定のJSON形式で出力してください。

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

${lensContext}

${candidateContext}

## このリクエストに関する注意
- エントリー条件は自動監視で判定可能な具体的条件にすること
- 戦略化で採用したシナリオには必ず indicatorsUsed / indicatorsIgnored / reasonForSelection / reasonForIgnoring / patternLabel / multipleTestingDefense を埋めること
- シナリオは 0〜3個（条件が揃わなければ 0個 = ノートレード推奨）
- 有効な JSON のみを出力${getPlanIndicatorContext(fv as Record<string, number>)}${getMacroContext(macroData)}${getMTFContext(higherTF, fv.trendDirection)}`;
  }

  /**
   * EdgeLedger / HypothesisGenerator から提示された候補仮説を
   * ユーザープロンプトに整形する。空なら空文字列を返す。
   */
  private buildCandidateHypothesesContext(
    candidates?: readonly EdgeHypothesis[],
  ): string {
    if (!candidates || candidates.length === 0) return '';

    const sections: string[] = ['## 候補仮説（EdgeLedger + HypothesisGenerator）'];
    for (const h of candidates) {
      sections.push(
        `### ${h.id} [${h.status}, ${h.category}, ${h.expectedDirection}]`,
        `- ${h.statement}`,
      );
      if (h.observationCount > 0) {
        const decided = h.winCount + h.lossCount;
        const winRate = decided > 0 ? ((h.winCount / decided) * 100).toFixed(1) : 'n/a';
        sections.push(
          `- 観測: ${h.observationCount}回 (勝${h.winCount}/負${h.lossCount}/引${h.breakevenCount}, 勝率${winRate}%, 累計${h.totalPnlPips.toFixed(1)}pips)`,
        );
      }
      if (h.conditions && h.conditions.length > 0) {
        sections.push('- 成立条件:');
        for (const c of h.conditions) {
          sections.push(`  - ${c.lensName}.${c.featureKey} ${c.op} ${JSON.stringify(c.value)}`);
        }
      }
    }

    sections.push(
      `\nあなたはこれらの候補から**選択・戦略化**することに集中してください。新規仮説の生成は不要です（他のエージェントの責務）。`,
      `選んだ ID は selectedHypothesisId に、棄却した ID は rejectedCandidateIds に明記してください。`,
    );

    return sections.join('\n');
  }

  /**
   * 並列レンズ出力をユーザープロンプトに注入する形に整形する。
   * snapshot が空 or 未指定の場合は空文字列を返す。
   */
  private buildLensContext(snapshot?: LensFeatureSnapshot): string {
    if (!snapshot || snapshot.features.size === 0) return '';

    const sections: string[] = ['## 並列レンズ観測結果'];
    for (const [lensName, feature] of snapshot.features.entries()) {
      sections.push(`### ${lensName} (v${feature.lensVersion}, confidence=${feature.confidence ?? 'n/a'})`);
      for (const [key, value] of Object.entries(feature.features)) {
        sections.push(`- ${key}: ${JSON.stringify(value)}`);
      }
    }

    sections.push(
      `\nこれらは独立した複数の観測レンズの出力です。どのレンズを重視するかはあなたが判断してください。`,
      `ただし、採用した/しなかったレンズとその理由は indicatorsUsed / indicatorsIgnored / reasonForSelection / reasonForIgnoring に明記してください。`,
    );

    return sections.join('\n');
  }

  /**
   * AI APIを呼び出し
   */
  private async callAI(prompt: string): Promise<{ content: unknown; tokenUsage: number; model: string }> {
    const systemPrompt = loadPrompt('strategy_thinker', {
      CORE_TRADING_RULES,
      MACRO_ENVIRONMENT_RULES,
      MTF_ANALYSIS_RULES,
    });

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
            content: systemPrompt,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 3500,
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
