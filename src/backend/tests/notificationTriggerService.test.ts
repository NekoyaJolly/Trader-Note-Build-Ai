import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { NotificationTriggerService } from '../../services/notification/notificationTriggerService';

// シンプルな DTO で評価のみを検証する
const createDto = (overrides?: Partial<{ matchScore: number; historicalNoteId: string; marketSnapshot: unknown }>) => ({
  matchScore: 0.8,
  historicalNoteId: 'note_1',
  marketSnapshot: { symbol: 'BTCUSDT', timeframe: '1h' },
  ...overrides,
});

describe('NotificationTriggerService', () => {
  let triggerService: NotificationTriggerService;
  let originalThreshold: string | undefined;

  beforeEach(() => {
    originalThreshold = process.env.NOTIFY_THRESHOLD;
    process.env.NOTIFY_THRESHOLD = '0.75';
    triggerService = new NotificationTriggerService();
  });

  afterEach(() => {
    process.env.NOTIFY_THRESHOLD = originalThreshold;
  });

  describe('スコア判定', () => {
    it('閾値未満ならスキップされる', () => {
      const result = triggerService.evaluate(createDto({ matchScore: 0.7 }));

      expect(result.shouldNotify).toBe(false);
      expect(result.status).toBe('skipped');
      expect(result.skipReason).toContain('スコア不足');
    });

    it('閾値ちょうどなら通知対象', () => {
      const result = triggerService.evaluate(createDto({ matchScore: 0.75 }));

      expect(result.shouldNotify).toBe(true);
      expect(result.status).toBe('sent');
    });

    it('閾値超えなら通知対象', () => {
      const result = triggerService.evaluate(createDto({ matchScore: 0.9 }));

      expect(result.shouldNotify).toBe(true);
      expect(result.status).toBe('sent');
    });
  });

  describe('後方互換 evaluateAndNotify', () => {
    it('旧シグネチャでも評価のみが行われる', async () => {
      const result = await triggerService.evaluateAndNotify({ score: 0.8 });

      expect(result.shouldNotify).toBe(true);
      expect(result.status).toBe('sent');
    });

    it('スコア不足の場合はスキップ', async () => {
      const result = await triggerService.evaluateAndNotify({ score: 0.6 });

      expect(result.shouldNotify).toBe(false);
      expect(result.status).toBe('skipped');
    });
  });
});
