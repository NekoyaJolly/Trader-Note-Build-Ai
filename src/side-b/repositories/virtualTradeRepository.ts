/**
 * 仮想トレード リポジトリ
 * 
 * Phase B: 仮想トレードのCRUD操作
 * 
 * @see docs/side-b/phase-b-virtual-trading.md
 */

import { prisma } from "../../backend/db/client";
import type { Prisma, VirtualTradeStatus } from "@prisma/client";
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
  /** リスクリワード比（計算値） */
  riskRewardRatio: number | null;
  exitPrice: number | null;
  exitedAt: Date | null;
  exitReason: string | null;
  pnlPips: number | null;
  pnlAmount: number | null;
  /** Step C-1: reflectionAI の振り返り分析結果 (ReflectionOutput を JSON 化、未生成は null)。 */
  reflection: Prisma.JsonValue | null;
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

  // Prisma の生成型で where 条件を組み立て、Record<string, unknown> を排除する。
  const where: Prisma.VirtualTradeWhereInput = {};

  if (planId) where.planId = planId;
  if (symbol) where.symbol = symbol;

  if (status) {
    where.status = Array.isArray(status) ? { in: status } : status;
  }

  if (from || to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (from) createdAt.gte = from;
    if (to) createdAt.lte = to;
    where.createdAt = createdAt;
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
 * Step C-1: reflectionAI の振り返り分析結果を保存する。
 *
 * pdcaLoop の REFLECTING で reflection (成功時の ReflectionOutput / 失敗時の簡易構造) を
 * 完了後に呼ばれる。aiNoteService はこの値が non-null になったトレードについて
 * 「シナリオ + 実行内容 + reflection 分析」の統合ノートを生成する。
 */
export async function updateTradeReflection(
  id: string,
  reflection: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.virtualTrade.update({
    where: { id },
    data: { reflection },
  });
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
  // Prisma 生成型を直接使うことで動的キー追加でも型安全
  const data: Prisma.VirtualTradeUpdateInput = {};
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
  reflection: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}): VirtualTradeRecord {
  const plannedEntry = trade.plannedEntry.toNumber();
  const stopLoss = trade.stopLoss.toNumber();
  const takeProfit = trade.takeProfit.toNumber();
  
  // リスクリワード比を計算（リスク = |エントリー - SL|, リワード = |TP - エントリー|）
  const risk = Math.abs(plannedEntry - stopLoss);
  const reward = Math.abs(takeProfit - plannedEntry);
  const riskRewardRatio = risk > 0 ? reward / risk : null;
  
  return {
    id: trade.id,
    planId: trade.planId,
    scenarioId: trade.scenarioId,
    symbol: trade.symbol,
    direction: trade.direction,
    status: trade.status,
    plannedEntry,
    actualEntry: trade.actualEntry?.toNumber() ?? null,
    enteredAt: trade.enteredAt,
    stopLoss,
    takeProfit,
    riskRewardRatio,
    exitPrice: trade.exitPrice?.toNumber() ?? null,
    exitedAt: trade.exitedAt,
    exitReason: trade.exitReason,
    pnlPips: trade.pnlPips?.toNumber() ?? null,
    pnlAmount: trade.pnlAmount?.toNumber() ?? null,
    reflection: trade.reflection ?? null,
    createdAt: trade.createdAt,
    updatedAt: trade.updatedAt,
  };
}
