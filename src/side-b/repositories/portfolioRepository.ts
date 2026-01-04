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
      stats: DEFAULT_PORTFOLIO_STATS as unknown as Prisma.InputJsonValue,
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
  const data: Record<string, unknown> = {};
  
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
      stats: stats as unknown as Prisma.InputJsonValue,
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
  stats: unknown;
  maxOpenPositions: number;
  riskPercentPerTrade: Decimal;
  enableSpread: boolean;
  spreadPips: Decimal;
  createdAt: Date;
  updatedAt: Date;
}): PortfolioRecord {
  // statsをパース
  const stats = (portfolio.stats as PortfolioStats) ?? DEFAULT_PORTFOLIO_STATS;
  
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
