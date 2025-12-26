/**
 * 特徴量抽出サービス
 * 
 * 目的: トレードデータから数値特徴量を計算し、Phase3 の判定ロジックで使用可能な形式にする
 * 
 * 重要: このサービスは「分かりやすさ」を最優先とし、高度な ML や最適化は行わない
 *       Phase3 の判定ロジックが読みやすいよう、明確な特徴量を提供する
 */

import { Trade, Prisma } from '@prisma/client';

/**
 * 特徴量ベクトルの定義（固定長: 7）
 * 
 * インデックス定義:
 * [0] 価格変化率 (相対的な価格変動を表す、-1.0 〜 1.0 の範囲)
 * [1] 取引量 (正規化された取引量)
 * [2] RSI (0 〜 100 の範囲、市場の買われすぎ・売られすぎを示す)
 * [3] MACD (移動平均収束拡散、トレンドの勢いを示す)
 * [4] トレンド方向 (-1: 下降、0: 横ばい、1: 上昇)
 * [5] ボラティリティ (価格変動の激しさ、0 〜 1 の範囲)
 * [6] 時間帯フラグ (0: 通常時間、1: 市場オープン/クローズ付近)
 */
export interface FeatureVector {
  values: number[];  // 固定長 7 の配列
  version: string;   // 特徴量計算のバージョン (互換性管理用)
}

/**
 * 市場コンテキスト（特徴量計算に必要な補助データ）
 */
export interface MarketContext {
  previousClose?: number;    // 前日終値 (価格変化率計算に使用)
  averageVolume?: number;    // 平均取引量 (正規化に使用)
  rsi?: number;              // RSI 指標 (外部計算値を受け入れる)
  macd?: number;             // MACD 指標 (外部計算値を受け入れる)
  timeframe?: string;        // タイムフレーム (例: '15m', '1h')
  marketHours?: {
    isOpen: boolean;
    isNearOpen: boolean;
    isNearClose: boolean;
  };
}

/**
 * 特徴量抽出サービス
 * 
 * Phase2 では最低限の特徴量のみを計算し、
 * Phase3 以降で必要に応じて拡張する方針
 */
export class FeatureExtractor {
  // バージョン管理用の定数
  private static readonly FEATURE_VERSION = '1.0.0';
  
  // 特徴量ベクトルの固定長
  private static readonly FEATURE_LENGTH = 7;

  /**
   * トレードデータから特徴量ベクトルを抽出する
   * 
   * @param trade - トレードデータ
   * @param context - 市場コンテキスト (オプション)
   * @returns 特徴量ベクトル (固定長 7)
   * 
   * 前提条件:
   * - trade.price は 0 より大きい値
   * - trade.quantity は 0 より大きい値
   * 
   * 副作用:
   * - なし (純粋関数)
   */
  extractFeatures(trade: Trade, context?: MarketContext): FeatureVector {
    const features = new Array(FeatureExtractor.FEATURE_LENGTH).fill(0);

    // Decimal を number に変換
    const price = typeof trade.price === 'number' ? trade.price : Number(trade.price);
    const quantity = typeof trade.quantity === 'number' ? trade.quantity : Number(trade.quantity);

    // [0] 価格変化率を計算
    features[0] = this.calculatePriceChange(price, context?.previousClose);

    // [1] 取引量を正規化
    features[1] = this.normalizeVolume(quantity, context?.averageVolume);

    // [2] RSI (外部から提供された場合はそのまま使用、なければ 50 をデフォルト)
    features[2] = this.normalizeRSI(context?.rsi);

    // [3] MACD (外部から提供された場合はそのまま使用、なければ 0 をデフォルト)
    features[3] = this.normalizeMACD(context?.macd);

    // [4] トレンド方向 (価格変化率から推定)
    features[4] = this.calculateTrend(features[0]);

    // [5] ボラティリティ (現時点では価格変化率の絶対値で近似)
    features[5] = this.calculateVolatility(features[0]);

    // [6] 時間帯フラグ
    features[6] = this.calculateTimeFlag(trade.timestamp, context?.marketHours);

    return {
      values: features,
      version: FeatureExtractor.FEATURE_VERSION,
    };
  }

  /**
   * 価格変化率を計算する
   * 
   * @param currentPrice - 現在価格
   * @param previousClose - 前日終値 (オプション)
   * @returns 価格変化率 (-1.0 〜 1.0 の範囲にクリップ)
   * 
   * 計算式: (currentPrice - previousClose) / previousClose
   * 前日終値がない場合は 0 を返す
   */
  private calculatePriceChange(currentPrice: number, previousClose?: number): number {
    if (!previousClose || previousClose <= 0) {
      return 0;
    }

    const change = (currentPrice - previousClose) / previousClose;
    
    // -1.0 〜 1.0 の範囲にクリップ (極端な値を防ぐ)
    return Math.max(-1.0, Math.min(1.0, change));
  }

  /**
   * 取引量を正規化する
   * 
   * @param volume - 取引量
   * @param averageVolume - 平均取引量 (オプション)
   * @returns 正規化された取引量 (0 〜 1 の範囲)
   * 
   * 計算式: min(volume / (averageVolume * 2), 1.0)
   * 平均取引量がない場合は 0.5 をデフォルトとする
   */
  private normalizeVolume(volume: number, averageVolume?: number): number {
    if (!averageVolume || averageVolume <= 0) {
      return 0.5; // デフォルト値: 中間
    }

    // 平均の 2 倍を上限として正規化
    const normalized = volume / (averageVolume * 2);
    return Math.min(1.0, normalized);
  }

  /**
   * RSI を正規化する
   * 
   * @param rsi - RSI 値 (0 〜 100 の範囲、オプション)
   * @returns 正規化された RSI (0 〜 1 の範囲)
   * 
   * RSI が提供されない場合は 0.5 (中立) を返す
   */
  private normalizeRSI(rsi?: number): number {
    if (rsi === undefined || rsi === null) {
      return 0.5; // デフォルト値: 中立
    }

    // 0 〜 100 を 0 〜 1 に変換
    return Math.max(0, Math.min(1, rsi / 100));
  }

  /**
   * MACD を正規化する
   * 
   * @param macd - MACD 値 (オプション)
   * @returns 正規化された MACD (-1 〜 1 の範囲)
   * 
   * MACD が提供されない場合は 0 (中立) を返す
   * 実際の MACD は範囲が広いため、tanh で -1 〜 1 に変換
   */
  private normalizeMACD(macd?: number): number {
    if (macd === undefined || macd === null) {
      return 0; // デフォルト値: 中立
    }

    // tanh を使って -1 〜 1 の範囲に変換
    return Math.tanh(macd / 10);
  }

  /**
   * トレンド方向を計算する
   * 
   * @param priceChange - 価格変化率
   * @returns トレンド方向 (-1: 下降、0: 横ばい、1: 上昇)
   * 
   * 閾値: ±0.01 (1%) で判定
   */
  private calculateTrend(priceChange: number): number {
    const threshold = 0.01; // 1% の変動で判定

    if (priceChange > threshold) {
      return 1; // 上昇トレンド
    } else if (priceChange < -threshold) {
      return -1; // 下降トレンド
    } else {
      return 0; // 横ばい
    }
  }

  /**
   * ボラティリティを計算する
   * 
   * @param priceChange - 価格変化率
   * @returns ボラティリティ (0 〜 1 の範囲)
   * 
   * Phase2 では価格変化率の絶対値で近似
   * Phase3 以降で標準偏差ベースに変更する可能性あり
   */
  private calculateVolatility(priceChange: number): number {
    return Math.abs(priceChange);
  }

  /**
   * 時間帯フラグを計算する
   * 
   * @param timestamp - トレードのタイムスタンプ
   * @param marketHours - 市場営業時間情報 (オプション)
   * @returns 時間帯フラグ (0: 通常時間、1: オープン/クローズ付近)
   * 
   * 市場のオープン/クローズ付近は価格変動が大きい傾向があるため、
   * この情報を特徴量として含める
   */
  private calculateTimeFlag(timestamp: Date, marketHours?: MarketContext['marketHours']): number {
    if (!marketHours) {
      return 0; // デフォルト値: 通常時間
    }

    // オープン/クローズ付近の場合は 1、それ以外は 0
    if (marketHours.isNearOpen || marketHours.isNearClose) {
      return 1;
    }

    return 0;
  }

  /**
   * 特徴量ベクトルを文字列で説明する (デバッグ用)
   * 
   * @param featureVector - 特徴量ベクトル
   * @returns 人間が読める説明文
   */
  describeFeatures(featureVector: FeatureVector): string {
    const [priceChange, volume, rsi, macd, trend, volatility, timeFlag] = featureVector.values;

    const trendLabel = trend > 0 ? '上昇' : trend < 0 ? '下降' : '横ばい';
    const timeLabel = timeFlag > 0 ? 'オープン/クローズ付近' : '通常時間';

    return [
      `価格変化率: ${(priceChange * 100).toFixed(2)}%`,
      `取引量: ${(volume * 100).toFixed(0)}%`,
      `RSI: ${(rsi * 100).toFixed(0)}`,
      `MACD: ${macd.toFixed(2)}`,
      `トレンド: ${trendLabel}`,
      `ボラティリティ: ${(volatility * 100).toFixed(2)}%`,
      `時間帯: ${timeLabel}`,
    ].join(' / ');
  }
}
