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
 * 
 * Phase B追加:
 * - POST /api/side-b/trades - 仮想トレード作成
 * - GET /api/side-b/trades - 仮想トレード一覧
 * - GET /api/side-b/trades/:id - 仮想トレード詳細
 * - POST /api/side-b/trades/:id/close - 仮想トレード決済
 * - POST /api/side-b/trades/:id/cancel - 仮想トレードキャンセル
 * - GET /api/side-b/portfolio - ポートフォリオ取得
 * - PUT /api/side-b/portfolio/settings - ポートフォリオ設定更新
 */

import { Request, Response } from 'express';
import { getValidatedQuery } from '../../middleware/validateRequest';
import {
  aiOrchestrator,
  researchRepository,
  planRepository,
  MarketResearchWithTypes,
  AITradePlanWithTypes,
} from '..';
import {
  createTradeFromPlan,
  getTrade,
  listTrades,
  closeTradeManually,
  cancelPendingTrade,
  getPortfolioSummary,
  getComparisonAnalysis,
  getComparisonDashboard,
  type ComparisonPeriod,
} from '../services';
import * as aiNoteService from '../services/aiNoteService';
import {
  getOrCreateDefaultPortfolio,
  updatePortfolioSettings,
} from '../repositories';
import type { ExitReason, UpdatePortfolioSettings } from '../models';
import { MarketDataService } from '../../services/marketDataService';
import { getSideBScheduler, type SideBSchedulerConfig } from '../jobs/sideBScheduler';
import { pdcaLoop, agentMemory, type PDCALoopConfig } from '../agent';

// MarketDataService インスタンス（OHLCV自動取得用）
const marketDataService = new MarketDataService();

export class SideBController {
  // ===========================================
  // リサーチ関連
  // ===========================================

  /**
   * POST /api/side-b/research
   * リサーチを生成
   * 
   * ohlcvDataが省略された場合、MarketDataServiceから自動取得します。
   */
  generateResearch = async (req: Request, res: Response): Promise<void> => {
    try {
      const { symbol, timeframe = '15m', ohlcvData, indicators, forceRefresh } = req.body;

      // バリデーション
      if (!symbol) {
        res.status(400).json({ error: 'symbol は必須です' });
        return;
      }

      let parsedOhlcv: Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume?: number }>;

      // OHLCVデータが提供されていない場合は自動取得
      if (!ohlcvData || !Array.isArray(ohlcvData) || ohlcvData.length === 0) {
        console.log(`[SideBController] ohlcvData未提供のため、${symbol}/${timeframe} のデータを自動取得します`);

        const historicalData = await marketDataService.getHistoricalData(symbol, timeframe, 100);

        if (!historicalData || historicalData.length === 0) {
          res.status(500).json({ error: '市場データの取得に失敗しました' });
          return;
        }

        parsedOhlcv = historicalData.map(d => ({
          timestamp: d.timestamp,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: d.volume,
        }));

        console.log(`[SideBController] ${parsedOhlcv.length}件のOHLCVデータを取得しました`);
      } else {
        // OHLCVデータの変換（timestampをDateに）
        parsedOhlcv = ohlcvData.map((d: { timestamp: string | Date; open: number; high: number; low: number; close: number; volume?: number }) => ({
          ...d,
          timestamp: new Date(d.timestamp),
        }));
      }

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
      const { symbol, validOnly, limit, offset } = getValidatedQuery<{
        symbol?: string;
        validOnly?: string;
        limit?: string;
        offset?: string;
      }>(res);

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
   * 
   * researchIdを指定すると既存リサーチを使用。
   * 指定しない場合、ohlcvDataが必要（省略時は自動取得）。
   *
   * レスポンス `plan` には、新規生成かつ即時BTが完走した場合のみ
   * `strategyBacktest`（Phase 6.7b）が付く。Prisma 保存列には含めない。
   */
  generatePlan = async (req: Request, res: Response): Promise<void> => {
    try {
      const { symbol, targetDate, researchId, userPreferences, ohlcvData, indicators, timeframe = '15m', forceRefresh } = req.body;

      // バリデーション
      if (!symbol) {
        res.status(400).json({ error: 'symbol は必須です' });
        return;
      }

      let parsedOhlcv: Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume?: number }> | undefined;

      // researchIdがない場合はohlcvDataが必要（自動取得可能）
      if (!researchId) {
        if (!ohlcvData || !Array.isArray(ohlcvData) || ohlcvData.length === 0) {
          console.log(`[SideBController] ohlcvData未提供のため、${symbol}/${timeframe} のデータを自動取得します`);

          const historicalData = await marketDataService.getHistoricalData(symbol, timeframe, 100);

          if (!historicalData || historicalData.length === 0) {
            res.status(500).json({ error: '市場データの取得に失敗しました' });
            return;
          }

          parsedOhlcv = historicalData.map(d => ({
            timestamp: d.timestamp,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume,
          }));

          console.log(`[SideBController] ${parsedOhlcv.length}件のOHLCVデータを取得しました`);
        } else {
          // OHLCVデータの変換
          parsedOhlcv = ohlcvData.map((d: { timestamp: string | Date; open: number; high: number; low: number; close: number; volume?: number }) => ({
            ...d,
            timestamp: new Date(d.timestamp),
          }));
        }
      }

      const result = await aiOrchestrator.generatePlan({
        symbol,
        targetDate,
        researchId,
        userPreferences,
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
      const { withResearch } = getValidatedQuery<{ withResearch?: string }>(res);

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
      const { symbol, targetDate, fromDate, toDate, limit, offset } = getValidatedQuery<{
        symbol?: string;
        targetDate?: string;
        fromDate?: string;
        toDate?: string;
        limit?: string;
        offset?: string;
      }>(res);

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

  // ===========================================
  // 仮想トレード（Phase B）
  // ===========================================

  /**
   * POST /api/side-b/trades
   * プランからシナリオに基づいて仮想トレードを作成
   */
  createVirtualTrade = async (req: Request, res: Response): Promise<void> => {
    try {
      const { planId, scenarioId } = req.body;

      if (!planId) {
        res.status(400).json({ error: 'planId は必須です' });
        return;
      }

      const result = await createTradeFromPlan(planId, scenarioId);

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({
        success: true,
        trade: result.trade,
      });
    } catch (error) {
      console.error('[SideBController] createVirtualTrade error:', error);
      res.status(500).json({ error: '仮想トレード作成に失敗しました' });
    }
  };

  /**
   * GET /api/side-b/trades
   * 仮想トレード一覧を取得
   */
  listVirtualTrades = async (req: Request, res: Response): Promise<void> => {
    try {
      const { status, planId, symbol, limit } = getValidatedQuery<{
        status?: string;
        planId?: string;
        symbol?: string;
        limit?: string;
      }>(res);

      // statusをVirtualTradeStatus型にキャスト（バリデーション省略）
      const validStatuses = ['pending', 'open', 'closed', 'expired', 'cancelled', 'invalidated'];
      const statusFilter = status && validStatuses.includes(status as string)
        ? status as 'pending' | 'open' | 'closed' | 'expired' | 'cancelled' | 'invalidated'
        : undefined;

      const trades = await listTrades({
        status: statusFilter,
        planId: planId as string | undefined,
        symbol: symbol as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
      });

      res.json({
        success: true,
        trades,
        count: trades.length,
      });
    } catch (error) {
      console.error('[SideBController] listVirtualTrades error:', error);
      res.status(500).json({ error: '仮想トレード一覧取得に失敗しました' });
    }
  };

  /**
   * GET /api/side-b/trades/:id
   * 仮想トレード詳細を取得
   */
  getVirtualTradeById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const trade = await getTrade(id);

      if (!trade) {
        res.status(404).json({ error: '仮想トレードが見つかりません' });
        return;
      }

      res.json({ success: true, trade });
    } catch (error) {
      console.error('[SideBController] getVirtualTradeById error:', error);
      res.status(500).json({ error: '仮想トレード取得に失敗しました' });
    }
  };

  /**
   * POST /api/side-b/trades/:id/close
   * 仮想トレードを手動決済
   */
  closeVirtualTrade = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { exitPrice, reason, note } = req.body;

      if (!exitPrice || typeof exitPrice !== 'number') {
        res.status(400).json({ error: 'exitPrice は必須です（数値）' });
        return;
      }

      const trade = await closeTradeManually(
        id,
        exitPrice,
        (reason as ExitReason) || 'manual',
        note,
      );

      if (!trade) {
        res.status(400).json({ error: '決済できません（オープン状態のトレードのみ可能）' });
        return;
      }

      res.json({ success: true, trade });
    } catch (error) {
      console.error('[SideBController] closeVirtualTrade error:', error);
      res.status(500).json({ error: '仮想トレード決済に失敗しました' });
    }
  };

  /**
   * POST /api/side-b/trades/:id/cancel
   * 待機中の仮想トレードをキャンセル
   */
  cancelVirtualTrade = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const success = await cancelPendingTrade(id);

      if (!success) {
        res.status(400).json({ error: 'キャンセルできません（待機中のトレードのみ可能）' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error('[SideBController] cancelVirtualTrade error:', error);
      res.status(500).json({ error: '仮想トレードキャンセルに失敗しました' });
    }
  };

  // ===========================================
  // ポートフォリオ（Phase B）
  // ===========================================

  /**
   * GET /api/side-b/portfolio
   * ポートフォリオサマリーを取得
   */
  getPortfolio = async (req: Request, res: Response): Promise<void> => {
    try {
      const summary = await getPortfolioSummary();

      res.json({ success: true, ...summary });
    } catch (error) {
      console.error('[SideBController] getPortfolio error:', error);
      res.status(500).json({ error: 'ポートフォリオ取得に失敗しました' });
    }
  };

  /**
   * PUT /api/side-b/portfolio/settings
   * ポートフォリオ設定を更新
   */
  updatePortfolioSettings = async (req: Request, res: Response): Promise<void> => {
    try {
      const settings: UpdatePortfolioSettings = req.body;

      // 簡易バリデーション
      if (settings.maxOpenPositions !== undefined && (settings.maxOpenPositions < 1 || settings.maxOpenPositions > 10)) {
        res.status(400).json({ error: 'maxOpenPositions は 1-10 の範囲です' });
        return;
      }

      const portfolio = await getOrCreateDefaultPortfolio();
      const updated = await updatePortfolioSettings(portfolio.id, settings);

      res.json({ success: true, portfolio: updated });
    } catch (error) {
      console.error('[SideBController] updatePortfolioSettings error:', error);
      res.status(500).json({ error: 'ポートフォリオ設定更新に失敗しました' });
    }
  };

  // ===========================================
  // AIトレードノート（Phase C）
  // ===========================================

  /**
   * GET /api/side-b/ai-notes
   * AIノート一覧を取得
   */
  listAINotes = async (req: Request, res: Response): Promise<void> => {
    try {
      const { from, to, outcome, symbol, limit, offset } = getValidatedQuery<{
        from?: string;
        to?: string;
        outcome?: string;
        symbol?: string;
        limit?: string;
        offset?: string;
      }>(res);

      // outcomeのバリデーション
      const validOutcomes = ['win', 'loss', 'breakeven'];
      const outcomeFilter = outcome && validOutcomes.includes(outcome as string)
        ? outcome as 'win' | 'loss' | 'breakeven'
        : undefined;

      const result = await aiNoteService.listNotes({
        from: from as string | undefined,
        to: to as string | undefined,
        outcome: outcomeFilter,
        symbol: symbol as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : 20,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      res.json({
        success: true,
        notes: result.notes,
        total: result.total,
        stats: result.stats,
      });
    } catch (error) {
      console.error('[SideBController] listAINotes error:', error);
      res.status(500).json({ error: 'AIノート一覧取得に失敗しました' });
    }
  };

  /**
   * GET /api/side-b/ai-notes/:id
   * AIノート詳細を取得
   */
  getAINoteById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const note = await aiNoteService.getNote(id);

      if (!note) {
        res.status(404).json({ error: 'AIノートが見つかりません' });
        return;
      }

      res.json({ success: true, note });
    } catch (error) {
      console.error('[SideBController] getAINoteById error:', error);
      res.status(500).json({ error: 'AIノート取得に失敗しました' });
    }
  };

  /**
   * GET /api/side-b/ai-notes/summaries
   * サマリー一覧を取得
   */
  listAINoteSummaries = async (req: Request, res: Response): Promise<void> => {
    try {
      const { period, limit, offset } = getValidatedQuery<{
        period?: string;
        limit?: string;
        offset?: string;
      }>(res);

      // periodのバリデーション
      const validPeriods = ['daily', 'weekly', 'monthly'];
      const periodFilter = period && validPeriods.includes(period as string)
        ? period as 'daily' | 'weekly' | 'monthly'
        : undefined;

      const result = await aiNoteService.listSummaries({
        period: periodFilter,
        limit: limit ? parseInt(limit as string, 10) : 10,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      res.json({
        success: true,
        summaries: result.summaries,
        total: result.total,
      });
    } catch (error) {
      console.error('[SideBController] listAINoteSummaries error:', error);
      res.status(500).json({ error: 'サマリー一覧取得に失敗しました' });
    }
  };

  /**
   * POST /api/side-b/ai-notes/summaries/generate
   * サマリーを手動生成
   */
  generateAINoteSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      const { period, startDate, endDate } = req.body;

      // バリデーション
      const validPeriods = ['daily', 'weekly', 'monthly'];
      if (!period || !validPeriods.includes(period)) {
        res.status(400).json({ error: 'period は daily/weekly/monthly のいずれかです' });
        return;
      }

      if (!startDate || !endDate) {
        res.status(400).json({ error: 'startDate と endDate は必須です' });
        return;
      }

      const summary = await aiNoteService.generateSummary(
        period as 'daily' | 'weekly' | 'monthly',
        startDate,
        endDate
      );

      res.json({ success: true, summary });
    } catch (error) {
      console.error('[SideBController] generateAINoteSummary error:', error);
      res.status(500).json({ error: 'サマリー生成に失敗しました' });
    }
  };

  // ===========================================
  // スケジューラー関連
  // ===========================================

  /**
   * GET /api/side-b/scheduler/status
   * スケジューラーの状態を取得
   */
  getSchedulerStatus = async (_req: Request, res: Response): Promise<void> => {
    try {
      const scheduler = getSideBScheduler();
      const status = scheduler.getStatus();
      res.json({ success: true, ...status });
    } catch (error) {
      console.error('[SideBController] getSchedulerStatus error:', error);
      res.status(500).json({ error: 'スケジューラー状態の取得に失敗しました' });
    }
  };

  /**
   * POST /api/side-b/scheduler/start
   * スケジューラーを開始
   */
  startScheduler = async (_req: Request, res: Response): Promise<void> => {
    try {
      const scheduler = getSideBScheduler();
      scheduler.updateConfig({ enabled: true });
      scheduler.start();

      const status = scheduler.getStatus();
      res.json({ success: true, message: 'スケジューラーを開始しました', ...status });
    } catch (error) {
      console.error('[SideBController] startScheduler error:', error);
      res.status(500).json({ error: 'スケジューラーの開始に失敗しました' });
    }
  };

  /**
   * POST /api/side-b/scheduler/stop
   * スケジューラーを停止
   */
  stopScheduler = async (_req: Request, res: Response): Promise<void> => {
    try {
      const scheduler = getSideBScheduler();
      scheduler.stop();
      scheduler.updateConfig({ enabled: false });

      const status = scheduler.getStatus();
      res.json({ success: true, message: 'スケジューラーを停止しました', ...status });
    } catch (error) {
      console.error('[SideBController] stopScheduler error:', error);
      res.status(500).json({ error: 'スケジューラーの停止に失敗しました' });
    }
  };

  /**
   * PUT /api/side-b/scheduler/config
   * スケジューラー設定を更新
   */
  updateSchedulerConfig = async (req: Request, res: Response): Promise<void> => {
    try {
      const { enabled, symbols, timeframe, monitorIntervalMs, dailyPlanTimeUTC, autoGenerateNote } = req.body;

      const newConfig: Partial<SideBSchedulerConfig> = {};
      if (typeof enabled === 'boolean') newConfig.enabled = enabled;
      if (Array.isArray(symbols)) newConfig.symbols = symbols;
      if (typeof timeframe === 'string') newConfig.timeframe = timeframe;
      if (typeof monitorIntervalMs === 'number') newConfig.monitorIntervalMs = monitorIntervalMs;
      if (typeof dailyPlanTimeUTC === 'string') newConfig.dailyPlanTimeUTC = dailyPlanTimeUTC;
      if (typeof autoGenerateNote === 'boolean') newConfig.autoGenerateNote = autoGenerateNote;

      const scheduler = getSideBScheduler();
      scheduler.updateConfig(newConfig);

      const status = scheduler.getStatus();
      res.json({ success: true, message: '設定を更新しました', ...status });
    } catch (error) {
      console.error('[SideBController] updateSchedulerConfig error:', error);
      res.status(500).json({ error: 'スケジューラー設定の更新に失敗しました' });
    }
  };

  /**
   * POST /api/side-b/scheduler/run-daily-plan
   * 日次プランを手動実行
   */
  runDailyPlanNow = async (_req: Request, res: Response): Promise<void> => {
    try {
      const scheduler = getSideBScheduler();
      const result = await scheduler.runDailyPlanNow();
      res.json({ success: result.success, message: result.message, data: result.data });
    } catch (error) {
      console.error('[SideBController] runDailyPlanNow error:', error);
      res.status(500).json({ error: '日次プラン実行に失敗しました' });
    }
  };

  /**
   * POST /api/side-b/scheduler/run-monitor
   * 監視を手動実行
   */
  runMonitorNow = async (_req: Request, res: Response): Promise<void> => {
    try {
      const scheduler = getSideBScheduler();
      const result = await scheduler.runMonitorNow();
      res.json({ success: result.success, message: result.message, data: result.data });
    } catch (error) {
      console.error('[SideBController] runMonitorNow error:', error);
      res.status(500).json({ error: '監視実行に失敗しました' });
    }
  };

  // ===========================================
  // PDCA Loop (Phase 2: 自律エージェント)
  // ===========================================

  /**
   * GET /api/side-b/agent/status
   * PDCAループの状態を取得
   */
  getAgentStatus = async (_req: Request, res: Response): Promise<void> => {
    try {
      const status = pdcaLoop.getStatus();
      res.json(status);
    } catch (error) {
      console.error('[SideBController] getAgentStatus error:', error);
      res.status(500).json({ error: 'エージェント状態の取得に失敗しました' });
    }
  };

  /**
   * POST /api/side-b/agent/start
   * PDCAループを開始
   */
  startAgent = async (req: Request, res: Response): Promise<void> => {
    try {
      const { symbols, normalIntervalMs, activeIntervalMs, positionIntervalMs } = req.body;
      // PDCAループを開始（設定はオプション）
      const configOverride: Partial<PDCALoopConfig> = { enabled: true };
      if (symbols) configOverride.symbols = symbols;
      if (normalIntervalMs) configOverride.normalIntervalMs = normalIntervalMs;
      if (activeIntervalMs) configOverride.activeIntervalMs = activeIntervalMs;
      if (positionIntervalMs) configOverride.positionIntervalMs = positionIntervalMs;

      // 既存のスケジューラーも連動起動
      const scheduler = getSideBScheduler();
      scheduler.updateConfig({ enabled: true });
      scheduler.start();

      pdcaLoop.updateConfig(configOverride);
      pdcaLoop.start();
      const status = pdcaLoop.getStatus();
      res.json({ success: true, message: 'PDCAループを開始しました', status });
    } catch (error) {
      console.error('[SideBController] startAgent error:', error);
      res.status(500).json({ error: 'PDCAループの開始に失敗しました' });
    }
  };

  /**
   * POST /api/side-b/agent/stop
   * PDCAループを停止
   */
  stopAgent = async (_req: Request, res: Response): Promise<void> => {
    try {
      pdcaLoop.stop();
      const status = pdcaLoop.getStatus();
      res.json({ success: true, message: 'PDCAループを停止しました', status });
    } catch (error) {
      console.error('[SideBController] stopAgent error:', error);
      res.status(500).json({ error: 'PDCAループの停止に失敗しました' });
    }
  };

  /**
   * GET /api/side-b/agent/thinking-log
   * 思考ログを取得
   */
  getThinkingLog = async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const log = pdcaLoop.getThinkingLog(limit);
      res.json({ log, count: log.length });
    } catch (error) {
      console.error('[SideBController] getThinkingLog error:', error);
      res.status(500).json({ error: '思考ログの取得に失敗しました' });
    }
  };

  /**
   * GET /api/side-b/agent/reflections
   * 直近のトレード振り返りを取得
   */
  getReflections = async (req: Request, res: Response): Promise<void> => {
    try {
      // limit は ReflectionsQuerySchema で min(1)/max(50)/default(10) バリデーション済み
      const limit = Number(req.query.limit) || 10;
      const results = agentMemory.getRecentResults();
      const reflections = results
        .filter(r => r.reflection)
        .slice(0, limit)
        .map(r => ({
          tradeId: r.id,
          symbol: r.symbol,
          direction: r.direction,
          pnlPips: r.pnlPips,
          outcome: r.outcome,
          reflection: r.reflection,
          tradedAt: r.tradedAt,
          closedAt: r.closedAt,
        }));

      res.json({ reflections, count: reflections.length });
    } catch (error) {
      console.error('[SideBController] getReflections error:', error);
      res.status(500).json({ error: '振り返りの取得に失敗しました' });
    }
  };

  /**
   * GET /api/side-b/agent/lessons
   * 学習メモを取得
   */
  getLessons = async (_req: Request, res: Response): Promise<void> => {
    try {
      const lessonsBySymbolMap = agentMemory.getAllLessonsBySymbol();
      const stats = agentMemory.getLessonStats();
      const winRate = agentMemory.getWinRate();
      const recentResults = agentMemory.getRecentResults();

      // Map を plain object に変換（JSON シリアライズ用）
      const lessonsBySymbol: Record<string, {
        entries: Array<{ text: string; symbol: string; tradeId?: string; addedAt: string }>;
        consolidated: Array<{ text: string; symbol: string; count: number; firstSeen: string; lastSeen: string; sourceTexts: string[] }>;
      }> = {};

      for (const [symbol, sl] of lessonsBySymbolMap) {
        lessonsBySymbol[symbol] = {
          entries: sl.entries.map(e => ({
            text: e.text,
            symbol: e.symbol,
            tradeId: e.tradeId,
            addedAt: e.addedAt.toISOString(),
          })),
          consolidated: sl.consolidated.map(c => ({
            text: c.text,
            symbol: c.symbol,
            count: c.count,
            firstSeen: c.firstSeen.toISOString(),
            lastSeen: c.lastSeen.toISOString(),
            sourceTexts: c.sourceTexts,
          })),
        };
      }

      res.json({
        lessonsBySymbol,
        totalEntries: stats.totalEntries,
        totalConsolidated: stats.totalConsolidated,
        stats: {
          winRate,
          totalTrades: recentResults.length,
          wins: recentResults.filter(r => r.outcome === 'win').length,
          losses: recentResults.filter(r => r.outcome === 'loss').length,
        },
      });
    } catch (error) {
      console.error('[SideBController] getLessons error:', error);
      res.status(500).json({ error: '学習メモの取得に失敗しました' });
    }
  };

  // ===========================================
  // 比較分析（Phase D）
  // ===========================================

  /**
   * GET /api/side-b/comparison
   * 人間vsAIの比較分析を取得
   */
  getComparison = async (req: Request, res: Response): Promise<void> => {
    try {
      const { period, symbol } = req.query as { period?: string; symbol?: string };

      // 期間のバリデーション
      const validPeriods = ['week', 'month', 'quarter', 'year', 'all'];
      const periodFilter: ComparisonPeriod = period && validPeriods.includes(period as string)
        ? (period as ComparisonPeriod)
        : 'month';

      const result = await getComparisonAnalysis(
        periodFilter,
        symbol as string | undefined
      );

      res.json({
        success: true,
        comparison: result,
      });
    } catch (error) {
      console.error('[SideBController] getComparison error:', error);
      res.status(500).json({ error: '比較分析の取得に失敗しました' });
    }
  };

  /**
   * GET /api/side-b/comparison/dashboard
   * 比較ダッシュボードデータを取得
   */
  getComparisonDashboardData = async (req: Request, res: Response): Promise<void> => {
    try {
      const { period, symbol } = req.query as { period?: string; symbol?: string };

      // 期間のバリデーション
      const validPeriods = ['week', 'month', 'quarter', 'year', 'all'];
      const periodFilter: ComparisonPeriod = period && validPeriods.includes(period as string)
        ? (period as ComparisonPeriod)
        : 'month';

      const dashboard = await getComparisonDashboard(
        periodFilter,
        symbol as string | undefined
      );

      res.json({
        success: true,
        ...dashboard,
      });
    } catch (error) {
      console.error('[SideBController] getComparisonDashboard error:', error);
      res.status(500).json({ error: '比較ダッシュボードの取得に失敗しました' });
    }
  };

  // ===========================================
  // サマリースケジューラー（週次/月次）
  // ===========================================

  /**
   * GET /api/side-b/summaries
   * 生成済みサマリー一覧を取得
   */
  listSummaries = async (req: Request, res: Response): Promise<void> => {
    try {
      const { summarySchedulerService } = await import('../services');

      const { period: periodStr, limit: limitStr, offset: offsetStr } = getValidatedQuery<{
        period?: string;
        limit?: string;
        offset?: string;
      }>(res);
      const period = periodStr as 'weekly' | 'monthly' | undefined;
      const limit = parseInt(limitStr || '') || 10;
      const offset = parseInt(offsetStr || '') || 0;

      const summaries = await summarySchedulerService.listSummaries({
        period,
        limit,
        offset,
      });

      res.json({
        success: true,
        summaries,
        total: summaries.length,
      });
    } catch (error) {
      console.error('[SideBController] listSummaries error:', error);
      res.status(500).json({ error: 'サマリー一覧の取得に失敗しました' });
    }
  };

  /**
   * POST /api/side-b/summaries/generate
   * 週次または月次サマリーを手動生成
   */
  generateSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      const { summarySchedulerService } = await import('../services');

      const { period, startDate, endDate } = req.body;

      // バリデーション
      if (!period || !['weekly', 'monthly'].includes(period)) {
        res.status(400).json({ error: 'period は weekly または monthly を指定してください' });
        return;
      }

      let summary;
      if (startDate && endDate) {
        // 指定期間でサマリーを生成
        summary = await summarySchedulerService.generateSummary(
          period,
          new Date(startDate),
          new Date(endDate)
        );
      } else {
        // デフォルト期間でサマリーを生成
        summary = period === 'weekly'
          ? await summarySchedulerService.generateWeeklySummary()
          : await summarySchedulerService.generateMonthlySummary();
      }

      res.json({
        success: true,
        summary,
      });
    } catch (error) {
      console.error('[SideBController] generateSummary error:', error);
      res.status(500).json({ error: 'サマリー生成に失敗しました' });
    }
  };

  /**
   * GET /api/side-b/summaries/scheduler
   * サマリースケジューラー設定を取得
   */
  getSummarySchedulerConfig = async (_req: Request, res: Response): Promise<void> => {
    try {
      const { summarySchedulerService } = await import('../services');

      const config = summarySchedulerService.getConfig();

      res.json({
        success: true,
        config,
      });
    } catch (error) {
      console.error('[SideBController] getSummarySchedulerConfig error:', error);
      res.status(500).json({ error: 'スケジューラー設定の取得に失敗しました' });
    }
  };

  /**
   * PUT /api/side-b/summaries/scheduler
   * サマリースケジューラー設定を更新
   */
  updateSummarySchedulerConfig = async (req: Request, res: Response): Promise<void> => {
    try {
      const { summarySchedulerService } = await import('../services');

      summarySchedulerService.updateConfig(req.body);
      const config = summarySchedulerService.getConfig();

      res.json({
        success: true,
        config,
        message: 'スケジューラー設定を更新しました',
      });
    } catch (error) {
      console.error('[SideBController] updateSummarySchedulerConfig error:', error);
      res.status(500).json({ error: 'スケジューラー設定の更新に失敗しました' });
    }
  };

  /**
   * POST /api/side-b/summaries/scheduler/start
   * サマリースケジューラーを開始
   */
  startSummaryScheduler = async (_req: Request, res: Response): Promise<void> => {
    try {
      const { summarySchedulerService } = await import('../services');

      summarySchedulerService.start();

      res.json({
        success: true,
        message: 'サマリースケジューラーを開始しました',
      });
    } catch (error) {
      console.error('[SideBController] startSummaryScheduler error:', error);
      res.status(500).json({ error: 'スケジューラー開始に失敗しました' });
    }
  };

  /**
   * POST /api/side-b/summaries/scheduler/stop
   * サマリースケジューラーを停止
   */
  stopSummaryScheduler = async (_req: Request, res: Response): Promise<void> => {
    try {
      const { summarySchedulerService } = await import('../services');

      summarySchedulerService.stop();

      res.json({
        success: true,
        message: 'サマリースケジューラーを停止しました',
      });
    } catch (error) {
      console.error('[SideBController] stopSummaryScheduler error:', error);
      res.status(500).json({ error: 'スケジューラー停止に失敗しました' });
    }
  };
}

// デフォルトインスタンス
export const sideBController = new SideBController();

