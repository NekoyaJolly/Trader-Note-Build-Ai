/**
 * 仮想トレード リポジトリ
 * 
 * Phase B: 仮想トレードのCRUD操作
 * 
 * @see docs/side-b/phase-b-virtual-trading.md
 */

import { prisma } from "../../backend/db/client";
import type { VirtualTradeStatus } from "@prisma/client";
import type { CreateVirtualTradeInput, CloseVirtualTradeInput } from "../models";
import { Decimal } from "@prisma/client/runtime/library";

// ===========================================
// 型定義
// ===========================================

/**
 * 仮想トレード（リポジトリ層の型）
 */
export interface VirtualTradeRecord {
  id: string;
  planId: string;
  scenarioId: string;
  symbol: string;
  direction: string;
  status: VirtualTradeStatus;
  plannedEntry: number;
  actualEntry: number | null;
  enteredAt: Date | null;
  stopLoss: number;
  takeProfit: number;
  exitPrice: number | null;
  exitedAt: Date | null;
  exitReason: string | null;
  pnlPips: number | null;
  pnlAmount: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 仮想トレード一覧取得オプション
 */
export interface FindVirtualTradesOptions {
  planId?: string;
  status?: VirtualTradeStatus | VirtualTradeStatus[];
  symbol?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

// ===========================================
// リポジトリ関数
// ===========================================

/**
 * 仮想トレードを作成
 */
export async function createVirtualTrade(
  input: CreateVirtualTradeInput,
): Promise<VirtualTradeRecord> {
  const trade = await prisma.virtualTrade.create({
    data: {
      planId: input.planId,
      scenarioId: input.scenarioId,
      symbol: input.symbol,
      direction: input.direction,
      status: "pending",
      plannedEntry: new Decimal(input.plannedEntry),
      stopLoss: new Decimal(input.stopLoss),
      takeProfit: new Decimal(input.takeProfit),
    },
  });
  
  return toVirtualTradeRecord(trade);
}

/**
 * 仮想トレードをIDで取得
 */
export async function findVirtualTradeById(
  id: string,
): Promise<VirtualTradeRecord | null> {
  const trade = await prisma.virtualTrade.findUnique({
    where: { id },
  });
  
  return trade ? toVirtualTradeRecord(trade) : null;
}

/**
 * 仮想トレード一覧を取得
 */
export async function findVirtualTrades(
  options: FindVirtualTradesOptions = {},
): Promise<VirtualTradeRecord[]> {
  const { planId, status, symbol, from, to, limit, offset } = options;
  
  const where: Record<string, unknown> = {};
  
  if (planId) where.planId = planId;
  if (symbol) where.symbol = symbol;
  
  if (status) {
    where.status = Array.isArray(status) ? { in: status } : status;
  }
  
  if (from || to) {
    where.createdAt = {};
    if (from) (where.createdAt as Record<string, unknown>).gte = from;
    if (to) (where.createdAt as Record<string, unknown>).lte = to;
  }
  
  const trades = await prisma.virtualTrade.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });
  
  return trades.map(toVirtualTradeRecord);
}

/**
 * アクティブな仮想トレード（pending/open）を取得
 */
export async function findActiveTrades(): Promise<VirtualTradeRecord[]> {
  return findVirtualTrades({
    status: ["pending", "open"],
  });
}

/**
 * オープン中のトレードを取得
 */
export async function findOpenTrades(): Promise<VirtualTradeRecord[]> {
  return findVirtualTrades({
    status: "open",
  });
}

/**
 * 待機中のトレードを取得
 */
export async function findPendingTrades(): Promise<VirtualTradeRecord[]> {
  return findVirtualTrades({
    status: "pending",
  });
}

/**
 * 仮想トレードをエントリー状態に更新
 */
export async function updateTradeToOpen(
  id: string,
  actualEntry: number,
  enteredAt: Date = new Date(),
): Promise<VirtualTradeRecord> {
  const trade = await prisma.virtualTrade.update({
    where: { id },
    data: {
      status: "open",
      actualEntry: new Decimal(actualEntry),
      enteredAt,
    },
  });
  
  return toVirtualTradeRecord(trade);
}

/**
 * 仮想トレードを決済
 */
export async function closeTrade(
  id: string,
  input: CloseVirtualTradeInput,
  pnlPips: number,
  pnlAmount?: number,
): Promise<VirtualTradeRecord> {
  const trade = await prisma.virtualTrade.update({
    where: { id },
    data: {
      status: "closed",
      exitPrice: new Decimal(input.exitPrice),
      exitedAt: new Date(),
      exitReason: input.exitReason,
      pnlPips: new Decimal(pnlPips),
      pnlAmount: pnlAmount !== undefined ? new Decimal(pnlAmount) : null,
    },
  });
  
  return toVirtualTradeRecord(trade);
}

/**
 * 仮想トレードを期限切れに更新
 */
export async function expireTrade(id: string): Promise<VirtualTradeRecord> {
  const trade = await prisma.virtualTrade.update({
    where: { id },
    data: {
      status: "expired",
    },
  });
  
  return toVirtualTradeRecord(trade);
}

/**
 * 仮想トレードをキャンセル
 */
export async function cancelTrade(id: string): Promise<VirtualTradeRecord> {
  const trade = await prisma.virtualTrade.update({
    where: { id },
    data: {
      status: "cancelled",
    },
  });
  
  return toVirtualTradeRecord(trade);
}

/**
 * 仮想トレードを無効化
 */
export async function invalidateTrade(id: string): Promise<VirtualTradeRecord> {
  const trade = await prisma.virtualTrade.update({
    where: { id },
    data: {
      status: "invalidated",
      exitedAt: new Date(),
      exitReason: "invalidation",
    },
  });
  
  return toVirtualTradeRecord(trade);
}

/**
 * SL/TPを更新
 */
export async function updateStopLossTakeProfit(
  id: string,
  stopLoss?: number,
  takeProfit?: number,
): Promise<VirtualTradeRecord> {
  const data: Record<string, unknown> = {};
  if (stopLoss !== undefined) data.stopLoss = new Decimal(stopLoss);
  if (takeProfit !== undefined) data.takeProfit = new Decimal(takeProfit);
  
  const trade = await prisma.virtualTrade.update({
    where: { id },
    data,
  });
  
  return toVirtualTradeRecord(trade);
}

/**
 * 統計用: 決済済みトレードのPnL一覧を取得
 */
export async function findClosedTradesPnL(): Promise<{ pnlPips: number; pnlAmount: number }[]> {
  const trades = await prisma.virtualTrade.findMany({
    where: { status: "closed" },
    select: { pnlPips: true, pnlAmount: true },
    orderBy: { exitedAt: "asc" },
  });
  
  return trades.map(t => ({
    pnlPips: t.pnlPips?.toNumber() ?? 0,
    pnlAmount: t.pnlAmount?.toNumber() ?? 0,
  }));
}

/**
 * オープンポジション数をカウント
 */
export async function countOpenTrades(): Promise<number> {
  return prisma.virtualTrade.count({
    where: { status: "open" },
  });
}

/**
 * 仮想トレードを削除（テスト用）
 */
export async function deleteVirtualTrade(id: string): Promise<void> {
  await prisma.virtualTrade.delete({
    where: { id },
  });
}

// ===========================================
// ヘルパー関数
// ===========================================

/**
 * Prismaのモデルをリポジトリ型に変換
 */
function toVirtualTradeRecord(trade: {
  id: string;
  planId: string;
  scenarioId: string;
  symbol: string;
  direction: string;
  status: VirtualTradeStatus;
  plannedEntry: Decimal;
  actualEntry: Decimal | null;
  enteredAt: Date | null;
  stopLoss: Decimal;
  takeProfit: Decimal;
  exitPrice: Decimal | null;
  exitedAt: Date | null;
  exitReason: string | null;
  pnlPips: Decimal | null;
  pnlAmount: Decimal | null;
  createdAt: Date;
  updatedAt: Date;
}): VirtualTradeRecord {
  return {
    id: trade.id,
    planId: trade.planId,
    scenarioId: trade.scenarioId,
    symbol: trade.symbol,
    direction: trade.direction,
    status: trade.status,
    plannedEntry: trade.plannedEntry.toNumber(),
    actualEntry: trade.actualEntry?.toNumber() ?? null,
    enteredAt: trade.enteredAt,
    stopLoss: trade.stopLoss.toNumber(),
    takeProfit: trade.takeProfit.toNumber(),
    exitPrice: trade.exitPrice?.toNumber() ?? null,
    exitedAt: trade.exitedAt,
    exitReason: trade.exitReason,
    pnlPips: trade.pnlPips?.toNumber() ?? null,
    pnlAmount: trade.pnlAmount?.toNumber() ?? null,
    createdAt: trade.createdAt,
    updatedAt: trade.updatedAt,
  };
}
