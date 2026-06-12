/**
 * 通知 SSE ハンドラ (Phase δ-3、createNotificationStreamHandler) のユニットテスト
 *
 * 検証観点:
 * - 接続時に SSE ヘッダと初期 unread_count が送られる
 * - サーバ側 DB ポーリングで新着が notification イベントとして配信され、カーソルが進む
 * - クエリは常に認証ユーザーの userId で行われる (per-user 分離)
 * - DB エラーで接続が切れない (次回ポーリングで自己回復)
 * - 切断 (req close) でタイマーが停止する
 *
 * repo は DI で差し替え、実 DB なしで実行する。
 */

import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import {
  createNotificationStreamHandler,
  type NotificationStreamRepo,
} from '../api/notificationRoutes';

/** SSE 書き込みを捕捉する fake Response */
function makeFakeRes(): { res: Response; written: string[]; ended: () => boolean } {
  const written: string[] = [];
  let ended = false;
  const res = {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: (chunk: string) => {
      written.push(chunk);
      return true;
    },
    end: () => {
      ended = true;
    },
  } as unknown as Response;
  return { res, written, ended: () => ended };
}

/** 認証済みユーザー付きの fake Request (close イベントを emit できる) */
function makeFakeReq(userId: string): Request & EventEmitter {
  const emitter = new EventEmitter() as EventEmitter & { user?: { userId: string } };
  emitter.user = { userId };
  return emitter as unknown as Request & EventEmitter;
}

/** written から指定イベントのペイロード一覧を取り出す */
function eventsOf(written: string[], event: string): Array<Record<string, string | number>> {
  return written
    .filter((chunk) => chunk.startsWith(`event: ${event}\n`))
    .map((chunk) => {
      const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
      return JSON.parse(dataLine ? dataLine.slice('data: '.length) : '{}') as Record<
        string,
        string | number
      >;
    });
}

describe('createNotificationStreamHandler(通知 SSE、Phase δ-3)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /** 1 件分の通知行を作る */
  function makeRow(id: string, createdAt: Date) {
    return {
      id,
      type: 'note_match',
      title: `通知 ${id}`,
      message: 'テスト',
      sentAt: createdAt,
      createdAt,
    };
  }

  test('接続時に SSE ヘッダ + 初期 unread_count、新着はポーリングで配信されカーソルが進む', async () => {
    const calls: Array<{ userId: string; since: Date }> = [];
    let batch: ReturnType<typeof makeRow>[] = [];
    const repo: NotificationStreamRepo = {
      countUnread: jest.fn().mockResolvedValue(3),
      findCreatedSince: (userId, since) => {
        calls.push({ userId, since });
        const result = batch;
        batch = [];
        return Promise.resolve(result);
      },
    };
    const handler = createNotificationStreamHandler(repo);
    const req = makeFakeReq('user-1');
    const { res, written } = makeFakeRes();

    await handler(req, res);

    // SSE ヘッダ + 初期 unread_count
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(eventsOf(written, 'unread_count')).toEqual([{ count: 3 }]);

    // 1 回目のポーリング: 新着 2 件 → notification ×2 + unread_count 再送
    batch = [makeRow('n1', new Date('2026-06-13T00:00:10Z')), makeRow('n2', new Date('2026-06-13T00:00:11Z'))];
    await jest.advanceTimersByTimeAsync(10_000);
    const notifications = eventsOf(written, 'notification');
    expect(notifications).toHaveLength(2);
    expect(notifications[0].id).toBe('n1');
    expect(notifications[1].title).toBe('通知 n2');

    // per-user 分離: クエリは常に認証ユーザーの userId
    expect(calls.every((c) => c.userId === 'user-1')).toBe(true);

    // 2 回目のポーリング: カーソルが最後の createdAt まで進んでいる
    await jest.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(2);
    expect(calls[1].since.toISOString()).toBe('2026-06-13T00:00:11.000Z');

    req.emit('close');
  });

  test('DB エラーで接続を切らず、次回ポーリングで自己回復する', async () => {
    let fail = true;
    const repo: NotificationStreamRepo = {
      countUnread: jest.fn().mockResolvedValue(0),
      findCreatedSince: () => {
        if (fail) {
          fail = false;
          return Promise.reject(new Error('一過性の DB エラー'));
        }
        return Promise.resolve([makeRow('n1', new Date())]);
      },
    };
    const handler = createNotificationStreamHandler(repo);
    const req = makeFakeReq('user-1');
    const { res, written, ended } = makeFakeRes();
    await handler(req, res);

    await jest.advanceTimersByTimeAsync(10_000); // 失敗 → 継続
    expect(ended()).toBe(false);
    await jest.advanceTimersByTimeAsync(10_000); // 成功 → 配信
    expect(eventsOf(written, 'notification')).toHaveLength(1);

    req.emit('close');
  });

  test('切断 (req close) 後はポーリングも heartbeat も止まる', async () => {
    const findCreatedSince = jest.fn().mockResolvedValue([]);
    const repo: NotificationStreamRepo = {
      countUnread: jest.fn().mockResolvedValue(0),
      findCreatedSince,
    };
    const handler = createNotificationStreamHandler(repo);
    const req = makeFakeReq('user-1');
    const { res, written, ended } = makeFakeRes();
    await handler(req, res);

    req.emit('close');
    expect(ended()).toBe(true);

    const writesAtClose = written.length;
    await jest.advanceTimersByTimeAsync(60_000);
    expect(findCreatedSince).not.toHaveBeenCalled();
    expect(written.length).toBe(writesAtClose); // heartbeat も増えない
  });
});
