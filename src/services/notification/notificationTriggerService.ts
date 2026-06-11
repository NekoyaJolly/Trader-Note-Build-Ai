import type { Prisma } from '@prisma/client';
import type { CooldownCheckResult } from '../../backend/repositories/notificationLogRepository';
import { NotificationLogRepository } from '../../backend/repositories/notificationLogRepository';

/**
 * 市場スナップショットを表す型。
 * - Prisma MarketSnapshot から取得した行 (オブジェクト)
 * - JSON 列由来の JsonValue
 * - レガシー経路で空オブジェクトを渡すケース
 * を全てカバーする具体型。
 */
type MarketSnapshotInput = Prisma.JsonValue | Record<string, Prisma.JsonValue> | object | null;

export interface NotificationTriggerInput {
  matchScore: number;
  historicalNoteId: string;
  marketSnapshot: MarketSnapshotInput;
  marketSnapshotId?: string;
  symbol?: string;
  channel?: 'in_app' | 'push' | 'webhook';
  /**
   * ユーザー設定によるスコア閾値 (Phase β-2a)。評価エンジン側で発火判定に使った
   * しきい値を渡し、本サービスの既定 (NOTIFY_THRESHOLD) との二重判定のズレを防ぐ。
   * 未設定時は従来の既定値
   */
  scoreThresholdOverride?: number;
  /** ユーザー設定による再通知クールダウン (ミリ秒、Phase β-2a)。未設定時は既定値 */
  cooldownMsOverride?: number;
}

/**
 * 通知スキップ理由の内部 reason code（集計用）。
 *
 * 日本語の `skipReason` 文字列は人間向け表示用で集計に向かないため、機械集計用の
 * 安定したコードを別途付与する（後方互換: 既存 `skipReason` 文字列はそのまま維持）。
 */
export type NotificationSkipReasonCode =
  | 'daily_limit'           // 24時間上限到達
  | 'score_below_threshold' // スコア閾値未満
  | 'duplicate'             // 冪等性: 同一条件で既に通知済み
  | 'recent_duplicate'      // 直近数秒以内の重複抑制
  | 'cooldown';             // クールダウン中

export interface NotificationTriggerResult {
  shouldNotify: boolean;
  status: 'sent' | 'skipped' | 'failed';
  skipReason?: string;
  /// 機械集計用のスキップ理由コード（skip 時のみ設定）
  skipReasonCode?: NotificationSkipReasonCode;
  reasonSummary?: string;
  notificationLogId?: string;
}

/**
 * evaluateAndNotify の互換入力型
 * 旧形式と新形式の両方に対応
 */
interface LegacyMatchResult {
  // 新形式
  score?: number;
  noteId?: string;
  marketSnapshot?: MarketSnapshotInput;
  // 旧形式
  matchScore?: number;
  historicalNoteId?: string;
  currentMarket?: MarketSnapshotInput;
}

const NOTIFICATION_THRESHOLD = parseFloat(process.env.NOTIFY_THRESHOLD || '0.75');
// クールダウン期間: デフォルト1時間（ミリ秒）、リアルタイム用は120-300秒推奨
const COOLDOWN_MS = parseInt(process.env.NOTIFICATION_COOLDOWN_MS || '3600000', 10);
// 重複抑制: 5秒以内の同一条件を抑止
const DUPLICATE_TOLERANCE_SEC = 5;
// 24時間あたりの通知上限（リアルタイム類似度通知用）
const DAILY_NOTIFICATION_LIMIT = parseInt(process.env.DAILY_NOTIFICATION_LIMIT || '30', 10);

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
   * 完全な通知判定（スコア + 冪等性 + クールダウン + 重複抑制 + 24時間上限）を実行
   * DB への NotificationLog 永続化も行う
   */
  async evaluateWithPersistence(input: NotificationTriggerInput): Promise<NotificationTriggerResult> {
    const noteId = input.historicalNoteId;
    const marketSnapshotId = input.marketSnapshotId || '';
    const channel = input.channel || 'in_app';
    const symbol = input.symbol || '';
    const score = input.matchScore;

    // 0. 24時間上限チェック（リアルタイム通知の過負荷防止）
    const dailyCount = await this.notificationLogRepository.countRecentNotifications(24);
    if (dailyCount >= DAILY_NOTIFICATION_LIMIT) {
      return {
        shouldNotify: false,
        status: 'skipped',
        skipReason: `24時間上限到達: ${dailyCount}/${DAILY_NOTIFICATION_LIMIT}件`,
        skipReasonCode: 'daily_limit',
        reasonSummary: `スコア: ${score.toFixed(3)} (上限到達)`,
      };
    }

    // 1. スコア閾値判定 (ユーザー設定があればそれを優先。Phase β-2a)
    const scoreThreshold = input.scoreThresholdOverride ?? NOTIFICATION_THRESHOLD;
    if (score < scoreThreshold) {
      const skipReason = `スコア不足: ${score.toFixed(3)} < ${scoreThreshold}`;
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
        skipReasonCode: 'score_below_threshold',
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
          skipReasonCode: 'duplicate',
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
          skipReasonCode: 'recent_duplicate',
          reasonSummary: `スコア: ${score.toFixed(3)}`,
        };
      }
    }

    // 4. クールダウン検査（同一 noteId について1時間以内の再通知を抑止）
    // クールダウンはユーザー設定があればそれを優先 (Phase β-2a)
    const cooldownMs = input.cooldownMsOverride ?? COOLDOWN_MS;
    const cooldownResult: CooldownCheckResult = await this.notificationLogRepository.checkCooldown(
      noteId,
      cooldownMs
    );
    if (cooldownResult.isInCooldown) {
      const cooldownUntil = cooldownResult.cooldownUntil?.toISOString() || 'unknown';
      return {
        shouldNotify: false,
        status: 'skipped',
        skipReason: `クールダウン中: 次回通知可能時刻 ${cooldownUntil}`,
        skipReasonCode: 'cooldown',
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
   * 配信失敗時に、先行して書き込んだ NotificationLog を無効化(削除)する。
   *
   * 理由: evaluateWithPersistence は配信前に status='sent' のログを永続化するが、
   * `isDuplicate` は status を問わずレコードの存在だけで重複判定する。そのため
   * 実際の配信(sendInApp)が失敗した場合、ログだけ残って次回以降の再試行が冪等性
   * チェックで永久にブロックされ、Notification が作られないまま放置される。
   * 配信失敗時はこのログを削除し、次回パイプラインで再評価・再配信できるようにする。
   */
  async invalidateNotificationLog(notificationLogId: string): Promise<void> {
    try {
      await this.notificationLogRepository.deleteLogById(notificationLogId);
    } catch (error) {
      // 削除失敗自体は配信本体をブロックしない(次回 cooldown 満了後に再評価される)
      console.error('NotificationLog 無効化エラー:', error);
    }
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

  /**
   * 互換用: 旧シグネチャを利用するコードから呼ばれても、判定のみ実行する
   * 
   * @param matchResult - 旧形式または新形式のマッチ結果
   * @returns 通知トリガ結果
   */
  evaluateAndNotify(matchResult: LegacyMatchResult): Promise<NotificationTriggerResult> {
    return Promise.resolve(this.evaluate({
      matchScore: matchResult?.score ?? matchResult?.matchScore ?? 0,
      historicalNoteId: matchResult?.noteId ?? matchResult?.historicalNoteId ?? '',
      marketSnapshot: matchResult?.marketSnapshot ?? matchResult?.currentMarket ?? {},
    }));
  }
}
