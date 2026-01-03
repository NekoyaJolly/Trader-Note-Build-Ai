/**
 * AITradePlan リポジトリ
 * 
 * 目的: Plan AIが生成したトレードプランの永続化
 * 
 * 責務:
 * - プランの作成・読み取り
 * - 日付・シンボルでの検索
 * - リサーチとの関連管理
 * 
 * 制約:
 * - すべての DB アクセスはこのリポジトリを経由する
 * - ビジネスロジックは含まない (サービス層の責務)
 * - 1日1シンボル1プランの制約あり (UQ: targetDate + symbol)
 */

import { PrismaClient, AITradePlan, Prisma } from '@prisma/client';
import { prisma } from '../../backend/db/client';
import {
  AITradeScenario,
  PlanMarketAnalysis,
} from '../models';

// ===========================================
// 型定義
// ===========================================

/**
 * プラン作成用の入力データ
 */
export interface CreatePlanInput {
  researchId: string;
  targetDate: Date;
  symbol: string;
  marketAnalysis: PlanMarketAnalysis;
  scenarios: AITradeScenario[];
  overallConfidence?: number;
  warnings?: string[];
  aiModel?: string;
  tokenUsage?: number;
}

/**
 * プラン検索オプション
 */
export interface FindPlanOptions {
  symbol?: string;
  targetDate?: Date;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * DBから取得したプランをアプリ型に変換した型
 */
export interface AITradePlanWithTypes extends Omit<AITradePlan, 'marketAnalysis' | 'scenarios'> {
  marketAnalysis: PlanMarketAnalysis;
  scenarios: AITradeScenario[];
}

/**
 * リサーチを含むプラン（シンプル化：regimeとsummaryはPlan側で持つ）
 */
export interface AITradePlanWithResearch extends AITradePlanWithTypes {
  research?: {
    id: string;
    symbol: string;
    createdAt: Date;
  };
}

// ===========================================
// リポジトリクラス
// ===========================================

export class PlanRepository {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || prisma;
  }

  /**
   * プランを作成
   */
  async create(input: CreatePlanInput): Promise<AITradePlanWithTypes> {
    const plan = await this.prisma.aITradePlan.create({
      data: {
        researchId: input.researchId,
        targetDate: input.targetDate,
        symbol: input.symbol,
        marketAnalysis: input.marketAnalysis as unknown as Prisma.InputJsonValue,
        scenarios: input.scenarios as unknown as Prisma.InputJsonValue,
        overallConfidence: input.overallConfidence,
        warnings: input.warnings || [],
        aiModel: input.aiModel,
        tokenUsage: input.tokenUsage,
      },
    });

    return this.toTypedPlan(plan);
  }

  /**
   * IDでプランを取得
   */
  async findById(id: string): Promise<AITradePlanWithTypes | null> {
    const plan = await this.prisma.aITradePlan.findUnique({
      where: { id },
    });

    return plan ? this.toTypedPlan(plan) : null;
  }

  /**
   * IDでプランを取得（リサーチ情報含む）
   */
  async findByIdWithResearch(id: string): Promise<AITradePlanWithResearch | null> {
    const plan = await this.prisma.aITradePlan.findUnique({
      where: { id },
      include: {
        research: {
          select: {
            id: true,
            symbol: true,
            featureVector: true,
            ohlcvSnapshot: true,
            createdAt: true,
          },
        },
      },
    });

    if (!plan) return null;

    return {
      ...this.toTypedPlan(plan),
      research: plan.research
        ? {
            id: plan.research.id,
            symbol: plan.research.symbol,
            createdAt: plan.research.createdAt,
          }
        : undefined,
    };
  }

  /**
   * 日付・シンボルでプランを検索
   * 1日1シンボル1プランなので、存在すれば1件
   */
  async findByDateAndSymbol(targetDate: Date, symbol: string): Promise<AITradePlanWithTypes | null> {
    const plan = await this.prisma.aITradePlan.findUnique({
      where: {
        targetDate_symbol: {
          targetDate,
          symbol,
        },
      },
    });

    return plan ? this.toTypedPlan(plan) : null;
  }

  /**
   * 今日のプランを取得
   */
  async findTodayBySymbol(symbol: string): Promise<AITradePlanWithTypes | null> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return this.findByDateAndSymbol(today, symbol);
  }

  /**
   * プラン一覧を取得
   */
  async findMany(options: FindPlanOptions = {}): Promise<AITradePlanWithTypes[]> {
    const { symbol, targetDate, fromDate, toDate, limit = 50, offset = 0 } = options;

    const where: Prisma.AITradePlanWhereInput = {};

    if (symbol) {
      where.symbol = symbol;
    }

    if (targetDate) {
      where.targetDate = targetDate;
    } else {
      // 日付範囲指定
      if (fromDate || toDate) {
        where.targetDate = {};
        if (fromDate) {
          where.targetDate.gte = fromDate;
        }
        if (toDate) {
          where.targetDate.lte = toDate;
        }
      }
    }

    const plans = await this.prisma.aITradePlan.findMany({
      where,
      orderBy: { targetDate: 'desc' },
      take: limit,
      skip: offset,
    });

    return plans.map((p) => this.toTypedPlan(p));
  }

  /**
   * リサーチIDに紐づくプラン一覧を取得
   */
  async findByResearchId(researchId: string): Promise<AITradePlanWithTypes[]> {
    const plans = await this.prisma.aITradePlan.findMany({
      where: { researchId },
      orderBy: { createdAt: 'desc' },
    });

    return plans.map((p) => this.toTypedPlan(p));
  }

  /**
   * プランを削除
   */
  async delete(id: string): Promise<void> {
    await this.prisma.aITradePlan.delete({
      where: { id },
    });
  }

  /**
   * 古いプランを削除
   * @param beforeDate この日付より前のプランを削除
   * @returns 削除件数
   */
  async deleteOlderThan(beforeDate: Date): Promise<number> {
    const result = await this.prisma.aITradePlan.deleteMany({
      where: {
        targetDate: { lt: beforeDate },
      },
    });

    return result.count;
  }

  /**
   * プラン数をカウント
   */
  async count(options: Pick<FindPlanOptions, 'symbol' | 'fromDate' | 'toDate'> = {}): Promise<number> {
    const { symbol, fromDate, toDate } = options;

    const where: Prisma.AITradePlanWhereInput = {};

    if (symbol) {
      where.symbol = symbol;
    }

    if (fromDate || toDate) {
      where.targetDate = {};
      if (fromDate) {
        where.targetDate.gte = fromDate;
      }
      if (toDate) {
        where.targetDate.lte = toDate;
      }
    }

    return this.prisma.aITradePlan.count({ where });
  }

  // ===========================================
  // プライベートメソッド
  // ===========================================

  /**
   * DBのプランをアプリ型に変換
   */
  private toTypedPlan(plan: AITradePlan): AITradePlanWithTypes {
    return {
      ...plan,
      marketAnalysis: plan.marketAnalysis as unknown as PlanMarketAnalysis,
      scenarios: plan.scenarios as unknown as AITradeScenario[],
    };
  }
}

// デフォルトインスタンス
export const planRepository = new PlanRepository();
