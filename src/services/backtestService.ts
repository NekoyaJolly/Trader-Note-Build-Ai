/**
 * バックテストサービス
 * 
 * 目的: ノートの優位性を過去データで検証する
 * 
 * 責務:
 * - バックテスト実行のオーケストレーション
 * - 一致判定とエントリー/エグジット判定
 * - 結果の集計と永続化
 * 
 * 制約:
 * - 未来データを使わない（look-ahead bias 対策）
 * - candle close 基準で評価
 * 
 * 12次元統一対応:
 * - 7次元ベクトルと12次元ベクトルの両方をサポート
 * - 旧7次元ベクトルは自動的に12次元に変換
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
import { RuleBasedMatchEvaluator } from '../backend/services/matching/matchEvaluationService';
import {
  VECTOR_DIMENSION,
  convertLegacyVector,
  calculateCosineSimilarity,
  SIMILARITY_THRESHOLDS,
  isValid12DVector,
} from './featureVectorService';

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
 */
export class BacktestService {
  private readonly backtestRepo: BacktestRepository;
  private readonly ohlcvRepo: OHLCVRepository;
  private readonly noteRepo: TradeNoteRepository;
  private readonly evaluator: RuleBasedMatchEvaluator;

  constructor(
    backtestRepo?: BacktestRepository,
    ohlcvRepo?: OHLCVRepository,
    noteRepo?: TradeNoteRepository,
  ) {
    this.backtestRepo = backtestRepo || new BacktestRepository();
    this.ohlcvRepo = ohlcvRepo || new OHLCVRepository();
    this.noteRepo = noteRepo || new TradeNoteRepository();
    this.evaluator = new RuleBasedMatchEvaluator();
  }

  /**
   * バックテストを実行する
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

    // 2. ノートの特徴量ベクトルを取得（12次元統一対応）
    let noteVector = note.featureVector as number[];
    if (!noteVector || noteVector.length === 0) {
      throw new Error('ノートの特徴量ベクトルが設定されていません');
    }

    // 旧7次元ベクトルを12次元に変換（後方互換性）
    if (noteVector.length === 7) {
      console.log(`[BacktestService] 7次元ベクトルを12次元に変換: noteId=${params.noteId}`);
      noteVector = convertLegacyVector(noteVector, '7d');
    } else if (noteVector.length === 8) {
      console.log(`[BacktestService] 8次元ベクトルを12次元に変換: noteId=${params.noteId}`);
      noteVector = convertLegacyVector(noteVector, '8d');
    } else if (noteVector.length === 18) {
      console.log(`[BacktestService] 18次元ベクトルを12次元に変換: noteId=${params.noteId}`);
      noteVector = convertLegacyVector(noteVector, '18d');
    } else if (!isValid12DVector(noteVector)) {
      throw new Error(`ノートの特徴量ベクトルが不正です（次元数: ${noteVector.length}）`);
    }

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

      // 6. バックテストロジックを実行
      const eventInputs = await this.runBacktestLogic(
        run.id,
        noteVector,
        note.side,
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
   * イベント入力データを蓄積して返す（DBへの保存は呼び出し元で行う）
   */
  private async runBacktestLogic(
    runId: string,
    noteVector: number[],
    noteSide: string,
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

      // ポジションがない場合: エントリー判定
      const marketVector = this.buildMarketVector(candle);
      
      // 12次元統一: コサイン類似度で評価
      const evalResult = this.evaluateMatch(noteVector, marketVector);

      if (evalResult.score >= params.matchThreshold) {
        // マッチ: エントリー
        currentPosition = {
          entryTime: candle.timestamp,
          entryPrice: candle.close, // candle close でエントリー
          matchScore: evalResult.score,
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
   * OHLCV データから特徴量ベクトルを構築
   * 
   * 12次元統一対応:
   * - 12次元ベクトルを生成（7次元との後方互換性維持）
   * - インジケーター計算は簡易版（実運用では FeatureExtractor を使用）
   */
  private buildMarketVector(candle: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }): number[] {
    // ローソク足から計算可能な基本特徴量
    const priceChange = candle.open > 0 ? (candle.close - candle.open) / candle.open : 0;
    const candleBody = candle.open > 0 ? Math.abs(candle.close - candle.open) / candle.open : 0;
    const candleDirection = candle.close >= candle.open ? 1 : -1;

    // トレンド方向の推定（簡易版）
    // 正規化: -1（下降）〜 0（横ばい）〜 1（上昇）
    const trendDirection = priceChange > 0.005 ? 1 : priceChange < -0.005 ? -1 : 0;
    // トレンド強度: 0〜1
    const trendStrength = Math.min(Math.abs(priceChange) * 20, 1);
    // トレンド整合性: 簡易版では 0.5（中立）
    const trendAlignment = 0.5;

    // モメンタム系（簡易版）
    // MACD ヒストグラム: -1〜1（データ不足時は 0）
    const macdHistogram = 0;
    // MACD クロスオーバー: -1, 0, 1（データ不足時は 0）
    const macdCrossover = 0;

    // 過熱度系（簡易版）
    // RSI 値: 0〜1（データ不足時は 0.5 = 中立）
    const rsiValue = 0.5;
    // RSI ゾーン: -1（売られ過ぎ）, 0（中立）, 1（買われ過ぎ）
    const rsiZone = 0;

    // ボラティリティ系（簡易版）
    // BB ポジション: -1〜1（データ不足時は 0）
    const bbPosition = 0;
    // BB 幅: 0〜1（データ不足時は 0.5）
    const bbWidth = 0.5;

    // 時間軸
    // セッションフラグ: 0 or 1（時間情報なしの場合は 0.5）
    const sessionFlag = 0.5;

    // 12次元ベクトル
    return [
      trendDirection,   // [0] トレンド方向
      trendStrength,    // [1] トレンド強度
      trendAlignment,   // [2] トレンド整合性
      macdHistogram,    // [3] MACD ヒストグラム
      macdCrossover,    // [4] MACD クロスオーバー
      rsiValue,         // [5] RSI 値
      rsiZone,          // [6] RSI ゾーン
      bbPosition,       // [7] BB ポジション
      bbWidth,          // [8] BB 幅
      candleBody,       // [9] ローソク足実体
      candleDirection,  // [10] ローソク足方向
      sessionFlag,      // [11] セッションフラグ
    ];
  }

  /**
   * 12次元ベクトルの類似度評価
   * 
   * 7次元の RuleBasedMatchEvaluator の代わりにコサイン類似度を使用
   */
  private evaluateMatch(
    noteVector: number[],
    marketVector: number[]
  ): { score: number; reasons: string[] } {
    // コサイン類似度を計算
    const similarity = calculateCosineSimilarity(noteVector, marketVector);

    // 理由を生成
    const reasons: string[] = [];
    if (similarity >= SIMILARITY_THRESHOLDS.STRONG) {
      reasons.push('非常に高い類似度: パターンが強くマッチしています');
    } else if (similarity >= SIMILARITY_THRESHOLDS.MEDIUM) {
      reasons.push('高い類似度: パターンが概ねマッチしています');
    } else if (similarity >= SIMILARITY_THRESHOLDS.WEAK) {
      reasons.push('中程度の類似度: パターンが部分的にマッチしています');
    } else {
      reasons.push('低い類似度: パターンとの一致が弱いです');
    }

    return { score: similarity, reasons };
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
