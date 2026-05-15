/**
 * 市場分析（MarketAnalysis）型定義
 * 
 * 自立循環思考型トレードAIの「観察」フェーズの出力。
 * 
 * 設計思想:
 * - 旧: 12次元数値ベクトル（解釈なし）
 * - 新: AIが市場を「読む」— 構造化データ + 推論テキスト
 * - 人間が読んでも理解でき、AIが次のステップで使える
 * 
 * 用途:
 * - Strategy Thinker AI への入力
 * - PDCAサイクルの「Plan」フェーズの基盤
 * - ダッシュボードでのAI思考可視化
 */

import { z } from 'zod';
import type { JsonValue } from '../../utils/jsonValue';
import type { FeatureVector12D } from './featureVector';

// ===========================================
// Zodスキーマ定義
// ===========================================

/**
 * 市場レジーム（相場環境）
 */
export const MarketRegimeSchema = z.enum([
    'strong_uptrend',   // 強い上昇トレンド
    'weak_uptrend',     // 弱い上昇トレンド
    'range',            // レンジ相場
    'weak_downtrend',   // 弱い下降トレンド
    'strong_downtrend', // 強い下降トレンド
    'breakout',         // ブレイクアウト中
    'choppy',           // 方向感なし（荒い）
]);

export type MarketRegimeType = z.infer<typeof MarketRegimeSchema>;

/**
 * キーレベル（サポート/レジスタンス）
 */
export const KeyLevelSchema = z.object({
    price: z.number(),
    type: z.enum(['support', 'resistance']),
    strength: z.enum(['strong', 'moderate', 'weak']),
    basis: z.string(), // このレベルの根拠（例: "SMA200との合流")
});

export type KeyLevel = z.infer<typeof KeyLevelSchema>;

/**
 * AIの推論テキスト
 */
export const MarketReasoningSchema = z.object({
    /** トレンドの判断根拠 */
    trendAnalysis: z.string(),
    /** モメンタムの状態 */
    momentumAnalysis: z.string(),
    /** ボラティリティの見通し */
    volatilityAnalysis: z.string(),
    /** 最も重要な観察ポイント */
    keyObservation: z.string(),
    /** 注意すべきリスク要因 */
    riskFactors: z.array(z.string()),
});

export type MarketReasoning = z.infer<typeof MarketReasoningSchema>;

/**
 * 市場分析（メイン型）— Research AIの新しい出力
 */
export const MarketAnalysisSchema = z.object({
    // === 構造化データ（機械可読） ===

    /** 市場レジーム */
    regime: MarketRegimeSchema,
    /** 方向性 */
    direction: z.enum(['bullish', 'bearish', 'neutral']),
    /** ボラティリティ */
    volatility: z.enum(['high', 'medium', 'low']),
    /** 分析の信頼度 (0-100) */
    confidence: z.number().min(0).max(100),

    // === キーレベル ===
    keyLevels: z.array(KeyLevelSchema).min(2).max(8),

    // === AIの推論 ===
    reasoning: MarketReasoningSchema,

    // === 旧 featureVector 互換（レガシー対応用） ===
    /** 12次元スコアの簡易版（ダッシュボード表示用） */
    quickScores: z.object({
        trendStrength: z.number().min(0).max(100),
        momentum: z.number().min(0).max(100),
        volatility: z.number().min(0).max(100),
        supportProximity: z.number().min(0).max(100),
        resistanceProximity: z.number().min(0).max(100),
    }),
});

export type MarketAnalysis = z.infer<typeof MarketAnalysisSchema>;

// ===========================================
// バリデーション
// ===========================================

/**
 * MarketAnalysis のバリデーション
 */
export function validateMarketAnalysis(data: JsonValue): MarketAnalysis {
    return MarketAnalysisSchema.parse(data);
}

/**
 * 安全なバリデーション（例外を投げない）
 */
export function safeValidateMarketAnalysis(data: JsonValue): MarketAnalysis | null {
    const result = MarketAnalysisSchema.safeParse(data);
    return result.success ? result.data : null;
}

// ===========================================
// ユーティリティ
// ===========================================

/**
 * レジームを日本語に変換
 */
export function regimeToJapaneseV2(regime: MarketRegimeType): string {
    const map: Record<MarketRegimeType, string> = {
        strong_uptrend: '強い上昇トレンド',
        weak_uptrend: '弱い上昇トレンド',
        range: 'レンジ相場',
        weak_downtrend: '弱い下降トレンド',
        strong_downtrend: '強い下降トレンド',
        breakout: 'ブレイクアウト',
        choppy: '方向感なし',
    };
    return map[regime];
}

/**
 * 市場分析の要約テキスト（ログ/ダッシュボード用）
 */
export function summarizeMarketAnalysis(analysis: MarketAnalysis): string {
    const regime = regimeToJapaneseV2(analysis.regime);
    const dir = analysis.direction === 'bullish' ? '🟢 強気' :
        analysis.direction === 'bearish' ? '🔴 弱気' : '⚪ 中立';
    const vol = analysis.volatility === 'high' ? '高ボラ' :
        analysis.volatility === 'low' ? '低ボラ' : '中ボラ';

    const supports = analysis.keyLevels
        .filter(l => l.type === 'support' && l.strength === 'strong')
        .map(l => l.price.toFixed(2));
    const resistances = analysis.keyLevels
        .filter(l => l.type === 'resistance' && l.strength === 'strong')
        .map(l => l.price.toFixed(2));

    let summary = `${dir} ${regime} | ${vol} | 信頼度${analysis.confidence}%`;
    if (supports.length > 0) summary += ` | S: ${supports.join(', ')}`;
    if (resistances.length > 0) summary += ` | R: ${resistances.join(', ')}`;

    return summary;
}

/**
 * MarketAnalysis を旧フォーマット FeatureVector12D に変換（後方互換）
 */
export function analysisToLegacyFeatureVector(analysis: MarketAnalysis): FeatureVector12D {
    const dirScore = analysis.direction === 'bullish' ? 70 :
        analysis.direction === 'bearish' ? 30 : 50;
    const volScore = analysis.volatility === 'high' ? 80 :
        analysis.volatility === 'low' ? 20 : 50;

    return {
        trendStrength: Math.round(Math.min(100, Math.max(0, analysis.quickScores.trendStrength))),
        trendDirection: dirScore,
        maAlignment: Math.round(Math.min(100, Math.max(0, analysis.quickScores.trendStrength))),
        pricePosition: 50,
        rsiLevel: Math.round(Math.min(100, Math.max(0, analysis.quickScores.momentum))),
        macdMomentum: Math.round(Math.min(100, Math.max(0, analysis.quickScores.momentum))),
        momentumDivergence: 0,
        volatilityLevel: volScore,
        bbWidth: Math.round(Math.min(100, Math.max(0, analysis.quickScores.volatility))),
        volatilityTrend: Math.round(Math.min(100, Math.max(0, analysis.quickScores.volatility))),
        supportProximity: Math.round(Math.min(100, Math.max(0, analysis.quickScores.supportProximity))),
        resistanceProximity: Math.round(Math.min(100, Math.max(0, analysis.quickScores.resistanceProximity))),
    };
}
