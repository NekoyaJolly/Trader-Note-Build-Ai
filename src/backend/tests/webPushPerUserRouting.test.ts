/**
 * Web Push の per-user 配信ルーティングテスト (Phase β-1)
 *
 * 対象:
 * - InAppNotificationSender.sendPush: 由来 MatchResult.userId が分かる場合は
 *   sendToUser、不明 (null / MatchResult 不在) は broadcast にフォールバック
 * - strategyAlertService.triggerAlert (web_push チャネル): ストラテジーの
 *   所有ユーザーへ sendToUser、レガシー行 (userId=null) は broadcast
 *
 * 正常系 / 境界値 (userId=null) / 異常系 (MatchResult 不在) を含む。
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { NotificationPayload } from '../../services/notification/notificationSender';
import type { WebPushService, PushSendResult } from '../services/webPushService';
import type { PrismaClient } from '@prisma/client';

// ============================================
// strategyAlertService 用のモジュールモック
// ============================================

const mockAlertPrisma = {
  strategyAlert: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  strategyAlertLog: {
    create: jest.fn(),
  },
};

jest.mock('../db/client', () => ({
  prisma: mockAlertPrisma,
}));

const emptyResult: PushSendResult = { successCount: 1, failureCount: 0, results: [] };
const mockWebPushForAlert = {
  sendToUser: jest.fn<WebPushService['sendToUser']>().mockResolvedValue(emptyResult),
  broadcast: jest.fn<WebPushService['broadcast']>().mockResolvedValue(emptyResult),
};

jest.mock('../services/webPushService', () => ({
  // createWebPushService はテスト用のモック WebPushService を返す
  createWebPushService: jest.fn(() => mockWebPushForAlert),
}));

// 被モックモジュール (../db/client) を transitive に require するため、
// モック定義の後で import する (jest.mock の hoisting と TDZ の衝突回避)
import { triggerAlert } from '../services/strategyAlertService';
import { InAppNotificationSender } from '../../services/notification/inAppNotificationSender';

// ============================================
// InAppNotificationSender.sendPush
// ============================================

describe('InAppNotificationSender.sendPush の per-user ルーティング (Phase β-1)', () => {
  const payload: NotificationPayload = {
    noteId: 'note-1',
    marketSnapshotId: 'snap-1',
    symbol: 'USDJPY',
    score: 0.9,
    title: '一致検出: USDJPY',
    message: 'テスト',
    reasonSummary: 'score 0.9',
  };

  const makeSender = (
    matchResultUserId: string | null | undefined,
    noteUserId: string | null = null
  ) => {
    // sendPush が参照するのは matchResult.findUnique (複合ユニークキー) のみ。
    // note.userId は MatchResult.userId が NULL のレガシー行のフォールバック先
    const prismaMock = {
      matchResult: {
        findUnique: jest.fn<() => Promise<{ userId: string | null; note: { userId: string | null } } | null>>()
          .mockResolvedValue(
            matchResultUserId === undefined
              ? null
              : { userId: matchResultUserId, note: { userId: noteUserId } }
          ),
      },
    } as unknown as PrismaClient;
    const webPush = {
      sendToUser: jest.fn<WebPushService['sendToUser']>().mockResolvedValue(emptyResult),
      broadcast: jest.fn<WebPushService['broadcast']>().mockResolvedValue(emptyResult),
    } as unknown as WebPushService;
    const sender = new InAppNotificationSender(prismaMock, webPush);
    return { sender, webPush };
  };

  it('MatchResult.userId がある場合は宛先ユーザーのみへ送信する (正常系)', async () => {
    const { sender, webPush } = makeSender('user-a-uuid');

    const result = await sender.sendPush(payload);

    expect(result.success).toBe(true);
    expect(webPush.sendToUser).toHaveBeenCalledWith(
      'user-a-uuid',
      expect.objectContaining({ tag: 'note-match-note-1' })
    );
    expect(webPush.broadcast).not.toHaveBeenCalled();
  });

  it('MatchResult.userId が null でも由来ノートの userId があればそのユーザーへ送信する (フォールバック)', async () => {
    const { sender, webPush } = makeSender(null, 'note-owner-uuid');

    await sender.sendPush(payload);

    expect(webPush.sendToUser).toHaveBeenCalledWith(
      'note-owner-uuid',
      expect.objectContaining({ tag: 'note-match-note-1' })
    );
    expect(webPush.broadcast).not.toHaveBeenCalled();
  });

  it('MatchResult.userId もノート userId も null (レガシー行) は broadcast にフォールバックする (境界値)', async () => {
    const { sender, webPush } = makeSender(null, null);

    await sender.sendPush(payload);

    expect(webPush.broadcast).toHaveBeenCalledTimes(1);
    expect(webPush.sendToUser).not.toHaveBeenCalled();
  });

  it('MatchResult が存在しない場合も broadcast にフォールバックする (異常系)', async () => {
    const { sender, webPush } = makeSender(undefined);

    await sender.sendPush(payload);

    expect(webPush.broadcast).toHaveBeenCalledTimes(1);
    expect(webPush.sendToUser).not.toHaveBeenCalled();
  });
});

// ============================================
// strategyAlertService.triggerAlert (web_push チャネル)
// ============================================

describe('strategyAlertService の Web Push per-user ルーティング (Phase β-1)', () => {
  const makeAlert = (userId: string | null) => ({
    id: 'alert-1',
    strategyId: 'strategy-1',
    enabled: true,
    status: 'enabled',
    minMatchScore: 0,
    cooldownMinutes: 0,
    lastTriggeredAt: null,
    channels: ['web_push'],
    strategy: { name: 'テスト戦略', symbol: 'USDJPY', userId },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAlertPrisma.strategyAlertLog.create.mockResolvedValue({ id: 'log-1' } as never);
    mockAlertPrisma.strategyAlert.update.mockResolvedValue({} as never);
    mockWebPushForAlert.sendToUser.mockResolvedValue(emptyResult);
    mockWebPushForAlert.broadcast.mockResolvedValue(emptyResult);
  });

  it('strategy.userId がある場合は所有ユーザーのみへ送信する (正常系)', async () => {
    mockAlertPrisma.strategyAlert.findUnique.mockResolvedValue(makeAlert('user-a-uuid') as never);

    const result = await triggerAlert({
      strategyId: 'strategy-1',
      matchScore: 1.0,
      indicatorValues: {},
    });

    expect(result.triggered).toBe(true);
    expect(mockWebPushForAlert.sendToUser).toHaveBeenCalledWith(
      'user-a-uuid',
      expect.objectContaining({ tag: 'strategy-alert-テスト戦略' })
    );
    expect(mockWebPushForAlert.broadcast).not.toHaveBeenCalled();
  });

  it('strategy.userId が null (レガシー行) は broadcast にフォールバックする (境界値)', async () => {
    mockAlertPrisma.strategyAlert.findUnique.mockResolvedValue(makeAlert(null) as never);

    const result = await triggerAlert({
      strategyId: 'strategy-1',
      matchScore: 1.0,
      indicatorValues: {},
    });

    expect(result.triggered).toBe(true);
    expect(mockWebPushForAlert.broadcast).toHaveBeenCalledTimes(1);
    expect(mockWebPushForAlert.sendToUser).not.toHaveBeenCalled();
  });
});
