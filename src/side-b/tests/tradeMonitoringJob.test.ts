/**
 * TradeMonitoringJob 単体テスト (PR-5 / Phase 7: テスト整理)
 *
 * 既存の sideBScheduler.similarity.test.ts が delegation 経由でカバーしているが、
 * Job 単体としても基本挙動を固定化。
 */

jest.mock('../utils/marketHours', () => ({
  isFXMarketOpen: jest.fn(() => true),
}));
jest.mock('../services/virtualTradeService', () => ({
  expirePendingTrades: jest.fn().mockResolvedValue(0),
  refreshPortfolioStats: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/tradeVerificationService', () => ({
  verifyTradeState: jest.fn().mockReturnValue({ entry: undefined, exit: undefined }),
  summarizeVerificationResult: jest.fn().mockReturnValue('no triggers'),
}));
jest.mock('../services/aiNoteService', () => ({
  generateNoteFromTrade: jest.fn(),
}));
jest.mock('../agent/agentMemory', () => ({
  agentMemory: { getCurrentLensSnapshot: jest.fn().mockReturnValue(undefined) },
}));
jest.mock('../repositories', () => ({
  findVirtualTrades: jest.fn().mockResolvedValue([]),
  updateTradeToOpen: jest.fn(),
  closeTrade: jest.fn(),
  planRepository: { findById: jest.fn() },
}));
jest.mock('../repositories/aiNoteRepository', () => ({
  findAITradeNoteByVirtualTradeId: jest.fn().mockResolvedValue(null),
}));
jest.mock('../agent', () => ({
  pdcaLoop: { notifyTradeCompleted: jest.fn() },
}));

import { TradeMonitoringJob, type TradeMonitoringJobServices } from '../jobs/tradeMonitoringJob';
import { isFXMarketOpen } from '../utils/marketHours';
import { findVirtualTrades } from '../repositories';
import { verifyTradeState } from '../services/tradeVerificationService';
import { refreshPortfolioStats } from '../services/virtualTradeService';
import { pdcaLoop } from '../agent';
import type { SideBSchedulerConfig } from '../jobs/sideBScheduler';

function makeServices(overrides?: Partial<TradeMonitoringJobServices>): TradeMonitoringJobServices {
  const marketDataService = {
    getRecentMinuteOHLCV: jest.fn().mockResolvedValue([]),
  } as unknown as TradeMonitoringJobServices['marketDataService'];
  const cronSimilarityService = {
    checkSimilarityAndNotify: jest.fn().mockResolvedValue({
      similarNotesFound: 0,
      notificationsSent: 0,
    }),
  } as unknown as TradeMonitoringJobServices['cronSimilarityService'];
  return { marketDataService, cronSimilarityService, ...overrides };
}

function makeJob(onStarted?: (d: Date) => void) {
  const addError = jest.fn();
  const log = jest.fn();
  const services = makeServices();
  return {
    job: new TradeMonitoringJob(
      { addError, log },
      { servicesFactory: () => services, onStarted },
    ),
    addError,
    log,
    services,
  };
}

const minimalConfig: SideBSchedulerConfig = {
  symbols: ['XAU/USD'],
  timeframe: '15m',
  autoExpireTrades: false,
  autoSimilarityCheck: false,
  autoGenerateNote: false,
} as SideBSchedulerConfig;

describe('TradeMonitoringJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isFXMarketOpen as jest.Mock).mockReturnValue(true);
  });

  it('市場休場時は早期 return、success=true でスキップメッセージ', async () => {
    (isFXMarketOpen as jest.Mock).mockReturnValue(false);
    const { job } = makeJob();

    const result = await job.runWithServices(minimalConfig, makeServices());

    expect(result.success).toBe(true);
    expect(result.message).toContain('市場が閉まっているため監視をスキップしました');
  });

  it('正常実行時 onStarted コールバックを呼ぶ + 監視完了メッセージ', async () => {
    const onStarted = jest.fn();
    const { job, services } = makeJob(onStarted);

    const result = await job.runWithServices(minimalConfig, services);

    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(onStarted).toHaveBeenCalledWith(expect.any(Date));
    expect(result.success).toBe(true);
    expect(result.message).toContain('監視完了');
  });

  it('OHLCV 取得失敗時、errors に計上してそのシンボルをスキップ', async () => {
    const { job } = makeJob();
    const services = makeServices();
    (services.marketDataService.getRecentMinuteOHLCV as jest.Mock).mockResolvedValue([]);

    const result = await job.runWithServices(minimalConfig, services);

    expect(result.success).toBe(true);
    const data = result.data as { errors: string[] };
    expect(data.errors).toContainEqual(expect.stringContaining('1分足データ取得失敗'));
  });

  it('run() は servicesFactory 経由で services を取得 (テスト時 mock 注入互換)', async () => {
    let currentServices = makeServices();
    const addError = jest.fn();
    const log = jest.fn();
    const job = new TradeMonitoringJob(
      { addError, log },
      { servicesFactory: () => currentServices },
    );

    // 1 回目: 元の services
    await job.run(minimalConfig);
    expect(currentServices.marketDataService.getRecentMinuteOHLCV).toHaveBeenCalledTimes(1);

    // services を差し替え (テスト時の (scheduler as any).marketDataService = mock 相当)
    currentServices = makeServices();
    await job.run(minimalConfig);
    // 新しい services が使われる
    expect(currentServices.marketDataService.getRecentMinuteOHLCV).toHaveBeenCalledTimes(1);
  });

  it('exit 発生時、VirtualTrade の timeframe/higherTimeframe が notifyTradeCompleted に伝播する', async () => {
    // open トレード (MTF 文脈付き) を返し、exit triggered で決済 → reflection ハンドオフへ伝播することを固定。
    const openTrade = {
      id: 'trade-mtf-1',
      symbol: 'XAU/USD',
      direction: 'long',
      plannedEntry: 2600,
      actualEntry: 2600,
      stopLoss: 2590,
      takeProfit: 2620,
      timeframe: '15m',
      higherTimeframe: '1h',
    };
    (findVirtualTrades as jest.Mock).mockImplementation((opts: { status?: string }) =>
      Promise.resolve(opts?.status === 'open' ? [openTrade] : []),
    );
    (verifyTradeState as jest.Mock).mockReturnValue({
      entry: undefined,
      exit: { triggered: true, exitPrice: 2620, exitReason: 'take_profit', exitTime: new Date() },
    });

    const services = makeServices();
    (services.marketDataService.getRecentMinuteOHLCV as jest.Mock).mockResolvedValue([
      { timestamp: new Date(), open: 2600, high: 2625, low: 2595, close: 2620, volume: 100 },
    ]);
    const { job } = makeJob();

    await job.runWithServices(minimalConfig, services);

    expect(pdcaLoop.notifyTradeCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'trade-mtf-1', timeframe: '15m', higherTimeframe: '1h' }),
    );
  });

  it('決済が発生したらポートフォリオ統計を再集計する (UI 反映の要)', async () => {
    // open トレードが exit triggered → 決済発生。決済後に refreshPortfolioStats が呼ばれること。
    const openTrade = {
      id: 'trade-refresh-1',
      symbol: 'XAU/USD',
      direction: 'long',
      plannedEntry: 2600,
      actualEntry: 2600,
      stopLoss: 2590,
      takeProfit: 2620,
      timeframe: '15m',
      higherTimeframe: '1h',
    };
    (findVirtualTrades as jest.Mock).mockImplementation((opts: { status?: string }) =>
      Promise.resolve(opts?.status === 'open' ? [openTrade] : []),
    );
    (verifyTradeState as jest.Mock).mockReturnValue({
      entry: undefined,
      exit: { triggered: true, exitPrice: 2620, exitReason: 'take_profit', exitTime: new Date() },
    });

    const services = makeServices();
    (services.marketDataService.getRecentMinuteOHLCV as jest.Mock).mockResolvedValue([
      { timestamp: new Date(), open: 2600, high: 2625, low: 2595, close: 2620, volume: 100 },
    ]);
    const { job } = makeJob();

    await job.runWithServices(minimalConfig, services);

    expect(refreshPortfolioStats).toHaveBeenCalledTimes(1);
  });

  it('決済が無い場合はポートフォリオ統計を再集計しない', async () => {
    // 既定 mock では verifyTradeState が triggers 無し → exits=0。
    const { job } = makeJob();

    await job.runWithServices(minimalConfig, makeServices());

    expect(refreshPortfolioStats).not.toHaveBeenCalled();
  });
});
