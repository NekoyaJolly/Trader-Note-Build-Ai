/**
 * MarketResearch リポジトリ
 * 
 * 目的: Research AIが生成した市場リサーチの永続化
 * 
 * 設計変更（シンプル化）:
 * - Research AIの出力は12次元特徴量のみ
 * - OHLCVスナップショットも保存（Plan AI用）
 * - トレンド解釈、価格レベルはPlan AIの責務
 * 
 * 責務:
 * - リサーチの作成・読み取り
 * - キャッシュ有効期限の管理
 * - 期限切れリサーチの削除
 */

import { PrismaClient, MarketResearch, Prisma } from '@prisma/client';
import { prisma } from '../../backend/db/client';
import { FeatureVector12D, OHLCVSnapshot } from '../models';

// ===========================================
// 型定義
// ===========================================

/**
 * リサーチ作成用の入力データ（シンプル化）
 */
export interface CreateResearchInput {
  symbol: string;
  timeframe?: string;
  featureVector: FeatureVector12D;
  ohlcvSnapshot?: OHLCVSnapshot;
  aiModel: string;
  tokenUsage?: number;
  expiresAt: Date;
}

/**
 * リサーチ検索オプション
 */
export interface FindResearchOptions {
  symbol?: string;
  validOnly?: boolean;  // 有効期限内のみ
  limit?: number;
  offset?: number;
}

/**
 * DBから取得したリサーチをアプリ型に変換した型（シンプル化）
 */
export interface MarketResearchWithTypes {
  id: string;
  symbol: string;
  timeframe: string;
  featureVector: FeatureVector12D;
  ohlcvSnapshot?: OHLCVSnapshot;
  aiModel: string;
  tokenUsage: number | null;
  expiresAt: Date;
  createdAt: Date;
}

// ===========================================
// リポジトリクラス
// ===========================================

export class ResearchRepository {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || prisma;
  }

  /**
   * リサーチを作成（シンプル化）
   * 
   * DBスキーマも更新済み:
   * - 不要カラム削除（regime, trend等はPlan AIの責務）
   * - rawIndicators → ohlcvSnapshot にリネーム
   */
  async create(input: CreateResearchInput): Promise<MarketResearchWithTypes> {
    const research = await this.prisma.marketResearch.create({
      data: {
        symbol: input.symbol,
        timeframe: input.timeframe || 'multi',
        featureVector: input.featureVector as unknown as Prisma.InputJsonValue,
        ohlcvSnapshot: input.ohlcvSnapshot as unknown as Prisma.InputJsonValue,
        aiModel: input.aiModel,
        tokenUsage: input.tokenUsage,
        expiresAt: input.expiresAt,
      },
    });

    return this.toTypedResearch(research);
  }

  /**
   * IDでリサーチを取得
   */
  async findById(id: string): Promise<MarketResearchWithTypes | null> {
    const research = await this.prisma.marketResearch.findUnique({
      where: { id },
    });

    return research ? this.toTypedResearch(research) : null;
  }

  /**
   * シンボル・有効期限でリサーチを検索
   * 最新の有効なリサーチを返す
   */
  async findValidBySymbol(symbol: string): Promise<MarketResearchWithTypes | null> {
    const research = await this.prisma.marketResearch.findFirst({
      where: {
        symbol,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    return research ? this.toTypedResearch(research) : null;
  }

  /**
   * リサーチ一覧を取得
   */
  async findMany(options: FindResearchOptions = {}): Promise<MarketResearchWithTypes[]> {
    const { symbol, validOnly = false, limit = 50, offset = 0 } = options;

    const where: Prisma.MarketResearchWhereInput = {};

    if (symbol) {
      where.symbol = symbol;
    }

    if (validOnly) {
      where.expiresAt = { gt: new Date() };
    }

    const researches = await this.prisma.marketResearch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return researches.map((r) => this.toTypedResearch(r));
  }

  /**
   * 期限切れリサーチを削除
   * @returns 削除件数
   */
  async deleteExpired(): Promise<number> {
    const result = await this.prisma.marketResearch.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    return result.count;
  }

  /**
   * 特定シンボルのリサーチをすべて削除
   * @returns 削除件数
   */
  async deleteBySymbol(symbol: string): Promise<number> {
    const result = await this.prisma.marketResearch.deleteMany({
      where: { symbol },
    });

    return result.count;
  }

  /**
   * リサーチ数をカウント
   */
  async count(options: Pick<FindResearchOptions, 'symbol' | 'validOnly'> = {}): Promise<number> {
    const { symbol, validOnly = false } = options;

    const where: Prisma.MarketResearchWhereInput = {};

    if (symbol) {
      where.symbol = symbol;
    }

    if (validOnly) {
      where.expiresAt = { gt: new Date() };
    }

    return this.prisma.marketResearch.count({ where });
  }

  // ===========================================
  // プライベートメソッド
  // ===========================================

  /**
   * DBのリサーチをアプリ型に変換（シンプル化）
   */
  private toTypedResearch(research: MarketResearch): MarketResearchWithTypes {
    return {
      id: research.id,
      symbol: research.symbol,
      timeframe: research.timeframe,
      featureVector: research.featureVector as unknown as FeatureVector12D,
      ohlcvSnapshot: research.ohlcvSnapshot as unknown as OHLCVSnapshot | undefined,
      aiModel: research.aiModel,
      tokenUsage: research.tokenUsage,
      expiresAt: research.expiresAt,
      createdAt: research.createdAt,
    };
  }
}

// デフォルトインスタンス
export const researchRepository = new ResearchRepository();
