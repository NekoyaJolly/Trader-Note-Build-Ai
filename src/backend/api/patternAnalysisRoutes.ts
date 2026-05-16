/**
 * パターン分析 API ルート
 * 
 * エンドポイント:
 * - POST /api/pattern-analysis/analyze      - パターン分析実行
 * - POST /api/pattern-analysis/anomaly      - 異常検知実行
 * - GET  /api/pattern-analysis/patterns/:strategyId - 勝ちパターン取得
 * 
 * 参照: docs/phase-next/ml-pattern-recognition.md
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import type {
  PatternAnalysisInput,
  AnomalyDetectionInput,
  FeatureVector,
  WinningPattern} from '../services/patternAnalysisService';
import {
  patternAnalysisService
} from '../services/patternAnalysisService';
import { prisma } from '../db/client';

const router = Router();

// ============================================
// Zod スキーマ定義
// ============================================

/** 12次元特徴量スキーマ */
const FeatureVectorSchema = z.object({
  trendStrength: z.number().min(0).max(100),
  trendDirection: z.number().min(0).max(100),
  maAlignment: z.number().min(0).max(100),
  pricePosition: z.number().min(0).max(100),
  rsiLevel: z.number().min(0).max(100),
  macdMomentum: z.number().min(0).max(100),
  momentumDivergence: z.number().min(0).max(100),
  volatilityLevel: z.number().min(0).max(100),
  bbWidth: z.number().min(0).max(100),
  volatilityTrend: z.number().min(0).max(100),
  supportProximity: z.number().min(0).max(100),
  resistanceProximity: z.number().min(0).max(100),
});

/** パターン分析の追加コンテキスト */
const PatternContextSchema = z
  .object({
    recentPrice: z.number().optional(),
    recentHigh: z.number().optional(),
    recentLow: z.number().optional(),
    timeframe: z.string().optional(),
  })
  .optional();

/** ストラテジー単位のパターン分析リクエスト */
const AnalyzeStrategyRequestSchema = z.object({
  strategyId: z.string().min(1, 'strategyId は必須です'),
  currentFeatures: FeatureVectorSchema,
  context: PatternContextSchema,
});

/** パターン分析リクエストスキーマ */
const PatternAnalysisRequestSchema = z.object({
  symbol: z.string().min(1),
  currentFeatures: FeatureVectorSchema,
  winningPatterns: z.array(z.object({
    id: z.string(),
    name: z.string(),
    featureVector: FeatureVectorSchema,
    winRate: z.number().min(0).max(1),
    profitFactor: z.number().min(0),
    tradeCount: z.number().min(0),
    description: z.string().optional(),
  })).min(1).max(10),
  side: z.enum(['buy', 'sell']),
  context: z.object({
    recentPrice: z.number().optional(),
    recentHigh: z.number().optional(),
    recentLow: z.number().optional(),
    timeframe: z.string().optional(),
  }).optional(),
});

/** 異常検知リクエストスキーマ */
const AnomalyDetectionRequestSchema = z.object({
  symbol: z.string().min(1),
  currentFeatures: FeatureVectorSchema,
  normalPatterns: z.array(FeatureVectorSchema).min(1).max(100),
  context: z.object({
    recentPrice: z.number().optional(),
    timeframe: z.string().optional(),
  }).optional(),
});

// ============================================
// エンドポイント
// ============================================

/**
 * POST /api/pattern-analysis/analyze
 * パターン分析を実行
 * 
 * 現在の市場状況と過去の勝ちパターンを比較し、
 * 類似度スコアとエントリー推奨度を算出
 */
router.post('/analyze', async (req: Request, res: Response) => {
  try {
    // バリデーション
    const parseResult = PatternAnalysisRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: parseResult.error.format(),
      });
    }

    const input: PatternAnalysisInput = parseResult.data;

    console.log(`[PatternAnalysis] 分析開始: ${input.symbol}, ${input.winningPatterns.length}パターン比較`);

    const result = await patternAnalysisService.analyzePattern(input);

    console.log(`[PatternAnalysis] 分析完了: スコア=${result.overallScore}, 推奨=${result.recommendation}`);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[PatternAnalysis] エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/pattern-analysis/anomaly
 * 異常検知を実行
 * 
 * 現在の市場状況が通常パターンから逸脱しているか判定
 */
router.post('/anomaly', async (req: Request, res: Response) => {
  try {
    // バリデーション
    const parseResult = AnomalyDetectionRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: parseResult.error.format(),
      });
    }

    const input: AnomalyDetectionInput = parseResult.data;

    console.log(`[AnomalyDetection] 検知開始: ${input.symbol}, ${input.normalPatterns.length}パターン比較`);

    const result = await patternAnalysisService.detectAnomaly(input);

    console.log(`[AnomalyDetection] 検知完了: スコア=${result.anomalyScore}, 異常=${result.isAnomaly}`);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[AnomalyDetection] エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * GET /api/pattern-analysis/patterns/:strategyId
 * ストラテジーの勝ちパターンを取得
 * 
 * バックテスト結果から勝ちトレードのパターンを抽出
 */
router.get('/patterns/:strategyId', async (req: Request, res: Response) => {
  try {
    const { strategyId } = req.params;
    const { minWinRate, limit } = req.query;

    // ストラテジー存在確認
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) {
      return res.status(404).json({
        success: false,
        error: 'ストラテジーが見つかりません',
      });
    }

    // バックテスト結果から勝ちトレードを取得
    const backtestRuns = await prisma.strategyBacktestRun.findMany({
      where: {
        strategyId,
        status: 'completed',
      },
      include: {
        events: {
          where: {
            outcome: 'win',
          },
          orderBy: {
            pnl: 'desc',
          },
          take: limit ? parseInt(limit as string, 10) : 10,
        },
        result: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 5,  // 直近5回のバックテスト
    });

    // 勝ちトレードからパターンを抽出
    const patterns: WinningPattern[] = [];
    let patternIndex = 0;

    for (const run of backtestRuns) {
      for (const event of run.events) {
        // indicatorValuesから特徴量を抽出
        const indicators = event.indicatorValues as Record<string, number> | null;
        
        if (!indicators) continue;

        // 12次元特徴量に変換
        const featureVector: FeatureVector = {
          trendStrength: indicators.trendStrength ?? 50,
          trendDirection: indicators.trendDirection ?? 50,
          maAlignment: indicators.maAlignment ?? 50,
          pricePosition: indicators.pricePosition ?? 50,
          rsiLevel: indicators.rsi ?? indicators.rsiLevel ?? 50,
          macdMomentum: indicators.macdMomentum ?? 50,
          momentumDivergence: indicators.momentumDivergence ?? 0,
          volatilityLevel: indicators.volatilityLevel ?? 50,
          bbWidth: indicators.bbWidth ?? 50,
          volatilityTrend: indicators.volatilityTrend ?? 50,
          supportProximity: indicators.supportProximity ?? 50,
          resistanceProximity: indicators.resistanceProximity ?? 50,
        };

        patterns.push({
          id: event.id,
          name: `勝ちパターン #${++patternIndex}`,
          featureVector,
          winRate: run.result?.winRate ?? 0.5,
          profitFactor: run.result?.profitFactor ?? 1.0,
          tradeCount: 1,
          description: `${event.entryTime.toISOString().split('T')[0]} のトレード`,
        });
      }
    }

    // 勝率でフィルタリング
    const minWinRateValue = minWinRate ? parseFloat(minWinRate as string) : 0.5;
    const filteredPatterns = patterns.filter(p => p.winRate >= minWinRateValue);

    res.json({
      success: true,
      data: {
        strategyId,
        strategyName: strategy.name,
        patterns: filteredPatterns.slice(0, limit ? parseInt(limit as string, 10) : 10),
        totalPatterns: filteredPatterns.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[PatternAnalysis] パターン取得エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

/**
 * POST /api/pattern-analysis/analyze-strategy
 * ストラテジーに対してパターン分析を実行
 * 
 * ストラテジーIDと現在の特徴量を指定すると、
 * 過去の勝ちパターンと比較して分析結果を返す
 */
router.post('/analyze-strategy', async (req: Request, res: Response) => {
  try {
    // Zod で req.body を具体型に narrow
    const parsed = AnalyzeStrategyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.format(),
      });
    }
    const { strategyId, currentFeatures, context } = parsed.data;

    // ストラテジー取得
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) {
      return res.status(404).json({
        success: false,
        error: 'ストラテジーが見つかりません',
      });
    }

    // 勝ちパターンを取得
    const backtestRuns = await prisma.strategyBacktestRun.findMany({
      where: {
        strategyId,
        status: 'completed',
      },
      include: {
        events: {
          where: { outcome: 'win' },
          orderBy: { pnl: 'desc' },
          take: 10,
        },
        result: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });

    // パターンを抽出
    const winningPatterns: WinningPattern[] = [];
    let idx = 0;

    for (const run of backtestRuns) {
      for (const event of run.events) {
        const indicators = event.indicatorValues as Record<string, number> | null;
        if (!indicators) continue;

        winningPatterns.push({
          id: event.id,
          name: `勝ちパターン #${++idx}`,
          featureVector: {
            trendStrength: indicators.trendStrength ?? 50,
            trendDirection: indicators.trendDirection ?? 50,
            maAlignment: indicators.maAlignment ?? 50,
            pricePosition: indicators.pricePosition ?? 50,
            rsiLevel: indicators.rsi ?? indicators.rsiLevel ?? 50,
            macdMomentum: indicators.macdMomentum ?? 50,
            momentumDivergence: indicators.momentumDivergence ?? 0,
            volatilityLevel: indicators.volatilityLevel ?? 50,
            bbWidth: indicators.bbWidth ?? 50,
            volatilityTrend: indicators.volatilityTrend ?? 50,
            supportProximity: indicators.supportProximity ?? 50,
            resistanceProximity: indicators.resistanceProximity ?? 50,
          },
          winRate: run.result?.winRate ?? 0.5,
          profitFactor: run.result?.profitFactor ?? 1.0,
          tradeCount: 1,
        });
      }
    }

    if (winningPatterns.length === 0) {
      return res.status(400).json({
        success: false,
        error: '比較可能な勝ちパターンがありません。先にバックテストを実行してください。',
      });
    }

    // パターン分析実行
    const input: PatternAnalysisInput = {
      symbol: strategy.symbol,
      currentFeatures,
      winningPatterns,
      side: strategy.side as 'buy' | 'sell',
      context,
    };

    const result = await patternAnalysisService.analyzePattern(input);

    res.json({
      success: true,
      data: {
        strategy: {
          id: strategy.id,
          name: strategy.name,
          symbol: strategy.symbol,
          side: strategy.side,
        },
        patternsCompared: winningPatterns.length,
        analysis: result,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラーが発生しました';
    console.error('[PatternAnalysis] ストラテジー分析エラー:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

export default router;

