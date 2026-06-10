import fs from 'fs';
import path from 'path';
import { promises as fsp } from 'fs';
import type { Prisma } from '@prisma/client';
import type { Notification } from '../../models/types';
import type { NotificationRepository } from '../../domain/notification/NotificationRepository';

/**
 * JSON 列に格納される任意の値を表す具体型。
 * Prisma.JsonValue (null | string | number | boolean | JsonArray | JsonObject) と等価。
 */
type JsonValue = Prisma.JsonValue;

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

/**
 * RawMatchResult のサブセクション (currentMarket / historicalNote 等)。
 * JSON 由来のため任意キーを許容する。Record で表現することで
 * optional property と index signature の整合問題を回避する。
 */
type RawMarketSnapshot = Record<string, JsonValue>;
type RawHistoricalNote = Record<string, JsonValue>;

/**
 * RawMatchResult は JSON 由来オブジェクトを表す。
 * 必須キーがなく、convertDates 側で各フィールドの存在をチェックする。
 */
type RawMatchResult = Record<string, JsonValue>;

/**
 * JsonValue 配列を RawNotification[] に narrow するヘルパー。
 * 構造的に最低限 `id` と `timestamp` を持つ要素のみを採用する。
 */
function parseRawNotifications(value: JsonValue): RawNotification[] {
  if (!Array.isArray(value)) return [];
  const result: RawNotification[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    // narrow 後の item は Prisma.JsonObject (= { [key: string]?: JsonValue }) と確定済み。
    const obj = item;
    const id = obj.id;
    const timestamp = obj.timestamp;
    if (typeof id !== 'string' || typeof timestamp !== 'string') continue;
    // 残りのフィールドは convertDates 側でフォールバック処理するため、構造を維持したまま渡す。
    result.push(obj as unknown as RawNotification); // eslint-disable-line no-restricted-syntax -- JsonObject から RawNotification への narrow (id/timestamp は上で検証済み)
  }
  return result;
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
    // JSON.parse は any を返すため一度 JsonValue で受け、その後配列要素を RawNotification として narrow する。
    // 配列でなければ空配列にフォールバックする。
    const parsed: JsonValue = JSON.parse(content) as JsonValue;
    const data: RawNotification[] = parseRawNotifications(parsed);

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

  // FS モードはファイル配列が単一の真実なので、対象を書き換えてファイルへ保存する。
  async markAsRead(id: string): Promise<void> {
    const all = await this.loadAll();
    const target = all.find((n) => n.id === id);
    if (target) {
      target.read = true;
      await this.saveAll(all);
    }
  }

  async markAllAsRead(): Promise<void> {
    const all = await this.loadAll();
    for (const n of all) {
      n.read = true;
    }
    await this.saveAll(all);
  }

  async delete(id: string): Promise<void> {
    const all = await this.loadAll();
    await this.saveAll(all.filter((n) => n.id !== id));
  }

  async deleteAll(): Promise<void> {
    await this.saveAll([]);
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

    // raw.matchResult は型上は Record<string, JsonValue> だが、JSON 由来のため実体が
    // 文字列 / 数値 / 配列 / null になり得る。スプレッド前に「非 null かつ object かつ非配列」を確認する。
    if (
      raw.matchResult &&
      typeof raw.matchResult === 'object' &&
      !Array.isArray(raw.matchResult)
    ) {
      // JSON 由来の値を Record<string, JsonValue> として narrow し、文字列フィールドだけ Date 化する
      const matchResultRaw = raw.matchResult;
      const mrTimestamp = typeof matchResultRaw.timestamp === 'string' ? matchResultRaw.timestamp : undefined;
      const currentMarketRaw = (matchResultRaw.currentMarket && typeof matchResultRaw.currentMarket === 'object' && !Array.isArray(matchResultRaw.currentMarket))
        ? matchResultRaw.currentMarket as RawMarketSnapshot
        : undefined;
      const historicalNoteRaw = (matchResultRaw.historicalNote && typeof matchResultRaw.historicalNote === 'object' && !Array.isArray(matchResultRaw.historicalNote))
        ? matchResultRaw.historicalNote as RawHistoricalNote
        : undefined;
      const cmTimestamp = currentMarketRaw && typeof currentMarketRaw.timestamp === 'string' ? currentMarketRaw.timestamp : undefined;
      const hnTimestamp = historicalNoteRaw && typeof historicalNoteRaw.timestamp === 'string' ? historicalNoteRaw.timestamp : undefined;
      const hnCreatedAt = historicalNoteRaw && typeof historicalNoteRaw.createdAt === 'string' ? historicalNoteRaw.createdAt : undefined;

      notification.matchResult = {
        ...matchResultRaw,
        timestamp: mrTimestamp ? new Date(mrTimestamp) : undefined,
        currentMarket: currentMarketRaw
          ? {
              ...currentMarketRaw,
              timestamp: cmTimestamp ? new Date(cmTimestamp) : undefined,
            }
          : undefined,
        historicalNote: historicalNoteRaw
          ? {
              ...historicalNoteRaw,
              timestamp: hnTimestamp ? new Date(hnTimestamp) : undefined,
              createdAt: hnCreatedAt ? new Date(hnCreatedAt) : undefined,
            }
          : undefined,
      } as Notification['matchResult'];
    }

    return notification;
  }
}
