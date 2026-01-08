/**
 * ストラテジー横断分析サービス
 * 
 * 目的:
 * - 複数ストラテジーのパフォーマンス比較
 * - ストラテジー間の相関分析
 * - ポートフォリオ最適化シミュレーション
 * 
 * 参照: docs/phase-next/strategy-comparison-analysis.md
 */

import { PrismaClient, OptimizationMethod } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// 型定義
// ============================================

/** 比較セッション作成リクエスト */
export interface CreateComparisonRequest {
  /** セッション名 */
  name: string;
  /** 比較対象ストラテジーID（2〜10個） */
  strategyIds: string[];
  /** 分析期間開始日（YYYY-MM-DD） */
  startDate: string;
  /** 分析期間終了日（YYYY-MM-DD） */
  endDate: string;
  /** 時間足（デフォルト: 1h） */
  timeframe?: string;
}

/** ストラテジー別パフォーマンス結果 */
export interface StrategyPerformance {
  strategyId: string;
  strategyName: string;
  symbol: string;
  side: 'buy' | 'sell';
  totalTrades: number;
  winRate: number;
  profitFactor: number | null;
  netProfit: number;
  maxDrawdown: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  dailyReturns: number[];
  equityCurve: { date: string; equity: number }[];
}

/** 相関マトリクス */
export interface CorrelationMatrix {
  strategyIds: string[];
  strategyNames: string[];
  pearson: number[][];
  spearman: number[][];
  coWinRate: number[][];
  coLossRate: number[][];
}

/** 比較サマリー */
export interface ComparisonSummary {
  bestWinRate: { strategyId: string; strategyName: string; value: number };
  bestProfitFactor: { strategyId: string; strategyName: string; value: number };
  lowestDrawdown: { strategyId: string; strategyName: string; value: number };
  bestSharpe: { strategyId: string; strategyName: string; value: number };
  recommendations: string[];
}

/** 比較セッションレスポンス */
export interface ComparisonSessionResponse {
  id: string;
  name: string;
  strategyIds: string[];
  startDate: string;
  endDate: string;
  timeframe: string;
  results: StrategyPerformance[];
  correlations: CorrelationMatrix;
  summary: ComparisonSummary;
  createdAt: string;
}

/** 最適化リクエスト */
export interface OptimizeRequest {
  method: OptimizationMethod;
  /** リスクフリーレート（年率、デフォルト: 0） */
  riskFreeRate?: number;
}

/** 最適化レスポンス */
export interface OptimizationResponse {
  method: OptimizationMethod;
  weights: { strategyId: string; strategyName: string; weight: number }[];
  expectedReturn: number;
  expectedRisk: number;
  sharpeRatio: number | null;
  efficientFrontier: { risk: number; return: number }[] | null;
}

// ============================================
// 統計計算ユーティリティ
// ============================================

/**
 * 平均値を計算
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * 標準偏差を計算
 */
function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const squareDiffs = values.map(v => Math.pow(v - avg, 2));
  return Math.sqrt(mean(squareDiffs));
}

/**
 * シャープレシオを計算
 * 
 * @param dailyReturns - 日次リターン配列（%）
 * @param riskFreeRate - 年率リスクフリーレート（デフォルト: 0）
 * @returns 年率換算シャープレシオ
 */
export function calculateSharpeRatio(
  dailyReturns: number[],
  riskFreeRate: number = 0
): number | null {
  if (dailyReturns.length < 2) return null;
  
  const avgReturn = mean(dailyReturns);
  const stdDev = standardDeviation(dailyReturns);
  
  if (stdDev === 0) return null;
  
  // 年率換算（252取引日）
  const annualizedReturn = avgReturn * 252;
  const annualizedStdDev = stdDev * Math.sqrt(252);
  
  return (annualizedReturn - riskFreeRate) / annualizedStdDev;
}

/**
 * ソルティノレシオを計算
 * 下方リスク（負のリターン）のみを考慮
 */
export function calculateSortinoRatio(
  dailyReturns: number[],
  riskFreeRate: number = 0
): number | null {
  if (dailyReturns.length < 2) return null;
  
  const avgReturn = mean(dailyReturns);
  const negativeReturns = dailyReturns.filter(r => r < 0);
  
  if (negativeReturns.length === 0) return null; // 負のリターンがない場合
  
  const downsideDeviation = standardDeviation(negativeReturns);
  
  if (downsideDeviation === 0) return null;
  
  const annualizedReturn = avgReturn * 252;
  const annualizedDownside = downsideDeviation * Math.sqrt(252);
  
  return (annualizedReturn - riskFreeRate) / annualizedDownside;
}

/**
 * カルマーレシオを計算
 * 年間リターン / 最大ドローダウン
 */
export function calculateCalmarRatio(
  dailyReturns: number[],
  maxDrawdown: number
): number | null {
  if (dailyReturns.length === 0 || maxDrawdown === 0) return null;
  
  const totalReturn = dailyReturns.reduce((a, b) => a + b, 0);
  const annualizedReturn = totalReturn * (252 / dailyReturns.length);
  
  return annualizedReturn / Math.abs(maxDrawdown);
}

/**
 * ピアソン相関係数を計算
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  
  const n = x.length;
  const meanX = mean(x);
  const meanY = mean(y);
  
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  
  const denominator = Math.sqrt(denomX * denomY);
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * スピアマン順位相関係数を計算
 */
export function spearmanCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  
  // 順位に変換
  const rankX = toRanks(x);
  const rankY = toRanks(y);
  
  // ピアソン相関を順位に適用
  return pearsonCorrelation(rankX, rankY);
}

/**
 * 配列を順位に変換
 */
function toRanks(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ value: v, index: i }));
  indexed.sort((a, b) => a.value - b.value);
  
  const ranks = new Array(values.length);
  for (let i = 0; i < indexed.length; i++) {
    ranks[indexed[i].index] = i + 1;
  }
  return ranks;
}

/**
 * 共分散行列を計算
 */
export function calculateCovarianceMatrix(returns: number[][]): number[][] {
  const n = returns.length;
  const matrix: number[][] = [];
  
  for (let i = 0; i < n; i++) {
    matrix[i] = [];
    for (let j = 0; j < n; j++) {
      matrix[i][j] = calculateCovariance(returns[i], returns[j]);
    }
  }
  
  return matrix;
}

/**
 * 共分散を計算
 */
function calculateCovariance(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  
  const meanX = mean(x);
  const meanY = mean(y);
  
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += (x[i] - meanX) * (y[i] - meanY);
  }
  
  return sum / (x.length - 1);
}

// ============================================
// ポートフォリオ最適化
// ============================================

/**
 * 等ウェイト配分
 */
function equalWeightOptimization(n: number): number[] {
  return new Array(n).fill(1 / n);
}

/**
 * リスクパリティ最適化
 * 各ストラテジーのリスク寄与度を均等化
 */
function riskParityOptimization(covarianceMatrix: number[][]): number[] {
  const n = covarianceMatrix.length;
  
  // 逆分散ウェイト（簡易版）
  const variances = covarianceMatrix.map((row, i) => row[i]);
  const invVar = variances.map(v => v > 0 ? 1 / Math.sqrt(v) : 0);
  const sum = invVar.reduce((a, b) => a + b, 0);
  
  if (sum === 0) return equalWeightOptimization(n);
  
  return invVar.map(w => w / sum);
}

/**
 * 最小分散ポートフォリオ
 * グリッドサーチによる簡易実装
 */
function minimumVarianceOptimization(covarianceMatrix: number[][]): number[] {
  const n = covarianceMatrix.length;
  
  if (n === 1) return [1];
  if (n === 2) {
    // 2資産の場合の解析解
    const var1 = covarianceMatrix[0][0];
    const var2 = covarianceMatrix[1][1];
    const cov = covarianceMatrix[0][1];
    
    const w1 = (var2 - cov) / (var1 + var2 - 2 * cov);
    const w1Clamped = Math.max(0, Math.min(1, w1));
    return [w1Clamped, 1 - w1Clamped];
  }
  
  // 3資産以上はグリッドサーチ
  return gridSearchOptimization(
    covarianceMatrix,
    new Array(n).fill(0), // ダミーのリターン（最小分散では使用しない）
    'min_variance'
  );
}

/**
 * 最大シャープレシオポートフォリオ
 */
function maxSharpeOptimization(
  expectedReturns: number[],
  covarianceMatrix: number[][],
  riskFreeRate: number = 0
): number[] {
  return gridSearchOptimization(
    covarianceMatrix,
    expectedReturns,
    'max_sharpe',
    riskFreeRate
  );
}

/**
 * グリッドサーチによる最適化
 */
function gridSearchOptimization(
  covarianceMatrix: number[][],
  expectedReturns: number[],
  objective: 'min_variance' | 'max_sharpe',
  riskFreeRate: number = 0
): number[] {
  const n = covarianceMatrix.length;
  const step = 0.05; // 5%刻み
  
  let bestWeights = equalWeightOptimization(n);
  let bestObjective = objective === 'min_variance' ? Infinity : -Infinity;
  
  // ウェイトの組み合わせを生成
  const combinations = generateWeightCombinations(n, step);
  
  for (const weights of combinations) {
    const variance = calculatePortfolioVariance(weights, covarianceMatrix);
    
    if (objective === 'min_variance') {
      if (variance < bestObjective) {
        bestObjective = variance;
        bestWeights = weights;
      }
    } else {
      const portfolioReturn = dotProduct(weights, expectedReturns);
      const stdDev = Math.sqrt(variance);
      const sharpe = stdDev > 0 ? (portfolioReturn - riskFreeRate) / stdDev : 0;
      
      if (sharpe > bestObjective) {
        bestObjective = sharpe;
        bestWeights = weights;
      }
    }
  }
  
  return bestWeights;
}

/**
 * ウェイトの組み合わせを生成（合計=1、各>=0）
 */
function generateWeightCombinations(n: number, step: number): number[][] {
  const combinations: number[][] = [];
  const steps = Math.round(1 / step);
  
  function generate(remaining: number, current: number[], depth: number): void {
    if (depth === n - 1) {
      combinations.push([...current, remaining / steps]);
      return;
    }
    
    for (let i = 0; i <= remaining; i++) {
      generate(remaining - i, [...current, i / steps], depth + 1);
    }
  }
  
  generate(steps, [], 0);
  return combinations;
}

/**
 * ポートフォリオ分散を計算
 */
function calculatePortfolioVariance(
  weights: number[],
  covarianceMatrix: number[][]
): number {
  let variance = 0;
  const n = weights.length;
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      variance += weights[i] * weights[j] * covarianceMatrix[i][j];
    }
  }
  
  return variance;
}

/**
 * 内積を計算
 */
function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

/**
 * 効率的フロンティアを計算
 */
function calculateEfficientFrontier(
  expectedReturns: number[],
  covarianceMatrix: number[],
  points: number = 20
): { risk: number; return: number }[] {
  // 簡易実装: 最小分散から最大リターンまでの点を計算
  const minReturn = Math.min(...expectedReturns);
  const maxReturn = Math.max(...expectedReturns);
  
  const frontier: { risk: number; return: number }[] = [];
  
  for (let i = 0; i <= points; i++) {
    const targetReturn = minReturn + (maxReturn - minReturn) * (i / points);
    // 各ターゲットリターンに対する最小リスクを計算（簡易版）
    const risk = Math.sqrt(targetReturn * 0.1); // 仮の計算
    frontier.push({ risk, return: targetReturn });
  }
  
  return frontier;
}

// ============================================
// メインサービス関数
// ============================================

/**
 * 比較セッションを作成し分析を実行
 */
export async function createComparisonSession(
  request: CreateComparisonRequest
): Promise<ComparisonSessionResponse> {
  const { name, strategyIds, startDate, endDate, timeframe = '1h' } = request;
  
  // バリデーション
  if (strategyIds.length < 2) {
    throw new Error('比較には最低2つのストラテジーが必要です');
  }
  if (strategyIds.length > 10) {
    throw new Error('比較できるストラテジーは最大10個です');
  }
  
  // ストラテジー存在確認
  const strategies = await prisma.strategy.findMany({
    where: { id: { in: strategyIds } },
    include: {
      backtestRuns: {
        where: {
          status: 'completed',
          source: 'manual',
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          result: true,
          events: true,
        },
      },
    },
  });
  
  if (strategies.length !== strategyIds.length) {
    const foundIds = strategies.map(s => s.id);
    const missingIds = strategyIds.filter(id => !foundIds.includes(id));
    throw new Error(`ストラテジーが見つかりません: ${missingIds.join(', ')}`);
  }
  
  // セッション作成
  const session = await prisma.strategyComparisonSession.create({
    data: {
      name,
      strategyIds,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      timeframe,
    },
  });
  
  // 各ストラテジーのパフォーマンスを計算
  const results: StrategyPerformance[] = [];
  const allDailyReturns: number[][] = [];
  
  for (const strategy of strategies) {
    const backtestRun = strategy.backtestRuns[0];
    const result = backtestRun?.result;
    const events = backtestRun?.events || [];
    
    // 日次リターンを計算
    const dailyReturns = calculateDailyReturns(events);
    allDailyReturns.push(dailyReturns);
    
    // エクイティカーブを計算
    const equityCurve = calculateEquityCurve(events);
    
    // 最大ドローダウンを計算
    const maxDrawdown = calculateMaxDrawdown(equityCurve);
    
    const performance: StrategyPerformance = {
      strategyId: strategy.id,
      strategyName: strategy.name,
      symbol: strategy.symbol,
      side: strategy.side as 'buy' | 'sell',
      totalTrades: result?.setupCount || events.length,
      winRate: result?.winRate || 0,
      profitFactor: result?.profitFactor || null,
      netProfit: Number(result?.totalProfit || 0) - Number(result?.totalLoss || 0),
      maxDrawdown,
      sharpeRatio: calculateSharpeRatio(dailyReturns),
      sortinoRatio: calculateSortinoRatio(dailyReturns),
      calmarRatio: calculateCalmarRatio(dailyReturns, maxDrawdown),
      dailyReturns,
      equityCurve,
    };
    
    results.push(performance);
    
    // 結果をDBに保存
    await prisma.strategyComparisonResult.create({
      data: {
        sessionId: session.id,
        strategyId: strategy.id,
        totalTrades: performance.totalTrades,
        winRate: performance.winRate,
        profitFactor: performance.profitFactor,
        netProfit: performance.netProfit,
        maxDrawdown: performance.maxDrawdown,
        sharpeRatio: performance.sharpeRatio,
        sortinoRatio: performance.sortinoRatio,
        calmarRatio: performance.calmarRatio,
        dailyReturns: dailyReturns,
        equityCurve: equityCurve,
      },
    });
  }
  
  // 相関マトリクスを計算
  const correlations = calculateCorrelationMatrix(
    strategyIds,
    strategies.map(s => s.name),
    allDailyReturns
  );
  
  // 相関をDBに保存
  for (let i = 0; i < strategyIds.length; i++) {
    for (let j = i + 1; j < strategyIds.length; j++) {
      await prisma.strategyCorrelation.create({
        data: {
          sessionId: session.id,
          strategyAId: strategyIds[i],
          strategyBId: strategyIds[j],
          pearsonCorr: correlations.pearson[i][j],
          spearmanCorr: correlations.spearman[i][j],
          coWinRate: correlations.coWinRate[i][j],
          coLossRate: correlations.coLossRate[i][j],
        },
      });
    }
  }
  
  // サマリーを生成
  const summary = generateComparisonSummary(results, correlations);
  
  return {
    id: session.id,
    name: session.name,
    strategyIds,
    startDate,
    endDate,
    timeframe,
    results,
    correlations,
    summary,
    createdAt: session.createdAt.toISOString(),
  };
}

/**
 * 日次リターンを計算
 */
function calculateDailyReturns(
  events: { entryTime: Date; pnl: unknown }[]
): number[] {
  if (events.length === 0) return [];
  
  // 日付でグループ化
  const dailyPnL = new Map<string, number>();
  
  for (const event of events) {
    const date = event.entryTime.toISOString().split('T')[0];
    const pnl = Number(event.pnl) || 0;
    dailyPnL.set(date, (dailyPnL.get(date) || 0) + pnl);
  }
  
  // 日付順にソート
  const sortedDates = [...dailyPnL.keys()].sort();
  return sortedDates.map(date => dailyPnL.get(date) || 0);
}

/**
 * エクイティカーブを計算
 */
function calculateEquityCurve(
  events: { entryTime: Date; pnl: unknown }[]
): { date: string; equity: number }[] {
  if (events.length === 0) return [];
  
  // 日付でグループ化して累積
  const dailyPnL = new Map<string, number>();
  
  for (const event of events) {
    const date = event.entryTime.toISOString().split('T')[0];
    const pnl = Number(event.pnl) || 0;
    dailyPnL.set(date, (dailyPnL.get(date) || 0) + pnl);
  }
  
  const sortedDates = [...dailyPnL.keys()].sort();
  let cumulative = 0;
  
  return sortedDates.map(date => {
    cumulative += dailyPnL.get(date) || 0;
    return { date, equity: cumulative };
  });
}

/**
 * 最大ドローダウンを計算
 */
function calculateMaxDrawdown(
  equityCurve: { date: string; equity: number }[]
): number {
  if (equityCurve.length === 0) return 0;
  
  let peak = equityCurve[0].equity;
  let maxDD = 0;
  
  for (const point of equityCurve) {
    if (point.equity > peak) {
      peak = point.equity;
    }
    const dd = peak - point.equity;
    if (dd > maxDD) {
      maxDD = dd;
    }
  }
  
  return maxDD;
}

/**
 * 相関マトリクスを計算
 */
function calculateCorrelationMatrix(
  strategyIds: string[],
  strategyNames: string[],
  allDailyReturns: number[][]
): CorrelationMatrix {
  const n = strategyIds.length;
  
  const pearson: number[][] = [];
  const spearman: number[][] = [];
  const coWinRate: number[][] = [];
  const coLossRate: number[][] = [];
  
  for (let i = 0; i < n; i++) {
    pearson[i] = [];
    spearman[i] = [];
    coWinRate[i] = [];
    coLossRate[i] = [];
    
    for (let j = 0; j < n; j++) {
      if (i === j) {
        pearson[i][j] = 1;
        spearman[i][j] = 1;
        coWinRate[i][j] = 1;
        coLossRate[i][j] = 1;
      } else {
        pearson[i][j] = pearsonCorrelation(allDailyReturns[i], allDailyReturns[j]);
        spearman[i][j] = spearmanCorrelation(allDailyReturns[i], allDailyReturns[j]);
        
        // 同時勝敗率を計算
        const { coWin, coLoss } = calculateCoWinLoss(
          allDailyReturns[i],
          allDailyReturns[j]
        );
        coWinRate[i][j] = coWin;
        coLossRate[i][j] = coLoss;
      }
    }
  }
  
  return {
    strategyIds,
    strategyNames,
    pearson,
    spearman,
    coWinRate,
    coLossRate,
  };
}

/**
 * 同時勝敗率を計算
 */
function calculateCoWinLoss(
  returnsA: number[],
  returnsB: number[]
): { coWin: number; coLoss: number } {
  const minLen = Math.min(returnsA.length, returnsB.length);
  if (minLen === 0) return { coWin: 0, coLoss: 0 };
  
  let coWins = 0;
  let coLosses = 0;
  
  for (let i = 0; i < minLen; i++) {
    if (returnsA[i] > 0 && returnsB[i] > 0) coWins++;
    if (returnsA[i] < 0 && returnsB[i] < 0) coLosses++;
  }
  
  return {
    coWin: coWins / minLen,
    coLoss: coLosses / minLen,
  };
}

/**
 * 比較サマリーを生成
 */
function generateComparisonSummary(
  results: StrategyPerformance[],
  correlations: CorrelationMatrix
): ComparisonSummary {
  // ベスト指標を抽出
  const bestWinRate = results.reduce((best, r) =>
    r.winRate > best.winRate ? r : best
  );
  
  const bestPF = results.reduce((best, r) =>
    (r.profitFactor || 0) > (best.profitFactor || 0) ? r : best
  );
  
  const lowestDD = results.reduce((best, r) =>
    r.maxDrawdown < best.maxDrawdown ? r : best
  );
  
  const bestSharpe = results.reduce((best, r) =>
    (r.sharpeRatio || -Infinity) > (best.sharpeRatio || -Infinity) ? r : best
  );
  
  // レコメンデーション生成
  const recommendations: string[] = [];
  
  // 低相関ペアを推奨
  for (let i = 0; i < correlations.strategyIds.length; i++) {
    for (let j = i + 1; j < correlations.strategyIds.length; j++) {
      if (correlations.pearson[i][j] < 0.3) {
        recommendations.push(
          `${correlations.strategyNames[i]} と ${correlations.strategyNames[j]} は低相関（${correlations.pearson[i][j].toFixed(2)}）のため、分散効果が期待できます`
        );
      }
    }
  }
  
  // 高パフォーマンス戦略を推奨
  if (bestSharpe.sharpeRatio && bestSharpe.sharpeRatio > 1.5) {
    recommendations.push(
      `${bestSharpe.strategyName} はシャープレシオ ${bestSharpe.sharpeRatio.toFixed(2)} と優秀です`
    );
  }
  
  return {
    bestWinRate: {
      strategyId: bestWinRate.strategyId,
      strategyName: bestWinRate.strategyName,
      value: bestWinRate.winRate,
    },
    bestProfitFactor: {
      strategyId: bestPF.strategyId,
      strategyName: bestPF.strategyName,
      value: bestPF.profitFactor || 0,
    },
    lowestDrawdown: {
      strategyId: lowestDD.strategyId,
      strategyName: lowestDD.strategyName,
      value: lowestDD.maxDrawdown,
    },
    bestSharpe: {
      strategyId: bestSharpe.strategyId,
      strategyName: bestSharpe.strategyName,
      value: bestSharpe.sharpeRatio || 0,
    },
    recommendations,
  };
}

/**
 * ポートフォリオ最適化を実行
 */
export async function runPortfolioOptimization(
  sessionId: string,
  request: OptimizeRequest
): Promise<OptimizationResponse> {
  const { method, riskFreeRate = 0 } = request;
  
  // セッションと結果を取得
  const session = await prisma.strategyComparisonSession.findUnique({
    where: { id: sessionId },
    include: {
      results: {
        include: {
          // ストラテジー名を取得するため
        },
      },
    },
  });
  
  if (!session) {
    throw new Error('セッションが見つかりません');
  }
  
  // 日次リターンを取得
  const allDailyReturns: number[][] = session.results.map(
    r => (r.dailyReturns as number[]) || []
  );
  
  // ストラテジー情報を取得
  const strategies = await prisma.strategy.findMany({
    where: { id: { in: session.strategyIds } },
  });
  
  const strategyMap = new Map(strategies.map(s => [s.id, s.name]));
  
  // 期待リターン（年率）
  const expectedReturns = allDailyReturns.map(returns => {
    const avg = mean(returns);
    return avg * 252; // 年率換算
  });
  
  // 共分散行列
  const covarianceMatrix = calculateCovarianceMatrix(allDailyReturns);
  
  // 最適化実行
  let weights: number[];
  
  switch (method) {
    case 'equal_weight':
      weights = equalWeightOptimization(session.strategyIds.length);
      break;
    case 'risk_parity':
      weights = riskParityOptimization(covarianceMatrix);
      break;
    case 'minimum_variance':
      weights = minimumVarianceOptimization(covarianceMatrix);
      break;
    case 'max_sharpe':
      weights = maxSharpeOptimization(expectedReturns, covarianceMatrix, riskFreeRate);
      break;
    case 'mean_variance':
    default:
      weights = maxSharpeOptimization(expectedReturns, covarianceMatrix, riskFreeRate);
      break;
  }
  
  // ポートフォリオ統計を計算
  const portfolioReturn = dotProduct(weights, expectedReturns);
  const portfolioVariance = calculatePortfolioVariance(weights, covarianceMatrix);
  const portfolioRisk = Math.sqrt(portfolioVariance) * Math.sqrt(252); // 年率換算
  const portfolioSharpe = portfolioRisk > 0
    ? (portfolioReturn - riskFreeRate) / portfolioRisk
    : null;
  
  // 結果をDBに保存
  const optimization = await prisma.portfolioOptimization.create({
    data: {
      sessionId,
      method,
      weights: session.strategyIds.map((id, i) => ({
        strategyId: id,
        weight: weights[i],
      })),
      expectedReturn: portfolioReturn,
      expectedRisk: portfolioRisk,
      sharpeRatio: portfolioSharpe,
    },
  });
  
  return {
    method,
    weights: session.strategyIds.map((id, i) => ({
      strategyId: id,
      strategyName: strategyMap.get(id) || id,
      weight: weights[i],
    })),
    expectedReturn: portfolioReturn,
    expectedRisk: portfolioRisk,
    sharpeRatio: portfolioSharpe,
    efficientFrontier: null, // 将来実装
  };
}

/**
 * 比較セッション一覧を取得
 */
export async function getComparisonSessions(
  limit: number = 20,
  offset: number = 0
): Promise<{ sessions: ComparisonSessionResponse[]; total: number }> {
  const [sessions, total] = await Promise.all([
    prisma.strategyComparisonSession.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        results: true,
        correlations: true,
        optimizations: true,
      },
    }),
    prisma.strategyComparisonSession.count(),
  ]);
  
  // ストラテジー名を取得
  const allStrategyIds = [...new Set(sessions.flatMap(s => s.strategyIds))];
  const strategies = await prisma.strategy.findMany({
    where: { id: { in: allStrategyIds } },
  });
  const strategyMap = new Map(strategies.map(s => [s.id, s]));
  
  const formattedSessions = sessions.map(session => {
    const results: StrategyPerformance[] = session.results.map(r => {
      const strategy = strategyMap.get(r.strategyId);
      return {
        strategyId: r.strategyId,
        strategyName: strategy?.name || r.strategyId,
        symbol: strategy?.symbol || '',
        side: (strategy?.side || 'buy') as 'buy' | 'sell',
        totalTrades: r.totalTrades,
        winRate: r.winRate,
        profitFactor: r.profitFactor,
        netProfit: Number(r.netProfit),
        maxDrawdown: Number(r.maxDrawdown),
        sharpeRatio: r.sharpeRatio,
        sortinoRatio: r.sortinoRatio,
        calmarRatio: r.calmarRatio,
        dailyReturns: (r.dailyReturns as number[]) || [],
        equityCurve: (r.equityCurve as { date: string; equity: number }[]) || [],
      };
    });
    
    // 相関マトリクスを再構築
    const n = session.strategyIds.length;
    const pearson: number[][] = Array(n).fill(null).map(() => Array(n).fill(1));
    const spearman: number[][] = Array(n).fill(null).map(() => Array(n).fill(1));
    const coWinRate: number[][] = Array(n).fill(null).map(() => Array(n).fill(1));
    const coLossRate: number[][] = Array(n).fill(null).map(() => Array(n).fill(1));
    
    for (const corr of session.correlations) {
      const i = session.strategyIds.indexOf(corr.strategyAId);
      const j = session.strategyIds.indexOf(corr.strategyBId);
      if (i >= 0 && j >= 0) {
        pearson[i][j] = corr.pearsonCorr;
        pearson[j][i] = corr.pearsonCorr;
        spearman[i][j] = corr.spearmanCorr || 0;
        spearman[j][i] = corr.spearmanCorr || 0;
        coWinRate[i][j] = corr.coWinRate || 0;
        coWinRate[j][i] = corr.coWinRate || 0;
        coLossRate[i][j] = corr.coLossRate || 0;
        coLossRate[j][i] = corr.coLossRate || 0;
      }
    }
    
    const correlations: CorrelationMatrix = {
      strategyIds: session.strategyIds,
      strategyNames: session.strategyIds.map(id => strategyMap.get(id)?.name || id),
      pearson,
      spearman,
      coWinRate,
      coLossRate,
    };
    
    const summary = generateComparisonSummary(results, correlations);
    
    return {
      id: session.id,
      name: session.name,
      strategyIds: session.strategyIds,
      startDate: session.startDate.toISOString().split('T')[0],
      endDate: session.endDate.toISOString().split('T')[0],
      timeframe: session.timeframe,
      results,
      correlations,
      summary,
      createdAt: session.createdAt.toISOString(),
    };
  });
  
  return { sessions: formattedSessions, total };
}

/**
 * 比較セッションを取得
 */
export async function getComparisonSession(
  sessionId: string
): Promise<ComparisonSessionResponse | null> {
  const result = await getComparisonSessions(1, 0);
  
  // 指定IDのセッションを検索
  const session = await prisma.strategyComparisonSession.findUnique({
    where: { id: sessionId },
    include: {
      results: true,
      correlations: true,
      optimizations: true,
    },
  });
  
  if (!session) return null;
  
  // 単一セッション用に再フォーマット
  const { sessions } = await getComparisonSessions(100, 0);
  return sessions.find(s => s.id === sessionId) || null;
}

/**
 * 比較セッションを削除
 */
export async function deleteComparisonSession(sessionId: string): Promise<void> {
  await prisma.strategyComparisonSession.delete({
    where: { id: sessionId },
  });
}

