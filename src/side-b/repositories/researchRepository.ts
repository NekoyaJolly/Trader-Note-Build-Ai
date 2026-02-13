/**
 * MarketResearch リポジトリ
 * 
 * 目的: Market Analyst AIが生成した市場分析の永続化
 * 
 * 設計変更（自律AI対応）:
 * - featureVector JSON列に MarketAnalysis 全体を保存
 * - 後方互換: 旧12次元データも読み取り可能
 * - OHLCVスナップショットも保存（Strategy Thinker用）
 * 
 * 責務:
 * - 分析の作成・読み取り
 * - キャッシュ有効期限の管理
 * - 期限切れ分析の削除
 */

import { PrismaClient, MarketResearch, Prisma } from '@prisma/client';
import { prisma } from '../../backend/db/client';
import { FeatureVector12D, OHLCVSnapshot, type MarketAnalysis, safeValidateMarketAnalysis, analysisToLegacyFeatureVector } from '../models';

// ===========================================
// 型定義
// ===========================================

/**
 * リサーチ作成用の入力データ
 */
export interface CreateResearchInput {
  symbol: string;
  timeframe?: string;
  featureVector: FeatureVector12D;
  /** 新: リッチ分析データ */
  marketAnalysis?: MarketAnalysis;
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
 * DBから取得したリサーチをアプリ型に変換した型
 */
export interface MarketResearchWithTypes {
  id: string;
  symbol: string;
  timeframe: string;
  featureVector: FeatureVector12D;
  /** 新: リッチ分析データ（旧データにはundefined） */
  marketAnalysis?: MarketAnalysis;
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
   * リサーチを作成
   * 
   * featureVector列にMarketAnalysis全体を保存（JSON型なので自由に拡張可能）
   * 後方互換のためlegacy featureVectorも混在可能
   */
  async create(input: CreateResearchInput): Promise<MarketResearchWithTypes> {
    // MarketAnalysis が提供されていれば、それをfeatureVector列に保存
    // （DB列名は変えずに中身をリッチ化）
    const featureVectorData = input.marketAnalysis
      ? { ...input.marketAnalysis, _version: 2 }  // v2マーカー
      : input.featureVector;

    const research = await this.prisma.marketResearch.create({
      data: {
        symbol: input.symbol,
        timeframe: input.timeframe || 'multi',
        featureVector: featureVectorData as unknown as Prisma.InputJsonValue,
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
   * DBのリサーチをアプリ型に変換
   * 
   * v1 (旧): featureVector列に12次元データ → featureVectorとして返す
   * v2 (新): featureVector列にMarketAnalysis → marketAnalysisとfeatureVector両方を返す
   */
  private toTypedResearch(research: MarketResearch): MarketResearchWithTypes {
    const rawData = research.featureVector as unknown as Record<string, unknown>;

    // v2チェック: _version === 2 なら MarketAnalysis
    const isV2 = rawData && rawData._version === 2;

    let featureVector: FeatureVector12D;
    let marketAnalysis: MarketAnalysis | undefined;

    if (isV2) {
      // v2: featureVector列から MarketAnalysis を取り出す
      const { _version, ...analysisData } = rawData;
      marketAnalysis = safeValidateMarketAnalysis(analysisData) || undefined;
      // legacy互換用の featureVector を生成
      featureVector = marketAnalysis
        ? analysisToLegacyFeatureVector(marketAnalysis) as unknown as FeatureVector12D
        : { trendStrength: 50, trendDirection: 50, maAlignment: 50, pricePosition: 50, rsiLevel: 50, macdMomentum: 50, momentumDivergence: 0, volatilityLevel: 50, bbWidth: 50, volatilityTrend: 50, supportProximity: 50, resistanceProximity: 50 };
    } else {
      // v1: 旧12次元データそのまま
      featureVector = rawData as unknown as FeatureVector12D;
    }

    return {
      id: research.id,
      symbol: research.symbol,
      timeframe: research.timeframe,
      featureVector,
      marketAnalysis,
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
