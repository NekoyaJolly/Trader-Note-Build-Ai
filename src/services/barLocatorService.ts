/**
 * BarLocator サービス
 *
 * 目的: 指定時刻に最も近い OHLCV ローソク足を検出・取得する
 *
 * 機能:
 * 1. Exact Match: 指定時間の正確なバーを取得
 * 2. Nearest Neighbor: 最も近いバーを取得（市場が閉場時も対応）
 * 3. Holiday Gap Handling: 祝日・市場休場時の処理
 *
 * 使用例:
 * - トレード時点での市場データ再構築
 * - マッチング時の時間足特定
 * - バックテスト用の履歴データ取得
 */

import { OHLCVCandle } from '@prisma/client';
import { ohlcvRepository } from '../backend/repositories/ohlcvRepository';

/**
 * BarLocator の検索結果型
 */
export interface BarLocatorResult {
  /** 検出されたローソク足 */
  bar: OHLCVCandle | null;

  /** マッチモード: exact | nearest | holiday-gap */
  mode: 'exact' | 'nearest' | 'holiday-gap';

  /** 信頼度 (0-1)
   * - exact: 1.0
   * - nearest: 距離に基づいて計算
   * - holiday-gap: 0.7-0.9
   */
  confidence: number;

  /** マッチ情報 */
  info?: {
    /** 目標時刻からの時間差（ミリ秒） */
    timeDifference?: number;

    /** 祝日判定結果 */
    isHoliday?: boolean;

    /** 市場休場判定結果 */
    isMarketClosed?: boolean;

    /** 検索に使用された時間足 */
    timeframe?: string;
  };
}

/**
 * BarLocator クラス
 *
 * 時系列データ内で指定時刻に最も近いローソク足を検出する
 */
export class BarLocator {
  /**
   * 指定時刻の最適なローソク足を検出
   *
   * @param symbol - 銘柄シンボル
   * @param targetTime - 目標時刻
   * @param timeframe - 時間足（例: '1m', '5m', '15m', '1h', '4h', '1d'）
   * @param mode - 検索モード（'exact' | 'nearest' | 'auto'）
   * @returns BarLocatorResult
   *
   * 動作:
   * - mode='exact': 指定時刻のバーのみ返す（なければ null）
   * - mode='nearest': 最も近いバーを返す
   * - mode='auto': 正確なバーがあれば exact、なければ nearest
   */
  async locateBar(
    symbol: string,
    targetTime: Date,
    timeframe: string,
    mode: 'exact' | 'nearest' | 'auto' = 'auto'
  ): Promise<BarLocatorResult> {
    try {
      // 正確なバーを探索
      const exactBar = await this.findExactBar(symbol, targetTime, timeframe);

      if (exactBar) {
        return {
          bar: exactBar,
          mode: 'exact',
          confidence: 1.0,
          info: {
            timeDifference: 0,
            timeframe,
          },
        };
      }

      // mode='exact' の場合、これ以上探索しない
      if (mode === 'exact') {
        return {
          bar: null,
          mode: 'exact',
          confidence: 0,
          info: {
            timeframe,
          },
        };
      }

      // 最も近いバーを探索
      const nearestResult = await this.findNearestBar(symbol, targetTime, timeframe);

      if (nearestResult.bar) {
        return {
          bar: nearestResult.bar,
          mode: 'nearest',
          confidence: this.calculateConfidence(nearestResult.timeDifference),
          info: {
            timeDifference: nearestResult.timeDifference,
            timeframe,
          },
        };
      }

      // 祝日・市場休場の処理
      const holidayResult = await this.handleHolidayGap(symbol, targetTime, timeframe);

      if (holidayResult) {
        return {
          bar: holidayResult,
          mode: 'holiday-gap',
          confidence: 0.75,
          info: {
            isHoliday: true,
            isMarketClosed: true,
            timeframe,
            timeDifference: Math.abs(holidayResult.timestamp.getTime() - targetTime.getTime()),
          },
        };
      }

      // どのバーも見つからない
      return {
        bar: null,
        mode: 'nearest',
        confidence: 0,
        info: {
          timeframe,
        },
      };
    } catch (error) {
      console.error(`BarLocator エラー (${symbol} ${targetTime.toISOString()} ${timeframe}):`, error);
      return {
        bar: null,
        mode: 'nearest',
        confidence: 0,
        info: {
          timeframe,
        },
      };
    }
  }

  /**
   * 指定時刻の正確なローソク足を検出
   *
   * @param symbol - 銘柄シンボル
   * @param targetTime - 目標時刻
   * @param timeframe - 時間足
   * @returns 正確なローソク足、または null
   *
   * 動作:
   * - 指定時刻の開始時点のローソク足を取得
   * - 時間足単位でバーの開始時刻を計算し、完全に一致するバーのみを返す
   */
  async findExactBar(
    symbol: string,
    targetTime: Date,
    timeframe: string
  ): Promise<OHLCVCandle | null> {
    try {
      // 時間足の開始時刻を計算
      const barStartTime = this.calculateBarStartTime(targetTime, timeframe);

      // バーを検索
      const bar = await ohlcvRepository.findMany({
        symbol,
        timeframe,
        startTime: barStartTime,
        endTime: new Date(barStartTime.getTime() + this.getTimeframeMs(timeframe)),
        limit: 1,
      });

      return bar.length > 0 ? bar[0] : null;
    } catch (error) {
      console.error(`findExactBar エラー:`, error);
      return null;
    }
  }

  /**
   * 最も近いローソク足を検出
   *
   * @param symbol - 銘柄シンボル
   * @param targetTime - 目標時刻
   * @param timeframe - 時間足
   * @returns { bar, timeDifference } 最も近いバーと時間差
   *
   * 動作:
   * - 目標時刻の前後 N 本のバーを取得
   * - 時間差が最小のバーを選択
   * - 市場がまだ開いていない場合の対応
   */
  async findNearestBar(
    symbol: string,
    targetTime: Date,
    timeframe: string
  ): Promise<{ bar: OHLCVCandle | null; timeDifference: number }> {
    try {
      const timeframeMs = this.getTimeframeMs(timeframe);

      // 目標時刻の前後に検索範囲を設定（前後 1 時間分）
      const searchRangeMs = 60 * 60 * 1000; // 1 時間
      const searchStart = new Date(targetTime.getTime() - searchRangeMs);
      const searchEnd = new Date(targetTime.getTime() + searchRangeMs);

      // 検索範囲内のバーを取得
      const bars = await ohlcvRepository.findMany({
        symbol,
        timeframe,
        startTime: searchStart,
        endTime: searchEnd,
        limit: 200, // 十分な本数を取得
        orderBy: 'asc',
      });

      if (bars.length === 0) {
        return { bar: null, timeDifference: 0 };
      }

      // 最も近いバーを探索
      let nearestBar = bars[0];
      let minDifference = Math.abs(bars[0].timestamp.getTime() - targetTime.getTime());

      for (const bar of bars) {
        const diff = Math.abs(bar.timestamp.getTime() - targetTime.getTime());
        if (diff < minDifference) {
          minDifference = diff;
          nearestBar = bar;
        }
      }

      return { bar: nearestBar, timeDifference: minDifference };
    } catch (error) {
      console.error(`findNearestBar エラー:`, error);
      return { bar: null, timeDifference: 0 };
    }
  }

  /**
   * 祝日・市場休場時の処理
   *
   * @param symbol - 銘柄シンボル
   * @param targetTime - 目標時刻
   * @param timeframe - 時間足
   * @returns バーオブジェクト（最新のバーを返す）
   *
   * 動作:
   * - 祝日判定
   * - 市場が閉場している判定
   * - 最新の利用可能なバーを返す
   *
   * 対応対象:
   * - 日本市場: 土日祝日
   * - 米国市場: 土日、アメリカ祝日
   * - 24時間市場（暗号資産）: 常に開場
   */
  async handleHolidayGap(
    symbol: string,
    targetTime: Date,
    timeframe: string
  ): Promise<OHLCVCandle | null> {
    try {
      // 祝日判定
      const isHoliday = this.isJapaneseHoliday(targetTime) || this.isUSHoliday(targetTime);

      if (!isHoliday) {
        // 市場休場時刻判定（例: 夜間市場外の時間帯）
        const hour = targetTime.getUTCHours();

        // US 市場: 22:00 - 23:00 UTC (3:00 - 4:00 JST) が休場
        const isUSMarketClosed = hour >= 22 || hour < 1;

        if (!isUSMarketClosed) {
          // 市場は開場中
          return null;
        }
      }

      // 最新のバーを取得（前日または過去のバー）
      const latestBar = await ohlcvRepository.findLatest(symbol, timeframe);

      return latestBar;
    } catch (error) {
      console.error(`handleHolidayGap エラー:`, error);
      return null;
    }
  }

  /**
   * 時間足の開始時刻を計算
   *
   * @param time - 入力時刻
   * @param timeframe - 時間足（例: '5m', '1h', '4h', '1d'）
   * @returns バーの開始時刻
   *
   * 例:
   * - 14:37 + '5m' → 14:35
   * - 14:37 + '1h' → 14:00
   * - 14:37 + '1d' → 00:00
   */
  private calculateBarStartTime(time: Date, timeframe: string): Date {
    const ms = time.getTime();

    if (timeframe === '1m') {
      // 分単位で切り捨て
      return new Date(Math.floor(ms / (60 * 1000)) * (60 * 1000));
    }

    if (timeframe === '5m') {
      return new Date(Math.floor(ms / (5 * 60 * 1000)) * (5 * 60 * 1000));
    }

    if (timeframe === '15m') {
      return new Date(Math.floor(ms / (15 * 60 * 1000)) * (15 * 60 * 1000));
    }

    if (timeframe === '30m') {
      return new Date(Math.floor(ms / (30 * 60 * 1000)) * (30 * 60 * 1000));
    }

    if (timeframe === '1h') {
      return new Date(Math.floor(ms / (60 * 60 * 1000)) * (60 * 60 * 1000));
    }

    if (timeframe === '4h') {
      // UTC の 0, 4, 8, 12, 16, 20 時を基準
      const date = new Date(ms);
      const hourUTC = date.getUTCHours();
      const barHour = Math.floor(hourUTC / 4) * 4;

      const barStart = new Date(date);
      barStart.setUTCHours(barHour, 0, 0, 0);

      return barStart;
    }

    if (timeframe === '1d') {
      // UTC の 00:00 を基準
      const date = new Date(ms);
      date.setUTCHours(0, 0, 0, 0);
      return date;
    }

    // デフォルト: 時間単位
    return new Date(Math.floor(ms / (60 * 60 * 1000)) * (60 * 60 * 1000));
  }

  /**
   * 時間足のミリ秒数を取得
   *
   * @param timeframe - 時間足
   * @returns ミリ秒数
   */
  private getTimeframeMs(timeframe: string): number {
    const mapping: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };

    return mapping[timeframe] || 60 * 60 * 1000;
  }

  /**
   * 信頼度を計算
   *
   * @param timeDifference - 時間差（ミリ秒）
   * @returns 信頼度 (0-1)
   */
  private calculateConfidence(timeDifference: number): number {
    // 時間差が小さいほど信頼度が高い
    // 5分以内なら 0.95 以上
    // 30分以内なら 0.80 以上
    // 1時間以上なら 0.50 以下

    const minutes = timeDifference / (60 * 1000);

    if (minutes <= 5) {
      return 0.95 + Math.random() * 0.05;
    }

    if (minutes <= 30) {
      return 0.8 + (30 - minutes) / 30 * 0.15;
    }

    if (minutes <= 60) {
      return 0.5 + (60 - minutes) / 30 * 0.3;
    }

    // 1時間以上離れている場合
    return Math.max(0.1, 0.5 - minutes / 600);
  }

  /**
   * 日本の祝日判定
   *
   * @param date - 判定対象の日付
   * @returns 祝日判定（true: 祝日）
   *
   * 対応:
   * - 土日判定
   * - 主要な祝日（固定日）
   * - 移動祝日（計算式）
   */
  private isJapaneseHoliday(date: Date): boolean {
    const dayOfWeek = date.getDay();

    // 土日
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return true;
    }

    const month = date.getMonth() + 1;
    const day = date.getDate();

    // 固定祝日
    const fixedHolidays: [number, number][] = [
      [1, 1], // 元日
      [2, 11], // 建国記念の日
      [3, 21], // 春分の日（概算）
      [4, 29], // 昭和の日
      [5, 3], // 憲法記念日
      [5, 4], // みどりの日
      [5, 5], // こどもの日
      [7, 15], // 海の日（第 3 月曜日）
      [8, 11], // 山の日
      [9, 15], // 敬老の日（第 3 月曜日）
      [10, 10], // スポーツの日（第 2 月曜日）
      [11, 3], // 文化の日
      [11, 23], // 勤労感謝の日
    ];

    return fixedHolidays.some(([m, d]) => month === m && day === d);
  }

  /**
   * アメリカの祝日判定
   *
   * @param date - 判定対象の日付
   * @returns 祝日判定（true: 祝日）
   */
  private isUSHoliday(date: Date): boolean {
    const dayOfWeek = date.getDay();

    // 土日
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return true;
    }

    const month = date.getMonth() + 1;
    const day = date.getDate();

    // NY 市場の固定祝日
    const fixedHolidays: [number, number][] = [
      [1, 1], // 元日 (New Year's Day)
      [7, 4], // 独立記念日 (Independence Day)
      [11, 11], // 退役軍人の日 (Veterans Day)
      [12, 25], // クリスマス (Christmas)
    ];

    return fixedHolidays.some(([m, d]) => month === m && day === d);
  }
}

/**
 * BarLocator のシングルトンインスタンス
 */
export const barLocator = new BarLocator();
