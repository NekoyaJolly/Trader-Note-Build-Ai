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
  loadAll: jest.Mock<Promise<Notification[]>, [string?]>;
  saveAll: jest.Mock<Promise<void>, [Notification[]]>;
  save: jest.Mock<Promise<void>, [Notification]>;
  markAsRead: jest.Mock<Promise<void>, [string, string?]>;
  markAllAsRead: jest.Mock<Promise<void>, [string?]>;
  deleteOne: jest.Mock<Promise<void>, [string, string?]>;
  deleteAll: jest.Mock<Promise<void>, [string?]>;
  setNext: (rows: Notification[]) => void;
} {
  let current = initial;
  // Phase α-4: 各メソッドは宛先ユーザー (userId) を受け取れる。モックは挙動検証用に
  // 引数を記録するだけで、分離フィルタ自体は DB 実装側の責務 (リポジトリテストで担保)。
  const loadAll = jest.fn<Promise<Notification[]>, [string?]>(() => Promise.resolve(current));
  const saveAll = jest.fn<Promise<void>, [Notification[]]>().mockResolvedValue(undefined);
  const save = jest.fn<Promise<void>, [Notification]>().mockResolvedValue(undefined);
  const markAsRead = jest.fn<Promise<void>, [string, string?]>((id) => {
    current = current.map((n) => (n.id === id ? { ...n, read: true } : n));
    return Promise.resolve();
  });
  const markAllAsRead = jest.fn<Promise<void>, [string?]>(() => {
    current = current.map((n) => ({ ...n, read: true }));
    return Promise.resolve();
  });
  const deleteOne = jest.fn<Promise<void>, [string, string?]>((id) => {
    current = current.filter((n) => n.id !== id);
    return Promise.resolve();
  });
  const deleteAll = jest.fn<Promise<void>, [string?]>(() => {
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
    // (第2引数は Phase α-4 の宛先ユーザー。未指定経路では undefined が委譲される)
    expect(markAsRead).toHaveBeenCalledWith('n1', undefined);
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

    expect(markAsRead).toHaveBeenCalledWith('alert1', undefined);
    expect((await service.getNotifications())[0].read).toBe(true);
  });

  test('初期ロード未完了で markAsRead が呼ばれても、初期ロードの後勝ち上書きで既読が消えない', async () => {
    // コンストラクタの初期ロード(loadAll 1回目)を手動解決できるよう gate する。
    // FS モードは getNotifications がキャッシュ(this.notifications)を返すため、
    // 初期ロードが永続化後に解決して上書きするレースが顕在化しやすい。
    let current = [makeNotification('n1')];
    let resolveInitial!: (rows: Notification[]) => void;
    const initialGate = new Promise<Notification[]>((res) => {
      resolveInitial = res;
    });
    let calls = 0;
    const loadAll = jest.fn<Promise<Notification[]>, []>(() => {
      calls += 1;
      return calls === 1 ? initialGate : Promise.resolve(current.map((n) => ({ ...n })));
    });
    const markAsRead = jest.fn<Promise<void>, [string]>((id) => {
      current = current.map((n) => (n.id === id ? { ...n, read: true } : n));
      return Promise.resolve();
    });
    const repo: NotificationRepository = {
      loadAll,
      saveAll: jest.fn<Promise<void>, [Notification[]]>().mockResolvedValue(undefined),
      save: jest.fn<Promise<void>, [Notification]>().mockResolvedValue(undefined),
      markAsRead,
      markAllAsRead: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
      delete: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
      deleteAll: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    };
    const { trigger, note } = deps();
    const service = new NotificationService(repo, trigger, note, 'fs');

    // 初期ロード未完了のまま markAsRead を開始 → その後で初期ロードを解決
    const op = service.markAsRead('n1');
    resolveInitial([makeNotification('n1')]);
    await op;

    // markAsRead が loadPromise を待ってから永続化+再ロードするため、初期ロードの
    // 後勝ちで既読が失われない
    const after = await service.getNotifications();
    expect(after.find((n) => n.id === 'n1')?.read).toBe(true);
    expect(markAsRead).toHaveBeenCalledWith('n1', undefined);
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
    expect(deleteOne).toHaveBeenCalledWith('n1', undefined);
    expect(await service.getNotifications()).toHaveLength(1);

    await service.clearAll();
    expect(deleteAll).toHaveBeenCalledTimes(1);
    expect(await service.getNotifications()).toHaveLength(0);

    // いずれの操作も複製を起こす saveAll を使わない
    expect(saveAll).not.toHaveBeenCalled();
  });
});

describe('NotificationService ユーザー分離 (Phase α-4)', () => {
  test('userId 指定の読み取りはリポジトリへ userId を渡す (DB モードで宛先分離)', async () => {
    const { repo, loadAll } = makeRepoMock([makeNotification('n1')]);
    const { trigger, note } = deps();
    const service = new NotificationService(repo, trigger, note, 'db');

    await service.getNotifications(false, 'user-a-uuid');
    expect(loadAll).toHaveBeenLastCalledWith('user-a-uuid');

    await service.countUnread('user-a-uuid');
    expect(loadAll).toHaveBeenLastCalledWith('user-a-uuid');
  });

  test('userId 指定の更新系はリポジトリへ userId を渡す (他ユーザー宛の操作を防ぐ)', async () => {
    const { repo, markAsRead, markAllAsRead, deleteOne, deleteAll } = makeRepoMock([
      makeNotification('n1'),
    ]);
    const { trigger, note } = deps();
    const service = new NotificationService(repo, trigger, note, 'db');

    await service.markAsRead('n1', 'user-a-uuid');
    expect(markAsRead).toHaveBeenCalledWith('n1', 'user-a-uuid');

    await service.markAllAsRead('user-a-uuid');
    expect(markAllAsRead).toHaveBeenCalledWith('user-a-uuid');

    await service.deleteNotification('n1', 'user-a-uuid');
    expect(deleteOne).toHaveBeenCalledWith('n1', 'user-a-uuid');

    await service.clearAll('user-a-uuid');
    expect(deleteAll).toHaveBeenCalledWith('user-a-uuid');
  });

  test('userId 未指定は従来挙動 (引数なし委譲) を維持する (後方互換)', async () => {
    const { repo, loadAll, markAsRead } = makeRepoMock([makeNotification('n1')]);
    const { trigger, note } = deps();
    const service = new NotificationService(repo, trigger, note, 'db');

    await service.getNotifications();
    expect(loadAll).toHaveBeenLastCalledWith(undefined);

    await service.markAsRead('n1');
    expect(markAsRead).toHaveBeenCalledWith('n1', undefined);
  });
});
