/**
 * POST /api/chart/indicator-series のリクエスト body スキーマ契約テスト。
 *
 * このルートは analysis-engine への薄いプロキシで、ロジックの実体は body バリデーション。
 * フロント (例: /strategies/new プレビュー) からの入力契約を本テストで固定する。
 */

import { ChartIndicatorSeriesRequestSchema } from '../../schemas/api/chart';

const VALID_BASE = {
  symbol: 'USDJPY',
  timeframe: '1h',
  startDate: '2026-01-01T00:00:00.000Z',
  endDate: '2026-02-01T00:00:00.000Z',
};

describe('ChartIndicatorSeriesRequestSchema', () => {
  it('indicators / patterns を省略すると空配列が既定で埋まる', () => {
    const parsed = ChartIndicatorSeriesRequestSchema.parse(VALID_BASE);
    expect(parsed.indicators).toEqual([]);
    expect(parsed.patterns).toEqual([]);
  });

  it('指標 spec の params を省略すると空オブジェクトが埋まる (cacheKey 互換)', () => {
    const parsed = ChartIndicatorSeriesRequestSchema.parse({
      ...VALID_BASE,
      indicators: [{ indicatorId: 'rsi', field: 'value' }],
    });
    expect(parsed.indicators[0]).toEqual({ indicatorId: 'rsi', params: {}, field: 'value' });
  });

  it('正常な指標 + パターンを parse できる', () => {
    const parsed = ChartIndicatorSeriesRequestSchema.parse({
      ...VALID_BASE,
      indicators: [
        { indicatorId: 'rsi', params: { period: 14 }, field: 'value' },
        { indicatorId: 'macd', params: { fast: 12, slow: 26, signal: 9 }, field: 'histogram' },
      ],
      patterns: ['hammer', 'engulfing_bull'],
    });
    expect(parsed.indicators).toHaveLength(2);
    expect(parsed.patterns).toEqual(['hammer', 'engulfing_bull']);
  });

  it('startDate が endDate より後なら reject する', () => {
    const result = ChartIndicatorSeriesRequestSchema.safeParse({
      ...VALID_BASE,
      startDate: '2026-03-01T00:00:00.000Z',
      endDate: '2026-02-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('symbol / timeframe が空文字なら reject する', () => {
    expect(
      ChartIndicatorSeriesRequestSchema.safeParse({ ...VALID_BASE, symbol: '' }).success,
    ).toBe(false);
    expect(
      ChartIndicatorSeriesRequestSchema.safeParse({ ...VALID_BASE, timeframe: '' }).success,
    ).toBe(false);
  });

  it('日時が ISO8601 でないなら reject する', () => {
    const result = ChartIndicatorSeriesRequestSchema.safeParse({
      ...VALID_BASE,
      startDate: '2026-01-01',
    });
    expect(result.success).toBe(false);
  });

  it('未知のパターン ID は reject する', () => {
    const result = ChartIndicatorSeriesRequestSchema.safeParse({
      ...VALID_BASE,
      patterns: ['not_a_pattern'],
    });
    expect(result.success).toBe(false);
  });

  it('指標数が上限 (64) を超えると reject する (過負荷ガード)', () => {
    const tooMany = Array.from({ length: 65 }, (_, i) => ({
      indicatorId: 'sma',
      params: { period: i + 1 },
      field: 'value',
    }));
    const result = ChartIndicatorSeriesRequestSchema.safeParse({
      ...VALID_BASE,
      indicators: tooMany,
    });
    expect(result.success).toBe(false);
  });
});
