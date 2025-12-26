import { MatchResult, PrismaClient } from '@prisma/client';
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
}
