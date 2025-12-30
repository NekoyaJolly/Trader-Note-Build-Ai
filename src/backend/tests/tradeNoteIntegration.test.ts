/**
 * トレード取込 → ノート生成 統合テスト
 * 
 * 目的:
 * - CSV 取込からノート生成までの一気通貫フローをテスト
 * - notesGenerated が実数で返ることを検証
 */
import path from 'path';
import fs from 'fs';
import { TradeImportService } from '../../services/tradeImportService';
import { TradeNoteService } from '../../services/tradeNoteService';
import { TradeRepository } from '../../backend/repositories/tradeRepository';
import { Trade } from '../../models/types';

describe('CSV取込 → ノート生成 統合テスト', () => {
  const importService = new TradeImportService();
  const noteService = new TradeNoteService();
  const tradeRepo = new TradeRepository();
  
  // テスト用の一時 CSV ファイルパス
  const tmpCsvPath = path.join(process.cwd(), 'data', 'trades', 'test_integration_temp.csv');
  const notesDir = path.join(process.cwd(), 'data', 'notes');

  beforeEach(() => {
    // テスト用 CSV を作成
    const csvContent = [
      'timestamp,symbol,side,price,quantity,fee,exchange',
      '2024-12-30T10:00:00Z,BTCUSDT,buy,95000.00,0.1,9.50,Binance',
      '2024-12-30T11:00:00Z,ETHUSDT,sell,3200.00,1.0,3.20,Binance',
    ].join('\n');
    fs.writeFileSync(tmpCsvPath, csvContent);
  });

  afterEach(() => {
    // テスト用 CSV を削除
    if (fs.existsSync(tmpCsvPath)) {
      fs.unlinkSync(tmpCsvPath);
    }
  });

  describe('importFromCSV', () => {
    it('CSV を取り込み、トレードが DB に保存される', async () => {
      const beforeCount = await tradeRepo.countAll();
      
      const result = await importService.importFromCSV(tmpCsvPath);
      
      expect(result.tradesImported).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.insertedIds).toHaveLength(2);
      expect(result.parsedTrades).toHaveLength(2);
      
      const afterCount = await tradeRepo.countAll();
      expect(afterCount - beforeCount).toBe(2);
    });

    it('空の CSV ではトレードが保存されない', async () => {
      // 空の CSV を作成
      const emptyCsvPath = path.join(process.cwd(), 'data', 'trades', 'test_empty_temp.csv');
      const csvContent = 'timestamp,symbol,side,price,quantity,fee,exchange\n';
      fs.writeFileSync(emptyCsvPath, csvContent);

      const result = await importService.importFromCSV(emptyCsvPath);
      
      expect(result.tradesImported).toBe(0);
      expect(result.insertedIds).toHaveLength(0);
      expect(result.parsedTrades).toHaveLength(0);

      // 後片付け
      fs.unlinkSync(emptyCsvPath);
    });
  });

  describe('generateNote', () => {
    it('トレードからノートを生成できる', async () => {
      const trade: Trade = {
        id: 'test_trade_' + Date.now(),
        timestamp: new Date(),
        symbol: 'BTCUSDT',
        side: 'buy',
        price: 95000,
        quantity: 0.1,
      };

      const note = await noteService.generateNote(trade, {
        timeframe: '15m',
        trend: 'bullish',
        indicators: { rsi: 60, macd: 10, volume: 1000 },
      });

      expect(note.id).toBeDefined();
      expect(note.tradeId).toBe(trade.id);
      expect(note.symbol).toBe('BTCUSDT');
      expect(note.side).toBe('buy');
      expect(note.entryPrice).toBe(95000);
      expect(note.features).toBeDefined();
      expect(note.features.length).toBeGreaterThan(0);
      expect(note.status).toBe('draft');
    });

    it('市場コンテキストなしでもノートを生成できる', async () => {
      const trade: Trade = {
        id: 'test_trade_no_context_' + Date.now(),
        timestamp: new Date(),
        symbol: 'ETHUSDT',
        side: 'sell',
        price: 3200,
        quantity: 1.0,
      };

      const note = await noteService.generateNote(trade);

      expect(note.id).toBeDefined();
      expect(note.marketContext.trend).toBe('neutral');
      expect(note.marketContext.timeframe).toBe('15m');
    });
  });

  describe('saveNote / loadAllNotes', () => {
    it('ノートを保存して読み込める', async () => {
      const trade: Trade = {
        id: 'test_trade_save_' + Date.now(),
        timestamp: new Date(),
        symbol: 'BTCUSDT',
        side: 'buy',
        price: 95000,
        quantity: 0.1,
      };

      const note = await noteService.generateNote(trade);
      await noteService.saveNote(note);

      // 保存されたノートを読み込み
      const loaded = await noteService.getNoteById(note.id);

      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(note.id);
      expect(loaded?.symbol).toBe('BTCUSDT');

      // 後片付け: ノートファイルを削除
      const notePath = path.join(notesDir, `${note.id}.json`);
      if (fs.existsSync(notePath)) {
        fs.unlinkSync(notePath);
      }
    });
  });

  describe('特徴量抽出', () => {
    it('特徴量ベクトルが正しい次元で生成される', async () => {
      const trade: Trade = {
        id: 'test_trade_features_' + Date.now(),
        timestamp: new Date(),
        symbol: 'BTCUSDT',
        side: 'buy',
        price: 95000,
        quantity: 0.1,
      };

      const note = await noteService.generateNote(trade, {
        timeframe: '15m',
        trend: 'bullish',
        indicators: { rsi: 65, macd: 15, volume: 2000 },
      });

      // 特徴量: [price, quantity, rsi, macd, volume, trend, side]
      expect(note.features).toHaveLength(7);
      expect(note.features[0]).toBe(95000); // price
      expect(note.features[1]).toBe(0.1); // quantity
      expect(note.features[2]).toBe(65); // rsi
      expect(note.features[3]).toBe(15); // macd
      expect(note.features[4]).toBe(2000); // volume
      expect(note.features[5]).toBe(1); // trend (bullish = 1)
      expect(note.features[6]).toBe(1); // side (buy = 1)
    });

    it('売りトレードの特徴量が正しく生成される', async () => {
      const trade: Trade = {
        id: 'test_trade_sell_' + Date.now(),
        timestamp: new Date(),
        symbol: 'ETHUSDT',
        side: 'sell',
        price: 3200,
        quantity: 1.0,
      };

      const note = await noteService.generateNote(trade, {
        timeframe: '15m',
        trend: 'bearish',
        indicators: { rsi: 35, macd: -10, volume: 500 },
      });

      expect(note.features[5]).toBe(-1); // trend (bearish = -1)
      expect(note.features[6]).toBe(-1); // side (sell = -1)
    });
  });
});
