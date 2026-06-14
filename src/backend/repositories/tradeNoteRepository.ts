/**
 * TradeNote リポジトリ
 * 
 * 目的: TradeNote と AISummary の永続化を責務とする
 * 
 * 責務:
 * - TradeNote の作成・読み取り・更新・削除
 * - AISummary の作成・読み取り
 * - ステータス管理（承認・非承認・編集）
 * - トランザクション管理 (TradeNote と AISummary は同時に作成される)
 * 
 * 制約:
 * - すべての DB アクセスはこのリポジトリを経由する
 * - ビジネスロジックは含まない (サービス層の責務)
 */

import type { PrismaClient, TradeNote, AISummary, Trade, TradeSide, NoteStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/client';
// 注意: JSON フィールドの型変換はアプリケーション層で行う
// toIndicatorJson(), toMarketContextJson() を使用

/**
 * TradeNote 作成用の入力データ
 * 
 * 注意: JSON フィールドは Prisma.InputJsonValue のみ受け入れます
 * アプリケーション層で toIndicatorJson() や toMarketContextJson() を使用して変換してください
 */
export interface CreateTradeNoteInput {
  tradeId: string;
  symbol: string;
  entryPrice: number;
  side: TradeSide;
  indicators?: Prisma.InputJsonValue;  // JSON 形式の指標データ
  featureVector: number[];  // 固定長 7 の配列
  timeframe?: string;
  // === Phase 8: 追加フィールド ===
  status?: NoteStatus;      // デフォルト: draft
  marketContext?: Prisma.InputJsonValue;  // JSON: trend, calculatedIndicators 等
  userNotes?: string;
  tags?: string[];
  /** 所有ユーザー (Phase 6 以降は DB 永続化時に必須) */
  userId: string;
}

/**
 * TradeNote 更新用の入力データ
 * 
 * 注意: JSON フィールドは Prisma.InputJsonValue のみ受け入れます
 * アプリケーション層で toMarketContextJson() などを使用して変換してください
 */
export interface UpdateTradeNoteInput {
  userNotes?: string;
  tags?: string[];
  indicators?: Prisma.InputJsonValue;
  marketContext?: Prisma.InputJsonValue;
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
  /** 紐づく元トレード (数量・エントリー時刻の表示用、include 時のみ) */
  trade?: Trade | null;
}

/**
 * ステータスフィルタリング用のオプション
 */
export interface FindNotesOptions {
  status?: NoteStatus | NoteStatus[];
  symbol?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  /**
   * 所有ユーザーで絞り込む (Phase α-4 マルチユーザー分離)。
   * HTTP 経路では必ず指定する。cron / pipeline 等のユーザー横断処理では未指定 (全件)。
   */
  userId?: string;
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
          // Phase 8: 追加フィールド
          status: noteInput.status,
          marketContext: noteInput.marketContext,
          userNotes: noteInput.userNotes,
          tags: noteInput.tags,
          // Phase α-4: 所有ユーザーを設定 (マルチユーザー分離)
          userId: noteInput.userId,
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
  async findById(id: string, userId?: string): Promise<TradeNoteWithSummary | null> {
    // ユーザー分離: userId 指定時は所有ノートのみ返す (他ユーザーのノートは null)
    return await this.prisma.tradeNote.findFirst({
      where: { id, ...(userId ? { userId } : {}) },
      // trade を含めて数量・エントリー時刻を実値表示できるようにする (F6)
      include: { aiSummary: true, trade: true },
    });
  }

  /**
   * Trade ID から TradeNote を取得する (AISummary を含む)
   * 
   * @param tradeId - Trade の ID
   * @returns TradeNote (AISummary を含む)、存在しない場合は null
   */
  async findByTradeId(tradeId: string, userId?: string): Promise<TradeNoteWithSummary | null> {
    return await this.prisma.tradeNote.findFirst({
      where: { tradeId, ...(userId ? { userId } : {}) },
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
  async findBySymbol(symbol: string, limit: number = 100, userId?: string): Promise<TradeNoteWithSummary[]> {
    const safeLimit = Math.min(limit, 1000); // 最大 1000 件に制限

    return await this.prisma.tradeNote.findMany({
      where: { symbol, ...(userId ? { userId } : {}) },
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
  async findAll(limit: number = 100, offset: number = 0, userId?: string): Promise<TradeNoteWithSummary[]> {
    const safeLimit = Math.min(limit, 1000); // 最大 1000 件に制限

    return await this.prisma.tradeNote.findMany({
      where: userId ? { userId } : undefined,
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
  async delete(id: string, userId?: string): Promise<TradeNote> {
    await this.assertOwnership(id, userId);
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
  async count(symbol?: string, userId?: string): Promise<number> {
    const where: Prisma.TradeNoteWhereInput = {};
    if (symbol) where.symbol = symbol;
    if (userId) where.userId = userId;
    return await this.prisma.tradeNote.count({
      where: Object.keys(where).length > 0 ? where : undefined,
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
    limit: number = 100,
    userId?: string
  ): Promise<TradeNoteWithSummary[]> {
    const safeLimit = Math.min(limit, 1000);

    return await this.prisma.tradeNote.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        ...(userId ? { userId } : {}),
      },
      include: { aiSummary: true },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });
  }

  // ==========================================================
  // Phase 8: ステータス管理メソッド
  // ==========================================================

  /**
   * 有効ノートのみを取得する
   * マッチング対象となるノートを取得する際に使用
   */
  async findApproved(options: Omit<FindNotesOptions, 'status'> = {}): Promise<TradeNoteWithSummary[]> {
    return this.findWithOptions({ ...options, status: 'active' });
  }

  /**
   * マッチング対象の有効ノートを取得する（フェーズ8: 複数ノート運用UX）
   * 
   * 条件:
   * - status = 'active'
   * - enabled = true
   * - pausedUntil が null または現在時刻より前
   * 
   * 優先度の高い順にソート
   */
  async findActiveForMatching(options: Omit<FindNotesOptions, 'status'> = {}): Promise<TradeNoteWithSummary[]> {
    const { symbol, tags, limit = 100, offset = 0, userId } = options;
    const safeLimit = Math.min(limit, 1000);
    const now = new Date();

    const where: Prisma.TradeNoteWhereInput = {
      status: 'active',
      enabled: true,
      OR: [
        { pausedUntil: null },
        { pausedUntil: { lt: now } },
      ],
    };

    if (symbol) {
      where.symbol = symbol;
    }
    if (tags && tags.length > 0) {
      where.tags = { hasSome: tags };
    }
    if (userId) {
      where.userId = userId;
    }

    return await this.prisma.tradeNote.findMany({
      where,
      include: { aiSummary: true },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
      take: safeLimit,
      skip: offset,
    });
  }

  /**
   * 更新系操作の所有権チェック (Phase α-4 マルチユーザー分離)。
   * userId 指定時、対象ノートが所有ユーザーのものでなければエラーを投げる。
   * エラーメッセージはコントローラの 404 マッピング(「見つかりませんでした」)に合わせる。
   */
  private async assertOwnership(noteId: string, userId?: string): Promise<void> {
    if (!userId) return;
    const owned = await this.prisma.tradeNote.findFirst({
      where: { id: noteId, userId },
      select: { id: true },
    });
    if (!owned) {
      throw new Error(`ノートが見つかりませんでした: ${noteId}`);
    }
  }

  /**
   * ノートの優先度を更新する（フェーズ8）
   */
  async updatePriority(noteId: string, priority: number, userId?: string): Promise<void> {
    await this.assertOwnership(noteId, userId);
    const clampedPriority = Math.max(1, Math.min(10, priority));
    await this.prisma.tradeNote.update({
      where: { id: noteId },
      data: { priority: clampedPriority },
    });
  }

  /**
   * ノートの有効/無効を切り替える（フェーズ8）
   */
  async setEnabled(noteId: string, enabled: boolean, userId?: string): Promise<void> {
    await this.assertOwnership(noteId, userId);
    await this.prisma.tradeNote.update({
      where: { id: noteId },
      data: { enabled },
    });
  }

  /**
   * ノートを一時停止する（フェーズ8）
   *
   * @param noteId ノートID
   * @param until 停止終了日時（null で停止解除）
   */
  async setPausedUntil(noteId: string, until: Date | null, userId?: string): Promise<void> {
    await this.assertOwnership(noteId, userId);
    await this.prisma.tradeNote.update({
      where: { id: noteId },
      data: { pausedUntil: until },
    });
  }

  /**
   * 下書きノートのみを取得する
   */
  async findDrafts(options: Omit<FindNotesOptions, 'status'> = {}): Promise<TradeNoteWithSummary[]> {
    return this.findWithOptions({ ...options, status: 'draft' });
  }

  /**
   * オプションを指定してノートを取得する
   */
  async findWithOptions(options: FindNotesOptions = {}): Promise<TradeNoteWithSummary[]> {
    const { status, symbol, tags, limit = 100, offset = 0, userId } = options;
    const safeLimit = Math.min(limit, 1000);

    // where 条件を構築（Prisma の生成型を使用）
    const where: Prisma.TradeNoteWhereInput = {};

    if (status) {
      // status は文字列または配列で指定可能
      if (Array.isArray(status)) {
        where.status = { in: status };
      } else {
        where.status = status;
      }
    }
    if (symbol) {
      where.symbol = symbol;
    }
    if (tags && tags.length > 0) {
      where.tags = { hasSome: tags };
    }
    if (userId) {
      where.userId = userId;
    }

    return await this.prisma.tradeNote.findMany({
      where,
      include: { aiSummary: true },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
      skip: offset,
    });
  }

  /**
   * ノートを承認（有効化）する
   * 
   * @param id - TradeNote の ID
   * @returns 更新された TradeNote
   */
  async approve(id: string, userId?: string): Promise<TradeNote> {
    await this.assertOwnership(id, userId);
    return await this.prisma.tradeNote.update({
      where: { id },
      data: {
        status: 'active',
        activatedAt: new Date(),
        archivedAt: null,
      },
    });
  }

  /**
   * ノートをアーカイブにする
   * 
   * @param id - TradeNote の ID
   * @returns 更新された TradeNote
   */
  async reject(id: string, userId?: string): Promise<TradeNote> {
    await this.assertOwnership(id, userId);
    return await this.prisma.tradeNote.update({
      where: { id },
      data: {
        status: 'archived',
        archivedAt: new Date(),
      },
    });
  }

  /**
   * ノートを下書きに戻す
   * 
   * @param id - TradeNote の ID
   * @returns 更新された TradeNote
   */
  async revertToDraft(id: string, userId?: string): Promise<TradeNote> {
    await this.assertOwnership(id, userId);
    return await this.prisma.tradeNote.update({
      where: { id },
      data: {
        status: 'draft',
        activatedAt: null,
        archivedAt: null,
      },
    });
  }

  /**
   * ノートのユーザー編集内容を更新する
   * 
   * @param id - TradeNote の ID
   * @param input - 更新内容
   * @returns 更新された TradeNote
   */
  async updateUserContent(id: string, input: UpdateTradeNoteInput, userId?: string): Promise<TradeNote> {
    await this.assertOwnership(id, userId);
    return await this.prisma.tradeNote.update({
      where: { id },
      data: {
        ...input,
        lastEditedAt: new Date(),
      },
    });
  }

  /**
   * ノートの市場コンテキストを更新する
   * 
   * @param id - TradeNote の ID
   * @param marketContext - 新しい市場コンテキスト（JSON互換オブジェクト）
   * @returns 更新された TradeNote
   */
  async updateMarketContext(id: string, marketContext: Prisma.InputJsonValue): Promise<TradeNote> {
    return await this.prisma.tradeNote.update({
      where: { id },
      data: { marketContext },
    });
  }

  /**
   * ステータス別の件数を取得する
   */
  async countByStatus(userId?: string): Promise<{ status: NoteStatus; count: number }[]> {
    const results = await this.prisma.tradeNote.groupBy({
      by: ['status'],
      where: userId ? { userId } : undefined,
      _count: true,
    });

    return results.map(r => ({
      status: r.status,
      count: r._count,
    }));
  }
}
