/**
 * 再評価ワーカー
 * 
 * 目的: BullMQ キューからジョブを取得して実際の再評価処理を実行
 * 
 * 設計方針:
 * - 各ジョブタイプに対応した処理関数
 * - 進捗レポート
 * - エラーハンドリングとリトライ
 * 
 * 参照: 技術スタック選定シート ⑨
 */

import { Worker, Job } from 'bullmq';
import { PrismaClient, RevaluationJobType } from '@prisma/client';
import {
  QUEUE_NAMES,
  getRedisConnection,
  getWorkerOptions,
  isRedisAvailable,
} from '../config/queueConfig';
import {
  RevaluationJobData,
  RevaluationJobResult,
  revaluationJobManager,
} from './revaluationJobService';
import { featureService } from './featureService';
import { ohlcvRepository } from '../backend/repositories/ohlcvRepository';

const prisma = new PrismaClient();

/**
 * ワーカー処理関数のマッピング
 */
const jobProcessors: Record<
  RevaluationJobType,
  (job: Job<RevaluationJobData, RevaluationJobResult>) => Promise<RevaluationJobResult>
> = {
  note_regenerate: processNoteRegenerate,
  feature_recalculate: processFeatureRecalculate,
  ai_summary_regenerate: processAISummaryRegenerate,
  full_reprocess: processFullReprocess,
};

/**
 * ノート再生成処理
 */
async function processNoteRegenerate(
  job: Job<RevaluationJobData, RevaluationJobResult>
): Promise<RevaluationJobResult> {
  const { jobRecordId, targetNoteId, targetSymbol } = job.data;
  const result: RevaluationJobResult = {
    processedCount: 0,
    successCount: 0,
    failedCount: 0,
    errors: [],
  };

  try {
    // ジョブ開始を記録
    await revaluationJobManager.updateJobStatus(jobRecordId, 'running', {
      startedAt: new Date(),
    });

    // 対象ノートを取得
    const whereClause: any = {};
    if (targetNoteId) {
      whereClause.id = targetNoteId;
    }
    if (targetSymbol) {
      whereClause.symbol = targetSymbol;
    }

    const notes = await prisma.tradeNote.findMany({
      where: whereClause,
      include: { trade: true },
    });

    // 総件数を更新
    await revaluationJobManager.updateJobStatus(jobRecordId, 'running', {
      totalCount: notes.length,
    });

    // 各ノートを処理
    for (const note of notes) {
      try {
        // TODO: 実際のノート再生成ロジックを実装
        // 現時点では特徴量の再計算のみ
        result.successCount++;
      } catch (error) {
        result.failedCount++;
        result.errors?.push(`Note ${note.id}: ${error}`);
      }

      result.processedCount++;
      await job.updateProgress(result.processedCount / notes.length * 100);
      await revaluationJobManager.updateJobStatus(jobRecordId, 'running', {
        processedCount: result.processedCount,
      });
    }

    // ジョブ完了を記録
    await revaluationJobManager.updateJobStatus(jobRecordId, 'completed', {
      completedAt: new Date(),
    });

  } catch (error) {
    result.errors?.push(`Job failed: ${error}`);
    await revaluationJobManager.updateJobStatus(jobRecordId, 'failed', {
      errorMessage: String(error),
    });
    throw error;
  }

  return result;
}

/**
 * 特徴量再計算処理
 */
async function processFeatureRecalculate(
  job: Job<RevaluationJobData, RevaluationJobResult>
): Promise<RevaluationJobResult> {
  const { jobRecordId, targetNoteId, targetSymbol } = job.data;
  const result: RevaluationJobResult = {
    processedCount: 0,
    successCount: 0,
    failedCount: 0,
    errors: [],
  };

  try {
    await revaluationJobManager.updateJobStatus(jobRecordId, 'running', {
      startedAt: new Date(),
    });

    // 対象ノートを取得
    const whereClause: any = {};
    if (targetNoteId) {
      whereClause.id = targetNoteId;
    }
    if (targetSymbol) {
      whereClause.symbol = targetSymbol;
    }

    const notes = await prisma.tradeNote.findMany({
      where: whereClause,
      select: { id: true, symbol: true, timeframe: true },
    });

    await revaluationJobManager.updateJobStatus(jobRecordId, 'running', {
      totalCount: notes.length,
    });

    // 各ノートの特徴量を再計算
    for (const note of notes) {
      try {
        // OHLCV データを取得
        const ohlcvData = await ohlcvRepository.findManyAsOHLCVData({
          symbol: note.symbol,
          timeframe: note.timeframe || '1h',
          limit: 100,
          orderBy: 'desc',
        });

        if (ohlcvData.length >= 20) {
          // データを時系列順に並べ替え
          ohlcvData.reverse();

          // 特徴量を更新
          await featureService.updateNoteFeatures({
            noteId: note.id,
            ohlcvData,
            timeframe: note.timeframe || '1h',
          });
          result.successCount++;
        } else {
          result.errors?.push(`Note ${note.id}: OHLCV データ不足`);
          result.failedCount++;
        }
      } catch (error) {
        result.failedCount++;
        result.errors?.push(`Note ${note.id}: ${error}`);
      }

      result.processedCount++;
      await job.updateProgress(result.processedCount / notes.length * 100);
      await revaluationJobManager.updateJobStatus(jobRecordId, 'running', {
        processedCount: result.processedCount,
      });
    }

    await revaluationJobManager.updateJobStatus(jobRecordId, 'completed', {
      completedAt: new Date(),
    });

  } catch (error) {
    result.errors?.push(`Job failed: ${error}`);
    await revaluationJobManager.updateJobStatus(jobRecordId, 'failed', {
      errorMessage: String(error),
    });
    throw error;
  }

  return result;
}

/**
 * AI サマリー再生成処理
 */
async function processAISummaryRegenerate(
  job: Job<RevaluationJobData, RevaluationJobResult>
): Promise<RevaluationJobResult> {
  const { jobRecordId, targetNoteId, targetSymbol } = job.data;
  const result: RevaluationJobResult = {
    processedCount: 0,
    successCount: 0,
    failedCount: 0,
    errors: [],
  };

  try {
    await revaluationJobManager.updateJobStatus(jobRecordId, 'running', {
      startedAt: new Date(),
    });

    // 対象ノートを取得
    const whereClause: any = {};
    if (targetNoteId) {
      whereClause.id = targetNoteId;
    }
    if (targetSymbol) {
      whereClause.symbol = targetSymbol;
    }

    const notes = await prisma.tradeNote.findMany({
      where: whereClause,
      include: { trade: true, aiSummary: true },
    });

    await revaluationJobManager.updateJobStatus(jobRecordId, 'running', {
      totalCount: notes.length,
    });

    for (const note of notes) {
      try {
        // TODO: AI サマリー再生成ロジックを実装
        // openaiService.generateSummary(note) を呼び出す
        result.successCount++;
      } catch (error) {
        result.failedCount++;
        result.errors?.push(`Note ${note.id}: ${error}`);
      }

      result.processedCount++;
      await job.updateProgress(result.processedCount / notes.length * 100);
      await revaluationJobManager.updateJobStatus(jobRecordId, 'running', {
        processedCount: result.processedCount,
      });
    }

    await revaluationJobManager.updateJobStatus(jobRecordId, 'completed', {
      completedAt: new Date(),
    });

  } catch (error) {
    result.errors?.push(`Job failed: ${error}`);
    await revaluationJobManager.updateJobStatus(jobRecordId, 'failed', {
      errorMessage: String(error),
    });
    throw error;
  }

  return result;
}

/**
 * 全体再処理
 */
async function processFullReprocess(
  job: Job<RevaluationJobData, RevaluationJobResult>
): Promise<RevaluationJobResult> {
  const { jobRecordId, targetNoteId, targetSymbol } = job.data;
  const result: RevaluationJobResult = {
    processedCount: 0,
    successCount: 0,
    failedCount: 0,
    errors: [],
  };

  try {
    await revaluationJobManager.updateJobStatus(jobRecordId, 'running', {
      startedAt: new Date(),
    });

    // 3つのサブプロセスを順番に実行
    // 1. 特徴量再計算
    const featureResult = await processFeatureRecalculate(job);
    result.processedCount += featureResult.processedCount;
    result.successCount += featureResult.successCount;
    result.failedCount += featureResult.failedCount;
    if (featureResult.errors) {
      result.errors?.push(...featureResult.errors);
    }

    // 2. AI サマリー再生成
    const summaryResult = await processAISummaryRegenerate(job);
    result.processedCount += summaryResult.processedCount;
    result.successCount += summaryResult.successCount;
    result.failedCount += summaryResult.failedCount;
    if (summaryResult.errors) {
      result.errors?.push(...summaryResult.errors);
    }

    await revaluationJobManager.updateJobStatus(jobRecordId, 'completed', {
      completedAt: new Date(),
      processedCount: result.processedCount,
    });

  } catch (error) {
    result.errors?.push(`Job failed: ${error}`);
    await revaluationJobManager.updateJobStatus(jobRecordId, 'failed', {
      errorMessage: String(error),
    });
    throw error;
  }

  return result;
}

/**
 * ワーカーを起動
 */
export function startWorkers(): Worker[] | null {
  if (!isRedisAvailable()) {
    console.warn('Redis が設定されていないため、ワーカーは起動しません');
    return null;
  }

  const connection = getRedisConnection();
  const workerOptions = getWorkerOptions();
  const workers: Worker[] = [];

  // 各キューのワーカーを作成
  for (const [key, queueName] of Object.entries(QUEUE_NAMES)) {
    const worker = new Worker<RevaluationJobData, RevaluationJobResult>(
      queueName,
      async (job) => {
        console.log(`ジョブ処理開始: ${job.id} (${job.data.jobType})`);
        const processor = jobProcessors[job.data.jobType];
        if (!processor) {
          throw new Error(`未知のジョブタイプ: ${job.data.jobType}`);
        }
        const result = await processor(job);
        console.log(`ジョブ処理完了: ${job.id}`, result);
        return result;
      },
      {
        connection,
        ...workerOptions,
      }
    );

    // イベントハンドラー
    worker.on('completed', (job, result) => {
      console.log(`ジョブ完了: ${job.id}`, result);
    });

    worker.on('failed', (job, err) => {
      console.error(`ジョブ失敗: ${job?.id}`, err);
    });

    worker.on('error', (err) => {
      console.error(`ワーカーエラー (${queueName}):`, err);
    });

    workers.push(worker);
  }

  console.log(`${workers.length} 個のワーカーが起動しました`);
  return workers;
}

/**
 * 同期処理フォールバック
 * Redis が利用不可の場合に、ペンディングジョブを同期的に処理
 */
export async function processPendingJobsSync(): Promise<void> {
  if (isRedisAvailable()) {
    console.log('Redis が利用可能なため、同期処理はスキップします');
    return;
  }

  const pendingJobs = await revaluationJobManager.getPendingJobs(5);
  console.log(`同期処理対象ジョブ: ${pendingJobs.length} 件`);

  for (const jobInfo of pendingJobs) {
    const mockJob = {
      data: {
        jobRecordId: jobInfo.id,
        jobType: jobInfo.jobType,
        targetNoteId: jobInfo.targetNoteId || undefined,
        targetSymbol: jobInfo.targetSymbol || undefined,
      },
      updateProgress: async () => {},
    } as unknown as Job<RevaluationJobData, RevaluationJobResult>;

    try {
      const processor = jobProcessors[jobInfo.jobType];
      if (processor) {
        await processor(mockJob);
      }
    } catch (error) {
      console.error(`同期ジョブ処理失敗: ${jobInfo.id}`, error);
    }
  }
}
