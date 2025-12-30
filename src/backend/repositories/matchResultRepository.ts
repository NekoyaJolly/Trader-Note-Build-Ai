import { MatchResult, PrismaClient, TradeNote, MarketSnapshot } from '@prisma/client';
import { prisma } from '../db/client';

/**
 * MatchResult リポジトリ
 * 
 * 目的: ルールベースの一致判定結果を永続化し、再現性のある履歴を残す。
 * 前提: noteId と marketSnapshotId の組み合わせは一意（スキーマのユニーク制約に依存）。
 */
export interface MatchResultUpsertInput {
  noteId: string;
  marketSnapshotId: string;
  symbol: string;
  score: number;          // 0.0 〜 1.0 の一致スコア
  threshold: number;      // 判定に用いた閾値（再計算時の再現性確保のため保存）
  trendMatched: boolean;  // トレンド一致の有無
  priceRangeMatched: boolean; // 価格レンジ一致の有無
  reasons: string[];      // 人間可読な理由の配列（日本語）
  evaluatedAt: Date;      // 判定実行時刻（UTC 前提）
}

export type MatchResultWithRelations = MatchResult & {
  note: TradeNote;
  marketSnapshot: MarketSnapshot;
};

export class MatchResultRepository {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || prisma;
  }

  /**
   * noteId と marketSnapshotId でユニークな MatchResult を upsert する。
   * 既存レコードがある場合はスコアと理由を上書きし、再評価の痕跡を残す。
   */
  async upsertByNoteAndSnapshot(input: MatchResultUpsertInput): Promise<MatchResult> {
    return this.prisma.matchResult.upsert({
      where: {
        noteId_marketSnapshotId: {
          noteId: input.noteId,
          marketSnapshotId: input.marketSnapshotId,
        },
      },
      create: {
        noteId: input.noteId,
        marketSnapshotId: input.marketSnapshotId,
        symbol: input.symbol,
        score: input.score,
        threshold: input.threshold,
        trendMatched: input.trendMatched,
        priceRangeMatched: input.priceRangeMatched,
        reasons: input.reasons,
        evaluatedAt: input.evaluatedAt,
        decidedAt: input.evaluatedAt,
      },
      update: {
        score: input.score,
        threshold: input.threshold,
        trendMatched: input.trendMatched,
        priceRangeMatched: input.priceRangeMatched,
        reasons: input.reasons,
        evaluatedAt: input.evaluatedAt,
        decidedAt: input.evaluatedAt,
      },
    });
  }

  /**
   * MatchResult を ID 配列で取得し、関連する Note と Snapshot を含めて返す
   */
  async findWithRelations(ids: string[]): Promise<MatchResultWithRelations[]> {
    if (ids.length === 0) return [];

    return this.prisma.matchResult.findMany({
      where: { id: { in: ids } },
      include: { note: true, marketSnapshot: true },
    }) as Promise<MatchResultWithRelations[]>;
  }

  /**
   * マッチ履歴を取得（ページング対応）
   * 
   * @param options - フィルタ・ページングオプション
   * @returns MatchResult の配列（新しい順）
   */
  async findHistory(options: {
    symbol?: string;
    limit?: number;
    offset?: number;
    minScore?: number;
  } = {}): Promise<MatchResult[]> {
    const { symbol, limit = 50, offset = 0, minScore } = options;

    const where: any = {};
    if (symbol) {
      where.symbol = symbol;
    }
    if (minScore !== undefined) {
      where.score = { gte: minScore };
    }

    return this.prisma.matchResult.findMany({
      where,
      orderBy: { evaluatedAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        note: true,
        marketSnapshot: true,
      },
    });
  }

  /**
   * マッチ結果を ID で取得
   */
  async findById(id: string): Promise<MatchResultWithRelations | null> {
    return this.prisma.matchResult.findUnique({
      where: { id },
      include: { note: true, marketSnapshot: true },
    }) as Promise<MatchResultWithRelations | null>;
  }

  /**
   * マッチ履歴の総数を取得
   */
  async countHistory(options: { symbol?: string; minScore?: number } = {}): Promise<number> {
    const { symbol, minScore } = options;

    const where: any = {};
    if (symbol) {
      where.symbol = symbol;
    }
    if (minScore !== undefined) {
      where.score = { gte: minScore };
    }

    return this.prisma.matchResult.count({ where });
  }
}
