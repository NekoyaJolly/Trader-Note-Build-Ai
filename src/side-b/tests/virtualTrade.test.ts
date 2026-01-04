/**
 * 仮想トレード モデル テスト
 * 
 * @see src/side-b/models/virtualTrade.ts
 * @see src/side-b/models/virtualPortfolio.ts
 */

import {
  checkExitCondition,
  checkEntryCondition,
  calculatePnL,
  isActiveTrade,
  isClosedTrade,
  calculateStats,
  canOpenNewTrade,
  DEFAULT_PORTFOLIO_SETTINGS,
} from '../models';

describe('virtualTrade', () => {
  describe('checkExitCondition', () => {
    it('ロング: 価格がSL以下で損切り', () => {
      const result = checkExitCondition('long', 2600, 2610, 2650);
      expect(result).toBe('stop_loss');
    });

    it('ロング: 価格がTP以上で利確', () => {
      const result = checkExitCondition('long', 2660, 2610, 2650);
      expect(result).toBe('take_profit');
    });

    it('ロング: SL/TP間は null', () => {
      const result = checkExitCondition('long', 2630, 2610, 2650);
      expect(result).toBeNull();
    });

    it('ショート: 価格がSL以上で損切り', () => {
      const result = checkExitCondition('short', 2660, 2650, 2610);
      expect(result).toBe('stop_loss');
    });

    it('ショート: 価格がTP以下で利確', () => {
      const result = checkExitCondition('short', 2600, 2650, 2610);
      expect(result).toBe('take_profit');
    });

    it('ショート: SL/TP間は null', () => {
      const result = checkExitCondition('short', 2630, 2650, 2610);
      expect(result).toBeNull();
    });
  });

  describe('checkEntryCondition', () => {
    it('ロング: 予定価格以下でエントリー可', () => {
      const result = checkEntryCondition('long', 2620, 2625);
      expect(result).toBe(true);
    });

    it('ロング: 予定価格超過でエントリー不可', () => {
      const result = checkEntryCondition('long', 2630, 2625);
      expect(result).toBe(false);
    });

    it('ショート: 予定価格以上でエントリー可', () => {
      const result = checkEntryCondition('short', 2630, 2625);
      expect(result).toBe(true);
    });

    it('ショート: 予定価格未満でエントリー不可', () => {
      const result = checkEntryCondition('short', 2620, 2625);
      expect(result).toBe(false);
    });

    it('許容誤差を考慮', () => {
      // ロング: 2626 <= 2625 + 1.0 = 2626 → true
      const result = checkEntryCondition('long', 2626, 2625, 1.0);
      expect(result).toBe(true);
    });
  });

  describe('calculatePnL', () => {
    it('ロング: 利益を正しく計算', () => {
      const pnl = calculatePnL('long', 2620, 2630);
      expect(pnl.pips).toBe(100); // (2630 - 2620) / 0.1 = 100
      expect(pnl.percentage).toBeCloseTo(0.38, 1);
    });

    it('ロング: 損失を正しく計算', () => {
      const pnl = calculatePnL('long', 2620, 2610);
      expect(pnl.pips).toBe(-100);
      expect(pnl.percentage).toBeLessThan(0);
    });

    it('ショート: 利益を正しく計算', () => {
      const pnl = calculatePnL('short', 2630, 2620);
      expect(pnl.pips).toBe(100);
      expect(pnl.percentage).toBeCloseTo(0.38, 1);
    });

    it('ショート: 損失を正しく計算', () => {
      const pnl = calculatePnL('short', 2620, 2630);
      expect(pnl.pips).toBe(-100);
    });

    it('カスタムpipValueを使用', () => {
      const pnl = calculatePnL('long', 100, 101, 0.01); // FXペアなど
      expect(pnl.pips).toBe(100);
    });
  });

  describe('isActiveTrade / isClosedTrade', () => {
    it('pending はアクティブ', () => {
      expect(isActiveTrade('pending')).toBe(true);
      expect(isClosedTrade('pending')).toBe(false);
    });

    it('open はアクティブ', () => {
      expect(isActiveTrade('open')).toBe(true);
      expect(isClosedTrade('open')).toBe(false);
    });

    it('closed はクローズ', () => {
      expect(isActiveTrade('closed')).toBe(false);
      expect(isClosedTrade('closed')).toBe(true);
    });

    it('expired はクローズ', () => {
      expect(isActiveTrade('expired')).toBe(false);
      expect(isClosedTrade('expired')).toBe(true);
    });

    it('cancelled はクローズ', () => {
      expect(isActiveTrade('cancelled')).toBe(false);
      expect(isClosedTrade('cancelled')).toBe(true);
    });

    it('invalidated はクローズ', () => {
      expect(isActiveTrade('invalidated')).toBe(false);
      expect(isClosedTrade('invalidated')).toBe(true);
    });
  });
});

describe('virtualPortfolio', () => {
  describe('calculateStats', () => {
    it('空の配列ではデフォルト統計を返す', () => {
      const stats = calculateStats([], 0);
      expect(stats.totalTrades).toBe(0);
      expect(stats.winRate).toBe(0);
      expect(stats.openPositions).toBe(0);
    });

    it('勝率を正しく計算', () => {
      const trades = [
        { pnlPips: 50, pnlAmount: 500 },
        { pnlPips: -30, pnlAmount: -300 },
        { pnlPips: 40, pnlAmount: 400 },
      ];
      const stats = calculateStats(trades, 1);
      
      expect(stats.totalTrades).toBe(3);
      expect(stats.wins).toBe(2);
      expect(stats.losses).toBe(1);
      expect(stats.winRate).toBeCloseTo(66.67, 0);
      expect(stats.openPositions).toBe(1);
    });

    it('プロフィットファクターを正しく計算', () => {
      const trades = [
        { pnlPips: 100, pnlAmount: 1000 },
        { pnlPips: -50, pnlAmount: -500 },
      ];
      const stats = calculateStats(trades, 0);
      
      expect(stats.profitFactor).toBe(2); // 100 / 50
    });

    it('損失のみの場合プロフィットファクターは0', () => {
      const trades = [
        { pnlPips: -50, pnlAmount: -500 },
        { pnlPips: -30, pnlAmount: -300 },
      ];
      const stats = calculateStats(trades, 0);
      
      expect(stats.profitFactor).toBe(0);
    });

    it('総PnLを正しく計算', () => {
      const trades = [
        { pnlPips: 100, pnlAmount: 1000 },
        { pnlPips: -30, pnlAmount: -300 },
        { pnlPips: 50, pnlAmount: 500 },
      ];
      const stats = calculateStats(trades, 0);
      
      expect(stats.totalPnlPips).toBe(120);
      expect(stats.totalPnlAmount).toBe(1200);
    });
  });

  describe('canOpenNewTrade', () => {
    it('上限未満なら開ける', () => {
      const result = canOpenNewTrade(DEFAULT_PORTFOLIO_SETTINGS, 2);
      expect(result).toBe(true);
    });

    it('上限到達なら開けない', () => {
      const result = canOpenNewTrade(DEFAULT_PORTFOLIO_SETTINGS, 3);
      expect(result).toBe(false);
    });

    it('カスタム設定で判定', () => {
      const settings = { ...DEFAULT_PORTFOLIO_SETTINGS, maxOpenPositions: 5 };
      expect(canOpenNewTrade(settings, 4)).toBe(true);
      expect(canOpenNewTrade(settings, 5)).toBe(false);
    });
  });
});
