/**
 * OHLCV リポジトリテスト
 * 
 * 目的: 時系列データ保存基盤の動作検証
 * 
 * テスト内容:
 * - 単一データの挿入・更新（upsert）
 * - 複数データの一括挿入
 * - 期間クエリ
 * - データ変換（IndicatorService 連携）
 */

import { PrismaClient } from '@prisma/client';
import {
  OHLCVRepository,
  OHLCVInsertData,
  OHLCVQueryFilter,
} from '../../backend/repositories/ohlcvRepository';

const prisma = new PrismaClient();

describe('OHLCVRepository', () => {
  let repository: OHLCVRepository;

  // テスト用銘柄（既存データとの干渉を避ける）
  const TEST_SYMBOL = 'TEST_BTCUSD';
  const TEST_TIMEFRAME = '1h';

  // リモートDB接続のためタイムアウトを延長
  jest.setTimeout(30000);

  beforeAll(() => {
    repository = new OHLCVRepository();
  });

  beforeEach(async () => {
    // テストデータをクリーンアップ
    await prisma.oHLCVCandle.deleteMany({
      where: {
        symbol: TEST_SYMBOL,
      },
    });
  });

  afterAll(async () => {
    // 最終クリーンアップ
    await prisma.oHLCVCandle.deleteMany({
      where: {
        symbol: TEST_SYMBOL,
      },
    });
    await prisma.$disconnect();
  });

  describe('upsert', () => {
    it('新規データを挿入できる', async () => {
      const testData: OHLCVInsertData = {
        symbol: TEST_SYMBOL,
        timeframe: TEST_TIMEFRAME,
        timestamp: new Date('2024-01-01T00:00:00Z'),
        open: 100.0,
        high: 105.0,
        low: 98.0,
        close: 103.0,
        volume: 1000,
        source: 'test',
      };

      const result = await repository.upsert(testData);

      expect(result).toBeDefined();
      expect(result.symbol).toBe(TEST_SYMBOL);
      expect(Number(result.open)).toBe(100.0);
      expect(Number(result.high)).toBe(105.0);
      expect(Number(result.close)).toBe(103.0);
    });

    it('既存データを更新できる（upsert）', async () => {
      const timestamp = new Date('2024-01-01T01:00:00Z');
      
      // 初回挿入
      const initialData: OHLCVInsertData = {
        symbol: TEST_SYMBOL,
        timeframe: TEST_TIMEFRAME,
        timestamp,
        open: 100.0,
        high: 105.0,
        low: 98.0,
        close: 103.0,
        volume: 1000,
      };
      await repository.upsert(initialData);

      // 同一キーで更新
      const updatedData: OHLCVInsertData = {
        ...initialData,
        close: 110.0,
        volume: 2000,
      };
      const result = await repository.upsert(updatedData);

      expect(Number(result.close)).toBe(110.0);
      expect(Number(result.volume)).toBe(2000);

      // 重複レコードが作成されていないことを確認
      const count = await prisma.oHLCVCandle.count({
        where: {
          symbol: TEST_SYMBOL,
          timeframe: TEST_TIMEFRAME,
          timestamp,
        },
      });
      expect(count).toBe(1);
    });
  });

  describe('bulkInsert', () => {
    it('複数データを一括挿入できる', async () => {
      const baseTime = new Date('2024-01-01T00:00:00Z');
      const dataList: OHLCVInsertData[] = [];

      // 10件のテストデータを生成
      for (let i = 0; i < 10; i++) {
        dataList.push({
          symbol: TEST_SYMBOL,
          timeframe: TEST_TIMEFRAME,
          timestamp: new Date(baseTime.getTime() + i * 3600000), // 1時間ごと
          open: 100 + i,
          high: 105 + i,
          low: 98 + i,
          close: 103 + i,
          volume: 1000 * (i + 1),
        });
      }

      const insertedCount = await repository.bulkInsert(dataList);

      expect(insertedCount).toBe(10);

      // 実際に挿入されたことを確認
      const count = await repository.count({
        symbol: TEST_SYMBOL,
        timeframe: TEST_TIMEFRAME,
      });
      expect(count).toBe(10);
    });
  });

  describe('findMany', () => {
    beforeEach(async () => {
      // テストデータを準備
      const baseTime = new Date('2024-01-01T00:00:00Z');
      const dataList: OHLCVInsertData[] = [];

      for (let i = 0; i < 20; i++) {
        dataList.push({
          symbol: TEST_SYMBOL,
          timeframe: TEST_TIMEFRAME,
          timestamp: new Date(baseTime.getTime() + i * 3600000),
          open: 100 + i,
          high: 105 + i,
          low: 98 + i,
          close: 103 + i,
          volume: 1000 * (i + 1),
        });
      }

      await repository.bulkInsert(dataList);
    });

    it('全データを取得できる', async () => {
      const filter: OHLCVQueryFilter = {
        symbol: TEST_SYMBOL,
        timeframe: TEST_TIMEFRAME,
      };

      const results = await repository.findMany(filter);

      expect(results.length).toBe(20);
      // デフォルトは昇順
      expect(results[0].timestamp < results[19].timestamp).toBe(true);
    });

    it('期間フィルターで絞り込める', async () => {
      const filter: OHLCVQueryFilter = {
        symbol: TEST_SYMBOL,
        timeframe: TEST_TIMEFRAME,
        startTime: new Date('2024-01-01T05:00:00Z'),
        endTime: new Date('2024-01-01T10:00:00Z'),
      };

      const results = await repository.findMany(filter);

      // 05:00〜10:00 の 6件
      expect(results.length).toBe(6);
    });

    it('limit で件数制限できる', async () => {
      const filter: OHLCVQueryFilter = {
        symbol: TEST_SYMBOL,
        timeframe: TEST_TIMEFRAME,
        limit: 5,
      };

      const results = await repository.findMany(filter);

      expect(results.length).toBe(5);
    });

    it('降順で取得できる', async () => {
      const filter: OHLCVQueryFilter = {
        symbol: TEST_SYMBOL,
        timeframe: TEST_TIMEFRAME,
        orderBy: 'desc',
        limit: 5,
      };

      const results = await repository.findMany(filter);

      expect(results.length).toBe(5);
      expect(results[0].timestamp > results[4].timestamp).toBe(true);
    });
  });

  describe('findManyAsOHLCVData', () => {
    it('OHLCVData 形式に変換して取得できる', async () => {
      // テストデータを準備
      const testData: OHLCVInsertData = {
        symbol: TEST_SYMBOL,
        timeframe: TEST_TIMEFRAME,
        timestamp: new Date('2024-01-02T00:00:00Z'),
        open: 100.5,
        high: 105.5,
        low: 98.5,
        close: 103.5,
        volume: 1500.5,
      };
      await repository.upsert(testData);

      const results = await repository.findManyAsOHLCVData({
        symbol: TEST_SYMBOL,
        timeframe: TEST_TIMEFRAME,
      });

      expect(results.length).toBe(1);
      expect(typeof results[0].open).toBe('number');
      expect(typeof results[0].high).toBe('number');
      expect(typeof results[0].close).toBe('number');
      expect(typeof results[0].volume).toBe('number');
      expect(results[0].open).toBeCloseTo(100.5);
    });
  });

  describe('findLatest', () => {
    it('最新のデータを取得できる', async () => {
      // テストデータを準備
      const dataList: OHLCVInsertData[] = [
        {
          symbol: TEST_SYMBOL,
          timeframe: TEST_TIMEFRAME,
          timestamp: new Date('2024-01-03T00:00:00Z'),
          open: 100,
          high: 105,
          low: 98,
          close: 103,
          volume: 1000,
        },
        {
          symbol: TEST_SYMBOL,
          timeframe: TEST_TIMEFRAME,
          timestamp: new Date('2024-01-03T01:00:00Z'),
          open: 103,
          high: 110,
          low: 102,
          close: 108,
          volume: 2000,
        },
      ];
      await repository.bulkInsert(dataList);

      const latest = await repository.findLatest(TEST_SYMBOL, TEST_TIMEFRAME);

      expect(latest).not.toBeNull();
      expect(Number(latest!.close)).toBe(108);
      expect(latest!.timestamp.toISOString()).toBe('2024-01-03T01:00:00.000Z');
    });

    it('データがない場合は null を返す', async () => {
      const latest = await repository.findLatest('NONEXISTENT', '1h');
      expect(latest).toBeNull();
    });
  });

  describe('deleteOldData', () => {
    it('指定日時より古いデータを削除できる', async () => {
      const baseTime = new Date('2024-01-04T00:00:00Z');
      const dataList: OHLCVInsertData[] = [];

      for (let i = 0; i < 10; i++) {
        dataList.push({
          symbol: TEST_SYMBOL,
          timeframe: TEST_TIMEFRAME,
          timestamp: new Date(baseTime.getTime() + i * 3600000),
          open: 100,
          high: 105,
          low: 98,
          close: 103,
          volume: 1000,
        });
      }
      await repository.bulkInsert(dataList);

      // 5時間目より古いデータを削除
      const cutoffTime = new Date(baseTime.getTime() + 5 * 3600000);
      const deletedCount = await repository.deleteOldData(TEST_SYMBOL, TEST_TIMEFRAME, cutoffTime);

      expect(deletedCount).toBe(5);

      // 残りのデータを確認
      const remaining = await repository.count({
        symbol: TEST_SYMBOL,
        timeframe: TEST_TIMEFRAME,
      });
      expect(remaining).toBe(5);
    });
  });

  describe('getAvailablePairs', () => {
    it('利用可能な銘柄・時間足の組み合わせを取得できる', async () => {
      // 複数の銘柄・時間足の組み合わせでデータを作成
      const testPairs = [
        { symbol: TEST_SYMBOL, timeframe: '1h' },
        { symbol: TEST_SYMBOL, timeframe: '4h' },
        { symbol: `${TEST_SYMBOL}_2`, timeframe: '1h' },
      ];

      for (const pair of testPairs) {
        await repository.upsert({
          ...pair,
          timestamp: new Date('2024-01-05T00:00:00Z'),
          open: 100,
          high: 105,
          low: 98,
          close: 103,
          volume: 1000,
        });
      }

      const availablePairs = await repository.getAvailablePairs();

      // テスト用のペアが含まれているか確認
      const testPairFound = availablePairs.some(
        p => p.symbol === TEST_SYMBOL && p.timeframe === '1h'
      );
      expect(testPairFound).toBe(true);

      // クリーンアップ
      await prisma.oHLCVCandle.deleteMany({
        where: {
          symbol: `${TEST_SYMBOL}_2`,
        },
      });
    });
  });
});
