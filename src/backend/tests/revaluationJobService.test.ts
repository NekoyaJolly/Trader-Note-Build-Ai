/**
 * 再評価ジョブサービステスト
 * 
 * 目的: ジョブキュー基盤の動作検証
 * 
 * テスト内容:
 * - ジョブの作成と DB 記録
 * - ステータス更新
 * - ペンディングジョブの取得
 * - 統計情報取得
 * 
 * 注: Redis 未接続環境でもテスト可能な設計
 */

import { PrismaClient } from '@prisma/client';
import {
  RevaluationJobManager,
  revaluationJobManager,
} from '../../services/revaluationJobService';
import { isRedisAvailable } from '../../config/queueConfig';

const prisma = new PrismaClient();

describe('RevaluationJobService', () => {
  // リモートDB接続のためタイムアウトを延長
  jest.setTimeout(30000);

  // テスト用のジョブ ID を追跡
  const createdJobIds: string[] = [];

  afterAll(async () => {
    // テストで作成したジョブを削除
    if (createdJobIds.length > 0) {
      await prisma.revaluationJob.deleteMany({
        where: {
          id: { in: createdJobIds },
        },
      });
    }
    await prisma.$disconnect();
  });

  describe('ジョブ作成', () => {
    it('ノート再生成ジョブを作成できる', async () => {
      const jobId = await revaluationJobManager.createJob(
        'note_regenerate',
        undefined,
        'BTCUSD'
      );
      createdJobIds.push(jobId);

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');

      // DB に記録されていることを確認
      const job = await prisma.revaluationJob.findUnique({
        where: { id: jobId },
      });
      expect(job).not.toBeNull();
      expect(job?.jobType).toBe('note_regenerate');
      expect(job?.targetSymbol).toBe('BTCUSD');
      expect(job?.status).toBe('pending');
    });

    it('特徴量再計算ジョブを作成できる', async () => {
      const jobId = await revaluationJobManager.createJob(
        'feature_recalculate'
      );
      createdJobIds.push(jobId);

      const job = await prisma.revaluationJob.findUnique({
        where: { id: jobId },
      });
      expect(job?.jobType).toBe('feature_recalculate');
    });

    it('特定ノート向けジョブを作成できる', async () => {
      const targetNoteId = '00000000-0000-0000-0000-000000000001';
      const jobId = await revaluationJobManager.createJob(
        'ai_summary_regenerate',
        targetNoteId
      );
      createdJobIds.push(jobId);

      const job = await prisma.revaluationJob.findUnique({
        where: { id: jobId },
      });
      expect(job?.targetNoteId).toBe(targetNoteId);
    });
  });

  describe('ステータス更新', () => {
    it('ジョブステータスを更新できる', async () => {
      const jobId = await revaluationJobManager.createJob('full_reprocess');
      createdJobIds.push(jobId);

      // running に更新
      await revaluationJobManager.updateJobStatus(jobId, 'running', {
        startedAt: new Date(),
        totalCount: 100,
      });

      let job = await prisma.revaluationJob.findUnique({
        where: { id: jobId },
      });
      expect(job?.status).toBe('running');
      expect(job?.totalCount).toBe(100);

      // completed に更新
      await revaluationJobManager.updateJobStatus(jobId, 'completed', {
        processedCount: 100,
        completedAt: new Date(),
      });

      job = await prisma.revaluationJob.findUnique({
        where: { id: jobId },
      });
      expect(job?.status).toBe('completed');
      expect(job?.processedCount).toBe(100);
    });

    it('エラーメッセージを記録できる', async () => {
      const jobId = await revaluationJobManager.createJob('note_regenerate');
      createdJobIds.push(jobId);

      await revaluationJobManager.updateJobStatus(jobId, 'failed', {
        errorMessage: 'Test error message',
      });

      const job = await prisma.revaluationJob.findUnique({
        where: { id: jobId },
      });
      expect(job?.status).toBe('failed');
      expect(job?.errorMessage).toBe('Test error message');
    });
  });

  describe('ジョブ進捗取得', () => {
    it('ジョブの進捗を取得できる', async () => {
      const jobId = await revaluationJobManager.createJob('feature_recalculate');
      createdJobIds.push(jobId);

      await revaluationJobManager.updateJobStatus(jobId, 'running', {
        totalCount: 100,
        processedCount: 50,
      });

      const progress = await revaluationJobManager.getJobProgress(jobId);

      expect(progress).not.toBeNull();
      expect(progress?.status).toBe('running');
      expect(progress?.processedCount).toBe(50);
      expect(progress?.totalCount).toBe(100);
      expect(progress?.progress).toBe(50);
    });

    it('存在しないジョブは null を返す', async () => {
      const progress = await revaluationJobManager.getJobProgress(
        '00000000-0000-0000-0000-000000000000'
      );
      expect(progress).toBeNull();
    });
  });

  describe('ペンディングジョブ取得', () => {
    it('ペンディング状態のジョブを取得できる', async () => {
      // ペンディングジョブを作成
      const jobId1 = await revaluationJobManager.createJob('note_regenerate');
      const jobId2 = await revaluationJobManager.createJob('feature_recalculate');
      createdJobIds.push(jobId1, jobId2);

      // 1 つを running に変更
      await revaluationJobManager.updateJobStatus(jobId1, 'running');

      const pendingJobs = await revaluationJobManager.getPendingJobs(10);

      // jobId2 はまだ pending のはず
      const pending2 = pendingJobs.find(j => j.id === jobId2);
      expect(pending2).toBeDefined();

      // jobId1 は running なので含まれない
      const pending1 = pendingJobs.find(j => j.id === jobId1);
      expect(pending1).toBeUndefined();
    });
  });

  describe('キュー統計', () => {
    it('キュー統計を取得できる', async () => {
      const stats = await revaluationJobManager.getQueueStats();

      expect(stats).toHaveProperty('isInitialized');
      expect(stats).toHaveProperty('queues');
      expect(Array.isArray(stats.queues)).toBe(true);

      // Redis 未設定の場合は isInitialized = false
      if (!isRedisAvailable()) {
        expect(stats.isInitialized).toBe(false);
      }
    });
  });

  describe('Redis 未設定時の動作', () => {
    it('Redis 未設定でもジョブは DB に記録される', async () => {
      // Redis が設定されていなくても DB にはジョブが作成される
      const jobId = await revaluationJobManager.createJob('note_regenerate');
      createdJobIds.push(jobId);

      const job = await prisma.revaluationJob.findUnique({
        where: { id: jobId },
      });
      expect(job).not.toBeNull();
    });
  });
});
