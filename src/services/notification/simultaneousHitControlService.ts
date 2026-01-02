/**
 * 同時ヒット制御サービス
 * 
 * フェーズ8: 複数ノート運用UX
 * 
 * 目的:
 * - 複数ノートが同時にヒットした場合の制御
 * - 優先度順にソートし、上位N件のみ通知
 * - 残りはスキップログに記録
 * - シンボルグループ化によるまとめ通知
 * 
 * @see docs/ARCHITECTURE.md
 */

import { PrismaClient, TradeNote } from '@prisma/client';
import { prisma } from '../../backend/db/client';

/**
 * マッチ結果の入力型
 */
export interface MatchHit {
  /** ノート ID */
  noteId: string;
  /** シンボル */
  symbol: string;
  /** 類似度スコア */
  similarity: number;
  /** 市場スナップショット ID */
  marketSnapshotId: string;
  /** ノートの優先度（1-10） */
  priority: number;
  /** マッチ日時 */
  matchedAt: Date;
}

/**
 * 同時ヒット制御設定
 */
export interface BatchConfig {
  /** 同時通知上限 */
  maxSimultaneous: number;
  /** シンボルごとにグループ化 */
  groupBySymbol: boolean;
  /** グループ内クールダウン（分） */
  cooldownMinutes: number;
}

/**
 * 制御結果
 */
export interface BatchControlResult {
  /** 通知対象（優先度順） */
  toNotify: MatchHit[];
  /** スキップ対象（優先度順） */
  toSkip: MatchHit[];
  /** シンボルごとのグループ情報 */
  groupedBySymbol: Map<string, MatchHit[]>;
}

/**
 * スキップログ入力
 */
export interface SkipLogInput {
  noteId: string;
  marketSnapshotId: string;
  symbol: string;
  similarity: number;
  skipReason: string;
  simultaneousCount: number;
  priorityRank: number;
}

/**
 * デフォルト設定
 */
const DEFAULT_CONFIG: BatchConfig = {
  maxSimultaneous: 3,
  groupBySymbol: true,
  cooldownMinutes: 15,
};

export class SimultaneousHitControlService {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || prisma;
  }

  /**
   * アクティブなバッチ設定を取得
   * 設定がない場合はデフォルト値を返す
   * 
   * シングルトン想定: 最新の1件を取得
   */
  async getActiveConfig(): Promise<BatchConfig> {
    try {
      const config = await this.prisma.notificationBatchConfig.findFirst({
        orderBy: { createdAt: 'desc' },
      });

      if (config) {
        return {
          maxSimultaneous: config.maxSimultaneous,
          groupBySymbol: config.groupBySymbol,
          cooldownMinutes: config.cooldownMinutes,
        };
      }
    } catch (error) {
      // テーブルが存在しない場合などはデフォルトを返す
      console.warn('[SimultaneousHitControl] 設定取得エラー、デフォルト使用:', error);
    }

    return DEFAULT_CONFIG;
  }

  /**
   * 同時ヒットを制御する
   * 
   * 1. 優先度（高い順）でソート
   * 2. 同優先度の場合は類似度（高い順）でソート
   * 3. 上位 maxSimultaneous 件を通知対象に
   * 4. 残りをスキップ対象に
   * 
   * @param hits マッチしたヒット一覧
   * @param config 制御設定（省略時はDB設定またはデフォルト）
   */
  async control(hits: MatchHit[], config?: BatchConfig): Promise<BatchControlResult> {
    const effectiveConfig = config || await this.getActiveConfig();
    
    // 空の場合は早期リターン
    if (hits.length === 0) {
      return {
        toNotify: [],
        toSkip: [],
        groupedBySymbol: new Map(),
      };
    }

    // 有効なノートのみフィルタ（enabled=true, pausedUntil が過ぎている）
    const activeHits = await this.filterActiveNotes(hits);

    // 優先度 → 類似度の順でソート（降順）
    const sortedHits = this.sortByPriorityAndSimilarity(activeHits);

    // シンボルグループ化
    const groupedBySymbol = this.groupBySymbol(sortedHits);

    let toNotify: MatchHit[] = [];
    let toSkip: MatchHit[] = [];

    if (effectiveConfig.groupBySymbol) {
      // シンボルごとに maxSimultaneous を適用
      for (const [, symbolHits] of groupedBySymbol) {
        const notifyCount = Math.min(symbolHits.length, effectiveConfig.maxSimultaneous);
        toNotify.push(...symbolHits.slice(0, notifyCount));
        toSkip.push(...symbolHits.slice(notifyCount));
      }
    } else {
      // 全体で maxSimultaneous を適用
      const notifyCount = Math.min(sortedHits.length, effectiveConfig.maxSimultaneous);
      toNotify = sortedHits.slice(0, notifyCount);
      toSkip = sortedHits.slice(notifyCount);
    }

    return {
      toNotify,
      toSkip,
      groupedBySymbol,
    };
  }

  /**
   * 有効なノートのみフィルタ
   * - enabled = true
   * - pausedUntil が null または現在時刻より前
   */
  private async filterActiveNotes(hits: MatchHit[]): Promise<MatchHit[]> {
    if (hits.length === 0) return [];

    const noteIds = hits.map(h => h.noteId);
    const now = new Date();

    try {
      const activeNotes = await this.prisma.tradeNote.findMany({
        where: {
          id: { in: noteIds },
          enabled: true,
          OR: [
            { pausedUntil: null },
            { pausedUntil: { lt: now } },
          ],
        },
        select: { id: true },
      });

      const activeNoteIds = new Set(activeNotes.map(n => n.id));
      return hits.filter(h => activeNoteIds.has(h.noteId));
    } catch (error) {
      // enabled フィールドがない場合（マイグレーション前）は全て返す
      console.warn('[SimultaneousHitControl] ノートフィルタエラー:', error);
      return hits;
    }
  }

  /**
   * 優先度（高い順）、類似度（高い順）でソート
   */
  private sortByPriorityAndSimilarity(hits: MatchHit[]): MatchHit[] {
    return [...hits].sort((a, b) => {
      // 優先度で降順ソート
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      // 同優先度なら類似度で降順ソート
      return b.similarity - a.similarity;
    });
  }

  /**
   * シンボルでグループ化
   */
  private groupBySymbol(hits: MatchHit[]): Map<string, MatchHit[]> {
    const grouped = new Map<string, MatchHit[]>();
    
    for (const hit of hits) {
      const existing = grouped.get(hit.symbol) || [];
      existing.push(hit);
      grouped.set(hit.symbol, existing);
    }
    
    return grouped;
  }

  /**
   * スキップログを記録
   */
  async logSkippedHits(
    skippedHits: MatchHit[],
    totalHits: number,
    skipReason: string = 'max_simultaneous'
  ): Promise<void> {
    if (skippedHits.length === 0) return;

    try {
      const skipLogs = skippedHits.map((hit, index) => ({
        noteId: hit.noteId,
        matchResultId: null, // 必要に応じて設定
        reason: skipReason as 'max_simultaneous_exceeded' | 'cooldown_active' | 'note_disabled' | 'note_paused' | 'lower_priority',
        details: {
          symbol: hit.symbol,
          similarity: hit.similarity,
          simultaneousCount: totalHits,
          priorityRank: index + 1,
        },
      }));

      await this.prisma.notificationSkipLog.createMany({
        data: skipLogs,
      });
    } catch (error) {
      // スキップログの記録失敗は警告のみ
      console.warn('[SimultaneousHitControl] スキップログ記録エラー:', error);
    }
  }

  /**
   * シンボルごとのまとめ通知メッセージを生成
   * 
   * 例: "BTCUSDT: ノートA(85%), ノートB(78%)"
   */
  async generateGroupedMessage(hits: MatchHit[]): Promise<string> {
    if (hits.length === 0) return '';
    if (hits.length === 1) {
      return `${hits[0].symbol}: ${(hits[0].similarity * 100).toFixed(0)}%`;
    }

    const symbol = hits[0].symbol;
    const noteInfos = hits.map(h => `${(h.similarity * 100).toFixed(0)}%`);
    
    return `${symbol}: ${noteInfos.join(', ')}`;
  }

  /**
   * バッチ設定を作成/更新
   * 
   * シングルトン想定: 既存があれば更新、なければ作成
   */
  async upsertConfig(
    config: Partial<BatchConfig>
  ): Promise<void> {
    const existing = await this.prisma.notificationBatchConfig.findFirst();
    
    if (existing) {
      await this.prisma.notificationBatchConfig.update({
        where: { id: existing.id },
        data: {
          maxSimultaneous: config.maxSimultaneous ?? existing.maxSimultaneous,
          groupBySymbol: config.groupBySymbol ?? existing.groupBySymbol,
          cooldownMinutes: config.cooldownMinutes ?? existing.cooldownMinutes,
        },
      });
    } else {
      await this.prisma.notificationBatchConfig.create({
        data: {
          maxSimultaneous: config.maxSimultaneous ?? DEFAULT_CONFIG.maxSimultaneous,
          groupBySymbol: config.groupBySymbol ?? DEFAULT_CONFIG.groupBySymbol,
          cooldownMinutes: config.cooldownMinutes ?? DEFAULT_CONFIG.cooldownMinutes,
        },
      });
    }
  }

  /**
   * スキップログを検索
   * 
   * @returns reason と details を含むスキップログ配列
   */
  async getSkipLogs(options: {
    noteId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  } = {}): Promise<{
    noteId: string;
    reason: string;
    details: unknown;
    skippedAt: Date;
  }[]> {
    const where: Record<string, unknown> = {};
    
    if (options.noteId) where.noteId = options.noteId;
    if (options.from || options.to) {
      where.skippedAt = {};
      if (options.from) (where.skippedAt as Record<string, Date>).gte = options.from;
      if (options.to) (where.skippedAt as Record<string, Date>).lte = options.to;
    }

    const logs = await this.prisma.notificationSkipLog.findMany({
      where,
      orderBy: { skippedAt: 'desc' },
      take: options.limit ?? 100,
      select: {
        noteId: true,
        reason: true,
        details: true,
        skippedAt: true,
      },
    });

    return logs.map(log => ({
      noteId: log.noteId,
      reason: log.reason,
      details: log.details,
      skippedAt: log.skippedAt,
    }));
  }
}

// シングルトンインスタンス
export const simultaneousHitControlService = new SimultaneousHitControlService();
