/**
 * API 認証境界テスト
 *
 * 本番運用前の P0-1 として、JWT / role / cron secret / webhook token の境界を固定する。
 * sandbox では listen が許可されないため、HTTP サーバーは立てず middleware を直接検証する。
 */

import type { NextFunction, Request, Response } from 'express';
import type { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/authMiddleware';
import { cronAuth } from '../../middleware/cronAuth';
import { resolveJwtSecret, sessionService } from '../services/auth/sessionService';
import { isTradingOrderExecutionEnabled } from '../services/tradingOrderExecutionGate';
import { requireMailSecurityToken } from '../../side-b/routes/mailRoutes';
import { OrderController } from '../controllers/orderController';
import { NotificationController } from '../controllers/notificationController';
import notificationRoutes from '../api/notificationRoutes';
import {
  buildNotificationPreferenceSyncInput,
  normalizeSettingsUpdateForNotificationPreference,
} from '../api/settingsRoutes';
import type { LatestMatchForNote } from '../repositories/matchResultRepository';
import type { MarketData, OrderPreset, TradeNote } from '../../models/types';

interface MockResponse extends Response {
  statusCode: number;
  body?: object;
}

interface RouteLayer {
  route?: {
    path: string | RegExp | Array<string | RegExp>;
    methods: Record<string, boolean>;
  };
}

function createMockResponse(): MockResponse {
  const response: {
    statusCode: number;
    body?: object;
    locals: Record<string, object | string | undefined>;
    status(code: number): typeof response;
    json(body: object): typeof response;
  } = {
    statusCode: 200,
    locals: {},
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
  readonly params?: Record<string, string>;
  readonly userId?: string;
} = {}): Request {
  return {
    headers: {
      ...(input.authorization ? { authorization: input.authorization } : {}),
      ...(input.headers ?? {}),
    },
    query: input.query ?? {},
    cookies: {},
    params: input.params ?? {},
    user: input.userId
      ? {
        userId: input.userId,
        primaryAccountId: 'demo-account',
        email: 'user@example.com',
        displayName: '一般ユーザー',
        role: 'user',
      }
      : undefined,
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

function createTradeNoteForPreset(overrides: Partial<TradeNote> = {}): TradeNote {
  return {
    id: '00000000-0000-4000-8000-000000000222',
    tradeId: 'trade-1',
    timestamp: new Date('2026-06-15T00:00:00Z'),
    symbol: 'USDJPY',
    side: 'buy',
    entryPrice: 150,
    quantity: 1,
    marketContext: {
      timeframe: '1h',
      trend: 'bullish',
      indicators: {
        rsi: 52,
        macd: 0.2,
        volume: 1000,
      },
    },
    aiSummary: '上昇トレンド内の押し目買い',
    features: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    createdAt: new Date('2026-06-15T00:00:00Z'),
    status: 'active',
    ...overrides,
  };
}

function createMarketDataForPreset(close: number): MarketData {
  return {
    symbol: 'USDJPY',
    timestamp: new Date('2026-06-15T01:00:00Z'),
    timeframe: '1h',
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  };
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

  it('通知ログ固定パスは /:id より前に定義されている', () => {
    const routes = (notificationRoutes as Router & { stack: RouteLayer[] }).stack
      .map((layer) => layer.route?.path)
      .filter((path): path is string => typeof path === 'string');

    const idRouteIndex = routes.indexOf('/:id');

    expect(routes.indexOf('/check')).toBeLessThan(idRouteIndex);
    expect(routes.indexOf('/logs')).toBeLessThan(idRouteIndex);
    expect(routes.indexOf('/logs/:id')).toBeLessThan(idRouteIndex);
  });

  it('/api/settings の旧通知値を NotificationPreference user scope に同期する入力へ変換する', () => {
    expect(buildNotificationPreferenceSyncInput({ scoreThreshold: 85, maxPerDay: 12 })).toEqual({
      scope: 'user',
      threshold: 0.85,
      maxPerDay: 12,
    });
    expect(buildNotificationPreferenceSyncInput({ scoreThreshold: 50 })).toEqual({
      scope: 'user',
      threshold: 0.7,
    });
    expect(buildNotificationPreferenceSyncInput({ enabled: false })).toBeNull();
  });

  it('/api/settings の旧通知スライダーは実効下限 70 に正規化する', () => {
    expect(
      normalizeSettingsUpdateForNotificationPreference({
        notification: { enabled: true, scoreThreshold: 50, maxPerDay: 8 },
      })
    ).toEqual({
      notification: { enabled: true, scoreThreshold: 70, maxPerDay: 8 },
    });
  });

  it('注文プリセットは認証ユーザーの noteId として取得する', async () => {
    const userId = '00000000-0000-4000-8000-000000000111';
    const noteId = '00000000-0000-4000-8000-000000000222';
    const controller = new OrderController();
    const getNoteById = jest.fn<Promise<null>, [string, string?]>().mockResolvedValue(null);

    Object.defineProperty(controller, 'noteService', {
      value: { getNoteById },
      configurable: true,
    });

    const res = createMockResponse();
    await controller.generatePreset(createRequest({ params: { noteId }, userId }), res);

    expect(getNoteById).toHaveBeenCalledWith(noteId, userId);
    expect(res.statusCode).toBe(404);
  });

  it('注文プリセットの信頼度は最新マッチスコアを優先する', async () => {
    const userId = '00000000-0000-4000-8000-000000000111';
    const note = createTradeNoteForPreset();
    const latestMatch: LatestMatchForNote = {
      score: 0.92,
      threshold: 0.8,
      trendMatched: true,
      priceRangeMatched: true,
      evaluatedAt: new Date('2026-06-15T01:00:00Z'),
    };
    const controller = new OrderController();
    const getNoteById = jest.fn<Promise<TradeNote | null>, [string, string?]>().mockResolvedValue(note);
    const getCurrentMarketData = jest.fn<Promise<MarketData>, [string]>()
      .mockResolvedValue(createMarketDataForPreset(151));
    const findLatestForNote = jest.fn<Promise<LatestMatchForNote | null>, [string, string]>()
      .mockResolvedValue(latestMatch);

    Object.defineProperty(controller, 'noteService', {
      value: { getNoteById },
      configurable: true,
    });
    Object.defineProperty(controller, 'marketService', {
      value: { getCurrentMarketData },
      configurable: true,
    });
    Object.defineProperty(controller, 'matchResultRepository', {
      value: { findLatestForNote },
      configurable: true,
    });

    const res = createMockResponse();
    await controller.generatePreset(createRequest({ params: { noteId: note.id }, userId }), res);

    const body = res.body as { preset: OrderPreset };
    expect(findLatestForNote).toHaveBeenCalledWith(note.id, userId);
    expect(body.preset.confidence).toBe(0.92);
  });

  it('最新マッチが無い注文プリセットはノート情報量から保守的に信頼度を算出する', async () => {
    const userId = '00000000-0000-4000-8000-000000000111';
    const note = createTradeNoteForPreset();
    const controller = new OrderController();
    const getNoteById = jest.fn<Promise<TradeNote | null>, [string, string?]>().mockResolvedValue(note);
    const getCurrentMarketData = jest.fn<Promise<MarketData>, [string]>()
      .mockResolvedValue(createMarketDataForPreset(150));
    const findLatestForNote = jest.fn<Promise<LatestMatchForNote | null>, [string, string]>()
      .mockResolvedValue(null);

    Object.defineProperty(controller, 'noteService', {
      value: { getNoteById },
      configurable: true,
    });
    Object.defineProperty(controller, 'marketService', {
      value: { getCurrentMarketData },
      configurable: true,
    });
    Object.defineProperty(controller, 'matchResultRepository', {
      value: { findLatestForNote },
      configurable: true,
    });

    const res = createMockResponse();
    await controller.generatePreset(createRequest({ params: { noteId: note.id }, userId }), res);

    const body = res.body as { preset: OrderPreset };
    expect(body.preset.confidence).toBe(0.85);
  });

  it('通知ログ一覧は認証ユーザーの所有ログだけを問い合わせる', async () => {
    const userId = '00000000-0000-4000-8000-000000000111';
    const controller = new NotificationController();
    const getLogsBySymbol = jest.fn<Promise<never[]>, [string, number?, string?]>()
      .mockResolvedValue([]);

    Object.defineProperty(controller, 'notificationLogRepository', {
      value: { getLogsBySymbol },
      configurable: true,
    });

    const res = createMockResponse();
    res.locals.validatedQuery = { symbol: 'USDJPY', limit: '25' };

    await controller.getNotificationLogs(createRequest({ userId }), res);

    expect(getLogsBySymbol).toHaveBeenCalledWith('USDJPY', 25, userId);
    expect(res.body).toEqual({ logs: [] });
  });

  it('他ユーザーの通知ログ詳細は 404 として扱う', async () => {
    const userId = '00000000-0000-4000-8000-000000000111';
    const logId = '00000000-0000-4000-8000-000000000333';
    const controller = new NotificationController();
    const getLogById = jest.fn<Promise<null>, [string, string?]>().mockResolvedValue(null);

    Object.defineProperty(controller, 'notificationLogRepository', {
      value: { getLogById },
      configurable: true,
    });

    const res = createMockResponse();
    await controller.getNotificationLogById(createRequest({ params: { id: logId }, userId }), res);

    expect(getLogById).toHaveBeenCalledWith(logId, userId);
    expect(res.statusCode).toBe(404);
  });

  it('他ユーザーの通知ログ削除は 404 として扱う', async () => {
    const userId = '00000000-0000-4000-8000-000000000111';
    const logId = '00000000-0000-4000-8000-000000000333';
    const controller = new NotificationController();
    const deleteLogById = jest.fn<Promise<boolean>, [string, string?]>().mockResolvedValue(false);

    Object.defineProperty(controller, 'notificationLogRepository', {
      value: { deleteLogById },
      configurable: true,
    });

    const res = createMockResponse();
    await controller.deleteNotificationLog(createRequest({ params: { id: logId }, userId }), res);

    expect(deleteLogById).toHaveBeenCalledWith(logId, userId);
    expect(res.statusCode).toBe(404);
  });
});
