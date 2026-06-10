/**
 * ストラテジーサービスのテスト
 * 
 * 目的:
 * - ストラテジー CRUD 操作の検証
 * - バージョン管理の検証
 * - 入力バリデーションの検証
 */

import type { StrategyStatus, StrategyDirection } from '@prisma/client';
import type {
  CreateStrategyInput,
  UpdateStrategyInput} from '../services/strategyService';

// strategyService は canonical Prisma singleton を読むため、同じ import 先を差し替える。
const mockPrisma = {
  strategy: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    // Phase α-4: ユーザー分離で取得系は findFirst (id + userId 条件) に変更
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  strategyVersion: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  },
  $transaction: jest.fn(),
  $disconnect: jest.fn(),
};

jest.mock('../db/client', () => ({
  prisma: mockPrisma,
}));

import {
  listStrategies,
  getStrategy,
  getStrategyVersion,
  createStrategy,
  updateStrategy,
  deleteStrategy,
  updateStrategyStatus,
  duplicateStrategy
} from '../services/strategyService';

// UUIDをモック
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

describe('strategyService', () => {
  // テスト用データ
  const mockStrategy = {
    id: 'test-strategy-id',
    name: 'テスト戦略',
    description: 'RSI逆張り戦略',
    symbol: 'USDJPY',
    side: 'buy' as StrategyDirection,
    status: 'draft' as StrategyStatus,
    currentVersionId: 'version-1',
    tags: ['逆張り', 'RSI'],
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  };

  const mockVersion = {
    id: 'version-1',
    strategyId: 'test-strategy-id',
    versionNumber: 1,
    entryConditions: {
      groupId: 'group-1',
      operator: 'AND',
      conditions: [
        {
          conditionId: 'cond-1',
          indicatorId: 'rsi',
          params: { period: 14 },
          field: 'value',
          operator: '<',
          compareTarget: { type: 'fixed', value: 30 },
        },
      ],
    },
    exitSettings: {
      takeProfit: { value: 1.0, unit: 'percent' },
      stopLoss: { value: 0.5, unit: 'percent' },
    },
    entryTiming: 'next_open',
    changeNote: '初期バージョン',
    createdAt: new Date('2025-01-01T00:00:00Z'),
  };

  const validCreateInput: CreateStrategyInput = {
    name: 'テスト戦略',
    description: 'RSI逆張り戦略',
    symbol: 'USDJPY',
    timeframe: '1h',
    side: 'buy',
    entryConditions: mockVersion.entryConditions,
    exitSettings: mockVersion.exitSettings,
    tags: ['逆張り', 'RSI'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listStrategies', () => {
    it('ストラテジー一覧を取得できること', async () => {
      // モックの設定
      const prisma = mockPrisma;
      (prisma.strategy.findMany as jest.Mock).mockResolvedValue([
        { ...mockStrategy, _count: { versions: 2 } },
      ]);

      const result = await listStrategies();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockStrategy.id);
      expect(result[0].name).toBe(mockStrategy.name);
      expect(result[0].versionCount).toBe(2);
    });

    it('ステータスでフィルタリングできること', async () => {
      const prisma = mockPrisma;
      (prisma.strategy.findMany as jest.Mock).mockResolvedValue([]);

      await listStrategies({ status: 'active' });

      expect(prisma.strategy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'active' },
        })
      );
    });

    it('シンボルでフィルタリングできること', async () => {
      const prisma = mockPrisma;
      (prisma.strategy.findMany as jest.Mock).mockResolvedValue([]);

      await listStrategies({ symbol: 'USDJPY' });

      expect(prisma.strategy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { symbol: 'USDJPY' },
        })
      );
    });

    // Phase α-4: マルチユーザー分離
    it('userId 指定時は所有ユーザーで絞り込まれること (Phase α-4)', async () => {
      const prisma = mockPrisma;
      (prisma.strategy.findMany as jest.Mock).mockResolvedValue([]);

      await listStrategies({ userId: 'user-a-uuid' });

      expect(prisma.strategy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-a-uuid' },
        })
      );
    });

    it('userId 未指定時は userId フィルタが付かないこと (cron 等の後方互換)', async () => {
      const prisma = mockPrisma;
      (prisma.strategy.findMany as jest.Mock).mockResolvedValue([]);

      await listStrategies({});

      expect(prisma.strategy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        })
      );
    });
  });

  describe('getStrategy', () => {
    it('ストラテジー詳細を取得できること', async () => {
      const prisma = mockPrisma;
      (prisma.strategy.findFirst as jest.Mock).mockResolvedValue({
        ...mockStrategy,
        versions: [mockVersion],
      });

      const result = await getStrategy(mockStrategy.id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(mockStrategy.id);
      expect(result?.currentVersion).not.toBeNull();
      expect(result?.currentVersion?.versionNumber).toBe(1);
    });

    it('存在しないストラテジーの場合はnullを返すこと', async () => {
      const prisma = mockPrisma;
      (prisma.strategy.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await getStrategy('non-existent-id');

      expect(result).toBeNull();
    });

    // Phase α-4: マルチユーザー分離
    it('userId 指定時は id + userId の複合条件で取得すること (Phase α-4)', async () => {
      const prisma = mockPrisma;
      (prisma.strategy.findFirst as jest.Mock).mockResolvedValue(null);

      // 他ユーザーのストラテジーは findFirst が null を返し「存在しない」扱いになる
      const result = await getStrategy(mockStrategy.id, 'user-a-uuid');

      expect(result).toBeNull();
      expect(prisma.strategy.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockStrategy.id, userId: 'user-a-uuid' },
        })
      );
    });
  });

  describe('getStrategyVersion', () => {
    it('特定バージョンを取得できること', async () => {
      const prisma = mockPrisma;
      (prisma.strategyVersion.findFirst as jest.Mock).mockResolvedValue(mockVersion);

      const result = await getStrategyVersion(mockStrategy.id, 1);

      expect(result).not.toBeNull();
      expect(result?.versionNumber).toBe(1);
      expect(result?.entryConditions).toEqual(mockVersion.entryConditions);
    });

    it('存在しないバージョンの場合はnullを返すこと', async () => {
      const prisma = mockPrisma;
      (prisma.strategyVersion.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await getStrategyVersion(mockStrategy.id, 999);

      expect(result).toBeNull();
    });
  });

  describe('createStrategy', () => {
    it('ストラテジーを作成できること', async () => {
      const prisma = mockPrisma;
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          strategy: {
            create: jest.fn().mockResolvedValue(mockStrategy),
            update: jest.fn().mockResolvedValue(mockStrategy),
          },
          strategyVersion: {
            create: jest.fn().mockResolvedValue(mockVersion),
          },
        });
      });
      (prisma.strategy.findFirst as jest.Mock).mockResolvedValue({
        ...mockStrategy,
        versions: [mockVersion],
      });

      const result = await createStrategy(validCreateInput);

      expect(result).not.toBeNull();
      expect(result.name).toBe(validCreateInput.name);
    });

    it('名前が空の場合はエラーになること', async () => {
      const invalidInput = { ...validCreateInput, name: '' };

      await expect(createStrategy(invalidInput)).rejects.toThrow(
        'ストラテジー名は必須です'
      );
    });

    it('対応していないシンボルの場合はエラーになること', async () => {
      const invalidInput = { ...validCreateInput, symbol: 'INVALID' };

      await expect(createStrategy(invalidInput)).rejects.toThrow(
        '対応していないシンボルです'
      );
    });

    it('売買方向が不正な場合はエラーになること', async () => {
      const invalidInput = { ...validCreateInput, side: 'invalid' as StrategyDirection };

        await expect(createStrategy(invalidInput)).rejects.toThrow(
        '売買方向は buy / sell / both を指定してください'
      );
    });

    it('対応していない時間足の場合はエラーになること', async () => {
      const invalidInput = { ...validCreateInput, timeframe: '3h' };

      await expect(createStrategy(invalidInput)).rejects.toThrow(
        '対応していない時間足です'
      );
    });

    it('side=both で売り用条件が無い場合はエラーになること', async () => {
      const invalidInput = { ...validCreateInput, side: 'both' as StrategyDirection };

      await expect(createStrategy(invalidInput)).rejects.toThrow(
        'Buy & Sell では売り用エントリー条件'
      );
    });

    it('side=both で売り用条件があれば作成でき、shortEntryConditions が保存されること', async () => {
      const prisma = mockPrisma;
      const versionCreate = jest.fn().mockResolvedValue(mockVersion);
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          strategy: {
            create: jest.fn().mockResolvedValue(mockStrategy),
            update: jest.fn().mockResolvedValue(mockStrategy),
          },
          strategyVersion: { create: versionCreate },
        });
      });
      (prisma.strategy.findFirst as jest.Mock).mockResolvedValue({
        ...mockStrategy,
        versions: [mockVersion],
      });

      const shortConditions = { groupId: 'g2', operator: 'AND', conditions: [] };
      await createStrategy({
        ...validCreateInput,
        side: 'both',
        shortEntryConditions: shortConditions,
      });

      // 初期バージョン作成時に売り用条件が渡ること（買い=entryConditions と対）
      expect(versionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            side: 'both',
            timeframe: '1h',
            shortEntryConditions: shortConditions,
          }),
        })
      );
    });
  });

  describe('updateStrategy', () => {
    it('ストラテジーを更新すると新バージョンが作成されること', async () => {
      const prisma = mockPrisma;
      const updatedVersion = { ...mockVersion, id: 'version-2', versionNumber: 2 };

      (prisma.strategy.findFirst as jest.Mock)
        .mockResolvedValueOnce({ ...mockStrategy, versions: [mockVersion] })
        .mockResolvedValueOnce({ ...mockStrategy, versions: [updatedVersion, mockVersion] });
      
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          strategy: {
            update: jest.fn().mockResolvedValue({ ...mockStrategy, currentVersionId: 'version-2' }),
          },
          strategyVersion: {
            create: jest.fn().mockResolvedValue(updatedVersion),
          },
        });
      });

      const updateInput: UpdateStrategyInput = {
        entryConditions: mockVersion.entryConditions,
        changeNote: '条件を変更',
      };

      const result = await updateStrategy(mockStrategy.id, updateInput);

      expect(result).not.toBeNull();
    });

    it('存在しないストラテジーの場合はエラーになること', async () => {
      const prisma = mockPrisma;
      (prisma.strategy.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        updateStrategy('non-existent-id', { name: 'updated' })
      ).rejects.toThrow('ストラテジーが見つかりません');
    });
  });

  describe('deleteStrategy', () => {
    it('ストラテジーを削除できること', async () => {
      const prisma = mockPrisma;
      (prisma.strategy.findFirst as jest.Mock).mockResolvedValue(mockStrategy);
      (prisma.strategy.delete as jest.Mock).mockResolvedValue(mockStrategy);

      await deleteStrategy(mockStrategy.id);

      expect(prisma.strategy.delete).toHaveBeenCalledWith({
        where: { id: mockStrategy.id },
      });
    });

    it('存在しないストラテジーの場合はエラーになること', async () => {
      const prisma = mockPrisma;
      (prisma.strategy.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(deleteStrategy('non-existent-id')).rejects.toThrow(
        'ストラテジーが見つかりません'
      );
    });
  });

  describe('updateStrategyStatus', () => {
    it('ステータスを更新できること', async () => {
      const prisma = mockPrisma;
      const updatedStrategy = { ...mockStrategy, status: 'active' as StrategyStatus };
      
      (prisma.strategy.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockStrategy)
        .mockResolvedValueOnce({ ...updatedStrategy, versions: [mockVersion] });
      (prisma.strategy.update as jest.Mock).mockResolvedValue(updatedStrategy);

      const result = await updateStrategyStatus(mockStrategy.id, 'active');

      expect(result).not.toBeNull();
      expect(result.status).toBe('active');
    });
  });

  describe('duplicateStrategy', () => {
    it('ストラテジーを複製できること', async () => {
      const prisma = mockPrisma;
      const duplicatedStrategy = {
        ...mockStrategy,
        id: 'duplicated-id',
        name: 'テスト戦略 (コピー)',
      };
      const duplicatedVersion = { ...mockVersion, id: 'version-dup', strategyId: 'duplicated-id' };

      (prisma.strategy.findFirst as jest.Mock)
        .mockResolvedValueOnce({ ...mockStrategy, versions: [mockVersion] })
        .mockResolvedValueOnce({ ...duplicatedStrategy, versions: [duplicatedVersion] });

      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        return fn({
          strategy: {
            create: jest.fn().mockResolvedValue(duplicatedStrategy),
            update: jest.fn().mockResolvedValue(duplicatedStrategy),
          },
          strategyVersion: {
            create: jest.fn().mockResolvedValue(duplicatedVersion),
          },
        });
      });

      const result = await duplicateStrategy(mockStrategy.id);

      expect(result).not.toBeNull();
      expect(result.name).toContain('コピー');
    });
  });
});
