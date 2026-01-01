import { EvaluationLog, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db/client';
import { EvaluationResult } from '../../domain/noteEvaluator';

/**
 * EvaluationLog リポジトリ
 * 
 * 目的:
 * NoteEvaluator.evaluate() の結果を永続化し、
 * ノートの有効性分析（勝率・再現性）の基盤データを蓄積する。
 * 
 * 設計:
 * - noteId × marketSnapshotId × timeframe の組み合わせは一意（冪等性保証）
 * - triggered=false の評価結果も記録（これが勝率計算の分母となる）
 * - diagnostics はオプション（環境変数で制御、容量節約）
 * 
 * @see docs/ARCHITECTURE.md - NoteEvaluator アーキテクチャ
 */

/**
 * 評価ログ作成時の入力型
 */
export interface EvaluationLogCreateInput {
  /** ノート ID */
  noteId: string;
  /** 市場スナップショット ID */
  marketSnapshotId: string;
  /** シンボル（例: BTCUSDT） */
  symbol: string;
  /** 時間足（例: 15m, 1h） */
  timeframe: string;
  /** EvaluationResult から抽出したデータ */
  evaluationResult: EvaluationResult;
  /** 診断情報を保存するか（デフォルト: 環境変数に従う） */
  saveDiagnostics?: boolean;
}

/**
 * 評価ログ検索条件
 */
export interface EvaluationLogSearchCriteria {
  /** ノート ID で絞り込み */
  noteId?: string;
  /** シンボルで絞り込み */
  symbol?: string;
  /** 時間足で絞り込み */
  timeframe?: string;
  /** triggered のみ絞り込み */
  triggeredOnly?: boolean;
  /** 評価日時の開始 */
  evaluatedFrom?: Date;
  /** 評価日時の終了 */
  evaluatedTo?: Date;
  /** 取得件数制限 */
  limit?: number;
  /** オフセット */
  offset?: number;
}

/**
 * ノート別パフォーマンス集計結果
 */
export interface NotePerformanceSummary {
  /** ノート ID */
  noteId: string;
  /** 総評価回数 */
  totalEvaluations: number;
  /** 発火回数 */
  triggeredCount: number;
  /** 発火率（triggeredCount / totalEvaluations） */
  triggerRate: number;
  /** 平均類似度 */
  avgSimilarity: number;
  /** 最高類似度 */
  maxSimilarity: number;
  /** 最低類似度 */
  minSimilarity: number;
  /** 最新評価日時 */
  lastEvaluatedAt: Date | null;
}

export class EvaluationLogRepository {
  private prisma: PrismaClient;
  
  /** 診断情報保存フラグ（環境変数から取得） */
  private readonly saveDiagnosticsByDefault: boolean;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || prisma;
    // 環境変数 SAVE_EVALUATION_DIAGNOSTICS=true で診断情報を保存
    this.saveDiagnosticsByDefault = process.env.SAVE_EVALUATION_DIAGNOSTICS === 'true';
  }

  /**
   * 評価ログを記録する（既存レコードがある場合は更新）
   * 
   * 冪等性: noteId × marketSnapshotId × timeframe の組み合わせは一意
   */
  async upsertLog(input: EvaluationLogCreateInput): Promise<EvaluationLog> {
    const { evaluationResult } = input;
    const saveDiagnostics = input.saveDiagnostics ?? this.saveDiagnosticsByDefault;
    
    // 診断情報の準備（オプション）
    // Prisma の JSON フィールドに null を設定する場合は Prisma.JsonNull を使用
    const diagnosticsData: Prisma.InputJsonValue | typeof Prisma.JsonNull = 
      saveDiagnostics && evaluationResult.diagnostics
        ? (evaluationResult.diagnostics as Prisma.InputJsonValue)
        : Prisma.JsonNull;

    return this.prisma.evaluationLog.upsert({
      where: {
        noteId_marketSnapshotId_timeframe: {
          noteId: input.noteId,
          marketSnapshotId: input.marketSnapshotId,
          timeframe: input.timeframe,
        },
      },
      create: {
        noteId: input.noteId,
        marketSnapshotId: input.marketSnapshotId,
        symbol: input.symbol,
        timeframe: input.timeframe,
        similarity: evaluationResult.similarity,
        level: evaluationResult.level,
        triggered: evaluationResult.triggered,
        vectorDimension: evaluationResult.vectorDimension,
        usedIndicators: evaluationResult.usedIndicators,
        diagnostics: diagnosticsData,
        evaluatedAt: evaluationResult.evaluatedAt,
      },
      update: {
        // 同じスナップショットに対する再評価時は結果を更新
        similarity: evaluationResult.similarity,
        level: evaluationResult.level,
        triggered: evaluationResult.triggered,
        vectorDimension: evaluationResult.vectorDimension,
        usedIndicators: evaluationResult.usedIndicators,
        diagnostics: diagnosticsData,
        evaluatedAt: evaluationResult.evaluatedAt,
      },
    });
  }

  /**
   * 冪等性チェック: noteId × marketSnapshotId × timeframe で既にログが存在するか確認
   * 
   * @returns true: すでに評価済み，false: 初回
   */
  async exists(
    noteId: string,
    marketSnapshotId: string,
    timeframe: string
  ): Promise<boolean> {
    const existing = await this.prisma.evaluationLog.findUnique({
      where: {
        noteId_marketSnapshotId_timeframe: {
          noteId,
          marketSnapshotId,
          timeframe,
        },
      },
      select: { id: true },
    });
    return !!existing;
  }

  /**
   * ID で評価ログを取得
   */
  async findById(id: string): Promise<EvaluationLog | null> {
    return this.prisma.evaluationLog.findUnique({
      where: { id },
    });
  }

  /**
   * 条件に基づいて評価ログを検索
   */
  async search(criteria: EvaluationLogSearchCriteria): Promise<EvaluationLog[]> {
    const where: Record<string, unknown> = {};
    
    if (criteria.noteId) {
      where.noteId = criteria.noteId;
    }
    if (criteria.symbol) {
      where.symbol = criteria.symbol;
    }
    if (criteria.timeframe) {
      where.timeframe = criteria.timeframe;
    }
    if (criteria.triggeredOnly) {
      where.triggered = true;
    }
    
    // 日時範囲フィルタ
    if (criteria.evaluatedFrom || criteria.evaluatedTo) {
      where.evaluatedAt = {};
      if (criteria.evaluatedFrom) {
        (where.evaluatedAt as Record<string, Date>).gte = criteria.evaluatedFrom;
      }
      if (criteria.evaluatedTo) {
        (where.evaluatedAt as Record<string, Date>).lte = criteria.evaluatedTo;
      }
    }

    return this.prisma.evaluationLog.findMany({
      where,
      orderBy: { evaluatedAt: 'desc' },
      take: criteria.limit ?? 100,
      skip: criteria.offset ?? 0,
    });
  }

  /**
   * ノート別のパフォーマンス集計を取得
   * 
   * フェーズ9「ノートの自己評価」の基盤となる集計
   */
  async getPerformanceSummary(noteId: string): Promise<NotePerformanceSummary | null> {
    // 集計クエリ
    const aggregation = await this.prisma.evaluationLog.aggregate({
      where: { noteId },
      _count: { id: true },
      _avg: { similarity: true },
      _max: { similarity: true, evaluatedAt: true },
      _min: { similarity: true },
    });

    if (aggregation._count.id === 0) {
      return null;
    }

    // triggered カウント
    const triggeredCount = await this.prisma.evaluationLog.count({
      where: { noteId, triggered: true },
    });

    const totalEvaluations = aggregation._count.id;
    
    return {
      noteId,
      totalEvaluations,
      triggeredCount,
      triggerRate: totalEvaluations > 0 ? triggeredCount / totalEvaluations : 0,
      avgSimilarity: aggregation._avg.similarity ?? 0,
      maxSimilarity: aggregation._max.similarity ?? 0,
      minSimilarity: aggregation._min.similarity ?? 0,
      lastEvaluatedAt: aggregation._max.evaluatedAt,
    };
  }

  /**
   * 複数ノートのパフォーマンス集計を一括取得
   */
  async getPerformanceSummaries(noteIds: string[]): Promise<NotePerformanceSummary[]> {
    const results: NotePerformanceSummary[] = [];
    
    for (const noteId of noteIds) {
      const summary = await this.getPerformanceSummary(noteId);
      if (summary) {
        results.push(summary);
      }
    }
    
    return results;
  }

  /**
   * ノートの評価ログ件数を取得
   */
  async countByNoteId(noteId: string): Promise<number> {
    return this.prisma.evaluationLog.count({
      where: { noteId },
    });
  }

  /**
   * シンボル別の評価ログ件数を取得
   */
  async countBySymbol(symbol: string): Promise<number> {
    return this.prisma.evaluationLog.count({
      where: { symbol },
    });
  }

  /**
   * 指定期間内の発火した評価ログを取得
   */
  async getTriggeredLogs(
    options: {
      from?: Date;
      to?: Date;
      noteId?: string;
      symbol?: string;
      limit?: number;
    } = {}
  ): Promise<EvaluationLog[]> {
    const where: Record<string, unknown> = { triggered: true };
    
    if (options.noteId) {
      where.noteId = options.noteId;
    }
    if (options.symbol) {
      where.symbol = options.symbol;
    }
    if (options.from || options.to) {
      where.evaluatedAt = {};
      if (options.from) {
        (where.evaluatedAt as Record<string, Date>).gte = options.from;
      }
      if (options.to) {
        (where.evaluatedAt as Record<string, Date>).lte = options.to;
      }
    }

    return this.prisma.evaluationLog.findMany({
      where,
      orderBy: { evaluatedAt: 'desc' },
      take: options.limit ?? 100,
    });
  }

  /**
   * 古い評価ログを削除（データ容量管理用）
   * 
   * @param olderThan - この日時より古いログを削除
   * @returns 削除件数
   */
  async deleteOldLogs(olderThan: Date): Promise<number> {
    const result = await this.prisma.evaluationLog.deleteMany({
      where: {
        evaluatedAt: { lt: olderThan },
      },
    });
    return result.count;
  }
}

// シングルトンインスタンス
export const evaluationLogRepository = new EvaluationLogRepository();
