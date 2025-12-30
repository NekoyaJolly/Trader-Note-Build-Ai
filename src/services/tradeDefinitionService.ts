/**
 * TradeDefinition 生成サービス
 * 
 * 目的:
 * - Trade + MarketData + Indicators を統合して TradeDefinition を生成
 * - 特徴量ベクトルの計算
 * - 派生コンテキスト（トレンド、ボラティリティ等）の導出
 * 
 * Phase 1 パイプライン:
 * CSV → Validation → Trade → MarketData → Indicators → TradeDefinition → AI → TradeNote(draft)
 */

import { v4 as uuidv4 } from 'uuid';
import { Trade } from '../models/types';
import {
  TradeDefinition,
  NormalizedTrade,
  MarketSnapshot,
  IndicatorSnapshot,
  IndicatorValue,
  DerivedContext,
  TrendDirection,
  TradeDefinitionRequest,
  TradeDefinitionResult,
  BatchDefinitionResult,
  DEFAULT_TREND_WEIGHTS,
} from '../models/tradeDefinition';
import { IndicatorConfig, IndicatorId } from '../models/indicatorConfig';
import { indicatorService, OHLCVData } from './indicators';
import { MarketDataService } from './marketDataService';
import { tradeNormalizationService, NormalizationResult } from './tradeNormalizationService';

/**
 * 設定バージョン
 * 特徴量計算ロジック変更時にインクリメント
 */
const CONFIG_VERSION = '1.0.0';

/**
 * TradeDefinition 生成サービスクラス
 */
export class TradeDefinitionService {
  private marketDataService: MarketDataService;

  constructor() {
    this.marketDataService = new MarketDataService();
  }

  /**
   * 正規化済みトレードから TradeDefinition を生成
   * 
   * @param request - 生成リクエスト
   * @returns 生成結果
   */
  async generateDefinition(request: TradeDefinitionRequest): Promise<TradeDefinitionResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // === トレードの正規化チェック ===
    let normalizedTrade: NormalizedTrade;
    
    if (this.isNormalizedTrade(request.trade)) {
      normalizedTrade = request.trade;
    } else {
      // 未正規化の場合は正規化を実行
      const normResult = tradeNormalizationService.normalizeTradeData(request.trade);
      if (!normResult.success || !normResult.trade) {
        return {
          success: false,
          errors: normResult.errors || ['トレードデータの正規化に失敗しました'],
        };
      }
      normalizedTrade = normResult.trade;
      if (normResult.warnings) {
        warnings.push(...normResult.warnings);
      }
    }

    // === 市場データの取得 ===
    let marketSnapshot: MarketSnapshot;
    let ohlcvData: OHLCVData[] = [];
    
    try {
      const marketData = await this.marketDataService.getHistoricalData(
        normalizedTrade.symbol,
        request.timeframe,
        request.windowMinutes || 60 // デフォルト: 前後1時間
      );
      
      if (marketData.length === 0) {
        warnings.push('市場データを取得できませんでした。モックデータを使用します');
        // モックデータを生成
        ohlcvData = this.generateMockOHLCV(normalizedTrade);
      } else {
        // MarketData[] を OHLCVData[] に変換
        ohlcvData = marketData.map(md => ({
          timestamp: md.timestamp,
          open: md.open,
          high: md.high,
          low: md.low,
          close: md.close,
          volume: md.volume,
        }));
      }

      // 最新のデータポイントからスナップショットを作成
      const latestData = ohlcvData[ohlcvData.length - 1];
      marketSnapshot = {
        timestamp: latestData.timestamp instanceof Date ? latestData.timestamp : new Date(latestData.timestamp),
        timeframe: request.timeframe,
        open: latestData.open,
        high: latestData.high,
        low: latestData.low,
        close: latestData.close,
        volume: latestData.volume,
      };
    } catch (error) {
      // 市場データ取得失敗時はモックを使用
      warnings.push(`市場データ取得エラー: ${error instanceof Error ? error.message : 'Unknown error'}`);
      ohlcvData = this.generateMockOHLCV(normalizedTrade);
      const latestData = ohlcvData[ohlcvData.length - 1];
      marketSnapshot = {
        timestamp: latestData.timestamp instanceof Date ? latestData.timestamp : new Date(latestData.timestamp),
        timeframe: request.timeframe,
        open: latestData.open,
        high: latestData.high,
        low: latestData.low,
        close: latestData.close,
        volume: latestData.volume,
      };
    }

    // === インジケーターの計算 ===
    const indicatorSnapshot = this.calculateIndicators(
      ohlcvData,
      request.indicatorConfigs.filter(c => c.enabled)
    );

    // === 派生コンテキストの導出 ===
    const derivedContext = this.deriveContext(indicatorSnapshot, marketSnapshot);

    // === 特徴量ベクトルの生成 ===
    const featureVector = this.generateFeatureVector(indicatorSnapshot, derivedContext);

    // === TradeDefinition の構築 ===
    const definition: TradeDefinition = {
      id: uuidv4(),
      trade: normalizedTrade,
      marketSnapshot,
      indicatorSnapshot,
      derivedContext,
      featureVector,
      vectorDimension: featureVector.length,
      createdAt: new Date(),
      configVersion: CONFIG_VERSION,
    };

    return {
      success: true,
      definition,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * 複数トレードを一括で TradeDefinition に変換
   * 
   * @param trades - トレード配列
   * @param indicatorConfigs - インジケーター設定
   * @param timeframe - 時間足
   * @returns バッチ処理結果
   */
  async generateDefinitionsBatch(
    trades: Trade[],
    indicatorConfigs: IndicatorConfig[],
    timeframe: string
  ): Promise<BatchDefinitionResult> {
    const startTime = Date.now();
    const results: TradeDefinitionResult[] = [];
    let succeeded = 0;
    let failed = 0;

    // 順次処理（API レート制限対応）
    for (const trade of trades) {
      const result = await this.generateDefinition({
        trade,
        indicatorConfigs,
        timeframe,
      });

      results.push(result);
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    return {
      total: trades.length,
      succeeded,
      failed,
      results,
      processingTime: Date.now() - startTime,
    };
  }

  /**
   * インジケーターを計算
   */
  private calculateIndicators(
    ohlcvData: OHLCVData[],
    configs: IndicatorConfig[]
  ): IndicatorSnapshot {
    const results: IndicatorValue[] = [];
    const highs = ohlcvData.map(d => d.high);
    const lows = ohlcvData.map(d => d.low);
    const closes = ohlcvData.map(d => d.close);
    const volumes = ohlcvData.map(d => d.volume);

    for (const config of configs) {
      const result = this.calculateSingleIndicator(
        config,
        highs,
        lows,
        closes,
        volumes
      );
      results.push(result);
    }

    return {
      configs: [...configs],
      results,
      calculatedAt: new Date(),
    };
  }

  /**
   * 単一インジケーターを計算
   */
  private calculateSingleIndicator(
    config: IndicatorConfig,
    highs: number[],
    lows: number[],
    closes: number[],
    volumes: number[]
  ): IndicatorValue {
    const { configId, indicatorId, label, params } = config;
    
    try {
      let value: number | undefined;
      let values: Record<string, number | number[]> | undefined;

      switch (indicatorId) {
        case 'rsi': {
          const rsiValues = indicatorService.calculateRSI(closes, params.period || 14);
          value = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : undefined;
          break;
        }
        case 'sma': {
          const smaValues = indicatorService.calculateSMA(closes, params.period || 20);
          value = smaValues.length > 0 ? smaValues[smaValues.length - 1] : undefined;
          break;
        }
        case 'ema': {
          const emaValues = indicatorService.calculateEMA(closes, params.period || 20);
          value = emaValues.length > 0 ? emaValues[emaValues.length - 1] : undefined;
          break;
        }
        case 'macd': {
          const macdResult = indicatorService.calculateMACD(
            closes,
            params.fastPeriod || 12,
            params.slowPeriod || 26,
            params.signalPeriod || 9
          );
          values = {
            macdLine: macdResult.macdLine,
            signalLine: macdResult.signalLine,
            histogram: macdResult.histogram,
          };
          break;
        }
        case 'bb': {
          const bbResult = indicatorService.calculateBollingerBands(closes, params.period || 20);
          values = {
            upperBand: bbResult.upperBand,
            middleBand: bbResult.middleBand,
            lowerBand: bbResult.lowerBand,
          };
          break;
        }
        case 'atr': {
          const atrResult = indicatorService.calculateATR(highs, lows, closes, params.period || 14);
          value = atrResult.atrLine.length > 0 ? atrResult.atrLine[atrResult.atrLine.length - 1] : undefined;
          break;
        }
        case 'stochastic': {
          const stochResult = indicatorService.calculateStochastic(
            highs, lows, closes,
            params.kPeriod || 14,
            params.dPeriod || 3
          );
          values = { k: stochResult.k, d: stochResult.d };
          break;
        }
        case 'obv': {
          const obvValues = indicatorService.calculateOBV(closes, volumes);
          value = obvValues.length > 0 ? obvValues[obvValues.length - 1] : undefined;
          break;
        }
        case 'vwap': {
          const vwapValues = indicatorService.calculateVWAP(closes, volumes);
          value = vwapValues.length > 0 ? vwapValues[vwapValues.length - 1] : undefined;
          break;
        }
        case 'williamsR': {
          const wrValues = indicatorService.calculateWilliamsR(highs, lows, closes, params.period || 14);
          value = wrValues.length > 0 ? wrValues[wrValues.length - 1] : undefined;
          break;
        }
        case 'cci': {
          const cciValues = indicatorService.calculateCCI(highs, lows, closes, params.period || 20);
          value = cciValues.length > 0 ? cciValues[cciValues.length - 1] : undefined;
          break;
        }
        case 'aroon': {
          const aroonResult = indicatorService.calculateAroon(highs, lows, params.period || 25);
          values = { up: aroonResult.up, down: aroonResult.down };
          break;
        }
        case 'roc': {
          const rocValues = indicatorService.calculateROC(closes, params.period || 10);
          value = rocValues.length > 0 ? rocValues[rocValues.length - 1] : undefined;
          break;
        }
        case 'mfi': {
          const mfiValues = indicatorService.calculateMFI(highs, lows, closes, volumes, params.period || 14);
          value = mfiValues.length > 0 ? mfiValues[mfiValues.length - 1] : undefined;
          break;
        }
        case 'cmf': {
          const cmfValues = indicatorService.calculateCMF(highs, lows, closes, volumes, params.period || 20);
          value = cmfValues.length > 0 ? cmfValues[cmfValues.length - 1] : undefined;
          break;
        }
        case 'dema': {
          const demaValues = indicatorService.calculateDEMA(closes, params.period || 20);
          value = demaValues.length > 0 ? demaValues[demaValues.length - 1] : undefined;
          break;
        }
        case 'tema': {
          const temaValues = indicatorService.calculateTEMA(closes, params.period || 20);
          value = temaValues.length > 0 ? temaValues[temaValues.length - 1] : undefined;
          break;
        }
        case 'kc': {
          const kcResult = indicatorService.calculateKeltnerChannel(highs, lows, closes, params.period || 20);
          values = {
            upperBand: kcResult.upperBand,
            middleLine: kcResult.middleLine,
            lowerBand: kcResult.lowerBand,
          };
          break;
        }
        case 'psar': {
          const psarResult = indicatorService.calculateParabolicSAR(
            highs, lows, closes,
            params.step || 0.02,
            params.maxStep || 0.2
          );
          values = {
            sar: psarResult.sar,
            trends: psarResult.trends.map(t => t ? 1 : 0),
          };
          break;
        }
        case 'ichimoku': {
          const ichimokuResult = indicatorService.calculateIchimokuCloud(
            highs, lows, closes,
            params.conversionPeriod || 9,
            params.basePeriod || 26,
            params.spanBPeriod || 52,
            params.displacement || 26
          );
          values = {
            conversionLine: ichimokuResult.conversionLine,
            baseLine: ichimokuResult.baseLine,
            leadingSpanA: ichimokuResult.leadingSpanA,
            leadingSpanB: ichimokuResult.leadingSpanB,
            laggingSpan: ichimokuResult.laggingSpan,
          };
          break;
        }
        default:
          return {
            configId,
            indicatorId,
            label: label || indicatorId,
            calculated: false,
            error: `未対応のインジケーター: ${indicatorId}`,
          };
      }

      return {
        configId,
        indicatorId,
        label: label || indicatorId,
        value,
        values,
        calculated: value !== undefined || values !== undefined,
      };
    } catch (error) {
      return {
        configId,
        indicatorId,
        label: label || indicatorId,
        calculated: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 派生コンテキストを導出
   */
  private deriveContext(
    indicatorSnapshot: IndicatorSnapshot,
    marketSnapshot: MarketSnapshot
  ): DerivedContext {
    // === トレンド判定 ===
    const trend = this.determineTrend(indicatorSnapshot, marketSnapshot);
    const trendStrength = this.calculateTrendStrength(indicatorSnapshot, marketSnapshot);

    // === ボラティリティ判定 ===
    const volatility = this.determineVolatility(indicatorSnapshot, marketSnapshot);

    // === モメンタム判定 ===
    const momentum = this.determineMomentum(indicatorSnapshot);

    // === 出来高状態 ===
    const volumeCondition = this.determineVolumeCondition(indicatorSnapshot);

    return {
      trend,
      trendStrength,
      volatility,
      momentum,
      volumeCondition,
    };
  }

  /**
   * トレンド方向を判定
   */
  private determineTrend(
    indicatorSnapshot: IndicatorSnapshot,
    marketSnapshot: MarketSnapshot
  ): TrendDirection {
    let bullishScore = 0;
    let bearishScore = 0;
    const close = marketSnapshot.close;

    for (const result of indicatorSnapshot.results) {
      if (!result.calculated) continue;

      switch (result.indicatorId) {
        case 'rsi':
          if (result.value !== undefined) {
            if (result.value > 50) bullishScore++;
            if (result.value < 50) bearishScore++;
          }
          break;
        case 'sma':
        case 'ema':
        case 'dema':
        case 'tema':
          if (result.value !== undefined) {
            if (close > result.value) bullishScore++;
            if (close < result.value) bearishScore++;
          }
          break;
        case 'macd':
          if (result.values?.histogram) {
            const hist = result.values.histogram as number[];
            if (hist.length > 0) {
              const latest = hist[hist.length - 1];
              if (latest > 0) bullishScore++;
              if (latest < 0) bearishScore++;
            }
          }
          break;
        case 'aroon':
          if (result.values?.up && result.values?.down) {
            const up = result.values.up as number[];
            const down = result.values.down as number[];
            if (up.length > 0 && down.length > 0) {
              const latestUp = up[up.length - 1];
              const latestDown = down[down.length - 1];
              if (latestUp > latestDown) bullishScore++;
              if (latestDown > latestUp) bearishScore++;
            }
          }
          break;
      }
    }

    if (bullishScore > bearishScore + 1) return 'uptrend';
    if (bearishScore > bullishScore + 1) return 'downtrend';
    return 'neutral';
  }

  /**
   * トレンド強度を計算（0-100）
   */
  private calculateTrendStrength(
    indicatorSnapshot: IndicatorSnapshot,
    _marketSnapshot: MarketSnapshot
  ): number {
    let totalWeight = 0;
    let weightedScore = 0;

    for (const result of indicatorSnapshot.results) {
      if (!result.calculated) continue;

      switch (result.indicatorId) {
        case 'rsi':
          if (result.value !== undefined) {
            // RSI の極端値はトレンド強度に寄与
            const deviation = Math.abs(result.value - 50);
            weightedScore += deviation * DEFAULT_TREND_WEIGHTS.rsi;
            totalWeight += DEFAULT_TREND_WEIGHTS.rsi;
          }
          break;
        case 'aroon':
          if (result.values?.up && result.values?.down) {
            const up = result.values.up as number[];
            const down = result.values.down as number[];
            if (up.length > 0 && down.length > 0) {
              const diff = Math.abs(up[up.length - 1] - down[down.length - 1]);
              weightedScore += diff * 0.3;
              totalWeight += 0.3;
            }
          }
          break;
      }
    }

    return totalWeight > 0 ? Math.min(100, (weightedScore / totalWeight) * 2) : 50;
  }

  /**
   * ボラティリティ状態を判定
   */
  private determineVolatility(
    indicatorSnapshot: IndicatorSnapshot,
    marketSnapshot: MarketSnapshot
  ): 'low' | 'medium' | 'high' {
    // ATR ベースの判定
    for (const result of indicatorSnapshot.results) {
      if (result.indicatorId === 'atr' && result.value !== undefined) {
        const atrPercent = (result.value / marketSnapshot.close) * 100;
        if (atrPercent < 1) return 'low';
        if (atrPercent > 3) return 'high';
        return 'medium';
      }
    }

    // BB ベースのフォールバック
    for (const result of indicatorSnapshot.results) {
      if (result.indicatorId === 'bb' && result.values) {
        const upper = result.values.upperBand as number[];
        const lower = result.values.lowerBand as number[];
        if (upper.length > 0 && lower.length > 0) {
          const bandWidth = (upper[upper.length - 1] - lower[lower.length - 1]) / marketSnapshot.close * 100;
          if (bandWidth < 2) return 'low';
          if (bandWidth > 6) return 'high';
          return 'medium';
        }
      }
    }

    return 'medium';
  }

  /**
   * モメンタム状態を判定
   */
  private determineMomentum(indicatorSnapshot: IndicatorSnapshot): 'overbought' | 'oversold' | 'neutral' {
    let overboughtCount = 0;
    let oversoldCount = 0;

    for (const result of indicatorSnapshot.results) {
      if (!result.calculated || result.value === undefined) continue;

      switch (result.indicatorId) {
        case 'rsi':
          if (result.value > 70) overboughtCount++;
          if (result.value < 30) oversoldCount++;
          break;
        case 'stochastic':
          if (result.values?.k) {
            const k = result.values.k as number[];
            if (k.length > 0) {
              if (k[k.length - 1] > 80) overboughtCount++;
              if (k[k.length - 1] < 20) oversoldCount++;
            }
          }
          break;
        case 'williamsR':
          if (result.value > -20) overboughtCount++;
          if (result.value < -80) oversoldCount++;
          break;
        case 'mfi':
          if (result.value > 80) overboughtCount++;
          if (result.value < 20) oversoldCount++;
          break;
      }
    }

    if (overboughtCount >= 2) return 'overbought';
    if (oversoldCount >= 2) return 'oversold';
    return 'neutral';
  }

  /**
   * 出来高状態を判定
   */
  private determineVolumeCondition(indicatorSnapshot: IndicatorSnapshot): 'above_average' | 'below_average' | 'average' {
    // CMF ベースの判定
    for (const result of indicatorSnapshot.results) {
      if (result.indicatorId === 'cmf' && result.value !== undefined) {
        if (result.value > 0.1) return 'above_average';
        if (result.value < -0.1) return 'below_average';
        return 'average';
      }
    }

    // OBV のトレンドで判定（フォールバック）
    for (const result of indicatorSnapshot.results) {
      if (result.indicatorId === 'obv' && result.value !== undefined) {
        if (result.value > 0) return 'above_average';
        if (result.value < 0) return 'below_average';
      }
    }

    return 'average';
  }

  /**
   * 特徴量ベクトルを生成
   * 
   * ベクトル構成（20次元）:
   * [0] RSI（正規化）
   * [1] SMA乖離率
   * [2] EMA乖離率
   * [3] MACDヒストグラム（正規化）
   * [4] BB位置（正規化）
   * [5] ストキャスティクス%K
   * [6] ATR相対値
   * [7] OBV方向
   * [8] トレンド方向（-1, 0, 1）
   * [9] トレンド強度（正規化）
   * [10] ボラティリティ（0, 0.5, 1）
   * [11] モメンタム（-1, 0, 1）
   * [12-19] 予備（将来の拡張用）
   */
  private generateFeatureVector(
    indicatorSnapshot: IndicatorSnapshot,
    derivedContext: DerivedContext
  ): number[] {
    const vector: number[] = new Array(20).fill(0.5); // デフォルト値で初期化

    for (const result of indicatorSnapshot.results) {
      if (!result.calculated) continue;

      switch (result.indicatorId) {
        case 'rsi':
          if (result.value !== undefined) {
            vector[0] = result.value / 100;
          }
          break;
        case 'stochastic':
          if (result.values?.k) {
            const k = result.values.k as number[];
            if (k.length > 0) {
              vector[5] = k[k.length - 1] / 100;
            }
          }
          break;
        case 'macd':
          if (result.values?.histogram) {
            const hist = result.values.histogram as number[];
            if (hist.length > 0) {
              vector[3] = Math.tanh(hist[hist.length - 1] / 100);
            }
          }
          break;
      }
    }

    // 派生コンテキストからの値
    vector[8] = derivedContext.trend === 'uptrend' ? 1 : derivedContext.trend === 'downtrend' ? -1 : 0;
    vector[9] = derivedContext.trendStrength / 100;
    vector[10] = derivedContext.volatility === 'high' ? 1 : derivedContext.volatility === 'low' ? 0 : 0.5;
    vector[11] = derivedContext.momentum === 'overbought' ? 1 : derivedContext.momentum === 'oversold' ? -1 : 0;

    return vector;
  }

  /**
   * トレードが既に正規化済みかチェック
   */
  private isNormalizedTrade(trade: Trade): trade is NormalizedTrade {
    return 'normalized' in trade && (trade as NormalizedTrade).normalized === true;
  }

  /**
   * モック OHLCV データを生成（市場データ取得失敗時）
   */
  private generateMockOHLCV(trade: NormalizedTrade | Trade): OHLCVData[] {
    const basePrice = trade.price;
    const data: OHLCVData[] = [];
    const timestamp = trade.timestamp instanceof Date ? trade.timestamp : new Date(trade.timestamp);
    
    // 100本のモックデータを生成
    for (let i = 99; i >= 0; i--) {
      const time = new Date(timestamp.getTime() - i * 15 * 60 * 1000); // 15分足
      const randomFactor = 1 + (Math.random() - 0.5) * 0.02; // ±1%の変動
      const close = basePrice * randomFactor;
      const high = close * (1 + Math.random() * 0.005);
      const low = close * (1 - Math.random() * 0.005);
      const open = (close + low + high) / 3;
      
      data.push({
        timestamp: time,
        open,
        high,
        low,
        close,
        volume: Math.random() * 1000000,
      });
    }
    
    return data;
  }
}

// シングルトンインスタンスをエクスポート
export const tradeDefinitionService = new TradeDefinitionService();
