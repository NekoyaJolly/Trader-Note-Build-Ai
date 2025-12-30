/**
 * トレード正規化サービス テスト
 * 
 * テスト対象:
 * - タイムスタンプ正規化（UTC変換）
 * - シンボル正規化（表記揺れ吸収）
 * - Side正規化（buy/sell統一）
 * - バリデーションエラーメッセージ
 */

import {
  TradeNormalizationService,
  tradeNormalizationService,
} from '../../services/tradeNormalizationService';

describe('TradeNormalizationService', () => {
  let service: TradeNormalizationService;

  beforeEach(() => {
    service = new TradeNormalizationService();
  });

  describe('normalizeTimestamp', () => {
    it('ISO 8601 形式の文字列を正しくパースできること', () => {
      const timestamp = service.normalizeTimestamp('2024-01-15T10:30:00Z');
      expect(timestamp.toISOString()).toBe('2024-01-15T10:30:00.000Z');
    });

    it('Date オブジェクトをそのまま返すこと', () => {
      const input = new Date('2024-01-15T10:30:00Z');
      const result = service.normalizeTimestamp(input);
      expect(result.getTime()).toBe(input.getTime());
    });

    it('Unix 秒タイムスタンプを正しく変換できること', () => {
      // 2024-01-15T10:30:00Z のUnix秒
      const unixSeconds = 1705314600;
      const result = service.normalizeTimestamp(unixSeconds);
      expect(result.toISOString()).toBe('2024-01-15T10:30:00.000Z');
    });

    it('Unix ミリ秒タイムスタンプを正しく変換できること', () => {
      // 2024-01-15T10:30:00Z のUnixミリ秒
      const unixMs = 1705314600000;
      const result = service.normalizeTimestamp(unixMs);
      expect(result.toISOString()).toBe('2024-01-15T10:30:00.000Z');
    });

    it('日本語形式（YYYY/MM/DD HH:mm:ss）を JST として解釈し UTC に変換すること', () => {
      // 2024/01/15 19:30:00 JST = 2024-01-15T10:30:00 UTC
      const result = service.normalizeTimestamp('2024/01/15 19:30:00');
      expect(result.toISOString()).toBe('2024-01-15T10:30:00.000Z');
    });

    it('不正な形式でエラーをスローすること', () => {
      expect(() => service.normalizeTimestamp('invalid-date')).toThrow();
    });
  });

  describe('normalizeSymbol', () => {
    it('BTCUSD を BTC/USD に正規化できること', () => {
      expect(service.normalizeSymbol('BTCUSD')).toBe('BTC/USD');
    });

    it('BTC-USD を BTC/USD に正規化できること', () => {
      expect(service.normalizeSymbol('BTC-USD')).toBe('BTC/USD');
    });

    it('BTC_USD を BTC/USD に正規化できること', () => {
      expect(service.normalizeSymbol('BTC_USD')).toBe('BTC/USD');
    });

    it('既に正規化済みの形式はそのまま返すこと', () => {
      expect(service.normalizeSymbol('BTC/USD')).toBe('BTC/USD');
    });

    it('小文字入力を大文字に正規化すること', () => {
      expect(service.normalizeSymbol('btcusd')).toBe('BTC/USD');
    });

    it('ETHUSDT を ETH/USDT に正規化できること', () => {
      expect(service.normalizeSymbol('ETHUSDT')).toBe('ETH/USDT');
    });

    it('FX ペアも正規化できること', () => {
      expect(service.normalizeSymbol('USDJPY')).toBe('USD/JPY');
    });

    it('未知の形式は推測して正規化すること', () => {
      expect(service.normalizeSymbol('SOLETH')).toBe('SOL/ETH');
    });
  });

  describe('normalizeSide', () => {
    it('buy を正しく認識すること', () => {
      expect(service.normalizeSide('buy')).toBe('buy');
      expect(service.normalizeSide('BUY')).toBe('buy');
      expect(service.normalizeSide('Buy')).toBe('buy');
    });

    it('sell を正しく認識すること', () => {
      expect(service.normalizeSide('sell')).toBe('sell');
      expect(service.normalizeSide('SELL')).toBe('sell');
      expect(service.normalizeSide('Sell')).toBe('sell');
    });

    it('long を buy に正規化すること', () => {
      expect(service.normalizeSide('long')).toBe('buy');
      expect(service.normalizeSide('LONG')).toBe('buy');
    });

    it('short を sell に正規化すること', () => {
      expect(service.normalizeSide('short')).toBe('sell');
      expect(service.normalizeSide('SHORT')).toBe('sell');
    });

    it('日本語「買い」を buy に正規化すること', () => {
      expect(service.normalizeSide('買い')).toBe('buy');
      expect(service.normalizeSide('買')).toBe('buy');
    });

    it('日本語「売り」を sell に正規化すること', () => {
      expect(service.normalizeSide('売り')).toBe('sell');
      expect(service.normalizeSide('売')).toBe('sell');
    });

    it('未知の値で null を返すこと', () => {
      expect(service.normalizeSide('unknown')).toBeNull();
    });
  });

  describe('normalizeTradeData', () => {
    it('正常なトレードデータを正規化できること', () => {
      const result = service.normalizeTradeData({
        timestamp: new Date('2024-01-15T10:30:00Z'),
        symbol: 'BTCUSD',
        side: 'buy',
        price: 42000,
        quantity: 0.5,
      });

      expect(result.success).toBe(true);
      expect(result.trade).toBeDefined();
      expect(result.trade?.normalizedSymbol).toBe('BTC/USD');
      expect(result.trade?.side).toBe('buy');
      expect(result.trade?.normalized).toBe(true);
    });

    it('必須フィールド欠落時にエラーを返すこと', () => {
      const result = service.normalizeTradeData({
        symbol: 'BTCUSD',
        side: 'buy',
        // timestamp, price, quantity が欠落
      } as any);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('不正な side でエラーを返すこと', () => {
      const result = service.normalizeTradeData({
        timestamp: new Date(),
        symbol: 'BTCUSD',
        side: 'invalid' as any,
        price: 42000,
        quantity: 0.5,
      });

      expect(result.success).toBe(false);
      expect(result.errors?.some(e => e.includes('side'))).toBe(true);
    });

    it('負の価格でエラーを返すこと', () => {
      const result = service.normalizeTradeData({
        timestamp: new Date(),
        symbol: 'BTCUSD',
        side: 'buy',
        price: -100,
        quantity: 0.5,
      });

      expect(result.success).toBe(false);
      expect(result.errors?.some(e => e.includes('price'))).toBe(true);
    });

    it('行番号付きエラーメッセージを生成すること', () => {
      const result = service.normalizeTradeData(
        {
          symbol: 'BTCUSD',
          side: 'buy',
        } as any,
        5
      );

      expect(result.success).toBe(false);
      expect(result.errors?.some(e => e.startsWith('5行目:'))).toBe(true);
    });

    it('fee が不正な場合は警告を出してスキップすること', () => {
      const result = service.normalizeTradeData({
        timestamp: new Date(),
        symbol: 'BTCUSD',
        side: 'buy',
        price: 42000,
        quantity: 0.5,
        fee: -10,
      });

      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.trade?.fee).toBeUndefined();
    });
  });

  describe('normalizeTrades (batch)', () => {
    it('複数トレードを一括処理できること', () => {
      const result = service.normalizeTrades([
        { timestamp: new Date(), symbol: 'BTCUSD', side: 'buy', price: 42000, quantity: 0.5 },
        { timestamp: new Date(), symbol: 'ETHUSD', side: 'sell', price: 2500, quantity: 2 },
      ]);

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('部分的な失敗を正しくカウントすること', () => {
      const result = service.normalizeTrades([
        { timestamp: new Date(), symbol: 'BTCUSD', side: 'buy', price: 42000, quantity: 0.5 },
        { symbol: 'ETHUSD', side: 'sell', price: 2500 } as any, // timestamp, quantity 欠落
      ]);

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  describe('parseCSVRow', () => {
    it('標準的なCSV行をパースできること', () => {
      const row = {
        timestamp: '2024-01-15T10:30:00Z',
        symbol: 'BTCUSD',
        side: 'buy',
        price: '42000',
        quantity: '0.5',
      };

      const result = service.parseCSVRow(row, 1);

      expect(result.symbol).toBe('BTCUSD');
      expect(result.price).toBe(42000);
      expect(result.quantity).toBe(0.5);
    });

    it('カラム名の大文字小文字を無視できること', () => {
      const row = {
        TIMESTAMP: '2024-01-15T10:30:00Z',
        Symbol: 'BTCUSD',
        SIDE: 'buy',
        Price: '42000',
        Quantity: '0.5',
      };

      const result = service.parseCSVRow(row, 1);

      expect(result.symbol).toBe('BTCUSD');
      expect(result.price).toBe(42000);
    });

    it('代替カラム名を認識できること', () => {
      const row = {
        datetime: '2024-01-15T10:30:00Z',
        pair: 'BTCUSD',
        direction: 'buy',
        rate: '42000',
        amount: '0.5',
      };

      const result = service.parseCSVRow(row, 1);

      expect(result.symbol).toBe('BTCUSD');
      expect(result.price).toBe(42000);
      expect(result.quantity).toBe(0.5);
    });
  });

  describe('シングルトンインスタンス', () => {
    it('tradeNormalizationService がエクスポートされていること', () => {
      expect(tradeNormalizationService).toBeDefined();
      expect(tradeNormalizationService).toBeInstanceOf(TradeNormalizationService);
    });
  });
});
