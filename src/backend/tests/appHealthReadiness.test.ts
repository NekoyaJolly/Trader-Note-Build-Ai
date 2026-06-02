/**
 * /health と /ready の責務分離テスト
 */

import {
  buildHealthPayload,
  buildReadinessResult,
  sanitizeRequestUrl,
} from '../../app';
import {
  buildCorrelationId,
  correlationIdMiddleware,
  readIncomingCorrelationId,
} from '../../middleware/correlationId';
import { prisma } from '../db/client';
import type { NextFunction, Request, Response } from 'express';

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

describe('correlationIdMiddleware', () => {
  function createRequest(headers: Record<string, string | string[] | undefined> = {}): Request {
    return { headers } as Request;
  }

  function createResponse(): Response {
    const headers: Record<string, number | string | readonly string[]> = {};
    return {
      locals: {},
      setHeader(name: string, value: number | string | readonly string[]) {
        headers[name] = value;
        return this;
      },
      getHeader(name: string) {
        return headers[name];
      },
    } as Response;
  }

  it('安全な x-correlation-id をリクエストとレスポンスへ引き継ぐ', () => {
    const req = createRequest({ 'x-correlation-id': 'sidea-e2e-20260603' });
    const res = createResponse();
    const next: jest.MockedFunction<NextFunction> = jest.fn();

    correlationIdMiddleware(req, res, next);

    expect(req.correlationId).toBe('sidea-e2e-20260603');
    expect(req.requestId).toBe('sidea-e2e-20260603');
    expect(res.locals.correlationId).toBe('sidea-e2e-20260603');
    expect(res.getHeader('X-Correlation-Id')).toBe('sidea-e2e-20260603');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('x-correlation-id がなければ x-request-id を候補にする', () => {
    const req = createRequest({ 'x-request-id': 'request-id-20260603' });

    expect(readIncomingCorrelationId(req)).toBe('request-id-20260603');
  });

  it('カンマ区切りの複数値ヘッダーは先頭だけを候補にする', () => {
    const req = createRequest({ 'x-correlation-id': 'first-id-20260603, second-id-20260603' });

    expect(readIncomingCorrelationId(req)).toBe('first-id-20260603');
  });

  it('不正な入力は引き継がず UUID を生成する', () => {
    const generated = buildCorrelationId('secret token with spaces');

    expect(generated).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(generated).not.toBe('secret token with spaces');
  });
});
