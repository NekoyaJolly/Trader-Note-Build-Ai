/**
 * Critical-4 段階 4a.PDCA smoke: EvolutionBacktestRunRepository.summarize / classifyFailureReason
 *
 * Prisma を jest.mock で差し替え、集計ロジックと失敗理由分類のみ純粋に検証する。
 */

const mockFindMany = jest.fn();
const mockCreate = jest.fn();

jest.mock('@prisma/client', () => {
  class MockPrismaClient {
    evolutionBacktestRun = {
      findMany: mockFindMany,
      findUnique: jest.fn(),
      create: mockCreate,
    };
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return {
    PrismaClient: MockPrismaClient,
    Prisma: { JsonNull: 'DbNull' },
  };
});

import {
  EvolutionBacktestRunRepository,
  classifyFailureReason,
} from '../repositories/evolutionBacktestRunRepository';

beforeEach(() => {
  mockFindMany.mockReset();
  mockCreate.mockReset();
});

describe('classifyFailureReason', () => {
  it('null は unknown', () => {
    expect(classifyFailureReason(null)).toBe('unknown');
  });
  it('"tradeCount X < Y" は insufficient_trades', () => {
    expect(classifyFailureReason('tradeCount 5 < 20')).toBe('insufficient_trades');
  });
  it('"pf X < Y" は low_pf', () => {
    expect(classifyFailureReason('pf 0.8 < 1')).toBe('low_pf');
  });
  it('timeout を含む文字列は analysis_engine_timeout', () => {
    expect(classifyFailureReason('analysis-engine BT failed: timeout of 180000ms exceeded')).toBe(
      'analysis_engine_timeout',
    );
  });
  it('"analysis-engine BT failed" は analysis_engine_error (timeout を含まない場合)', () => {
    expect(classifyFailureReason('analysis-engine BT failed: connection refused')).toBe(
      'analysis_engine_error',
    );
  });
  it('"DSL not found" は dsl_missing', () => {
    expect(classifyFailureReason('DSL not found in current generation map')).toBe('dsl_missing');
  });
  it('未知パターンは other', () => {
    expect(classifyFailureReason('something weird happened')).toBe('other');
  });
});

describe('EvolutionBacktestRunRepository.summarizeByEvolutionRun', () => {
  it('passed/failed/failureReasonCounts/generations を集計する', async () => {
    mockFindMany.mockResolvedValue([
      { generation: 0, formalBtPassed: true, formalBtFailureReason: null },
      { generation: 0, formalBtPassed: false, formalBtFailureReason: 'tradeCount 5 < 20' },
      { generation: 0, formalBtPassed: false, formalBtFailureReason: 'pf 0.8 < 1' },
      { generation: 1, formalBtPassed: true, formalBtFailureReason: null },
      {
        generation: 1,
        formalBtPassed: false,
        formalBtFailureReason: 'analysis-engine BT failed: timeout of 180000ms exceeded',
      },
    ]);

    const repo = new EvolutionBacktestRunRepository();
    const summary = await repo.summarizeByEvolutionRun(
      '00000000-0000-0000-0000-000000000001',
    );

    expect(summary.totalCandidates).toBe(5);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(3);
    expect(summary.failureReasonCounts).toEqual({
      insufficient_trades: 1,
      low_pf: 1,
      analysis_engine_timeout: 1,
    });
    expect(summary.generations).toEqual([
      { generation: 0, passed: 1, failed: 2 },
      { generation: 1, passed: 1, failed: 1 },
    ]);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { evolutionRunId: '00000000-0000-0000-0000-000000000001' },
      }),
    );
  });

  it('該当行が無い場合も空サマリを返す (落ちた候補が 0 でも観測可能)', async () => {
    mockFindMany.mockResolvedValue([]);

    const repo = new EvolutionBacktestRunRepository();
    const summary = await repo.summarizeByEvolutionRun('empty-run-id');

    expect(summary.totalCandidates).toBe(0);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.failureReasonCounts).toEqual({});
    expect(summary.generations).toEqual([]);
  });
});

// =================================================================
// Filter Evolution Phase B-1: trades 列の永続化テスト
// =================================================================

const minimalDsl = {
  id: 'dsl-1',
  generation: 0,
  parentIds: [],
  regimeTarget: 'breakout',
  symbol: 'EURUSD',
  timeframe: '1h',
  entry: {
    direction: 'long' as const,
    orderType: 'market' as const,
    trigger: {
      logic: 'AND' as const,
      conditions: [{ lens: 'ohlcv' as const, feature: 'close', op: '>' as const, value: 0.0001 }],
    },
  },
  stopLoss: { type: 'fixed_pips' as const, value: 30 },
  takeProfit: { type: 'rr_ratio' as const, value: 1.5 },
  parameters: {},
  metadata: {
    createdAt: '2026-05-09T00:00:00.000Z',
    createdBy: 'crossover' as const,
  },
};

describe('EvolutionBacktestRunRepository.create (Phase B-1: trades 永続化)', () => {
  it('trades が指定された場合は JSONB として書き込まれる', async () => {
    mockCreate.mockResolvedValue({ id: 'row-1' });
    const repo = new EvolutionBacktestRunRepository();
    const trades = [
      { entryTime: '2024-01-01T00:00:00Z', side: 'long' as const, pnl: 12.5, outcome: 'win' as const },
      { entryTime: '2024-01-02T00:00:00Z', side: 'long' as const, pnl: -8.2, outcome: 'loss' as const },
    ];

    await repo.create({
      evolutionRunId: '00000000-0000-0000-0000-000000000001',
      generation: 1,
      candidateId: 'cand-1',
      candidateHash: 'hash-1',
      dslSnapshot: minimalDsl,
      surrogateScore: 0.5,
      formalBtPassed: true,
      formalBtMetrics: { pf: 1.6, winRate: 0.55, tradeCount: 30 },
      formalBtFailureReason: null,
      engine: 'analysis-engine',
      engineVersion: 'analysis-engine/test@1',
      trades,
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArg = mockCreate.mock.calls[0][0] as { data: { trades: unknown } };
    expect(createArg.data.trades).toEqual(trades);
  });

  it('trades が undefined のときは Prisma.JsonNull (= DB NULL) で永続化', async () => {
    mockCreate.mockResolvedValue({ id: 'row-2' });
    const repo = new EvolutionBacktestRunRepository();

    await repo.create({
      evolutionRunId: '00000000-0000-0000-0000-000000000002',
      generation: 0,
      candidateId: 'cand-2',
      candidateHash: 'hash-2',
      dslSnapshot: minimalDsl,
      surrogateScore: 0,
      formalBtPassed: false,
      formalBtMetrics: null,
      formalBtFailureReason: 'analysis-engine BT failed: timeout',
      engine: 'analysis-engine',
      engineVersion: 'analysis-engine/test@1',
      // trades 未指定 (= analysis-engine 例外で trade list 取得不能のケース)
    });

    const createArg = mockCreate.mock.calls[0][0] as { data: { trades: unknown } };
    // Prisma.JsonNull は本ファイルの mock では文字列 'DbNull' として表現される
    expect(createArg.data.trades).toBe('DbNull');
  });

  it('trades が空配列のときは [] を JSONB に書き込む (= 取引 0 件の正規ケース)', async () => {
    mockCreate.mockResolvedValue({ id: 'row-3' });
    const repo = new EvolutionBacktestRunRepository();

    await repo.create({
      evolutionRunId: '00000000-0000-0000-0000-000000000003',
      generation: 0,
      candidateId: 'cand-3',
      candidateHash: 'hash-3',
      dslSnapshot: minimalDsl,
      surrogateScore: 0,
      formalBtPassed: false,
      formalBtMetrics: { pf: 0, winRate: 0, tradeCount: 0 },
      formalBtFailureReason: 'tradeCount 0 < 20',
      engine: 'analysis-engine',
      engineVersion: 'analysis-engine/test@1',
      trades: [],
    });

    const createArg = mockCreate.mock.calls[0][0] as { data: { trades: unknown } };
    expect(createArg.data.trades).toEqual([]);
  });
});

describe('EvolutionBacktestRunRepository.createMany (Phase B-1)', () => {
  it('1 行失敗しても他は永続化を継続し、成功行のみ返す', async () => {
    mockCreate
      .mockResolvedValueOnce({ id: 'row-a' })
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ id: 'row-c' });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const repo = new EvolutionBacktestRunRepository();
    const baseRow = {
      evolutionRunId: '00000000-0000-0000-0000-000000000099',
      generation: 0,
      candidateHash: 'hash',
      dslSnapshot: minimalDsl,
      surrogateScore: 0,
      formalBtPassed: false,
      formalBtMetrics: null,
      formalBtFailureReason: null,
      engine: 'analysis-engine',
      engineVersion: 'analysis-engine/test@1',
    };
    const result = await repo.createMany([
      { ...baseRow, candidateId: 'a' },
      { ...baseRow, candidateId: 'b' },
      { ...baseRow, candidateId: 'c' },
    ]);

    expect(result).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('candidateId=b'),
    );
    warnSpy.mockRestore();
  });
});
