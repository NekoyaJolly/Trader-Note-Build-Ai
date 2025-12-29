/**
 * インジケーター計算サービス
 * 
 * 目的: indicatorts ライブラリを使用して各種テクニカル指標を計算する
 * 
 * 設計方針:
 * - indicatorts ライブラリのラッパーとして機能
 * - 基本インジケーター（RSI, SMA, EMA, MACD, BB）を統一インターフェースで提供
 * - 将来の拡張 API 対応を考慮した設計
 * 
 * 参照: 技術スタック選定シート ④
 */

import {
  rsi,
  sma,
  ema,
  macd,
  bb,
  atr,
  stochasticOscillator,
  obv,
  vwap,
} from 'indicatorts';

/**
 * OHLCV データの型定義
 * 時系列データの標準フォーマット
 */
export interface OHLCVData {
  /** タイムスタンプ（ISO形式またはUnixミリ秒） */
  timestamp: Date | number;
  /** 始値 */
  open: number;
  /** 高値 */
  high: number;
  /** 安値 */
  low: number;
  /** 終値 */
  close: number;
  /** 出来高 */
  volume: number;
}

/**
 * インジケーター計算結果の型定義
 */
export interface IndicatorResult {
  /** インジケーター名 */
  name: string;
  /** 計算値（単一または配列） */
  value: number | number[];
  /** 計算に使用した期間 */
  period?: number;
  /** 計算日時 */
  calculatedAt: Date;
}

/**
 * MACD 計算結果の型定義
 */
export interface MACDResult {
  /** MACD ライン */
  macdLine: number[];
  /** シグナルライン */
  signalLine: number[];
  /** ヒストグラム（macdLine - signalLine） */
  histogram: number[];
}

/**
 * ボリンジャーバンド計算結果の型定義
 */
export interface BollingerBandsResult {
  /** 上部バンド */
  upperBand: number[];
  /** 中央バンド（SMA） */
  middleBand: number[];
  /** 下部バンド */
  lowerBand: number[];
}

/**
 * ストキャスティクス計算結果の型定義
 */
export interface StochasticResult {
  /** %K ライン */
  k: number[];
  /** %D ライン */
  d: number[];
}

/**
 * ATR 計算結果の型定義
 */
export interface ATRResultType {
  /** True Range ライン */
  trLine: number[];
  /** ATR ライン */
  atrLine: number[];
}

/**
 * 特徴量スナップショットの型定義
 * トレードノート用の市場状態を表現
 */
export interface FeatureSnapshot {
  /** タイムスタンプ */
  timestamp: Date;
  /** 時間足 */
  timeframe: string;
  /** 終値 */
  close: number;
  /** 出来高 */
  volume: number;
  /** RSI 値 */
  rsi?: number;
  /** SMA 値 */
  sma?: number;
  /** EMA 値 */
  ema?: number;
  /** MACD 値 */
  macd?: MACDResult;
  /** ボリンジャーバンド */
  bollingerBands?: BollingerBandsResult;
  /** ATR 値 */
  atr?: number;
  /** ストキャスティクス */
  stochastic?: StochasticResult;
  /** OBV 値 */
  obv?: number;
}

/**
 * インジケーター計算サービス
 * 
 * indicatorts ライブラリのラッパーとして機能し、
 * 統一されたインターフェースでテクニカル指標を計算する
 */
export class IndicatorService {
  /**
   * RSI（相対力指数）を計算
   * 
   * @param closingPrices - 終値の配列
   * @param period - 計算期間（デフォルト: 14）
   * @returns RSI 値の配列
   * 
   * 使用例:
   * - RSI > 70: 買われすぎ
   * - RSI < 30: 売られすぎ
   */
  calculateRSI(closingPrices: number[], period: number = 14): number[] {
    if (closingPrices.length < period + 1) {
      console.warn(`RSI 計算には最低 ${period + 1} 個のデータが必要です`);
      return [];
    }
    
    return rsi(closingPrices, { period });
  }

  /**
   * SMA（単純移動平均）を計算
   * 
   * @param closingPrices - 終値の配列
   * @param period - 計算期間（デフォルト: 20）
   * @returns SMA 値の配列
   */
  calculateSMA(closingPrices: number[], period: number = 20): number[] {
    if (closingPrices.length < period) {
      console.warn(`SMA 計算には最低 ${period} 個のデータが必要です`);
      return [];
    }
    
    return sma(closingPrices, { period });
  }

  /**
   * EMA（指数移動平均）を計算
   * 
   * @param closingPrices - 終値の配列
   * @param period - 計算期間（デフォルト: 20）
   * @returns EMA 値の配列
   */
  calculateEMA(closingPrices: number[], period: number = 20): number[] {
    if (closingPrices.length < period) {
      console.warn(`EMA 計算には最低 ${period} 個のデータが必要です`);
      return [];
    }
    
    return ema(closingPrices, { period });
  }

  /**
   * MACD（移動平均収束拡散法）を計算
   * 
   * @param closingPrices - 終値の配列
   * @param fastPeriod - 短期EMA期間（デフォルト: 12）
   * @param slowPeriod - 長期EMA期間（デフォルト: 26）
   * @param signalPeriod - シグナル期間（デフォルト: 9）
   * @returns MACD 計算結果
   */
  calculateMACD(
    closingPrices: number[],
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9
  ): MACDResult {
    const minRequired = slowPeriod + signalPeriod;
    if (closingPrices.length < minRequired) {
      console.warn(`MACD 計算には最低 ${minRequired} 個のデータが必要です`);
      return { macdLine: [], signalLine: [], histogram: [] };
    }
    
    const result = macd(closingPrices, {
      fast: fastPeriod,
      slow: slowPeriod,
      signal: signalPeriod,
    });
    
    // ヒストグラムを計算（macdLine - signalLine）
    const histogram = result.macdLine.map((macdVal, i) => {
      const signalVal = result.signalLine[i];
      if (macdVal === undefined || signalVal === undefined) return 0;
      return macdVal - signalVal;
    });
    
    return {
      macdLine: result.macdLine,
      signalLine: result.signalLine,
      histogram,
    };
  }

  /**
   * ボリンジャーバンドを計算
   * 
   * @param closingPrices - 終値の配列
   * @param period - 計算期間（デフォルト: 20）
   * @param stdDev - 標準偏差倍率（デフォルト: 2）- indicatorts では固定 2σ
   * @returns ボリンジャーバンド計算結果
   */
  calculateBollingerBands(
    closingPrices: number[],
    period: number = 20,
    _stdDev: number = 2
  ): BollingerBandsResult {
    if (closingPrices.length < period) {
      console.warn(`ボリンジャーバンド計算には最低 ${period} 個のデータが必要です`);
      return { upperBand: [], middleBand: [], lowerBand: [] };
    }
    
    // indicatorts の bb は標準偏差倍率のオプションがないため period のみ渡す
    const result = bb(closingPrices, { period });
    
    return {
      upperBand: result.upper,
      middleBand: result.middle,
      lowerBand: result.lower,
    };
  }

  /**
   * ATR（真の値幅）を計算
   * 
   * @param highs - 高値の配列
   * @param lows - 安値の配列
   * @param closes - 終値の配列
   * @param period - 計算期間（デフォルト: 14）
   * @returns ATR 計算結果
   */
  calculateATR(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 14
  ): ATRResultType {
    if (highs.length < period || lows.length < period || closes.length < period) {
      console.warn(`ATR 計算には最低 ${period} 個のデータが必要です`);
      return { trLine: [], atrLine: [] };
    }
    
    const result = atr(highs, lows, closes, { period });
    return {
      trLine: result.trLine,
      atrLine: result.atrLine,
    };
  }

  /**
   * ストキャスティクスオシレーターを計算
   * 
   * @param highs - 高値の配列
   * @param lows - 安値の配列
   * @param closes - 終値の配列
   * @param kPeriod - %K 期間（デフォルト: 14）
   * @param dPeriod - %D 期間（デフォルト: 3）
   * @returns ストキャスティクス計算結果
   */
  calculateStochastic(
    highs: number[],
    lows: number[],
    closes: number[],
    kPeriod: number = 14,
    dPeriod: number = 3
  ): StochasticResult {
    if (highs.length < kPeriod || lows.length < kPeriod || closes.length < kPeriod) {
      console.warn(`ストキャスティクス計算には最低 ${kPeriod} 個のデータが必要です`);
      return { k: [], d: [] };
    }
    
    const result = stochasticOscillator(highs, lows, closes, { kPeriod, dPeriod });
    return {
      k: result.k,
      d: result.d,
    };
  }

  /**
   * OBV（オンバランスボリューム）を計算
   * 
   * @param closes - 終値の配列
   * @param volumes - 出来高の配列
   * @returns OBV 値の配列
   */
  calculateOBV(closes: number[], volumes: number[]): number[] {
    if (closes.length < 2 || volumes.length < 2) {
      console.warn('OBV 計算には最低 2 個のデータが必要です');
      return [];
    }
    
    return obv(closes, volumes);
  }

  /**
   * VWAP（出来高加重平均価格）を計算
   * 
   * @param closes - 終値の配列
   * @param volumes - 出来高の配列
   * @param period - 計算期間（オプション）
   * @returns VWAP 値の配列
   */
  calculateVWAP(
    closes: number[],
    volumes: number[],
    period?: number
  ): number[] {
    if (closes.length < 1 || volumes.length < 1) {
      console.warn('VWAP 計算には最低 1 個のデータが必要です');
      return [];
    }
    
    return vwap(closes, volumes, period ? { period } : undefined);
  }

  /**
   * OHLCV データから特徴量スナップショットを生成
   * 
   * @param ohlcvData - OHLCV データの配列
   * @param timeframe - 時間足
   * @param options - 計算オプション
   * @returns 特徴量スナップショット
   * 
   * 使用目的:
   * - トレードノート生成時の市場状態記録
   * - 類似トレード検索用の特徴量抽出
   */
  generateFeatureSnapshot(
    ohlcvData: OHLCVData[],
    timeframe: string,
    options: {
      rsiPeriod?: number;
      smaPeriod?: number;
      emaPeriod?: number;
      macdFast?: number;
      macdSlow?: number;
      macdSignal?: number;
      bbPeriod?: number;
      atrPeriod?: number;
      stochKPeriod?: number;
      stochDPeriod?: number;
    } = {}
  ): FeatureSnapshot {
    // デフォルト値の設定
    const {
      rsiPeriod = 14,
      smaPeriod = 20,
      emaPeriod = 20,
      macdFast = 12,
      macdSlow = 26,
      macdSignal = 9,
      bbPeriod = 20,
      atrPeriod = 14,
      stochKPeriod = 14,
      stochDPeriod = 3,
    } = options;

    // OHLCV データを配列に変換
    const highs = ohlcvData.map(d => d.high);
    const lows = ohlcvData.map(d => d.low);
    const closes = ohlcvData.map(d => d.close);
    const volumes = ohlcvData.map(d => d.volume);

    // 最新のデータポイント
    const latestData = ohlcvData[ohlcvData.length - 1];
    const timestamp = latestData.timestamp instanceof Date
      ? latestData.timestamp
      : new Date(latestData.timestamp);

    // 各インジケーターを計算（最新値を取得）
    const rsiValues = this.calculateRSI(closes, rsiPeriod);
    const smaValues = this.calculateSMA(closes, smaPeriod);
    const emaValues = this.calculateEMA(closes, emaPeriod);
    const macdResult = this.calculateMACD(closes, macdFast, macdSlow, macdSignal);
    const bbResult = this.calculateBollingerBands(closes, bbPeriod);
    const atrResult = this.calculateATR(highs, lows, closes, atrPeriod);
    const stochResult = this.calculateStochastic(highs, lows, closes, stochKPeriod, stochDPeriod);
    const obvValues = this.calculateOBV(closes, volumes);

    // 特徴量スナップショットを構築
    return {
      timestamp,
      timeframe,
      close: latestData.close,
      volume: latestData.volume,
      rsi: rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : undefined,
      sma: smaValues.length > 0 ? smaValues[smaValues.length - 1] : undefined,
      ema: emaValues.length > 0 ? emaValues[emaValues.length - 1] : undefined,
      macd: macdResult.macdLine.length > 0 ? macdResult : undefined,
      bollingerBands: bbResult.upperBand.length > 0 ? bbResult : undefined,
      atr: atrResult.atrLine.length > 0 ? atrResult.atrLine[atrResult.atrLine.length - 1] : undefined,
      stochastic: stochResult.k.length > 0 ? stochResult : undefined,
      obv: obvValues.length > 0 ? obvValues[obvValues.length - 1] : undefined,
    };
  }

  /**
   * 特徴量スナップショットから数値ベクトルを生成
   * 
   * @param snapshot - 特徴量スナップショット
   * @returns 正規化された特徴量ベクトル
   * 
   * 使用目的:
   * - pgvector での類似検索用
   * - コサイン類似度計算用
   */
  generateFeatureVector(snapshot: FeatureSnapshot): number[] {
    const vector: number[] = [];

    // RSI（0-100 を 0-1 に正規化）
    vector.push(snapshot.rsi !== undefined ? snapshot.rsi / 100 : 0.5);

    // 価格に対する SMA の位置（相対値）
    if (snapshot.sma !== undefined && snapshot.close > 0) {
      vector.push(snapshot.sma / snapshot.close);
    } else {
      vector.push(1);
    }

    // 価格に対する EMA の位置（相対値）
    if (snapshot.ema !== undefined && snapshot.close > 0) {
      vector.push(snapshot.ema / snapshot.close);
    } else {
      vector.push(1);
    }

    // MACD ヒストグラム（最新値、正規化）
    if (snapshot.macd?.histogram && snapshot.macd.histogram.length > 0) {
      const latestHist = snapshot.macd.histogram[snapshot.macd.histogram.length - 1];
      // -1 から 1 の範囲に正規化（tanh 関数的）
      vector.push(Math.tanh(latestHist / 100));
    } else {
      vector.push(0);
    }

    // ボリンジャーバンド位置（0-1 に正規化、上限超え・下限割れは clamp）
    if (snapshot.bollingerBands && snapshot.bollingerBands.upperBand.length > 0) {
      const upper = snapshot.bollingerBands.upperBand[snapshot.bollingerBands.upperBand.length - 1];
      const lower = snapshot.bollingerBands.lowerBand[snapshot.bollingerBands.lowerBand.length - 1];
      const bandWidth = upper - lower;
      if (bandWidth > 0) {
        const position = (snapshot.close - lower) / bandWidth;
        vector.push(Math.max(0, Math.min(1, position)));
      } else {
        vector.push(0.5);
      }
    } else {
      vector.push(0.5);
    }

    // ストキャスティクス %K（0-100 を 0-1 に正規化）
    if (snapshot.stochastic?.k && snapshot.stochastic.k.length > 0) {
      vector.push(snapshot.stochastic.k[snapshot.stochastic.k.length - 1] / 100);
    } else {
      vector.push(0.5);
    }

    // ATR 相対値（価格に対する割合）
    if (snapshot.atr !== undefined && snapshot.close > 0) {
      vector.push(Math.min(1, (snapshot.atr / snapshot.close) * 10));
    } else {
      vector.push(0.1);
    }

    // OBV の変化方向（正規化は難しいため、符号のみ）
    if (snapshot.obv !== undefined) {
      vector.push(snapshot.obv > 0 ? 1 : snapshot.obv < 0 ? 0 : 0.5);
    } else {
      vector.push(0.5);
    }

    return vector;
  }

  /**
   * トレンド判定
   * 
   * @param snapshot - 特徴量スナップショット
   * @returns トレンド状態
   */
  determineTrend(snapshot: FeatureSnapshot): 'uptrend' | 'downtrend' | 'neutral' {
    let bullishSignals = 0;
    let bearishSignals = 0;

    // RSI ベースの判定
    if (snapshot.rsi !== undefined) {
      if (snapshot.rsi > 50) bullishSignals++;
      if (snapshot.rsi < 50) bearishSignals++;
    }

    // SMA ベースの判定
    if (snapshot.sma !== undefined) {
      if (snapshot.close > snapshot.sma) bullishSignals++;
      if (snapshot.close < snapshot.sma) bearishSignals++;
    }

    // EMA ベースの判定
    if (snapshot.ema !== undefined) {
      if (snapshot.close > snapshot.ema) bullishSignals++;
      if (snapshot.close < snapshot.ema) bearishSignals++;
    }

    // MACD ベースの判定
    if (snapshot.macd?.histogram && snapshot.macd.histogram.length > 0) {
      const latestHist = snapshot.macd.histogram[snapshot.macd.histogram.length - 1];
      if (latestHist > 0) bullishSignals++;
      if (latestHist < 0) bearishSignals++;
    }

    // 判定結果
    if (bullishSignals > bearishSignals + 1) return 'uptrend';
    if (bearishSignals > bullishSignals + 1) return 'downtrend';
    return 'neutral';
  }
}

// シングルトンインスタンスをエクスポート
export const indicatorService = new IndicatorService();
