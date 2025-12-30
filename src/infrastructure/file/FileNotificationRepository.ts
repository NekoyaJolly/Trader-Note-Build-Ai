import fs from 'fs';
import path from 'path';
import { promises as fsp } from 'fs';
import { Notification } from '../../models/types';
import { NotificationRepository } from '../../domain/notification/NotificationRepository';

/**
 * 通知をファイルストレージに保存するリポジトリ実装
 * 既存の data/notifications.json をそのまま利用する
 */
export class FileNotificationRepository implements NotificationRepository {
  private readonly notificationsPath: string;

  constructor(notificationsPath?: string) {
    this.notificationsPath = notificationsPath || path.join(process.cwd(), 'data', 'notifications.json');
  }

  async loadAll(): Promise<Notification[]> {
    if (!fs.existsSync(this.notificationsPath)) {
      return [];
    }

    const content = await fsp.readFile(this.notificationsPath, 'utf-8');
    const data = JSON.parse(content);

    return data.map((n: any) => this.convertDates(n));
  }

  async save(notification: Notification): Promise<void> {
    const current = await this.loadAll();
    current.push(notification);
    await this.saveAll(current);
  }

  async saveAll(notifications: Notification[]): Promise<void> {
    const dir = path.dirname(this.notificationsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await fsp.writeFile(
      this.notificationsPath,
      JSON.stringify(notifications, null, 2),
      'utf-8'
    );
  }

  private convertDates(raw: any): Notification {
    const notification: Notification = {
      ...raw,
      timestamp: new Date(raw.timestamp),
      read: Boolean(raw.read),
    };

    if (raw.matchResult) {
      notification.matchResult = {
        ...raw.matchResult,
        timestamp: raw.matchResult.timestamp ? new Date(raw.matchResult.timestamp) : undefined,
        currentMarket: raw.matchResult.currentMarket
          ? {
              ...raw.matchResult.currentMarket,
              timestamp: raw.matchResult.currentMarket.timestamp
                ? new Date(raw.matchResult.currentMarket.timestamp)
                : undefined,
            }
          : undefined,
        historicalNote: raw.matchResult.historicalNote
          ? {
              ...raw.matchResult.historicalNote,
              timestamp: raw.matchResult.historicalNote.timestamp
                ? new Date(raw.matchResult.historicalNote.timestamp)
                : undefined,
              createdAt: raw.matchResult.historicalNote.createdAt
                ? new Date(raw.matchResult.historicalNote.createdAt)
                : undefined,
            }
          : undefined,
      } as any;
    }

    return notification;
  }
}
