/**
 * Filter Evolution Phase D-1a: GenerationLessonRepository テスト
 *
 * Prisma を jest.mock で差し替え、create / createMany / findRecentByRegime / findRecent /
 * deleteOlderThan の各経路を純粋に検証する。
 */

const mockCreate = jest.fn();
const mockFindMany = jest.fn();
const mockDeleteMany = jest.fn();

jest.mock('@prisma/client', () => {
  class MockPrismaClient {
    generationLesson = {
      create: mockCreate,
      findMany: mockFindMany,
      deleteMany: mockDeleteMany,
    };
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return {
    PrismaClient: MockPrismaClient,
    Prisma: { JsonNull: 'JsonNull', DbNull: 'DbNull' },
  };
});

import { GenerationLessonRepository } from '../repositories/generationLessonRepository';

beforeEach(() => {
  mockCreate.mockReset();
  mockFindMany.mockReset();
  mockDeleteMany.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GenerationLessonRepository.create', () => {
  it('必須フィールドのみで永続化、metrics と confidence は DbNull / null', async () => {
    mockCreate.mockResolvedValue({ id: 'row-1' });
    const repo = new GenerationLessonRepository();

    await repo.create({
      evolutionRunId: '00000000-0000-0000-0000-000000000001',
      regime: 'breakout',
      generation: 2,
      category: 'breakthrough',
      lesson: 'Gen 2 で time_session filter で promotion top-K 到達',
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const arg = mockCreate.mock.calls[0][0] as {
      data: { metrics: unknown; confidence: number | null; lesson: string };
    };
    expect(arg.data.metrics).toBe('DbNull');
    expect(arg.data.confidence).toBeNull();
    expect(arg.data.lesson).toContain('time_session filter');
  });

  it('metrics と confidence を指定すると JSONB と数値で永続化', async () => {
    mockCreate.mockResolvedValue({ id: 'row-2' });
    const repo = new GenerationLessonRepository();

    await repo.create({
      evolutionRunId: '00000000-0000-0000-0000-000000000002',
      regime: 'reversal',
      generation: 3,
      category: 'filter_efficacy_increased',
      lesson: 'Lift 中央値が 1.42 へ上昇',
      metrics: { winRateLiftMedian: 1.42, filterCategory: 'time_session' },
      confidence: 0.7,
    });

    const arg = mockCreate.mock.calls[0][0] as {
      data: { metrics: unknown; confidence: number };
    };
    expect(arg.data.metrics).toEqual({
      winRateLiftMedian: 1.42,
      filterCategory: 'time_session',
    });
    expect(arg.data.confidence).toBe(0.7);
  });
});

describe('GenerationLessonRepository.createMany', () => {
  it('1 行失敗しても他は永続化を継続し、成功行のみ返す', async () => {
    mockCreate
      .mockResolvedValueOnce({ id: 'row-a' })
      .mockRejectedValueOnce(new Error('DB connection lost'))
      .mockResolvedValueOnce({ id: 'row-c' });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const repo = new GenerationLessonRepository();
    const baseRow = {
      evolutionRunId: '00000000-0000-0000-0000-000000000099',
      regime: 'breakout',
      generation: 1,
      lesson: 'sample',
    };
    const result = await repo.createMany([
      { ...baseRow, category: 'breakthrough' as const },
      { ...baseRow, category: 'stagnation' as const },
      { ...baseRow, category: 'novelty_emerged' as const },
    ]);

    expect(result).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('regime=breakout'),
    );
  });

  it('空配列なら create を呼ばずに空配列を返す', async () => {
    const repo = new GenerationLessonRepository();
    const result = await repo.createMany([]);
    expect(result).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('GenerationLessonRepository.findRecentByRegime', () => {
  it('regime 指定で最新 N 件を recordedAt DESC で取得 + record 形式に変換', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'r1',
        evolutionRunId: '00000000-0000-0000-0000-000000000099',
        regime: 'breakout',
        generation: 5,
        category: 'breakthrough',
        lesson: 'Gen 5 で promotion 増加',
        metrics: { liftMedian: 1.5 },
        confidence: 0.8,
        recordedAt: new Date('2026-05-09T00:00:00Z'),
      },
      {
        id: 'r2',
        evolutionRunId: '00000000-0000-0000-0000-000000000099',
        regime: 'breakout',
        generation: 4,
        category: 'unknown_category', // Zod 不適合 → 'other' fallback
        lesson: '不明カテゴリ',
        metrics: null,
        confidence: null,
        recordedAt: new Date('2026-05-08T00:00:00Z'),
      },
    ]);

    const repo = new GenerationLessonRepository();
    const result = await repo.findRecentByRegime('breakout', 5);

    expect(result).toHaveLength(2);
    expect(result[0].category).toBe('breakthrough');
    expect(result[0].metrics).toEqual({ liftMedian: 1.5 });
    expect(result[1].category).toBe('other'); // fallback
    expect(result[1].metrics).toBeNull();

    const findArg = mockFindMany.mock.calls[0][0] as {
      where: { regime: string };
      orderBy: { recordedAt: string };
      take: number;
    };
    expect(findArg.where.regime).toBe('breakout');
    expect(findArg.orderBy.recordedAt).toBe('desc');
    expect(findArg.take).toBe(5);
  });

  it('limit が 0 / 負数 / 100 超過なら正規化される', async () => {
    mockFindMany.mockResolvedValue([]);
    const repo = new GenerationLessonRepository();

    await repo.findRecentByRegime('breakout', 0);
    expect((mockFindMany.mock.calls[0][0] as { take: number }).take).toBe(1);

    await repo.findRecentByRegime('breakout', -5);
    expect((mockFindMany.mock.calls[1][0] as { take: number }).take).toBe(1);

    await repo.findRecentByRegime('breakout', 999);
    expect((mockFindMany.mock.calls[2][0] as { take: number }).take).toBe(100);
  });
});

describe('GenerationLessonRepository.findRecent', () => {
  it('regime 指定なしで全 regime の最新 N 件を取得', async () => {
    mockFindMany.mockResolvedValue([]);
    const repo = new GenerationLessonRepository();

    await repo.findRecent(15);

    const findArg = mockFindMany.mock.calls[0][0] as {
      where?: unknown;
      orderBy: { recordedAt: string };
      take: number;
    };
    expect(findArg.where).toBeUndefined(); // 全 regime
    expect(findArg.take).toBe(15);
  });
});

describe('GenerationLessonRepository.deleteOlderThan', () => {
  it('指定日数より古い行を削除し、削除件数を返す', async () => {
    mockDeleteMany.mockResolvedValue({ count: 12 });
    const repo = new GenerationLessonRepository();
    const count = await repo.deleteOlderThan(30);

    expect(count).toBe(12);
    const arg = mockDeleteMany.mock.calls[0][0] as { where: { recordedAt: { lt: Date } } };
    const deltaMs = Date.now() - arg.where.recordedAt.lt.getTime();
    const expectedMs = 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(deltaMs - expectedMs)).toBeLessThan(1000);
  });
});
