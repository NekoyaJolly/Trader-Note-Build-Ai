/**
 * インジケータープロファイル テスト
 *
 * - モデル関数 (isReservedProfileId / buildProfileOptions / createNoteProfileConfig)
 * - IndicatorProfileService の DB(per-user) CRUD を Prisma mock で検証
 */

const mockFindMany = jest.fn();
const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();
const mockDeleteMany = jest.fn();

jest.mock('../db/client', () => ({
  prisma: {
    indicatorProfile: {
      findMany: mockFindMany,
      findFirst: mockFindFirst,
      create: mockCreate,
      update: mockUpdate,
      updateMany: mockUpdateMany,
      deleteMany: mockDeleteMany,
    },
    // $transaction は tx に同じ indicatorProfile mock を渡して即実行する
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ indicatorProfile: { create: mockCreate, update: mockUpdate, updateMany: mockUpdateMany } }),
  },
}));

import { Prisma } from '@prisma/client';
import { IndicatorProfileService } from '../../services/indicatorProfileService';
import {
  RESERVED_PROFILE_IDS,
  isReservedProfileId,
  buildProfileOptions,
  createNoteProfileConfig,
  type IndicatorProfile,
} from '../../models/indicatorProfile';

const USER = '00000000-0000-0000-0000-000000000009';

/** Prisma 行を模す */
function dbRow(over: Partial<{ id: string; name: string; description: string | null; indicators: unknown; isDefault: boolean }> = {}) {
  return {
    id: over.id ?? 'profile-1',
    userId: USER,
    name: over.name ?? 'テスト',
    description: over.description ?? null,
    indicators: over.indicators ?? [
      { configId: 'rsi-14', indicatorId: 'rsi', label: 'RSI(14)', params: { period: 14 }, enabled: true },
    ],
    isDefault: over.isDefault ?? false,
    createdAt: new Date('2026-06-04T00:00:00.000Z'),
    updatedAt: new Date('2026-06-04T00:00:00.000Z'),
  };
}

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
      const options = buildProfileOptions([]);
      expect(options.length).toBe(2);
      expect(options[0].id).toBe(RESERVED_PROFILE_IDS.AI_AUTO);
      expect(options[0].isSpecial).toBe(true);
      expect(options[1].id).toBe(RESERVED_PROFILE_IDS.NONE);
      expect(options[1].isSpecial).toBe(true);
    });

    it('ユーザープロファイルが追加される', () => {
      const profiles: IndicatorProfile[] = [
        { id: 'test-profile-1', name: 'テストプロファイル', indicators: [], isDefault: false, createdAt: new Date(), updatedAt: new Date() },
      ];
      const options = buildProfileOptions(profiles);
      expect(options.length).toBe(3);
      expect(options[2].id).toBe('test-profile-1');
      expect(options[2].label).toBe('テストプロファイル');
      expect(options[2].isSpecial).toBe(false);
    });
  });

  describe('createNoteProfileConfig', () => {
    it('AI_AUTO の場合、空のインジケーターで作成', () => {
      const config = createNoteProfileConfig(null, RESERVED_PROFILE_IDS.AI_AUTO);
      expect(config.profileId).toBe(RESERVED_PROFILE_IDS.AI_AUTO);
      expect(config.indicators).toEqual([]);
      expect(config.threshold).toBe(0.75);
    });

    it('NONE の場合、閾値0で作成', () => {
      const config = createNoteProfileConfig(null, RESERVED_PROFILE_IDS.NONE);
      expect(config.profileId).toBe(RESERVED_PROFILE_IDS.NONE);
      expect(config.threshold).toBe(0);
    });

    it('プロファイルがnullでUUIDの場合はエラー', () => {
      expect(() => createNoteProfileConfig(null, 'some-uuid')).toThrow('プロファイルが見つかりません');
    });
  });
});

describe('IndicatorProfileService (DB per-user)', () => {
  let service: IndicatorProfileService;

  beforeEach(() => {
    [mockFindMany, mockFindFirst, mockCreate, mockUpdate, mockUpdateMany, mockDeleteMany].forEach((m) => m.mockReset());
    service = new IndicatorProfileService();
  });

  describe('createProfile', () => {
    it('作成して indicators をパースしたドメイン型を返す', async () => {
      mockCreate.mockResolvedValue(dbRow({ id: 'p1', name: '新規' }));
      const profile = await service.createProfile(USER, { name: '新規', indicators: [] });
      expect(profile.id).toBe('p1');
      expect(profile.name).toBe('新規');
      expect(profile.indicators).toHaveLength(1);
      // 非デフォルト時は既存解除しない
      expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it('デフォルト作成時は既存デフォルトを解除する', async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });
      mockCreate.mockResolvedValue(dbRow({ isDefault: true }));
      await service.createProfile(USER, { name: 'デフォルト', indicators: [], isDefault: true });
      expect(mockUpdateMany).toHaveBeenCalledWith({ where: { userId: USER, isDefault: true }, data: { isDefault: false } });
    });

    it('string param (pivotType 等) を欠落させずに保存する (PR #338)', async () => {
      mockCreate.mockResolvedValue(dbRow());
      await service.createProfile(USER, {
        name: 'pivot',
        indicators: [
          { configId: 'piv', indicatorId: 'rsi', label: 'x', params: { pivotType: 'fibonacci', period: 14 }, enabled: true },
        ],
      });
      const createArg = mockCreate.mock.calls[0][0];
      expect(createArg.data.indicators[0].params).toEqual({ pivotType: 'fibonacci', period: 14 });
    });

    it('一意制約違反(P2002)は重複名エラーに変換する', async () => {
      mockCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6.0.0' }));
      await expect(service.createProfile(USER, { name: '重複', indicators: [] })).rejects.toThrow(
        '同じ名前のプロファイルが既に存在します',
      );
    });
  });

  describe('getProfileById', () => {
    it('予約IDは DB を見ずに null', async () => {
      const found = await service.getProfileById(RESERVED_PROFILE_IDS.AI_AUTO, USER);
      expect(found).toBeNull();
      expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it('自ユーザーの行はドメイン型で返す', async () => {
      mockFindFirst.mockResolvedValue(dbRow({ id: 'p9', name: '取得' }));
      const found = await service.getProfileById('p9', USER);
      expect(found?.name).toBe('取得');
      expect(mockFindFirst).toHaveBeenCalledWith({ where: { id: 'p9', userId: USER } });
    });

    it('存在しない(他ユーザー含む)場合は null', async () => {
      mockFindFirst.mockResolvedValue(null);
      expect(await service.getProfileById('none', USER)).toBeNull();
    });
  });

  describe('updateProfile / deleteProfile', () => {
    it('予約IDは更新できない', async () => {
      await expect(service.updateProfile(RESERVED_PROFILE_IDS.AI_AUTO, USER, { name: 'x' })).rejects.toThrow(
        '特殊プロファイルは更新できません',
      );
    });

    it('存在しないIDの更新はエラー', async () => {
      mockFindFirst.mockResolvedValue(null);
      await expect(service.updateProfile('missing', USER, { name: 'x' })).rejects.toThrow('プロファイルが見つかりません');
    });

    it('削除は (id,userId) で deleteMany、0件ならエラー', async () => {
      mockDeleteMany.mockResolvedValue({ count: 0 });
      await expect(service.deleteProfile('missing', USER)).rejects.toThrow('プロファイルが見つかりません');
      expect(mockDeleteMany).toHaveBeenCalledWith({ where: { id: 'missing', userId: USER } });
    });
  });

  describe('getDefaultProfileId', () => {
    it('デフォルト未設定なら AI_AUTO', async () => {
      mockFindFirst.mockResolvedValue(null);
      expect(await service.getDefaultProfileId(USER)).toBe(RESERVED_PROFILE_IDS.AI_AUTO);
    });

    it('デフォルトがあればその id', async () => {
      mockFindFirst.mockResolvedValue(dbRow({ id: 'def', isDefault: true }));
      expect(await service.getDefaultProfileId(USER)).toBe('def');
    });
  });
});
