/**
 * TradeNote リポジトリ
 * 
 * 目的: TradeNote と AISummary の永続化を責務とする
 * 
 * 責務:
 * - TradeNote の作成・読み取り・更新・削除
 * - AISummary の作成・読み取り
 * - トランザクション管理 (TradeNote と AISummary は同時に作成される)
 * 
 * 制約:
 * - すべての DB アクセスはこのリポジトリを経由する
 * - ビジネスロジックは含まない (サービス層の責務)
 */

import { PrismaClient, TradeNote, AISummary, TradeSide } from '@prisma/client';
import { prisma } from '../db/client';

/**
 * TradeNote 作成用の入力データ
 */
export interface CreateTradeNoteInput {
  tradeId: string;
  symbol: string;
  entryPrice: number;
  side: TradeSide;
  indicators?: any;         // JSON 形式の指標データ
  featureVector: number[];  // 固定長 7 の配列
  timeframe?: string;
}

/**
 * AISummary 作成用の入力データ
 */
export interface CreateAISummaryInput {
  noteId: string;
  summary: string;
  promptTokens?: number;
  completionTokens?: number;
  model?: string;
}

/**
 * TradeNote と AISummary を含む完全なデータ
 */
export interface TradeNoteWithSummary extends TradeNote {
  aiSummary: AISummary | null;
}

/**
 * TradeNote リポジトリクラス
 */
export class TradeNoteRepository {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || prisma;
  }

  /**
   * TradeNote と AISummary を同時に作成する
   * 
   * @param noteInput - TradeNote の入力データ
   * @param summaryInput - AISummary の入力データ
   * @returns 作成された TradeNote (AISummary を含む)
   * 
   * 前提条件:
   * - noteInput.tradeId に対応する Trade が存在すること
   * - noteInput.tradeId に対する TradeNote が未作成であること (1:1 制約)
   * 
   * 副作用:
   * - TradeNote と AISummary が DB に永続化される
   * - トランザクション内で両方が作成されるため、片方のみ作成されることはない
   */
  async createWithSummary(
    noteInput: CreateTradeNoteInput,
    summaryInput: Omit<CreateAISummaryInput, 'noteId'>
  ): Promise<TradeNoteWithSummary> {
    // トランザクション内で TradeNote と AISummary を同時作成
    return await this.prisma.$transaction(async (tx) => {
      // TradeNote を作成
      const note = await tx.tradeNote.create({
        data: {
          tradeId: noteInput.tradeId,
          symbol: noteInput.symbol,
          entryPrice: noteInput.entryPrice,
          side: noteInput.side,
          indicators: noteInput.indicators || {},
          featureVector: noteInput.featureVector,
          timeframe: noteInput.timeframe,
        },
      });

      // AISummary を作成
      const summary = await tx.aISummary.create({
        data: {
          noteId: note.id,
          summary: summaryInput.summary,
          promptTokens: summaryInput.promptTokens,
          completionTokens: summaryInput.completionTokens,
          model: summaryInput.model,
        },
      });

      return {
        ...note,
        aiSummary: summary,
      };
    });
  }

  /**
   * TradeNote を ID で取得する (AISummary を含む)
   * 
   * @param id - TradeNote の ID
   * @returns TradeNote (AISummary を含む)、存在しない場合は null
   */
  async findById(id: string): Promise<TradeNoteWithSummary | null> {
    return await this.prisma.tradeNote.findUnique({
      where: { id },
      include: { aiSummary: true },
    });
  }

  /**
   * Trade ID から TradeNote を取得する (AISummary を含む)
   * 
   * @param tradeId - Trade の ID
   * @returns TradeNote (AISummary を含む)、存在しない場合は null
   */
  async findByTradeId(tradeId: string): Promise<TradeNoteWithSummary | null> {
    return await this.prisma.tradeNote.findUnique({
      where: { tradeId },
      include: { aiSummary: true },
    });
  }

  /**
   * シンボルで TradeNote を検索する (AISummary を含む)
   * 
   * @param symbol - 銘柄シンボル (例: 'BTCUSD')
   * @param limit - 取得件数の上限 (デフォルト: 100)
   * @returns TradeNote の配列 (AISummary を含む)
   * 
   * 制約:
   * - 最大 1000 件まで取得可能 (過負荷防止)
   */
  async findBySymbol(symbol: string, limit: number = 100): Promise<TradeNoteWithSummary[]> {
    const safeLimit = Math.min(limit, 1000); // 最大 1000 件に制限

    return await this.prisma.tradeNote.findMany({
      where: { symbol },
      include: { aiSummary: true },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });
  }

  /**
   * すべての TradeNote を取得する (AISummary を含む)
   * 
   * @param limit - 取得件数の上限 (デフォルト: 100)
   * @param offset - スキップする件数 (ページング用、デフォルト: 0)
   * @returns TradeNote の配列 (AISummary を含む)
   * 
   * 制約:
   * - 最大 1000 件まで取得可能 (過負荷防止)
   */
  async findAll(limit: number = 100, offset: number = 0): Promise<TradeNoteWithSummary[]> {
    const safeLimit = Math.min(limit, 1000); // 最大 1000 件に制限

    return await this.prisma.tradeNote.findMany({
      include: { aiSummary: true },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
      skip: offset,
    });
  }

  /**
   * TradeNote の特徴量ベクトルを更新する
   * 
   * @param id - TradeNote の ID
   * @param featureVector - 新しい特徴量ベクトル
   * @returns 更新された TradeNote
   * 
   * 用途:
   * - 特徴量計算ロジックの改善時に既存のノートを再計算する場合
   */
  async updateFeatureVector(id: string, featureVector: number[]): Promise<TradeNote> {
    return await this.prisma.tradeNote.update({
      where: { id },
      data: { featureVector },
    });
  }

  /**
   * TradeNote を削除する (AISummary も同時削除される)
   * 
   * @param id - TradeNote の ID
   * @returns 削除された TradeNote
   * 
   * 副作用:
   * - TradeNote と関連する AISummary が DB から削除される
   * - MatchResult が存在する場合は削除が失敗する可能性がある (外部キー制約)
   */
  async delete(id: string): Promise<TradeNote> {
    return await this.prisma.tradeNote.delete({
      where: { id },
    });
  }

  /**
   * TradeNote の件数を取得する
   * 
   * @param symbol - シンボルで絞り込む (オプション)
   * @returns TradeNote の件数
   */
  async count(symbol?: string): Promise<number> {
    return await this.prisma.tradeNote.count({
      where: symbol ? { symbol } : undefined,
    });
  }

  /**
   * 特定の期間の TradeNote を取得する (AISummary を含む)
   * 
   * @param startDate - 開始日時
   * @param endDate - 終了日時
   * @param limit - 取得件数の上限 (デフォルト: 100)
   * @returns TradeNote の配列 (AISummary を含む)
   */
  async findByDateRange(
    startDate: Date,
    endDate: Date,
    limit: number = 100
  ): Promise<TradeNoteWithSummary[]> {
    const safeLimit = Math.min(limit, 1000);

    return await this.prisma.tradeNote.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: { aiSummary: true },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });
  }
}
