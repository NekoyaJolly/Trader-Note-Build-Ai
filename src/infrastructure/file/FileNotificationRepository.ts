import fs from 'fs';
import path from 'path';
import { promises as fsp } from 'fs';
import { Notification } from '../../models/types';
import { NotificationRepository } from '../../domain/notification/NotificationRepository';

/**
 * JSON ファイルから読み込んだ生データの型
 * 日付は文字列形式で格納されている
 */
interface RawNotification {
  id: string;
  type?: 'match' | 'info' | 'warning';
  title?: string;
  message?: string;
  timestamp: string;
  read?: boolean;
  matchResult?: RawMatchResult;
}

interface RawMatchResult {
  timestamp?: string;
  currentMarket?: {
    timestamp?: string;
    [key: string]: unknown;
  };
  historicalNote?: {
    timestamp?: string;
    createdAt?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

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
    const data: RawNotification[] = JSON.parse(content);

    return data.map((n) => this.convertDates(n));
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

  /**
   * 生データを Notification 型に変換する
   * 日付文字列を Date オブジェクトに変換
   * 
   * @param raw - ファイルから読み込んだ生データ
   * @returns Notification 型のデータ
   */
  private convertDates(raw: RawNotification): Notification {
    // デフォルト値を設定して Notification 型を満たす
    const notification: Notification = {
      id: raw.id,
      type: raw.type || 'match',
      title: raw.title || '',
      message: raw.message || '',
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
      } as Notification['matchResult'];
    }

    return notification;
  }
}
