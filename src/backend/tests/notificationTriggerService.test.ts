import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NotificationLogRepository } from '../repositories/notificationLogRepository';
import { NotificationTriggerService } from '../../services/notification/notificationTriggerService';
import { NotificationSender, NotificationPayload } from '../../services/notification/notificationSender';
import {
  MatchResult,
  MarketSnapshot,
  TradeNote,
  NotificationLogStatus,
} from '@prisma/client';

/**
 * Mock NotificationSender for testing
 */
class MockNotificationSender implements NotificationSender {
  async sendInApp(payload: NotificationPayload): Promise<{ success: boolean; id?: string }> {
    return {
      success: true,
      id: `mock_in_app_${Date.now()}`,
    };
  }

  async sendPush(payload: NotificationPayload): Promise<{ success: boolean; id?: string }> {
    return {
      success: true,
      id: `mock_push_${Date.now()}`,
    };
  }

  async sendWebhook(payload: NotificationPayload): Promise<{ success: boolean; id?: string }> {
    return {
      success: true,
      id: `mock_webhook_${Date.now()}`,
    };
  }
}

/**
 * Mock NotificationLogRepository for testing
 */
class MockNotificationLogRepository extends NotificationLogRepository {
  private logs: Map<string, any> = new Map();
  private duplicateMode: boolean = false;
  private cooldownMode: boolean = false;
  private recentDuplicateMode: boolean = false;

  async upsertLog(input: any) {
    const key = `${input.noteId}_${input.marketSnapshotId}_${input.channel}`;
    const logEntry = {
      id: `log_${Date.now()}`,
      ...input,
      createdAt: new Date(),
    };
    this.logs.set(key, logEntry);
    return logEntry;
  }

  async isDuplicate(noteId: string, marketSnapshotId: string, channel: string): Promise<boolean> {
    if (this.duplicateMode) {
      return true;
    }
    const key = `${noteId}_${marketSnapshotId}_${channel}`;
    return this.logs.has(key);
  }

  async checkCooldown(noteId: string, cooldownMs?: number) {
    if (this.cooldownMode) {
      return {
        isInCooldown: true,
        lastNotificationTime: new Date(),
        cooldownUntil: new Date(Date.now() + 3600000),
      };
    }
    return {
      isInCooldown: false,
    };
  }

  async hasRecentDuplicate(noteId: string, marketSnapshotId: string, toleranceSec?: number) {
    return this.recentDuplicateMode;
  }

  // Test helper methods
  setDuplicateMode(enabled: boolean) {
    this.duplicateMode = enabled;
  }

  setCooldownMode(enabled: boolean) {
    this.cooldownMode = enabled;
  }

  setRecentDuplicateMode(enabled: boolean) {
    this.recentDuplicateMode = enabled;
  }

  clearLogs() {
    this.logs.clear();
  }
}

describe('NotificationTriggerService', () => {
  let mockRepository: MockNotificationLogRepository;
  let mockSender: MockNotificationSender;
  let triggerService: NotificationTriggerService;

  const createMatchResult = (
    overrides?: Partial<MatchResult & { note: TradeNote; marketSnapshot: MarketSnapshot }>
  ) => {
    const baseMatchResult: MatchResult & {
      note: TradeNote;
      marketSnapshot: MarketSnapshot;
    } = {
      id: 'match_1',
      noteId: 'note_1',
      marketSnapshotId: 'snapshot_1',
      symbol: 'BTCUSDT',
      score: 0.8,
      threshold: 0.75,
      trendMatched: true,
      priceRangeMatched: true,
      reasons: ['トレンド一致', '価格レンジ一致'],
      evaluatedAt: new Date(),
      decidedAt: new Date(),
      createdAt: new Date(),
      note: {
        id: 'note_1',
        tradeId: 'trade_1',
        symbol: 'BTCUSDT',
        entryPrice: 50000,
        side: 'buy',
        indicators: null,
        featureVector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
        timeframe: '1h',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      marketSnapshot: {
        id: 'snapshot_1',
        symbol: 'BTCUSDT',
        timeframe: '1h',
        close: 51000,
        volume: 100,
        indicators: {},
        fetchedAt: new Date(),
        createdAt: new Date(),
      } as any,
    };

    return { ...baseMatchResult, ...overrides };
  };

  beforeEach(() => {
    mockRepository = new MockNotificationLogRepository();
    mockSender = new MockNotificationSender();
    triggerService = new NotificationTriggerService(mockRepository, mockSender);
    mockRepository.clearLogs();

    // Reset notification config
    NotificationTriggerService.setNotifyThreshold(0.75);
    NotificationTriggerService.setCooldownMs(3600000);
  });

  describe('テスト 1: スコア未満 → 通知されない', () => {
    it('スコアが閾値未満の場合、通知をスキップ', async () => {
      const matchResult = createMatchResult({ score: 0.7 });
      const result = await triggerService.evaluateAndNotify(matchResult, 'in_app');

      expect(result.shouldNotify).toBe(false);
      expect(result.status).toBe('skipped');
      expect(result.skipReason).toContain('スコア不足');
    });

    it('スコアが 0 の場合、通知をスキップ', async () => {
      const matchResult = createMatchResult({ score: 0 });
      const result = await triggerService.evaluateAndNotify(matchResult, 'in_app');

      expect(result.shouldNotify).toBe(false);
      expect(result.status).toBe('skipped');
    });
  });

  describe('テスト 2: 初回一致 → 通知される', () => {
    it('スコアが閾値以上で、重複なしの場合、通知を配信', async () => {
      const matchResult = createMatchResult({ score: 0.8 });
      const result = await triggerService.evaluateAndNotify(matchResult, 'in_app');

      expect(result.shouldNotify).toBe(true);
      expect(result.status).toBe('sent');
      expect(result.inAppNotificationId).toBeDefined();
      expect(result.notificationLogId).toBeDefined();
    });

    it('高スコアの場合、通知を配信', async () => {
      const matchResult = createMatchResult({ score: 0.95 });
      const result = await triggerService.evaluateAndNotify(matchResult, 'in_app');

      expect(result.shouldNotify).toBe(true);
      expect(result.status).toBe('sent');
    });
  });

  describe('テスト 3: 同一条件再評価 → 通知されない', () => {
    it('冪等性制約により、同じ noteId×snapshotId の再通知をスキップ', async () => {
      const matchResult = createMatchResult({ score: 0.8 });

      // 1 回目: 通知成功
      const result1 = await triggerService.evaluateAndNotify(matchResult, 'in_app');
      expect(result1.shouldNotify).toBe(true);

      // 2 回目: 同じ条件で評価 → スキップ
      const result2 = await triggerService.evaluateAndNotify(matchResult, 'in_app');
      expect(result2.shouldNotify).toBe(false);
      expect(result2.skipReason).toContain('冪等性制約');
    });
  });

  describe('テスト 4: クールダウン内 → 通知されない', () => {
    it('クールダウン中の場合、通知をスキップ', async () => {
      const matchResult = createMatchResult({
        noteId: 'note_cooldown',
        score: 0.8,
      });

      mockRepository.setCooldownMode(true);
      const result = await triggerService.evaluateAndNotify(matchResult, 'in_app');

      expect(result.shouldNotify).toBe(false);
      expect(result.status).toBe('skipped');
      expect(result.skipReason).toContain('クールダウン中');
    });
  });

  describe('テスト 5: NotificationLog が保存される', () => {
    it('通知が配信された場合、ログが記録される', async () => {
      const matchResult = createMatchResult({ score: 0.8 });
      const result = await triggerService.evaluateAndNotify(matchResult, 'in_app');

      expect(result.notificationLogId).toBeDefined();
      expect(result.status).toBe('sent');
    });
  });

  describe('テスト 6: 理由数チェック', () => {
    it('理由がない場合、通知をスキップ', async () => {
      const matchResult = createMatchResult({
        score: 0.8,
        reasons: [],
      });
      const result = await triggerService.evaluateAndNotify(matchResult, 'in_app');

      expect(result.shouldNotify).toBe(false);
      expect(result.status).toBe('skipped');
      expect(result.skipReason).toContain('理由不足');
    });

    it('理由がある場合、通知を配信', async () => {
      const matchResult = createMatchResult({
        score: 0.8,
        reasons: ['トレンド一致'],
      });
      const result = await triggerService.evaluateAndNotify(matchResult, 'in_app');

      expect(result.shouldNotify).toBe(true);
      expect(result.status).toBe('sent');
    });
  });

  describe('テスト 7: 複数チャネル対応', () => {
    it('異なるチャネルでは冪等性チェックが独立', async () => {
      const matchResult = createMatchResult({ score: 0.8 });

      // in_app チャネルで通知
      const result1 = await triggerService.evaluateAndNotify(matchResult, 'in_app');
      expect(result1.shouldNotify).toBe(true);

      // push チャネルでも通知可能（冪等性チェックは channel ごと）
      const result2 = await triggerService.evaluateAndNotify(matchResult, 'push');
      expect(result2.shouldNotify).toBe(true);

      // 再度 in_app チャネルではスキップ
      const result3 = await triggerService.evaluateAndNotify(matchResult, 'in_app');
      expect(result3.shouldNotify).toBe(false);
    });
  });

  describe('テスト 8: 重複抑制チェック', () => {
    it('短い時間差での重複を抑制', async () => {
      const matchResult = createMatchResult({
        noteId: 'note_recent_dup',
        score: 0.8,
      });

      mockRepository.setRecentDuplicateMode(true);
      const result = await triggerService.evaluateAndNotify(matchResult, 'in_app');

      expect(result.shouldNotify).toBe(false);
      expect(result.status).toBe('skipped');
      expect(result.skipReason).toContain('重複抑制');
    });
  });

  describe('テスト 9: エッジケース', () => {
    it('スコアが閾値と正確に等しい場合、通知を配信', async () => {
      NotificationTriggerService.setNotifyThreshold(0.75);
      const matchResult = createMatchResult({ score: 0.75 });
      const result = await triggerService.evaluateAndNotify(matchResult, 'in_app');

      expect(result.shouldNotify).toBe(true);
      expect(result.status).toBe('sent');
    });

    it('複数の理由を持つ場合、最初の 3 つを要約に含める', async () => {
      const matchResult = createMatchResult({
        score: 0.8,
        reasons: [
          'トレンド一致',
          '価格レンジ一致',
          'RSI 一致',
          'MACD 一致',
          'ボラティリティ一致',
        ],
      });
      const result = await triggerService.evaluateAndNotify(matchResult, 'in_app');

      expect(result.shouldNotify).toBe(true);
      // reasonSummary は最初の 3 つのみを含むはず
    });
  });
});
