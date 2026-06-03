/**
 * EODHD チャート OHLCV プロバイダー
 *
 * チャートのローソく足の主データソース。既存の `EodhdProvider`
 * (intraday / eod REST + クライアント側集約) を再利用し、ChartDataProvider
 * インターフェースに適合させる薄いアダプタ。
 *
 * 設計方針:
 * - cTrader には一切依存しない (チャートが cTrader 障害に巻き込まれないため)。
 * - EODHD は数十秒〜1分程度の遅延がありうるため、meta.isRealtime=false /
 *   delayMs を付与し、warning でリアルタイムでない可能性を明示する。
 * - EODHD の OHLCV は bid/ask/mid の基準が公開されないため priceBasis='unknown'。
 * - 上流障害は ChartDataError('upstream_unavailable') に正規化して投げ、
 *   route 層が 503 にマッピングできるようにする。
 */

import { EodhdProvider } from './EodhdProvider';
import type { OHLCVBar } from './IMarketDataProvider';
import {
  type ChartCandle,
  type ChartCandlesResponse,
  type ChartDataProvider,
  ChartDataError,
  type GetCandlesParams,
} from './chart-data.types';

/** EODHD の想定遅延 (ミリ秒)。intraday は概ね 1 分程度遅延しうる前提で扱う。 */
const EODHD_ASSUMED_DELAY_MS = 60_000;

/** limit 未指定時のデフォルト取得本数 */
const DEFAULT_LIMIT = 500;

const DELAY_WARNING = 'EODHDのOHLCVはリアルタイムではない可能性があります。';

export class EODHDChartDataProvider implements ChartDataProvider {
  readonly name = 'EODHD';

  private readonly provider: EodhdProvider;

  constructor(provider?: EodhdProvider) {
    // テスト時に mock 済み EodhdProvider を注入できるようにする
    this.provider = provider ?? new EodhdProvider();
  }

  async getCandles(params: GetCandlesParams): Promise<ChartCandlesResponse> {
    const { symbol, timeframe, from, to, limit } = params;

    let bars: OHLCVBar[];
    try {
      if (from && to) {
        // 期間指定 (バックテスト・ピン留め表示用)
        const result = await this.provider.getHistoricalRange(symbol, timeframe, from, to);
        bars = result.bars;
      } else {
        const result = await this.provider.getHistoricalData(
          symbol,
          timeframe,
          limit ?? DEFAULT_LIMIT,
        );
        bars = result.bars;
      }
    } catch (error) {
      // EODHD 未設定 / ネットワーク / 上流エラーは upstream_unavailable に正規化
      const detail = error instanceof Error ? error.message : String(error);
      throw new ChartDataError(
        'upstream_unavailable',
        'EODHD からチャートデータを取得できませんでした',
        detail,
      );
    }

    const candles = bars.map((bar) => this.toChartCandle(bar));

    return {
      candles,
      meta: {
        source: 'EODHD',
        provider: this.name,
        priceBasis: 'unknown',
        symbol,
        timeframe,
        isRealtime: false,
        delayMs: EODHD_ASSUMED_DELAY_MS,
        generatedAt: new Date().toISOString(),
      },
      // 空配列でも遅延注意は付けて返す (route 層が no_data 判定に使う)
      warning: DELAY_WARNING,
    };
  }

  /** OHLCVBar (timestamp: Date, ms) → ChartCandle (time: Unix 秒) */
  private toChartCandle(bar: OHLCVBar): ChartCandle {
    return {
      time: Math.floor(bar.timestamp.getTime() / 1000),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      // EODHD eod 等で volume が信用できない場合に備え、0 は維持しつつ NaN は null 化
      volume: Number.isFinite(bar.volume) ? bar.volume : null,
    };
  }
}
