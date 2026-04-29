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
import { v4 as uuidv4 } from 'uuid';
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

/**
 * インジケータープロファイルサービスクラス
 */
export class IndicatorProfileService {
  /**
   * ストレージを読み込む
   */
  async loadStorage(): Promise<ProfileStorage> {
    try {
      if (!fs.existsSync(PROFILES_FILE)) {
        return createDefaultProfileStorage();
      }

      const content = fs.readFileSync(PROFILES_FILE, 'utf-8');
      const data = JSON.parse(content);

      // 日付の復元
      return {
        profiles: data.profiles.map((p: IndicatorProfile) => ({
          ...p,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        })),
        version: data.version,
        updatedAt: new Date(data.updatedAt),
      };
    } catch (error) {
      console.error('プロファイル設定の読み込みエラー:', error);
      return createDefaultProfileStorage();
    }
  }

  /**
   * ストレージを保存
   */
  async saveStorage(storage: ProfileStorage): Promise<void> {
    try {
      const dataDir = path.dirname(PROFILES_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      storage.updatedAt = new Date();
      fs.writeFileSync(PROFILES_FILE, JSON.stringify(storage, null, 2), 'utf-8');
    } catch (error) {
      console.error('プロファイル設定の保存エラー:', error);
      throw new Error('プロファイル設定の保存に失敗しました');
    }
  }

  /**
   * 全プロファイルを取得
   */
  async getAllProfiles(): Promise<IndicatorProfile[]> {
    const storage = await this.loadStorage();
    return storage.profiles;
  }

  /**
   * プロファイルをIDで取得
   */
  async getProfileById(id: string): Promise<IndicatorProfile | null> {
    // 予約IDの場合はnullを返す（特殊処理は呼び出し側で）
    if (isReservedProfileId(id)) {
      return null;
    }

    const storage = await this.loadStorage();
    return storage.profiles.find(p => p.id === id) || null;
  }

  /**
   * デフォルトプロファイルを取得
   */
  async getDefaultProfile(): Promise<IndicatorProfile | null> {
    const storage = await this.loadStorage();
    return storage.profiles.find(p => p.isDefault) || null;
  }

  /**
   * プロファイルを作成
   */
  async createProfile(request: CreateProfileRequest): Promise<IndicatorProfile> {
    const storage = await this.loadStorage();

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
    await this.saveStorage(storage);

    return newProfile;
  }

  /**
   * プロファイルを更新
   */
  async updateProfile(id: string, request: UpdateProfileRequest): Promise<IndicatorProfile> {
    // 予約IDは更新不可
    if (isReservedProfileId(id)) {
      throw new Error('特殊プロファイルは更新できません');
    }

    const storage = await this.loadStorage();
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

    await this.saveStorage(storage);
    return profile;
  }

  /**
   * プロファイルを削除
   */
  async deleteProfile(id: string): Promise<void> {
    // 予約IDは削除不可
    if (isReservedProfileId(id)) {
      throw new Error('特殊プロファイルは削除できません');
    }

    const storage = await this.loadStorage();
    const index = storage.profiles.findIndex(p => p.id === id);

    if (index === -1) {
      throw new Error(`プロファイルが見つかりません: ${id}`);
    }

    storage.profiles.splice(index, 1);
    await this.saveStorage(storage);
  }

  /**
   * プロファイル選択オプションを取得（UI用）
   * 
   * 特殊オプション（AIに任せる、プロファイルなし）を含む
   */
  async getProfileOptions(): Promise<ProfileOption[]> {
    const profiles = await this.getAllProfiles();
    return buildProfileOptions(profiles);
  }

  /**
   * デフォルトプロファイルIDを取得
   * 
   * デフォルトが設定されていない場合は AI_AUTO を返す
   */
  async getDefaultProfileId(): Promise<string> {
    const defaultProfile = await this.getDefaultProfile();
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
