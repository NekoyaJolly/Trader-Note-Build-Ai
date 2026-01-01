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

import { PrismaClient, TradeNote, AISummary, TradeSide, NoteStatus, Prisma } from '@prisma/client';
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

  // ==========================================================
  // Phase 8: ステータス管理メソッド
  // ==========================================================

  /**
   * 承認済みノートのみを取得する
   * マッチング対象となるノートを取得する際に使用
   */
  async findApproved(options: Omit<FindNotesOptions, 'status'> = {}): Promise<TradeNoteWithSummary[]> {
    return this.findWithOptions({ ...options, status: 'approved' });
  }

  /**
   * マッチング対象の有効ノートを取得する（フェーズ8: 複数ノート運用UX）
   * 
   * 条件:
   * - status = 'approved'
   * - enabled = true
   * - pausedUntil が null または現在時刻より前
   * 
   * 優先度の高い順にソート
   */
  async findActiveForMatching(options: Omit<FindNotesOptions, 'status'> = {}): Promise<TradeNoteWithSummary[]> {
    const { symbol, tags, limit = 100, offset = 0 } = options;
    const safeLimit = Math.min(limit, 1000);
    const now = new Date();

    const where: Prisma.TradeNoteWhereInput = {
      status: 'approved',
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
   * ノートの優先度を更新する（フェーズ8）
   */
  async updatePriority(noteId: string, priority: number): Promise<void> {
    const clampedPriority = Math.max(1, Math.min(10, priority));
    await this.prisma.tradeNote.update({
      where: { id: noteId },
      data: { priority: clampedPriority },
    });
  }

  /**
   * ノートの有効/無効を切り替える（フェーズ8）
   */
  async setEnabled(noteId: string, enabled: boolean): Promise<void> {
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
  async setPausedUntil(noteId: string, until: Date | null): Promise<void> {
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
    const { status, symbol, tags, limit = 100, offset = 0 } = options;
    const safeLimit = Math.min(limit, 1000);

    // where 条件を構築（Prisma の生成型を使用）
    const where: Prisma.TradeNoteWhereInput = {};
    
    if (status) {
      // status は文字列または配列で指定可能
      if (Array.isArray(status)) {
        where.status = { in: status as NoteStatus[] };
      } else {
        where.status = status as NoteStatus;
      }
    }
    if (symbol) {
      where.symbol = symbol;
    }
    if (tags && tags.length > 0) {
      where.tags = { hasSome: tags };
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
   * ノートを承認する
   * 
   * @param id - TradeNote の ID
   * @returns 更新された TradeNote
   */
  async approve(id: string): Promise<TradeNote> {
    return await this.prisma.tradeNote.update({
      where: { id },
      data: {
        status: 'approved',
        approvedAt: new Date(),
        rejectedAt: null,
      },
    });
  }

  /**
   * ノートを非承認にする
   * 
   * @param id - TradeNote の ID
   * @returns 更新された TradeNote
   */
  async reject(id: string): Promise<TradeNote> {
    return await this.prisma.tradeNote.update({
      where: { id },
      data: {
        status: 'rejected',
        rejectedAt: new Date(),
      },
    });
  }

  /**
   * ノートを下書きに戻す
   * 
   * @param id - TradeNote の ID
   * @returns 更新された TradeNote
   */
  async revertToDraft(id: string): Promise<TradeNote> {
    return await this.prisma.tradeNote.update({
      where: { id },
      data: {
        status: 'draft',
        approvedAt: null,
        rejectedAt: null,
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
  async updateUserContent(id: string, input: UpdateTradeNoteInput): Promise<TradeNote> {
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
  async countByStatus(): Promise<{ status: NoteStatus; count: number }[]> {
    const results = await this.prisma.tradeNote.groupBy({
      by: ['status'],
      _count: true,
    });

    return results.map(r => ({
      status: r.status,
      count: r._count,
    }));
  }
}
