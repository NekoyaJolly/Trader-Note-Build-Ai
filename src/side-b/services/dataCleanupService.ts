/**
 * データクリーンアップサービス
 * 
 * 目的: 古いデータの自動クリーンアップによるディスク容量節約
 * 
 * 対象データ:
 * - 期限切れリサーチ（expiresAt が過去のもの）
 * - 古いトレードプラン（デフォルト30日以上前）
 * - 完了した古い仮想トレード（デフォルト90日以上前）
 * 
 * 実行タイミング:
 * - sideBScheduler から日次で自動実行
 * - 手動でも実行可能（API経由）
 */

import { researchRepository } from '../repositories/researchRepository';
import { planRepository } from '../repositories/planRepository';
import { prisma } from '../../backend/db/client';

// ===========================================
// 型定義
// ===========================================

/**
 * クリーンアップ設定
 */
export interface CleanupConfig {
  // リサーチの期限切れ削除を有効にするか
  cleanupExpiredResearch: boolean;
  // 古いプランの削除を有効にするか
  cleanupOldPlans: boolean;
  // 古いプランの保持日数（デフォルト: 30日）
  planRetentionDays: number;
  // 完了した古いトレードの削除を有効にするか
  cleanupOldTrades: boolean;
  // 完了トレードの保持日数（デフォルト: 90日）
  tradeRetentionDays: number;
}

/**
 * クリーンアップ結果
 */
export interface CleanupResult {
  success: boolean;
  expiredResearchCount: number;
  oldPlansCount: number;
  oldTradesCount: number;
  errors: string[];
  timestamp: Date;
}

/**
 * デフォルト設定
 */
const DEFAULT_CONFIG: CleanupConfig = {
  cleanupExpiredResearch: true,
  cleanupOldPlans: true,
  planRetentionDays: 30,
  cleanupOldTrades: true,
  tradeRetentionDays: 90,
};

// ===========================================
// メイン関数
// ===========================================

/**
 * データクリーンアップを実行
 * 
 * @param config - クリーンアップ設定（省略時はデフォルト）
 * @returns クリーンアップ結果
 */
export async function executeCleanup(
  config: Partial<CleanupConfig> = {}
): Promise<CleanupResult> {
  const mergedConfig: CleanupConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const result: CleanupResult = {
    success: true,
    expiredResearchCount: 0,
    oldPlansCount: 0,
    oldTradesCount: 0,
    errors: [],
    timestamp: new Date(),
  };

  // 1. 期限切れリサーチの削除
  if (mergedConfig.cleanupExpiredResearch) {
    try {
      result.expiredResearchCount = await researchRepository.deleteExpired();
      if (result.expiredResearchCount > 0) {
        console.log(`[Cleanup] 期限切れリサーチを ${result.expiredResearchCount} 件削除`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '不明なエラー';
      result.errors.push(`リサーチ削除: ${message}`);
    }
  }

  // 2. 古いプランの削除
  if (mergedConfig.cleanupOldPlans) {
    try {
      const beforeDate = new Date();
      beforeDate.setDate(beforeDate.getDate() - mergedConfig.planRetentionDays);
      
      result.oldPlansCount = await planRepository.deleteOlderThan(beforeDate);
      if (result.oldPlansCount > 0) {
        console.log(`[Cleanup] ${mergedConfig.planRetentionDays}日以上前のプランを ${result.oldPlansCount} 件削除`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '不明なエラー';
      result.errors.push(`プラン削除: ${message}`);
    }
  }

  // 3. 完了した古い仮想トレードの削除
  if (mergedConfig.cleanupOldTrades) {
    try {
      const beforeDate = new Date();
      beforeDate.setDate(beforeDate.getDate() - mergedConfig.tradeRetentionDays);
      
      // closed/cancelled トレードのみ削除（pending/open は保持）
      const deleteResult = await prisma.virtualTrade.deleteMany({
        where: {
          AND: [
            { status: { in: ['closed', 'cancelled'] } },
            { exitedAt: { lt: beforeDate } },
          ],
        },
      });
      
      result.oldTradesCount = deleteResult.count;
      if (result.oldTradesCount > 0) {
        console.log(`[Cleanup] ${mergedConfig.tradeRetentionDays}日以上前の完了トレードを ${result.oldTradesCount} 件削除`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '不明なエラー';
      result.errors.push(`トレード削除: ${message}`);
    }
  }

  // エラーがあれば失敗扱い
  if (result.errors.length > 0) {
    result.success = false;
  }

  return result;
}

/**
 * ストレージ使用量の概要を取得
 * 
 * @returns 各テーブルのレコード数
 */
export async function getStorageStats(): Promise<{
  researchCount: number;
  planCount: number;
  tradeCount: number;
  noteCount: number;
}> {
  const [researchCount, planCount, tradeCount, noteCount] = await Promise.all([
    prisma.marketResearch.count(),
    prisma.aITradePlan.count(),
    prisma.virtualTrade.count(),
    prisma.aITradeNote.count(),
  ]);

  return {
    researchCount,
    planCount,
    tradeCount,
    noteCount,
  };
}

// ===========================================
// エクスポート
// ===========================================

export const dataCleanupService = {
  executeCleanup,
  getStorageStats,
  DEFAULT_CONFIG,
};
