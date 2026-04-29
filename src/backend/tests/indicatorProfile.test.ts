/**
 * インジケータープロファイルサービス テスト
 * 
 * 目的: プロファイルのCRUD操作と特殊プロファイル処理をテスト
 */

import * as fs from 'fs';
import * as path from 'path';
import { IndicatorProfileService } from '../../services/indicatorProfileService';
import { 
  RESERVED_PROFILE_IDS, 
  isReservedProfileId,
  buildProfileOptions,
  createNoteProfileConfig,
  type IndicatorProfile,
} from '../../models/indicatorProfile';
import type { IndicatorConfig } from '../../models/indicatorConfig';

// テスト用ファイルパス
const TEST_PROFILES_FILE = path.join(process.cwd(), 'data', 'indicator-profiles.json');

describe('indicatorProfile モデル', () => {
  describe('isReservedProfileId', () => {
    it('AI_AUTO は予約ID', () => {
      expect(isReservedProfileId(RESERVED_PROFILE_IDS.AI_AUTO)).toBe(true);
    });

    it('NONE は予約ID', () => {
      expect(isReservedProfileId(RESERVED_PROFILE_IDS.NONE)).toBe(true);
    });

    it('通常のUUIDは予約IDではない', () => {
      expect(isReservedProfileId('123e4567-e89b-12d3-a456-426614174000')).toBe(false);
    });
  });

  describe('buildProfileOptions', () => {
    it('特殊オプションが先頭に含まれる', () => {
      const profiles: IndicatorProfile[] = [];
      const options = buildProfileOptions(profiles);
      
      expect(options.length).toBe(2);
      expect(options[0].id).toBe(RESERVED_PROFILE_IDS.AI_AUTO);
      expect(options[0].isSpecial).toBe(true);
      expect(options[1].id).toBe(RESERVED_PROFILE_IDS.NONE);
      expect(options[1].isSpecial).toBe(true);
    });

    it('ユーザープロファイルが追加される', () => {
      const profiles: IndicatorProfile[] = [
        {
          id: 'test-profile-1',
          name: 'テストプロファイル',
          indicators: [],
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const options = buildProfileOptions(profiles);
      
      expect(options.length).toBe(3);
      expect(options[2].id).toBe('test-profile-1');
      expect(options[2].label).toBe('テストプロファイル');
      expect(options[2].isSpecial).toBe(false);
      expect(options[2].icon).toBe('📁');
    });
  });

  describe('createNoteProfileConfig', () => {
    it('AI_AUTO の場合、空のインジケーターで作成', () => {
      const config = createNoteProfileConfig(null, RESERVED_PROFILE_IDS.AI_AUTO);
      
      expect(config.profileId).toBe(RESERVED_PROFILE_IDS.AI_AUTO);
      expect(config.profileName).toBe('AIに任せる');
      expect(config.indicators).toEqual([]);
      expect(config.threshold).toBe(0.75);
    });

    it('NONE の場合、閾値0で作成', () => {
      const config = createNoteProfileConfig(null, RESERVED_PROFILE_IDS.NONE);
      
      expect(config.profileId).toBe(RESERVED_PROFILE_IDS.NONE);
      expect(config.profileName).toBe('プロファイルなし');
      expect(config.threshold).toBe(0);
    });

    it('ユーザープロファイルの場合、設定をコピー', () => {
      const indicators: IndicatorConfig[] = [
        { configId: 'rsi-14', indicatorId: 'rsi', label: 'RSI(14)', params: { period: 14 }, enabled: true },
      ];
      const profile: IndicatorProfile = {
        id: 'test-profile',
        name: 'テスト',
        indicators,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      const config = createNoteProfileConfig(profile, 'test-profile', 0.8);
      
      expect(config.profileId).toBe('test-profile');
      expect(config.profileName).toBe('テスト');
      expect(config.indicators).toHaveLength(1);
      expect(config.threshold).toBe(0.8);
    });

    it('プロファイルがnullでUUIDの場合はエラー', () => {
      expect(() => {
        createNoteProfileConfig(null, 'some-uuid');
      }).toThrow('プロファイルが見つかりません');
    });
  });
});

describe('IndicatorProfileService', () => {
  let service: IndicatorProfileService;
  let originalFileContent: string | null = null;

  beforeAll(() => {
    // 既存ファイルのバックアップ
    if (fs.existsSync(TEST_PROFILES_FILE)) {
      originalFileContent = fs.readFileSync(TEST_PROFILES_FILE, 'utf-8');
    }
  });

  afterAll(() => {
    // ファイルを元に戻す
    if (originalFileContent) {
      fs.writeFileSync(TEST_PROFILES_FILE, originalFileContent, 'utf-8');
    } else if (fs.existsSync(TEST_PROFILES_FILE)) {
      fs.unlinkSync(TEST_PROFILES_FILE);
    }
  });

  beforeEach(() => {
    service = new IndicatorProfileService();
    // テスト前にファイルをクリア
    if (fs.existsSync(TEST_PROFILES_FILE)) {
      fs.unlinkSync(TEST_PROFILES_FILE);
    }
  });

  describe('createProfile', () => {
    it('プロファイルを作成できる', () => {
      const profile = service.createProfile({
        name: 'テストプロファイル',
        description: 'テスト用',
        indicators: [
          { configId: 'rsi-14', indicatorId: 'rsi', label: 'RSI(14)', params: { period: 14 }, enabled: true },
        ],
      });

      expect(profile.id).toBeDefined();
      expect(profile.name).toBe('テストプロファイル');
      expect(profile.description).toBe('テスト用');
      expect(profile.indicators).toHaveLength(1);
      expect(profile.isDefault).toBe(false);
    });

    it('同じ名前のプロファイルは作成できない', () => {
      service.createProfile({
        name: '重複テスト',
        indicators: [],
      });

      expect(() =>
        service.createProfile({
          name: '重複テスト',
          indicators: [],
        }),
      ).toThrow('同じ名前のプロファイルが既に存在します');
    });

    it('デフォルトプロファイルを設定できる', () => {
      const profile1 = service.createProfile({
        name: 'プロファイル1',
        indicators: [],
        isDefault: true,
      });

      expect(profile1.isDefault).toBe(true);

      // 2つ目をデフォルトにすると1つ目は解除される
      service.createProfile({
        name: 'プロファイル2',
        indicators: [],
        isDefault: true,
      });

      const profiles = service.getAllProfiles();
      const defaultProfiles = profiles.filter(p => p.isDefault);
      expect(defaultProfiles).toHaveLength(1);
      expect(defaultProfiles[0].name).toBe('プロファイル2');
    });
  });

  describe('getProfileById', () => {
    it('存在するプロファイルを取得できる', () => {
      const created = service.createProfile({
        name: '取得テスト',
        indicators: [],
      });

      const found = service.getProfileById(created.id);
      expect(found).not.toBeNull();
      expect(found?.name).toBe('取得テスト');
    });

    it('存在しないIDはnullを返す', () => {
      const found = service.getProfileById('non-existent-id');
      expect(found).toBeNull();
    });

    it('予約IDはnullを返す', () => {
      const found = service.getProfileById(RESERVED_PROFILE_IDS.AI_AUTO);
      expect(found).toBeNull();
    });
  });

  describe('updateProfile', () => {
    it('プロファイルを更新できる', () => {
      const created = service.createProfile({
        name: '更新前',
        indicators: [],
      });

      const updated = service.updateProfile(created.id, {
        name: '更新後',
        description: '更新しました',
      });

      expect(updated.name).toBe('更新後');
      expect(updated.description).toBe('更新しました');
    });

    it('予約IDは更新できない', () => {
      expect(() =>
        service.updateProfile(RESERVED_PROFILE_IDS.AI_AUTO, {
          name: '変更',
        }),
      ).toThrow('特殊プロファイルは更新できません');
    });
  });

  describe('deleteProfile', () => {
    it('プロファイルを削除できる', () => {
      const created = service.createProfile({
        name: '削除テスト',
        indicators: [],
      });

      service.deleteProfile(created.id);

      const found = service.getProfileById(created.id);
      expect(found).toBeNull();
    });

    it('予約IDは削除できない', () => {
      expect(() => service.deleteProfile(RESERVED_PROFILE_IDS.AI_AUTO)).toThrow(
        '特殊プロファイルは削除できません',
      );
    });
  });

  describe('getProfileOptions', () => {
    it('特殊オプションとユーザープロファイルを返す', () => {
      service.createProfile({
        name: 'ユーザープロファイル',
        indicators: [],
      });

      const options = service.getProfileOptions();
      
      expect(options.length).toBe(3);
      expect(options[0].id).toBe(RESERVED_PROFILE_IDS.AI_AUTO);
      expect(options[1].id).toBe(RESERVED_PROFILE_IDS.NONE);
      expect(options[2].label).toBe('ユーザープロファイル');
    });
  });

  describe('getDefaultProfileId', () => {
    it('デフォルトが設定されていない場合はAI_AUTOを返す', () => {
      const defaultId = service.getDefaultProfileId();
      expect(defaultId).toBe(RESERVED_PROFILE_IDS.AI_AUTO);
    });

    it('デフォルトプロファイルがあればそのIDを返す', () => {
      const profile = service.createProfile({
        name: 'デフォルト',
        indicators: [],
        isDefault: true,
      });

      const defaultId = service.getDefaultProfileId();
      expect(defaultId).toBe(profile.id);
    });
  });
});
