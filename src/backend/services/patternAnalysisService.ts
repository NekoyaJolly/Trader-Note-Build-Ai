/**
 * パターン分析 AI サービス
 * 
 * 目的:
 * - 現在の市場状況と過去の勝ちパターンを比較
 * - 類似度スコアとエントリー推奨度を算出
 * - 判断理由を人間が理解できる形で説明
 * 
 * 使用モデル: gpt-4o-mini（コスト最適化）
 * 
 * 参照: docs/phase-next/ml-pattern-recognition.md
 */

import { config, modelFor } from '../../config';
import type { JsonValue } from '../../utils/jsonValue';
import { AIProvider } from '../../side-b/agent/aiProvider';

// ===========================================
// 型定義
// ===========================================

/** 12次元特徴量ベクトル */
export interface FeatureVector {
  trendStrength: number;      // トレンド強度（0-100）
  trendDirection: number;     // トレンド方向（0=下降, 50=横ばい, 100=上昇）
  maAlignment: number;        // MA配列の整列度
  pricePosition: number;      // MA群に対する価格位置
  rsiLevel: number;           // RSI値
  macdMomentum: number;       // MACDモメンタム
  momentumDivergence: number; // ダイバージェンス強度
  volatilityLevel: number;    // ボラティリティレベル
  bbWidth: number;            // ボリンジャーバンド幅
  volatilityTrend: number;    // ボラ傾向
  supportProximity: number;   // サポートへの近さ
  resistanceProximity: number;// レジスタンスへの近さ
}

/** 過去の勝ちパターン */
export interface WinningPattern {
  id: string;
  name: string;
  featureVector: FeatureVector;
  winRate: number;
  profitFactor: number;
  tradeCount: number;
  description?: string;
}

/** パターン分析入力 */
export interface PatternAnalysisInput {
  /** 対象シンボル */
  symbol: string;
  /** 現在の12次元特徴量 */
  currentFeatures: FeatureVector;
  /** 比較対象の勝ちパターン（最大10個） */
  winningPatterns: WinningPattern[];
  /** 売買方向 */
  side: 'buy' | 'sell';
  /** 追加コンテキスト（任意） */
  context?: {
    recentPrice?: number;
    recentHigh?: number;
    recentLow?: number;
    timeframe?: string;
  };
}

/** パターンマッチ結果 */
export interface PatternMatch {
  patternId: string;
  patternName: string;
  similarity: number;  // 0-100
  matchedDimensions: string[];
  divergentDimensions: string[];
}

/** エントリー推奨度 */
export type Recommendation = 'strong' | 'moderate' | 'weak' | 'avoid';

/** パターン分析結果 */
export interface PatternAnalysisResult {
  /** 総合類似度スコア（0-100） */
  overallScore: number;
  /** エントリー推奨度 */
  recommendation: Recommendation;
  /** 信頼度（0-1） */
  confidence: number;
  /** 各パターンとのマッチング結果 */
  patternMatches: PatternMatch[];
  /** 推奨理由（日本語） */
  reasons: string[];
  /** リスク要因（日本語） */
  risks: string[];
  /** 推奨アクション */
  suggestedAction: string;
  /** トークン使用量 */
  tokenUsage: number;
  /** 使用モデル */
  model: string;
  /** 分析日時 */
  analyzedAt: string;
}

/** 異常検知入力 */
export interface AnomalyDetectionInput {
  symbol: string;
  currentFeatures: FeatureVector;
  /** 過去の通常パターン（直近N件の平均など） */
  normalPatterns: FeatureVector[];
  context?: {
    recentPrice?: number;
    timeframe?: string;
  };
}

/** 異常検知結果 */
export interface AnomalyDetectionResult {
  /** 異常スコア（0-100、高いほど異常） */
  anomalyScore: number;
  /** 異常判定 */
  isAnomaly: boolean;
  /** 異常の種類 */
  anomalyType: 'volatility_spike' | 'trend_reversal' | 'volume_anomaly' | 'pattern_break' | 'none';
  /** 異常な次元 */
  anomalousDimensions: string[];
  /** 説明 */
  explanation: string;
  /** 推奨アクション */
  suggestedAction: string;
  tokenUsage: number;
  model: string;
  analyzedAt: string;
}

// ===========================================
// サービスクラス
// ===========================================

export class PatternAnalysisService {
  private apiKey: string;
  private model: string;
  private baseURL: string;

  constructor() {
    this.apiKey = process.env.AI_API_KEY || '';
    // modelFor('pattern_analysis') 経由で AI_MODEL_OVERRIDE_ALL / AI_MODEL_PATTERN_ANALYSIS を尊重する
    this.model = modelFor('pattern_analysis');
    this.baseURL = config.ai.baseURL || 'https://api.openai.com/v1';
  }

  /**
   * パターン分析を実行
   * 現在の市場状況と過去の勝ちパターンを比較
   */
  async analyzePattern(input: PatternAnalysisInput): Promise<PatternAnalysisResult> {
    if (!this.apiKey) {
      console.warn('[PatternAnalysis] APIキーが設定されていません。フォールバックを返します。');
      return this.generateFallbackResult(input);
    }

    try {
      const prompt = this.buildPatternAnalysisPrompt(input);
      const result = await this.callAI(prompt, this.buildPatternSystemPrompt());
      
      // レスポンスをパース・バリデーション
      const parsed = this.parsePatternAnalysisResponse(result.content, input);
      
      return {
        ...parsed,
        tokenUsage: result.tokenUsage,
        model: result.model,
        analyzedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[PatternAnalysis] エラー:', error);
      return this.generateFallbackResult(input);
    }
  }

  /**
   * 異常検知を実行
   * 通常パターンからの逸脱を検出
   */
  async detectAnomaly(input: AnomalyDetectionInput): Promise<AnomalyDetectionResult> {
    if (!this.apiKey) {
      console.warn('[AnomalyDetection] APIキーが設定されていません。フォールバックを返します。');
      return this.generateAnomalyFallback(input);
    }

    try {
      const prompt = this.buildAnomalyDetectionPrompt(input);
      const result = await this.callAI(prompt, this.buildAnomalySystemPrompt());
      
      const parsed = this.parseAnomalyDetectionResponse(result.content);
      
      return {
        ...parsed,
        tokenUsage: result.tokenUsage,
        model: result.model,
        analyzedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[AnomalyDetection] エラー:', error);
      return this.generateAnomalyFallback(input);
    }
  }

  /**
   * パターン分析用システムプロンプト
   */
  private buildPatternSystemPrompt(): string {
    return `あなたはFXトレードのパターン分析AIです。

## 役割
- 現在の市場状況（12次元特徴量）と過去の勝ちパターンを比較
- 類似度スコアとエントリー推奨度を算出
- 判断理由を日本語で説明

## 重要なルール
1. 必ず有効なJSONのみを出力
2. 各スコアは0-100の整数
3. 理由は具体的なインジケーター値を参照
4. リスクも必ず列挙（楽観的すぎない）
5. 日本語で出力

## 推奨度の基準
- strong: 類似度80%以上、複数パターンで一致
- moderate: 類似度60-80%、主要パターンで一致
- weak: 類似度40-60%、一部パターンのみ一致
- avoid: 類似度40%未満、またはリスク要因が多い`;
  }

  /**
   * パターン分析プロンプトを構築
   */
  private buildPatternAnalysisPrompt(input: PatternAnalysisInput): string {
    const { symbol, currentFeatures, winningPatterns, side, context } = input;

    // 特徴量を見やすく整形
    const formatFeatures = (f: FeatureVector): string => {
      return `  トレンド強度: ${f.trendStrength}, 方向: ${f.trendDirection}
  MA配列: ${f.maAlignment}, 価格位置: ${f.pricePosition}
  RSI: ${f.rsiLevel}, MACD: ${f.macdMomentum}
  ダイバージェンス: ${f.momentumDivergence}
  ボラティリティ: ${f.volatilityLevel}, BB幅: ${f.bbWidth}
  サポート近接: ${f.supportProximity}, レジスタンス近接: ${f.resistanceProximity}`;
    };

    const patternsText = winningPatterns.slice(0, 10).map((p, i) => `
### パターン${i + 1}: ${p.name}
- 勝率: ${(p.winRate * 100).toFixed(1)}%
- PF: ${p.profitFactor.toFixed(2)}
- トレード数: ${p.tradeCount}
${formatFeatures(p.featureVector)}`).join('\n');

    return `# パターン分析リクエスト

## 対象
- シンボル: ${symbol}
- 売買方向: ${side === 'buy' ? '買い' : '売り'}
${context ? `- 現在価格: ${context.recentPrice}
- 時間足: ${context.timeframe || '不明'}` : ''}

## 現在の市場状況（12次元特徴量）
${formatFeatures(currentFeatures)}

## 比較対象の勝ちパターン
${patternsText}

## タスク
1. 現在の市場状況が各勝ちパターンにどれだけ類似しているか分析
2. 総合的なエントリー推奨度を判定
3. 判断理由とリスク要因を列挙

## 出力形式（JSON）
\`\`\`json
{
  "overallScore": <0-100: 総合類似度>,
  "recommendation": "strong" | "moderate" | "weak" | "avoid",
  "confidence": <0.0-1.0: 信頼度>,
  "patternMatches": [
    {
      "patternId": "<パターンID>",
      "patternName": "<パターン名>",
      "similarity": <0-100>,
      "matchedDimensions": ["一致した次元名"],
      "divergentDimensions": ["乖離した次元名"]
    }
  ],
  "reasons": ["推奨理由1", "推奨理由2"],
  "risks": ["リスク要因1", "リスク要因2"],
  "suggestedAction": "エントリー推奨/様子見/見送り"
}
\`\`\``;
  }

  /**
   * 異常検知用システムプロンプト
   */
  private buildAnomalySystemPrompt(): string {
    return `あなたは市場の異常検知AIです。

## 役割
- 現在の市場状況が通常パターンから逸脱しているか判定
- 異常の種類と程度を特定
- 推奨アクションを提示

## 異常の種類
- volatility_spike: ボラティリティの急上昇
- trend_reversal: トレンド転換の兆候
- volume_anomaly: 出来高の異常
- pattern_break: 通常パターンからの逸脱
- none: 異常なし

## 重要なルール
1. 必ず有効なJSONのみを出力
2. 異常スコアは0-100（50以上で異常判定）
3. 説明は日本語で具体的に`;
  }

  /**
   * 異常検知プロンプトを構築
   */
  private buildAnomalyDetectionPrompt(input: AnomalyDetectionInput): string {
    const { symbol, currentFeatures, normalPatterns, context } = input;

    // 通常パターンの平均を計算
    const avgNormal = this.calculateAverageFeatures(normalPatterns);

    const formatFeatures = (f: FeatureVector): string => {
      return `トレンド強度: ${f.trendStrength}, 方向: ${f.trendDirection}, RSI: ${f.rsiLevel}, ボラ: ${f.volatilityLevel}`;
    };

    return `# 異常検知リクエスト

## 対象
- シンボル: ${symbol}
${context ? `- 現在価格: ${context.recentPrice}
- 時間足: ${context.timeframe || '不明'}` : ''}

## 現在の市場状況
${formatFeatures(currentFeatures)}

## 通常パターン（過去${normalPatterns.length}件の平均）
${formatFeatures(avgNormal)}

## 各次元の乖離度
${this.calculateDeviations(currentFeatures, avgNormal)}

## タスク
1. 現在の状況が通常パターンから逸脱しているか判定
2. 異常の種類と程度を特定
3. 推奨アクションを提示

## 出力形式（JSON）
\`\`\`json
{
  "anomalyScore": <0-100>,
  "isAnomaly": true | false,
  "anomalyType": "volatility_spike" | "trend_reversal" | "volume_anomaly" | "pattern_break" | "none",
  "anomalousDimensions": ["異常な次元名"],
  "explanation": "日本語での説明",
  "suggestedAction": "推奨アクション"
}
\`\`\``;
  }

  /**
   * 特徴量の平均を計算
   */
  private calculateAverageFeatures(patterns: FeatureVector[]): FeatureVector {
    if (patterns.length === 0) {
      return this.getNeutralFeatures();
    }

    const sum: FeatureVector = {
      trendStrength: 0,
      trendDirection: 0,
      maAlignment: 0,
      pricePosition: 0,
      rsiLevel: 0,
      macdMomentum: 0,
      momentumDivergence: 0,
      volatilityLevel: 0,
      bbWidth: 0,
      volatilityTrend: 0,
      supportProximity: 0,
      resistanceProximity: 0,
    };

    for (const p of patterns) {
      for (const key of Object.keys(sum) as (keyof FeatureVector)[]) {
        sum[key] += p[key];
      }
    }

    const avg: FeatureVector = { ...sum };
    for (const key of Object.keys(avg) as (keyof FeatureVector)[]) {
      avg[key] = Math.round(avg[key] / patterns.length);
    }

    return avg;
  }

  /**
   * 乖離度を計算してテキスト化
   */
  private calculateDeviations(current: FeatureVector, normal: FeatureVector): string {
    const deviations: string[] = [];
    const keys: (keyof FeatureVector)[] = [
      'trendStrength', 'trendDirection', 'rsiLevel', 
      'volatilityLevel', 'macdMomentum', 'bbWidth'
    ];

    for (const key of keys) {
      const diff = current[key] - normal[key];
      if (Math.abs(diff) > 15) {
        deviations.push(`- ${key}: ${diff > 0 ? '+' : ''}${diff} (現在: ${current[key]}, 通常: ${normal[key]})`);
      }
    }

    return deviations.length > 0 ? deviations.join('\n') : '- 大きな乖離なし';
  }

  /**
   * 中立的な特徴量を取得
   */
  private getNeutralFeatures(): FeatureVector {
    return {
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
    };
  }

  /**
   * AI APIを呼び出し (AIProvider 経由)
   */
  private async callAI(
    prompt: string,
    systemPrompt: string
  ): Promise<{ content: JsonValue; tokenUsage: number; model: string }> {
    const provider = new AIProvider({
      apiKey: this.apiKey,
      model: this.model,
      baseURL: this.baseURL,
    });

    const aiResponse = await provider.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.3, maxTokens: 1000, responseFormat: { type: 'json_object' } },
    );

    const content = aiResponse.content;
    if (!content) {
      throw new Error('AI APIからの応答が空です');
    }

    return {
      content: JSON.parse(content) as JsonValue,
      tokenUsage: aiResponse.tokenUsage,
      model: aiResponse.model,
    };
  }

  /**
   * パターン分析レスポンスをパース
   */
  private parsePatternAnalysisResponse(
    content: JsonValue,
    input: PatternAnalysisInput
  ): Omit<PatternAnalysisResult, 'tokenUsage' | 'model' | 'analyzedAt'> {
    const data = content as Record<string, JsonValue | undefined>;

    // デフォルト値でフォールバック
    const overallScore = typeof data.overallScore === 'number' 
      ? Math.min(100, Math.max(0, data.overallScore)) 
      : 50;

    const recommendation = ['strong', 'moderate', 'weak', 'avoid'].includes(data.recommendation as string)
      ? data.recommendation as Recommendation
      : 'weak';

    const confidence = typeof data.confidence === 'number'
      ? Math.min(1, Math.max(0, data.confidence))
      : 0.5;

    const patternMatches: PatternMatch[] = Array.isArray(data.patternMatches)
      ? data.patternMatches.map((raw, i) => {
          const m =
            raw !== null && typeof raw === 'object' && !Array.isArray(raw)
              ? (raw as Record<string, JsonValue | undefined>)
              : {};
          const patternIdVal = m.patternId;
          const patternNameVal = m.patternName;
          return {
            patternId:
              typeof patternIdVal === 'string'
                ? patternIdVal
                : input.winningPatterns[i]?.id || `pattern-${i}`,
            patternName:
              typeof patternNameVal === 'string'
                ? patternNameVal
                : input.winningPatterns[i]?.name || `パターン${i + 1}`,
            similarity: typeof m.similarity === 'number' ? m.similarity : 50,
            matchedDimensions: Array.isArray(m.matchedDimensions) ? m.matchedDimensions.filter((x): x is string => typeof x === 'string') : [],
            divergentDimensions: Array.isArray(m.divergentDimensions)
              ? m.divergentDimensions.filter((x): x is string => typeof x === 'string')
              : [],
          };
        })
      : [];

    const reasons = Array.isArray(data.reasons) ? data.reasons as string[] : ['分析データ不足'];
    const risks = Array.isArray(data.risks) ? data.risks as string[] : ['リスク評価不可'];
    const suggestedAction = typeof data.suggestedAction === 'string' 
      ? data.suggestedAction 
      : '様子見';

    return {
      overallScore,
      recommendation,
      confidence,
      patternMatches,
      reasons,
      risks,
      suggestedAction,
    };
  }

  /**
   * 異常検知レスポンスをパース
   */
  private parseAnomalyDetectionResponse(
    content: JsonValue
  ): Omit<AnomalyDetectionResult, 'tokenUsage' | 'model' | 'analyzedAt'> {
    const data = content as Record<string, JsonValue | undefined>;

    const anomalyScore = typeof data.anomalyScore === 'number'
      ? Math.min(100, Math.max(0, data.anomalyScore))
      : 30;

    const isAnomaly = typeof data.isAnomaly === 'boolean' 
      ? data.isAnomaly 
      : anomalyScore >= 50;

    const validTypes = ['volatility_spike', 'trend_reversal', 'volume_anomaly', 'pattern_break', 'none'];
    const anomalyType = validTypes.includes(data.anomalyType as string)
      ? data.anomalyType as AnomalyDetectionResult['anomalyType']
      : 'none';

    return {
      anomalyScore,
      isAnomaly,
      anomalyType,
      anomalousDimensions: Array.isArray(data.anomalousDimensions) 
        ? data.anomalousDimensions as string[] 
        : [],
      explanation: typeof data.explanation === 'string' 
        ? data.explanation 
        : '分析完了',
      suggestedAction: typeof data.suggestedAction === 'string'
        ? data.suggestedAction
        : '通常通り',
    };
  }

  /**
   * パターン分析のフォールバック結果
   */
  private generateFallbackResult(input: PatternAnalysisInput): PatternAnalysisResult {
    // コサイン類似度で簡易計算
    const similarities = input.winningPatterns.map(pattern => {
      const similarity = this.calculateCosineSimilarity(
        input.currentFeatures,
        pattern.featureVector
      );
      return {
        patternId: pattern.id,
        patternName: pattern.name,
        similarity: Math.round(similarity * 100),
        matchedDimensions: [] as string[],
        divergentDimensions: [] as string[],
      };
    });

    const avgSimilarity = similarities.length > 0
      ? similarities.reduce((sum, s) => sum + s.similarity, 0) / similarities.length
      : 50;

    const recommendation: Recommendation = 
      avgSimilarity >= 80 ? 'strong' :
      avgSimilarity >= 60 ? 'moderate' :
      avgSimilarity >= 40 ? 'weak' : 'avoid';

    return {
      overallScore: Math.round(avgSimilarity),
      recommendation,
      confidence: 0.5,  // フォールバックは低信頼度
      patternMatches: similarities,
      reasons: ['AI分析が利用できないため、数値的類似度のみで判定'],
      risks: ['詳細なリスク分析は利用できません'],
      suggestedAction: recommendation === 'avoid' ? '見送り' : '様子見',
      tokenUsage: 0,
      model: 'fallback',
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * 異常検知のフォールバック結果
   */
  private generateAnomalyFallback(input: AnomalyDetectionInput): AnomalyDetectionResult {
    // 通常パターンとの乖離を計算
    const avgNormal = this.calculateAverageFeatures(input.normalPatterns);
    const deviation = this.calculateDeviation(input.currentFeatures, avgNormal);
    const anomalyScore = Math.min(100, deviation);

    return {
      anomalyScore,
      isAnomaly: anomalyScore >= 50,
      anomalyType: anomalyScore >= 50 ? 'pattern_break' : 'none',
      anomalousDimensions: [],
      explanation: 'AI分析が利用できないため、数値的乖離度のみで判定',
      suggestedAction: anomalyScore >= 50 ? '注意が必要' : '通常通り',
      tokenUsage: 0,
      model: 'fallback',
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * コサイン類似度を計算
   */
  private calculateCosineSimilarity(a: FeatureVector, b: FeatureVector): number {
    const keys = Object.keys(a) as (keyof FeatureVector)[];
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (const key of keys) {
      dotProduct += a[key] * b[key];
      normA += a[key] * a[key];
      normB += b[key] * b[key];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * 平均乖離度を計算
   */
  private calculateDeviation(current: FeatureVector, normal: FeatureVector): number {
    const keys = Object.keys(current) as (keyof FeatureVector)[];
    let totalDeviation = 0;

    for (const key of keys) {
      totalDeviation += Math.abs(current[key] - normal[key]);
    }

    // 12次元の平均乖離度を0-100スケールに変換
    return (totalDeviation / keys.length);
  }
}

// デフォルトインスタンス
export const patternAnalysisService = new PatternAnalysisService();

