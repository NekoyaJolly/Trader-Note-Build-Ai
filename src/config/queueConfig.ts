/**
 * ジョブキュー設定
 * 
 * 目的: BullMQ を使用した非同期ジョブ処理の設定
 * 
 * 設計方針:
 * - Redis 接続設定の一元管理
 * - キュー名の定数管理
 * - 環境変数による設定切り替え
 * 
 * 参照: 技術スタック選定シート ⑨
 */

import { ConnectionOptions, QueueOptions, WorkerOptions } from 'bullmq';

/**
 * キュー名の定義
 */
export const QUEUE_NAMES = {
  /** ノート再生成キュー */
  NOTE_REGENERATE: 'note-regenerate',
  /** 特徴量再計算キュー */
  FEATURE_RECALCULATE: 'feature-recalculate',
  /** AI サマリー再生成キュー */
  AI_SUMMARY_REGENERATE: 'ai-summary-regenerate',
  /** 全体再処理キュー */
  FULL_REPROCESS: 'full-reprocess',
} as const;

/**
 * ジョブ優先度の定義
 */
export const JOB_PRIORITIES = {
  /** 高優先度（ユーザー明示リクエスト） */
  HIGH: 1,
  /** 通常優先度（日次バッチ） */
  NORMAL: 5,
  /** 低優先度（バックグラウンド処理） */
  LOW: 10,
} as const;

/**
 * Redis 接続設定
 * 環境変数から読み込み、ローカル開発用デフォルト値を設定
 */
export const getRedisConnection = (): ConnectionOptions => {
  const redisUrl = process.env.REDIS_URL;
  
  if (redisUrl) {
    // Redis URL が設定されている場合はパース
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      password: url.password || undefined,
      username: url.username || undefined,
    };
  }

  // ローカル開発用デフォルト設定
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
  };
};

/**
 * キュー共通オプション
 */
export const getQueueOptions = (): Partial<QueueOptions> => ({
  defaultJobOptions: {
    // 失敗時のリトライ設定
    attempts: 3,
    // 指数バックオフ
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    // ジョブ保持期間（完了後 24 時間）
    removeOnComplete: {
      age: 24 * 60 * 60,
      count: 1000,
    },
    // 失敗ジョブ保持期間（7 日）
    removeOnFail: {
      age: 7 * 24 * 60 * 60,
    },
  },
});

/**
 * ワーカー共通オプション
 */
export const getWorkerOptions = (): Partial<WorkerOptions> => ({
  // 同時処理数
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || '3'),
  // ロックタイムアウト（5 分）
  lockDuration: 5 * 60 * 1000,
});

/**
 * Redis 接続が利用可能かチェック
 * 
 * @returns Redis が利用可能な場合 true
 */
export const isRedisAvailable = (): boolean => {
  return !!(
    process.env.REDIS_URL ||
    process.env.REDIS_HOST ||
    process.env.ENABLE_JOB_QUEUE === 'true'
  );
};
