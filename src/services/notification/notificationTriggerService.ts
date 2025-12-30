import { NotificationLogRepository, CooldownCheckResult } from '../../backend/repositories/notificationLogRepository';

export interface NotificationTriggerInput {
  matchScore: number;
  historicalNoteId: string;
  marketSnapshot: unknown;
  marketSnapshotId?: string;
  symbol?: string;
  channel?: 'in_app' | 'push' | 'webhook';
}

export interface NotificationTriggerResult {
  shouldNotify: boolean;
  status: 'sent' | 'skipped' | 'failed';
  skipReason?: string;
  reasonSummary?: string;
  notificationLogId?: string;
}

const NOTIFICATION_THRESHOLD = parseFloat(process.env.NOTIFY_THRESHOLD || '0.75');
// クールダウン期間: 1時間（ミリ秒）
const COOLDOWN_MS = 60 * 60 * 1000;
// 重複抑制: 5秒以内の同一条件を抑止
const DUPLICATE_TOLERANCE_SEC = 5;

/**
 * 通知トリガサービス
 * 
 * 責務:
 * 1. スコア閾値判定
 * 2. 冪等性チェック（noteId × marketSnapshotId × channel）
 * 3. クールダウン検査（同一 noteId について1時間以内の再通知を抑止）
 * 4. 重複抑制（直近5秒以内の同一条件を抑止）
 * 5. NotificationLog の永続化
 */
export class NotificationTriggerService {
  private notificationLogRepository: NotificationLogRepository;

  constructor(notificationLogRepository?: NotificationLogRepository) {
    this.notificationLogRepository = notificationLogRepository || new NotificationLogRepository();
  }

  /**
   * 同期的なスコア評価のみを行う（既存互換）
   * クールダウン・重複チェックは行わない
   */
  evaluate(input: NotificationTriggerInput): NotificationTriggerResult {
    if (input.matchScore < NOTIFICATION_THRESHOLD) {
      return {
        shouldNotify: false,
        status: 'skipped',
        skipReason: `スコア不足: ${input.matchScore.toFixed(3)} < ${NOTIFICATION_THRESHOLD}`,
        reasonSummary: `スコア: ${input.matchScore.toFixed(3)}`,
      };
    }

    return {
      shouldNotify: true,
      status: 'sent',
      reasonSummary: `スコア: ${input.matchScore.toFixed(3)}`,
    };
  }

  /**
   * 完全な通知判定（スコア + 冪等性 + クールダウン + 重複抑制）を実行
   * DB への NotificationLog 永続化も行う
   */
  async evaluateWithPersistence(input: NotificationTriggerInput): Promise<NotificationTriggerResult> {
    const noteId = input.historicalNoteId;
    const marketSnapshotId = input.marketSnapshotId || '';
    const channel = input.channel || 'in_app';
    const symbol = input.symbol || '';
    const score = input.matchScore;

    // 1. スコア閾値判定
    if (score < NOTIFICATION_THRESHOLD) {
      const skipReason = `スコア不足: ${score.toFixed(3)} < ${NOTIFICATION_THRESHOLD}`;
      // スキップでもログは記録（デバッグ用）
      await this.logNotification({
        noteId,
        marketSnapshotId,
        symbol,
        score,
        channel,
        status: 'skipped',
        reasonSummary: skipReason,
      });
      return {
        shouldNotify: false,
        status: 'skipped',
        skipReason,
        reasonSummary: `スコア: ${score.toFixed(3)}`,
      };
    }

    // 2. 冪等性チェック（同一 noteId × marketSnapshotId × channel は1回のみ）
    if (marketSnapshotId) {
      const isDuplicate = await this.notificationLogRepository.isDuplicate(
        noteId,
        marketSnapshotId,
        channel
      );
      if (isDuplicate) {
        return {
          shouldNotify: false,
          status: 'skipped',
          skipReason: '冪等性チェック: 同一条件で既に通知済み',
          reasonSummary: `スコア: ${score.toFixed(3)}`,
        };
      }

      // 3. 重複抑制（直近5秒以内の同一条件を抑止）
      const hasRecentDuplicate = await this.notificationLogRepository.hasRecentDuplicate(
        noteId,
        marketSnapshotId,
        DUPLICATE_TOLERANCE_SEC
      );
      if (hasRecentDuplicate) {
        return {
          shouldNotify: false,
          status: 'skipped',
          skipReason: `重複抑制: ${DUPLICATE_TOLERANCE_SEC}秒以内に同一通知あり`,
          reasonSummary: `スコア: ${score.toFixed(3)}`,
        };
      }
    }

    // 4. クールダウン検査（同一 noteId について1時間以内の再通知を抑止）
    const cooldownResult: CooldownCheckResult = await this.notificationLogRepository.checkCooldown(
      noteId,
      COOLDOWN_MS
    );
    if (cooldownResult.isInCooldown) {
      const cooldownUntil = cooldownResult.cooldownUntil?.toISOString() || 'unknown';
      return {
        shouldNotify: false,
        status: 'skipped',
        skipReason: `クールダウン中: 次回通知可能時刻 ${cooldownUntil}`,
        reasonSummary: `スコア: ${score.toFixed(3)}`,
      };
    }

    // 5. 通知を許可し、ログを永続化
    const logResult = await this.logNotification({
      noteId,
      marketSnapshotId,
      symbol,
      score,
      channel,
      status: 'sent',
      reasonSummary: `スコア: ${score.toFixed(3)} (閾値: ${NOTIFICATION_THRESHOLD})`,
    });

    return {
      shouldNotify: true,
      status: 'sent',
      reasonSummary: `スコア: ${score.toFixed(3)}`,
      notificationLogId: logResult?.id,
    };
  }

  /**
   * NotificationLog を DB に記録
   */
  private async logNotification(params: {
    noteId: string;
    marketSnapshotId: string;
    symbol: string;
    score: number;
    channel: 'in_app' | 'push' | 'webhook';
    status: 'sent' | 'skipped' | 'failed';
    reasonSummary: string;
  }) {
    // marketSnapshotId が空の場合はログ記録をスキップ
    if (!params.marketSnapshotId) {
      return null;
    }

    try {
      return await this.notificationLogRepository.upsertLog({
        noteId: params.noteId,
        marketSnapshotId: params.marketSnapshotId,
        symbol: params.symbol,
        score: params.score,
        channel: params.channel,
        status: params.status,
        reasonSummary: params.reasonSummary,
        sentAt: new Date(),
      });
    } catch (error) {
      console.error('NotificationLog 永続化エラー:', error);
      return null;
    }
  }

  // 互換用: 旧シグネチャを利用するコードから呼ばれても、判定のみ実行する
  async evaluateAndNotify(matchResult: any): Promise<NotificationTriggerResult> {
    return this.evaluate({
      matchScore: matchResult?.score ?? matchResult?.matchScore ?? 0,
      historicalNoteId: matchResult?.noteId ?? matchResult?.historicalNoteId ?? '',
      marketSnapshot: matchResult?.marketSnapshot ?? matchResult?.currentMarket ?? {},
    });
  }
}
