/**
 * SystemState リポジトリ
 *
 * システムの共通状態（キルスイッチ、連続エラー数など）を永続化するための
 * SystemState テーブルに対する Prisma 操作を提供します。
 */

import type { PrismaClient, SystemState } from '@prisma/client';
import { prisma as defaultPrisma } from '../../backend/db/client';

export type SystemStateKey =
  | 'emergency_stop'
  | 'consecutive_errors'
  | 'last_db_alert_sent'
  | 'emergency_last_action'
  | 'emergency_last_action_at'
  | 'emergency_last_action_by'
  | 'emergency_last_action_source'
  | 'emergency_last_action_reason';

export type EmergencyAuditAction = 'stop' | 'resume' | 'auto_stop';

export interface EmergencyAuditInput {
  /** 緊急停止まわりで発生した操作種別 */
  action: EmergencyAuditAction;
  /** API / mail / scheduler など、操作の入口 */
  source: string;
  /** userId や mail sender など、秘密情報を含まない操作者識別子 */
  actor: string;
  /** 監査で追える範囲の理由。token や accountId は入れない */
  reason: string;
}

type SystemStatePrisma = Pick<PrismaClient, 'systemState'> & {
  $queryRawUnsafe?: PrismaClient['$queryRawUnsafe'];
};

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

  const increment = async (key: SystemStateKey): Promise<SystemState> => {
    // raw query でアトミックにインクリメントする（モック等でメソッドがない場合はフォールバック）
    if (!client.$queryRawUnsafe) {
      const current = await getInt(key, 0);
      return setInt(key, current + 1);
    }

    const rows = await client.$queryRawUnsafe<SystemState[]>(`
      INSERT INTO "SystemState" (key, value, "updatedAt")
      VALUES ($1, '1', NOW())
      ON CONFLICT (key)
      DO UPDATE SET 
        value = CASE 
          WHEN "SystemState".value ~ '^[0-9]+$' THEN ("SystemState".value::integer + 1)::text
          ELSE '1'
        END,
        "updatedAt" = NOW()
      RETURNING *;
    `, key);
    return rows[0];
  };

  const recordEmergencyAudit = async (input: EmergencyAuditInput): Promise<void> => {
    const recordedAt = new Date().toISOString();
    await Promise.all([
      set('emergency_last_action', input.action),
      set('emergency_last_action_at', recordedAt),
      set('emergency_last_action_by', input.actor),
      set('emergency_last_action_source', input.source),
      set('emergency_last_action_reason', input.reason),
    ]);
  };

  return {
    get,
    getBoolean,
    getInt,
    set,
    setBoolean,
    setInt,
    delete: deleteKey,
    increment,
    recordEmergencyAudit,
  };
}

export type SystemStateRepository = ReturnType<typeof createSystemStateRepository>;
