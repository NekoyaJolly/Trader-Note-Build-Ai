/**
 * Side-B コントローラー
 * 
 * 目的: Side-B（TradeAssistant-AI）のAPIエンドポイント処理
 * 
 * エンドポイント:
 * - POST /api/side-b/research - リサーチ生成
 * - GET /api/side-b/research/:id - リサーチ取得
 * - GET /api/side-b/research - リサーチ一覧
 * - POST /api/side-b/plans - プラン生成
 * - GET /api/side-b/plans/:id - プラン取得
 * - GET /api/side-b/plans - プラン一覧
 * - POST /api/side-b/pipeline - フルパイプライン実行
 */

import { Request, Response } from 'express';
import {
  aiOrchestrator,
  researchRepository,
  planRepository,
  MarketResearchWithTypes,
  AITradePlanWithTypes,
} from '..';

export class SideBController {
  // ===========================================
  // リサーチ関連
  // ===========================================

  /**
   * POST /api/side-b/research
   * リサーチを生成
   */
  generateResearch = async (req: Request, res: Response): Promise<void> => {
    try {
      const { symbol, timeframe, ohlcvData, indicators, forceRefresh } = req.body;

      // バリデーション
      if (!symbol) {
        res.status(400).json({ error: 'symbol は必須です' });
        return;
      }

      if (!ohlcvData || !Array.isArray(ohlcvData) || ohlcvData.length === 0) {
        res.status(400).json({ error: 'ohlcvData は必須です（配列）' });
        return;
      }

      // OHLCVデータの変換（timestampをDateに）
      const parsedOhlcv = ohlcvData.map((d: { timestamp: string | Date; open: number; high: number; low: number; close: number; volume?: number }) => ({
        ...d,
        timestamp: new Date(d.timestamp),
      }));

      const result = await aiOrchestrator.generateResearch({
        symbol,
        timeframe,
        ohlcvData: parsedOhlcv,
        indicators,
        forceRefresh: forceRefresh || false,
      });

      if (!result.success) {
        res.status(500).json({ error: result.error });
        return;
      }

      res.json({
        success: true,
        research: result.data,
        cached: result.cached,
        tokenUsage: result.tokenUsage,
      });
    } catch (error) {
      console.error('[SideBController] generateResearch error:', error);
      res.status(500).json({ error: 'リサーチ生成に失敗しました' });
    }
  };

  /**
   * GET /api/side-b/research/:id
   * リサーチを取得
   */
  getResearchById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const research = await researchRepository.findById(id);

      if (!research) {
        res.status(404).json({ error: 'リサーチが見つかりません' });
        return;
      }

      res.json({ success: true, research });
    } catch (error) {
      console.error('[SideBController] getResearchById error:', error);
      res.status(500).json({ error: 'リサーチ取得に失敗しました' });
    }
  };

  /**
   * GET /api/side-b/research
   * リサーチ一覧を取得
   */
  listResearch = async (req: Request, res: Response): Promise<void> => {
    try {
      const { symbol, validOnly, limit, offset } = req.query;

      const researches = await researchRepository.findMany({
        symbol: symbol as string | undefined,
        validOnly: validOnly === 'true',
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
      });

      const total = await researchRepository.count({
        symbol: symbol as string | undefined,
        validOnly: validOnly === 'true',
      });

      res.json({
        success: true,
        researches,
        total,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });
    } catch (error) {
      console.error('[SideBController] listResearch error:', error);
      res.status(500).json({ error: 'リサーチ一覧取得に失敗しました' });
    }
  };

  /**
   * GET /api/side-b/research/valid/:symbol
   * 有効なリサーチを取得（キャッシュチェック用）
   */
  getValidResearch = async (req: Request, res: Response): Promise<void> => {
    try {
      const { symbol } = req.params;

      const research = await researchRepository.findValidBySymbol(symbol);

      if (!research) {
        res.status(404).json({ 
          success: false, 
          message: '有効なリサーチがありません',
          cached: false,
        });
        return;
      }

      res.json({ 
        success: true, 
        research,
        cached: true,
      });
    } catch (error) {
      console.error('[SideBController] getValidResearch error:', error);
      res.status(500).json({ error: 'リサーチ取得に失敗しました' });
    }
  };

  // ===========================================
  // プラン関連
  // ===========================================

  /**
   * POST /api/side-b/plans
   * プランを生成
   */
  generatePlan = async (req: Request, res: Response): Promise<void> => {
    try {
      const { symbol, targetDate, researchId, userPreferences, ohlcvData, indicators } = req.body;

      // バリデーション
      if (!symbol) {
        res.status(400).json({ error: 'symbol は必須です' });
        return;
      }

      // researchIdがない場合はohlcvDataが必要
      if (!researchId && (!ohlcvData || !Array.isArray(ohlcvData) || ohlcvData.length === 0)) {
        res.status(400).json({ error: 'researchId または ohlcvData が必要です' });
        return;
      }

      // OHLCVデータの変換
      const parsedOhlcv = ohlcvData?.map((d: { timestamp: string | Date; open: number; high: number; low: number; close: number; volume?: number }) => ({
        ...d,
        timestamp: new Date(d.timestamp),
      }));

      const result = await aiOrchestrator.generatePlan({
        symbol,
        targetDate,
        researchId,
        userPreferences,
        ohlcvData: parsedOhlcv,
        indicators,
      });

      if (!result.success) {
        res.status(500).json({ error: result.error });
        return;
      }

      res.json({
        success: true,
        plan: result.data,
        cached: result.cached,
        tokenUsage: result.tokenUsage,
      });
    } catch (error) {
      console.error('[SideBController] generatePlan error:', error);
      res.status(500).json({ error: 'プラン生成に失敗しました' });
    }
  };

  /**
   * GET /api/side-b/plans/:id
   * プランを取得
   */
  getPlanById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { withResearch } = req.query;

      let plan;
      if (withResearch === 'true') {
        plan = await planRepository.findByIdWithResearch(id);
      } else {
        plan = await planRepository.findById(id);
      }

      if (!plan) {
        res.status(404).json({ error: 'プランが見つかりません' });
        return;
      }

      res.json({ success: true, plan });
    } catch (error) {
      console.error('[SideBController] getPlanById error:', error);
      res.status(500).json({ error: 'プラン取得に失敗しました' });
    }
  };

  /**
   * GET /api/side-b/plans
   * プラン一覧を取得
   */
  listPlans = async (req: Request, res: Response): Promise<void> => {
    try {
      const { symbol, targetDate, fromDate, toDate, limit, offset } = req.query;

      const plans = await planRepository.findMany({
        symbol: symbol as string | undefined,
        targetDate: targetDate ? new Date(targetDate as string) : undefined,
        fromDate: fromDate ? new Date(fromDate as string) : undefined,
        toDate: toDate ? new Date(toDate as string) : undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
      });

      const total = await planRepository.count({
        symbol: symbol as string | undefined,
        fromDate: fromDate ? new Date(fromDate as string) : undefined,
        toDate: toDate ? new Date(toDate as string) : undefined,
      });

      res.json({
        success: true,
        plans,
        total,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });
    } catch (error) {
      console.error('[SideBController] listPlans error:', error);
      res.status(500).json({ error: 'プラン一覧取得に失敗しました' });
    }
  };

  /**
   * GET /api/side-b/plans/today/:symbol
   * 今日のプランを取得
   */
  getTodayPlan = async (req: Request, res: Response): Promise<void> => {
    try {
      const { symbol } = req.params;

      const plan = await planRepository.findTodayBySymbol(symbol);

      if (!plan) {
        res.status(404).json({ 
          success: false, 
          message: '今日のプランがありません',
        });
        return;
      }

      res.json({ success: true, plan });
    } catch (error) {
      console.error('[SideBController] getTodayPlan error:', error);
      res.status(500).json({ error: 'プラン取得に失敗しました' });
    }
  };

  // ===========================================
  // パイプライン
  // ===========================================

  /**
   * POST /api/side-b/pipeline
   * フルパイプライン実行（リサーチ → プラン一括生成）
   */
  runPipeline = async (req: Request, res: Response): Promise<void> => {
    try {
      const { symbol, ohlcvData, indicators, userPreferences, forceRefresh } = req.body;

      // バリデーション
      if (!symbol) {
        res.status(400).json({ error: 'symbol は必須です' });
        return;
      }

      if (!ohlcvData || !Array.isArray(ohlcvData) || ohlcvData.length === 0) {
        res.status(400).json({ error: 'ohlcvData は必須です（配列）' });
        return;
      }

      // OHLCVデータの変換
      const parsedOhlcv = ohlcvData.map((d: { timestamp: string | Date; open: number; high: number; low: number; close: number; volume?: number }) => ({
        ...d,
        timestamp: new Date(d.timestamp),
      }));

      const result = await aiOrchestrator.runFullPipeline({
        symbol,
        ohlcvData: parsedOhlcv,
        indicators,
        userPreferences,
        forceRefresh: forceRefresh || false,
      });

      if (!result.success) {
        res.status(500).json({ 
          error: result.error,
          research: result.research,  // リサーチは成功している可能性
        });
        return;
      }

      res.json({
        success: true,
        research: result.research,
        plan: result.plan,
        totalTokenUsage: result.totalTokenUsage,
        researchCached: result.researchCached,
      });
    } catch (error) {
      console.error('[SideBController] runPipeline error:', error);
      res.status(500).json({ error: 'パイプライン実行に失敗しました' });
    }
  };

  // ===========================================
  // 管理
  // ===========================================

  /**
   * POST /api/side-b/cleanup
   * 期限切れデータをクリーンアップ
   */
  cleanup = async (req: Request, res: Response): Promise<void> => {
    try {
      const deletedCount = await aiOrchestrator.cleanupExpiredResearch();

      res.json({
        success: true,
        deletedResearches: deletedCount,
      });
    } catch (error) {
      console.error('[SideBController] cleanup error:', error);
      res.status(500).json({ error: 'クリーンアップに失敗しました' });
    }
  };
}

// デフォルトインスタンス
export const sideBController = new SideBController();
