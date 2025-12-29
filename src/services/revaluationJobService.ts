/**
 * 再評価ジョブサービス
 * 
 * 目的: BullMQ を使用した非同期再評価処理の管理
 * 
 * 設計方針:
 * - ジョブのエンキュー（追加）
 * - ジョブステータスの追跡
 * - 失敗時のリトライ管理
 * - DB 上の RevaluationJob テーブルと連携
 * 
 * 参照: 技術スタック選定シート ⑨
 */

import { Queue, Job, QueueEvents } from 'bullmq';
import { PrismaClient, RevaluationJobType, RevaluationJobStatus } from '@prisma/client';
import {
  QUEUE_NAMES,
  JOB_PRIORITIES,
  getRedisConnection,
  getQueueOptions,
  isRedisAvailable,
} from '../config/queueConfig';

const prisma = new PrismaClient();

/**
 * ジョブデータの型定義
 */
export interface RevaluationJobData {
  /** DB 上のジョブ ID */
  jobRecordId: string;
  /** ジョブタイプ */
  jobType: RevaluationJobType;
  /** 対象ノート ID（null は全ノート） */
  targetNoteId?: string;
  /** 対象銘柄（null は全銘柄） */
  targetSymbol?: string;
  /** 追加オプション */
  options?: {
    /** 強制再計算フラグ */
    forceRecalculate?: boolean;
    /** バッチサイズ */
    batchSize?: number;
  };
}

/**
 * ジョブ結果の型定義
 */
export interface RevaluationJobResult {
  /** 処理済み件数 */
  processedCount: number;
  /** 成功件数 */
  successCount: number;
  /** 失敗件数 */
  failedCount: number;
  /** エラーメッセージ（あれば） */
  errors?: string[];
}

/**
 * 再評価ジョブキューマネージャークラス
 */
export class RevaluationJobManager {
  private queues: Map<string, Queue<RevaluationJobData, RevaluationJobResult>>;
  private isInitialized: boolean = false;

  constructor() {
    this.queues = new Map();
  }

  /**
   * キューを初期化
   * Redis が利用不可の場合はスキップ
   */
  initialize(): boolean {
    if (!isRedisAvailable()) {
      console.warn('Redis が設定されていません。ジョブキューは無効化されます。');
      return false;
    }

    const connection = getRedisConnection();
    const options = getQueueOptions();

    // 各キューを初期化
    for (const [key, name] of Object.entries(QUEUE_NAMES)) {
      const queue = new Queue<RevaluationJobData, RevaluationJobResult>(name, {
        connection,
        ...options,
      });
      this.queues.set(name, queue);
    }

    this.isInitialized = true;
    console.log('ジョブキューが初期化されました');
    return true;
  }

  /**
   * キューを取得
   */
  private getQueue(queueName: string): Queue<RevaluationJobData, RevaluationJobResult> | null {
    if (!this.isInitialized) {
      console.warn('ジョブキューが初期化されていません');
      return null;
    }
    return this.queues.get(queueName) || null;
  }

  /**
   * 再評価ジョブを作成・エンキュー
   * 
   * @param jobType - ジョブタイプ
   * @param targetNoteId - 対象ノート ID（省略時は全ノート）
   * @param targetSymbol - 対象銘柄（省略時は全銘柄）
   * @param priority - ジョブ優先度
   * @returns 作成されたジョブレコード ID
   */
  async createJob(
    jobType: RevaluationJobType,
    targetNoteId?: string,
    targetSymbol?: string,
    priority: number = JOB_PRIORITIES.NORMAL
  ): Promise<string> {
    // DB にジョブレコードを作成
    const jobRecord = await prisma.revaluationJob.create({
      data: {
        jobType,
        targetNoteId,
        targetSymbol,
        status: 'pending',
        processedCount: 0,
        totalCount: 0,
      },
    });

    // キューにジョブを追加（Redis が利用可能な場合）
    const queueName = this.getQueueNameForJobType(jobType);
    const queue = this.getQueue(queueName);

    if (queue) {
      const jobData: RevaluationJobData = {
        jobRecordId: jobRecord.id,
        jobType,
        targetNoteId: targetNoteId || undefined,
        targetSymbol: targetSymbol || undefined,
      };

      await queue.add(jobRecord.id, jobData, {
        priority,
        jobId: jobRecord.id,
      });

      console.log(`ジョブをエンキューしました: ${jobRecord.id} (${jobType})`);
    } else {
      // Redis が利用不可の場合は同期処理フラグを立てる
      console.log(`Redis 未設定のため、ジョブは同期処理対象として登録: ${jobRecord.id}`);
    }

    return jobRecord.id;
  }

  /**
   * ジョブタイプに対応するキュー名を取得
   */
  private getQueueNameForJobType(jobType: RevaluationJobType): string {
    switch (jobType) {
      case 'note_regenerate':
        return QUEUE_NAMES.NOTE_REGENERATE;
      case 'feature_recalculate':
        return QUEUE_NAMES.FEATURE_RECALCULATE;
      case 'ai_summary_regenerate':
        return QUEUE_NAMES.AI_SUMMARY_REGENERATE;
      case 'full_reprocess':
        return QUEUE_NAMES.FULL_REPROCESS;
      default:
        return QUEUE_NAMES.FULL_REPROCESS;
    }
  }

  /**
   * ジョブステータスを更新
   */
  async updateJobStatus(
    jobId: string,
    status: RevaluationJobStatus,
    update?: {
      processedCount?: number;
      totalCount?: number;
      errorMessage?: string;
      startedAt?: Date;
      completedAt?: Date;
    }
  ): Promise<void> {
    await prisma.revaluationJob.update({
      where: { id: jobId },
      data: {
        status,
        ...update,
      },
    });
  }

  /**
   * ジョブの進捗を取得
   */
  async getJobProgress(jobId: string): Promise<{
    status: RevaluationJobStatus;
    processedCount: number;
    totalCount: number;
    progress: number;
    errorMessage?: string;
  } | null> {
    const job = await prisma.revaluationJob.findUnique({
      where: { id: jobId },
    });

    if (!job) return null;

    return {
      status: job.status,
      processedCount: job.processedCount,
      totalCount: job.totalCount,
      progress: job.totalCount > 0 ? (job.processedCount / job.totalCount) * 100 : 0,
      errorMessage: job.errorMessage || undefined,
    };
  }

  /**
   * ペンディング状態のジョブを取得
   * （同期処理用）
   */
  async getPendingJobs(limit: number = 10): Promise<Array<{
    id: string;
    jobType: RevaluationJobType;
    targetNoteId: string | null;
    targetSymbol: string | null;
  }>> {
    const jobs = await prisma.revaluationJob.findMany({
      where: {
        status: 'pending',
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: limit,
      select: {
        id: true,
        jobType: true,
        targetNoteId: true,
        targetSymbol: true,
      },
    });

    return jobs;
  }

  /**
   * 全キューをクローズ
   */
  async close(): Promise<void> {
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    this.queues.clear();
    this.isInitialized = false;
  }

  /**
   * キュー統計を取得
   */
  async getQueueStats(): Promise<{
    isInitialized: boolean;
    queues: Array<{
      name: string;
      waiting: number;
      active: number;
      completed: number;
      failed: number;
    }>;
  }> {
    const stats: Array<{
      name: string;
      waiting: number;
      active: number;
      completed: number;
      failed: number;
    }> = [];

    if (this.isInitialized) {
      for (const [name, queue] of this.queues.entries()) {
        try {
          const counts = await queue.getJobCounts();
          stats.push({
            name,
            waiting: counts.waiting || 0,
            active: counts.active || 0,
            completed: counts.completed || 0,
            failed: counts.failed || 0,
          });
        } catch (error) {
          console.warn(`キュー ${name} の統計取得に失敗:`, error);
        }
      }
    }

    return {
      isInitialized: this.isInitialized,
      queues: stats,
    };
  }
}

// シングルトンインスタンス
export const revaluationJobManager = new RevaluationJobManager();
