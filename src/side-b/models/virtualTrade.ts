/**
 * 仮想トレード モデル定義
 * 
 * Phase B: AIプランに基づく仮想的なトレード執行記録
 * 
 * @see docs/side-b/phase-b-virtual-trading.md
 */

// ===========================================
// ステータス定義
// ===========================================

/**
 * 仮想トレードのステータス
 * 
 * pending → open → closed の基本フロー
 * または pending → expired/cancelled
 * または open → invalidated
 */
export type VirtualTradeStatus =
  | "pending"     // エントリー条件待ち
  | "open"        // ポジション保有中
  | "closed"      // 正常決済
  | "expired"     // 期限切れ（未エントリー）
  | "cancelled"   // 手動キャンセル
  | "invalidated"; // 無効化条件該当

/**
 * 決済理由
 */
export type ExitReason =
  | "take_profit"    // TP到達
  | "stop_loss"      // SL到達
  | "manual"         // 手動決済
  | "invalidation"   // 無効化条件
  | "end_of_day"     // 日終わり強制決済
  | "trailing_stop"; // トレーリングストップ（将来用）

/**
 * トレード方向
 */
export type TradeDirection = "long" | "short";

// ===========================================
// 仮想トレード構造
// ===========================================

/**
 * エントリー情報
 */
export interface VirtualTradeEntry {
  /** 予定エントリー価格（プランで指定） */
  plannedPrice: number;
  /** 実際のエントリー価格 */
  actualPrice?: number;
  /** エントリー日時 */
  time?: Date;
  /** エントリー条件（プランから） */
  condition: string;
}

/**
 * 決済情報
 */
export interface VirtualTradeExit {
  /** 決済価格 */
  price: number;
  /** 決済日時 */
  time: Date;
  /** 決済理由 */
  reason: ExitReason;
  /** 決済時のメモ */
  note?: string;
}

/**
 * 損益情報
 */
export interface VirtualTradePnL {
  /** 損益（pips） */
  pips: number;
  /** 損益率（%） */
  percentage: number;
  /** 損益金額（仮想資金ベース） */
  amount?: number;
}

/**
 * 仮想トレード
 */
export interface VirtualTrade {
  id: string;
  
  // 関連
  /** AIトレードプランのID */
  planId: string;
  /** プラン内のシナリオID */
  scenarioId: string;
  
  // 基本情報
  /** 対象シンボル */
  symbol: string;
  /** トレード方向 */
  direction: TradeDirection;
  /** ステータス */
  status: VirtualTradeStatus;
  
  // エントリー情報
  entry: VirtualTradeEntry;
  
  // 決済情報
  exit?: VirtualTradeExit;
  
  // リスク管理
  /** ストップロス価格 */
  stopLoss: number;
  /** テイクプロフィット価格 */
  takeProfit: number;
  
  // 損益
  pnl?: VirtualTradePnL;
  
  // メタ
  createdAt: Date;
  updatedAt: Date;
}

// ===========================================
// 入力型定義（シンプルなinterface）
// ===========================================

/**
 * 仮想トレード作成入力
 */
export interface CreateVirtualTradeInput {
  planId: string;
  scenarioId: string;
  symbol: string;
  direction: TradeDirection;
  plannedEntry: number;
  stopLoss: number;
  takeProfit: number;
  entryCondition?: string;
}

/**
 * 仮想トレード決済入力
 */
export interface CloseVirtualTradeInput {
  exitPrice: number;
  exitReason: ExitReason;
  note?: string;
}

/**
 * 仮想トレード更新入力
 */
export interface UpdateVirtualTradeInput {
  stopLoss?: number;
  takeProfit?: number;
  status?: VirtualTradeStatus;
}

// ===========================================
// ユーティリティ関数
// ===========================================

/**
 * トレード方向に基づくSL/TP到達判定
 * 
 * @param direction トレード方向
 * @param currentPrice 現在価格
 * @param stopLoss SL価格
 * @param takeProfit TP価格
 * @returns 到達した場合の理由、なければnull
 */
export function checkExitCondition(
  direction: TradeDirection,
  currentPrice: number,
  stopLoss: number,
  takeProfit: number,
): ExitReason | null {
  if (direction === "long") {
    // ロング: 価格がSL以下で損切り、TP以上で利確
    if (currentPrice <= stopLoss) return "stop_loss";
    if (currentPrice >= takeProfit) return "take_profit";
  } else {
    // ショート: 価格がSL以上で損切り、TP以下で利確
    if (currentPrice >= stopLoss) return "stop_loss";
    if (currentPrice <= takeProfit) return "take_profit";
  }
  return null;
}

/**
 * エントリー条件達成判定
 * 
 * @param direction トレード方向
 * @param currentPrice 現在価格
 * @param plannedEntry 予定エントリー価格
 * @param tolerance 許容誤差（pips相当）
 * @returns エントリー可能かどうか
 */
export function checkEntryCondition(
  direction: TradeDirection,
  currentPrice: number,
  plannedEntry: number,
  tolerance: number = 0,
): boolean {
  // 指値注文想定: 予定価格以下（ロング）/ 以上（ショート）でエントリー
  if (direction === "long") {
    return currentPrice <= plannedEntry + tolerance;
  } else {
    return currentPrice >= plannedEntry - tolerance;
  }
}

/**
 * PnL計算
 * 
 * @param direction トレード方向
 * @param entryPrice エントリー価格
 * @param exitPrice 決済価格
 * @param pipValue 1pipの価格単位（XAUUSDなら0.1）
 * @returns PnL情報
 */
export function calculatePnL(
  direction: TradeDirection,
  entryPrice: number,
  exitPrice: number,
  pipValue: number = 0.1,
): VirtualTradePnL {
  const priceDiff = direction === "long"
    ? exitPrice - entryPrice
    : entryPrice - exitPrice;
  
  const pips = priceDiff / pipValue;
  const percentage = (priceDiff / entryPrice) * 100;
  
  return {
    pips: Math.round(pips * 10) / 10,  // 小数点1桁
    percentage: Math.round(percentage * 100) / 100,  // 小数点2桁
  };
}

/**
 * 仮想トレードがアクティブ（監視対象）かどうか
 */
export function isActiveTrade(status: VirtualTradeStatus): boolean {
  return status === "pending" || status === "open";
}

/**
 * 仮想トレードが終了状態かどうか
 */
export function isClosedTrade(status: VirtualTradeStatus): boolean {
  return ["closed", "expired", "cancelled", "invalidated"].includes(status);
}
