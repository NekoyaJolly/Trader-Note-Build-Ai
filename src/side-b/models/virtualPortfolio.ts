/**
 * 仮想ポートフォリオ モデル定義
 * 
 * Phase B: AIの仮想トレード統計を管理
 * 
 * @see docs/side-b/phase-b-virtual-trading.md
 */

// ===========================================
// 統計情報
// ===========================================

/**
 * ポートフォリオ統計
 */
export interface PortfolioStats {
  /** 総トレード数 */
  totalTrades: number;
  /** 勝ちトレード数 */
  wins: number;
  /** 負けトレード数 */
  losses: number;
  /** 勝率（0-100%） */
  winRate: number;
  /** プロフィットファクター（総利益/総損失） */
  profitFactor: number;
  /** 総損益（pips） */
  totalPnlPips: number;
  /** 総損益（金額） */
  totalPnlAmount: number;
  /** 平均利益（pips） */
  avgWinPips: number;
  /** 平均損失（pips） */
  avgLossPips: number;
  /** 最大ドローダウン（pips） */
  maxDrawdownPips: number;
  /** 最大ドローダウン（%） */
  maxDrawdownPercent: number;
  /** 現在オープンポジション数 */
  openPositions: number;
  /** 最終更新日時 */
  lastUpdated: Date;
}

/**
 * 統計のデフォルト値
 */
export const DEFAULT_PORTFOLIO_STATS: PortfolioStats = {
  totalTrades: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  profitFactor: 0,
  totalPnlPips: 0,
  totalPnlAmount: 0,
  avgWinPips: 0,
  avgLossPips: 0,
  maxDrawdownPips: 0,
  maxDrawdownPercent: 0,
  openPositions: 0,
  lastUpdated: new Date(),
};

// ===========================================
// 設定
// ===========================================

/**
 * ポートフォリオ設定
 */
export interface PortfolioSettings {
  /** 同時保有上限 */
  maxOpenPositions: number;
  /** 1トレードあたりのリスク率（%） */
  riskPercentPerTrade: number;
  /** スプレッド考慮フラグ */
  enableSpread: boolean;
  /** 想定スプレッド（pips） */
  spreadPips: number;
}

/**
 * 設定のデフォルト値
 */
export const DEFAULT_PORTFOLIO_SETTINGS: PortfolioSettings = {
  maxOpenPositions: 3,
  riskPercentPerTrade: 1.0,
  enableSpread: false,
  spreadPips: 2.0,
};

// ===========================================
// 仮想ポートフォリオ
// ===========================================

/**
 * 仮想ポートフォリオ
 */
export interface VirtualPortfolio {
  id: string;
  /** 名前 */
  name: string;
  
  // 資金管理
  /** 初期仮想資金 */
  initialBalance: number;
  /** 現在の仮想残高 */
  currentBalance: number;
  
  // 統計
  stats: PortfolioStats;
  
  // 設定
  settings: PortfolioSettings;
  
  // メタ
  createdAt: Date;
  updatedAt: Date;
}

// ===========================================
// 入力型定義（シンプルなinterface）
// ===========================================

/**
 * ポートフォリオ設定更新
 */
export interface UpdatePortfolioSettings {
  maxOpenPositions?: number;
  riskPercentPerTrade?: number;
  enableSpread?: boolean;
  spreadPips?: number;
}

/**
 * ポートフォリオ作成入力
 */
export interface CreatePortfolioInput {
  name?: string;
  initialBalance?: number;
}

// ===========================================
// ユーティリティ関数
// ===========================================

/**
 * 統計情報を計算
 * 
 * @param closedTrades 決済済みトレードのPnL配列
 * @param openCount 現在のオープンポジション数
 * @returns 計算された統計
 */
export function calculateStats(
  closedTrades: { pnlPips: number; pnlAmount: number }[],
  openCount: number,
): PortfolioStats {
  if (closedTrades.length === 0) {
    return {
      ...DEFAULT_PORTFOLIO_STATS,
      openPositions: openCount,
      lastUpdated: new Date(),
    };
  }
  
  const wins = closedTrades.filter(t => t.pnlPips > 0);
  const losses = closedTrades.filter(t => t.pnlPips < 0);
  
  const totalWinPips = wins.reduce((sum, t) => sum + t.pnlPips, 0);
  const totalLossPips = Math.abs(losses.reduce((sum, t) => sum + t.pnlPips, 0));
  
  const totalWinAmount = wins.reduce((sum, t) => sum + t.pnlAmount, 0);
  const totalLossAmount = Math.abs(losses.reduce((sum, t) => sum + t.pnlAmount, 0));
  
  // 最大ドローダウン計算（累積PnLの推移から）
  let peak = 0;
  let maxDrawdown = 0;
  let cumulative = 0;
  for (const trade of closedTrades) {
    cumulative += trade.pnlPips;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  
  return {
    totalTrades: closedTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / closedTrades.length) * 100,
    profitFactor: totalLossPips > 0 ? totalWinPips / totalLossPips : totalWinPips > 0 ? Infinity : 0,
    totalPnlPips: totalWinPips - totalLossPips,
    totalPnlAmount: totalWinAmount - totalLossAmount,
    avgWinPips: wins.length > 0 ? totalWinPips / wins.length : 0,
    avgLossPips: losses.length > 0 ? totalLossPips / losses.length : 0,
    maxDrawdownPips: maxDrawdown,
    maxDrawdownPercent: 0,  // 後で計算
    openPositions: openCount,
    lastUpdated: new Date(),
  };
}

/**
 * 新規トレードを開けるか判定
 * 
 * @param portfolio ポートフォリオ
 * @param currentOpenCount 現在のオープン数
 * @returns 新規トレード可能かどうか
 */
export function canOpenNewTrade(
  settings: PortfolioSettings,
  currentOpenCount: number,
): boolean {
  return currentOpenCount < settings.maxOpenPositions;
}

/**
 * 1トレードあたりのリスク金額を計算
 * 
 * @param balance 現在残高
 * @param riskPercent リスク率（%）
 * @returns リスク金額
 */
export function calculateRiskAmount(
  balance: number,
  riskPercent: number,
): number {
  return balance * (riskPercent / 100);
}
