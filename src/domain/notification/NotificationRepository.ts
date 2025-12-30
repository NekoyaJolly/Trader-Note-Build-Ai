import { Notification } from '../../models/types';

// Prisma 非依存の通知リポジトリインターフェース
export interface NotificationRepository {
  loadAll(): Promise<Notification[]>;
  saveAll(notifications: Notification[]): Promise<void>;
  save(notification: Notification): Promise<void>;
}
