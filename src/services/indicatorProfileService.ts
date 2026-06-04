/**
 * インジケータープロファイルサービス
 *
 * 目的:
 * - インジケータープロファイル (CSV取込時のインジケーター設定セット) をユーザー別に永続化
 * - 作成・取得・更新・削除と、取込時のプロファイル選択 (options/default) を提供
 *
 * ストレージ:
 * - DB `IndicatorProfile` テーブル (userId 別、(userId,name) 一意)。
 * - 旧実装は data/indicator-profiles.json にファイル保存していたが、Cloud Run の揮発FSで
 *   永続しない・インスタンス間不整合・ユーザー別でない問題があったため DB へ移行した。
 *
 * 設計:
 * - indicators(JSON カラム) は DB 由来の外部入力として Zod で検証してから返す (any/unknown 不使用)。
 * - 予約ID (__AI_AUTO__ / __NONE__) は DB に持たず、呼び出し側で特別扱いする。
 */

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../backend/db/client';
import type { IndicatorConfig, IndicatorId } from '../models/indicatorConfig';
import { INDICATOR_METADATA } from '../models/indicatorConfig';
import type {
  IndicatorProfile,
  CreateProfileRequest,
  UpdateProfileRequest,
  ProfileOption,
} from '../models/indicatorProfile';
import {
  buildProfileOptions,
  RESERVED_PROFILE_IDS,
  isReservedProfileId,
} from '../models/indicatorProfile';

const IndicatorIdSchema = z.string().refine(
  (s): s is IndicatorId => INDICATOR_METADATA.some((m) => m.id === s),
  { message: '不正な indicatorId です' },
);

const IndicatorConfigJsonSchema = z.object({
  configId: z.string(),
  indicatorId: IndicatorIdSchema,
  label: z.string().optional(),
  params: z.record(z.string(), z.union([z.number(), z.undefined()])).default({}),
  enabled: z.boolean(),
});

const IndicatorsJsonSchema = z.array(IndicatorConfigJsonSchema);

/** Prisma JSON 行 → IndicatorConfig[] (検証付き)。不正なら空配列にフォールバック。 */
function parseIndicators(value: Prisma.JsonValue): IndicatorConfig[] {
  const parsed = IndicatorsJsonSchema.safeParse(value);
  if (!parsed.success) {
    console.warn('[IndicatorProfileService] indicators JSON の形式エラー:', parsed.error.format());
    return [];
  }
  return parsed.data.map((ind): IndicatorConfig => ({ ...ind, params: ind.params }));
}

/** IndicatorConfig[] → Prisma InputJsonValue (undefined param を落としつつプレーン化、キャスト不使用)。 */
function toIndicatorsJson(configs: IndicatorConfig[]): Prisma.InputJsonValue {
  return configs.map((c) => {
    const params: Record<string, number> = {};
    for (const [key, val] of Object.entries(c.params)) {
      if (typeof val === 'number') params[key] = val;
    }
    const obj: Prisma.InputJsonObject = {
      configId: c.configId,
      indicatorId: c.indicatorId,
      params,
      enabled: c.enabled,
      ...(c.label !== undefined ? { label: c.label } : {}),
    };
    return obj;
  });
}

/** Prisma 行 → ドメイン型 IndicatorProfile */
function toDomain(row: {
  id: string;
  name: string;
  description: string | null;
  indicators: Prisma.JsonValue;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}): IndicatorProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    indicators: parseIndicators(row.indicators),
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * インジケータープロファイルサービス (ユーザー別・DB 永続化)
 */
export class IndicatorProfileService {
  /** 全プロファイルを取得 (作成日時降順) */
  async getAllProfiles(userId: string): Promise<IndicatorProfile[]> {
    const rows = await prisma.indicatorProfile.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDomain);
  }

  /** プロファイルを ID で取得 (予約IDは null、他ユーザーのものも null) */
  async getProfileById(id: string, userId: string): Promise<IndicatorProfile | null> {
    if (isReservedProfileId(id)) return null;
    const row = await prisma.indicatorProfile.findFirst({ where: { id, userId } });
    return row ? toDomain(row) : null;
  }

  /** デフォルトプロファイルを取得 */
  async getDefaultProfile(userId: string): Promise<IndicatorProfile | null> {
    const row = await prisma.indicatorProfile.findFirst({ where: { userId, isDefault: true } });
    return row ? toDomain(row) : null;
  }

  /** プロファイルを作成 */
  async createProfile(userId: string, request: CreateProfileRequest): Promise<IndicatorProfile> {
    const isDefault = request.isDefault ?? false;
    try {
      const row = await prisma.$transaction(async (tx) => {
        // デフォルト指定時は既存デフォルトを解除
        if (isDefault) {
          await tx.indicatorProfile.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
        }
        return tx.indicatorProfile.create({
          data: {
            userId,
            name: request.name,
            description: request.description ?? null,
            indicators: toIndicatorsJson(request.indicators),
            isDefault,
          },
        });
      });
      return toDomain(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new Error(`同じ名前のプロファイルが既に存在します: ${request.name}`, { cause: error });
      }
      throw error;
    }
  }

  /** プロファイルを更新 */
  async updateProfile(id: string, userId: string, request: UpdateProfileRequest): Promise<IndicatorProfile> {
    if (isReservedProfileId(id)) {
      throw new Error('特殊プロファイルは更新できません');
    }
    const existing = await prisma.indicatorProfile.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new Error(`プロファイルが見つかりません: ${id}`);
    }

    const data: Prisma.IndicatorProfileUpdateInput = {};
    if (request.name !== undefined) data.name = request.name;
    if (request.description !== undefined) data.description = request.description;
    if (request.indicators !== undefined) data.indicators = toIndicatorsJson(request.indicators);

    try {
      const row = await prisma.$transaction(async (tx) => {
        if (request.isDefault !== undefined) {
          if (request.isDefault) {
            await tx.indicatorProfile.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
          }
          data.isDefault = request.isDefault;
        }
        return tx.indicatorProfile.update({ where: { id }, data });
      });
      return toDomain(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new Error(`同じ名前のプロファイルが既に存在します: ${request.name ?? ''}`, { cause: error });
      }
      throw error;
    }
  }

  /** プロファイルを削除 */
  async deleteProfile(id: string, userId: string): Promise<void> {
    if (isReservedProfileId(id)) {
      throw new Error('特殊プロファイルは削除できません');
    }
    const result = await prisma.indicatorProfile.deleteMany({ where: { id, userId } });
    if (result.count === 0) {
      throw new Error(`プロファイルが見つかりません: ${id}`);
    }
  }

  /** プロファイル選択オプション (予約オプション含む) を取得 */
  async getProfileOptions(userId: string): Promise<ProfileOption[]> {
    const profiles = await this.getAllProfiles(userId);
    return buildProfileOptions(profiles);
  }

  /** デフォルトプロファイルID (未設定時は AI_AUTO) を取得 */
  async getDefaultProfileId(userId: string): Promise<string> {
    const defaultProfile = await this.getDefaultProfile(userId);
    return defaultProfile?.id ?? RESERVED_PROFILE_IDS.AI_AUTO;
  }
}

// シングルトンインスタンス
let profileServiceInstance: IndicatorProfileService | null = null;

/** プロファイルサービスのシングルトンを取得 */
export function getIndicatorProfileService(): IndicatorProfileService {
  if (!profileServiceInstance) {
    profileServiceInstance = new IndicatorProfileService();
  }
  return profileServiceInstance;
}
