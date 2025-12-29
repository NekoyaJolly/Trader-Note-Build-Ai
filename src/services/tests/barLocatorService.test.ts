/**
 * BarLocator サービスのテストスイート
 *
 * テスト項目:
 * 1. Bar Start Time Calculation: 時間足の開始時刻計算
 * 2. Holiday Detection: 祝日判定
 * 3. Timeframe Milliseconds: 時間足のミリ秒変換
 */

import { describe, it, expect } from '@jest/globals';
import { BarLocator } from '../barLocatorService';

describe('BarLocator', () => {
  const locator = new BarLocator();

  describe('barStartTimeCalculation', () => {
    it('1h 時間足: 時間単位で切り捨て', () => {
      const time = new Date('2024-01-01T12:45:30.500Z');
      const expected = new Date('2024-01-01T12:00:00Z');

      const result = (locator as any).calculateBarStartTime(time, '1h');

      expect(result).toEqual(expected);
    });

    it('15m 時間足: 15分単位で切り捨て', () => {
      const time = new Date('2024-01-01T12:47:30Z');
      const expected = new Date('2024-01-01T12:45:00Z');

      const result = (locator as any).calculateBarStartTime(time, '15m');

      expect(result).toEqual(expected);
    });

    it('1d 時間足: UTC の 00:00', () => {
      const time = new Date('2024-01-01T14:30:00Z');
      const expected = new Date('2024-01-01T00:00:00Z');

      const result = (locator as any).calculateBarStartTime(time, '1d');

      expect(result).toEqual(expected);
    });

    it('4h 時間足: 4時間単位で切り捨て（UTC 基準）', () => {
      const time1 = new Date('2024-01-01T05:30:00Z');
      const expected1 = new Date('2024-01-01T04:00:00Z');

      const time2 = new Date('2024-01-01T10:30:00Z');
      const expected2 = new Date('2024-01-01T08:00:00Z');

      expect((locator as any).calculateBarStartTime(time1, '4h')).toEqual(expected1);
      expect((locator as any).calculateBarStartTime(time2, '4h')).toEqual(expected2);
    });

    it('5m 時間足: 5分単位で切り捨て', () => {
      const time = new Date('2024-01-01T12:38:45Z');
      const expected = new Date('2024-01-01T12:35:00Z');

      const result = (locator as any).calculateBarStartTime(time, '5m');

      expect(result).toEqual(expected);
    });
  });

  describe('holidayDetection', () => {
    it('日本の祝日を判定 - 元日', () => {
      const newYearsDay = new Date('2024-01-01'); // 元日
      expect((locator as any).isJapaneseHoliday(newYearsDay)).toBe(true);
    });

    it('日本の祝日を判定 - 通常日', () => {
      const normalDay = new Date('2024-01-04'); // 木曜日
      expect((locator as any).isJapaneseHoliday(normalDay)).toBe(false);
    });

    it('土日を判定 - 日曜日', () => {
      const sunday = new Date('2024-01-07'); // 日曜日
      expect((locator as any).isJapaneseHoliday(sunday)).toBe(true);
    });

    it('土日を判定 - 土曜日', () => {
      const saturday = new Date('2024-01-06'); // 土曜日
      expect((locator as any).isJapaneseHoliday(saturday)).toBe(true);
    });

    it('土日を判定 - 平日', () => {
      const weekday = new Date('2024-01-08'); // 月曜日
      expect((locator as any).isJapaneseHoliday(weekday)).toBe(false);
    });

    it('アメリカの祝日を判定 - 元日', () => {
      const newYearsDay = new Date('2024-01-01'); // 元日
      expect((locator as any).isUSHoliday(newYearsDay)).toBe(true);
    });

    it('アメリカの祝日を判定 - 独立記念日', () => {
      const independenceDay = new Date('2024-07-04'); // 独立記念日
      expect((locator as any).isUSHoliday(independenceDay)).toBe(true);
    });

    it('アメリカの祝日を判定 - 通常日', () => {
      const normalDay = new Date('2024-01-04');
      expect((locator as any).isUSHoliday(normalDay)).toBe(false);
    });
  });

  describe('timeframeMilliseconds', () => {
    it('1m を変換', () => {
      expect((locator as any).getTimeframeMs('1m')).toBe(60 * 1000);
    });

    it('5m を変換', () => {
      expect((locator as any).getTimeframeMs('5m')).toBe(5 * 60 * 1000);
    });

    it('15m を変換', () => {
      expect((locator as any).getTimeframeMs('15m')).toBe(15 * 60 * 1000);
    });

    it('1h を変換', () => {
      expect((locator as any).getTimeframeMs('1h')).toBe(60 * 60 * 1000);
    });

    it('4h を変換', () => {
      expect((locator as any).getTimeframeMs('4h')).toBe(4 * 60 * 60 * 1000);
    });

    it('1d を変換', () => {
      expect((locator as any).getTimeframeMs('1d')).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('confidenceCalculation', () => {
    it('時間差が小さいほど信頼度が高い', () => {
      const timeDiff1 = 2 * 60 * 1000; // 2分
      const timeDiff2 = 30 * 60 * 1000; // 30分

      const conf1 = (locator as any).calculateConfidence(timeDiff1);
      const conf2 = (locator as any).calculateConfidence(timeDiff2);

      expect(conf1).toBeGreaterThan(conf2);
    });

    it('5分以内は高信頼度', () => {
      const timeDiff = 3 * 60 * 1000; // 3分
      const confidence = (locator as any).calculateConfidence(timeDiff);

      expect(confidence).toBeGreaterThan(0.9);
    });

    it('30分以内は中信頼度', () => {
      const timeDiff = 20 * 60 * 1000; // 20分
      const confidence = (locator as any).calculateConfidence(timeDiff);

      expect(confidence).toBeGreaterThan(0.7);
      expect(confidence).toBeLessThan(0.9);
    });
  });
});
