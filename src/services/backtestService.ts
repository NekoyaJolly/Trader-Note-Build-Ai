/**
 * バックテストサービス
 * 
 * 目的: ノートの優位性を過去データで検証する
 * 
 * 責務:
 * - バックテスト実行のオーケストレーション
 * - NoteEvaluator に一致判定を委譲（Service は similarity を直接計算しない）
 * - エントリー/エグジット判定
 * - 結果の集計と永続化
 * 
 * 制約:
 * - 未来データを使わない（look-ahead bias 対策）
 * - candle close 基準で評価
 * 
 * 設計方針（Task 6）:
 * - Service は「今の市場」を渡すだけ
 * - 類似度計算、閾値判定は NoteEvaluator の責務
 * - ノートA（UserIndicator）もノートB（Legacy）も同じフローで評価
 */

import { BacktestRun, BacktestResult, BacktestEvent, BacktestOutcome, BacktestStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { 
  BacktestRepository, 
  CreateBacktestRunInput, 
  CreateBacktestResultInput,
  CreateBacktestEventInput,
  BacktestRunWithDetails,
} from '../backend/repositories/backtestRepository';
import { OHLCVRepository, OHLCVQueryFilter } from '../backend/repositories/ohlcvRepository';
import { TradeNoteRepository } from '../backend/repositories/tradeNoteRepository';
import { createNoteEvaluator } from './legacyNoteEvaluatorAdapter';
import { NoteEvaluator, MarketSnapshot } from '../domain/noteEvaluator';

/**
 * バックテスト実行パラメータ
 */
export interface BacktestParams {
  /** ノートID */
  noteId: string;
  /** 開始日（UTC） */
  startDate: Date;
  /** 終了日（UTC） */
  endDate: Date;
  /** 時間足（例: '15m', '60m'） */
  timeframe: string;
  /** 一致閾値（0.0〜1.0） */
  matchThreshold: number;
  /** 利確幅（%） */
  takeProfit: number;
  /** 損切幅（%） */
  stopLoss: number;
  /** 最大保有時間（分） */
  maxHoldingMinutes?: number;
  /** 取引コスト（%） */
  tradingCost?: number;
}

/**
 * バックテスト結果サマリー
 */
export interface BacktestSummary {
  runId: string;
  status: BacktestStatus;
  setupCount: number;
  winCount: number;
  lossCount: number;
  timeoutCount: number;
  winRate: number;
  profitFactor: number | null;
  totalProfit: number;
  totalLoss: number;
  averagePnL: number;
  expectancy: number;
  maxDrawdown: number | null;
  events: BacktestEventSummary[];
}

/**
 * バックテストイベントサマリー（UI表示用）
 */
export interface BacktestEventSummary {
  entryTime: string;
  entryPrice: number;
  matchScore: number;
  exitTime: string | null;
  exitPrice: number | null;
  outcome: BacktestOutcome;
  pnl: number | null;
  holdingMinutes: number | null;
}

/**
 * バックテストサービスクラス
 * 
 * 設計（Task 6）:
 * - Service は NoteEvaluator.evaluate() を呼ぶだけ
 * - similarity を直接計算しない
 * - threshold を直接参照しない
 */
export class BacktestService {
  private readonly backtestRepo: BacktestRepository;
  private readonly ohlcvRepo: OHLCVRepository;
  private readonly noteRepo: TradeNoteRepository;

  constructor(
    backtestRepo?: BacktestRepository,
    ohlcvRepo?: OHLCVRepository,
    noteRepo?: TradeNoteRepository,
  ) {
    this.backtestRepo = backtestRepo || new BacktestRepository();
    this.ohlcvRepo = ohlcvRepo || new OHLCVRepository();
    this.noteRepo = noteRepo || new TradeNoteRepository();
  }

  /**
   * バックテストを実行する
   * 
   * 設計（Task 6）:
   * - ノートから NoteEvaluator を生成
   * - 評価は NoteEvaluator.evaluate() に委譲
   * 
   * @param params - バックテストパラメータ
   * @returns 実行ID
   */
  async execute(params: BacktestParams): Promise<string> {
    // 1. ノートを取得
    const note = await this.noteRepo.findById(params.noteId);
    if (!note) {
      throw new Error(`ノートが見つかりません: ${params.noteId}`);
    }

    // 2. ノートから NoteEvaluator を生成
    const evaluator = createNoteEvaluator(note);

    // 3. バックテスト実行を作成
    const run = await this.backtestRepo.createRun({
      noteId: params.noteId,
      symbol: note.symbol,
      timeframe: params.timeframe,
      startDate: params.startDate,
      endDate: params.endDate,
      matchThreshold: params.matchThreshold,
      takeProfit: params.takeProfit,
      stopLoss: params.stopLoss,
      maxHoldingMinutes: params.maxHoldingMinutes,
      tradingCost: params.tradingCost,
    });

    // 4. ステータスを実行中に更新
    await this.backtestRepo.updateRunStatus(run.id, 'running');

    try {
      // 5. OHLCV データを取得
      const ohlcvFilter: OHLCVQueryFilter = {
        symbol: note.symbol,
        timeframe: params.timeframe,
        startTime: params.startDate,
        endTime: params.endDate,
        orderBy: 'asc',
      };
      const ohlcvData = await this.ohlcvRepo.findManyAsOHLCVData(ohlcvFilter);

      if (ohlcvData.length === 0) {
        await this.backtestRepo.updateRunStatus(run.id, 'failed');
        throw new Error('指定期間のOHLCVデータがありません');
      }

      // OHLCVData の timestamp を Date に変換
      const ohlcvDataWithDate = ohlcvData.map(d => ({
        timestamp: d.timestamp instanceof Date ? d.timestamp : new Date(d.timestamp),
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume,
      }));

      // 6. バックテストロジックを実行（NoteEvaluator 経由）
      const eventInputs = await this.runBacktestLogic(
        run.id,
        evaluator,
        note.side,
        note.symbol,
        params.timeframe,
        ohlcvDataWithDate,
        params,
      );

      // 7. イベントを一括保存
      if (eventInputs.length > 0) {
        await this.backtestRepo.createEvents(eventInputs);
      }

      // 8. 保存されたイベントを取得
      const events = await this.backtestRepo.findEventsByRunId(run.id);

      // 9. 結果を集計
      const result = this.calculateResult(run.id, events, params.tradingCost || 0);

      // 10. 結果を保存
      await this.backtestRepo.createResult(result);

      // 11. ステータスを完了に更新
      await this.backtestRepo.updateRunStatus(run.id, 'completed');

      return run.id;
    } catch (error) {
      // エラー時はステータスを失敗に更新
      await this.backtestRepo.updateRunStatus(run.id, 'failed');
      throw error;
    }
  }

  /**
   * バックテストのロジックを実行
   * 
   * 設計（Task 6）:
   * - Service は OHLCV → MarketSnapshot に変換して NoteEvaluator に渡すだけ
   * - 類似度計算、閾値判定は NoteEvaluator の責務
   * 
   * @param runId バックテスト実行ID
   * @param evaluator NoteEvaluator インスタンス
   * @param noteSide ノートのサイド（buy/sell）
   * @param symbol シンボル
   * @param timeframe 時間足
   * @param ohlcvData OHLCVデータ配列
   * @param params バックテストパラメータ
   */
  private async runBacktestLogic(
    runId: string,
    evaluator: NoteEvaluator,
    noteSide: string,
    symbol: string,
    timeframe: string,
    ohlcvData: Array<{
      timestamp: Date;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>,
    params: BacktestParams,
  ): Promise<CreateBacktestEventInput[]> {
    const eventInputs: CreateBacktestEventInput[] = [];
    
    let currentPosition: {
      entryTime: Date;
      entryPrice: number;
      matchScore: number;
    } | null = null;

    const maxHoldingMinutes = params.maxHoldingMinutes || 1440; // デフォルト24時間

    for (let i = 0; i < ohlcvData.length; i++) {
      const candle = ohlcvData[i];

      // ポジションがある場合: エグジット判定
      if (currentPosition) {
        const holdingMinutes = (candle.timestamp.getTime() - currentPosition.entryTime.getTime()) / 60000;
        
        // 利確/損切/タイムアウト判定
        const exitResult = this.checkExit(
          currentPosition.entryPrice,
          candle,
          noteSide,
          params.takeProfit,
          params.stopLoss,
          holdingMinutes,
          maxHoldingMinutes,
        );

        if (exitResult.shouldExit) {
          // イベント入力データを蓄積
          eventInputs.push({
            runId,
            entryTime: currentPosition.entryTime,
            entryPrice: currentPosition.entryPrice,
            matchScore: currentPosition.matchScore,
            exitTime: candle.timestamp,
            exitPrice: exitResult.exitPrice,
            outcome: exitResult.outcome,
            pnl: this.calculatePnL(
              currentPosition.entryPrice,
              exitResult.exitPrice,
              noteSide,
              params.tradingCost || 0,
            ),
          });
          currentPosition = null;
        }

        continue;
      }

      // ポジションがない場合: NoteEvaluator で評価
      const snapshot = this.convertOHLCVToSnapshot(candle, symbol, timeframe);
      const evalResult = evaluator.evaluate(snapshot);

      // NoteEvaluator の閾値ではなく、パラメータの閾値を使用
      // （バックテストでは閾値をパラメータで指定するため）
      if (evalResult.similarity >= params.matchThreshold) {
        // マッチ: エントリー
        currentPosition = {
          entryTime: candle.timestamp,
          entryPrice: candle.close, // candle close でエントリー
          matchScore: evalResult.similarity,
        };
      }
    }

    // 最終足でまだポジションがある場合: タイムアウトとして処理
    if (currentPosition && ohlcvData.length > 0) {
      const lastCandle = ohlcvData[ohlcvData.length - 1];
      eventInputs.push({
        runId,
        entryTime: currentPosition.entryTime,
        entryPrice: currentPosition.entryPrice,
        matchScore: currentPosition.matchScore,
        exitTime: lastCandle.timestamp,
        exitPrice: lastCandle.close,
        outcome: 'timeout',
        pnl: this.calculatePnL(
          currentPosition.entryPrice,
          lastCandle.close,
          noteSide,
          params.tradingCost || 0,
        ),
      });
    }

    return eventInputs;
  }

  /**
   * OHLCV データを MarketSnapshot に変換
   * 
   * NoteEvaluator.evaluate() に渡すための変換
   */
  private convertOHLCVToSnapshot(
    candle: {
      timestamp: Date;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    },
    symbol: string,
    timeframe: string,
  ): MarketSnapshot {
    // ローソク足から計算可能な基本インジケーターを設定
    // 注: 簡易版。実運用では事前計算されたインジケーターを使用
    const priceChange = candle.open > 0 ? (candle.close - candle.open) / candle.open : 0;
    
    return {
      symbol,
      timestamp: candle.timestamp,
      timeframe,
      ohlcv: {
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      },
      indicators: {
        // 基本的な値のみ設定（NoteEvaluator が必要に応じて使用）
        close: candle.close,
        priceChange,
      },
    };
  }

  /**
   * エグジット判定
   */
  private checkExit(
    entryPrice: number,
    candle: { high: number; low: number; close: number },
    side: string,
    takeProfitPct: number,
    stopLossPct: number,
    holdingMinutes: number,
    maxHoldingMinutes: number,
  ): { shouldExit: boolean; exitPrice: number; outcome: BacktestOutcome } {
    const isBuy = side.toLowerCase() === 'buy';
    
    // 利確価格と損切価格
    const takeProfitPrice = isBuy
      ? entryPrice * (1 + takeProfitPct / 100)
      : entryPrice * (1 - takeProfitPct / 100);
    const stopLossPrice = isBuy
      ? entryPrice * (1 - stopLossPct / 100)
      : entryPrice * (1 + stopLossPct / 100);

    // 利確判定（high/low で判定）
    if (isBuy && candle.high >= takeProfitPrice) {
      return { shouldExit: true, exitPrice: takeProfitPrice, outcome: 'win' };
    }
    if (!isBuy && candle.low <= takeProfitPrice) {
      return { shouldExit: true, exitPrice: takeProfitPrice, outcome: 'win' };
    }

    // 損切判定
    if (isBuy && candle.low <= stopLossPrice) {
      return { shouldExit: true, exitPrice: stopLossPrice, outcome: 'loss' };
    }
    if (!isBuy && candle.high >= stopLossPrice) {
      return { shouldExit: true, exitPrice: stopLossPrice, outcome: 'loss' };
    }

    // タイムアウト判定
    if (holdingMinutes >= maxHoldingMinutes) {
      return { shouldExit: true, exitPrice: candle.close, outcome: 'timeout' };
    }

    return { shouldExit: false, exitPrice: 0, outcome: 'timeout' };
  }

  /**
   * PnL を計算
   */
  private calculatePnL(
    entryPrice: number,
    exitPrice: number,
    side: string,
    tradingCostPct: number,
  ): number {
    const isBuy = side.toLowerCase() === 'buy';
    const rawPnL = isBuy
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;
    
    // 取引コストを差し引く（往復分）
    return (rawPnL - tradingCostPct / 100 * 2) * 100;
  }

  /**
   * 結果を集計
   */
  private calculateResult(
    runId: string,
    events: BacktestEvent[],
    tradingCostPct: number,
  ): CreateBacktestResultInput {
    const wins = events.filter(e => e.outcome === 'win');
    const losses = events.filter(e => e.outcome === 'loss');
    const timeouts = events.filter(e => e.outcome === 'timeout');

    const setupCount = events.length;
    const winCount = wins.length;
    const lossCount = losses.length;
    const timeoutCount = timeouts.length;

    const winRate = setupCount > 0 ? winCount / setupCount : 0;

    // Decimal 型を number に変換するヘルパー
    const getPnl = (e: BacktestEvent): number => {
      if (e.pnl === null || e.pnl === undefined) return 0;
      return Number(e.pnl);
    };

    const totalProfit = events
      .filter(e => getPnl(e) > 0)
      .reduce((sum, e) => sum + getPnl(e), 0);
    const totalLoss = Math.abs(events
      .filter(e => getPnl(e) < 0)
      .reduce((sum, e) => sum + getPnl(e), 0));

    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;
    const averagePnL = setupCount > 0
      ? events.reduce((sum, e) => sum + getPnl(e), 0) / setupCount
      : 0;

    // 期待値 = 勝率 × 平均利益 - 敗率 × 平均損失
    const avgWin = winCount > 0 ? totalProfit / winCount : 0;
    const avgLoss = lossCount > 0 ? totalLoss / lossCount : 0;
    const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

    // 最大ドローダウン計算（簡易版）
    let maxDrawdown = 0;
    let peak = 0;
    let cumPnL = 0;
    for (const event of events) {
      cumPnL += getPnl(event);
      if (cumPnL > peak) {
        peak = cumPnL;
      }
      const drawdown = peak - cumPnL;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return {
      runId,
      setupCount,
      winCount,
      lossCount,
      timeoutCount,
      winRate,
      profitFactor: Number.isFinite(profitFactor) ? profitFactor : undefined,
      totalProfit,
      totalLoss,
      averagePnL,
      expectancy,
      maxDrawdown,
    };
  }

  /**
   * バックテスト結果を取得
   */
  async getResult(runId: string): Promise<BacktestSummary | null> {
    const run = await this.backtestRepo.findRunById(runId, true);
    if (!run) return null;

    const result = run.result;
    const events = run.events || [];

    return {
      runId: run.id,
      status: run.status,
      setupCount: result?.setupCount || 0,
      winCount: result?.winCount || 0,
      lossCount: result?.lossCount || 0,
      timeoutCount: result?.timeoutCount || 0,
      winRate: result?.winRate || 0,
      profitFactor: result?.profitFactor ? Number(result.profitFactor) : null,
      totalProfit: result?.totalProfit ? Number(result.totalProfit) : 0,
      totalLoss: result?.totalLoss ? Number(result.totalLoss) : 0,
      averagePnL: result?.averagePnL ? Number(result.averagePnL) : 0,
      expectancy: result?.expectancy ? Number(result.expectancy) : 0,
      maxDrawdown: result?.maxDrawdown ? Number(result.maxDrawdown) : null,
      events: events.map(e => ({
        entryTime: e.entryTime.toISOString(),
        entryPrice: Number(e.entryPrice),
        matchScore: e.matchScore,
        exitTime: e.exitTime?.toISOString() || null,
        exitPrice: e.exitPrice ? Number(e.exitPrice) : null,
        outcome: e.outcome,
        pnl: e.pnl ? Number(e.pnl) : null,
        holdingMinutes: e.exitTime && e.entryTime
          ? Math.round((e.exitTime.getTime() - e.entryTime.getTime()) / 60000)
          : null,
      })),
    };
  }

  /**
   * ノートのバックテスト履歴を取得
   */
  async getHistoryByNoteId(noteId: string, limit: number = 10): Promise<BacktestSummary[]> {
    const runs = await this.backtestRepo.findRunsByNoteId(noteId, limit);
    
    return runs.map(run => ({
      runId: run.id,
      status: run.status,
      setupCount: run.result?.setupCount || 0,
      winCount: run.result?.winCount || 0,
      lossCount: run.result?.lossCount || 0,
      timeoutCount: run.result?.timeoutCount || 0,
      winRate: run.result?.winRate || 0,
      profitFactor: run.result?.profitFactor ? Number(run.result.profitFactor) : null,
      totalProfit: run.result?.totalProfit ? Number(run.result.totalProfit) : 0,
      totalLoss: run.result?.totalLoss ? Number(run.result.totalLoss) : 0,
      averagePnL: run.result?.averagePnL ? Number(run.result.averagePnL) : 0,
      expectancy: run.result?.expectancy ? Number(run.result.expectancy) : 0,
      maxDrawdown: run.result?.maxDrawdown ? Number(run.result.maxDrawdown) : null,
      events: [], // 履歴一覧では events は空
    }));
  }
}

// シングルトンインスタンスをエクスポート
export const backtestService = new BacktestService();
