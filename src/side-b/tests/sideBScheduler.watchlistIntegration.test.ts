/**
 * SideBScheduler Watchlist 連携テスト (Phase B 2026-05-22)
 *
 * `sideBScheduler.ts` の DEFAULT_CONFIG.symbols ハードコード排除と Watchlist 動的取得
 * 経路を検証する。Nekoさん の「symbol/timeframe を hardcode してはいけない、
 * リストから動的取得すべき」原則 (2026-05-22) への対応。
 *
 * 検証内容:
 * 1. DEFAULT_CONFIG.symbols が内部規約 (cTrader 形式 = スラッシュなし大文字) と整合
 * 2. configOverride.symbols が指定されたら explicitSymbolsOverride=true、Watchlist 連携をスキップ
 * 3. configOverride.symbols 未指定なら Watchlist の active 行から symbol を取得
 * 4. Watchlist 取得結果は normalizeCTraderSymbol で正規化済 + 重複排除
 * 5. Watchlist が空なら DEFAULT_CONFIG.symbols (= ['XAUUSD']) を fallback として使用
 *
 * scheduler 構築時の重い依存は jest.mock で差し替え、Watchlist 解決ロジックだけを
 * 純粋に検証する。
 */

// =================================================================
// jest.mock: scheduler が import する重い依存を差し替える
// =================================================================

jest.mock('../ledger', () => ({
  edgeLedger: { findByStatus: jest.fn().mockResolvedValue([]) },
}));

jest.mock('../agents/StrategistAgent', () => ({
  strategistAgent: { validate: jest.fn() },
}));

jest.mock('../agents/CrossoverAgent', () => ({
  CrossoverAgent: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../agents/MutationAgent', () => ({
  MutationAgent: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../evolution/StrategyPopulation', () => ({
  StrategyPopulation: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../evolution/DiversityEnforcer', () => ({
  DiversityEnforcer: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../strategy_dsl/SurrogateFitnessSimulator', () => ({
  SurrogateFitnessSimulator: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../evolution/analysisEngineRobustnessAdapter', () => ({
  defaultOosBacktestRunner: jest.fn(),
}));

jest.mock('../evolution/EvolutionLoop', () => ({
  EvolutionLoop: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../evolution/multiGenerationRunner', () => ({
  MULTI_GENERATION_DEFAULTS: { defaultGenerations: 2, maxGenerations: 5 },
  runMultiGenerationEvolutionV1: jest.fn(),
}));

jest.mock('../agent', () => ({
  pdcaLoop: {
    notifyAnalysisComplete: jest.fn(),
    notifyStrategyComplete: jest.fn(),
    notifyTradeCompleted: jest.fn(),
    notifyValidationBatchComplete: jest.fn(),
    notifyEvolutionGenerationComplete: jest.fn(),
  },
}));

jest.mock('../utils/marketHours', () => ({
  isFXMarketOpen: jest.fn(() => true),
  getMarketStatusJST: jest.fn(() => ({
    isOpen: true,
    isDST: false,
    message: 'テスト',
    nextEvent: '',
  })),
}));

jest.mock('../../services/marketDataService');
jest.mock('../orchestrator/aiOrchestrator');
jest.mock('../services/cronSimilarityService');
jest.mock('../services/summarySchedulerService', () => ({
  summarySchedulerService: {
    start: jest.fn(),
    stop: jest.fn(),
    getStatus: jest.fn(() => ({
      isRunning: false,
      config: { weeklyEnabled: false, monthlyEnabled: false },
    })),
  },
}));

const findManyMock = jest.fn();
jest.mock('../../backend/db/client', () => ({
  prisma: {
    watchlist: { findMany: findManyMock },
  },
}));

// =================================================================
// 本体
// =================================================================

import { SideBScheduler } from '../jobs/sideBScheduler';

/**
 * SideBScheduler の private method `resolveWatchlistSymbolsIfNeeded` を呼んで結果を確認する。
 * private アクセスは AGENTS.md §2.1 例外 (test files のみ) で許容される。
 */
async function callResolveWatchlist(scheduler: SideBScheduler): Promise<void> {
  // テスト用に private method を呼び出す。AGENTS.md §2.1 で test files の as any は許容。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (scheduler as any).resolveWatchlistSymbolsIfNeeded();
}

function getConfigSymbols(scheduler: SideBScheduler): string[] {
  // テスト用に private config を読み出す。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (scheduler as any).config.symbols as string[];
}

describe('SideBScheduler Watchlist 連携 (Phase B 2026-05-22)', () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  describe('DEFAULT_CONFIG', () => {
    it('symbols 未指定で構築すると DEFAULT_CONFIG (= cTrader 形式 \'XAUUSD\') が初期値', () => {
      const scheduler = new SideBScheduler();
      expect(getConfigSymbols(scheduler)).toEqual(['XAUUSD']);
    });

    it('symbols 表記が内部規約 (= スラッシュなし大文字) と整合 (旧 \'XAU/USD\' バグ修正)', () => {
      const scheduler = new SideBScheduler();
      const symbols = getConfigSymbols(scheduler);
      // 内部規約: cTrader / DB 保存形式 = スラッシュなし大文字
      for (const s of symbols) {
        expect(s).toMatch(/^[A-Z0-9]+$/);
      }
    });
  });

  describe('明示指定 (explicitSymbolsOverride=true) の場合', () => {
    it('configOverride.symbols が指定されたら Watchlist 連携をスキップして指定値を保持', async () => {
      findManyMock.mockResolvedValue([{ symbol: 'EURUSD' }]);
      const scheduler = new SideBScheduler({ symbols: ['GBPJPY', 'USDJPY'] });
      expect(getConfigSymbols(scheduler)).toEqual(['GBPJPY', 'USDJPY']);

      await callResolveWatchlist(scheduler);

      // Watchlist は呼ばれない (= 明示指定優先)
      expect(findManyMock).not.toHaveBeenCalled();
      // config.symbols は明示指定のまま
      expect(getConfigSymbols(scheduler)).toEqual(['GBPJPY', 'USDJPY']);
    });
  });

  describe('明示指定なし (explicitSymbolsOverride=false) の場合', () => {
    it('Watchlist の active 行から symbol を取得して config.symbols を上書き', async () => {
      findManyMock.mockResolvedValue([
        { symbol: 'EURUSD' },
        { symbol: 'GBPJPY' },
        { symbol: 'XAUUSD' },
      ]);
      const scheduler = new SideBScheduler();

      await callResolveWatchlist(scheduler);

      expect(findManyMock).toHaveBeenCalledWith({
        where: { active: true },
        select: { symbol: true },
      });
      expect(getConfigSymbols(scheduler).sort()).toEqual(
        ['EURUSD', 'GBPJPY', 'XAUUSD'].sort(),
      );
    });

    it('取得した symbol は normalizeCTraderSymbol で正規化される (スラッシュ / 小文字を吸収)', async () => {
      findManyMock.mockResolvedValue([
        { symbol: 'xau/usd' },
        { symbol: 'EUR/USD' },
        { symbol: ' USDJPY ' },
      ]);
      const scheduler = new SideBScheduler();

      await callResolveWatchlist(scheduler);

      const symbols = getConfigSymbols(scheduler).sort();
      expect(symbols).toEqual(['EURUSD', 'USDJPY', 'XAUUSD'].sort());
    });

    it('重複は排除される (= 同じ symbol が複数行ある場合)', async () => {
      findManyMock.mockResolvedValue([
        { symbol: 'EURUSD' },
        { symbol: 'EUR/USD' },  // 同じ正規化結果
        { symbol: 'EURUSD' },
      ]);
      const scheduler = new SideBScheduler();

      await callResolveWatchlist(scheduler);

      expect(getConfigSymbols(scheduler)).toEqual(['EURUSD']);
    });

    it('Watchlist が空なら DEFAULT_CONFIG.symbols (= [\'XAUUSD\']) を fallback として維持', async () => {
      findManyMock.mockResolvedValue([]);
      const scheduler = new SideBScheduler();

      await callResolveWatchlist(scheduler);

      // 取得結果が空なので DEFAULT_CONFIG.symbols が維持される
      expect(getConfigSymbols(scheduler)).toEqual(['XAUUSD']);
    });

    it('Watchlist 取得が throw しても DEFAULT_CONFIG.symbols を維持して継続', async () => {
      findManyMock.mockRejectedValue(new Error('DB 接続エラー (テスト)'));
      const scheduler = new SideBScheduler();

      // throw せず resolve する (= 起動を妨げない)
      await expect(callResolveWatchlist(scheduler)).resolves.toBeUndefined();
      expect(getConfigSymbols(scheduler)).toEqual(['XAUUSD']);
    });
  });
});
