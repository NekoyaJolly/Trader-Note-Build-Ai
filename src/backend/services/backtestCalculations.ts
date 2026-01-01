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
  positionSize: number;
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
  sharpeRatio?: number;
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
 * @param positionSize - ポジションサイズ（ロット数）
 * @returns 損益金額
 */
export function calculatePnl(
  side: TradeSide,
  entryPrice: number,
  exitPrice: number,
  positionSize: number
): number {
  if (side === 'buy') {
    // 買いトレード: 決済価格 - エントリー価格
    return (exitPrice - entryPrice) * positionSize;
  } else {
    // 売りトレード: エントリー価格 - 決済価格
    return (entryPrice - exitPrice) * positionSize;
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
  };
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
  };
}
