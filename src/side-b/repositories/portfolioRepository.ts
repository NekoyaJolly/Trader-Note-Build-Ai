/**
 * 仮想ポートフォリオ リポジトリ
 * 
 * Phase B: ポートフォリオのCRUD操作
 * 
 * @see docs/side-b/phase-b-virtual-trading.md
 */

import { prisma } from "../../backend/db/client";
import type { Prisma } from "@prisma/client";
import type { CreatePortfolioInput, UpdatePortfolioSettings, PortfolioStats, PortfolioSettings } from "../models";
import { DEFAULT_PORTFOLIO_STATS, DEFAULT_PORTFOLIO_SETTINGS } from "../models";
import { Decimal } from "@prisma/client/runtime/library";

/**
 * PortfolioStats を Prisma JSON 書き込み用に変換する。
 *
 * lastUpdated (Date) は ISO 文字列化し、他の数値フィールドはそのまま、
 * `Prisma.InputJsonValue` 互換のオブジェクトとして返す。
 * 二段 `as unknown as Prisma.InputJsonValue` キャストを避けるための薄いヘルパー。
 */
function portfolioStatsToJson(stats: PortfolioStats): Prisma.InputJsonValue {
  return {
    totalTrades: stats.totalTrades,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.winRate,
    profitFactor: stats.profitFactor,
    totalPnlPips: stats.totalPnlPips,
    totalPnlAmount: stats.totalPnlAmount,
    avgWinPips: stats.avgWinPips,
    avgLossPips: stats.avgLossPips,
    maxDrawdownPips: stats.maxDrawdownPips,
    maxDrawdownPercent: stats.maxDrawdownPercent,
    openPositions: stats.openPositions,
    lastUpdated: stats.lastUpdated.toISOString(),
  };
}

/**
 * Prisma JSON フィールドから PortfolioStats を復元する。
 *
 * 書き込み時に `portfolioStatsToJson` で lastUpdated を ISO 文字列化しているので、
 * 読み込み側ではここで Date に戻す。形式不一致 / null はデフォルト値で安全に補完。
 */
function revivePortfolioStats(raw: Prisma.JsonValue): PortfolioStats {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_PORTFOLIO_STATS;
  }
  const obj: Prisma.JsonObject = raw;
  const num = (v: Prisma.JsonValue | undefined, fallback: number): number =>
    typeof v === 'number' ? v : fallback;
  const lastUpdatedRaw = obj.lastUpdated;
  const lastUpdated =
    typeof lastUpdatedRaw === 'string' ? new Date(lastUpdatedRaw) : new Date();
  return {
    totalTrades: num(obj.totalTrades, 0),
    wins: num(obj.wins, 0),
    losses: num(obj.losses, 0),
    winRate: num(obj.winRate, 0),
    profitFactor: num(obj.profitFactor, 0),
    totalPnlPips: num(obj.totalPnlPips, 0),
    totalPnlAmount: num(obj.totalPnlAmount, 0),
    avgWinPips: num(obj.avgWinPips, 0),
    avgLossPips: num(obj.avgLossPips, 0),
    maxDrawdownPips: num(obj.maxDrawdownPips, 0),
    maxDrawdownPercent: num(obj.maxDrawdownPercent, 0),
    openPositions: num(obj.openPositions, 0),
    lastUpdated,
  };
}

// ===========================================
// 型定義
// ===========================================

/**
 * ポートフォリオ（リポジトリ層の型）
 */
export interface PortfolioRecord {
  id: string;
  name: string;
  initialBalance: number;
  currentBalance: number;
  stats: PortfolioStats;
  settings: PortfolioSettings;
  createdAt: Date;
  updatedAt: Date;
}

// ===========================================
// リポジトリ関数
// ===========================================

/**
 * ポートフォリオを作成
 */
export async function createPortfolio(
  input: CreatePortfolioInput = {},
): Promise<PortfolioRecord> {
  const portfolio = await prisma.virtualPortfolio.create({
    data: {
      name: input.name ?? "Default",
      initialBalance: new Decimal(input.initialBalance ?? 100000),
      currentBalance: new Decimal(input.initialBalance ?? 100000),
      stats: portfolioStatsToJson(DEFAULT_PORTFOLIO_STATS),
      maxOpenPositions: DEFAULT_PORTFOLIO_SETTINGS.maxOpenPositions,
      riskPercentPerTrade: new Decimal(DEFAULT_PORTFOLIO_SETTINGS.riskPercentPerTrade),
      enableSpread: DEFAULT_PORTFOLIO_SETTINGS.enableSpread,
      spreadPips: new Decimal(DEFAULT_PORTFOLIO_SETTINGS.spreadPips),
    },
  });
  
  return toPortfolioRecord(portfolio);
}

/**
 * ポートフォリオをIDで取得
 */
export async function findPortfolioById(
  id: string,
): Promise<PortfolioRecord | null> {
  const portfolio = await prisma.virtualPortfolio.findUnique({
    where: { id },
  });
  
  return portfolio ? toPortfolioRecord(portfolio) : null;
}

/**
 * デフォルトポートフォリオを取得（なければ作成）
 */
export async function getOrCreateDefaultPortfolio(): Promise<PortfolioRecord> {
  // 最初のポートフォリオを取得
  const existing = await prisma.virtualPortfolio.findFirst({
    orderBy: { createdAt: "asc" },
  });
  
  if (existing) {
    return toPortfolioRecord(existing);
  }
  
  // なければ作成
  return createPortfolio({ name: "Default" });
}

/**
 * 全ポートフォリオを取得
 */
export async function findAllPortfolios(): Promise<PortfolioRecord[]> {
  const portfolios = await prisma.virtualPortfolio.findMany({
    orderBy: { createdAt: "asc" },
  });
  
  return portfolios.map(toPortfolioRecord);
}

/**
 * ポートフォリオ設定を更新
 */
export async function updatePortfolioSettings(
  id: string,
  settings: UpdatePortfolioSettings,
): Promise<PortfolioRecord> {
  // Prisma の生成型 `VirtualPortfolioUpdateInput` を直接使うことで、
  // 動的キー追加でも型安全 (Record<string, unknown> を避ける)。
  const data: Prisma.VirtualPortfolioUpdateInput = {};

  if (settings.maxOpenPositions !== undefined) {
    data.maxOpenPositions = settings.maxOpenPositions;
  }
  if (settings.riskPercentPerTrade !== undefined) {
    data.riskPercentPerTrade = new Decimal(settings.riskPercentPerTrade);
  }
  if (settings.enableSpread !== undefined) {
    data.enableSpread = settings.enableSpread;
  }
  if (settings.spreadPips !== undefined) {
    data.spreadPips = new Decimal(settings.spreadPips);
  }
  
  const portfolio = await prisma.virtualPortfolio.update({
    where: { id },
    data,
  });
  
  return toPortfolioRecord(portfolio);
}

/**
 * ポートフォリオの残高を更新
 */
export async function updatePortfolioBalance(
  id: string,
  currentBalance: number,
): Promise<PortfolioRecord> {
  const portfolio = await prisma.virtualPortfolio.update({
    where: { id },
    data: {
      currentBalance: new Decimal(currentBalance),
    },
  });
  
  return toPortfolioRecord(portfolio);
}

/**
 * ポートフォリオの統計を更新
 */
export async function updatePortfolioStats(
  id: string,
  stats: PortfolioStats,
): Promise<PortfolioRecord> {
  const portfolio = await prisma.virtualPortfolio.update({
    where: { id },
    data: {
      stats: portfolioStatsToJson(stats),
    },
  });
  
  return toPortfolioRecord(portfolio);
}

/**
 * ポートフォリオを削除（テスト用）
 */
export async function deletePortfolio(id: string): Promise<void> {
  await prisma.virtualPortfolio.delete({
    where: { id },
  });
}

// ===========================================
// ヘルパー関数
// ===========================================

/**
 * Prismaのモデルをリポジトリ型に変換
 */
function toPortfolioRecord(portfolio: {
  id: string;
  name: string;
  initialBalance: Decimal;
  currentBalance: Decimal;
  // Prisma の JSON フィールドは `Prisma.JsonValue` (具体型) で受ける
  stats: Prisma.JsonValue;
  maxOpenPositions: number;
  riskPercentPerTrade: Decimal;
  enableSpread: boolean;
  spreadPips: Decimal;
  createdAt: Date;
  updatedAt: Date;
}): PortfolioRecord {
  // statsをパース。Prisma.JsonValue から PortfolioStats へ復元する。
  // 書き込み時に lastUpdated を ISO 文字列化しているため、読み出し時には
  // 文字列 → Date への戻し変換が必要。null/非オブジェクトはデフォルト値。
  const stats: PortfolioStats = revivePortfolioStats(portfolio.stats);
  
  return {
    id: portfolio.id,
    name: portfolio.name,
    initialBalance: portfolio.initialBalance.toNumber(),
    currentBalance: portfolio.currentBalance.toNumber(),
    stats,
    settings: {
      maxOpenPositions: portfolio.maxOpenPositions,
      riskPercentPerTrade: portfolio.riskPercentPerTrade.toNumber(),
      enableSpread: portfolio.enableSpread,
      spreadPips: portfolio.spreadPips.toNumber(),
    },
    createdAt: portfolio.createdAt,
    updatedAt: portfolio.updatedAt,
  };
}
