/**
 * マーケット分析API ルート
 * 
 * 目的:
 * - OHLCVデータ取得と12次元特徴量計算を一括で行うエンドポイント
 * - フロントエンドのマーケット分析ページ用
 * 
 * エンドポイント:
 * - GET /api/market-analysis/:symbol - シンボルのOHLCV + 特徴量を取得
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import { MarketDataService } from '../../services/marketDataService';
import type { OHLCVData } from '../../services/indicators';
import { indicatorService } from '../../services/indicators';
import type {
  FeatureVector12D} from '../../services/featureVectorService';
import {
  generateFeatureVector,
  DIMENSION_INDEX,
} from '../../services/featureVectorService';

const router = Router();
const marketDataService = new MarketDataService();

/**
 * 表示・URL互換用にスラッシュ区切りへ正規化（例: XAUUSD → XAU/USD）
 * 履歴取得は cTrader 経由; 内部でブローカー名へ解決される
 */
function normalizeSymbol(symbol: string): string {
  // すでに / が含まれている場合はそのまま返す
  if (symbol.includes('/')) {
    return symbol;
  }

  // USD で終わるシンボルに / を挿入
  if (symbol.endsWith('USD')) {
    const base = symbol.slice(0, -3);
    return `${base}/USD`;
  }

  // JPY で終わるシンボルに / を挿入
  if (symbol.endsWith('JPY')) {
    const base = symbol.slice(0, -3);
    return `${base}/JPY`;
  }

  return symbol;
}

/**
 * 12次元特徴量の各次元に対するラベル定義
 */
const DIMENSION_LABELS: Record<number, { name: string; description: string }> = {
  [DIMENSION_INDEX.TREND_DIRECTION]: { name: 'トレンド方向', description: '-1(下降)〜1(上昇)' },
  [DIMENSION_INDEX.TREND_STRENGTH]: { name: 'トレンド強度', description: '0(弱い)〜1(強い)' },
  [DIMENSION_INDEX.TREND_ALIGNMENT]: { name: 'トレンド整合性', description: 'MA方向一致度' },
  [DIMENSION_INDEX.MACD_HISTOGRAM]: { name: 'MACDヒストグラム', description: '-1〜1モメンタム' },
  [DIMENSION_INDEX.MACD_CROSSOVER]: { name: 'MACDクロス', description: '0(売)〜1(買)' },
  [DIMENSION_INDEX.RSI_VALUE]: { name: 'RSI値', description: '0〜1に正規化' },
  [DIMENSION_INDEX.RSI_ZONE]: { name: 'RSIゾーン', description: '0(売られすぎ)〜1(買われすぎ)' },
  [DIMENSION_INDEX.BB_POSITION]: { name: 'BB位置', description: '0(下限)〜1(上限)' },
  [DIMENSION_INDEX.BB_WIDTH]: { name: 'BBバンド幅', description: '0(狭い)〜1(広い)' },
  [DIMENSION_INDEX.CANDLE_BODY]: { name: 'ローソク実体', description: '0〜1(実体/全体比)' },
  [DIMENSION_INDEX.CANDLE_DIRECTION]: { name: 'ローソク方向', description: '0(陰線)〜1(陽線)' },
  [DIMENSION_INDEX.SESSION_FLAG]: { name: 'セッション', description: '0.2東京/0.5ロンドン/0.8NY' },
};

/**
 * 特徴量ベクトルを詳細形式に変換
 */
function formatFeatureVector(vector: FeatureVector12D): Array<{
  index: number;
  name: string;
  description: string;
  value: number;
  displayValue: string;
}> {
  return vector.map((value, index) => {
    const label = DIMENSION_LABELS[index] || { name: `次元${index}`, description: '' };
    return {
      index,
      name: label.name,
      description: label.description,
      value,
      displayValue: value.toFixed(3),
    };
  });
}

/**
 * GET /api/market-analysis/:symbol
 * 
 * シンボルのOHLCVデータと12次元特徴量を取得
 * 
 * パラメータ:
 * - symbol: 銘柄シンボル（例: XAUUSD, EURUSD）
 * 
 * クエリ:
 * - timeframe: 時間足（デフォルト: 1m）
 * - count: 取得本数（デフォルト: 60）
 */
router.get('/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const timeframe = (req.query.timeframe as string) || '1m';
    const count = parseInt(req.query.count as string) || 60;

    const normalizedSymbol = normalizeSymbol(symbol);

    console.log(`[MarketAnalysis] ${symbol} → ${normalizedSymbol} ${timeframe} × ${count}本 取得開始`);

    // OHLCVデータを取得
    let ohlcvData: OHLCVData[];

    // すべての時間足に対応（1m専用メソッドは廃止）
    const marketData = await marketDataService.getHistoricalData(normalizedSymbol, timeframe, count);
    ohlcvData = marketData.map(d => ({
      timestamp: d.timestamp,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));

    if (ohlcvData.length === 0) {
      return res.status(404).json({
        success: false,
        error: `${symbol} のデータが取得できませんでした`,
      });
    }

    // インジケーターを計算
    const closes = ohlcvData.map(d => d.close);
    const highs = ohlcvData.map(d => d.high);
    const lows = ohlcvData.map(d => d.low);

    // RSI計算（期間14）
    const rsiValues = closes.length >= 15 ? indicatorService.calculateRSI(closes, 14) : [];
    const latestRsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;

    // MACD計算（12, 26, 9）
    const macdResult = closes.length >= 27
      ? indicatorService.calculateMACD(closes, 12, 26, 9)
      : { macdLine: [], signalLine: [], histogram: [] };
    const latestMacdHist = macdResult.histogram.length > 0
      ? macdResult.histogram[macdResult.histogram.length - 1]
      : 0;

    // SMA計算（20期間）
    const smaValues = closes.length >= 20 ? indicatorService.calculateSMA(closes, 20) : [];
    const latestSma = smaValues.length > 0 ? smaValues[smaValues.length - 1] : closes[closes.length - 1];

    // ボリンジャーバンド計算（20期間）
    const bbResult = closes.length >= 20
      ? indicatorService.calculateBollingerBands(closes, 20)
      : { upperBand: [], middleBand: [], lowerBand: [] };

    const latestBbUpper = bbResult.upperBand.length > 0 ? bbResult.upperBand[bbResult.upperBand.length - 1] : 0;
    const latestBbLower = bbResult.lowerBand.length > 0 ? bbResult.lowerBand[bbResult.lowerBand.length - 1] : 0;
    const latestBbMiddle = bbResult.middleBand.length > 0 ? bbResult.middleBand[bbResult.middleBand.length - 1] : 0;

    // 最新のOHLCVデータ
    const latestOhlcv = ohlcvData[ohlcvData.length - 1];

    // インジケーターデータを構築
    const indicatorData = {
      rsi: latestRsi,
      rsiZone: latestRsi >= 70 ? 'overbought' as const : latestRsi <= 30 ? 'oversold' as const : 'neutral' as const,
      macdHistogram: latestMacdHist,
      macdCrossover: latestMacdHist > 0 ? 'bullish' as const : latestMacdHist < 0 ? 'bearish' as const : 'none' as const,
      sma: latestSma,
      smaSlope: smaValues.length >= 2
        ? (smaValues[smaValues.length - 1] > smaValues[smaValues.length - 2] ? 'up' as const : 'down' as const)
        : 'flat' as const,
      priceVsSma: latestOhlcv.close > latestSma ? 'above' as const : 'below' as const,
      bbUpper: latestBbUpper,
      bbMiddle: latestBbMiddle,
      bbLower: latestBbLower,
      bbPosition: latestBbUpper !== latestBbLower
        ? (latestOhlcv.close - latestBbLower) / (latestBbUpper - latestBbLower)
        : 0.5,
      bbWidth: latestBbMiddle > 0 ? (latestBbUpper - latestBbLower) / latestBbMiddle : 0,
      close: latestOhlcv.close,
    };

    // 12次元特徴量ベクトルを生成
    const latestTimestamp = latestOhlcv.timestamp instanceof Date
      ? latestOhlcv.timestamp
      : new Date(latestOhlcv.timestamp);

    const featureVector = generateFeatureVector({
      ohlcv: latestOhlcv,
      indicators: indicatorData,
      timestamp: latestTimestamp,
    });

    // 市場状態の判定
    let marketCondition = 'ニュートラル';
    if (latestRsi >= 70 && featureVector[DIMENSION_INDEX.TREND_DIRECTION] > 0.3) {
      marketCondition = '買われすぎ・上昇トレンド';
    } else if (latestRsi <= 30 && featureVector[DIMENSION_INDEX.TREND_DIRECTION] < -0.3) {
      marketCondition = '売られすぎ・下降トレンド';
    } else if (featureVector[DIMENSION_INDEX.TREND_DIRECTION] > 0.5) {
      marketCondition = '強い上昇トレンド';
    } else if (featureVector[DIMENSION_INDEX.TREND_DIRECTION] < -0.5) {
      marketCondition = '強い下降トレンド';
    } else if (featureVector[DIMENSION_INDEX.BB_WIDTH] < 0.3) {
      marketCondition = 'レンジ相場（ボラ低下）';
    }

    console.log(`[MarketAnalysis] ${symbol} 分析完了: ${marketCondition}`);

    res.json({
      success: true,
      data: {
        symbol,
        timeframe,
        timestamp: new Date().toISOString(),

        // OHLCVデータ（チャート表示用）
        ohlcv: ohlcvData.map(d => {
          const ts = d.timestamp instanceof Date ? d.timestamp : new Date(d.timestamp);
          return {
            timestamp: ts.toISOString(),
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume: d.volume,
          };
        }),

        // 最新価格情報
        latestPrice: {
          open: latestOhlcv.open,
          high: latestOhlcv.high,
          low: latestOhlcv.low,
          close: latestOhlcv.close,
          volume: latestOhlcv.volume,
        },

        // インジケーター値
        indicators: {
          rsi: latestRsi,
          macdHistogram: latestMacdHist,
          sma20: latestSma,
          bbUpper: latestBbUpper,
          bbMiddle: latestBbMiddle,
          bbLower: latestBbLower,
        },

        // 12次元特徴量
        featureVector: {
          raw: featureVector,
          detailed: formatFeatureVector(featureVector),
        },

        // 市場状態の判定
        marketCondition,

        // メタデータ
        meta: {
          dataPoints: ohlcvData.length,
          analysisTime: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    console.error('[MarketAnalysis] エラー:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'マーケット分析に失敗しました',
    });
  }
});

export default router;
