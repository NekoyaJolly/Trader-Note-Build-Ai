import type { Notification } from '../../models/types';

// Prisma 非依存の通知リポジトリインターフェース
//
// Phase α-4 (マルチユーザー分離): 読み取り・更新系は宛先ユーザー (userId) を
// 受け取れるようにする。DB 実装は WHERE userId で分離し、FS 実装 (開発専用・
// 単一ユーザー前提) は userId を無視する。userId 未指定時は従来挙動 (全件)。
export interface NotificationRepository {
  loadAll(userId?: string): Promise<Notification[]>;
  saveAll(notifications: Notification[]): Promise<void>;
  save(notification: Notification): Promise<void>;

  // 既読・削除の永続化操作（明示メソッド）。
  // 旧実装は NotificationService が in-memory 配列を書き換えて saveAll で永続化していたが、
  // DB モードのアダプタでは saveAll が「全件 create」になり、既読/削除が反映されず通知が
  // 複製される不具合があった。各操作を専用メソッドにして、DB アダプタは UPDATE 系で正しく
  // 永続化する（2026-06-10 実機検証で発見）。
  /** 1 件を既読にする (userId 指定時は宛先ユーザーの通知のみ) */
  markAsRead(id: string, userId?: string): Promise<void>;
  /** 全未読を既読にする (userId 指定時は宛先ユーザーの通知のみ) */
  markAllAsRead(userId?: string): Promise<void>;
  /** 1 件を削除する（DB はソフトデリート、FS は配列から除去） */
  delete(id: string, userId?: string): Promise<void>;
  /** 全件を削除する（DB はソフトデリート、FS は空配列化） */
  deleteAll(userId?: string): Promise<void>;
}
