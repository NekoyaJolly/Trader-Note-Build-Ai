/**
 * ストラテジーアラートサービス
 * 
 * 目的:
 * - ストラテジー条件成立時のリアルタイム通知管理
 * - アラート設定のCRUD操作
 * - クールダウン制御による連続通知抑制
 * - アプリ内通知 + Web Push 対応
 */

import { PrismaClient, AlertChannel, AlertStatus, StrategyAlert, StrategyAlertLog } from '@prisma/client';

// Prismaクライアントのシングルトンインスタンス
const prisma = new PrismaClient();

// ============================================
// 型定義
// ============================================

/** アラート設定作成リクエスト */
export interface CreateAlertRequest {
  /** 対象ストラテジーID */
  strategyId: string;
  /** 有効/無効 */
  enabled?: boolean;
  /** クールダウン時間（分） */
  cooldownMinutes?: number;
  /** 通知チャネル */
  channels?: AlertChannel[];
  /** 最小一致スコア */
  minMatchScore?: number;
}

/** アラート設定更新リクエスト */
export interface UpdateAlertRequest {
  /** 有効/無効 */
  enabled?: boolean;
  /** クールダウン時間（分） */
  cooldownMinutes?: number;
  /** 通知チャネル */
  channels?: AlertChannel[];
  /** 最小一致スコア */
  minMatchScore?: number;
}

/** アラート発火リクエスト */
export interface TriggerAlertRequest {
  /** 対象ストラテジーID */
  strategyId: string;
  /** 一致スコア（0.0〜1.0） */
  matchScore: number;
  /** 条件成立時のインジケーター値 */
  indicatorValues: Record<string, unknown>;
}

/** アラート発火結果 */
export interface TriggerAlertResult {
  /** 通知が送信されたかどうか */
  triggered: boolean;
  /** スキップ理由（送信されなかった場合） */
  skipReason?: string;
  /** 送信されたチャネル */
  sentChannels?: AlertChannel[];
  /** 発火ログID */
  logIds?: string[];
}

/** アラート設定詳細（リレーション込み） */
export interface AlertWithStrategy extends StrategyAlert {
  strategy: {
    id: string;
    name: string;
    symbol: string;
  };
}

/** アラートログ詳細 */
export interface AlertLogDetail extends StrategyAlertLog {
  alert: {
    id: string;
    strategyId: string;
  };
}

// ============================================
// アラート設定管理
// ============================================

/**
 * ストラテジーのアラート設定を取得
 * 存在しない場合はnullを返す
 */
export async function getStrategyAlert(strategyId: string): Promise<AlertWithStrategy | null> {
  const alert = await prisma.strategyAlert.findUnique({
    where: { strategyId },
    include: {
      strategy: {
        select: {
          id: true,
          name: true,
          symbol: true,
        },
      },
    },
  });

  return alert;
}

/**
 * ストラテジーのアラート設定を作成
 * 既存の場合はエラー
 */
export async function createStrategyAlert(request: CreateAlertRequest): Promise<StrategyAlert> {
  // 既存チェック
  const existing = await prisma.strategyAlert.findUnique({
    where: { strategyId: request.strategyId },
  });
  if (existing) {
    throw new Error(`ストラテジー ${request.strategyId} にはすでにアラート設定が存在します`);
  }

  // ストラテジー存在チェック
  const strategy = await prisma.strategy.findUnique({
    where: { id: request.strategyId },
  });
  if (!strategy) {
    throw new Error(`ストラテジー ${request.strategyId} が見つかりません`);
  }

  const alert = await prisma.strategyAlert.create({
    data: {
      strategyId: request.strategyId,
      enabled: request.enabled ?? true,
      cooldownMinutes: request.cooldownMinutes ?? 60,
      channels: request.channels ?? [AlertChannel.in_app],
      minMatchScore: request.minMatchScore ?? 0.7,
    },
  });

  console.log(`[StrategyAlertService] アラート設定作成: ${strategy.name} (${alert.id})`);
  return alert;
}

/**
 * ストラテジーのアラート設定を更新
 */
export async function updateStrategyAlert(
  strategyId: string,
  request: UpdateAlertRequest
): Promise<StrategyAlert> {
  const existing = await prisma.strategyAlert.findUnique({
    where: { strategyId },
  });
  if (!existing) {
    throw new Error(`ストラテジー ${strategyId} のアラート設定が見つかりません`);
  }

  const updated = await prisma.strategyAlert.update({
    where: { strategyId },
    data: {
      enabled: request.enabled,
      cooldownMinutes: request.cooldownMinutes,
      channels: request.channels,
      minMatchScore: request.minMatchScore,
    },
  });

  console.log(`[StrategyAlertService] アラート設定更新: ${strategyId}`);
  return updated;
}

/**
 * ストラテジーのアラート設定を削除
 */
export async function deleteStrategyAlert(strategyId: string): Promise<void> {
  const existing = await prisma.strategyAlert.findUnique({
    where: { strategyId },
  });
  if (!existing) {
    throw new Error(`ストラテジー ${strategyId} のアラート設定が見つかりません`);
  }

  await prisma.strategyAlert.delete({
    where: { strategyId },
  });

  console.log(`[StrategyAlertService] アラート設定削除: ${strategyId}`);
}

/**
 * 有効なアラート設定一覧を取得
 */
export async function listEnabledAlerts(): Promise<AlertWithStrategy[]> {
  const alerts = await prisma.strategyAlert.findMany({
    where: {
      enabled: true,
      status: AlertStatus.enabled,
    },
    include: {
      strategy: {
        select: {
          id: true,
          name: true,
          symbol: true,
        },
      },
    },
  });

  return alerts;
}

// ============================================
// アラート発火
// ============================================

/**
 * アラートを発火（条件チェック + 通知送信）
 * 
 * 処理フロー:
 * 1. アラート設定の存在・有効性チェック
 * 2. 最小一致スコアのチェック
 * 3. クールダウンチェック
 * 4. 各チャネルへの通知送信
 * 5. ログ記録
 */
export async function triggerAlert(request: TriggerAlertRequest): Promise<TriggerAlertResult> {
  const { strategyId, matchScore, indicatorValues } = request;

  // 1. アラート設定を取得
  const alert = await prisma.strategyAlert.findUnique({
    where: { strategyId },
    include: {
      strategy: {
        select: { name: true, symbol: true },
      },
    },
  });

  if (!alert) {
    return {
      triggered: false,
      skipReason: 'アラート設定が存在しません',
    };
  }

  // 2. 有効性チェック
  if (!alert.enabled || alert.status !== AlertStatus.enabled) {
    return {
      triggered: false,
      skipReason: `アラートが無効化されています (enabled: ${alert.enabled}, status: ${alert.status})`,
    };
  }

  // 3. 最小一致スコアチェック
  if (matchScore < alert.minMatchScore) {
    return {
      triggered: false,
      skipReason: `一致スコア不足: ${(matchScore * 100).toFixed(1)}% < ${(alert.minMatchScore * 100).toFixed(1)}%`,
    };
  }

  // 4. クールダウンチェック
  if (alert.lastTriggeredAt) {
    const cooldownMs = alert.cooldownMinutes * 60 * 1000;
    const timeSinceLastTrigger = Date.now() - alert.lastTriggeredAt.getTime();
    
    if (timeSinceLastTrigger < cooldownMs) {
      const remainingMs = cooldownMs - timeSinceLastTrigger;
      const remainingMinutes = Math.ceil(remainingMs / 60000);
      return {
        triggered: false,
        skipReason: `クールダウン中: あと${remainingMinutes}分`,
      };
    }
  }

  // 5. 各チャネルへ通知送信
  const sentChannels: AlertChannel[] = [];
  const logIds: string[] = [];

  for (const channel of alert.channels) {
    try {
      const success = await sendAlertNotification({
        channel,
        strategyName: alert.strategy.name,
        symbol: alert.strategy.symbol,
        matchScore,
        indicatorValues,
      });

      // ログ記録
      const log = await prisma.strategyAlertLog.create({
        data: {
          alertId: alert.id,
          matchScore,
          indicatorValues: indicatorValues as object,
          channel,
          success,
          errorMessage: success ? null : '送信失敗',
        },
      });
      logIds.push(log.id);

      if (success) {
        sentChannels.push(channel);
      }
    } catch (error) {
      // エラーログを記録
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      const log = await prisma.strategyAlertLog.create({
        data: {
          alertId: alert.id,
          matchScore,
          indicatorValues: indicatorValues as object,
          channel,
          success: false,
          errorMessage,
        },
      });
      logIds.push(log.id);
      console.error(`[StrategyAlertService] ${channel}通知エラー:`, errorMessage);
    }
  }

  // 6. 最終発火時刻を更新
  if (sentChannels.length > 0) {
    await prisma.strategyAlert.update({
      where: { id: alert.id },
      data: { lastTriggeredAt: new Date() },
    });
  }

  return {
    triggered: sentChannels.length > 0,
    sentChannels,
    logIds,
  };
}

// ============================================
// 通知送信（チャネル別）
// ============================================

interface SendNotificationParams {
  channel: AlertChannel;
  strategyName: string;
  symbol: string;
  matchScore: number;
  indicatorValues: Record<string, unknown>;
}

/**
 * チャネル別の通知送信
 */
async function sendAlertNotification(params: SendNotificationParams): Promise<boolean> {
  const { channel, strategyName, symbol, matchScore } = params;

  switch (channel) {
    case AlertChannel.in_app:
      return await sendInAppNotification(params);
    
    case AlertChannel.web_push:
      return await sendWebPushNotification(params);
    
    default:
      console.warn(`[StrategyAlertService] 未対応のチャネル: ${channel}`);
      return false;
  }
}

/**
 * アプリ内通知を送信
 * data/notifications.json に追記
 */
async function sendInAppNotification(params: SendNotificationParams): Promise<boolean> {
  const { strategyName, symbol, matchScore, indicatorValues } = params;
  
  try {
    // data/notifications.json に追記
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const notificationsPath = path.join(process.cwd(), 'data', 'notifications.json');
    
    let notifications: unknown[] = [];
    try {
      const content = await fs.readFile(notificationsPath, 'utf-8');
      notifications = JSON.parse(content);
    } catch {
      // ファイルが存在しない場合は空配列で開始
      notifications = [];
    }

    const newNotification = {
      id: crypto.randomUUID(),
      type: 'strategy_alert',
      title: `ストラテジー条件成立: ${strategyName}`,
      message: `${symbol}でストラテジー条件が成立しました（一致度: ${(matchScore * 100).toFixed(1)}%）`,
      strategyAlert: {
        strategyName,
        symbol,
        matchScore,
        indicatorValues,
      },
      timestamp: new Date().toISOString(),
      read: false,
    };

    notifications.push(newNotification);
    
    // 最新100件のみ保持
    if (notifications.length > 100) {
      notifications = notifications.slice(-100);
    }

    await fs.writeFile(notificationsPath, JSON.stringify(notifications, null, 2), 'utf-8');
    
    console.log(`[StrategyAlertService] アプリ内通知送信: ${strategyName} (${symbol})`);
    return true;
  } catch (error) {
    console.error('[StrategyAlertService] アプリ内通知エラー:', error);
    return false;
  }
}

/**
 * Web Push通知を送信
 * 既存のPushSubscriptionを使用
 */
async function sendWebPushNotification(params: SendNotificationParams): Promise<boolean> {
  const { strategyName, symbol, matchScore } = params;
  
  try {
    // 有効なPush購読を取得
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { active: true },
    });

    if (subscriptions.length === 0) {
      console.log('[StrategyAlertService] 有効なPush購読がありません');
      return true; // エラーではないのでtrueを返す
    }

    // Web Push送信（webpush ライブラリを使用）
    // 注: 実際の実装では web-push パッケージを使用
    // ここではログのみ出力（MVPでは簡易実装）
    console.log(`[StrategyAlertService] Web Push送信: ${subscriptions.length}件の購読に送信`);
    console.log(`  - ストラテジー: ${strategyName}`);
    console.log(`  - シンボル: ${symbol}`);
    console.log(`  - 一致度: ${(matchScore * 100).toFixed(1)}%`);

    // 実際のPush送信は将来実装
    // const webpush = await import('web-push');
    // for (const sub of subscriptions) { ... }

    return true;
  } catch (error) {
    console.error('[StrategyAlertService] Web Push通知エラー:', error);
    return false;
  }
}

// ============================================
// アラートログ取得
// ============================================

/**
 * ストラテジーのアラート発火履歴を取得
 */
export async function getAlertLogs(
  strategyId: string,
  limit: number = 50
): Promise<StrategyAlertLog[]> {
  const alert = await prisma.strategyAlert.findUnique({
    where: { strategyId },
  });

  if (!alert) {
    return [];
  }

  const logs = await prisma.strategyAlertLog.findMany({
    where: { alertId: alert.id },
    orderBy: { triggeredAt: 'desc' },
    take: limit,
  });

  return logs;
}

/**
 * アラートステータスを一時停止に変更
 */
export async function pauseAlert(strategyId: string): Promise<StrategyAlert> {
  return await prisma.strategyAlert.update({
    where: { strategyId },
    data: { status: AlertStatus.paused },
  });
}

/**
 * アラートステータスを有効に復帰
 */
export async function resumeAlert(strategyId: string): Promise<StrategyAlert> {
  return await prisma.strategyAlert.update({
    where: { strategyId },
    data: { status: AlertStatus.enabled },
  });
}
