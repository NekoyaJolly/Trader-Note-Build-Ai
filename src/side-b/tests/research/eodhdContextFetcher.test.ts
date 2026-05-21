/**
 * eodhdContextFetcher の単体テスト (Phase A A-6 / A-8、2026-05-21)
 *
 * SDK を直接モックして、Promise.allSettled の graceful パターンと
 * Fundamentals の対応シンボル判定をテスト。
 */

// eodhdResearchClient の各 fetch を jest.mock で差し替え
jest.mock('../../research/eodhdResearchClient', () => ({
  fetchNews: jest.fn(),
  fetchSentiments: jest.fn(),
  fetchEconomicEvents: jest.fn(),
  fetchMacroIndicator: jest.fn(),
  fetchFundamentals: jest.fn(),
}));

// config.eodhd.apiToken を制御可能にする
jest.mock('../../../config', () => ({
  config: {
    eodhd: { apiToken: 'test-token', baseUrl: 'https://eodhd.com/api' },
  },
}));

import { fetchEodhdContextsForResearch } from '../../research/eodhdContextFetcher';
import {
  fetchNews,
  fetchSentiments,
  fetchEconomicEvents,
  fetchMacroIndicator,
  fetchFundamentals,
} from '../../research/eodhdResearchClient';
import { config } from '../../../config';

const mockFetchNews = fetchNews as jest.Mock;
const mockFetchSentiments = fetchSentiments as jest.Mock;
const mockFetchEconomicEvents = fetchEconomicEvents as jest.Mock;
const mockFetchMacroIndicator = fetchMacroIndicator as jest.Mock;
const mockFetchFundamentals = fetchFundamentals as jest.Mock;

describe('fetchEodhdContextsForResearch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.eodhd.apiToken = 'test-token';
  });

  it('APIキー未設定なら全 context を空 (1 API call も発生させない)', async () => {
    config.eodhd.apiToken = '';
    const result = await fetchEodhdContextsForResearch('XAUUSD');
    expect(result).toEqual({});
    expect(mockFetchNews).not.toHaveBeenCalled();
    expect(mockFetchSentiments).not.toHaveBeenCalled();
    expect(mockFetchEconomicEvents).not.toHaveBeenCalled();
    expect(mockFetchMacroIndicator).not.toHaveBeenCalled();
    expect(mockFetchFundamentals).not.toHaveBeenCalled();
  });

  it('FX シンボル (XAUUSD) では Fundamentals をスキップ (API call 発生させない)', async () => {
    mockFetchNews.mockResolvedValue([]);
    mockFetchSentiments.mockResolvedValue({});
    mockFetchEconomicEvents.mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } });
    mockFetchMacroIndicator.mockResolvedValue([]);

    await fetchEodhdContextsForResearch('XAUUSD');

    expect(mockFetchFundamentals).not.toHaveBeenCalled();
    expect(mockFetchNews).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'XAUUSD.FOREX' }),
    );
  });

  it('株式系シンボル (AAPL.US) では Fundamentals も呼ぶ', async () => {
    mockFetchNews.mockResolvedValue([]);
    mockFetchSentiments.mockResolvedValue({});
    mockFetchEconomicEvents.mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } });
    mockFetchMacroIndicator.mockResolvedValue([]);
    mockFetchFundamentals.mockResolvedValue(null);

    await fetchEodhdContextsForResearch('AAPL.US');

    expect(mockFetchFundamentals).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'AAPL.US' }),
    );
  });

  it('News 取得失敗時は newsContext=undefined のまま他は埋まる (graceful)', async () => {
    mockFetchNews.mockRejectedValue(new Error('rate limit'));
    mockFetchSentiments.mockResolvedValue({
      'XAUUSD.FOREX': [{ date: '2026-05-20', count: 10, normalized: 0.5 }],
    });
    mockFetchEconomicEvents.mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } });
    mockFetchMacroIndicator.mockResolvedValue([]);

    const result = await fetchEodhdContextsForResearch('XAUUSD');

    expect(result.newsContext).toBeUndefined();
    expect(result.sentimentContext).toBeDefined();
    expect(result.sentimentContext?.points).toHaveLength(1);
  });

  it('全 API 失敗でも throw せず空 object に近い結果を返す', async () => {
    mockFetchNews.mockRejectedValue(new Error('e1'));
    mockFetchSentiments.mockRejectedValue(new Error('e2'));
    mockFetchEconomicEvents.mockRejectedValue(new Error('e3'));
    mockFetchMacroIndicator.mockRejectedValue(new Error('e4'));

    const result = await fetchEodhdContextsForResearch('XAUUSD');

    expect(result.newsContext).toBeUndefined();
    expect(result.sentimentContext).toBeUndefined();
    expect(result.economicEvents).toBeUndefined();
    expect(result.macroContext).toBeUndefined();
    expect(result.fundamentalsContext).toBeUndefined();
  });

  it('quote currency から国を推定: XAUUSD → US (Macro 取得)、EURJPY → JP', async () => {
    mockFetchNews.mockResolvedValue([]);
    mockFetchSentiments.mockResolvedValue({});
    mockFetchEconomicEvents.mockResolvedValue({ data: [], meta: { total: 0, limit: 0, offset: 0 } });
    mockFetchMacroIndicator.mockResolvedValue([]);

    await fetchEodhdContextsForResearch('XAUUSD');
    expect(mockFetchMacroIndicator).toHaveBeenLastCalledWith({ country: 'US' });

    await fetchEodhdContextsForResearch('EURJPY');
    expect(mockFetchMacroIndicator).toHaveBeenLastCalledWith({ country: 'JP' });
  });
});
