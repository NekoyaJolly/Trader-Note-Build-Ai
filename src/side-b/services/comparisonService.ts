/**
 * 比較分析サービス（Phase D）
 * 
 * 人間のTradeNoteとAIのAITradeNoteを比較分析する
 * - 勝率比較
 * - PF比較
 * - 判断一致率の計算
 * - 期間別パフォーマンス分析
 * 
 * @see docs/side-b/phase-d-integration.md
 */

import { prisma } from '../../backend/db/client';
import type { Prisma } from '@prisma/client';

// ===== 型定義 =====

/** 期間フィルターの型 */
export type ComparisonPeriod = 'week' | 'month' | 'quarter' | 'year' | 'all';

/** 基本統計情報 */
export interface PerformanceStats {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  profitFactor: number | null;
  totalPnL: number;
  averagePnL: number;
  averageWin: number;
  averageLoss: number;
  maxWin: number;
  maxLoss: number;
}

/** 人間とAIの比較結果 */
export interface ComparisonResult {
  period: {
    start: string;
    end: string;
    label: string;
  };
  human: PerformanceStats;
  ai: PerformanceStats;
  comparison: {
    /** 勝率の差分（human - ai）、正なら人間優位 */
    winRateDiff: number;
    /** PF差分（human - ai）、正なら人間優位 */
    profitFactorDiff: number | null;
    /** 総PnL差分 */
    totalPnLDiff: number;
    /** 勝者（human/ai/tie） */
    winner: 'human' | 'ai' | 'tie';
  };
  /** 同日・同シンボルで同方向のトレード一致率 */
  alignmentRate: number;
}

/** 時系列パフォーマンスデータ */
export interface TimeSeriesData {
  date: string;
  humanWinRate: number;
  aiWinRate: number;
  humanPnL: number;
  aiPnL: number;
}

/** 比較ダッシュボード全体のレスポンス */
export interface ComparisonDashboardData {
  summary: ComparisonResult;
  timeSeries: TimeSeriesData[];
  recentTrades: {
    human: Array<{
      id: string;
      date: string;
      symbol: string;
      side: string;
      outcome: 'win' | 'loss' | 'breakeven';
      pnlPips: number | null;
    }>;
    ai: Array<{
      id: string;
      date: string;
      symbol: string;
      direction: string;
      outcome: 'win' | 'loss' | 'breakeven';
      pnlPips: number;
    }>;
  };
}

// ===== ヘルパー関数 =====

/**
 * 期間からstart/end日付を計算
 */
function getPeriodDates(period: ComparisonPeriod): { start: Date; end: Date; label: string } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  let start: Date;
  let label: string;

  switch (period) {
    case 'week':
      start = new Date(end);
      start.setDate(start.getDate() - 7);
      label = '直近1週間';
      break;
    case 'month':
      start = new Date(end);
      start.setMonth(start.getMonth() - 1);
      label = '直近1ヶ月';
      break;
    case 'quarter':
      start = new Date(end);
      start.setMonth(start.getMonth() - 3);
      label = '直近3ヶ月';
      break;
    case 'year':
      start = new Date(end);
      start.setFullYear(start.getFullYear() - 1);
      label = '直近1年';
      break;
    case 'all':
    default:
      start = new Date(2020, 0, 1); // 全期間（十分に古い日付）
      label = '全期間';
      break;
  }

  return { start, end, label };
}

/**
 * 勝敗を判定（BacktestOutcome に依存しないように）
 */
function determineOutcome(pnlPips: number): 'win' | 'loss' | 'breakeven' {
  if (pnlPips > 0) return 'win';
  if (pnlPips < 0) return 'loss';
  return 'breakeven';
}

/**
 * 統計を計算
 */
function calculateStats(trades: Array<{ outcome: string; pnlPips: number }>): PerformanceStats {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      winCount: 0,
      lossCount: 0,
      winRate: 0,
      profitFactor: null,
      totalPnL: 0,
      averagePnL: 0,
      averageWin: 0,
      averageLoss: 0,
      maxWin: 0,
      maxLoss: 0,
    };
  }

  const wins = trades.filter(t => t.outcome === 'win');
  const losses = trades.filter(t => t.outcome === 'loss');
  
  const winCount = wins.length;
  const lossCount = losses.length;
  const winRate = (winCount / totalTrades) * 100;

  const totalPnL = trades.reduce((sum, t) => sum + t.pnlPips, 0);
  const averagePnL = totalPnL / totalTrades;

  const totalWin = wins.reduce((sum, t) => sum + t.pnlPips, 0);
  const totalLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnlPips, 0));
  
  const averageWin = winCount > 0 ? totalWin / winCount : 0;
  const averageLoss = lossCount > 0 ? totalLoss / lossCount : 0;

  const maxWin = wins.length > 0 ? Math.max(...wins.map(t => t.pnlPips)) : 0;
  const maxLoss = losses.length > 0 ? Math.min(...losses.map(t => t.pnlPips)) : 0;

  // PF = 総利益 / 総損失
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : null;

  return {
    totalTrades,
    winCount,
    lossCount,
    winRate: Math.round(winRate * 10) / 10,
    profitFactor: profitFactor ? Math.round(profitFactor * 100) / 100 : null,
    totalPnL: Math.round(totalPnL * 10) / 10,
    averagePnL: Math.round(averagePnL * 10) / 10,
    averageWin: Math.round(averageWin * 10) / 10,
    averageLoss: Math.round(averageLoss * 10) / 10,
    maxWin: Math.round(maxWin * 10) / 10,
    maxLoss: Math.round(maxLoss * 10) / 10,
  };
}

// ===== メインサービス関数 =====

/**
 * 比較分析を取得
 */
export async function getComparisonAnalysis(
  period: ComparisonPeriod = 'month',
  symbol?: string
): Promise<ComparisonResult> {
  const { start, end, label } = getPeriodDates(period);

  // 人間のTradeNoteを取得（バックテスト結果からPnLを参照）
  const humanNotesWhere: Prisma.TradeNoteWhereInput = {
    status: 'active',
    createdAt: { gte: start, lte: end },
    ...(symbol && { symbol }),
  };

  const humanNotes = await prisma.tradeNote.findMany({
    where: humanNotesWhere,
    include: {
      backtestRuns: {
        include: { result: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // AIのTradeNoteを取得
  const aiNotesWhere: Prisma.AITradeNoteWhereInput = {
    date: { gte: start, lte: end },
    ...(symbol && { symbol }),
  };

  const aiNotes = await prisma.aITradeNote.findMany({
    where: aiNotesWhere,
    orderBy: { date: 'desc' },
  });

  // 人間のトレードを統計用に変換（バックテスト結果があるものだけ）
  const humanTrades = humanNotes
    .filter(n => n.backtestRuns[0]?.result)
    .map(n => {
      const result = n.backtestRuns[0].result!;
      const pnlPips = result.averagePnL.toNumber();
      return {
        outcome: determineOutcome(pnlPips),
        pnlPips,
      };
    });

  // AIのトレードを統計用に変換
  const aiTrades = aiNotes.map(n => ({
    outcome: n.outcome as 'win' | 'loss' | 'breakeven',
    pnlPips: n.pnlPips.toNumber(),
  }));

  // 統計を計算
  const humanStats = calculateStats(humanTrades);
  const aiStats = calculateStats(aiTrades);

  // 一致率を計算（同日・同シンボルで同方向）
  let matchCount = 0;
  let compareCount = 0;

  for (const humanNote of humanNotes) {
    const humanDate = humanNote.createdAt.toISOString().split('T')[0];
    const humanSymbol = humanNote.symbol;
    const humanSide = humanNote.side;

    // 同日・同シンボルのAIノートを検索
    const matchingAiNotes = aiNotes.filter(ai => {
      const aiDate = ai.date.toISOString().split('T')[0];
      return aiDate === humanDate && ai.symbol === humanSymbol;
    });

    for (const aiNote of matchingAiNotes) {
      compareCount++;
      // 方向一致判定（buy=long, sell=short）
      const aiDirection = aiNote.direction;
      const humanDirection = humanSide === 'buy' ? 'long' : 'short';
      if (aiDirection === humanDirection) {
        matchCount++;
      }
    }
  }

  const alignmentRate = compareCount > 0 
    ? Math.round((matchCount / compareCount) * 100) 
    : 0;

  // 比較結果を計算
  const winRateDiff = humanStats.winRate - aiStats.winRate;
  const profitFactorDiff = 
    humanStats.profitFactor !== null && aiStats.profitFactor !== null
      ? humanStats.profitFactor - aiStats.profitFactor
      : null;
  const totalPnLDiff = humanStats.totalPnL - aiStats.totalPnL;

  // 勝者判定（勝率とPFの両方を考慮）
  let winner: 'human' | 'ai' | 'tie' = 'tie';
  if (winRateDiff > 5) winner = 'human';
  else if (winRateDiff < -5) winner = 'ai';
  else if (profitFactorDiff !== null) {
    if (profitFactorDiff > 0.2) winner = 'human';
    else if (profitFactorDiff < -0.2) winner = 'ai';
  }

  return {
    period: {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
      label,
    },
    human: humanStats,
    ai: aiStats,
    comparison: {
      winRateDiff: Math.round(winRateDiff * 10) / 10,
      profitFactorDiff: profitFactorDiff ? Math.round(profitFactorDiff * 100) / 100 : null,
      totalPnLDiff: Math.round(totalPnLDiff * 10) / 10,
      winner,
    },
    alignmentRate,
  };
}

/**
 * 時系列パフォーマンスデータを取得
 */
export async function getTimeSeriesData(
  period: ComparisonPeriod = 'month',
  symbol?: string,
  granularity: 'day' | 'week' = 'day'
): Promise<TimeSeriesData[]> {
  const { start, end } = getPeriodDates(period);

  // 人間のノートを取得
  const humanNotes = await prisma.tradeNote.findMany({
    where: {
      status: 'active',
      createdAt: { gte: start, lte: end },
      ...(symbol && { symbol }),
    },
    include: {
      backtestRuns: {
        include: { result: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  // AIのノートを取得
  const aiNotes = await prisma.aITradeNote.findMany({
    where: {
      date: { gte: start, lte: end },
      ...(symbol && { symbol }),
    },
    orderBy: { date: 'asc' },
  });

  // 日付ごとに集計
  const dateMap = new Map<string, {
    humanTrades: Array<{ outcome: string; pnlPips: number }>;
    aiTrades: Array<{ outcome: string; pnlPips: number }>;
  }>();

  // 人間のデータを集計
  for (const note of humanNotes) {
    const dateKey = note.createdAt.toISOString().split('T')[0];
    if (!dateMap.has(dateKey)) {
      dateMap.set(dateKey, { humanTrades: [], aiTrades: [] });
    }
    
    if (note.backtestRuns[0]?.result) {
      const pnlPips = note.backtestRuns[0].result.averagePnL.toNumber();
      dateMap.get(dateKey)!.humanTrades.push({
        outcome: determineOutcome(pnlPips),
        pnlPips,
      });
    }
  }

  // AIのデータを集計
  for (const note of aiNotes) {
    const dateKey = note.date.toISOString().split('T')[0];
    if (!dateMap.has(dateKey)) {
      dateMap.set(dateKey, { humanTrades: [], aiTrades: [] });
    }
    
    dateMap.get(dateKey)!.aiTrades.push({
      outcome: note.outcome,
      pnlPips: note.pnlPips.toNumber(),
    });
  }

  // 時系列データを作成
  const result: TimeSeriesData[] = [];
  const sortedDates = Array.from(dateMap.keys()).sort();

  for (const date of sortedDates) {
    const data = dateMap.get(date)!;
    
    const humanWins = data.humanTrades.filter(t => t.outcome === 'win').length;
    const humanTotal = data.humanTrades.length;
    const humanWinRate = humanTotal > 0 ? (humanWins / humanTotal) * 100 : 0;
    const humanPnL = data.humanTrades.reduce((sum, t) => sum + t.pnlPips, 0);

    const aiWins = data.aiTrades.filter(t => t.outcome === 'win').length;
    const aiTotal = data.aiTrades.length;
    const aiWinRate = aiTotal > 0 ? (aiWins / aiTotal) * 100 : 0;
    const aiPnL = data.aiTrades.reduce((sum, t) => sum + t.pnlPips, 0);

    result.push({
      date,
      humanWinRate: Math.round(humanWinRate * 10) / 10,
      aiWinRate: Math.round(aiWinRate * 10) / 10,
      humanPnL: Math.round(humanPnL * 10) / 10,
      aiPnL: Math.round(aiPnL * 10) / 10,
    });
  }

  return result;
}

/**
 * 比較ダッシュボード全体のデータを取得
 */
export async function getComparisonDashboard(
  period: ComparisonPeriod = 'month',
  symbol?: string
): Promise<ComparisonDashboardData> {
  // サマリーと時系列データを並列取得
  const [summary, timeSeries] = await Promise.all([
    getComparisonAnalysis(period, symbol),
    getTimeSeriesData(period, symbol),
  ]);

  // 最近のトレードを取得（各5件）
  const { start, end } = getPeriodDates(period);

  const humanNotes = await prisma.tradeNote.findMany({
    where: {
      status: 'active',
      createdAt: { gte: start, lte: end },
      ...(symbol && { symbol }),
    },
    include: {
      backtestRuns: {
        include: { result: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  const aiNotes = await prisma.aITradeNote.findMany({
    where: {
      date: { gte: start, lte: end },
      ...(symbol && { symbol }),
    },
    orderBy: { date: 'desc' },
    take: 5,
  });

  const recentHuman = humanNotes.map(n => {
    const result = n.backtestRuns[0]?.result;
    const pnlPips = result?.averagePnL?.toNumber() ?? null;
    return {
      id: n.id,
      date: n.createdAt.toISOString().split('T')[0],
      symbol: n.symbol,
      side: n.side,
      outcome: pnlPips !== null ? determineOutcome(pnlPips) : ('breakeven' as const),
      pnlPips,
    };
  });

  const recentAi = aiNotes.map(n => ({
    id: n.id,
    date: n.date.toISOString().split('T')[0],
    symbol: n.symbol,
    direction: n.direction,
    outcome: n.outcome as 'win' | 'loss' | 'breakeven',
    pnlPips: n.pnlPips.toNumber(),
  }));

  return {
    summary,
    timeSeries,
    recentTrades: {
      human: recentHuman,
      ai: recentAi,
    },
  };
}
