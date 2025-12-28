import { MatchResult, MarketSnapshot, TradeNote, NotificationLogStatus } from '@prisma/client';
import { config } from '../../config';
import { NotificationLogRepository } from '../../backend/repositories/notificationLogRepository';
import { NotificationSender } from './notificationSender';
import { InAppNotificationSender } from './inAppNotificationSender';

/**
 * 通知トリガロジック
 * 
 * 目的: Phase3 の MatchResult を受け取り、通知を送るべきかどうかを判定する
 * 責務:
 * 1. 通知スコア閾値の判定
 * 2. 再通知防止（冪等性・クールダウン・重複抑制）
 * 3. 通知ログの記録
 * 4. 実際の配信
 * 
 * 原則: **通知しない判断が正しい** ことを最優先
 */

// 通知トリガの設定定数
const NOTIFICATION_CONFIG = {
  // 通知する最小スコア
  NOTIFY_THRESHOLD: parseFloat(process.env.NOTIFY_THRESHOLD || '0.75'),
  // 通知する最小理由数
  MIN_REASONS: 1,
  // クールダウン時間（ミリ秒）：デフォルト 1 時間
  COOLDOWN_MS: parseInt(process.env.NOTIFY_COOLDOWN_MS || '3600000', 10),
  // 重複判定の許容時間差（秒）
  DUPLICATE_TOLERANCE_SEC: 5,
} as const;

export interface NotificationTriggerResult {
  // 通知が配信されたか
  shouldNotify: boolean;
  // スキップされた理由（配信しない場合）
  skipReason?: string;
  // 配信ステータス
  status: NotificationLogStatus;
  // 通知ログ ID（作成された場合）
  notificationLogId?: string;
  // In-App 通知 ID（作成された場合）
  inAppNotificationId?: string;
}

export class NotificationTriggerService {
  private notificationLogRepository: NotificationLogRepository;
  private notificationSender: NotificationSender;

  constructor(
    notificationLogRepository?: NotificationLogRepository,
    notificationSender?: NotificationSender
  ) {
    this.notificationLogRepository = notificationLogRepository || new NotificationLogRepository();
    this.notificationSender = notificationSender || new InAppNotificationSender();
  }

  /**
   * MatchResult から通知を判定・配信する
   * 
   * @param matchResult Phase3 で確定した判定結果
   * @param noteData トレードノート
   * @param snapshotData マーケットスナップショット
   * @returns 通知トリガの判定結果
   */
  async evaluateAndNotify(
    matchResult: MatchResult & { note: TradeNote; marketSnapshot: MarketSnapshot },
    channel: 'in_app' | 'push' | 'webhook' = 'in_app'
  ): Promise<NotificationTriggerResult> {
    const reasons: string[] = [];

    // ===== ステップ 1: スコア閾値チェック =====
    if (matchResult.score < NOTIFICATION_CONFIG.NOTIFY_THRESHOLD) {
      reasons.push(
        `スコア不足: ${matchResult.score.toFixed(3)} < ${NOTIFICATION_CONFIG.NOTIFY_THRESHOLD}`
      );
      return {
        shouldNotify: false,
        skipReason: reasons[0],
        status: 'skipped',
      };
    }

    // ===== ステップ 2: 理由数チェック =====
    const reasonArray = (matchResult.reasons as string[]) || [];
    if (reasonArray.length < NOTIFICATION_CONFIG.MIN_REASONS) {
      reasons.push(
        `理由不足: ${reasonArray.length} < ${NOTIFICATION_CONFIG.MIN_REASONS}`
      );
      return {
        shouldNotify: false,
        skipReason: reasons[0],
        status: 'skipped',
      };
    }

    // ===== ステップ 3: 冪等性チェック（重複通知防止） =====
    const isDuplicate = await this.notificationLogRepository.isDuplicate(
      matchResult.noteId,
      matchResult.marketSnapshotId,
      channel
    );
    if (isDuplicate) {
      reasons.push(
        `冪等性制約: noteId×snapshotId×channel の組み合わせが既に通知済み`
      );
      return {
        shouldNotify: false,
        skipReason: reasons[0],
        status: 'skipped',
      };
    }

    // ===== ステップ 4: クールダウンチェック =====
    const cooldownCheck = await this.notificationLogRepository.checkCooldown(
      matchResult.noteId,
      NOTIFICATION_CONFIG.COOLDOWN_MS
    );
    if (cooldownCheck.isInCooldown) {
      const cooldownUntil = cooldownCheck.cooldownUntil?.toISOString() || 'unknown';
      reasons.push(
        `クールダウン中: 次の通知は ${cooldownUntil} 以降`
      );
      return {
        shouldNotify: false,
        skipReason: reasons[0],
        status: 'skipped',
      };
    }

    // ===== ステップ 5: 重複抑制チェック（evaluatedAt が近い） =====
    const hasRecentDuplicate = await this.notificationLogRepository.hasRecentDuplicate(
      matchResult.noteId,
      matchResult.marketSnapshotId,
      NOTIFICATION_CONFIG.DUPLICATE_TOLERANCE_SEC
    );
    if (hasRecentDuplicate) {
      reasons.push(
        `重複抑制: ${NOTIFICATION_CONFIG.DUPLICATE_TOLERANCE_SEC} 秒以内に同じ条件の通知あり`
      );
      return {
        shouldNotify: false,
        skipReason: reasons[0],
        status: 'skipped',
      };
    }

    // ===== ステップ 6: 通知を配信 =====
    // 本番環境ではデバッグログを抑制
    const isProduction = process.env.NODE_ENV === 'production';
    if (!isProduction) {
      console.log(
        `✓ 通知条件をパス: ${matchResult.symbol} (score=${matchResult.score.toFixed(3)})`
      );
    }

    const reasonSummary = this.buildReasonSummary(reasonArray, matchResult.score);

    // In-App 通知を送信
    let inAppNotificationId: string | undefined;
    try {
      const inAppResult = await this.notificationSender.sendInApp({
        noteId: matchResult.noteId,
        marketSnapshotId: matchResult.marketSnapshotId,
        symbol: matchResult.symbol,
        score: matchResult.score,
        title: `${matchResult.symbol} トレード機会検出`,
        message: `現在の市場がトレード記録と一致しました（一致度: ${(
          matchResult.score * 100
        ).toFixed(1)}%）`,
        reasonSummary,
      });
      inAppNotificationId = inAppResult.id;
    } catch (error) {
      // エラーログは常に出力（本番でも重要な情報）
      console.error('In-App 通知送信エラー:', error);
    }

    // ===== ステップ 7: 通知ログを記録 =====
    try {
      const logEntry = await this.notificationLogRepository.upsertLog({
        noteId: matchResult.noteId,
        marketSnapshotId: matchResult.marketSnapshotId,
        symbol: matchResult.symbol,
        score: matchResult.score,
        channel,
        status: 'sent',
        reasonSummary,
        sentAt: new Date(),
      });

      return {
        shouldNotify: true,
        status: 'sent',
        notificationLogId: logEntry.id,
        inAppNotificationId,
      };
    } catch (error) {
      // エラーログは常に出力
      console.error('通知ログ記録エラー:', error);
      return {
        shouldNotify: false,
        skipReason: `通知ログ記録失敗: ${error instanceof Error ? error.message : 'unknown'}`,
        status: 'failed',
      };
    }
  }

  /**
   * 理由の配列から短い要約文を生成
   * 
   * @param reasons 理由の配列
   * @param score スコア
   * @returns 要約文
   */
  private buildReasonSummary(reasons: string[], score: number): string {
    if (!reasons || reasons.length === 0) {
      return `スコア: ${score.toFixed(3)}`;
    }

    // 最初の 3 つの理由まで含める（UI での表示スペース制約を想定）
    const selected = reasons.slice(0, 3);
    return `スコア: ${score.toFixed(3)}｜${selected.join(' ｜ ')}`;
  }

  /**
   * 環境変数から通知設定を取得（テスト用）
   */
  static getConfig() {
    return NOTIFICATION_CONFIG;
  }

  /**
   * 環境変数で閾値をオーバーライド（テスト用）
   */
  static setNotifyThreshold(threshold: number) {
    (NOTIFICATION_CONFIG as any).NOTIFY_THRESHOLD = threshold;
  }

  /**
   * クールダウンをオーバーライド（テスト用）
   */
  static setCooldownMs(ms: number) {
    (NOTIFICATION_CONFIG as any).COOLDOWN_MS = ms;
  }
}
