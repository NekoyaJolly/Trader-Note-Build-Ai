/**
 * Critical-4 段階 4a.PDCA smoke: EvolutionBacktestRunRepository.summarize / classifyFailureReason
 *
 * Prisma を jest.mock で差し替え、集計ロジックと失敗理由分類のみ純粋に検証する。
 */

const mockFindMany = jest.fn();

jest.mock('@prisma/client', () => {
  class MockPrismaClient {
    evolutionBacktestRun = {
      findMany: mockFindMany,
      findUnique: jest.fn(),
      create: jest.fn(),
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
