/**
 * インジケータープロファイルサービス
 * 
 * 目的:
 * - 複数のインジケータープロファイルをファイルベースで永続化
 * - プロファイルの作成・取得・更新・削除を提供
 * - CSVインポート時のプロファイル選択をサポート
 * 
 * ストレージ:
 * - data/indicator-profiles.json にJSON形式で保存
 * - MVPでは単一ユーザー前提
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { IndicatorConfig, IndicatorId } from '../models/indicatorConfig';
import { INDICATOR_METADATA } from '../models/indicatorConfig';
import type {
  IndicatorProfile,
  CreateProfileRequest,
  UpdateProfileRequest,
  ProfileStorage,
  ProfileOption} from '../models/indicatorProfile';
import {
  createDefaultProfileStorage,
  buildProfileOptions,
  RESERVED_PROFILE_IDS,
  isReservedProfileId,
} from '../models/indicatorProfile';

// 設定ファイルのパス
const PROFILES_FILE = path.join(process.cwd(), 'data', 'indicator-profiles.json');

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

const IndicatorProfileJsonSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  indicators: z.array(IndicatorConfigJsonSchema),
  isDefault: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const ProfileStorageJsonSchema = z.object({
  profiles: z.array(IndicatorProfileJsonSchema),
  version: z.number(),
  updatedAt: z.string().min(1),
});

/** 保存失敗時に元エラーを cause へ載せる（ES2020 未満のためプロパティで付与） */
function saveErrorWithCause(message: string, error: Error): Error {
  const e = new Error(message);
  (e as Error & { cause?: Error }).cause = error;
  return e;
}

/**
 * インジケータープロファイルサービスクラス
 */
export class IndicatorProfileService {
  /**
   * ストレージを読み込む
   */
  loadStorage(): ProfileStorage {
    try {
      if (!fs.existsSync(PROFILES_FILE)) {
        return createDefaultProfileStorage();
      }

      const content = fs.readFileSync(PROFILES_FILE, 'utf-8');
      const parsed = ProfileStorageJsonSchema.safeParse(JSON.parse(content));
      if (!parsed.success) {
        console.error('プロファイル設定の形式エラー:', parsed.error.format());
        return createDefaultProfileStorage();
      }

      return {
        profiles: parsed.data.profiles.map(
          (p): IndicatorProfile => ({
            ...p,
            createdAt: new Date(p.createdAt),
            updatedAt: new Date(p.updatedAt),
            indicators: p.indicators.map(
              (ind): IndicatorConfig => ({
                ...ind,
                params: ind.params,
              }),
            ),
          }),
        ),
        version: parsed.data.version,
        updatedAt: new Date(parsed.data.updatedAt),
      };
    } catch (error) {
      console.error('プロファイル設定の読み込みエラー:', error);
      return createDefaultProfileStorage();
    }
  }

  /**
   * ストレージを保存
   */
  saveStorage(storage: ProfileStorage): void {
    try {
      const dataDir = path.dirname(PROFILES_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      storage.updatedAt = new Date();
      fs.writeFileSync(PROFILES_FILE, JSON.stringify(storage, null, 2), 'utf-8');
    } catch (error) {
      console.error('プロファイル設定の保存エラー:', error);
      const cause = error instanceof Error ? error : new Error(String(error));
      throw saveErrorWithCause('プロファイル設定の保存に失敗しました', cause);
    }
  }

  /**
   * 全プロファイルを取得
   */
  getAllProfiles(): IndicatorProfile[] {
    const storage = this.loadStorage();
    return storage.profiles;
  }

  /**
   * プロファイルをIDで取得
   */
  getProfileById(id: string): IndicatorProfile | null {
    // 予約IDの場合はnullを返す（特殊処理は呼び出し側で）
    if (isReservedProfileId(id)) {
      return null;
    }

    const storage = this.loadStorage();
    return storage.profiles.find(p => p.id === id) || null;
  }

  /**
   * デフォルトプロファイルを取得
   */
  getDefaultProfile(): IndicatorProfile | null {
    const storage = this.loadStorage();
    return storage.profiles.find(p => p.isDefault) || null;
  }

  /**
   * プロファイルを作成
   */
  createProfile(request: CreateProfileRequest): IndicatorProfile {
    const storage = this.loadStorage();

    // 名前の重複チェック
    if (storage.profiles.some(p => p.name === request.name)) {
      throw new Error(`同じ名前のプロファイルが既に存在します: ${request.name}`);
    }

    const newProfile: IndicatorProfile = {
      id: uuidv4(),
      name: request.name,
      description: request.description,
      indicators: request.indicators,
      isDefault: request.isDefault ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // デフォルト設定時は他のデフォルトを解除
    if (newProfile.isDefault) {
      storage.profiles.forEach(p => p.isDefault = false);
    }

    storage.profiles.push(newProfile);
    this.saveStorage(storage);

    return newProfile;
  }

  /**
   * プロファイルを更新
   */
  updateProfile(id: string, request: UpdateProfileRequest): IndicatorProfile {
    // 予約IDは更新不可
    if (isReservedProfileId(id)) {
      throw new Error('特殊プロファイルは更新できません');
    }

    const storage = this.loadStorage();
    const index = storage.profiles.findIndex(p => p.id === id);

    if (index === -1) {
      throw new Error(`プロファイルが見つかりません: ${id}`);
    }

    // 名前の重複チェック（自分以外）
    if (request.name && storage.profiles.some(p => p.id !== id && p.name === request.name)) {
      throw new Error(`同じ名前のプロファイルが既に存在します: ${request.name}`);
    }

    const profile = storage.profiles[index];

    // 更新
    if (request.name !== undefined) profile.name = request.name;
    if (request.description !== undefined) profile.description = request.description;
    if (request.indicators !== undefined) profile.indicators = request.indicators;
    if (request.isDefault !== undefined) {
      // デフォルト設定時は他のデフォルトを解除
      if (request.isDefault) {
        storage.profiles.forEach(p => p.isDefault = false);
      }
      profile.isDefault = request.isDefault;
    }
    profile.updatedAt = new Date();

    this.saveStorage(storage);
    return profile;
  }

  /**
   * プロファイルを削除
   */
  deleteProfile(id: string): void {
    // 予約IDは削除不可
    if (isReservedProfileId(id)) {
      throw new Error('特殊プロファイルは削除できません');
    }

    const storage = this.loadStorage();
    const index = storage.profiles.findIndex(p => p.id === id);

    if (index === -1) {
      throw new Error(`プロファイルが見つかりません: ${id}`);
    }

    storage.profiles.splice(index, 1);
    this.saveStorage(storage);
  }

  /**
   * プロファイル選択オプションを取得（UI用）
   *
   * 特殊オプション（AIに任せる、プロファイルなし）を含む
   */
  getProfileOptions(): ProfileOption[] {
    const profiles = this.getAllProfiles();
    return buildProfileOptions(profiles);
  }

  /**
   * デフォルトプロファイルIDを取得
   *
   * デフォルトが設定されていない場合は AI_AUTO を返す
   */
  getDefaultProfileId(): string {
    const defaultProfile = this.getDefaultProfile();
    return defaultProfile?.id || RESERVED_PROFILE_IDS.AI_AUTO;
  }
}

// シングルトンインスタンス
let profileServiceInstance: IndicatorProfileService | null = null;

/**
 * プロファイルサービスのシングルトンを取得
 */
export function getIndicatorProfileService(): IndicatorProfileService {
  if (!profileServiceInstance) {
    profileServiceInstance = new IndicatorProfileService();
  }
  return profileServiceInstance;
}
