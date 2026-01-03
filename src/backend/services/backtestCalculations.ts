/**
 * バックテスト計算ユーティリティ
 * 
 * 目的:
 * - 損益計算、パフォーマンスサマリー計算などの純粋関数を提供
 * - 外部依存なしでテスト可能な形で分離
 */

// ============================================
// 型定義
// ============================================

/** 売買方向 */
export type TradeSide = 'buy' | 'sell';

/** バックテストトレードイベント */
export interface BacktestTradeEvent {
  eventId: string;
  entryTime: string;
  entryPrice: number;
  exitTime: string;
  exitPrice: number;
  side: TradeSide;
  /** ロット数（通貨量）例: 10000 = 1万通貨 */
  lotSize: number;
  pnl: number;
  pnlPercent: number;
  exitReason: 'take_profit' | 'stop_loss' | 'timeout' | 'signal';
  indicatorValues?: Record<string, number>;
}

/** バックテスト結果サマリー */
export interface BacktestResultSummary {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  netProfit: number;
  netProfitRate: number;
  maxDrawdown: number;
  maxDrawdownRate: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  riskRewardRatio: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  /** シャープレシオ（年率換算） */
  sharpeRatio?: number;
  /** ソルティノレシオ（下方リスクのみ考慮） */
  sortinoRatio?: number;
  /** t検定によるp値（帰無仮説: 平均リターン = 0） */
  pValue?: number;
  /** 統計的有意性（p < 0.05） */
  isStatisticallySignificant?: boolean;
  /** 信頼度レベル（トレード数ベース） */
  confidenceLevel?: 'low' | 'medium' | 'high';
  /** 停止理由（破産など） */
  stoppedReason?: 'bankruptcy' | 'completed';
  /** 最終資金残高 */
  finalCapital?: number;
}

// ============================================
// 計算関数
// ============================================

/**
 * 損益を計算
 * 
 * @param side - 売買方向（'buy' または 'sell'）
 * @param entryPrice - エントリー価格
 * @param exitPrice - 決済価格
 * @param lotSize - ロット数（通貨量）例: 10000 = 1万通貨
 * @returns 損益金額
 */
export function calculatePnl(
  side: TradeSide,
  entryPrice: number,
  exitPrice: number,
  lotSize: number
): number {
  if (side === 'buy') {
    // 買いトレード: 決済価格 - エントリー価格
    return (exitPrice - entryPrice) * lotSize;
  } else {
    // 売りトレード: エントリー価格 - 決済価格
    return (entryPrice - exitPrice) * lotSize;
  }
}

/**
 * パフォーマンスサマリーを計算
 * 
 * @param trades - バックテストトレードイベント配列
 * @param initialCapital - 初期資金
 * @returns サマリー統計
 */
export function calculateSummary(
  trades: BacktestTradeEvent[],
  initialCapital: number
): BacktestResultSummary {
  if (trades.length === 0) {
    return createEmptySummary();
  }
  
  // 勝ちトレードと負けトレードを分類
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl < 0);
  
  // 総損益、総利益、総損失を計算
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
  
  // 最大ドローダウン計算
  let peak = initialCapital;
  let maxDrawdown = 0;
  let currentCapital = initialCapital;
  
  for (const trade of trades) {
    currentCapital += trade.pnl;
    if (currentCapital > peak) {
      peak = currentCapital;
    }
    const drawdown = peak - currentCapital;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  
  // 連勝・連敗計算
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let currentWins = 0;
  let currentLosses = 0;
  
  for (const trade of trades) {
    if (trade.pnl > 0) {
      currentWins++;
      currentLosses = 0;
      maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWins);
    } else {
      currentLosses++;
      currentWins = 0;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLosses);
    }
  }
  
  // 平均勝ち/負けは金額ベースで計算
  const avgWinAmount = winningTrades.length > 0 ? grossProfit / winningTrades.length : 0;
  const avgLossAmount = losingTrades.length > 0 ? grossLoss / losingTrades.length : 0;
  
  // === 統計的指標の計算 ===
  const returns = trades.map(t => t.pnlPercent);
  const statisticalMetrics = calculateStatisticalMetrics(returns, trades.length);
  
  return {
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    // 勝率: 0〜1の小数（フロントエンドで*100して%表示）
    winRate: winningTrades.length / trades.length,
    netProfit: totalPnl,
    // 利益率: 0〜1の小数（フロントエンドで*100して%表示）
    netProfitRate: totalPnl / initialCapital,
    maxDrawdown,
    // ドローダウン率: 0〜1の小数（フロントエンドで*100して%表示）
    maxDrawdownRate: maxDrawdown / initialCapital,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    // 平均勝ち金額（初期資金に対する比率ではなく、絶対金額）
    averageWin: avgWinAmount,
    // 平均負け金額（絶対値）
    averageLoss: avgLossAmount,
    riskRewardRatio: grossLoss > 0 && losingTrades.length > 0 && winningTrades.length > 0
      ? (grossProfit / winningTrades.length) / (grossLoss / losingTrades.length)
      : 0,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    // 統計的指標
    ...statisticalMetrics,
  };
}

/**
 * 統計的指標を計算
 * 
 * @param returns - 各トレードのリターン（%）配列
 * @param tradeCount - トレード数
 * @returns 統計的指標オブジェクト
 */
function calculateStatisticalMetrics(returns: number[], tradeCount: number): {
  sharpeRatio?: number;
  sortinoRatio?: number;
  pValue?: number;
  isStatisticallySignificant?: boolean;
  confidenceLevel?: 'low' | 'medium' | 'high';
} {
  if (tradeCount < 2) {
    return {
      confidenceLevel: 'low',
    };
  }
  
  // 平均リターン
  const avgReturn = returns.reduce((a, b) => a + b, 0) / tradeCount;
  
  // 標準偏差
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (tradeCount - 1);
  const stdDev = Math.sqrt(variance);
  
  // 下方偏差（ソルティノレシオ用、負のリターンのみ）
  const negativeReturns = returns.filter(r => r < 0);
  const downVariance = negativeReturns.length > 0
    ? negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length
    : 0;
  const downStdDev = Math.sqrt(downVariance);
  
  // シャープレシオ（年率換算、リスクフリーレート0と仮定）
  // 1日あたり約1トレードと仮定し、年間252営業日で換算
  const annualizationFactor = Math.sqrt(252);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * annualizationFactor : undefined;
  
  // ソルティノレシオ（下方リスクのみ考慮）
  const sortinoRatio = downStdDev > 0 ? (avgReturn / downStdDev) * annualizationFactor : undefined;
  
  // t検定（帰無仮説: 平均リターン = 0）
  const tStat = stdDev > 0 ? (avgReturn / (stdDev / Math.sqrt(tradeCount))) : 0;
  const pValue = calculatePValue(tStat, tradeCount - 1);
  
  // 統計的有意性（p < 0.05）
  const isStatisticallySignificant = pValue !== undefined ? pValue < 0.05 : undefined;
  
  // 信頼度レベル（トレード数ベース）
  // 30件以上: high、10-29件: medium、10件未満: low
  const confidenceLevel: 'low' | 'medium' | 'high' = 
    tradeCount >= 30 ? 'high' : tradeCount >= 10 ? 'medium' : 'low';
  
  return {
    sharpeRatio,
    sortinoRatio,
    pValue,
    isStatisticallySignificant,
    confidenceLevel,
  };
}

/**
 * t分布からp値を近似計算（両側検定）
 * 
 * @param tStat - t統計量
 * @param df - 自由度
 * @returns p値
 */
function calculatePValue(tStat: number, df: number): number {
  // t分布のp値を近似計算
  // 正規分布近似（df >= 30）または近似式を使用
  const absTStat = Math.abs(tStat);
  
  if (df < 1) return 1;
  
  // 大きい自由度では正規分布で近似
  if (df >= 30) {
    // 標準正規分布のCDF近似
    const z = absTStat;
    const p = normalCDF(z);
    return 2 * (1 - p); // 両側検定
  }
  
  // 小さい自由度ではBeta関数を使った近似
  // 簡易的なt分布CDF近似
  const x = df / (df + tStat * tStat);
  const beta = incompleteBeta(df / 2, 0.5, x);
  return beta; // 両側検定のp値
}

/**
 * 標準正規分布のCDF近似（Abramowitz and Stegun近似）
 */
function normalCDF(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);
  
  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  
  return 0.5 * (1.0 + sign * y);
}

/**
 * 不完全ベータ関数の近似（t分布のCDF計算用）
 */
function incompleteBeta(a: number, b: number, x: number): number {
  // 簡易近似（連分数展開）
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  
  // 数値計算による近似
  const maxIterations = 100;
  const epsilon = 1e-10;
  
  let result = 0;
  let term = 1;
  
  for (let n = 0; n < maxIterations; n++) {
    term *= (a + n) * x / (a + b + n);
    result += term / (a + n + 1);
    if (Math.abs(term) < epsilon) break;
  }
  
  // Beta(a, b) の近似
  const logBeta = gammaLn(a) + gammaLn(b) - gammaLn(a + b);
  const beta = Math.exp(logBeta);
  
  return (Math.pow(x, a) * Math.pow(1 - x, b) / (a * beta)) * (1 + result);
}

/**
 * log(Gamma(x)) の近似（Stirling近似）
 */
function gammaLn(x: number): number {
  const coefficients = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.001208650973866179,
    -0.000005395239384953,
  ];
  
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += coefficients[j] / y;
  }
  
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/**
 * 空のサマリーを作成
 * トレードがない場合に使用
 * 
 * @returns 全て0のサマリー
 */
export function createEmptySummary(): BacktestResultSummary {
  return {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    netProfit: 0,
    netProfitRate: 0,
    maxDrawdown: 0,
    maxDrawdownRate: 0,
    profitFactor: 0,
    averageWin: 0,
    averageLoss: 0,
    riskRewardRatio: 0,
    maxConsecutiveWins: 0,
    maxConsecutiveLosses: 0,
    sharpeRatio: undefined,
    sortinoRatio: undefined,
    pValue: undefined,
    isStatisticallySignificant: undefined,
    confidenceLevel: 'low',
  };
}
