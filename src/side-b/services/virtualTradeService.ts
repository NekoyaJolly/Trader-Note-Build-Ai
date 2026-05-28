/**
 * 仮想トレード サービス
 * 
 * Phase B: 仮想トレードのビジネスロジック
 * - エントリー監視
 * - ポジション監視
 * - 決済処理
 * - PnL計算
 * 
 * @see docs/side-b/phase-b-virtual-trading.md
 */

import {
  createVirtualTrade,
  findVirtualTradeById,
  findOpenTrades,
  findPendingTrades,
  updateTradeToOpen,
  closeTrade,
  expireTrade,
  cancelTrade,
  findClosedTradesPnL,
  countOpenTrades,
  type VirtualTradeRecord,
  type FindVirtualTradesOptions,
  findVirtualTrades,
  getOrCreateDefaultPortfolio,
  updatePortfolioStats,
  updatePortfolioBalance,
} from "../repositories";
import {
  type CreateVirtualTradeInput,
  type CloseVirtualTradeInput,
  checkEntryCondition,
  checkExitCondition,
  calculatePnL,
  calculateStats,
  canOpenNewTrade,
  type TradeDirection,
  type ExitReason,
} from "../models";
import { planRepository } from "../repositories";

// ===========================================
// 型定義
// ===========================================

/**
 * トレード作成結果
 *
 * - success=true + trade: 仮想トレードが作成された
 * - success=true + skipped=true: 「ノートレード判断」の正常スキップ
 *   (プランは存在するがシナリオ 0 件 = Plan AI がエントリー条件未成立と判定)。
 *   エラーではないため呼び出し側は skip ログだけ出せばよい。
 * - success=false + error: 作成失敗(シナリオ不整合 / DB エラー等)
 */
export interface CreateTradeResult {
  success: boolean;
  trade?: VirtualTradeRecord;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * 監視結果
 */
export interface MonitoringResult {
  processed: number;
  entries: number;
  exits: number;
  errors: string[];
}

/**
 * ポートフォリオサマリー
 */
export interface PortfolioSummary {
  portfolio: {
    id: string;
    name: string;
    initialBalance: number;
    currentBalance: number;
  };
  stats: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    totalPnlPips: number;
  };
  openPositions: VirtualTradeRecord[];
}

// ===========================================
// サービス関数
// ===========================================

/**
 * プランからシナリオに基づいて仮想トレードを作成
 * 
 * @param planId プランID
 * @param scenarioId シナリオID（指定しない場合はprimaryシナリオ）
 * @returns 作成結果
 */
export async function createTradeFromPlan(
  planId: string,
  scenarioId?: string,
): Promise<CreateTradeResult> {
  try {
    // プランを取得
    const plan = await planRepository.findById(planId);
    if (!plan) {
      return { success: false, error: "プランが見つかりません" };
    }
    
    // シナリオを特定
    interface ScenarioData {
      id: string;
      direction: TradeDirection;
      entry: { price: number; condition: string };
      stopLoss: { price: number };
      takeProfit: { price: number };
    }
    // Prisma JSON フィールド由来のため、要素レベルで「id を持つオブジェクト」かを確認する。
    // 配列でない / null / プリミティブ要素は除外することで、後段の scenario.entry?.price 等で
    // Cannot read properties of null になることを防ぐ。
    const rawScenarios: unknown[] = Array.isArray(plan.scenarios) ? plan.scenarios : []; // eslint-disable-line no-restricted-syntax -- JSON 由来配列の要素型を runtime で narrow するための入口
    const scenarios: ScenarioData[] = rawScenarios.filter(
      (s): s is ScenarioData =>
        s !== null &&
        typeof s === 'object' &&
        !Array.isArray(s) &&
        'id' in s &&
        'entry' in s &&
        'stopLoss' in s &&
        'takeProfit' in s,
    );
    
    // シナリオ存在チェック
    // シナリオ 0 件 = Plan AI (StrategyThinker) が「エントリー条件未成立 = ノートレード」と
    // 判定したケース。これは正常動作なので skipped で返し、呼び出し側でエラー扱いしない。
    if (!scenarios || scenarios.length === 0) {
      return {
        success: true,
        skipped: true,
        skipReason: "ノートレード判断(シナリオ 0 件)",
      };
    }
    
    const scenario = scenarioId
      ? scenarios.find((s) => s.id === scenarioId)
      : scenarios[0]; // デフォルトは最初のシナリオ
    
    if (!scenario) {
      return { success: false, error: "シナリオが見つかりません" };
    }
    
    // シナリオフィールドのバリデーション
    const entryPrice = scenario.entry?.price;
    const slPrice = scenario.stopLoss?.price;
    const tpPrice = scenario.takeProfit?.price;
    
    if (entryPrice == null || isNaN(entryPrice)) {
      return { success: false, error: `エントリー価格が無効です: ${JSON.stringify(scenario.entry)}` };
    }
    if (slPrice == null || isNaN(slPrice)) {
      return { success: false, error: `ストップロス価格が無効です: ${JSON.stringify(scenario.stopLoss)}` };
    }
    if (tpPrice == null || isNaN(tpPrice)) {
      return { success: false, error: `テイクプロフィット価格が無効です: ${JSON.stringify(scenario.takeProfit)}` };
    }
    
    // ポートフォリオを取得してオープン上限チェック
    const portfolio = await getOrCreateDefaultPortfolio();
    const openCount = await countOpenTrades();
    
    if (!canOpenNewTrade(portfolio.settings, openCount)) {
      return { success: false, error: `オープンポジション上限（${portfolio.settings.maxOpenPositions}）に達しています` };
    }
    
    // MTF 文脈必須 (feedback_timeframe_mandatory): plan に timeframe/higherTimeframe が
    // 無い (= migration 前の旧 plan 等) 場合は TF 不明のトレードを開かない。新規 plan は
    // orchestrator が必ず両方を埋めるため、本ガードに掛かるのは legacy plan のみ。
    if (!plan.timeframe || !plan.higherTimeframe) {
      return {
        success: false,
        error: `plan に MTF 文脈 (timeframe/higherTimeframe) がありません (planId=${planId})。TF 無しのトレードは作成しません。`,
      };
    }

    // 仮想トレードを作成
    const input: CreateVirtualTradeInput = {
      planId,
      scenarioId: scenario.id,
      symbol: plan.symbol,
      timeframe: plan.timeframe,
      higherTimeframe: plan.higherTimeframe,
      direction: scenario.direction,
      plannedEntry: entryPrice,
      stopLoss: slPrice,
      takeProfit: tpPrice,
      entryCondition: scenario.entry.condition ?? "",
    };
    
    const trade = await createVirtualTrade(input);
    
    return { success: true, trade };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";
    return { success: false, error: message };
  }
}

/**
 * 仮想トレードを取得
 */
export async function getTrade(id: string): Promise<VirtualTradeRecord | null> {
  return findVirtualTradeById(id);
}

/**
 * 仮想トレード一覧を取得
 */
export async function listTrades(
  options: FindVirtualTradesOptions = {},
): Promise<VirtualTradeRecord[]> {
  return findVirtualTrades(options);
}

/**
 * 手動で仮想トレードを決済
 */
export async function closeTradeManually(
  tradeId: string,
  exitPrice: number,
  reason: ExitReason = "manual",
  note?: string,
): Promise<VirtualTradeRecord | null> {
  const trade = await findVirtualTradeById(tradeId);
  if (!trade || trade.status !== "open") {
    return null;
  }
  
  const entryPrice = trade.actualEntry ?? trade.plannedEntry;
  const pnl = calculatePnL(
    trade.direction as TradeDirection,
    entryPrice,
    exitPrice,
  );
  
  const input: CloseVirtualTradeInput = {
    exitPrice,
    exitReason: reason,
    note,
  };
  
  const closedTrade = await closeTrade(tradeId, input, pnl.pips, pnl.amount);
  
  // 統計更新
  await refreshPortfolioStats();
  
  return closedTrade;
}

/**
 * 仮想トレードをキャンセル（pending状態のみ）
 */
export async function cancelPendingTrade(tradeId: string): Promise<boolean> {
  const trade = await findVirtualTradeById(tradeId);
  if (!trade || trade.status !== "pending") {
    return false;
  }
  
  await cancelTrade(tradeId);
  return true;
}

/**
 * エントリー条件を監視して約定処理
 * 
 * @param getCurrentPrice 現在価格を取得する関数（シンボル → 価格）
 * @returns 監視結果
 */
export async function monitorEntryConditions(
  getCurrentPrice: (symbol: string) => Promise<number | null>,
): Promise<MonitoringResult> {
  const result: MonitoringResult = {
    processed: 0,
    entries: 0,
    exits: 0,
    errors: [],
  };
  
  try {
    const pendingTrades = await findPendingTrades();
    result.processed = pendingTrades.length;
    
    for (const trade of pendingTrades) {
      try {
        const currentPrice = await getCurrentPrice(trade.symbol);
        if (currentPrice === null) {
          result.errors.push(`${trade.symbol}: 価格取得失敗`);
          continue;
        }
        
        // エントリー条件チェック
        const shouldEnter = checkEntryCondition(
          trade.direction as TradeDirection,
          currentPrice,
          trade.plannedEntry,
          0.5, // 許容誤差 0.5 pips相当
        );
        
        if (shouldEnter) {
          await updateTradeToOpen(trade.id, currentPrice);
          result.entries++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "不明なエラー";
        result.errors.push(`${trade.id}: ${message}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";
    result.errors.push(`監視処理エラー: ${message}`);
  }
  
  return result;
}

/**
 * ポジションを監視してSL/TP到達で決済
 * 
 * @param getCurrentPrice 現在価格を取得する関数
 * @returns 監視結果
 */
export async function monitorPositions(
  getCurrentPrice: (symbol: string) => Promise<number | null>,
): Promise<MonitoringResult> {
  const result: MonitoringResult = {
    processed: 0,
    entries: 0,
    exits: 0,
    errors: [],
  };
  
  try {
    const openTrades = await findOpenTrades();
    result.processed = openTrades.length;
    
    for (const trade of openTrades) {
      try {
        const currentPrice = await getCurrentPrice(trade.symbol);
        if (currentPrice === null) {
          result.errors.push(`${trade.symbol}: 価格取得失敗`);
          continue;
        }
        
        // SL/TP到達チェック
        const exitReason = checkExitCondition(
          trade.direction as TradeDirection,
          currentPrice,
          trade.stopLoss,
          trade.takeProfit,
        );
        
        if (exitReason) {
          const entryPrice = trade.actualEntry ?? trade.plannedEntry;
          const pnl = calculatePnL(
            trade.direction as TradeDirection,
            entryPrice,
            currentPrice,
          );
          
          const input: CloseVirtualTradeInput = {
            exitPrice: currentPrice,
            exitReason,
          };
          
          await closeTrade(trade.id, input, pnl.pips, pnl.amount);
          result.exits++;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "不明なエラー";
        result.errors.push(`${trade.id}: ${message}`);
      }
    }
    
    // 統計更新
    if (result.exits > 0) {
      await refreshPortfolioStats();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";
    result.errors.push(`監視処理エラー: ${message}`);
  }
  
  return result;
}

/**
 * 期限切れの待機トレードを処理
 * 
 * @param expiryDate この日時以前のpendingトレードを期限切れに
 */
export async function expirePendingTrades(
  expiryDate: Date = new Date(),
): Promise<number> {
  const pendingTrades = await findPendingTrades();
  let expiredCount = 0;
  
  for (const trade of pendingTrades) {
    // createdAtから24時間経過していたら期限切れ
    const expiryTime = new Date(trade.createdAt);
    expiryTime.setHours(expiryTime.getHours() + 24);
    
    if (expiryTime <= expiryDate) {
      await expireTrade(trade.id);
      expiredCount++;
    }
  }
  
  return expiredCount;
}

/**
 * ポートフォリオ統計を更新
 */
export async function refreshPortfolioStats(): Promise<void> {
  const portfolio = await getOrCreateDefaultPortfolio();
  const closedPnL = await findClosedTradesPnL();
  const openCount = await countOpenTrades();
  
  const stats = calculateStats(closedPnL, openCount);
  
  // 残高更新
  const newBalance = portfolio.initialBalance + stats.totalPnlAmount;
  
  await updatePortfolioStats(portfolio.id, stats);
  await updatePortfolioBalance(portfolio.id, newBalance);
}

/**
 * ポートフォリオサマリーを取得
 */
export async function getPortfolioSummary(): Promise<PortfolioSummary> {
  const portfolio = await getOrCreateDefaultPortfolio();
  const openPositions = await findOpenTrades();
  
  return {
    portfolio: {
      id: portfolio.id,
      name: portfolio.name,
      initialBalance: portfolio.initialBalance,
      currentBalance: portfolio.currentBalance,
    },
    stats: {
      totalTrades: portfolio.stats.totalTrades,
      winRate: portfolio.stats.winRate,
      profitFactor: portfolio.stats.profitFactor,
      totalPnlPips: portfolio.stats.totalPnlPips,
    },
    openPositions,
  };
}
