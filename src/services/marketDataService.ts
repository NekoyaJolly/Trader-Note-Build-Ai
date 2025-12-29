import { MarketData } from '../models/types';
import { config } from '../config';

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
      // Twelve Data API で直近のローソク足を取得
      const interval = this.convertTimeframe(timeframe);
      const url = `${this.apiUrl}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=1&apikey=${this.apiKey}`;
      
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
   * 
   * 注意: 単一バーからの簡易計算のため精度は低い
   * 本格的な計算は indicatorService を使用すること
   */
  calculateIndicators(marketData: MarketData): void {
    // 単一バーからの簡易トレンド判定
    marketData.indicators = {
      rsi: 50, // 単一バーでは計算不可、中立値をセット
      macd: 0, // 単一バーでは計算不可
      trend: this.determineTrend(marketData),
    };
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
    // シンボルに応じたベース価格を設定
    const basePrices: Record<string, number> = {
      'BTC/USD': 50000,
      'ETH/USD': 3000,
      'EUR/USD': 1.08,
      'USD/JPY': 150,
      'AAPL': 180,
      'GOOGL': 140,
    };
    
    const basePrice = basePrices[symbol] || 100;
    const variance = basePrice * 0.02; // 2% 変動幅
    
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
      const interval = this.convertTimeframe(timeframe);
      const url = `${this.apiUrl}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${limit}&apikey=${this.apiKey}`;
      
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
}
