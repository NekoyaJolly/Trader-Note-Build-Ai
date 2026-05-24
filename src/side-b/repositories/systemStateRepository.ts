/**
 * SystemState リポジトリ
 *
 * システムの共通状態（キルスイッチ、連続エラー数など）を永続化するための
 * SystemState テーブルに対する Prisma 操作を提供します。
 */

import type { PrismaClient, SystemState } from '@prisma/client';
import { prisma as defaultPrisma } from '../../backend/db/client';

export type SystemStateKey = 'emergency_stop' | 'consecutive_errors' | 'last_db_alert_sent';

type SystemStatePrisma = Pick<PrismaClient, 'systemState'>;

export function createSystemStateRepository(client: SystemStatePrisma = defaultPrisma) {
  return {
    /**
     * キーに対応する値を取得する
     */
    async get(key: SystemStateKey): Promise<string | null> {
      const record = await client.systemState.findUnique({
        where: { key },
      });
      return record?.value ?? null;
    },

    /**
     * キーに対応する値を取得し、Booleanに変換して返す
     */
    async getBoolean(key: SystemStateKey, defaultValue = false): Promise<boolean> {
      const value = await this.get(key);
      if (value === null) {
        return defaultValue;
      }
      return value === 'true';
    },

    /**
     * キーに対応する値を取得し、Intに変換して返す
     */
    async getInt(key: SystemStateKey, defaultValue = 0): Promise<number> {
      const value = await this.get(key);
      if (value === null) {
        return defaultValue;
      }
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? defaultValue : parsed;
    },

    /**
     * キーと値を設定（Upsert）する
     */
    async set(key: SystemStateKey, value: string): Promise<SystemState> {
      return client.systemState.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    },

    /**
     * Boolean型の値を設定する
     */
    async setBoolean(key: SystemStateKey, value: boolean): Promise<SystemState> {
      return this.set(key, value ? 'true' : 'false');
    },

    /**
     * Int型の値を設定する
     */
    async setInt(key: SystemStateKey, value: number): Promise<SystemState> {
      return this.set(key, value.toString());
    },

    /**
     * 指定したキーを削除する
     */
    async delete(key: SystemStateKey): Promise<void> {
      await client.systemState.deleteMany({
        where: { key },
      });
    }
  };
}

export type SystemStateRepository = ReturnType<typeof createSystemStateRepository>;
