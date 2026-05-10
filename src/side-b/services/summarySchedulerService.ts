/**
 * サマリー生成スケジューラーサービス
 * 
 * 目的: 週次/月次サマリーの自動生成を管理
 * 
 * スケジュール:
 * - 週次サマリー: 毎週土曜日 NY市場閉場時点 (UTC 22:00 = JST 翌7:00)
 * - 月次サマリー: 毎月1日 0:00 UTC
 * 
 * 設計方針:
 * - node-cron でスケジュール管理
 * - Human(Side-A) と AI(Side-B) 両方のサマリーを生成
 * - 比較分析レポートも含む
 */

import * as cron from 'node-cron';
import { getComparisonAnalysis, type ComparisonPeriod } from './comparisonService';
import { z } from 'zod';
// canonical singleton (PR #152)
import { prisma } from '../../backend/db/client';

// ========================================
// Zod スキーマ定義
// ========================================

/**
 * サマリー期間タイプ（週次/月次専用）
 * Note: modelsのSummaryPeriodとは別（daily含まない）
 */
export const SchedulerSummaryPeriodSchema = z.enum(['weekly', 'monthly']);
export type SchedulerSummaryPeriod = z.infer<typeof SchedulerSummaryPeriodSchema>;

/**
 * 生成されるサマリーの構造
 */
export const GeneratedSummarySchema = z.object({
  id: z.string().uuid(),
  period: SchedulerSummaryPeriodSchema,
  startDate: z.date(),
  endDate: z.date(),
  /**
   * Critical-4 段階 3b 以降: 人間ノートの BT 統計は取得不能 (`comparison.humanDataAvailable=false`)
   * のため、各フィールドは null 許容。`null` は「データなし」を意味し、Push 通知 / LLM 解釈側で
   * 「人間データなし」として扱う(0 pips の誤記録を防ぐ)。
   * 段階 4 で analysis-engine 経由の人間ノート BT 実装後、再び数値が入る予定。
   */
  humanStats: z.object({
    totalTrades: z.number().nullable(),
    winRate: z.number().nullable(),
    totalPnL: z.number().nullable(),
    avgRR: z.number().nullable(),
    bestTrade: z.number().nullable(),
    worstTrade: z.number().nullable(),
  }),
  aiStats: z.object({
    totalTrades: z.number(),
    winRate: z.number(),
    totalPnL: z.number(),
    avgRR: z.number().nullable(),
    bestTrade: z.number().nullable(),
    worstTrade: z.number().nullable(),
  }),
  comparison: z.object({
    /** 人間データ不在の場合は null (= 比較不可) */
    winRateDiff: z.number().nullable(),
    /** 人間データ不在の場合は null */
    pnlDiff: z.number().nullable(),
    recommendation: z.string(),
  }),
  generatedAt: z.date(),
});

export type GeneratedSummary = z.infer<typeof GeneratedSummarySchema>;

/**
 * スケジューラー設定
 */
export const SchedulerConfigSchema = z.object({
  weeklyEnabled: z.boolean().default(true),
  monthlyEnabled: z.boolean().default(true),
  // 週次: 土曜日 UTC 22:00 (NY市場閉場)
  weeklyCronExpression: z.string().default('0 22 * * 6'),
  // 月次: 毎月1日 0:00 UTC
  monthlyCronExpression: z.string().default('0 0 1 * *'),
  // 通知設定
  notifyOnGeneration: z.boolean().default(true),
});

export type SchedulerConfig = z.infer<typeof SchedulerConfigSchema>;

// ========================================
// サマリー生成ロジック
// ========================================

/**
 * 週次サマリーの期間を計算
 * NY市場の週（月曜〜金曜）を基準に、直前の1週間を対象とする
 */
function getWeeklyPeriod(): { startDate: Date; endDate: Date } {
  const now = new Date();
  // 現在時刻をUTCで扱う
  const endDate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    22, 0, 0, 0  // UTC 22:00 = NY市場閉場
  ));
  
  // 7日前を開始日に設定
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 7);
  
  return { startDate, endDate };
}

/**
 * 月次サマリーの期間を計算
 * 前月の1日〜末日を対象とする
 */
function getMonthlyPeriod(): { startDate: Date; endDate: Date } {
  const now = new Date();
  
  // 前月の初日
  const startDate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() - 1,
    1, 0, 0, 0, 0
  ));
  
  // 前月の末日（今月の0日目 = 前月末日）
  const endDate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    0, 23, 59, 59, 999
  ));
  
  return { startDate, endDate };
}

/**
 * サマリー期間をcomparisonService用の期間に変換
 */
function mapPeriodToComparison(period: SchedulerSummaryPeriod): ComparisonPeriod {
  return period === 'weekly' ? 'week' : 'month';
}

/**
 * AI 単独評価ベースの推奨コメント (Critical-4 段階 3b: 人間データ不在時用)
 *
 * 人間 vs AI 比較ができない期間 (旧 BT 廃止後 ~ 段階 4 完了まで) の代替コメント。
 * 段階 4 で人間ノート BT が再構築されたら、本関数は不要になり generateRecommendation のみ
 * を使う形に戻す予定。
 */
function generateAiOnlyRecommendation(
  aiWinRate: number,
  aiPnL: number,
  aiTrades: number,
): string {
  if (aiTrades === 0) {
    return '対象期間に AI トレードがありませんでした。人間トレードの BT 統計は段階 4 以降で再構築予定です。';
  }
  const parts: string[] = [];
  parts.push(
    `AI: 勝率 ${aiWinRate.toFixed(1)}% / 損益 ${aiPnL >= 0 ? '+' : ''}${aiPnL.toFixed(1)}pips / ${aiTrades} 件`,
  );
  if (aiWinRate >= 60 && aiPnL > 0) {
    parts.push('AI のパフォーマンスは良好です。現在の戦略を継続してください。');
  } else if (aiWinRate < 40 || aiPnL < 0) {
    parts.push('AI のパフォーマンス改善の余地があります。エッジ仮説の見直しを推奨します。');
  } else {
    parts.push('AI のパフォーマンスは平均的です。');
  }
  parts.push('(人間ノートの BT 統計は Critical-4 段階 3b で旧 BT 経路が廃止されたため不在、段階 4 で再構築予定)');
  return parts.join(' ');
}

/**
 * AIによる推奨コメントを生成
 */
function generateRecommendation(
  humanWinRate: number,
  aiWinRate: number,
  humanPnL: number,
  aiPnL: number
): string {
  const recommendations: string[] = [];

  // 勝率比較
  const winRateDiff = humanWinRate - aiWinRate;
  if (winRateDiff > 10) {
    recommendations.push('人間の勝率がAIを大幅に上回っています。直感的な判断力が活かされています。');
  } else if (winRateDiff < -10) {
    recommendations.push('AIの勝率が人間を上回っています。AIの分析を参考にエントリー条件を見直すことをお勧めします。');
  } else {
    recommendations.push('勝率はほぼ互角です。');
  }

  // 損益比較
  const pnlDiff = humanPnL - aiPnL;
  if (pnlDiff > 0) {
    recommendations.push(`人間が${Math.abs(pnlDiff).toFixed(1)}pips多く獲得しています。リスク管理が適切に機能しています。`);
  } else if (pnlDiff < 0) {
    recommendations.push(`AIが${Math.abs(pnlDiff).toFixed(1)}pips多く獲得しています。利確/損切りタイミングをAIに合わせることを検討してください。`);
  }

  // 総合評価
  if (humanWinRate >= 50 && humanPnL > 0) {
    recommendations.push('総合的に良好なパフォーマンスです。現在の戦略を継続してください。');
  } else if (humanWinRate < 40 || humanPnL < -50) {
    recommendations.push('パフォーマンス改善の余地があります。トレードプランの見直しを推奨します。');
  }

  return recommendations.join(' ');
}

// ========================================
// サマリー生成サービス
// ========================================

/**
 * スケジューラー状態
 */
export interface SummarySchedulerStatus {
  isRunning: boolean;
  config: SchedulerConfig;
  lastWeeklyRun?: Date;
  lastMonthlyRun?: Date;
}

class SummarySchedulerService {
  private weeklyTask: cron.ScheduledTask | null = null;
  private monthlyTask: cron.ScheduledTask | null = null;
  private config: SchedulerConfig;
  private lastWeeklyRun?: Date;
  private lastMonthlyRun?: Date;

  constructor() {
    this.config = SchedulerConfigSchema.parse({});
  }

  /**
   * スケジューラーを開始
   */
  start(config?: Partial<SchedulerConfig>): void {
    // 設定を更新
    if (config) {
      this.config = SchedulerConfigSchema.parse({ ...this.config, ...config });
    }

    // 既存タスクを停止
    this.stop();

    // 週次タスクをスケジュール
    if (this.config.weeklyEnabled) {
      this.weeklyTask = cron.schedule(
        this.config.weeklyCronExpression,
        async () => {
          console.log('[SummaryScheduler] 週次サマリー生成を開始します...');
          try {
            const summary = await this.generateWeeklySummary();
            console.log('[SummaryScheduler] 週次サマリー生成完了:', summary.id);
          } catch (error) {
            console.error('[SummaryScheduler] 週次サマリー生成エラー:', error);
          }
        },
        { timezone: 'UTC' }
      );
      console.log(`[SummaryScheduler] 週次タスク登録: ${this.config.weeklyCronExpression}`);
    }

    // 月次タスクをスケジュール
    if (this.config.monthlyEnabled) {
      this.monthlyTask = cron.schedule(
        this.config.monthlyCronExpression,
        async () => {
          console.log('[SummaryScheduler] 月次サマリー生成を開始します...');
          try {
            const summary = await this.generateMonthlySummary();
            console.log('[SummaryScheduler] 月次サマリー生成完了:', summary.id);
          } catch (error) {
            console.error('[SummaryScheduler] 月次サマリー生成エラー:', error);
          }
        },
        { timezone: 'UTC' }
      );
      console.log(`[SummaryScheduler] 月次タスク登録: ${this.config.monthlyCronExpression}`);
    }
  }

  /**
   * スケジューラーを停止
   */
  stop(): void {
    if (this.weeklyTask) {
      this.weeklyTask.stop();
      this.weeklyTask = null;
    }
    if (this.monthlyTask) {
      this.monthlyTask.stop();
      this.monthlyTask = null;
    }
    console.log('[SummaryScheduler] スケジューラー停止');
  }

  /**
   * スケジューラーの現在の状態を取得
   */
  getStatus(): SummarySchedulerStatus {
    return {
      isRunning: this.weeklyTask !== null || this.monthlyTask !== null,
      config: this.config,
      lastWeeklyRun: this.lastWeeklyRun,
      lastMonthlyRun: this.lastMonthlyRun,
    };
  }

  /**
   * 週次サマリーを生成
   */
  async generateWeeklySummary(): Promise<GeneratedSummary> {
    const { startDate, endDate } = getWeeklyPeriod();
    const summary = await this.generateSummary('weekly', startDate, endDate);
    this.lastWeeklyRun = new Date();
    return summary;
  }

  /**
   * 月次サマリーを生成
   */
  async generateMonthlySummary(): Promise<GeneratedSummary> {
    const { startDate, endDate } = getMonthlyPeriod();
    const summary = await this.generateSummary('monthly', startDate, endDate);
    this.lastMonthlyRun = new Date();
    return summary;
  }

  /**
   * 指定期間のサマリーを生成
   */
  async generateSummary(
    period: SchedulerSummaryPeriod,
    startDate: Date,
    endDate: Date
  ): Promise<GeneratedSummary> {
    // 比較分析を取得（期間プリセットを使用）
    const comparisonPeriod = mapPeriodToComparison(period);
    const comparison = await getComparisonAnalysis(comparisonPeriod);

    // Critical-4 段階 3b: 旧 BT 廃止により `comparison.humanDataAvailable === false` の間は
    //   - humanStats を null 群に倒し、Push/Daily Summary 永続化に「0 件 0 pips」を誤記録しない
    //   - winRateDiff / pnlDiff も比較不可として null
    //   - recommendation は AI 単独評価 + 人間データ不在の旨を明示
    // 段階 4 で analysis-engine 経由の人間ノート BT が実装されたら humanDataAvailable=true に戻る。
    const humanAvailable = comparison.humanDataAvailable;

    const humanStats: GeneratedSummary['humanStats'] = humanAvailable
      ? {
          totalTrades: comparison.human.totalTrades,
          winRate: comparison.human.winRate,
          totalPnL: comparison.human.totalPnL,
          avgRR: comparison.human.profitFactor, // PFをRRの代わりに使用
          bestTrade: comparison.human.maxWin,
          worstTrade: comparison.human.maxLoss,
        }
      : {
          totalTrades: null,
          winRate: null,
          totalPnL: null,
          avgRR: null,
          bestTrade: null,
          worstTrade: null,
        };

    const recommendation = humanAvailable
      ? generateRecommendation(
          comparison.human.winRate,
          comparison.ai.winRate,
          comparison.human.totalPnL,
          comparison.ai.totalPnL,
        )
      : generateAiOnlyRecommendation(
          comparison.ai.winRate,
          comparison.ai.totalPnL,
          comparison.ai.totalTrades,
        );

    const winRateDiff = humanAvailable ? comparison.human.winRate - comparison.ai.winRate : null;
    const pnlDiff = humanAvailable ? comparison.human.totalPnL - comparison.ai.totalPnL : null;

    // サマリーを構築
    const summary: GeneratedSummary = {
      id: crypto.randomUUID(),
      period,
      startDate,
      endDate,
      humanStats,
      aiStats: {
        totalTrades: comparison.ai.totalTrades,
        winRate: comparison.ai.winRate,
        totalPnL: comparison.ai.totalPnL,
        avgRR: comparison.ai.profitFactor, // PFをRRの代わりに使用
        bestTrade: comparison.ai.maxWin,
        worstTrade: comparison.ai.maxLoss,
      },
      comparison: {
        winRateDiff,
        pnlDiff,
        recommendation,
      },
      generatedAt: new Date(),
    };

    // DBに保存
    await this.saveSummary(summary);

    return summary;
  }

  /**
   * サマリーをDBに保存
   * AINoteSummaryモデルを使用
   */
  private async saveSummary(summary: GeneratedSummary): Promise<void> {
    // Critical-4 段階 3b: humanStats が null 群 (旧 BT 廃止により取得不能) の場合、
    // 0 として加算すると combinedWinRate が誤った値になるので、AI 単独で集計する。
    const humanTrades = summary.humanStats.totalTrades ?? 0;
    const humanWinRate = summary.humanStats.winRate ?? 0;
    const humanAvailable = summary.humanStats.totalTrades !== null;

    const totalTrades = humanTrades + summary.aiStats.totalTrades;
    const combinedWinRate = humanAvailable
      ? totalTrades > 0
        ? (humanWinRate * humanTrades + summary.aiStats.winRate * summary.aiStats.totalTrades) /
          totalTrades
        : 0
      : summary.aiStats.winRate; // 人間データ不在なら AI 勝率をそのまま使う

    await prisma.aINoteSummary.create({
      data: {
        period: summary.period,
        startDate: summary.startDate,
        endDate: summary.endDate,
        statistics: {
          humanStats: summary.humanStats,
          aiStats: summary.aiStats,
          totalTrades,
          combinedWinRate,
          humanDataAvailable: humanAvailable,
        },
        analysis: {
          comparison: summary.comparison,
          winRateDiff: summary.comparison.winRateDiff,
          pnlDiff: summary.comparison.pnlDiff,
        },
        summary: {
          recommendation: summary.comparison.recommendation,
          generatedAt: summary.generatedAt,
        },
      },
    });
  }

  /**
   * サマリー一覧を取得
   */
  async listSummaries(options: {
    period?: SchedulerSummaryPeriod;
    limit?: number;
    offset?: number;
  } = {}): Promise<GeneratedSummary[]> {
    const { period, limit = 10, offset = 0 } = options;

    const summaries = await prisma.aINoteSummary.findMany({
      where: period ? { period } : undefined,
      orderBy: { endDate: 'desc' },
      take: limit,
      skip: offset,
    });

    return summaries.map((s): GeneratedSummary => {
      const stats = s.statistics as { humanStats?: GeneratedSummary['humanStats']; aiStats?: GeneratedSummary['aiStats'] } | null;
      const analysis = s.analysis as { comparison?: GeneratedSummary['comparison'] } | null;
      const summaryData = s.summary as { recommendation?: string; generatedAt?: string } | null;

      return {
        id: s.id,
        period: s.period as SchedulerSummaryPeriod,
        startDate: s.startDate,
        endDate: s.endDate,
        humanStats: stats?.humanStats || {
          totalTrades: 0,
          winRate: 0,
          totalPnL: 0,
          avgRR: null,
          bestTrade: null,
          worstTrade: null,
        },
        aiStats: stats?.aiStats || {
          totalTrades: 0,
          winRate: 0,
          totalPnL: 0,
          avgRR: null,
          bestTrade: null,
          worstTrade: null,
        },
        comparison: analysis?.comparison || {
          winRateDiff: 0,
          pnlDiff: 0,
          recommendation: summaryData?.recommendation || '',
        },
        generatedAt: summaryData?.generatedAt ? new Date(summaryData.generatedAt) : s.createdAt,
      };
    });
  }

  /**
   * 現在の設定を取得
   */
  getConfig(): SchedulerConfig {
    return { ...this.config };
  }

  /**
   * 設定を更新
   */
  updateConfig(newConfig: Partial<SchedulerConfig>): void {
    this.config = SchedulerConfigSchema.parse({ ...this.config, ...newConfig });
    // 設定変更後はスケジューラーを再起動
    this.start();
  }
}

// シングルトンインスタンスをエクスポート
export const summarySchedulerService = new SummarySchedulerService();
