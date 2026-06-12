/**
 * API 認証境界テスト
 *
 * 本番運用前の P0-1 として、JWT / role / cron secret / webhook token の境界を固定する。
 * sandbox では listen が許可されないため、HTTP サーバーは立てず middleware を直接検証する。
 */

import type { NextFunction, Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/authMiddleware';
import { cronAuth } from '../../middleware/cronAuth';
import { resolveJwtSecret, sessionService } from '../services/auth/sessionService';
import { isTradingOrderExecutionEnabled } from '../services/tradingOrderExecutionGate';
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
  const originalTradingOrderExecutionEnabled = process.env.TRADING_ORDER_EXECUTION_ENABLED;

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

    if (originalTradingOrderExecutionEnabled === undefined) {
      delete process.env.TRADING_ORDER_EXECUTION_ENABLED;
    } else {
      process.env.TRADING_ORDER_EXECUTION_ENABLED = originalTradingOrderExecutionEnabled;
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

  it('mail webhook token 設定漏れは 500 で検出する', () => {
    delete process.env.MAIL_SECURITY_TOKEN;

    const res = createMockResponse();
    const next = jest.fn();

    requireMailSecurityToken(createRequest(), res, next);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: 'MAIL_SECURITY_TOKEN が設定されていません',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('本番の JWT_SECRET 設定漏れは起動前に拒否する', () => {
    expect(() => resolveJwtSecret({ NODE_ENV: 'production' })).toThrow(
      'JWT_SECRET が本番環境用に設定されていません',
    );
    expect(() =>
      resolveJwtSecret({
        NODE_ENV: 'production',
        JWT_SECRET: 'your-jwt-secret-change-in-production',
      }),
    ).toThrow('JWT_SECRET が本番環境用に設定されていません');
  });

  it('開発環境の JWT_SECRET 未設定は開発用秘密鍵で継続する', () => {
    expect(resolveJwtSecret({ NODE_ENV: 'development' })).toBe(
      'development-secret-change-in-production',
    );
  });

  it('実発注ゲートは true 明示時だけ有効になる', () => {
    expect(isTradingOrderExecutionEnabled({})).toBe(false);
    expect(isTradingOrderExecutionEnabled({ TRADING_ORDER_EXECUTION_ENABLED: 'false' })).toBe(false);
    expect(isTradingOrderExecutionEnabled({ TRADING_ORDER_EXECUTION_ENABLED: 'true' })).toBe(true);
  });
});
