/**
 * NotificationService のキャッシュ鮮度テスト
 *
 * 背景(実機検証 2026-06-10 で発見):
 * DB モードでは本サービス以外の経路(マッチングパイプラインの InAppNotificationSender、
 * ストラテジーアラートの strategyAlertService)が Notification テーブルへ直接書き込む。
 * 旧実装はコンストラクタ時に 1 度だけ通知をロードしてキャッシュしていたため、起動後に
 * 別経路で作られた通知が UI 一覧に出ない不具合があった(プロセス再起動まで届かない)。
 * 本テストは「DB モードでは読み取りのたびに再ロードする / FS モードは初回のみ」を固定する。
 */

import { NotificationService } from '../notificationService';
import type { NotificationRepository } from '../../domain/notification/NotificationRepository';
import type { Notification } from '../../models/types';
import { NotificationTriggerService } from '../notification/notificationTriggerService';
import { TradeNoteService } from '../tradeNoteService';

/**
 * loadAll の呼び出し回数を数えられるリポジトリモック。
 * 既読/削除の専用メソッドは内部状態 current を実際に書き換えるため、
 * 委譲後の loadFromRepository 再ロードが結果に反映される（end-to-end 検証用）。
 */
function makeRepoMock(initial: Notification[] = []): {
  repo: NotificationRepository;
  loadAll: jest.Mock<Promise<Notification[]>, []>;
  saveAll: jest.Mock<Promise<void>, [Notification[]]>;
  save: jest.Mock<Promise<void>, [Notification]>;
  markAsRead: jest.Mock<Promise<void>, [string]>;
  markAllAsRead: jest.Mock<Promise<void>, []>;
  deleteOne: jest.Mock<Promise<void>, [string]>;
  deleteAll: jest.Mock<Promise<void>, []>;
  setNext: (rows: Notification[]) => void;
} {
  let current = initial;
  const loadAll = jest.fn<Promise<Notification[]>, []>(() => Promise.resolve(current));
  const saveAll = jest.fn<Promise<void>, [Notification[]]>().mockResolvedValue(undefined);
  const save = jest.fn<Promise<void>, [Notification]>().mockResolvedValue(undefined);
  const markAsRead = jest.fn<Promise<void>, [string]>((id) => {
    current = current.map((n) => (n.id === id ? { ...n, read: true } : n));
    return Promise.resolve();
  });
  const markAllAsRead = jest.fn<Promise<void>, []>(() => {
    current = current.map((n) => ({ ...n, read: true }));
    return Promise.resolve();
  });
  const deleteOne = jest.fn<Promise<void>, [string]>((id) => {
    current = current.filter((n) => n.id !== id);
    return Promise.resolve();
  });
  const deleteAll = jest.fn<Promise<void>, []>(() => {
    current = [];
    return Promise.resolve();
  });
  const repo: NotificationRepository = {
    loadAll,
    saveAll,
    save,
    markAsRead,
    markAllAsRead,
    delete: deleteOne,
    deleteAll,
  };
  return {
    repo,
    loadAll,
    saveAll,
    save,
    markAsRead,
    markAllAsRead,
    deleteOne,
    deleteAll,
    setNext: (rows) => { current = rows; },
  };
}

function makeNotification(id: string): Notification {
  return {
    id,
    type: 'strategy_alert',
    title: `通知 ${id}`,
    message: 'テスト通知',
    timestamp: new Date('2026-06-10T12:00:00Z'),
    read: false,
  };
}

/** DB に触れない軽量コラボレータ(getNotifications は使わないのでメソッドは呼ばれない) */
function deps(): { trigger: NotificationTriggerService; note: TradeNoteService } {
  return { trigger: new NotificationTriggerService(), note: new TradeNoteService('fs') };
}

describe('NotificationService キャッシュ鮮度', () => {
  test('DB モードでは getNotifications のたびに再ロードし、別経路の新規通知を反映する', async () => {
    const { repo, loadAll, setNext } = makeRepoMock([]);
    const { trigger, note } = deps();
    const service = new NotificationService(repo, trigger, note, 'db');

    // 起動直後は空
    expect(await service.getNotifications()).toHaveLength(0);

    // 別経路(マッチング/アラート)が DB に通知を直接書いた状況を模す
    setNext([makeNotification('n1')]);

    // 再ロードされ、新規通知が見える(プロセス再起動不要)
    const after = await service.getNotifications();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe('n1');
    // コンストラクタ 1 回 + getNotifications 2 回 = 3 回
    expect(loadAll).toHaveBeenCalledTimes(3);
  });

  test('DB モードでは countUnread / getNotificationById も最新を反映する', async () => {
    const { repo, setNext } = makeRepoMock([]);
    const { trigger, note } = deps();
    const service = new NotificationService(repo, trigger, note, 'db');

    expect(await service.countUnread()).toBe(0);
    setNext([makeNotification('n1'), makeNotification('n2')]);
    expect(await service.countUnread()).toBe(2);
    expect(await service.getNotificationById('n2')).toBeDefined();
  });

  test('FS モードは初回ロードのみ(本サービスが単一の書き込み者のためキャッシュで十分)', async () => {
    const { repo, loadAll, setNext } = makeRepoMock([makeNotification('n1')]);
    const { trigger, note } = deps();
    const service = new NotificationService(repo, trigger, note, 'fs');

    await service.getNotifications();
    setNext([makeNotification('n1'), makeNotification('n2')]);
    const after = await service.getNotifications();

    // FS モードでは再ロードしないので 2 件目は見えない(初回キャッシュのまま)
    expect(after).toHaveLength(1);
    // コンストラクタの 1 回のみ
    expect(loadAll).toHaveBeenCalledTimes(1);
  });
});

describe('NotificationService 既読・削除の永続化委譲', () => {
  test('markAsRead はリポジトリの専用メソッドに委譲し、saveAll/save 経由の複製を起こさない', async () => {
    const { repo, markAsRead, saveAll, save } = makeRepoMock([
      makeNotification('n1'),
      makeNotification('n2'),
    ]);
    const { trigger, note } = deps();
    const service = new NotificationService(repo, trigger, note, 'db');

    await service.markAsRead('n1');

    // 専用 UPDATE 経路に委譲され、複製を起こす saveAll/save は呼ばれない
    expect(markAsRead).toHaveBeenCalledWith('n1');
    expect(saveAll).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();

    // 再取得しても既読のまま（DB 永続化 = 再ロードに反映）
    const after = await service.getNotifications();
    expect(after.find((n) => n.id === 'n1')?.read).toBe(true);
    expect(await service.countUnread()).toBe(1);
  });

  test('strategy_alert 通知(matchResultId 無し)も既読化できる', async () => {
    // makeNotification は type:strategy_alert（matchResult 無し）。旧 saveAll 経路では
    // matchResult が無い通知はスキップされ既読が永続化されなかった。委譲経路では永続化される。
    const { repo, markAsRead } = makeRepoMock([makeNotification('alert1')]);
    const { trigger, note } = deps();
    const service = new NotificationService(repo, trigger, note, 'db');

    await service.markAsRead('alert1');

    expect(markAsRead).toHaveBeenCalledWith('alert1');
    expect((await service.getNotifications())[0].read).toBe(true);
  });

  test('markAllAsRead / deleteNotification / clearAll も専用メソッドへ委譲する', async () => {
    const { repo, markAllAsRead, deleteOne, deleteAll, saveAll } = makeRepoMock([
      makeNotification('n1'),
      makeNotification('n2'),
    ]);
    const { trigger, note } = deps();
    const service = new NotificationService(repo, trigger, note, 'db');

    await service.markAllAsRead();
    expect(markAllAsRead).toHaveBeenCalledTimes(1);
    expect(await service.countUnread()).toBe(0);

    await service.deleteNotification('n1');
    expect(deleteOne).toHaveBeenCalledWith('n1');
    expect(await service.getNotifications()).toHaveLength(1);

    await service.clearAll();
    expect(deleteAll).toHaveBeenCalledTimes(1);
    expect(await service.getNotifications()).toHaveLength(0);

    // いずれの操作も複製を起こす saveAll を使わない
    expect(saveAll).not.toHaveBeenCalled();
  });
});
