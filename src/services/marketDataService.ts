import type { MarketData } from '../models/types';
import { config } from '../config';
import type { OHLCVData} from './indicators';
import { indicatorService } from './indicators';
import type { OHLCVBarResult } from '../backend/services/ctrader/ctraderDataService';
import { CTraderDataService } from '../backend/services/ctrader/ctraderDataService';
import { CTraderAuthService } from '../backend/services/ctrader/ctraderAuthService';
import { prisma } from '../backend/db/client';

/**
 * 市場データサービス
 *
 * 目的: **cTrader Open API** を用いてブローカーと同一の価格・足区切りでデータを取得する。
 *（Twelve Data へのフォールバックは廃止: 正は cTrader に統一）
 *
 * 制約: OAuth 済み cTrader 口座が未設定の環境では履歴・現在値は取得できない。
 */

/**
 * 市場データサービスクラス
 */
export class MarketDataService {
  private apiUrl: string;
  private apiKey: string;
  private ctraderDataService: CTraderDataService | null = null;
  private ctraderAccountId: string | null = null;
  private ctraderConfigPromise: Promise<void> | null = null;

  constructor() {
    this.apiUrl = config.market.apiUrl;
    this.apiKey = config.market.apiKey;
  }

  /**
   * cTrader データソースを設定
   * 設定済みの場合、FX/CFDデータ取得時にcTraderを優先使用
   *
   * @param accountId - cTrader アカウントID
   * @param authService - 認証サービス
   */
  configureCTrader(accountId: string, authService: CTraderAuthService): void {
    this.ctraderDataService = new CTraderDataService(authService);
    this.ctraderAccountId = accountId;
    console.log('[MarketDataService] cTrader データソース設定完了');
  }

  /**
   * cTrader 利用可能か確認
   */
  isCTraderAvailable(): boolean {
    return !!(this.ctraderDataService?.isConfigured() && this.ctraderAccountId);
  }

  /**
   * cTrader 自己配線 (DB 永続化 token から有効アカウントを取得して configure)
   *
   * MarketDataService は callsite ごとに new されており、起動時の一括 configure
   * 経路が存在しない。各 instance が初回データ取得時に DB から token を読んで
   * 自分で配線する遅延初期化。
   *
   * Promise キャッシュは「同 instance 内の並列リクエストが二重 DB ヒットしないため」
   * に使う。試行後 isCTraderAvailable() が false (token 未登録 / 取得失敗) のときは
   * キャッシュをクリアして、次回呼び出し時に再試行できるようにする。これにより、
   * サーバー起動後に OAuth 接続が完了/更新された場合でも自動的に拾える。
   */
  async ensureCTraderConfigured(): Promise<void> {
    if (this.isCTraderAvailable()) return;
    if (this.ctraderConfigPromise) return this.ctraderConfigPromise;

    this.ctraderConfigPromise = (async () => {
      try {
        const authService = new CTraderAuthService(prisma);
        const token = await authService.getValidToken();
        if (token) {
          this.configureCTrader(token.accountId, authService);
        }
      } catch (error) {
        console.warn('[MarketDataService] cTrader 自動配線エラー:', error);
      } finally {
        // 試行後も未配線なら次回再試行できるようにキャッシュを破棄する
        if (!this.isCTraderAvailable()) {
          this.ctraderConfigPromise = null;
        }
      }
    })();
    return this.ctraderConfigPromise;
  }

  /**
   * cTrader OHLCVBarResult[] → MarketData[] 変換
   */
  private convertCTraderBars(bars: OHLCVBarResult[], symbol: string, timeframe: string): MarketData[] {
    return bars.map(b => ({
      symbol,
      timestamp: b.timestamp,
      timeframe,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
  }

  /**
   * 旧 Twelve Data 用。互換のため残す（新規利用は cTrader 前提）
   */
  isApiConfigured(): boolean {
    return !!(this.apiUrl && this.apiKey);
  }

  /**
   * 現在の市場データを取得
   * 
   * @param symbol - 銘柄シンボル（例: 'BTC/USD', 'EUR/USD'）
   * @param timeframe - 時間足（例: '15m', '1h'）
   * @returns 市場データ
   * 
   * エラーハンドリング:
   * - API 未設定: エラーを投げる
   * - API エラー: エラーを投げる
   */
  async getCurrentMarketData(
    symbol: string,
    timeframe: string = '15m'
  ): Promise<MarketData> {
    await this.ensureCTraderConfigured();
    // 1. cTrader 利用可能なら優先
    if (this.isCTraderAvailable()) {
      try {
        console.log(`[MarketDataService] cTrader優先: ${symbol} ${timeframe} ×1`);
        const bars = await this.ctraderDataService!.fetchTrendbars(
          this.ctraderAccountId!,
          symbol,
          timeframe,
          1,
        );
        if (bars.length > 0) {
          const marketData = this.convertCTraderBars(bars, symbol, timeframe)[0];
          this.calculateIndicators(marketData);
          return marketData;
        }
        console.warn(`[MarketDataService] cTrader から空データ: ${symbol} ${timeframe}`);
      } catch (error) {
        console.warn(`[MarketDataService] cTrader 取得エラー:`, error);
      }
    }

    throw new Error(
      'cTrader 接続（OAuth 済み口座）が必要です。価格・足区切りは cTrader のみ使用します。'
    );
  }

  /**
   * 複数ローソク足の市場インジケーターを計算
   * 
   * @param marketData - 市場データ
   * @param historicalData - 計算に使用する履歴データ（オプション）
   * 
   * 注意: 
   * - 履歴データがある場合は実際のインジケーター値を計算
   * - 履歴データがない場合は簡易トレンド判定のみ
   */
  calculateIndicators(marketData: MarketData, historicalData?: OHLCVData[]): void {
    // 履歴データがない場合は簡易判定のみ
    if (!historicalData || historicalData.length < 2) {
      marketData.indicators = {
        rsi: 50, // データ不足時は中立値
        macd: 0, // データ不足時はゼロ
        trend: this.determineTrend(marketData),
      };
      return;
    }

    // 履歴データから終値を抽出
    const closes = historicalData.map(d => d.close);

    // RSI 計算（期間: 14）
    let rsi = 50; // デフォルト値
    if (closes.length >= 15) {
      const rsiValues = indicatorService.calculateRSI(closes, 14);
      if (rsiValues.length > 0) {
        rsi = rsiValues[rsiValues.length - 1];
        // NaN チェック
        if (isNaN(rsi)) rsi = 50;
      }
    }

    // MACD 計算（12, 26, 9）
    let macdValue = 0; // デフォルト値
    if (closes.length >= 27) {
      const macdResult = indicatorService.calculateMACD(closes, 12, 26, 9);
      if (macdResult.histogram.length > 0) {
        macdValue = macdResult.histogram[macdResult.histogram.length - 1];
        // NaN チェック
        if (isNaN(macdValue)) macdValue = 0;
      }
    }

    // トレンド判定（RSI と価格変動から）
    let trend: 'bullish' | 'bearish' | 'neutral';
    if (rsi > 60) {
      trend = 'bullish';
    } else if (rsi < 40) {
      trend = 'bearish';
    } else {
      // RSI が中間の場合は価格変動で判定
      trend = this.determineTrend(marketData);
    }

    marketData.indicators = {
      rsi,
      macd: macdValue,
      trend,
    };
  }

  /**
   * 履歴データを含めた市場データを取得（インジケーター計算付き）
   * 
   * @param symbol - 銘柄シンボル
   * @param timeframe - 時間足
   * @returns インジケーターが計算された市場データ
   */
  async getCurrentMarketDataWithIndicators(
    symbol: string,
    timeframe: string = '15m'
  ): Promise<MarketData> {
    // 履歴データを取得（インジケーター計算に必要な本数）
    const historicalData = await this.getHistoricalData(symbol, timeframe, 50);

    if (historicalData.length === 0) {
      throw new Error(`${symbol} の履歴データを取得できませんでした。`);
    }

    // 最新のデータを MarketData 形式に変換
    const latest = historicalData[historicalData.length - 1];
    const marketData: MarketData = {
      symbol,
      timestamp: latest.timestamp,
      timeframe,
      open: latest.open,
      high: latest.high,
      low: latest.low,
      close: latest.close,
      volume: latest.volume,
    };

    // OHLCV データに変換
    const ohlcvData: OHLCVData[] = historicalData.map(d => ({
      timestamp: d.timestamp,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));

    // インジケーターを計算
    this.calculateIndicators(marketData, ohlcvData);

    return marketData;
  }

  /**
   * 市場トレンドを判定
   * 
   * @param marketData - 市場データ
   * @returns トレンド方向
   */
  private determineTrend(marketData: MarketData): 'bullish' | 'bearish' | 'neutral' {
    const priceChange = marketData.close - marketData.open;
    const changePercent = (priceChange / marketData.open) * 100;

    if (changePercent > 0.5) return 'bullish';
    if (changePercent < -0.5) return 'bearish';
    return 'neutral';
  }

  /**
   * 履歴市場データを取得
   * 
   * @param symbol - 銘柄シンボル
   * @param timeframe - 時間足
   * @param limit - 取得件数（デフォルト: 100）
   * @returns 市場データ配列（時系列順）
   */
  async getHistoricalData(
    symbol: string,
    timeframe: string,
    limit: number = 100
  ): Promise<MarketData[]> {
    await this.ensureCTraderConfigured();
    // 1. cTrader 利用可能なら優先
    if (this.isCTraderAvailable()) {
      try {
        console.log(`[MarketDataService] cTrader優先: ${symbol} ${timeframe} ×${limit}`);
        const bars = await this.ctraderDataService!.fetchTrendbars(
          this.ctraderAccountId!,
          symbol,
          timeframe,
          limit,
        );
        if (bars.length > 0) {
          return this.convertCTraderBars(bars, symbol, timeframe);
        }
        console.warn(`[MarketDataService] cTrader から空データ: ${symbol} ${timeframe}`);
        return [];
      } catch (error) {
        console.warn(`[MarketDataService] cTrader 履歴エラー:`, error);
        return [];
      }
    }

    console.warn(
      '[MarketDataService] cTrader 未設定のため履歴を返しません（cTrader OAuth で接続してください）',
    );
    return [];
  }

  /**
   * 利用可能な銘柄リストを取得
   * 
   * @returns 銘柄リスト
   */
  async getAvailableSymbols(): Promise<string[]> {
    // 主要な銘柄を返す（将来的にはAPIから取得）
    return [
      'BTC/USD',
      'ETH/USD',
      'EUR/USD',
      'GBP/USD',
      'USD/JPY',
      'AAPL',
      'GOOGL',
      'MSFT',
      'AMZN',
    ];
  }

  /**
   * 直近の1分足OHLCVデータを取得
   * 
   * 目的: Side-B の1時間ごと検証で使用
   * 1時間に1回、直近60本（=1時間分）の1分足を取得して
   * 高安値ベースでエントリー/決済判定を行う
   * 
   * @param symbol - 銘柄シンボル（例: 'XAU/USD', 'EUR/USD'）
   * @param count - 取得する本数（デフォルト: 60 = 1時間分）
   * @returns 1分足OHLCVデータ配列（時系列順: 古い → 新しい）
   * 
   */
  async getRecentMinuteOHLCV(
    symbol: string,
    count: number = 60
  ): Promise<MarketData[]> {
    await this.ensureCTraderConfigured();
    if (this.isCTraderAvailable()) {
      try {
        console.log(`[MarketDataService] cTrader 1分足取得: ${symbol} × ${count}本`);
        const bars = await this.ctraderDataService!.fetchTrendbars(
          this.ctraderAccountId!,
          symbol,
          '1m',
          count,
        );
        if (bars.length > 0) {
          return this.convertCTraderBars(bars, symbol, '1m');
        }
        console.warn(`[MarketDataService] cTrader 1分足が空: ${symbol}`);
      } catch (error) {
        console.warn(`[MarketDataService] cTrader 1分足エラー:`, error);
      }
    }

    throw new Error(
      'cTrader 接続（OAuth 済み口座）が必要です。1分足は cTrader のみ使用します。'
    );
  }
}
