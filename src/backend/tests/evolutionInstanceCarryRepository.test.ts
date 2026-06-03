/**
 * Filter Evolution Phase B-2: EvolutionInstanceCarryRepository テスト
 *
 * Prisma を jest.mock で差し替え、create / findLatestByRegime / deleteOlderThan の
 * 各経路と Zod schema 検証を純粋に検証する。
 */

const mockCreate = jest.fn();
const mockFindFirst = jest.fn();
const mockDeleteMany = jest.fn();

jest.mock('../db/client', () => ({
  prisma: {
    evolutionInstanceCarry: {
      create: mockCreate,
      findFirst: mockFindFirst,
      deleteMany: mockDeleteMany,
    },
    $disconnect: jest.fn(),
  },
}));

import {
  EvolutionInstanceCarryRepository,
  type EvolutionCarryPayload,
} from '../repositories/evolutionInstanceCarryRepository';

beforeEach(() => {
  mockCreate.mockReset();
  mockFindFirst.mockReset();
  mockDeleteMany.mockReset();
});

// PR #140 review #4 / #5: console.warn を spy しているテストが mockRestore() を
// 呼ばずにファイル内 spy 残留 → 後続テストへ副作用が漏れる懸念があったため、afterEach で
// 一括 restore する。これで各テストの jest.spyOn(console, 'warn') が確実に元へ戻る。
afterEach(() => {
  jest.restoreAllMocks();
});

const validPayload: EvolutionCarryPayload = {
  tradesByDslId: {
    'dsl-1': [
      { entryTime: '2024-06-01T00:00:00.000Z', side: 'long', pnl: 50, outcome: 'win' },
      { entryTime: '2024-06-02T00:00:00.000Z', side: 'long', pnl: -30, outcome: 'loss' },
    ],
  },
  repairHints: {
    'dsl-2': {
      failureReason: 'low_pf',
      severity: 'medium',
      summary: 'PF が 1.0 を下回る',
      actions: [
        { target: 'entry', instruction: 'entry 条件を絞る', allowedChangeScope: 'small' },
      ],
      mutationGuidance: 'parameters を控えめに変異',
      shouldUseForRepairMutation: true,
      shouldExcludeFromParentPool: false,
      warnings: [],
    },
  },
  repairBaselines: {
    'dsl-3': {
      candidateId: 'dsl-3',
      dslId: 'dsl-3',
      failureReason: 'low_pf',
      route: 'normal_pass',
      metrics: { pf: 0.9, tradeCount: 25, maxDrawdown: 0.1, expectancy: null },
    },
  },
};

describe('EvolutionInstanceCarryRepository.create', () => {
  it('payload を JSONB として書き込む', async () => {
    mockCreate.mockResolvedValue({ id: 'row-1' });
    const repo = new EvolutionInstanceCarryRepository();

    await repo.create({
      evolutionRunId: '00000000-0000-0000-0000-000000000001',
      regime: 'breakout',
      generation: 1,
      payload: validPayload,
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const arg = mockCreate.mock.calls[0][0] as {
      data: { regime: string; generation: number; payload: unknown };
    };
    expect(arg.data.regime).toBe('breakout');
    expect(arg.data.generation).toBe(1);
    expect(arg.data.payload).toEqual(validPayload);
  });
});

describe('EvolutionInstanceCarryRepository.findLatestByRegime', () => {
  it('regime に該当する最新 1 件を返す + Zod 検証通過', async () => {
    const now = new Date('2026-05-09T00:00:00.000Z');
    mockFindFirst.mockResolvedValue({
      id: 'carry-1',
      evolutionRunId: '00000000-0000-0000-0000-000000000099',
      regime: 'breakout',
      generation: 2,
      payload: validPayload,
      recordedAt: now,
    });

    const repo = new EvolutionInstanceCarryRepository();
    const result = await repo.findLatestByRegime('breakout');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('carry-1');
    expect(result?.regime).toBe('breakout');
    expect(result?.generation).toBe(2);
    expect(result?.payload.tradesByDslId).toHaveProperty('dsl-1');
    expect(result?.payload.repairHints).toHaveProperty('dsl-2');
    expect(result?.payload.repairBaselines).toHaveProperty('dsl-3');

    // findFirst は recordedAt DESC で 1 件取得
    const findArg = mockFindFirst.mock.calls[0][0] as {
      where: { regime: string };
      orderBy: { recordedAt: string };
    };
    expect(findArg.where.regime).toBe('breakout');
    expect(findArg.orderBy.recordedAt).toBe('desc');
  });

  it('該当 regime に carry が無いとき null を返す', async () => {
    mockFindFirst.mockResolvedValue(null);
    const repo = new EvolutionInstanceCarryRepository();
    const result = await repo.findLatestByRegime('reversal');
    expect(result).toBeNull();
  });

  it('payload Zod 不適合時は warning + null fallback (= 上位は空 cache に逃がす)', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'carry-bad',
      evolutionRunId: '00000000-0000-0000-0000-000000000099',
      regime: 'breakout',
      generation: 1,
      payload: { tradesByDslId: 'invalid string', repairHints: {}, repairBaselines: {} },
      recordedAt: new Date(),
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const repo = new EvolutionInstanceCarryRepository();
    const result = await repo.findLatestByRegime('breakout');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('payload Zod 不適合'),
    );
  });

  it('payload に repairHints の必須フィールド (mutationGuidance) が無いと Zod fail', async () => {
    const incomplete = {
      tradesByDslId: {},
      repairHints: {
        'dsl-x': {
          failureReason: 'low_pf',
          severity: 'medium',
          summary: 's',
          actions: [],
          // mutationGuidance が欠落
          shouldUseForRepairMutation: false,
          shouldExcludeFromParentPool: false,
          warnings: [],
        },
      },
      repairBaselines: {},
    };
    mockFindFirst.mockResolvedValue({
      id: 'carry-x',
      evolutionRunId: '00000000-0000-0000-0000-000000000099',
      regime: 'breakout',
      generation: 1,
      payload: incomplete,
      recordedAt: new Date(),
    });

    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const repo = new EvolutionInstanceCarryRepository();
    const result = await repo.findLatestByRegime('breakout');
    expect(result).toBeNull();
  });
});

describe('EvolutionInstanceCarryRepository.deleteOlderThan', () => {
  it('指定日数より古い行を削除し、削除件数を返す', async () => {
    mockDeleteMany.mockResolvedValue({ count: 7 });
    const repo = new EvolutionInstanceCarryRepository();
    const count = await repo.deleteOlderThan(14);
    expect(count).toBe(7);
    const arg = mockDeleteMany.mock.calls[0][0] as { where: { recordedAt: { lt: Date } } };
    // 14 日前を計算 (= テスト実行時刻に依存しない時間差で確認)
    const deltaMs = Date.now() - arg.where.recordedAt.lt.getTime();
    const expectedMs = 14 * 24 * 60 * 60 * 1000;
    // 実行時間誤差 1 秒以内
    expect(Math.abs(deltaMs - expectedMs)).toBeLessThan(1000);
  });
});
