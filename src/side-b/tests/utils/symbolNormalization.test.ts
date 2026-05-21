/**
 * symbolNormalization の単体テスト (Phase A A-1 で EODHD 形式対応を追加)
 */

import {
  normalizeCTraderSymbol,
  toTwelveDataSymbol,
  toEodhdSymbol,
  fromEodhdSymbol,
  isEodhdFundamentalsSupported,
} from '../../../utils/symbolNormalization';

describe('symbolNormalization (Phase A: EODHD 拡張)', () => {
  describe('normalizeCTraderSymbol', () => {
    it('XAU/USD → XAUUSD', () => {
      expect(normalizeCTraderSymbol('XAU/USD')).toBe('XAUUSD');
    });

    it('空白と特殊文字を除去', () => {
      expect(normalizeCTraderSymbol('  eur-usd  ')).toBe('EURUSD');
    });
  });

  describe('toTwelveDataSymbol', () => {
    it('XAUUSD → XAU/USD', () => {
      expect(toTwelveDataSymbol('XAUUSD')).toBe('XAU/USD');
    });

    it('既にスラッシュ区切りでも正規化される', () => {
      expect(toTwelveDataSymbol('EUR/USD')).toBe('EUR/USD');
    });

    it('未知の通貨ペアはそのまま返す', () => {
      expect(toTwelveDataSymbol('UNKNOWN')).toBe('UNKNOWN');
    });
  });

  describe('toEodhdSymbol', () => {
    it('FOREX デフォルト: XAUUSD → XAUUSD.FOREX', () => {
      expect(toEodhdSymbol('XAUUSD')).toBe('XAUUSD.FOREX');
    });

    it('FOREX デフォルト: XAU/USD → XAUUSD.FOREX', () => {
      expect(toEodhdSymbol('XAU/USD')).toBe('XAUUSD.FOREX');
    });

    it('marketType=US: AAPL → AAPL.US', () => {
      expect(toEodhdSymbol('AAPL', 'US')).toBe('AAPL.US');
    });

    it('marketType=INDX: GSPC → GSPC.INDX', () => {
      expect(toEodhdSymbol('GSPC', 'INDX')).toBe('GSPC.INDX');
    });

    it('既に EODHD 形式なら冪等', () => {
      expect(toEodhdSymbol('XAUUSD.FOREX')).toBe('XAUUSD.FOREX');
      expect(toEodhdSymbol('AAPL.US', 'FOREX')).toBe('AAPL.US');
    });

    it('小文字 input を大文字化', () => {
      expect(toEodhdSymbol('eurusd')).toBe('EURUSD.FOREX');
    });

    it('サフィックス付きでもベース部のスラッシュ等は正規化される', () => {
      // Copilot review (PR #234) 指摘 4 対応: EUR/USD.FOREX → EURUSD.FOREX
      expect(toEodhdSymbol('EUR/USD.FOREX')).toBe('EURUSD.FOREX');
      expect(toEodhdSymbol('xau-usd.US')).toBe('XAUUSD.US');
    });
  });

  describe('fromEodhdSymbol', () => {
    it('XAUUSD.FOREX → XAUUSD', () => {
      expect(fromEodhdSymbol('XAUUSD.FOREX')).toBe('XAUUSD');
    });

    it('AAPL.US → AAPL', () => {
      expect(fromEodhdSymbol('AAPL.US')).toBe('AAPL');
    });

    it('サフィックスなしはそのまま大文字化', () => {
      expect(fromEodhdSymbol('xauusd')).toBe('XAUUSD');
    });

    it('サフィックス除去後にハイフン/スラッシュも正規化される', () => {
      // Copilot review (PR #234) 指摘 4 対応
      expect(fromEodhdSymbol('XAU-USD.FOREX')).toBe('XAUUSD');
      expect(fromEodhdSymbol('eur/usd.FOREX')).toBe('EURUSD');
    });
  });

  describe('isEodhdFundamentalsSupported', () => {
    it('XAUUSD.FOREX は非対応 (false)', () => {
      expect(isEodhdFundamentalsSupported('XAUUSD.FOREX')).toBe(false);
    });

    it('AAPL.US は対応 (true)', () => {
      expect(isEodhdFundamentalsSupported('AAPL.US')).toBe(true);
    });

    it('SPY.ETF は対応 (true)', () => {
      expect(isEodhdFundamentalsSupported('SPY.ETF')).toBe(true);
    });

    it('GSPC.INDX は対応 (true)', () => {
      expect(isEodhdFundamentalsSupported('GSPC.INDX')).toBe(true);
    });

    it('BTC-USD.CC は非対応 (false)', () => {
      expect(isEodhdFundamentalsSupported('BTC-USD.CC')).toBe(false);
    });

    it('サフィックスなし (内部正規化形式) は FX とみなして false', () => {
      expect(isEodhdFundamentalsSupported('XAUUSD')).toBe(false);
    });
  });
});
