/**
 * 本番耐用化 (Production Readiness) テストコード
 *
 * 対象: SystemStateRepository, MailService, キルスイッチ連携
 */

import { createSystemStateRepository } from '../repositories/systemStateRepository';
import { MailService } from '../services/mailService';
import type { InboundMail } from '../../schemas/api/sideB';

describe('SystemStateRepository', () => {
  it('値の書き込み・読み込みが正しく機能すること', async () => {
    const mockState: Record<string, string> = {};
    const mockPrisma = {
      systemState: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { key: string } }) => {
          const val = mockState[where.key];
          return val ? { key: where.key, value: val } : null;
        }),
        upsert: jest.fn().mockImplementation(({ where, update }: { where: { key: string }, update: { value: string } }) => {
          mockState[where.key] = update.value;
          return { key: where.key, value: update.value };
        }),
        deleteMany: jest.fn().mockImplementation(({ where }: { where: { key: string } }) => {
          delete mockState[where.key];
          return { count: 1 };
        }),
      },
    } as any;

    const repository = createSystemStateRepository(mockPrisma);

    await repository.set('emergency_stop', 'true');
    expect(mockState['emergency_stop']).toBe('true');

    const val = await repository.get('emergency_stop');
    expect(val).toBe('true');

    const boolVal = await repository.getBoolean('emergency_stop');
    expect(boolVal).toBe(true);

    await repository.setBoolean('emergency_stop', false);
    expect(mockState['emergency_stop']).toBe('false');

    await repository.setInt('consecutive_errors', 5);
    expect(mockState['consecutive_errors']).toBe('5');

    const intVal = await repository.getInt('consecutive_errors');
    expect(intVal).toBe(5);

    await repository.delete('emergency_stop');
    expect(mockState['emergency_stop']).toBeUndefined();
  });

  it('緊急停止の直近監査情報を SystemState に記録できること', async () => {
    const mockState: Record<string, string> = {};
    const mockPrisma = {
      systemState: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { key: string } }) => {
          const val = mockState[where.key];
          return val ? { key: where.key, value: val } : null;
        }),
        upsert: jest.fn().mockImplementation(({ where, update }: { where: { key: string }, update: { value: string } }) => {
          mockState[where.key] = update.value;
          return { key: where.key, value: update.value };
        }),
        deleteMany: jest.fn(),
      },
    } as any;

    const repository = createSystemStateRepository(mockPrisma);

    await repository.recordEmergencyAudit({
      action: 'auto_stop',
      source: 'scheduler',
      actor: 'side-b-scheduler',
      reason: 'monitor_error_threshold',
    });

    expect(mockState.emergency_last_action).toBe('auto_stop');
    expect(mockState.emergency_last_action_source).toBe('scheduler');
    expect(mockState.emergency_last_action_by).toBe('side-b-scheduler');
    expect(mockState.emergency_last_action_reason).toBe('monitor_error_threshold');
    expect(mockState.emergency_last_action_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('MailService', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('正しいトークンとACTION: STOPを含むインバウンドメールでキルスイッチが作動すること', async () => {
    process.env.MAIL_SECURITY_TOKEN = 'test-security-token-999';

    const mockPrisma = {
      systemState: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ key: 'emergency_stop', value: 'true' }),
      },
    } as any;

    const mailService = new MailService();
    (mailService as any).systemStateRepository = createSystemStateRepository(mockPrisma);
    mailService.sendAlertMail = jest.fn().mockResolvedValue(true);

    const payload: InboundMail = {
      from: 'admin@example.com',
      subject: 'Emergency trigger',
      text: 'TOKEN: test-security-token-999\nACTION: STOP',
    };

    const result = await mailService.handleInboundMail(payload);
    expect(result.success).toBe(true);
    expect(result.message).toBe('緊急停止を実行しました。');
    expect(mockPrisma.systemState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'emergency_stop' },
      update: { value: 'true' },
    }));
    expect(mockPrisma.systemState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'emergency_last_action' },
      update: { value: 'stop' },
    }));
  });

  it('既に緊急停止中のSTOP指示はメール再送せず成功扱いで返すこと', async () => {
    process.env.MAIL_SECURITY_TOKEN = 'test-security-token-999';

    const mockPrisma = {
      systemState: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { key: string } }) => {
          if (where.key === 'emergency_stop') {
            return { key: 'emergency_stop', value: 'true' };
          }
          return null;
        }),
        upsert: jest.fn().mockResolvedValue({ key: 'emergency_last_action', value: 'stop' }),
      },
    } as any;

    const mailService = new MailService();
    (mailService as any).systemStateRepository = createSystemStateRepository(mockPrisma);
    mailService.sendAlertMail = jest.fn().mockResolvedValue(true);

    const payload: InboundMail = {
      from: 'admin@example.com',
      subject: 'Emergency trigger',
      text: 'TOKEN: test-security-token-999\nACTION: STOP',
    };

    const result = await mailService.handleInboundMail(payload);

    expect(result.success).toBe(true);
    expect(result.message).toBe('緊急停止は既に有効です。');
    expect(mailService.sendAlertMail).not.toHaveBeenCalled();
    expect(mockPrisma.systemState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'emergency_last_action_reason' },
      update: { value: 'already_stopped' },
    }));
  });

  it('不正なトークンの場合はエラーを返すこと', async () => {
    process.env.MAIL_SECURITY_TOKEN = 'test-security-token-999';

    const mailService = new MailService();

    const payload: InboundMail = {
      from: 'admin@example.com',
      subject: 'Emergency trigger',
      text: 'TOKEN: wrong-token\nACTION: STOP',
    };

    const result = await mailService.handleInboundMail(payload);
    expect(result.success).toBe(false);
    expect(result.message).toBe('セキュリティトークンが一致しません。');
  });
});
