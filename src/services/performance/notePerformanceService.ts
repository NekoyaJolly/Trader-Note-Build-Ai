/**
 * ノートパフォーマンスサービス
 * 
 * フェーズ9「ノートの自己評価」の集計ロジック
 * EvaluationLog から以下を算出:
 * - 基本統計（発火率、平均類似度等）
 * - 時間帯別パフォーマンス（UTC 0-23時）
 * - 相場状況別パフォーマンス
 * - 弱いパターンの検出
 * 
 * @see src/services/performance/notePerformanceTypes.ts
 */

import { PrismaClient, EvaluationLog } from '@prisma/client';
import { prisma } from '../../backend/db/client';
import {
  NotePerformanceReport,
  NoteRankingEntry,
  HourlyPerformance,
  ConditionPerformance,
  WeakPattern,
  MarketCondition,
  MarketConditionInput,
  PerformanceReportOptions,
} from './notePerformanceTypes';

/**
 * 弱いパターン検出の閾値（デフォルト）
 */
const DEFAULT_WEAK_THRESHOLD = 0.5;

/**
 * ランキングスコア計算の重み
 */
const SCORE_WEIGHTS = {
  /** 発火率の重み */
  triggerRate: 0.4,
  /** 平均類似度の重み */
  avgSimilarity: 0.3,
  /** 評価回数の重み（対数スケール） */
  evaluationCount: 0.3,
};

export class NotePerformanceService {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || prisma;
  }

  /**
   * ノートのパフォーマンスレポートを生成
   * 
   * @param noteId - ノート ID
   * @param options - 集計オプション（期間、閾値等）
   * @returns パフォーマンスレポート（評価ログがない場合は null）
   */
  async generateReport(
    noteId: string,
    options: PerformanceReportOptions = {}
  ): Promise<NotePerformanceReport | null> {
    const { from, to, weakThreshold = DEFAULT_WEAK_THRESHOLD, timeframe } = options;

    // 評価ログを取得
    const logs = await this.fetchEvaluationLogs(noteId, { from, to, timeframe });
    
    if (logs.length === 0) {
      return null;
    }

    // 基本統計を計算
    const basicStats = this.calculateBasicStats(logs);
    
    // ノート情報を取得（シンボル）
    const note = await this.prisma.tradeNote.findUnique({
      where: { id: noteId },
      select: { symbol: true },
    });

    return {
      noteId,
      symbol: note?.symbol || 'UNKNOWN',
      
      // 基本統計
      totalEvaluations: basicStats.total,
      triggeredCount: basicStats.triggered,
      triggerRate: basicStats.triggerRate,
      avgSimilarity: basicStats.avgSimilarity,
      maxSimilarity: basicStats.maxSimilarity,
      minSimilarity: basicStats.minSimilarity,
      
      // 時間帯別
      performanceByHour: this.calculateHourlyPerformance(logs),
      
      // 相場状況別
      performanceByMarketCondition: this.calculateConditionPerformance(logs),
      
      // 弱いパターン
      weakPatterns: this.detectWeakPatterns(logs, weakThreshold),
      
      // メタ情報
      firstEvaluatedAt: basicStats.firstEvaluatedAt,
      lastEvaluatedAt: basicStats.lastEvaluatedAt,
      generatedAt: new Date(),
    };
  }

  /**
   * ノートランキングを取得
   * 
   * @param limit - 取得件数（デフォルト: 20）
   * @param options - 集計オプション
   * @returns ランキングエントリの配列
   */
  async getRanking(
    limit: number = 20,
    options: PerformanceReportOptions = {}
  ): Promise<NoteRankingEntry[]> {
    const { from, to, timeframe } = options;

    // アクティブなノートを取得
    const notes = await this.prisma.tradeNote.findMany({
      where: {
        status: 'approved',
        enabled: true,
      },
      select: { id: true, symbol: true },
    });

    // 各ノートの統計を計算
    const entries: NoteRankingEntry[] = [];
    
    for (const note of notes) {
      const logs = await this.fetchEvaluationLogs(note.id, { from, to, timeframe });
      
      // 最低評価回数を満たさないノートはスキップ
      if (logs.length < 5) {
        continue;
      }

      const stats = this.calculateBasicStats(logs);
      const score = this.calculateOverallScore(stats);

      entries.push({
        noteId: note.id,
        symbol: note.symbol,
        triggerRate: stats.triggerRate,
        totalEvaluations: stats.total,
        avgSimilarity: stats.avgSimilarity,
        overallScore: score,
        rank: 0, // 後でソート後に設定
      });
    }

    // スコアでソートしてランク付け
    entries.sort((a, b) => b.overallScore - a.overallScore);
    entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    return entries.slice(0, limit);
  }

  /**
   * 複数ノートのパフォーマンスサマリーを一括取得
   * 
   * @param noteIds - ノート ID 配列
   * @param options - 集計オプション
   * @returns noteId をキーとしたサマリーマップ
   */
  async getBulkSummary(
    noteIds: string[],
    options: PerformanceReportOptions = {}
  ): Promise<Map<string, { triggerRate: number; avgSimilarity: number; totalEvaluations: number }>> {
    const result = new Map();
    
    for (const noteId of noteIds) {
      const logs = await this.fetchEvaluationLogs(noteId, options);
      
      if (logs.length === 0) {
        continue;
      }

      const stats = this.calculateBasicStats(logs);
      result.set(noteId, {
        triggerRate: stats.triggerRate,
        avgSimilarity: stats.avgSimilarity,
        totalEvaluations: stats.total,
      });
    }

    return result;
  }

  // ========================================
  // プライベートメソッド
  // ========================================

  /**
   * 評価ログを取得
   */
  private async fetchEvaluationLogs(
    noteId: string,
    options: { from?: Date; to?: Date; timeframe?: string }
  ): Promise<EvaluationLog[]> {
    const where: Record<string, unknown> = { noteId };
    
    if (options.from || options.to) {
      where.evaluatedAt = {};
      if (options.from) {
        (where.evaluatedAt as Record<string, Date>).gte = options.from;
      }
      if (options.to) {
        (where.evaluatedAt as Record<string, Date>).lte = options.to;
      }
    }
    
    if (options.timeframe) {
      where.timeframe = options.timeframe;
    }

    return this.prisma.evaluationLog.findMany({
      where,
      orderBy: { evaluatedAt: 'asc' },
    });
  }

  /**
   * 基本統計を計算
   */
  private calculateBasicStats(logs: EvaluationLog[]): {
    total: number;
    triggered: number;
    triggerRate: number;
    avgSimilarity: number;
    maxSimilarity: number;
    minSimilarity: number;
    firstEvaluatedAt: Date | null;
    lastEvaluatedAt: Date | null;
  } {
    const total = logs.length;
    const triggered = logs.filter(l => l.triggered).length;
    
    const similarities = logs.map(l => l.similarity);
    const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / total;
    const maxSimilarity = Math.max(...similarities);
    const minSimilarity = Math.min(...similarities);

    return {
      total,
      triggered,
      triggerRate: total > 0 ? triggered / total : 0,
      avgSimilarity,
      maxSimilarity,
      minSimilarity,
      firstEvaluatedAt: logs.length > 0 ? logs[0].evaluatedAt : null,
      lastEvaluatedAt: logs.length > 0 ? logs[logs.length - 1].evaluatedAt : null,
    };
  }

  /**
   * 時間帯別パフォーマンスを計算（UTC 0-23時）
   */
  private calculateHourlyPerformance(logs: EvaluationLog[]): HourlyPerformance[] {
    // 時間帯ごとにグループ化
    const hourlyGroups: Map<number, EvaluationLog[]> = new Map();
    
    for (let h = 0; h < 24; h++) {
      hourlyGroups.set(h, []);
    }

    for (const log of logs) {
      const hour = log.evaluatedAt.getUTCHours();
      hourlyGroups.get(hour)!.push(log);
    }

    // 各時間帯の統計を計算
    const result: HourlyPerformance[] = [];
    
    for (let hour = 0; hour < 24; hour++) {
      const hourLogs = hourlyGroups.get(hour)!;
      
      if (hourLogs.length === 0) {
        result.push({
          hour,
          triggerRate: 0,
          avgSimilarity: 0,
          evaluationCount: 0,
        });
        continue;
      }

      const triggered = hourLogs.filter(l => l.triggered).length;
      const avgSim = hourLogs.reduce((a, l) => a + l.similarity, 0) / hourLogs.length;

      result.push({
        hour,
        triggerRate: triggered / hourLogs.length,
        avgSimilarity: avgSim,
        evaluationCount: hourLogs.length,
      });
    }

    return result;
  }

  /**
   * 相場状況別パフォーマンスを計算
   */
  private calculateConditionPerformance(logs: EvaluationLog[]): ConditionPerformance[] {
    // 相場状況ごとにグループ化
    const conditionGroups: Map<MarketCondition, EvaluationLog[]> = new Map([
      ['trending_up', []],
      ['trending_down', []],
      ['ranging', []],
      ['volatile', []],
    ]);

    for (const log of logs) {
      const condition = this.detectMarketCondition(log);
      conditionGroups.get(condition)!.push(log);
    }

    // 各状況の統計を計算
    const result: ConditionPerformance[] = [];
    
    for (const [condition, condLogs] of conditionGroups) {
      if (condLogs.length === 0) {
        result.push({
          condition,
          triggerRate: 0,
          avgSimilarity: 0,
          evaluationCount: 0,
        });
        continue;
      }

      const triggered = condLogs.filter(l => l.triggered).length;
      const avgSim = condLogs.reduce((a, l) => a + l.similarity, 0) / condLogs.length;

      result.push({
        condition,
        triggerRate: triggered / condLogs.length,
        avgSimilarity: avgSim,
        evaluationCount: condLogs.length,
      });
    }

    return result;
  }

  /**
   * 弱いパターンを検出
   * 
   * 低類似度（weakThreshold 以下）のログを分析し、
   * 共通パターンを抽出する
   */
  private detectWeakPatterns(
    logs: EvaluationLog[],
    weakThreshold: number
  ): WeakPattern[] {
    // 弱いログ（類似度が閾値以下）を抽出
    const weakLogs = logs.filter(l => l.similarity <= weakThreshold);
    
    if (weakLogs.length === 0) {
      return [];
    }

    const patterns: WeakPattern[] = [];

    // パターン1: ボラティリティ急上昇時（volatile 状況での低類似度）
    const volatileWeakLogs = weakLogs.filter(
      l => this.detectMarketCondition(l) === 'volatile'
    );
    if (volatileWeakLogs.length >= 3) {
      patterns.push({
        description: 'ボラティリティ急上昇時',
        occurrences: volatileWeakLogs.length,
        avgSimilarity: volatileWeakLogs.reduce((a, l) => a + l.similarity, 0) / volatileWeakLogs.length,
        details: { condition: 'volatile' },
      });
    }

    // パターン2: 特定時間帯での低類似度
    const hourlyWeak: Map<number, EvaluationLog[]> = new Map();
    for (const log of weakLogs) {
      const hour = log.evaluatedAt.getUTCHours();
      if (!hourlyWeak.has(hour)) {
        hourlyWeak.set(hour, []);
      }
      hourlyWeak.get(hour)!.push(log);
    }

    // 弱いログが集中している時間帯を検出
    for (const [hour, hourLogs] of hourlyWeak) {
      // 全体の弱いログの10%以上がこの時間帯に集中
      if (hourLogs.length >= Math.max(3, weakLogs.length * 0.1)) {
        patterns.push({
          description: `UTC ${hour}時台`,
          occurrences: hourLogs.length,
          avgSimilarity: hourLogs.reduce((a, l) => a + l.similarity, 0) / hourLogs.length,
          details: { hour },
        });
      }
    }

    // パターン3: トレンド逆方向時
    const counterTrendLogs = weakLogs.filter(l => {
      const condition = this.detectMarketCondition(l);
      // 診断情報からノートのトレンド方向を取得し、逆方向かチェック
      const diag = l.diagnostics as Record<string, unknown> | null;
      const noteTrend = diag?.noteTrend as string | undefined;
      
      if (noteTrend === 'bullish' && condition === 'trending_down') return true;
      if (noteTrend === 'bearish' && condition === 'trending_up') return true;
      return false;
    });
    
    if (counterTrendLogs.length >= 3) {
      patterns.push({
        description: 'トレンド逆方向時',
        occurrences: counterTrendLogs.length,
        avgSimilarity: counterTrendLogs.reduce((a, l) => a + l.similarity, 0) / counterTrendLogs.length,
        details: { type: 'counter_trend' },
      });
    }

    // 発生回数でソート
    patterns.sort((a, b) => b.occurrences - a.occurrences);

    return patterns;
  }

  /**
   * EvaluationLog から相場状況を判定
   */
  private detectMarketCondition(log: EvaluationLog): MarketCondition {
    const diag = log.diagnostics as Record<string, unknown> | null;
    
    if (!diag) {
      // 診断情報がない場合は level から推測
      if (log.level === 'strong') return 'ranging'; // 高類似度 = レンジ向き
      if (log.level === 'none') return 'volatile';  // 低類似度 = ボラタイル
      return 'ranging';
    }

    // 診断情報から市場状況を取得
    const marketConditionData = diag.marketCondition as MarketConditionInput | undefined;
    
    if (marketConditionData) {
      return this.classifyMarketCondition(marketConditionData);
    }

    // トレンド情報から判定
    const trend = diag.trend as string | undefined;
    if (trend === 'bullish') return 'trending_up';
    if (trend === 'bearish') return 'trending_down';

    return 'ranging';
  }

  /**
   * 市場状況入力から状況を分類
   */
  private classifyMarketCondition(input: MarketConditionInput): MarketCondition {
    // ボラティリティチェック（ATR が平均の1.5倍以上）
    if (input.atr && input.atrAvg && input.atr > input.atrAvg * 1.5) {
      return 'volatile';
    }

    // 価格変動率チェック（2%以上の変動）
    if (input.priceChangePercent && Math.abs(input.priceChangePercent) > 2) {
      return 'volatile';
    }

    // トレンド判定
    if (input.trend === 'bullish' || (input.rsi && input.rsi > 60)) {
      return 'trending_up';
    }
    if (input.trend === 'bearish' || (input.rsi && input.rsi < 40)) {
      return 'trending_down';
    }

    return 'ranging';
  }

  /**
   * 総合スコアを計算（0-100）
   */
  private calculateOverallScore(stats: {
    total: number;
    triggered: number;
    triggerRate: number;
    avgSimilarity: number;
  }): number {
    // 発火率スコア（0-100）
    const triggerScore = stats.triggerRate * 100;
    
    // 類似度スコア（0-100）
    const similarityScore = stats.avgSimilarity * 100;
    
    // 評価回数スコア（対数スケール、最大50件で100点）
    const countScore = Math.min(100, (Math.log10(stats.total + 1) / Math.log10(51)) * 100);

    // 重み付き平均
    return (
      triggerScore * SCORE_WEIGHTS.triggerRate +
      similarityScore * SCORE_WEIGHTS.avgSimilarity +
      countScore * SCORE_WEIGHTS.evaluationCount
    );
  }
}

// シングルトンインスタンス
export const notePerformanceService = new NotePerformanceService();
