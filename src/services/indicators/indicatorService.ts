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
  // 新規追加インジケーター（Phase 1）
  williamsR,
  communityChannelIndex,
  aroon,
  priceRateOfChange,
  moneyFlowIndex,
  chaikinMoneyFlow,
  doubleExponentialMovingAverage,
  tripleExponentialMovingAverage,
  keltnerChannel,
  parabolicSAR,
  ichimokuCloud,
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
 * Aroon 計算結果の型定義
 */
export interface AroonResult {
  /** Aroon Up ライン */
  up: number[];
  /** Aroon Down ライン */
  down: number[];
}

/**
 * ケルトナーチャネル計算結果の型定義
 */
export interface KeltnerChannelResult {
  /** 上部バンド */
  upperBand: number[];
  /** 中央ライン（EMA） */
  middleLine: number[];
  /** 下部バンド */
  lowerBand: number[];
}

/**
 * パラボリックSAR計算結果の型定義
 */
export interface ParabolicSARResult {
  /** SAR値の配列 */
  sar: number[];
  /** トレンド方向（true=上昇、false=下降） */
  trends: boolean[];
}

/**
 * 一目均衡表計算結果の型定義
 */
export interface IchimokuCloudResult {
  /** 転換線 */
  conversionLine: number[];
  /** 基準線 */
  baseLine: number[];
  /** 先行スパンA */
  leadingSpanA: number[];
  /** 先行スパンB */
  leadingSpanB: number[];
  /** 遅行スパン */
  laggingSpan: number[];
}

/**
 * 特徴量スナップショットの型定義
 * トレードノート用の市場状態を表現
 * 
 * Phase 1 で 20 種類のインジケーターをサポート
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
  
  // === 既存インジケーター（9種） ===
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
  /** VWAP 値 */
  vwap?: number;
  
  // === 新規追加インジケーター（11種）===
  /** Williams %R 値 */
  williamsR?: number;
  /** CCI（コモディティチャネル指数）値 */
  cci?: number;
  /** Aroon 値 */
  aroon?: AroonResult;
  /** ROC（変化率）値 */
  roc?: number;
  /** MFI（マネーフローインデックス）値 */
  mfi?: number;
  /** CMF（チャイキンマネーフロー）値 */
  cmf?: number;
  /** DEMA（二重指数移動平均）値 */
  dema?: number;
  /** TEMA（三重指数移動平均）値 */
  tema?: number;
  /** ケルトナーチャネル */
  keltnerChannel?: KeltnerChannelResult;
  /** パラボリックSAR */
  parabolicSar?: ParabolicSARResult;
  /** 一目均衡表 */
  ichimoku?: IchimokuCloudResult;
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
   * @returns ボリンジャーバンド計算結果
   * 
   * 注: indicatortsライブラリの制約により標準偏差は2σ固定
   */
  calculateBollingerBands(
    closingPrices: number[],
    period: number = 20
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

  // ==========================================
  // 新規追加インジケーター（Phase 1: 11種類）
  // ==========================================

  /**
   * Williams %R を計算
   * 
   * @param highs - 高値の配列
   * @param lows - 安値の配列
   * @param closes - 終値の配列
   * @param period - 計算期間（デフォルト: 14）
   * @returns Williams %R 値の配列（-100〜0の範囲）
   * 
   * 使用例:
   * - Williams %R < -80: 売られすぎ
   * - Williams %R > -20: 買われすぎ
   */
  calculateWilliamsR(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 14
  ): number[] {
    if (highs.length < period || lows.length < period || closes.length < period) {
      console.warn(`Williams %R 計算には最低 ${period} 個のデータが必要です`);
      return [];
    }
    
    return williamsR(highs, lows, closes, { period });
  }

  /**
   * CCI（コモディティチャネル指数）を計算
   * 
   * @param highs - 高値の配列
   * @param lows - 安値の配列
   * @param closes - 終値の配列
   * @param period - 計算期間（デフォルト: 20）
   * @returns CCI 値の配列
   * 
   * 使用例:
   * - CCI > 100: 買われすぎ
   * - CCI < -100: 売られすぎ
   */
  calculateCCI(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 20
  ): number[] {
    if (highs.length < period || lows.length < period || closes.length < period) {
      console.warn(`CCI 計算には最低 ${period} 個のデータが必要です`);
      return [];
    }
    
    return communityChannelIndex(highs, lows, closes, { period });
  }

  /**
   * Aroon（アルーン）指標を計算
   * 
   * @param highs - 高値の配列
   * @param lows - 安値の配列
   * @param period - 計算期間（デフォルト: 25）
   * @returns Aroon Up/Down の計算結果
   * 
   * 使用例:
   * - Aroon Up > 70 & Aroon Down < 30: 強い上昇トレンド
   * - Aroon Down > 70 & Aroon Up < 30: 強い下降トレンド
   */
  calculateAroon(
    highs: number[],
    lows: number[],
    period: number = 25
  ): AroonResult {
    if (highs.length < period || lows.length < period) {
      console.warn(`Aroon 計算には最低 ${period} 個のデータが必要です`);
      return { up: [], down: [] };
    }
    
    const result = aroon(highs, lows, { period });
    return {
      up: result.up,
      down: result.down,
    };
  }

  /**
   * ROC（価格変化率）を計算
   * 
   * @param closes - 終値の配列
   * @param period - 計算期間（デフォルト: 10）
   * @returns ROC 値の配列（パーセンテージ）
   */
  calculateROC(
    closes: number[],
    period: number = 10
  ): number[] {
    if (closes.length < period + 1) {
      console.warn(`ROC 計算には最低 ${period + 1} 個のデータが必要です`);
      return [];
    }
    
    return priceRateOfChange(closes, { period });
  }

  /**
   * MFI（マネーフローインデックス）を計算
   * 
   * @param highs - 高値の配列
   * @param lows - 安値の配列
   * @param closes - 終値の配列
   * @param volumes - 出来高の配列
   * @param period - 計算期間（デフォルト: 14）
   * @returns MFI 値の配列（0〜100の範囲）
   * 
   * 使用例:
   * - MFI > 80: 買われすぎ
   * - MFI < 20: 売られすぎ
   */
  calculateMFI(
    highs: number[],
    lows: number[],
    closes: number[],
    volumes: number[],
    period: number = 14
  ): number[] {
    if (highs.length < period || lows.length < period || closes.length < period || volumes.length < period) {
      console.warn(`MFI 計算には最低 ${period} 個のデータが必要です`);
      return [];
    }
    
    return moneyFlowIndex(highs, lows, closes, volumes, { period });
  }

  /**
   * CMF（チャイキンマネーフロー）を計算
   * 
   * @param highs - 高値の配列
   * @param lows - 安値の配列
   * @param closes - 終値の配列
   * @param volumes - 出来高の配列
   * @param period - 計算期間（デフォルト: 20）
   * @returns CMF 値の配列（-1〜1の範囲）
   * 
   * 使用例:
   * - CMF > 0: 買い圧力優勢
   * - CMF < 0: 売り圧力優勢
   */
  calculateCMF(
    highs: number[],
    lows: number[],
    closes: number[],
    volumes: number[],
    period: number = 20
  ): number[] {
    if (highs.length < period || lows.length < period || closes.length < period || volumes.length < period) {
      console.warn(`CMF 計算には最低 ${period} 個のデータが必要です`);
      return [];
    }
    
    return chaikinMoneyFlow(highs, lows, closes, volumes, { period });
  }

  /**
   * DEMA（二重指数移動平均）を計算
   * 
   * @param closes - 終値の配列
   * @param period - 計算期間（デフォルト: 20）
   * @returns DEMA 値の配列
   */
  calculateDEMA(
    closes: number[],
    period: number = 20
  ): number[] {
    if (closes.length < period * 2) {
      console.warn(`DEMA 計算には最低 ${period * 2} 個のデータが必要です`);
      return [];
    }
    
    return doubleExponentialMovingAverage(closes, { period });
  }

  /**
   * TEMA（三重指数移動平均）を計算
   * 
   * @param closes - 終値の配列
   * @param period - 計算期間（デフォルト: 20）
   * @returns TEMA 値の配列
   */
  calculateTEMA(
    closes: number[],
    period: number = 20
  ): number[] {
    if (closes.length < period * 3) {
      console.warn(`TEMA 計算には最低 ${period * 3} 個のデータが必要です`);
      return [];
    }
    
    return tripleExponentialMovingAverage(closes, { period });
  }

  /**
   * ケルトナーチャネルを計算
   * 
   * @param highs - 高値の配列
   * @param lows - 安値の配列
   * @param closes - 終値の配列
   * @param period - 計算期間（デフォルト: 20）
   * @param _multiplier - ATR 倍率（デフォルト: 2）※ライブラリ固定のため未使用
   * @returns ケルトナーチャネル計算結果
   * 
   * 注意: indicatorts ライブラリは内部で 2 * ATR を固定使用
   */
  calculateKeltnerChannel(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 20,
    _multiplier: number = 2
  ): KeltnerChannelResult {
    if (highs.length < period || lows.length < period || closes.length < period) {
      console.warn(`ケルトナーチャネル計算には最低 ${period} 個のデータが必要です`);
      return { upperBand: [], middleLine: [], lowerBand: [] };
    }
    
    // indicatorts の keltnerChannel は period のみをサポート
    const result = keltnerChannel(highs, lows, closes, { period });
    return {
      upperBand: result.upper,
      middleLine: result.middle,
      lowerBand: result.lower,
    };
  }

  /**
   * パラボリックSARを計算
   * 
   * @param highs - 高値の配列
   * @param lows - 安値の配列
   * @param closes - 終値の配列
   * @param step - 加速因子ステップ（デフォルト: 0.02）
   * @param max - 加速因子最大値（デフォルト: 0.2）
   * @returns パラボリックSAR計算結果
   * 
   * 使用例:
   * - 価格 > SAR: 上昇トレンド
   * - 価格 < SAR: 下降トレンド
   */
  calculateParabolicSAR(
    highs: number[],
    lows: number[],
    closes: number[],
    step: number = 0.02,
    max: number = 0.2
  ): ParabolicSARResult {
    if (highs.length < 2 || lows.length < 2 || closes.length < 2) {
      console.warn('パラボリックSAR 計算には最低 2 個のデータが必要です');
      return { sar: [], trends: [] };
    }
    
    const result = parabolicSAR(highs, lows, closes, { step, max });
    return {
      sar: result.psarResult,
      // indicatorts の Trend 型を boolean に変換
      trends: result.trends.map(t => t === 1), // 1 = Rising (上昇)
    };
  }

  /**
   * 一目均衡表を計算
   * 
   * @param highs - 高値の配列
   * @param lows - 安値の配列
   * @param closes - 終値の配列
   * @param conversionPeriod - 転換線期間（デフォルト: 9）
   * @param basePeriod - 基準線期間（デフォルト: 26）
   * @param spanBPeriod - 先行スパンB期間（デフォルト: 52）
   * @param closePeriod - 遅行スパン期間（デフォルト: 26）
   * @returns 一目均衡表計算結果
   */
  calculateIchimokuCloud(
    highs: number[],
    lows: number[],
    closes: number[],
    conversionPeriod: number = 9,
    basePeriod: number = 26,
    spanBPeriod: number = 52,
    closePeriod: number = 26
  ): IchimokuCloudResult {
    const minRequired = Math.max(conversionPeriod, basePeriod, spanBPeriod);
    if (highs.length < minRequired || lows.length < minRequired || closes.length < minRequired) {
      console.warn(`一目均衡表計算には最低 ${minRequired} 個のデータが必要です`);
      return {
        conversionLine: [],
        baseLine: [],
        leadingSpanA: [],
        leadingSpanB: [],
        laggingSpan: [],
      };
    }
    
    // indicatorts の ichimokuCloud API に合わせる
    const result = ichimokuCloud(highs, lows, closes, {
      short: conversionPeriod,
      medium: basePeriod,
      long: spanBPeriod,
      close: closePeriod,
    });
    return {
      conversionLine: result.tenkan,
      baseLine: result.kijun,
      leadingSpanA: result.ssa,
      leadingSpanB: result.ssb,
      laggingSpan: result.laggingSpan,
    };
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

  /**
   * インジケーター ID に基づいて適切な計算メソッドを呼び出す汎用メソッド
   * 
   * @param indicatorId - インジケーター識別子
   * @param ohlcvData - OHLCV データ配列
   * @param params - インジケーターパラメータ
   * @returns 計算結果
   */
  calculate(
    indicatorId: string,
    ohlcvData: OHLCVData[],
    params: IndicatorCalculateParams
  ): IndicatorCalculateResult {
    const closes = ohlcvData.map(d => d.close);
    const highs = ohlcvData.map(d => d.high);
    const lows = ohlcvData.map(d => d.low);
    const volumes = ohlcvData.map(d => d.volume);

    switch (indicatorId.toLowerCase()) {
      case 'rsi':
        return { type: 'array', values: this.calculateRSI(closes, params.period ?? 14) };
      
      case 'sma':
        return { type: 'array', values: this.calculateSMA(closes, params.period ?? 20) };
      
      case 'ema':
        return { type: 'array', values: this.calculateEMA(closes, params.period ?? 20) };
      
      case 'macd':
        return { type: 'macd', result: this.calculateMACD(
          closes,
          params.fastPeriod ?? 12,
          params.slowPeriod ?? 26,
          params.signalPeriod ?? 9
        )};
      
      case 'bb':
        return { type: 'bollingerBands', result: this.calculateBollingerBands(
          closes,
          params.period ?? 20
        )};
      
      case 'atr':
        return { type: 'atr', result: this.calculateATR(highs, lows, closes, params.period ?? 14) };
      
      case 'stochastic':
        return { type: 'stochastic', result: this.calculateStochastic(
          highs,
          lows,
          closes,
          params.kPeriod ?? 14,
          params.dPeriod ?? 3
        )};
      
      case 'obv':
        return { type: 'array', values: this.calculateOBV(closes, volumes) };
      
      case 'vwap':
        return { type: 'array', values: this.calculateVWAP(closes, volumes, params.period) };
      
      case 'williamsr':
        return { type: 'array', values: this.calculateWilliamsR(
          highs,
          lows,
          closes,
          params.period ?? 14
        )};
      
      case 'cci':
        return { type: 'array', values: this.calculateCCI(
          highs,
          lows,
          closes,
          params.period ?? 20
        )};
      
      case 'aroon':
        return { type: 'aroon', result: this.calculateAroon(highs, lows, params.period ?? 25) };
      
      case 'roc':
        return { type: 'array', values: this.calculateROC(closes, params.period ?? 12) };
      
      case 'mfi':
        return { type: 'array', values: this.calculateMFI(
          highs,
          lows,
          closes,
          volumes,
          params.period ?? 14
        )};
      
      case 'cmf':
        return { type: 'array', values: this.calculateCMF(
          highs,
          lows,
          closes,
          volumes,
          params.period ?? 20
        )};
      
      case 'dema':
        return { type: 'array', values: this.calculateDEMA(closes, params.period ?? 20) };
      
      case 'tema':
        return { type: 'array', values: this.calculateTEMA(closes, params.period ?? 20) };
      
      case 'kc':
        return { type: 'keltnerChannel', result: this.calculateKeltnerChannel(
          highs,
          lows,
          closes,
          params.emaPeriod ?? params.period ?? 20,
          params.multiplier ?? 2
        )};
      
      case 'psar':
        return { type: 'parabolicSAR', result: this.calculateParabolicSAR(
          highs,
          lows,
          closes,
          params.step ?? 0.02,
          params.max ?? 0.2
        )};
      
      case 'ichimoku':
        return { type: 'ichimoku', result: this.calculateIchimokuCloud(
          highs,
          lows,
          closes,
          params.tenkanPeriod ?? 9,
          params.kijunPeriod ?? 26,
          params.senkouSpanBPeriod ?? 52,
          params.chikouOffset ?? 26
        )};
      
      default:
        console.warn(`[IndicatorService] 未対応のインジケーター: ${indicatorId}`);
        return { type: 'array', values: [] };
    }
  }

  /**
   * 計算結果から最新の数値を抽出するヘルパー
   * 
   * @param result - calculate() の結果
   * @returns 最新の数値（取得できない場合は null）
   */
  extractLatestValue(result: IndicatorCalculateResult): number | null {
    switch (result.type) {
      case 'array':
        return result.values.length > 0 ? result.values[result.values.length - 1] : null;
      
      case 'macd':
        return result.result.macdLine.length > 0 
          ? result.result.macdLine[result.result.macdLine.length - 1] 
          : null;
      
      case 'bollingerBands':
        return result.result.middleBand.length > 0 
          ? result.result.middleBand[result.result.middleBand.length - 1] 
          : null;
      
      case 'atr':
        return result.result.atrLine.length > 0 
          ? result.result.atrLine[result.result.atrLine.length - 1] 
          : null;
      
      case 'stochastic':
        return result.result.k.length > 0 
          ? result.result.k[result.result.k.length - 1] 
          : null;
      
      case 'aroon':
        return result.result.up.length > 0 
          ? result.result.up[result.result.up.length - 1] 
          : null;
      
      case 'keltnerChannel':
        return result.result.middleLine.length > 0 
          ? result.result.middleLine[result.result.middleLine.length - 1] 
          : null;
      
      case 'parabolicSAR':
        return result.result.sar.length > 0 
          ? result.result.sar[result.result.sar.length - 1] 
          : null;
      
      case 'ichimoku':
        return result.result.baseLine.length > 0 
          ? result.result.baseLine[result.result.baseLine.length - 1] 
          : null;
      
      default:
        return null;
    }
  }
}

/**
 * インジケーター計算パラメータの型定義
 */
export interface IndicatorCalculateParams {
  period?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  // stdDevはindicatortsライブラリの制約により2固定のため削除
  kPeriod?: number;
  dPeriod?: number;
  emaPeriod?: number;
  atrPeriod?: number;
  multiplier?: number;
  step?: number;
  max?: number;
  tenkanPeriod?: number;
  kijunPeriod?: number;
  senkouSpanBPeriod?: number;
  chikouOffset?: number;
}

/**
 * インジケーター計算結果の判別可能なユニオン型
 * 型安全にインジケーター計算結果を扱うための discriminated union
 */
export type IndicatorCalculateResult =
  | { type: 'array'; values: number[] }
  | { type: 'macd'; result: MACDResult }
  | { type: 'bollingerBands'; result: BollingerBandsResult }
  | { type: 'atr'; result: ATRResultType }
  | { type: 'stochastic'; result: StochasticResult }
  | { type: 'aroon'; result: AroonResult }
  | { type: 'keltnerChannel'; result: KeltnerChannelResult }
  | { type: 'parabolicSAR'; result: ParabolicSARResult }
  | { type: 'ichimoku'; result: IchimokuCloudResult };

// シングルトンインスタンスをエクスポート
export const indicatorService = new IndicatorService();
