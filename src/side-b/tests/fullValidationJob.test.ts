/**
 * FullValidationJob 単体テスト (PR-5 / Phase 7: テスト整理)
 *
 * 旧 sideBScheduler.runFullValidationNow() のテストは
 * src/side-b/tests/sideBScheduler.fullValidation.test.ts で delegation 経由で
 * カバーされているが、Job 単体としても挙動を固定化するため最小ケースを追加。
 */

import type { EdgeHypothesis } from '../models/edgeHypothesis';

jest.mock('../ledger', () => ({
  edgeLedger: { findByStatus: jest.fn() },
}));
jest.mock('../services/hypothesisValidationService', () => ({
  validateHypothesis: jest.fn(),
}));
jest.mock('../agent', () => ({
  pdcaLoop: { notifyValidationBatchComplete: jest.fn() },
}));

import { FullValidationJob } from '../jobs/fullValidationJob';
import { edgeLedger } from '../ledger';
import { validateHypothesis } from '../services/hypothesisValidationService';
import { pdcaLoop } from '../agent';
import type { SideBSchedulerConfig } from '../jobs/sideBScheduler';

const mockEdgeLedger = edgeLedger as unknown as { findByStatus: jest.Mock };
const mockValidate = validateHypothesis as unknown as jest.Mock;
const mockPdcaLoop = pdcaLoop as unknown as { notifyValidationBatchComplete: jest.Mock };

function mockSleepInstant() {
  const realSetTimeout = global.setTimeout;
  // PR #163 Copilot review: 将来 setTimeout(cb, ms, ...args) を使う実装に対応するため
  // 追加引数 (...args) を保持して realSetTimeout に渡す
  jest.spyOn(global, 'setTimeout').mockImplementation((
    cb: (...args: unknown[]) => void,
    _ms?: number,
    ...args: unknown[]
  ) => {
    return realSetTimeout(cb, 0, ...args);
  });
}

function makeHyp(id: string): EdgeHypothesis {
  return {
    id,
    statement: `test ${id}`,
    category: 'time',
    conditions: [],
    expectedDirection: 'long',
    status: 'screening_passed',
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
    job: new FullValidationJob({ addError, log }, { onCompleted }),
    addError,
    log,
  };
}

const minimalConfig = (limit: number): SideBSchedulerConfig =>
  ({ fullValidationMaxPerRun: limit }) as SideBSchedulerConfig;

describe('FullValidationJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSleepInstant();
  });
  afterEach(() => jest.restoreAllMocks());

  it('findByStatus に limit を渡し、verdict を集計', async () => {
    mockEdgeLedger.findByStatus.mockResolvedValue([makeHyp('h1'), makeHyp('h2')]);
    mockValidate
      .mockResolvedValueOnce({ verdict: 'confirmed', hypothesisId: 'h1', baseCriteriaReasons: [], decidedAt: new Date() })
      .mockResolvedValueOnce({ verdict: 'rejected', hypothesisId: 'h2', baseCriteriaReasons: ['過学習'], decidedAt: new Date() });
    const onCompleted = jest.fn();
    const { job } = makeJob(onCompleted);

    const result = await job.run(minimalConfig(5));

    expect(mockEdgeLedger.findByStatus).toHaveBeenCalledWith('screening_passed', 5);
    expect(result).toEqual({ processed: 2, confirmed: 1, rejected: 1, notTestable: 0, errors: 0 });
    expect(mockPdcaLoop.notifyValidationBatchComplete).toHaveBeenCalledWith('full_validation', result);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it('fullValidationMaxPerRun で件数制限 (Math.max(1, ...))', async () => {
    mockEdgeLedger.findByStatus.mockResolvedValue([makeHyp('h1'), makeHyp('h2'), makeHyp('h3'), makeHyp('h4')]);
    mockValidate.mockResolvedValue({ verdict: 'confirmed', hypothesisId: 'x', baseCriteriaReasons: [], decidedAt: new Date() });
    const { job } = makeJob();

    const result = await job.run(minimalConfig(2));

    expect(mockValidate).toHaveBeenCalledTimes(2);
    expect(result.processed).toBe(2);
  });

  it('1 仮説 throw でも他は継続、errors に計上', async () => {
    mockEdgeLedger.findByStatus.mockResolvedValue([makeHyp('h1'), makeHyp('h2')]);
    mockValidate
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ verdict: 'confirmed', hypothesisId: 'h2', baseCriteriaReasons: [], decidedAt: new Date() });
    const { job, addError } = makeJob();

    const result = await job.run(minimalConfig(5));

    expect(result).toEqual({ processed: 2, confirmed: 1, rejected: 0, notTestable: 0, errors: 1 });
    expect(addError).toHaveBeenCalledWith(expect.stringContaining('h1 失敗'));
  });

  it('対象 0 件なら validateHypothesis は呼ばれない', async () => {
    mockEdgeLedger.findByStatus.mockResolvedValue([]);
    const { job } = makeJob();

    const result = await job.run(minimalConfig(5));

    expect(mockValidate).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
  });

  it('findByStatus が throw すると addError に記録、空集計を返す', async () => {
    mockEdgeLedger.findByStatus.mockRejectedValue(new Error('db down'));
    const { job, addError } = makeJob();

    const result = await job.run(minimalConfig(5));

    expect(result.processed).toBe(0);
    expect(addError).toHaveBeenCalledWith(expect.stringContaining('仮説取得失敗'));
  });
});
