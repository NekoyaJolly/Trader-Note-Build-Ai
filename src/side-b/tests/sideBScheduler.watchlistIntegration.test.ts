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
 * 5. Watchlist が空なら DEFAULT_CONFIG.symbols (= ['NZDCHF'] = マイナー通貨 fallback) を使用
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

// PR #247 Copilot review #3: jest.mock の hoist で外側変数 (findManyMock) が
// TDZ になるリスクを避けるため、factory 内で jest.fn() を作り、jest.requireMock
// で参照を取得する形にする。
jest.mock('../../backend/db/client', () => ({
  prisma: {
    watchlist: { findMany: jest.fn() },
  },
}));

// =================================================================
// 本体
// =================================================================

import { prisma as mockedPrisma } from '../../backend/db/client';
import { SideBScheduler } from '../jobs/sideBScheduler';

// jest.mock factory 内で作られた jest.fn() への参照を取得 (TDZ-safe)
const findManyMock = mockedPrisma.watchlist.findMany as jest.Mock;

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
    it('symbols 未指定で構築すると DEFAULT_CONFIG (= マイナー通貨 \'NZDCHF\' fallback) が初期値', () => {
      const scheduler = new SideBScheduler();
      // 2026-05-24: fallback はマイナー通貨 NZDCHF (memory `feedback_fallback_minor_symbol.md`)
      expect(getConfigSymbols(scheduler)).toEqual(['NZDCHF']);
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

    it('Watchlist が空なら DEFAULT_CONFIG.symbols (= [\'NZDCHF\'] = マイナー通貨 fallback) を維持', async () => {
      findManyMock.mockResolvedValue([]);
      const scheduler = new SideBScheduler();

      await callResolveWatchlist(scheduler);

      // 取得結果が空なので DEFAULT_CONFIG.symbols が維持される (2026-05-24: NZDCHF)
      expect(getConfigSymbols(scheduler)).toEqual(['NZDCHF']);
    });

    it('Watchlist 取得が throw しても DEFAULT_CONFIG.symbols (= [\'NZDCHF\']) を維持して継続', async () => {
      findManyMock.mockRejectedValue(new Error('DB 接続エラー (テスト)'));
      const scheduler = new SideBScheduler();

      // throw せず resolve する (= 起動を妨げない)
      await expect(callResolveWatchlist(scheduler)).resolves.toBeUndefined();
      expect(getConfigSymbols(scheduler)).toEqual(['NZDCHF']);
    });
  });

  describe('updateConfig 経由の symbols 明示指定 (PR #247 Copilot review #1)', () => {
    it('updateConfig({ symbols }) が呼ばれたら explicitSymbolsOverride=true に更新、後続の Watchlist 連携をスキップ', async () => {
      findManyMock.mockResolvedValue([{ symbol: 'EURUSD' }]);
      const scheduler = new SideBScheduler();

      // 初期は Watchlist 連携対象 (explicitSymbolsOverride=false)
      // updateConfig で symbols を渡すと explicitSymbolsOverride=true に更新される
      scheduler.updateConfig({ symbols: ['BTCUSD', 'ETHUSD'] });

      await callResolveWatchlist(scheduler);

      // Watchlist は呼ばれない (= updateConfig 経由の明示指定が尊重される)
      expect(findManyMock).not.toHaveBeenCalled();
      expect(getConfigSymbols(scheduler)).toEqual(['BTCUSD', 'ETHUSD']);
    });

    it('updateConfig で symbols 以外の項目だけ更新しても explicitSymbolsOverride は変わらない', async () => {
      findManyMock.mockResolvedValue([{ symbol: 'EURUSD' }]);
      const scheduler = new SideBScheduler();

      // symbols 以外の項目 (例: timeframe) だけ更新
      scheduler.updateConfig({ timeframe: '1h' });

      // explicitSymbolsOverride は false のまま → Watchlist 連携が動く
      await callResolveWatchlist(scheduler);

      expect(findManyMock).toHaveBeenCalled();
      expect(getConfigSymbols(scheduler)).toEqual(['EURUSD']);
    });
  });
});
