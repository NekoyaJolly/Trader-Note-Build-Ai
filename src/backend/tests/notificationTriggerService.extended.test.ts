/**
 * NotificationTriggerService 拡張テスト
 * 
 * クールダウン・重複抑止・冪等性チェックのテストケース
 * Runbook に記載された 13 ケースをカバー
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { NotificationTriggerService, NotificationTriggerInput } from '../../services/notification/notificationTriggerService';
import { NotificationLogRepository } from '../repositories/notificationLogRepository';

// NotificationLogRepository のモック
const mockNotificationLogRepository = {
  isDuplicate: jest.fn<() => Promise<boolean>>(),
  hasRecentDuplicate: jest.fn<() => Promise<boolean>>(),
  checkCooldown: jest.fn<() => Promise<{ isInCooldown: boolean; lastNotificationTime?: Date; cooldownUntil?: Date }>>(),
  upsertLog: jest.fn<() => Promise<{ id: string }>>(),
};

// テスト用の入力データを生成
const createInput = (overrides?: Partial<NotificationTriggerInput>): NotificationTriggerInput => ({
  matchScore: 0.8,
  historicalNoteId: 'note_test_123',
  marketSnapshot: { symbol: 'BTCUSDT', timeframe: '1h' },
  marketSnapshotId: 'snapshot_test_123',
  symbol: 'BTCUSDT',
  channel: 'in_app',
  ...overrides,
});

describe('NotificationTriggerService - 拡張テスト', () => {
  let triggerService: NotificationTriggerService;
  let originalThreshold: string | undefined;

  beforeEach(() => {
    // 環境変数を設定
    originalThreshold = process.env.NOTIFY_THRESHOLD;
    process.env.NOTIFY_THRESHOLD = '0.75';
    
    // モックをリセット
    jest.clearAllMocks();
    mockNotificationLogRepository.isDuplicate.mockResolvedValue(false);
    mockNotificationLogRepository.hasRecentDuplicate.mockResolvedValue(false);
    mockNotificationLogRepository.checkCooldown.mockResolvedValue({ isInCooldown: false });
    mockNotificationLogRepository.upsertLog.mockResolvedValue({ id: 'log_123' });
    
    // モックリポジトリを使用してサービスを初期化
    triggerService = new NotificationTriggerService(mockNotificationLogRepository as unknown as NotificationLogRepository);
  });

  afterEach(() => {
    process.env.NOTIFY_THRESHOLD = originalThreshold;
  });

  describe('1. スコア閾値判定', () => {
    it('1-1: スコアが閾値未満の場合、通知をスキップする', async () => {
      const result = await triggerService.evaluateWithPersistence(createInput({ matchScore: 0.7 }));

      expect(result.shouldNotify).toBe(false);
      expect(result.status).toBe('skipped');
      expect(result.skipReason).toContain('スコア不足');
    });

    it('1-2: スコアが閾値と等しい場合、通知を許可する', async () => {
      const result = await triggerService.evaluateWithPersistence(createInput({ matchScore: 0.75 }));

      expect(result.shouldNotify).toBe(true);
      expect(result.status).toBe('sent');
    });

    it('1-3: スコアが閾値を超える場合、通知を許可する', async () => {
      const result = await triggerService.evaluateWithPersistence(createInput({ matchScore: 0.9 }));

      expect(result.shouldNotify).toBe(true);
      expect(result.status).toBe('sent');
    });
  });

  describe('2. 冪等性チェック（同一条件の重複防止）', () => {
    it('2-1: 同一 noteId × marketSnapshotId × channel で既に通知済みの場合、スキップする', async () => {
      mockNotificationLogRepository.isDuplicate.mockResolvedValue(true);

      const result = await triggerService.evaluateWithPersistence(createInput());

      expect(result.shouldNotify).toBe(false);
      expect(result.status).toBe('skipped');
      expect(result.skipReason).toContain('冪等性チェック');
    });

    it('2-2: 新規条件の場合、通知を許可する', async () => {
      mockNotificationLogRepository.isDuplicate.mockResolvedValue(false);

      const result = await triggerService.evaluateWithPersistence(createInput());

      expect(result.shouldNotify).toBe(true);
      expect(result.status).toBe('sent');
    });
  });

  describe('3. クールダウン検査（同一 noteId の再通知抑止）', () => {
    it('3-1: クールダウン期間中の場合、通知をスキップする', async () => {
      mockNotificationLogRepository.checkCooldown.mockResolvedValue({
        isInCooldown: true,
        lastNotificationTime: new Date(),
        cooldownUntil: new Date(Date.now() + 30 * 60 * 1000), // 30分後
      });

      const result = await triggerService.evaluateWithPersistence(createInput());

      expect(result.shouldNotify).toBe(false);
      expect(result.status).toBe('skipped');
      expect(result.skipReason).toContain('クールダウン中');
    });

    it('3-2: クールダウン期間が終了している場合、通知を許可する', async () => {
      mockNotificationLogRepository.checkCooldown.mockResolvedValue({
        isInCooldown: false,
        lastNotificationTime: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2時間前
      });

      const result = await triggerService.evaluateWithPersistence(createInput());

      expect(result.shouldNotify).toBe(true);
      expect(result.status).toBe('sent');
    });

    it('3-3: 初回通知（履歴なし）の場合、通知を許可する', async () => {
      mockNotificationLogRepository.checkCooldown.mockResolvedValue({
        isInCooldown: false,
      });

      const result = await triggerService.evaluateWithPersistence(createInput());

      expect(result.shouldNotify).toBe(true);
      expect(result.status).toBe('sent');
    });
  });

  describe('4. 重複抑制（短時間内の連続通知防止）', () => {
    it('4-1: 直近5秒以内に同一通知がある場合、スキップする', async () => {
      mockNotificationLogRepository.hasRecentDuplicate.mockResolvedValue(true);

      const result = await triggerService.evaluateWithPersistence(createInput());

      expect(result.shouldNotify).toBe(false);
      expect(result.status).toBe('skipped');
      expect(result.skipReason).toContain('重複抑制');
    });

    it('4-2: 直近5秒以内に通知がない場合、通知を許可する', async () => {
      mockNotificationLogRepository.hasRecentDuplicate.mockResolvedValue(false);

      const result = await triggerService.evaluateWithPersistence(createInput());

      expect(result.shouldNotify).toBe(true);
      expect(result.status).toBe('sent');
    });
  });

  describe('5. NotificationLog 永続化', () => {
    it('5-1: 通知成功時にログが記録される', async () => {
      const result = await triggerService.evaluateWithPersistence(createInput());

      expect(mockNotificationLogRepository.upsertLog).toHaveBeenCalledWith(
        expect.objectContaining({
          noteId: 'note_test_123',
          marketSnapshotId: 'snapshot_test_123',
          status: 'sent',
        })
      );
      expect(result.notificationLogId).toBe('log_123');
    });

    it('5-2: スコア不足でスキップ時もログが記録される', async () => {
      await triggerService.evaluateWithPersistence(createInput({ matchScore: 0.5 }));

      expect(mockNotificationLogRepository.upsertLog).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'skipped',
        })
      );
    });

    it('5-3: marketSnapshotId がない場合、ログ記録をスキップする', async () => {
      const result = await triggerService.evaluateWithPersistence(createInput({ marketSnapshotId: undefined }));

      // 冪等性チェックなどはスキップされ、スコア判定のみが行われる
      expect(result.shouldNotify).toBe(true);
      // ログ記録は呼ばれない
      expect(mockNotificationLogRepository.upsertLog).not.toHaveBeenCalled();
    });
  });

  describe('6. チャネル別テスト', () => {
    it('6-1: in_app チャネルで通知が許可される', async () => {
      const result = await triggerService.evaluateWithPersistence(createInput({ channel: 'in_app' }));

      expect(result.shouldNotify).toBe(true);
    });

    it('6-2: push チャネルで通知が許可される', async () => {
      const result = await triggerService.evaluateWithPersistence(createInput({ channel: 'push' }));

      expect(result.shouldNotify).toBe(true);
    });

    it('6-3: webhook チャネルで通知が許可される', async () => {
      const result = await triggerService.evaluateWithPersistence(createInput({ channel: 'webhook' }));

      expect(result.shouldNotify).toBe(true);
    });
  });
});
