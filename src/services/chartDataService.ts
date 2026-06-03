/**
 * チャートデータサービス
 *
 * チャートのローソク足取得を一元化する。データソース優先順位:
 *   1. EODHD (主データソース、`EODHDChartDataProvider`)
 *   2. LocalCandleStore (OHLCVCandle テーブル) … EODHD 障害時のフォールバック
 *
 * 重要な設計原則:
 * - **cTrader には一切依存しない**。cTrader 接続が落ちてもローソ足は表示できる。
 * - エラーは種別ごとに区別して投げ、route 層が HTTP ステータスを適切に分ける:
 *     symbol 不正 → invalid_symbol (404)
 *     timeframe 不正 → invalid_timeframe (400)
 *     外部障害かつキャッシュ無し → upstream_unavailable (503)
 *     symbol 有効だがデータ無し → エラーにせず 200 + 空 candles + warning
 */

import { TimeframeSchema, type Timeframe } from '../infrastructure/market/IMarketDataProvider';
import {
  type ChartCandle,
  type ChartCandlesResponse,
  type ChartDataProvider,
  ChartDataError,
  type GetCandlesParams,
} from '../infrastructure/market/chart-data.types';
import { EODHDChartDataProvider } from '../infrastructure/market/EODHDChartDataProvider';
import { normalizeCTraderSymbol, toTwelveDataSymbol } from '../utils/symbolNormalization';
import { ohlcvRepository } from '../backend/repositories/ohlcvRepository';

/** LocalCandleStore: ローカル保存済み OHLCV の読み出し抽象 (将来の保存経路と分離) */
export interface LocalCandleStore {
  getCandles(symbol: string, timeframe: string, limit: number): Promise<ChartCandle[]>;
}

/** デフォルト取得本数 (route の limit 未指定時) */
const DEFAULT_LIMIT = 500;

const NO_DATA_WARNING =
  'このシンボル・時間足の OHLCV データがまだありません。データ取得後に表示されます。';
const LOCAL_FALLBACK_WARNING =
  'EODHD から取得できなかったため、ローカルキャッシュのローソク足を表示しています。';

/**
 * OHLCVCandle テーブルを用いた LocalCandleStore 実装。
 *
 * OHLCVCandle の symbol 保存形式は ingest 経路により 'XAUUSD' / 'XAU/USD' が混在しうるため、
 * 正規化形 (XAUUSD) とスラッシュ形 (XAU/USD) の両候補で検索し、最初にヒットした集合を返す。
 */
class OhlcvRepositoryCandleStore implements LocalCandleStore {
  async getCandles(symbol: string, timeframe: string, limit: number): Promise<ChartCandle[]> {
    const candidates = this.symbolCandidates(symbol);
    for (const candidate of candidates) {
      const rows = await ohlcvRepository.findMany({
        symbol: candidate,
        timeframe,
        limit,
        orderBy: 'desc',
      });
      if (rows.length > 0) {
        // desc で取得したので時系列昇順に戻す
        return rows
          .map((row) => ({
            time: Math.floor(row.timestamp.getTime() / 1000),
            open: Number(row.open),
            high: Number(row.high),
            low: Number(row.low),
            close: Number(row.close),
            volume: Number(row.volume),
          }))
          .sort((a, b) => a.time - b.time);
      }
    }
    return [];
  }

  private symbolCandidates(symbol: string): string[] {
    const normalized = normalizeCTraderSymbol(symbol); // XAUUSD
    const slashed = toTwelveDataSymbol(symbol); // XAU/USD
    // 重複排除しつつ、呼び出し元が渡した raw も候補に含める
    return Array.from(new Set([normalized, slashed, symbol.trim()]));
  }
}

export interface ChartDataServiceDeps {
  /** チャート OHLCV の主プロバイダー (省略時 EODHD) */
  chartProvider?: ChartDataProvider;
  /** フォールバック用ローカルストア (省略時 OHLCVCandle テーブル) */
  localStore?: LocalCandleStore;
}

export class ChartDataService {
  private readonly chartProvider: ChartDataProvider;
  private readonly localStore: LocalCandleStore;

  constructor(deps: ChartDataServiceDeps = {}) {
    this.chartProvider = deps.chartProvider ?? new EODHDChartDataProvider();
    this.localStore = deps.localStore ?? new OhlcvRepositoryCandleStore();
  }

  /**
   * チャート用ローソ足を取得する。
   *
   * @throws ChartDataError invalid_symbol / invalid_timeframe / upstream_unavailable
   */
  async getCandles(params: {
    symbol: string;
    timeframe: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<ChartCandlesResponse> {
    const timeframe = this.validateTimeframe(params.timeframe);
    const symbol = this.validateSymbol(params.symbol);
    const limit = params.limit ?? DEFAULT_LIMIT;

    const providerParams: GetCandlesParams = {
      symbol,
      timeframe,
      from: params.from,
      to: params.to,
      limit,
    };

    // 1. EODHD を主データソースとして試行
    let upstreamFailed = false;
    let upstreamDetail: string | undefined;
    try {
      const result = await this.chartProvider.getCandles(providerParams);
      if (result.candles.length > 0) {
        return result;
      }
      // EODHD は応答したがデータ 0 件 → ローカルフォールバックを試す
    } catch (error) {
      if (error instanceof ChartDataError && error.kind === 'upstream_unavailable') {
        upstreamFailed = true;
        upstreamDetail = error.detail;
      } else {
        // invalid_symbol / invalid_timeframe など想定済みエラーはそのまま伝播
        throw error;
      }
    }

    // 2. ローカルキャッシュ (OHLCVCandle) フォールバック
    const localCandles = await this.localStore.getCandles(symbol, timeframe, limit);
    if (localCandles.length > 0) {
      return {
        candles: localCandles,
        meta: {
          source: 'local',
          provider: 'LocalCandleStore',
          priceBasis: 'unknown',
          symbol,
          timeframe,
          isRealtime: false,
          delayMs: null,
          generatedAt: new Date().toISOString(),
        },
        warning: LOCAL_FALLBACK_WARNING,
      };
    }

    // 3. ローカルにも無い場合
    if (upstreamFailed) {
      // 外部障害かつキャッシュ無し → 503 相当
      throw new ChartDataError(
        'upstream_unavailable',
        'チャートデータの外部プロバイダーに接続できず、キャッシュもありません',
        upstreamDetail,
      );
    }

    // symbol は有効だがデータが無いだけ → 200 + 空 candles + warning
    return {
      candles: [],
      meta: {
        source: 'EODHD',
        provider: this.chartProvider.name,
        priceBasis: 'unknown',
        symbol,
        timeframe,
        isRealtime: false,
        delayMs: null,
        generatedAt: new Date().toISOString(),
      },
      warning: NO_DATA_WARNING,
    };
  }

  /** 時間足を検証し内部 Timeframe に narrow する */
  private validateTimeframe(timeframe: string): Timeframe {
    const parsed = TimeframeSchema.safeParse(timeframe);
    if (!parsed.success) {
      throw new ChartDataError(
        'invalid_timeframe',
        `未対応の時間足です: ${timeframe}`,
      );
    }
    return parsed.data;
  }

  /** シンボルを検証する (正規化して英数字 3 文字以上であること) */
  private validateSymbol(symbol: string): string {
    const trimmed = (symbol ?? '').trim();
    const normalized = normalizeCTraderSymbol(trimmed);
    if (normalized.length < 3) {
      throw new ChartDataError('invalid_symbol', `未対応のシンボルです: ${symbol}`);
    }
    // 内部では正規化形 (例 'XAUUSD') を主に扱う (Provider 側で各 API 形式へ変換)
    return normalized;
  }
}

/** アプリ共通インスタンス */
export const chartDataService = new ChartDataService();
