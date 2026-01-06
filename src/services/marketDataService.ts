import { MarketData } from '../models/types';
import { config } from '../config';
import { indicatorService, OHLCVData, FeatureSnapshot } from './indicators';

/**
 * 市場データサービス
 * 
 * 目的: Twelve Data API を使用してリアルタイム市場データを取得
 * 
 * 対応時間足: 1min, 5min, 15min, 30min, 1h, 4h, 1day
 * 
 * 制約:
 * - API レート制限を考慮（無料プランは8回/分）
 * - エラー時はシミュレーションデータにフォールバック
 * 
 * インジケーター計算:
 * - 単一バーではなく履歴データを取得して計算
 * - indicatorService を使用して実際の値を計算
 */

/**
 * Twelve Data API レスポンス型
 */
interface TwelveDataQuoteResponse {
  symbol: string;
  name?: string;
  exchange?: string;
  datetime: string;
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  previous_close?: string;
  change?: string;
  percent_change?: string;
  is_market_open?: boolean;
  status?: string;
  code?: number;
  message?: string;
}

/**
 * Twelve Data 時系列レスポンス型
 */
interface TwelveDataTimeSeriesResponse {
  meta?: {
    symbol: string;
    interval: string;
    currency?: string;
    exchange?: string;
    type?: string;
  };
  values?: Array<{
    datetime: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
  }>;
  status?: string;
  code?: number;
  message?: string;
}

/**
 * 市場データサービスクラス
 */
export class MarketDataService {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = config.market.apiUrl;
    this.apiKey = config.market.apiKey;
  }

  /**
   * シンボルを Twelve Data 形式に変換
   * 
   * 例:
   * - BTCUSDT → BTC/USD
   * - ETHUSDT → ETH/USD
   * - XAUUSD → XAU/USD
   * - EUR/USD → EUR/USD（そのまま）
   * 
   * @param symbol - 入力シンボル
   * @returns Twelve Data 形式のシンボル
   */
  private normalizeSymbolForTwelveData(symbol: string): string {
    // すでに / が含まれている場合はそのまま返す
    if (symbol.includes('/')) {
      return symbol;
    }

    // USDT ペアを USD に変換（例: BTCUSDT → BTC/USD）
    if (symbol.endsWith('USDT')) {
      const base = symbol.slice(0, -4);
      return `${base}/USD`;
    }

    // USD ペアに / を挿入（例: XAUUSD → XAU/USD, EURUSD → EUR/USD）
    if (symbol.endsWith('USD')) {
      const base = symbol.slice(0, -3);
      return `${base}/USD`;
    }

    // JPY ペアに / を挿入（例: USDJPY → USD/JPY）
    if (symbol.endsWith('JPY')) {
      const base = symbol.slice(0, -3);
      return `${base}/JPY`;
    }

    // その他はそのまま返す（株式シンボルなど）
    return symbol;
  }

  /**
   * API が設定されているか確認
   */
  isApiConfigured(): boolean {
    return !!(this.apiUrl && this.apiKey);
  }

  /**
   * 時間足を Twelve Data フォーマットに変換
   * 
   * @param timeframe - 内部時間足形式（例: '15m', '1h'）
   * @returns Twelve Data API 形式（例: '15min', '1h'）
   */
  private convertTimeframe(timeframe: string): string {
    const mapping: Record<string, string> = {
      '1m': '1min',
      '5m': '5min',
      '15m': '15min',
      '30m': '30min',
      '1h': '1h',
      '4h': '4h',
      '1d': '1day',
      '1w': '1week',
    };
    return mapping[timeframe] || '15min';
  }

  /**
   * 現在の市場データを取得
   * 
   * @param symbol - 銘柄シンボル（例: 'BTC/USD', 'EUR/USD'）
   * @param timeframe - 時間足（例: '15m', '1h'）
   * @returns 市場データ
   * 
   * エラーハンドリング:
   * - API 未設定: シミュレーションデータを返す
   * - API エラー: シミュレーションデータにフォールバック
   */
  async getCurrentMarketData(
    symbol: string,
    timeframe: string = '15m'
  ): Promise<MarketData> {
    // API が設定されていない場合はシミュレーションデータを返す
    if (!this.isApiConfigured()) {
      console.warn('市場 API が設定されていません。シミュレーションデータを使用します。');
      return this.generateSimulatedData(symbol, timeframe);
    }

    try {
      // シンボルを Twelve Data 形式に変換（例: ETHUSDT → ETH/USD）
      const normalizedSymbol = this.normalizeSymbolForTwelveData(symbol);
      
      // Twelve Data API で直近のローソク足を取得
      const interval = this.convertTimeframe(timeframe);
      const url = `${this.apiUrl}/time_series?symbol=${encodeURIComponent(normalizedSymbol)}&interval=${interval}&outputsize=1&apikey=${this.apiKey}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`API レスポンスエラー: ${response.status}`);
      }
      
      const data = (await response.json()) as TwelveDataTimeSeriesResponse;
      
      // API エラーチェック
      if (data.status === 'error' || data.code) {
        throw new Error(data.message || 'Twelve Data API エラー');
      }
      
      // 値が取得できない場合はフォールバック
      if (!data.values || data.values.length === 0) {
        console.warn(`${symbol} のデータが取得できません。シミュレーションデータを使用します。`);
        return this.generateSimulatedData(symbol, timeframe);
      }
      
      const latestBar = data.values[0];
      
      const marketData: MarketData = {
        symbol: data.meta?.symbol || symbol,
        timestamp: new Date(latestBar.datetime),
        timeframe,
        open: parseFloat(latestBar.open),
        high: parseFloat(latestBar.high),
        low: parseFloat(latestBar.low),
        close: parseFloat(latestBar.close),
        volume: parseFloat(latestBar.volume) || 0,
      };

      // インジケーターを計算
      this.calculateIndicators(marketData);
      
      return marketData;
    } catch (error) {
      console.error('市場データ取得エラー:', error);
      // エラー時はシミュレーションデータにフォールバック
      return this.generateSimulatedData(symbol, timeframe);
    }
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
    let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
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
      return this.generateSimulatedData(symbol, timeframe);
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
   * テスト用シミュレーションデータを生成
   * 
   * @param symbol - 銘柄シンボル
   * @param timeframe - 時間足
   * @returns シミュレートされた市場データ
   */
  private generateSimulatedData(symbol: string, timeframe: string): MarketData {
    // シンボルに応じたベース価格を設定（2026年1月時点の実勢レート）
    // ※金(XAU/USD)は2024-2025年の上昇で4300ドル台に達している
    const basePrices: Record<string, number> = {
      'BTC/USD': 95000,   // ビットコイン
      'ETH/USD': 3400,    // イーサリアム
      'EUR/USD': 1.03,    // ユーロドル
      'USD/JPY': 157,     // ドル円
      'GBP/USD': 1.24,    // ポンドドル
      'XAU/USD': 4325,    // ゴールド（2026年1月実勢：金価格上昇後）
      'AAPL': 240,        // Apple
      'GOOGL': 195,       // Google
    };
    
    const basePrice = basePrices[symbol] || 100;
    const variance = basePrice * 0.002; // 0.2% 変動幅（テスト用に狭く）
    
    const open = basePrice + (Math.random() - 0.5) * variance;
    const close = open + (Math.random() - 0.5) * variance;
    const high = Math.max(open, close) + Math.random() * variance * 0.5;
    const low = Math.min(open, close) - Math.random() * variance * 0.5;
    const volume = Math.random() * 1000000;

    const data: MarketData = {
      symbol,
      timestamp: new Date(),
      timeframe,
      open,
      high,
      low,
      close,
      volume,
    };

    this.calculateIndicators(data);
    return data;
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
    // API が設定されていない場合はシミュレーションデータを返す
    if (!this.isApiConfigured()) {
      return this.generateHistoricalSimulatedData(symbol, timeframe, limit);
    }

    try {
      // シンボルを Twelve Data 形式に変換（例: ETHUSDT → ETH/USD）
      const normalizedSymbol = this.normalizeSymbolForTwelveData(symbol);
      
      const interval = this.convertTimeframe(timeframe);
      const url = `${this.apiUrl}/time_series?symbol=${encodeURIComponent(normalizedSymbol)}&interval=${interval}&outputsize=${limit}&apikey=${this.apiKey}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`API レスポンスエラー: ${response.status}`);
      }
      
      const data = (await response.json()) as TwelveDataTimeSeriesResponse;
      
      // API エラーチェック
      if (data.status === 'error' || data.code) {
        throw new Error(data.message || 'Twelve Data API エラー');
      }
      
      if (!data.values || data.values.length === 0) {
        console.warn(`${symbol} の履歴データが取得できません。シミュレーションデータを使用します。`);
        return this.generateHistoricalSimulatedData(symbol, timeframe, limit);
      }
      
      // API レスポンスを MarketData 形式に変換（時系列順に並べ替え）
      const marketDataArray: MarketData[] = data.values.map(bar => {
        const marketData: MarketData = {
          symbol: data.meta?.symbol || symbol,
          timestamp: new Date(bar.datetime),
          timeframe,
          open: parseFloat(bar.open),
          high: parseFloat(bar.high),
          low: parseFloat(bar.low),
          close: parseFloat(bar.close),
          volume: parseFloat(bar.volume) || 0,
        };
        return marketData;
      }).reverse(); // 古い順に並べ替え
      
      return marketDataArray;
    } catch (error) {
      console.error('履歴データ取得エラー:', error);
      return this.generateHistoricalSimulatedData(symbol, timeframe, limit);
    }
  }

  /**
   * 履歴シミュレーションデータを生成
   * 
   * @param symbol - 銘柄シンボル
   * @param timeframe - 時間足
   * @param limit - 生成件数
   * @returns シミュレートされた市場データ配列
   */
  private generateHistoricalSimulatedData(
    symbol: string,
    timeframe: string,
    limit: number
  ): MarketData[] {
    const data: MarketData[] = [];
    
    // 時間足に応じた間隔（ミリ秒）
    const intervalMs: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };
    
    const interval = intervalMs[timeframe] || 15 * 60 * 1000;
    
    for (let i = limit - 1; i >= 0; i--) {
      const marketData = this.generateSimulatedData(symbol, timeframe);
      marketData.timestamp = new Date(Date.now() - i * interval);
      data.push(marketData);
    }
    
    return data;
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
   * API コスト:
   * - Twelve Data 無料プラン: 800回/日, 8回/分
   * - 1コール = 1ペアの60本 → 30ペアまで無料運用可能
   */
  async getRecentMinuteOHLCV(
    symbol: string,
    count: number = 60
  ): Promise<MarketData[]> {
    // API が設定されていない場合はシミュレーションデータを返す
    if (!this.isApiConfigured()) {
      console.warn('市場 API が設定されていません。シミュレーションデータを使用します。');
      return this.generateHistoricalSimulatedData(symbol, '1m', count);
    }

    try {
      // 1分足を指定本数取得
      const url = `${this.apiUrl}/time_series?symbol=${encodeURIComponent(symbol)}&interval=1min&outputsize=${count}&apikey=${this.apiKey}`;
      
      console.log(`[MarketDataService] 1分足取得: ${symbol} × ${count}本`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`API レスポンスエラー: ${response.status}`);
      }
      
      const data = (await response.json()) as TwelveDataTimeSeriesResponse;
      
      // API エラーチェック
      if (data.status === 'error' || data.code) {
        throw new Error(data.message || 'Twelve Data API エラー');
      }
      
      if (!data.values || data.values.length === 0) {
        console.warn(`${symbol} の1分足データが取得できません。シミュレーションデータを使用します。`);
        return this.generateHistoricalSimulatedData(symbol, '1m', count);
      }

      console.log(`[MarketDataService] 取得成功: ${data.values.length}本`);
      
      // API レスポンスを MarketData 形式に変換（時系列順に並べ替え: 古い → 新しい）
      const marketDataArray: MarketData[] = data.values.map(bar => {
        const marketData: MarketData = {
          symbol: data.meta?.symbol || symbol,
          timestamp: new Date(bar.datetime),
          timeframe: '1m',
          open: parseFloat(bar.open),
          high: parseFloat(bar.high),
          low: parseFloat(bar.low),
          close: parseFloat(bar.close),
          volume: parseFloat(bar.volume) || 0,
        };
        return marketData;
      }).reverse(); // 古い順に並べ替え
      
      return marketDataArray;
    } catch (error) {
      console.error('1分足データ取得エラー:', error);
      return this.generateHistoricalSimulatedData(symbol, '1m', count);
    }
  }
}
