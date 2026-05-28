/**
 * DiscoveryJob 単体テスト (PR-4 / Phase 5、PR #162 Copilot review 対応)
 *
 * 互換維持のため、旧 sideBScheduler.runDiscoveryNow() の挙動を Job 単位で固定化:
 * - 0 件スキップ時の result / onCompleted 呼び出し
 * - ノート取得 → analyze 成功時の各カウント反映
 * - 例外時に addError が呼ばれ throw しないこと
 */

const mockFindAITradeNotesInPeriod = jest.fn();
const mockDiscoveryAgentAnalyze = jest.fn();

jest.mock('../repositories/aiNoteRepository', () => ({
  findAITradeNotesInPeriod: mockFindAITradeNotesInPeriod,
}));
jest.mock('../agents/DiscoveryAgent', () => ({
  discoveryAgent: {
    analyze: mockDiscoveryAgentAnalyze,
  },
}));

import { DiscoveryJob } from '../jobs/discoveryJob';
import type { SideBSchedulerConfig } from '../jobs/sideBScheduler';

function makeDeps() {
  const addError = jest.fn();
  const log = jest.fn();
  return { deps: { addError, log }, addError, log };
}

const minimalConfig = {} as SideBSchedulerConfig;

describe('DiscoveryJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('対象ノート 0 件なら skipped=true で早期 return、analyze は呼ばれない', async () => {
    mockFindAITradeNotesInPeriod.mockResolvedValue([]);
    const onCompleted = jest.fn();
    const { deps } = makeDeps();
    const job = new DiscoveryJob(deps, { onCompleted });

    const result = await job.run(minimalConfig);

    expect(result.skipped).toBe(true);
    expect(result.noteCount).toBe(0);
    expect(result.newHypothesesCount).toBe(0);
    expect(mockDiscoveryAgentAnalyze).not.toHaveBeenCalled();
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it('ノート取得 → analyze 成功時、各カウントを反映', async () => {
    mockFindAITradeNotesInPeriod.mockResolvedValue([{ id: 'note1' }, { id: 'note2' }]);
    mockDiscoveryAgentAnalyze.mockResolvedValue({
      newHypotheses: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }],
      lensInsights: [{ id: 'l1' }],
      tokenUsage: 12345,
    });
    const onCompleted = jest.fn();
    const { deps } = makeDeps();
    const job = new DiscoveryJob(deps, { onCompleted });

    const result = await job.run(minimalConfig);

    expect(result).toEqual({
      noteCount: 2,
      newHypothesesCount: 3,
      lensInsightsCount: 1,
      tokenUsage: 12345,
      skipped: false,
    });
    expect(mockDiscoveryAgentAnalyze).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it('(symbol, timeframe) ごとにグループ化して analyze を呼び、カウントを合算する', async () => {
    // Step D-4: per-group 呼び出し。2 グループ (XAUUSD/15m, EURUSD/1h) → analyze 2 回。
    mockFindAITradeNotesInPeriod.mockResolvedValue([
      { id: 'n1', symbol: 'XAUUSD', timeframe: '15m' },
      { id: 'n2', symbol: 'XAUUSD', timeframe: '15m' },
      { id: 'n3', symbol: 'EURUSD', timeframe: '1h' },
    ]);
    mockDiscoveryAgentAnalyze.mockResolvedValue({
      newHypotheses: [{ id: 'h1' }],
      lensInsights: [{ id: 'l1' }],
      tokenUsage: 100,
    });
    const onCompleted = jest.fn();
    const { deps } = makeDeps();
    const job = new DiscoveryJob(deps, { onCompleted });

    const result = await job.run(minimalConfig);

    expect(mockDiscoveryAgentAnalyze).toHaveBeenCalledTimes(2);
    expect(result.noteCount).toBe(3);
    expect(result.newHypothesesCount).toBe(2);
    expect(result.lensInsightsCount).toBe(2);
    expect(result.tokenUsage).toBe(200);
    expect(result.skipped).toBe(false);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it('findAITradeNotesInPeriod が throw しても addError が呼ばれ throw しない', async () => {
    mockFindAITradeNotesInPeriod.mockRejectedValue(new Error('db down'));
    const onCompleted = jest.fn();
    const { deps, addError } = makeDeps();
    const job = new DiscoveryJob(deps, { onCompleted });

    const result = await job.run(minimalConfig);

    expect(result.noteCount).toBe(0);
    expect(result.skipped).toBe(false);
    expect(addError).toHaveBeenCalledWith(expect.stringContaining('[Discovery] 失敗'));
    expect(addError).toHaveBeenCalledWith(expect.stringContaining('db down'));
    // 失敗時は onCompleted を呼ばない (= lastDiscoveryRun を更新しない)
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('discoveryAgent.analyze が throw しても addError が呼ばれ throw しない', async () => {
    mockFindAITradeNotesInPeriod.mockResolvedValue([{ id: 'note1' }]);
    mockDiscoveryAgentAnalyze.mockRejectedValue(new Error('agent error'));
    const onCompleted = jest.fn();
    const { deps, addError } = makeDeps();
    const job = new DiscoveryJob(deps, { onCompleted });

    const result = await job.run(minimalConfig);

    expect(addError).toHaveBeenCalledWith(expect.stringContaining('agent error'));
    expect(result.noteCount).toBe(1);
    expect(result.newHypothesesCount).toBe(0);
    expect(onCompleted).not.toHaveBeenCalled();
  });
});
