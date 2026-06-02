/**
 * /health と /ready の責務分離テスト
 */

import {
  buildHealthPayload,
  buildReadinessResult,
  sanitizeRequestUrl,
} from '../../app';
import { prisma } from '../db/client';

jest.mock('../db/client', () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

describe('/health /ready', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('/health は依存先を見ない liveness payload を返す', () => {
    const body = buildHealthPayload(new Date('2026-06-03T00:00:00.000Z'));

    expect(body).toEqual({
      status: 'ok',
      check: 'liveness',
      timestamp: '2026-06-03T00:00:00.000Z',
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('/ready はDB疎通成功時に ready を返す', async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ '?column?': 1 }]);

    const result = await buildReadinessResult(new Date('2026-06-03T00:00:00.000Z'));

    expect(result).toEqual({
      statusCode: 200,
      body: {
        status: 'ready',
        timestamp: '2026-06-03T00:00:00.000Z',
        dependencies: {
          database: 'ok',
        },
      },
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('/ready はDB疎通失敗時に詳細を漏らさず 503 を返す', async () => {
    (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Error('postgres://secret@example'));

    const result = await buildReadinessResult(new Date('2026-06-03T00:00:00.000Z'));

    expect(result).toEqual({
      statusCode: 503,
      body: {
        status: 'not_ready',
        timestamp: '2026-06-03T00:00:00.000Z',
        dependencies: {
          database: 'error',
        },
      },
    });
  });

  it('ログ用URLは secret 系クエリを redact する', () => {
    const result = sanitizeRequestUrl('GET', '/api/mail/receive?token=abc&code=oauth&x=1');

    expect(result).toBe('GET /api/mail/receive?token=%5Bredacted%5D&code=%5Bredacted%5D&x=1');
    expect(result).not.toContain('abc');
    expect(result).not.toContain('oauth');
  });
});
