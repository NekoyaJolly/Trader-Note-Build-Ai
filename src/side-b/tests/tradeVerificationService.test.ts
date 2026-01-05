/**
 * トレード検証サービス テスト
 * 
 * 高安値ベース検証ロジックのユニットテスト
 * - エントリー条件判定（Long/Short）
 * - 決済条件判定（SL/TP）
 * - 同一バーでのSL/TP両方ヒット時の優先順位
 * - 境界値テスト
 */

import {
  verifyEntryCondition,
  verifyExitCondition,
  verifyTradeState,
  sortOHLCVChronological,
  summarizeVerificationResult,
  type MinuteOHLCV,
} from '../services/tradeVerificationService';

// ===========================================
// テストデータ生成ヘルパー
// ===========================================

/**
 * 1分足OHLCVデータを生成
 */
function createMinuteBar(params: {
  timestamp?: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}): MinuteOHLCV {
  return {
    timestamp: params.timestamp ?? new Date(),
    open: params.open,
    high: params.high,
    low: params.low,
    close: params.close,
    volume: 1000,
  };
}

/**
 * 連続した1分足データを生成
 */
function createMinuteBars(bars: Array<{
  open: number;
  high: number;
  low: number;
  close: number;
}>): MinuteOHLCV[] {
  const baseTime = new Date('2026-01-05T10:00:00Z');
  return bars.map((bar, index) => ({
    ...bar,
    timestamp: new Date(baseTime.getTime() + index * 60 * 1000),
    volume: 1000,
  }));
}

// ===========================================
// エントリー検証テスト
// ===========================================

describe('verifyEntryCondition', () => {
  describe('Long エントリー', () => {
    it('安値が予定価格以下になった場合、エントリーが発生する', () => {
      const ohlcvData = createMinuteBars([
        { open: 2010, high: 2015, low: 2005, close: 2012 }, // 安値2005 <= 予定2000ではない
        { open: 2008, high: 2010, low: 1998, close: 2002 }, // 安値1998 <= 予定2000 ✓
      ]);

      const result = verifyEntryCondition(ohlcvData, 'long', 2000);

      expect(result.triggered).toBe(true);
      expect(result.entryPrice).toBe(2000); // 予定価格で約定
      expect(result.entryTime).toEqual(ohlcvData[1].timestamp);
    });

    it('始値が予定価格以下の場合（ギャップダウン）、始値で約定する', () => {
      const ohlcvData = createMinuteBars([
        { open: 1995, high: 2000, low: 1990, close: 1998 }, // 始値1995 <= 予定2000
      ]);

      const result = verifyEntryCondition(ohlcvData, 'long', 2000);

      expect(result.triggered).toBe(true);
      expect(result.entryPrice).toBe(1995); // 始値で約定（より有利）
    });

    it('条件を満たさない場合、エントリーは発生しない', () => {
      const ohlcvData = createMinuteBars([
        { open: 2010, high: 2015, low: 2005, close: 2012 }, // 安値2005 > 予定2000
        { open: 2012, high: 2018, low: 2008, close: 2015 }, // 安値2008 > 予定2000
      ]);

      const result = verifyEntryCondition(ohlcvData, 'long', 2000);

      expect(result.triggered).toBe(false);
      expect(result.entryPrice).toBeUndefined();
    });
  });

  describe('Short エントリー', () => {
    it('高値が予定価格以上になった場合、エントリーが発生する', () => {
      const ohlcvData = createMinuteBars([
        { open: 1990, high: 1995, low: 1985, close: 1992 }, // 高値1995 < 予定2000
        { open: 1995, high: 2005, low: 1992, close: 1998 }, // 高値2005 >= 予定2000 ✓
      ]);

      const result = verifyEntryCondition(ohlcvData, 'short', 2000);

      expect(result.triggered).toBe(true);
      expect(result.entryPrice).toBe(2000); // 予定価格で約定
    });

    it('始値が予定価格以上の場合（ギャップアップ）、始値で約定する', () => {
      const ohlcvData = createMinuteBars([
        { open: 2008, high: 2015, low: 2005, close: 2010 }, // 始値2008 >= 予定2000
      ]);

      const result = verifyEntryCondition(ohlcvData, 'short', 2000);

      expect(result.triggered).toBe(true);
      expect(result.entryPrice).toBe(2008); // 始値で約定（より有利）
    });
  });

  describe('エッジケース', () => {
    it('空のOHLCVデータの場合、エントリーは発生しない', () => {
      const result = verifyEntryCondition([], 'long', 2000);

      expect(result.triggered).toBe(false);
      expect(result.reason).toContain('データがありません');
    });

    it('予定価格と安値/高値が完全一致した場合、エントリーが発生する', () => {
      const ohlcvData = createMinuteBars([
        { open: 2005, high: 2010, low: 2000, close: 2008 }, // 安値2000 == 予定2000
      ]);

      const result = verifyEntryCondition(ohlcvData, 'long', 2000);

      expect(result.triggered).toBe(true);
      expect(result.entryPrice).toBe(2000);
    });
  });
});

// ===========================================
// 決済検証テスト
// ===========================================

describe('verifyExitCondition', () => {
  describe('Long ポジション', () => {
    it('安値がSL以下になった場合、ストップロスで決済される', () => {
      const ohlcvData = createMinuteBars([
        { open: 2010, high: 2015, low: 2005, close: 2012 }, // 安値2005 > SL1990
        { open: 2000, high: 2005, low: 1985, close: 1990 }, // 安値1985 <= SL1990 ✓
      ]);

      const result = verifyExitCondition(ohlcvData, 'long', 1990, 2050);

      expect(result.triggered).toBe(true);
      expect(result.exitReason).toBe('stop_loss');
      expect(result.exitPrice).toBe(1990); // SL価格で決済
    });

    it('高値がTP以上になった場合、テイクプロフィットで決済される', () => {
      const ohlcvData = createMinuteBars([
        { open: 2010, high: 2020, low: 2005, close: 2015 }, // 高値2020 < TP2050
        { open: 2020, high: 2055, low: 2015, close: 2050 }, // 高値2055 >= TP2050 ✓
      ]);

      const result = verifyExitCondition(ohlcvData, 'long', 1990, 2050);

      expect(result.triggered).toBe(true);
      expect(result.exitReason).toBe('take_profit');
      expect(result.exitPrice).toBe(2050); // TP価格で決済
    });
  });

  describe('Short ポジション', () => {
    it('高値がSL以上になった場合、ストップロスで決済される', () => {
      const ohlcvData = createMinuteBars([
        { open: 1990, high: 1995, low: 1985, close: 1988 }, // 高値1995 < SL2010
        { open: 2000, high: 2015, low: 1995, close: 2010 }, // 高値2015 >= SL2010 ✓
      ]);

      const result = verifyExitCondition(ohlcvData, 'short', 2010, 1950);

      expect(result.triggered).toBe(true);
      expect(result.exitReason).toBe('stop_loss');
      expect(result.exitPrice).toBe(2010); // SL価格で決済
    });

    it('安値がTP以下になった場合、テイクプロフィットで決済される', () => {
      const ohlcvData = createMinuteBars([
        { open: 1980, high: 1985, low: 1970, close: 1975 }, // 安値1970 > TP1950
        { open: 1965, high: 1970, low: 1945, close: 1950 }, // 安値1945 <= TP1950 ✓
      ]);

      const result = verifyExitCondition(ohlcvData, 'short', 2010, 1950);

      expect(result.triggered).toBe(true);
      expect(result.exitReason).toBe('take_profit');
      expect(result.exitPrice).toBe(1950); // TP価格で決済
    });
  });

  describe('SL/TP同時ヒット（保守的判定）', () => {
    it('Long: 同一バーでSL/TP両方ヒットした場合、SLを優先する', () => {
      // 大きなボラティリティでSL/TP両方を貫通
      const ohlcvData = createMinuteBars([
        { open: 2000, high: 2060, low: 1980, close: 2010 }, // 安値1980 <= SL1990 かつ 高値2060 >= TP2050
      ]);

      const result = verifyExitCondition(ohlcvData, 'long', 1990, 2050);

      expect(result.triggered).toBe(true);
      expect(result.exitReason).toBe('stop_loss'); // 保守的にSL優先
      expect(result.reason).toContain('同時ヒット');
    });

    it('Short: 同一バーでSL/TP両方ヒットした場合、SLを優先する', () => {
      const ohlcvData = createMinuteBars([
        { open: 2000, high: 2015, low: 1940, close: 1960 }, // 高値2015 >= SL2010 かつ 安値1940 <= TP1950
      ]);

      const result = verifyExitCondition(ohlcvData, 'short', 2010, 1950);

      expect(result.triggered).toBe(true);
      expect(result.exitReason).toBe('stop_loss'); // 保守的にSL優先
    });
  });

  describe('ギャップ決済', () => {
    it('Long: 始値がSL以下でギャップダウンした場合、始値で決済される', () => {
      const ohlcvData = createMinuteBars([
        { open: 1985, high: 1990, low: 1980, close: 1988 }, // 始値1985 <= SL1990
      ]);

      const result = verifyExitCondition(ohlcvData, 'long', 1990, 2050);

      expect(result.triggered).toBe(true);
      expect(result.exitPrice).toBe(1985); // 始値（ギャップ）で決済
    });

    it('Long: 始値がTP以上でギャップアップした場合、始値で決済される', () => {
      const ohlcvData = createMinuteBars([
        { open: 2055, high: 2060, low: 2050, close: 2058 }, // 始値2055 >= TP2050
      ]);

      const result = verifyExitCondition(ohlcvData, 'long', 1990, 2050);

      expect(result.triggered).toBe(true);
      expect(result.exitPrice).toBe(2055); // 始値（ギャップ）で決済
    });
  });

  describe('エッジケース', () => {
    it('空のOHLCVデータの場合、決済は発生しない', () => {
      const result = verifyExitCondition([], 'long', 1990, 2050);

      expect(result.triggered).toBe(false);
    });

    it('SL/TPどちらにも到達しない場合、決済は発生しない', () => {
      const ohlcvData = createMinuteBars([
        { open: 2010, high: 2020, low: 2000, close: 2015 }, // SL1990 < 安値2000 < TP2050
      ]);

      const result = verifyExitCondition(ohlcvData, 'long', 1990, 2050);

      expect(result.triggered).toBe(false);
    });
  });
});

// ===========================================
// 包括的検証テスト
// ===========================================

describe('verifyTradeState', () => {
  describe('pending → open', () => {
    it('エントリー条件達成でstateChangedがtrueになる', () => {
      const ohlcvData = createMinuteBars([
        { open: 2010, high: 2015, low: 1995, close: 2008 }, // 安値1995 <= 予定2000
      ]);

      const result = verifyTradeState(ohlcvData, 'pending', 'long', 2000, 1990, 2050);

      expect(result.stateChanged).toBe(true);
      expect(result.entry?.triggered).toBe(true);
      expect(result.entry?.entryPrice).toBe(2000);
    });

    it('エントリー後即座にSL到達した場合、exitも検出される', () => {
      const ohlcvData = createMinuteBars([
        { open: 2010, high: 2015, low: 1985, close: 1990 }, // 安値1985でエントリー後即SL
      ]);

      const result = verifyTradeState(ohlcvData, 'pending', 'long', 2000, 1990, 2050);

      expect(result.stateChanged).toBe(true);
      expect(result.entry?.triggered).toBe(true);
      expect(result.exit?.triggered).toBe(true);
      expect(result.exit?.exitReason).toBe('stop_loss');
    });
  });

  describe('open → closed', () => {
    it('TP到達でstateChangedがtrueになる', () => {
      const ohlcvData = createMinuteBars([
        { open: 2040, high: 2055, low: 2035, close: 2052 }, // 高値2055 >= TP2050
      ]);

      const result = verifyTradeState(ohlcvData, 'open', 'long', 2000, 1990, 2050);

      expect(result.stateChanged).toBe(true);
      expect(result.exit?.triggered).toBe(true);
      expect(result.exit?.exitReason).toBe('take_profit');
    });
  });
});

// ===========================================
// ユーティリティテスト
// ===========================================

describe('sortOHLCVChronological', () => {
  it('OHLCVデータを時系列順（古い→新しい）にソートする', () => {
    const data: MinuteOHLCV[] = [
      createMinuteBar({ timestamp: new Date('2026-01-05T10:02:00Z'), open: 2010, high: 2015, low: 2005, close: 2012 }),
      createMinuteBar({ timestamp: new Date('2026-01-05T10:00:00Z'), open: 2000, high: 2005, low: 1995, close: 2002 }),
      createMinuteBar({ timestamp: new Date('2026-01-05T10:01:00Z'), open: 2002, high: 2008, low: 2000, close: 2005 }),
    ];

    const sorted = sortOHLCVChronological(data);

    expect(sorted[0].timestamp.toISOString()).toBe('2026-01-05T10:00:00.000Z');
    expect(sorted[1].timestamp.toISOString()).toBe('2026-01-05T10:01:00.000Z');
    expect(sorted[2].timestamp.toISOString()).toBe('2026-01-05T10:02:00.000Z');
  });

  it('元の配列は変更しない（イミュータブル）', () => {
    const original: MinuteOHLCV[] = [
      createMinuteBar({ timestamp: new Date('2026-01-05T10:01:00Z'), open: 2010, high: 2015, low: 2005, close: 2012 }),
      createMinuteBar({ timestamp: new Date('2026-01-05T10:00:00Z'), open: 2000, high: 2005, low: 1995, close: 2002 }),
    ];

    const sorted = sortOHLCVChronological(original);

    // 元の配列の順序は変わっていない
    expect(original[0].timestamp.toISOString()).toBe('2026-01-05T10:01:00.000Z');
    // ソート結果は異なる配列
    expect(sorted).not.toBe(original);
  });
});

describe('summarizeVerificationResult', () => {
  it('エントリー成功の結果をフォーマットする', () => {
    const result = verifyTradeState(
      createMinuteBars([{ open: 2010, high: 2015, low: 1995, close: 2008 }]),
      'pending',
      'long',
      2000,
      1990,
      2050,
    );

    const summary = summarizeVerificationResult(result);

    expect(summary).toContain('エントリー: ✅');
    expect(summary).toContain('2000.0000');
  });

  it('決済成功の結果をフォーマットする', () => {
    const result = verifyTradeState(
      createMinuteBars([{ open: 2040, high: 2055, low: 2035, close: 2052 }]),
      'open',
      'long',
      2000,
      1990,
      2050,
    );

    const summary = summarizeVerificationResult(result);

    expect(summary).toContain('決済: 🎯');
    expect(summary).toContain('take_profit');
  });
});
