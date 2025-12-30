/**
 * バックテストリポジトリ
 * 
 * 目的: BacktestRun, BacktestResult, BacktestEvent の永続化を責務とする
 * 
 * 責務:
 * - バックテスト実行条件の作成・読み取り・更新
 * - バックテスト結果の保存
 * - 個別イベントの保存と取得
 * 
 * 制約:
 * - すべての DB アクセスはこのリポジトリを経由する
 * - ビジネスロジックは含まない (サービス層の責務)
 */

import { 
  PrismaClient, 
  BacktestRun, 
  BacktestResult, 
  BacktestEvent,
  BacktestStatus,
  BacktestOutcome,
} from '@prisma/client';
import { prisma } from '../db/client';

/**
 * バックテスト実行作成用の入力データ
 */
export interface CreateBacktestRunInput {
  noteId: string;
  symbol: string;
  timeframe: string;
  startDate: Date;
  endDate: Date;
  matchThreshold: number;
  takeProfit: number;
  stopLoss: number;
  maxHoldingMinutes?: number;
  tradingCost?: number;
}

/**
 * バックテスト結果作成用の入力データ
 */
export interface CreateBacktestResultInput {
  runId: string;
  setupCount: number;
  winCount: number;
  lossCount: number;
  timeoutCount: number;
  winRate: number;
  profitFactor?: number;
  totalProfit: number;
  totalLoss: number;
  averagePnL: number;
  expectancy: number;
  maxDrawdown?: number;
}

/**
 * バックテストイベント作成用の入力データ
 */
export interface CreateBacktestEventInput {
  runId: string;
  entryTime: Date;
  entryPrice: number;
  matchScore: number;
  exitTime?: Date;
  exitPrice?: number;
  outcome: BacktestOutcome;
  pnl?: number;
}

/**
 * BacktestRun と関連データを含む完全なデータ
 */
export interface BacktestRunWithDetails extends BacktestRun {
  result: BacktestResult | null;
  events?: BacktestEvent[];
}

/**
 * バックテストリポジトリクラス
 */
export class BacktestRepository {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || prisma;
  }

  // ==========================================================
  // BacktestRun メソッド
  // ==========================================================

  /**
   * バックテスト実行を作成する
   */
  async createRun(input: CreateBacktestRunInput): Promise<BacktestRun> {
    return await this.prisma.backtestRun.create({
      data: {
        noteId: input.noteId,
        symbol: input.symbol,
        timeframe: input.timeframe,
        startDate: input.startDate,
        endDate: input.endDate,
        matchThreshold: input.matchThreshold,
        takeProfit: input.takeProfit,
        stopLoss: input.stopLoss,
        maxHoldingMinutes: input.maxHoldingMinutes ?? 1440,
        tradingCost: input.tradingCost,
        status: 'pending',
      },
    });
  }

  /**
   * バックテスト実行をIDで取得する（結果とイベントを含む）
   */
  async findRunById(id: string, includeEvents: boolean = false): Promise<BacktestRunWithDetails | null> {
    return await this.prisma.backtestRun.findUnique({
      where: { id },
      include: {
        result: true,
        events: includeEvents,
      },
    });
  }

  /**
   * ノートIDでバックテスト実行一覧を取得する
   */
  async findRunsByNoteId(noteId: string, limit: number = 20): Promise<BacktestRunWithDetails[]> {
    return await this.prisma.backtestRun.findMany({
      where: { noteId },
      include: { result: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * バックテスト実行のステータスを更新する
   */
  async updateRunStatus(id: string, status: BacktestStatus): Promise<BacktestRun> {
    return await this.prisma.backtestRun.update({
      where: { id },
      data: { status },
    });
  }

  // ==========================================================
  // BacktestResult メソッド
  // ==========================================================

  /**
   * バックテスト結果を保存する
   */
  async createResult(input: CreateBacktestResultInput): Promise<BacktestResult> {
    return await this.prisma.backtestResult.create({
      data: {
        runId: input.runId,
        setupCount: input.setupCount,
        winCount: input.winCount,
        lossCount: input.lossCount,
        timeoutCount: input.timeoutCount,
        winRate: input.winRate,
        profitFactor: input.profitFactor,
        totalProfit: input.totalProfit,
        totalLoss: input.totalLoss,
        averagePnL: input.averagePnL,
        expectancy: input.expectancy,
        maxDrawdown: input.maxDrawdown,
      },
    });
  }

  /**
   * 実行IDでバックテスト結果を取得する
   */
  async findResultByRunId(runId: string): Promise<BacktestResult | null> {
    return await this.prisma.backtestResult.findUnique({
      where: { runId },
    });
  }

  // ==========================================================
  // BacktestEvent メソッド
  // ==========================================================

  /**
   * バックテストイベントを一括保存する
   */
  async createEvents(events: CreateBacktestEventInput[]): Promise<number> {
    const result = await this.prisma.backtestEvent.createMany({
      data: events.map(e => ({
        runId: e.runId,
        entryTime: e.entryTime,
        entryPrice: e.entryPrice,
        matchScore: e.matchScore,
        exitTime: e.exitTime,
        exitPrice: e.exitPrice,
        outcome: e.outcome,
        pnl: e.pnl,
      })),
    });
    return result.count;
  }

  /**
   * 実行IDでバックテストイベント一覧を取得する
   */
  async findEventsByRunId(runId: string, limit: number = 1000): Promise<BacktestEvent[]> {
    return await this.prisma.backtestEvent.findMany({
      where: { runId },
      orderBy: { entryTime: 'asc' },
      take: limit,
    });
  }

  /**
   * バックテストイベントの集計（勝ち/負け/タイムアウト数）
   */
  async countEventsByOutcome(runId: string): Promise<{ outcome: BacktestOutcome; count: number }[]> {
    const results = await this.prisma.backtestEvent.groupBy({
      by: ['outcome'],
      where: { runId },
      _count: true,
    });

    return results.map(r => ({
      outcome: r.outcome,
      count: r._count,
    }));
  }

  // ==========================================================
  // トランザクション / 複合操作
  // ==========================================================

  /**
   * バックテスト完了処理（結果とイベントを同時に保存し、ステータスを更新）
   */
  async completeBacktest(
    runId: string,
    resultInput: Omit<CreateBacktestResultInput, 'runId'>,
    events: Omit<CreateBacktestEventInput, 'runId'>[]
  ): Promise<BacktestRunWithDetails> {
    return await this.prisma.$transaction(async (tx) => {
      // イベントを保存
      if (events.length > 0) {
        await tx.backtestEvent.createMany({
          data: events.map(e => ({
            runId,
            entryTime: e.entryTime,
            entryPrice: e.entryPrice,
            matchScore: e.matchScore,
            exitTime: e.exitTime,
            exitPrice: e.exitPrice,
            outcome: e.outcome,
            pnl: e.pnl,
          })),
        });
      }

      // 結果を保存
      await tx.backtestResult.create({
        data: {
          runId,
          ...resultInput,
        },
      });

      // ステータスを completed に更新
      const run = await tx.backtestRun.update({
        where: { id: runId },
        data: { status: 'completed' },
        include: {
          result: true,
          events: true,
        },
      });

      return run;
    });
  }

  /**
   * 失敗したバックテストをマークする
   */
  async markAsFailed(runId: string, errorMessage?: string): Promise<BacktestRun> {
    return await this.prisma.backtestRun.update({
      where: { id: runId },
      data: { status: 'failed' },
    });
  }
}

// シングルトンインスタンスをエクスポート
export const backtestRepository = new BacktestRepository();
