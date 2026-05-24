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
  const get = async (key: SystemStateKey): Promise<string | null> => {
    const record = await client.systemState.findUnique({
      where: { key },
    });
    return record?.value ?? null;
  };

  const getBoolean = async (key: SystemStateKey, defaultValue = false): Promise<boolean> => {
    const value = await get(key);
    if (value === null) {
      return defaultValue;
    }
    return value === 'true';
  };

  const getInt = async (key: SystemStateKey, defaultValue = 0): Promise<number> => {
    const value = await get(key);
    if (value === null) {
      return defaultValue;
    }
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  };

  const set = async (key: SystemStateKey, value: string): Promise<SystemState> => {
    return client.systemState.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  };

  const setBoolean = async (key: SystemStateKey, value: boolean): Promise<SystemState> => {
    return set(key, value ? 'true' : 'false');
  };

  const setInt = async (key: SystemStateKey, value: number): Promise<SystemState> => {
    return set(key, value.toString());
  };

  const deleteKey = async (key: SystemStateKey): Promise<void> => {
    await client.systemState.deleteMany({
      where: { key },
    });
  };

  return {
    get,
    getBoolean,
    getInt,
    set,
    setBoolean,
    setInt,
    delete: deleteKey,
  };
}

export type SystemStateRepository = ReturnType<typeof createSystemStateRepository>;
