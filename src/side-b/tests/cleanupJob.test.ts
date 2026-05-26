/**
 * CleanupJob 単体テスト (PR-4 / Phase 5、PR #162 Copilot review 対応)
 *
 * 互換維持のため、旧 SideBScheduler.executePlanJob() 内 cleanup ブロックの挙動を Job 単位で固定化:
 * - shouldRun の 24h 境界判定
 * - executeCleanup への引数 (planRetentionDays / tradeRetentionDays)
 * - carryRetention delegation
 * - 例外時に addError を呼ぶこと
 */

const mockExecuteCleanup = jest.fn();
const mockRunEvolutionCarryRetention = jest.fn();
const mockPruneOldCacheEntries = jest.fn();

jest.mock('../services/dataCleanupService', () => ({
  executeCleanup: mockExecuteCleanup,
}));

jest.mock('../agents/specialists/indicatorSeriesCacheRepository', () => ({
  pruneOldCacheEntries: mockPruneOldCacheEntries,
}));

import { CleanupJob } from '../jobs/cleanupJob';
import type { SideBSchedulerConfig } from '../jobs/sideBScheduler';

function makeDeps() {
  const addError = jest.fn();
  const log = jest.fn();
  return { deps: { addError, log }, addError, log };
}

function makeJob(onCompleted?: (d: Date) => void) {
  const { deps, addError, log } = makeDeps();
  const job = new CleanupJob(deps, {
    servicesFactory: () => ({
      runEvolutionCarryRetention: mockRunEvolutionCarryRetention,
    }),
    onCompleted,
  });
  return { job, addError, log };
}

const minimalConfig = {
  planRetentionDays: 30,
  tradeRetentionDays: 90,
} as SideBSchedulerConfig;

describe('CleanupJob.shouldRun (24h ガード)', () => {
  // 24h 境界テストは `Date.now()` を 2 回呼ぶ間 (= テスト内で past を作る瞬間と
  // shouldRun 内部評価の瞬間) に進む数 μs/ms で境界が崩れる。CI ランナーでは
  // GC や I/O 待ちにより数十 ms 経過することがあり「ちょうど 24h 前」が
  // 「24h+数ms 前」になって shouldRun が true を返してしまう (PR #241 CI fail)。
  // jest.useFakeTimers でシステム時刻を固定し決定論的に評価する。
  const FIXED_NOW = new Date('2026-05-21T00:00:00Z').getTime();

  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lastCleanupRun が undefined なら true', () => {
    expect(CleanupJob.shouldRun(undefined)).toBe(true);
  });

  it('lastCleanupRun が 24h+1ms 前なら true', () => {
    const past = new Date(Date.now() - (24 * 60 * 60 * 1000 + 1));
    expect(CleanupJob.shouldRun(past)).toBe(true);
  });

  it('lastCleanupRun がちょうど 24h 前なら false (>= ではなく > 判定のため境界は除外)', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(CleanupJob.shouldRun(past)).toBe(false);
  });

  it('lastCleanupRun が 1 分前なら false', () => {
    const past = new Date(Date.now() - 60 * 1000);
    expect(CleanupJob.shouldRun(past)).toBe(false);
  });
});

describe('CleanupJob.run', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('executeCleanup に planRetentionDays / tradeRetentionDays を渡す', async () => {
    mockExecuteCleanup.mockResolvedValue({
      expiredResearchCount: 0,
      oldPlansCount: 0,
      oldTradesCount: 0,
    });
    mockRunEvolutionCarryRetention.mockResolvedValue({ deleted: 0 });
    const onCompleted = jest.fn();
    const { job } = makeJob(onCompleted);

    await job.run(minimalConfig);

    expect(mockExecuteCleanup).toHaveBeenCalledWith({
      cleanupExpiredResearch: true,
      cleanupOldPlans: true,
      planRetentionDays: 30,
      cleanupOldTrades: true,
      tradeRetentionDays: 90,
    });
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it('削除件数 > 0 のとき件数ログを出力', async () => {
    mockExecuteCleanup.mockResolvedValue({
      expiredResearchCount: 5,
      oldPlansCount: 3,
      oldTradesCount: 2,
    });
    mockRunEvolutionCarryRetention.mockResolvedValue({ deleted: 0 });
    const { job, log } = makeJob();

    await job.run(minimalConfig);

    expect(log).toHaveBeenCalledWith(expect.stringContaining('クリーンアップ完了'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('リサーチ 5件'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('プラン 3件'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('トレード 2件'));
  });

  it('削除件数 = 0 のとき件数ログは出さない (起動ログは出る)', async () => {
    mockExecuteCleanup.mockResolvedValue({
      expiredResearchCount: 0,
      oldPlansCount: 0,
      oldTradesCount: 0,
    });
    mockRunEvolutionCarryRetention.mockResolvedValue({ deleted: 0 });
    const { job, log } = makeJob();

    await job.run(minimalConfig);

    const cleanupCompleteLog = log.mock.calls.find((c) =>
      typeof c[0] === 'string' ? c[0].includes('クリーンアップ完了') : false,
    );
    expect(cleanupCompleteLog).toBeUndefined();
    // 起動ログは出る
    expect(log).toHaveBeenCalledWith(expect.stringContaining('クリーンアップを実行中'));
  });

  it('carryRetention の結果を result.carryRetention に反映', async () => {
    mockExecuteCleanup.mockResolvedValue({
      expiredResearchCount: 0,
      oldPlansCount: 0,
      oldTradesCount: 0,
    });
    mockRunEvolutionCarryRetention.mockResolvedValue({ deleted: 7 });
    mockPruneOldCacheEntries.mockResolvedValue(0);
    const { job } = makeJob();

    const result = await job.run(minimalConfig);

    expect(result.carryRetention.deleted).toBe(7);
    expect(mockRunEvolutionCarryRetention).toHaveBeenCalledTimes(1);
  });

  it('Phase 6.8 Step 3c: IndicatorSeriesCache retention の結果を反映', async () => {
    mockExecuteCleanup.mockResolvedValue({
      expiredResearchCount: 0,
      oldPlansCount: 0,
      oldTradesCount: 0,
    });
    mockRunEvolutionCarryRetention.mockResolvedValue({ deleted: 0 });
    mockPruneOldCacheEntries.mockResolvedValue(15);
    const { job, log } = makeJob();

    const result = await job.run(minimalConfig);

    expect(result.indicatorCacheRetention.deleted).toBe(15);
    expect(result.indicatorCacheRetention.error).toBeUndefined();
    expect(mockPruneOldCacheEntries).toHaveBeenCalledWith({ keepCount: 12 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('IndicatorSeriesCache retention 完了: 15件削除'));
  });

  it('Phase 6.8 Step 3c: IndicatorSeriesCache retention 失敗時も本体 cleanup 続行', async () => {
    mockExecuteCleanup.mockResolvedValue({
      expiredResearchCount: 0,
      oldPlansCount: 0,
      oldTradesCount: 0,
    });
    mockRunEvolutionCarryRetention.mockResolvedValue({ deleted: 0 });
    mockPruneOldCacheEntries.mockRejectedValue(new Error('DB connection lost'));
    const { job } = makeJob();

    const result = await job.run(minimalConfig);

    // 本体 cleanup は executed=true (失敗で止まらない)
    expect(result.executed).toBe(true);
    expect(result.indicatorCacheRetention.deleted).toBe(0);
    expect(result.indicatorCacheRetention.error).toContain('DB connection lost');
  });

  it('executeCleanup が throw すると addError を呼び result.error にメッセージを記録', async () => {
    mockExecuteCleanup.mockRejectedValue(new Error('cleanup failed'));
    const onCompleted = jest.fn();
    const { job, addError } = makeJob(onCompleted);

    const result = await job.run(minimalConfig);

    expect(addError).toHaveBeenCalledWith(expect.stringContaining('クリーンアップエラー'));
    expect(result.executed).toBe(false);
    expect(result.error).toContain('cleanup failed');
    expect(onCompleted).not.toHaveBeenCalled();
    expect(mockRunEvolutionCarryRetention).not.toHaveBeenCalled();
  });
});
