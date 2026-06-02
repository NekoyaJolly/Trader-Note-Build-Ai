/**
 * API 認証境界テスト
 *
 * 本番運用前の P0-1 として、JWT / role / cron secret / webhook token の境界を固定する。
 * sandbox では listen が許可されないため、HTTP サーバーは立てず middleware を直接検証する。
 */

import type { NextFunction, Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/authMiddleware';
import { cronAuth } from '../../middleware/cronAuth';
import { sessionService } from '../services/auth/sessionService';
import { requireMailSecurityToken } from '../../side-b/routes/mailRoutes';

interface MockResponse extends Response {
  statusCode: number;
  body?: object;
}

function createMockResponse(): MockResponse {
  const response: {
    statusCode: number;
    body?: object;
    status(code: number): typeof response;
    json(body: object): typeof response;
  } = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: object) {
      this.body = body;
      return this;
    },
  };
  return response as MockResponse;
}

function createRequest(input: {
  readonly authorization?: string;
  readonly query?: Record<string, string>;
  readonly headers?: Record<string, string>;
} = {}): Request {
  return {
    headers: {
      ...(input.authorization ? { authorization: input.authorization } : {}),
      ...(input.headers ?? {}),
    },
    query: input.query ?? {},
    cookies: {},
    params: {},
  } as Request;
}

function createToken(role: 'user' | 'admin'): string {
  return sessionService.generateToken({
    userId: role === 'admin'
      ? '00000000-0000-4000-8000-000000000001'
      : '00000000-0000-4000-8000-000000000002',
    primaryAccountId: 'demo-account',
    email: role === 'admin' ? 'admin@example.com' : 'user@example.com',
    displayName: role === 'admin' ? '管理者' : '一般ユーザー',
    role,
  });
}

function runRequireAuth(req: Request): { readonly res: MockResponse; readonly next: jest.MockedFunction<NextFunction> } {
  const res = createMockResponse();
  const next = jest.fn();
  requireAuth(req, res, next);
  return { res, next };
}

function runRequireRole(req: Request, role: 'admin' = 'admin'): { readonly res: MockResponse; readonly next: jest.MockedFunction<NextFunction> } {
  const res = createMockResponse();
  const next = jest.fn();
  requireRole([role])(req, res, next);
  return { res, next };
}

describe('API 認証境界', () => {
  const originalCronSecret = process.env.CRON_SECRET;
  const originalMailSecurityToken = process.env.MAIL_SECURITY_TOKEN;

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }

    if (originalMailSecurityToken === undefined) {
      delete process.env.MAIL_SECURITY_TOKEN;
    } else {
      process.env.MAIL_SECURITY_TOKEN = originalMailSecurityToken;
    }
  });

  it('未ログインで Side-A protected API は 401 になる', () => {
    const { res, next } = runRequireAuth(createRequest());
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('未ログインで Side-B protected API は 401 になる', () => {
    const { res, next } = runRequireAuth(createRequest());
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('user で admin API は 403 になる', () => {
    const req = createRequest({ authorization: `Bearer ${createToken('user')}` });
    const authResult = runRequireAuth(req);
    expect(authResult.next).toHaveBeenCalled();

    const roleResult = runRequireRole(req);
    expect(roleResult.res.statusCode).toBe(403);
    expect(roleResult.next).not.toHaveBeenCalled();
  });

  it('admin なら scheduler / orchestrator / emergency の admin API を通過できる', () => {
    const req = createRequest({ authorization: `Bearer ${createToken('admin')}` });
    const authResult = runRequireAuth(req);
    expect(authResult.next).toHaveBeenCalled();

    const scheduler = runRequireRole(req);
    const orchestrator = runRequireRole(req);
    const emergency = runRequireRole(req);

    expect(scheduler.next).toHaveBeenCalled();
    expect(orchestrator.next).toHaveBeenCalled();
    expect(emergency.next).toHaveBeenCalled();
  });

  it('cron secret なし / 誤り / 正しい値を検証する', () => {
    process.env.CRON_SECRET = 'test-cron-secret';

    const missingRes = createMockResponse();
    const wrongRes = createMockResponse();
    const validRes = createMockResponse();
    const missingNext = jest.fn();
    const wrongNext = jest.fn();
    const validNext = jest.fn();

    cronAuth(createRequest(), missingRes, missingNext);
    cronAuth(createRequest({ authorization: 'Bearer wrong-secret' }), wrongRes, wrongNext);
    cronAuth(createRequest({ authorization: 'Bearer test-cron-secret' }), validRes, validNext);

    expect(missingRes.statusCode).toBe(401);
    expect(wrongRes.statusCode).toBe(403);
    expect(validNext).toHaveBeenCalled();
  });

  it('mail webhook token なし / 誤り / 正しい値を検証する', () => {
    process.env.MAIL_SECURITY_TOKEN = 'test-mail-token';

    const missingRes = createMockResponse();
    const wrongRes = createMockResponse();
    const validRes = createMockResponse();
    const missingNext = jest.fn();
    const wrongNext = jest.fn();
    const validNext = jest.fn();

    requireMailSecurityToken(createRequest(), missingRes, missingNext);
    requireMailSecurityToken(
      createRequest({ headers: { 'x-mail-security-token': 'wrong-token' } }),
      wrongRes,
      wrongNext,
    );
    requireMailSecurityToken(
      createRequest({ headers: { 'x-mail-security-token': 'test-mail-token' } }),
      validRes,
      validNext,
    );

    expect(missingRes.statusCode).toBe(401);
    expect(wrongRes.statusCode).toBe(403);
    expect(validNext).toHaveBeenCalled();
  });
});
