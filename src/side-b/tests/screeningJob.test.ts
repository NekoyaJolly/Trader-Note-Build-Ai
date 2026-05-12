/**
 * ScreeningJob 単体テスト (PR-5 / Phase 7: テスト整理)
 *
 * Screening は既存 Scheduler テストがないため、Job 単体として基本挙動を固定化。
 */

import type { EdgeHypothesis } from '../models/edgeHypothesis';

jest.mock('../ledger', () => ({
  edgeLedger: { findByStatus: jest.fn() },
}));
jest.mock('../bridge', () => ({
  screeningOrchestrator: { runScreening: jest.fn() },
}));
jest.mock('../agent/agentMemory', () => ({
  agentMemory: { getCurrentLensSnapshot: jest.fn().mockReturnValue(undefined) },
}));
jest.mock('../agent', () => ({
  pdcaLoop: { notifyValidationBatchComplete: jest.fn() },
}));

import { ScreeningJob } from '../jobs/screeningJob';
import { edgeLedger } from '../ledger';
import { screeningOrchestrator } from '../bridge';
import { pdcaLoop } from '../agent';
import type { SideBSchedulerConfig } from '../jobs/sideBScheduler';

const mockEdgeLedger = edgeLedger as unknown as { findByStatus: jest.Mock };
const mockOrchestrator = screeningOrchestrator as unknown as { runScreening: jest.Mock };
const mockPdcaLoop = pdcaLoop as unknown as { notifyValidationBatchComplete: jest.Mock };

function makeHyp(id: string): EdgeHypothesis {
  return {
    id,
    statement: `test ${id}`,
    category: 'time',
    conditions: [],
    expectedDirection: 'long',
    status: 'unverified',
    statusUpdatedAt: new Date(),
    symbols: ['XAUUSD'],
    timeframes: ['15m'],
    observationCount: 0,
    winCount: 0,
    lossCount: 0,
    breakevenCount: 0,
    totalPnlPips: 0,
    avgRR: 0,
    source: 'ai_generated',
    firstObservedAt: new Date(),
    lastObservedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeJob(onCompleted?: (d: Date) => void) {
  const addError = jest.fn();
  const log = jest.fn();
  return {
    job: new ScreeningJob({ addError, log }, { onCompleted }),
    addError,
    log,
  };
}

const minimalConfig = (limit: number): SideBSchedulerConfig =>
  ({ screeningMaxPerRun: limit }) as SideBSchedulerConfig;

describe('ScreeningJob', () => {
  beforeEach(() => jest.clearAllMocks());

  it("findByStatus に 'unverified' + limit を渡す", async () => {
    mockEdgeLedger.findByStatus.mockResolvedValue([]);
    const { job } = makeJob();

    await job.run(minimalConfig(10));

    expect(mockEdgeLedger.findByStatus).toHaveBeenCalledWith('unverified', 10);
  });

  it('verdict を集計し PDCA に通知', async () => {
    mockEdgeLedger.findByStatus.mockResolvedValue([makeHyp('h1'), makeHyp('h2'), makeHyp('h3')]);
    mockOrchestrator.runScreening
      .mockResolvedValueOnce({ verdict: 'screening_passed', metrics: { pf: 1.5, winRate: 0.6, tradeCount: 20 } })
      .mockResolvedValueOnce({ verdict: 'rejected', reasons: ['over_fit'] })
      .mockResolvedValueOnce({ verdict: 'not_testable', reason: 'insufficient' });
    const onCompleted = jest.fn();
    const { job } = makeJob(onCompleted);

    const result = await job.run(minimalConfig(5));

    expect(result).toEqual({ processed: 3, passed: 1, rejected: 1, notTestable: 1, errors: 0 });
    expect(mockPdcaLoop.notifyValidationBatchComplete).toHaveBeenCalledWith('screening', result);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it('options で limit を上書きできる (runWithOptions)', async () => {
    mockEdgeLedger.findByStatus.mockResolvedValue([]);
    const { job } = makeJob();

    await job.runWithOptions(minimalConfig(5), { limit: 2 });

    expect(mockEdgeLedger.findByStatus).toHaveBeenCalledWith('unverified', 2);
  });

  it('1 仮説 throw でも他は継続、errors に計上', async () => {
    mockEdgeLedger.findByStatus.mockResolvedValue([makeHyp('h1'), makeHyp('h2')]);
    mockOrchestrator.runScreening
      .mockRejectedValueOnce(new Error('orchestrator error'))
      .mockResolvedValueOnce({ verdict: 'screening_passed', metrics: { pf: 2.0, winRate: 0.7, tradeCount: 30 } });
    const { job, addError } = makeJob();

    const result = await job.run(minimalConfig(5));

    expect(result.processed).toBe(2);
    expect(result.passed).toBe(1);
    expect(result.errors).toBe(1);
    expect(addError).toHaveBeenCalledWith(expect.stringContaining('h1 失敗'));
  });

  it('findByStatus throw 時に addError、orchestrator は呼ばれない', async () => {
    mockEdgeLedger.findByStatus.mockRejectedValue(new Error('db down'));
    const { job, addError } = makeJob();

    const result = await job.run(minimalConfig(5));

    expect(result.processed).toBe(0);
    expect(mockOrchestrator.runScreening).not.toHaveBeenCalled();
    expect(addError).toHaveBeenCalledWith(expect.stringContaining('仮説取得失敗'));
  });
});
