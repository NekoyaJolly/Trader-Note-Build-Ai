import type { Notification } from '../../models/types';

// Prisma 非依存の通知リポジトリインターフェース
export interface NotificationRepository {
  loadAll(): Promise<Notification[]>;
  saveAll(notifications: Notification[]): Promise<void>;
  save(notification: Notification): Promise<void>;

  // 既読・削除の永続化操作（明示メソッド）。
  // 旧実装は NotificationService が in-memory 配列を書き換えて saveAll で永続化していたが、
  // DB モードのアダプタでは saveAll が「全件 create」になり、既読/削除が反映されず通知が
  // 複製される不具合があった。各操作を専用メソッドにして、DB アダプタは UPDATE 系で正しく
  // 永続化する（2026-06-10 実機検証で発見）。
  /** 1 件を既読にする */
  markAsRead(id: string): Promise<void>;
  /** 全未読を既読にする */
  markAllAsRead(): Promise<void>;
  /** 1 件を削除する（DB はソフトデリート、FS は配列から除去） */
  delete(id: string): Promise<void>;
  /** 全件を削除する（DB はソフトデリート、FS は空配列化） */
  deleteAll(): Promise<void>;
}
