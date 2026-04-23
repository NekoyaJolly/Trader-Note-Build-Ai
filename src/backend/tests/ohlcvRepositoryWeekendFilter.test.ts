/**
 * Phase 6.7a: OHLCVRepository 休場日フィルタのテスト
 *
 * bulkInsert / upsert に土日バーが渡された場合のフィルタ動作と、
 * 暗号通貨(24/7 シンボル)のスルー動作を検証する。
 *
 * Prisma は jest.mock で差し替え、filter ロジックのみ純粋に検証する。
 */

const mockCreateMany = jest.fn();
const mockUpsert = jest.fn();

jest.mock('@prisma/client', () => {
  class MockPrismaClient {
    oHLCVCandle = {
      createMany: mockCreateMany,
      upsert: mockUpsert,
    };
  }
  return {
    PrismaClient: MockPrismaClient,
    Prisma: {
      Decimal: class {
        constructor(public v: number) {}
      },
    },
  };
});

import { OHLCVRepository, followsFXMarketCalendar } from '../repositories/ohlcvRepository';

beforeEach(() => {
  mockCreateMany.mockReset();
  mockUpsert.mockReset();
  mockCreateMany.mockResolvedValue({ count: 0 });
  mockUpsert.mockResolvedValue({ id: 'mock' });
});

describe('followsFXMarketCalendar', () => {
  it('FX ペア / 貴金属は true', () => {
    expect(followsFXMarketCalendar('XAU/USD')).toBe(true);
    expect(followsFXMarketCalendar('XAUUSD')).toBe(true);
    expect(followsFXMarketCalendar('USDJPY')).toBe(true);
    expect(followsFXMarketCalendar('EUR/USD')).toBe(true);
    expect(followsFXMarketCalendar('AUD/USD')).toBe(true);
  });

  it('暗号通貨 prefix は false', () => {
    expect(followsFXMarketCalendar('BTCUSD')).toBe(false);
    expect(followsFXMarketCalendar('BTC/USD')).toBe(false);
    expect(followsFXMarketCalendar('ETHUSD')).toBe(false);
    expect(followsFXMarketCalendar('SOL/USDT')).toBe(false);
    expect(followsFXMarketCalendar('DOGE/USD')).toBe(false);
  });

  it('大文字小文字は問わない', () => {
    expect(followsFXMarketCalendar('btcusd')).toBe(false);
    expect(followsFXMarketCalendar('xauusd')).toBe(true);
  });
});

describe('OHLCVRepository.bulkInsert 休場日フィルタ', () => {
  const repo = new OHLCVRepository();

  it('土曜・日曜のバーは skip される(FX シンボル)', async () => {
    // 2026-04-25 は土曜、2026-04-26 は日曜
    const saturday = new Date('2026-04-25T10:00:00Z'); // 土曜 10:00 UTC
    const sunday = new Date('2026-04-26T10:00:00Z'); // 日曜 10:00 UTC
    const monday = new Date('2026-04-27T10:00:00Z'); // 月曜 10:00 UTC(市場開場中)

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await repo.bulkInsert([
      { symbol: 'XAUUSD', timeframe: '15m', timestamp: saturday, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { symbol: 'XAUUSD', timeframe: '15m', timestamp: sunday, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { symbol: 'XAUUSD', timeframe: '15m', timestamp: monday, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);

    expect(mockCreateMany).toHaveBeenCalledTimes(1);
    const call = mockCreateMany.mock.calls[0][0];
    expect(call.data.length).toBe(1); // 月曜のみ
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('休場日バー 2 本をスキップ'),
    );
    warnSpy.mockRestore();
  });

  it('全てが土日なら createMany を呼ばずに 0 を返す', async () => {
    const saturday = new Date('2026-04-25T10:00:00Z');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await repo.bulkInsert([
      { symbol: 'USDJPY', timeframe: '15m', timestamp: saturday, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    expect(result).toBe(0);
    expect(mockCreateMany).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('暗号通貨(BTC)は土日でもそのまま保存される', async () => {
    const saturday = new Date('2026-04-25T10:00:00Z');
    await repo.bulkInsert([
      { symbol: 'BTCUSD', timeframe: '15m', timestamp: saturday, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    expect(mockCreateMany).toHaveBeenCalledTimes(1);
    const call = mockCreateMany.mock.calls[0][0];
    expect(call.data.length).toBe(1);
  });

  it('FX シンボルで全て平日なら全件保存される', async () => {
    const mondayMorning = new Date('2026-04-27T08:00:00Z');
    const tuesdayMorning = new Date('2026-04-28T08:00:00Z');
    await repo.bulkInsert([
      { symbol: 'XAUUSD', timeframe: '15m', timestamp: mondayMorning, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { symbol: 'XAUUSD', timeframe: '15m', timestamp: tuesdayMorning, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    expect(mockCreateMany).toHaveBeenCalledTimes(1);
    const call = mockCreateMany.mock.calls[0][0];
    expect(call.data.length).toBe(2);
  });
});

describe('OHLCVRepository.upsert 休場日フィルタ', () => {
  const repo = new OHLCVRepository();

  it('土曜の FX バーは null を返し upsert を呼ばない', async () => {
    const saturday = new Date('2026-04-25T10:00:00Z');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await repo.upsert({
      symbol: 'XAUUSD',
      timeframe: '15m',
      timestamp: saturday,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
    });
    expect(result).toBeNull();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('休場日バーのため保存スキップ'),
    );
    warnSpy.mockRestore();
  });

  it('月曜の FX バーは upsert される', async () => {
    const monday = new Date('2026-04-27T08:00:00Z');
    await repo.upsert({
      symbol: 'XAUUSD',
      timeframe: '15m',
      timestamp: monday,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
    });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('暗号通貨は土曜でも upsert される', async () => {
    const saturday = new Date('2026-04-25T10:00:00Z');
    await repo.upsert({
      symbol: 'BTCUSD',
      timeframe: '15m',
      timestamp: saturday,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
    });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });
});
