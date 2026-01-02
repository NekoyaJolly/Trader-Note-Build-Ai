/**
 * OHLCV データリポジトリ
 * 
 * 目的: 時系列データの保存・取得・管理
 * 
 * 設計方針:
 * - TimescaleDB 対応を前提とした設計
 * - 効率的な期間クエリ
 * - 重複データの自動処理（upsert）
 * 
 * 参照: 技術スタック選定シート ③
 */

import { PrismaClient, OHLCVCandle, Prisma } from '@prisma/client';
import { OHLCVData } from '../../services/indicators/indicatorService';

const prisma = new PrismaClient();

/**
 * OHLCV データ挿入用の型
 */
export interface OHLCVInsertData {
  symbol: string;
  timeframe: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source?: string;
}

/**
 * OHLCV クエリフィルター
 */
export interface OHLCVQueryFilter {
  symbol: string;
  timeframe: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  orderBy?: 'asc' | 'desc';
}

/**
 * OHLCV データリポジトリクラス
 */
export class OHLCVRepository {
  /**
   * 単一の OHLCV データを挿入（重複時は更新）
   * 
   * @param data - 挿入する OHLCV データ
   * @returns 挿入または更新された OHLCV レコード
   */
  async upsert(data: OHLCVInsertData): Promise<OHLCVCandle> {
    return prisma.oHLCVCandle.upsert({
      where: {
        symbol_timeframe_timestamp: {
          symbol: data.symbol,
          timeframe: data.timeframe,
          timestamp: data.timestamp,
        },
      },
      update: {
        open: new Prisma.Decimal(data.open),
        high: new Prisma.Decimal(data.high),
        low: new Prisma.Decimal(data.low),
        close: new Prisma.Decimal(data.close),
        volume: new Prisma.Decimal(data.volume),
        source: data.source,
      },
      create: {
        symbol: data.symbol,
        timeframe: data.timeframe,
        timestamp: data.timestamp,
        open: new Prisma.Decimal(data.open),
        high: new Prisma.Decimal(data.high),
        low: new Prisma.Decimal(data.low),
        close: new Prisma.Decimal(data.close),
        volume: new Prisma.Decimal(data.volume),
        source: data.source,
      },
    });
  }

  /**
   * 複数の OHLCV データを一括挿入
   * 
   * @param dataList - 挿入する OHLCV データの配列
   * @returns 挿入された件数
   */
  async bulkInsert(dataList: OHLCVInsertData[]): Promise<number> {
    if (dataList.length === 0) {
      return 0;
    }

    // バッチサイズ: 一度に処理する件数（大量データ対応）
    const BATCH_SIZE = 500;
    let insertedCount = 0;

    console.log(`[OHLCVRepository] バルク挿入開始: ${dataList.length}件`);

    // バッチ処理でデータを分割して処理
    for (let i = 0; i < dataList.length; i += BATCH_SIZE) {
      const batch = dataList.slice(i, i + BATCH_SIZE);
      
      try {
        // createMany で一括挿入（重複は skipDuplicates でスキップ）
        const result = await prisma.oHLCVCandle.createMany({
          data: batch.map(data => ({
            symbol: data.symbol,
            timeframe: data.timeframe,
            timestamp: data.timestamp,
            open: new Prisma.Decimal(data.open),
            high: new Prisma.Decimal(data.high),
            low: new Prisma.Decimal(data.low),
            close: new Prisma.Decimal(data.close),
            volume: new Prisma.Decimal(data.volume),
            source: data.source,
          })),
          skipDuplicates: true, // 重複データはスキップ
        });
        
        insertedCount += result.count;
        console.log(`[OHLCVRepository] バッチ ${Math.floor(i / BATCH_SIZE) + 1}: ${result.count}件挿入`);
      } catch (error) {
        console.error(`[OHLCVRepository] バッチ挿入エラー:`, error);
        // エラー時はフォールバックとして個別挿入を試行
        for (const data of batch) {
          try {
            await this.upsert(data);
            insertedCount++;
          } catch {
            // 個別エラーはスキップ
          }
        }
      }
    }

    console.log(`[OHLCVRepository] バルク挿入完了: ${insertedCount}件`);
    return insertedCount;
  }

  /**
   * 指定条件で OHLCV データを取得
   * 
   * @param filter - クエリフィルター
   * @returns OHLCV データの配列
   */
  async findMany(filter: OHLCVQueryFilter): Promise<OHLCVCandle[]> {
    const whereClause: Prisma.OHLCVCandleWhereInput = {
      symbol: filter.symbol,
      timeframe: filter.timeframe,
    };

    // 期間フィルター
    if (filter.startTime || filter.endTime) {
      whereClause.timestamp = {};
      if (filter.startTime) {
        whereClause.timestamp.gte = filter.startTime;
      }
      if (filter.endTime) {
        whereClause.timestamp.lte = filter.endTime;
      }
    }

    return prisma.oHLCVCandle.findMany({
      where: whereClause,
      orderBy: {
        timestamp: filter.orderBy || 'asc',
      },
      take: filter.limit,
    });
  }

  /**
   * OHLCV データを OHLCVData 型に変換して取得
   * （IndicatorService との連携用）
   * 
   * @param filter - クエリフィルター
   * @returns OHLCVData 形式のデータ配列
   */
  async findManyAsOHLCVData(filter: OHLCVQueryFilter): Promise<OHLCVData[]> {
    const candles = await this.findMany(filter);
    
    return candles.map(candle => ({
      timestamp: candle.timestamp,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume),
    }));
  }

  /**
   * 最新の OHLCV データを取得
   * 
   * @param symbol - 銘柄シンボル
   * @param timeframe - 時間足
   * @returns 最新の OHLCV レコード
   */
  async findLatest(symbol: string, timeframe: string): Promise<OHLCVCandle | null> {
    return prisma.oHLCVCandle.findFirst({
      where: {
        symbol,
        timeframe,
      },
      orderBy: {
        timestamp: 'desc',
      },
    });
  }

  /**
   * 指定期間の OHLCV データ件数を取得
   * 
   * @param filter - クエリフィルター
   * @returns データ件数
   */
  async count(filter: OHLCVQueryFilter): Promise<number> {
    const whereClause: Prisma.OHLCVCandleWhereInput = {
      symbol: filter.symbol,
      timeframe: filter.timeframe,
    };

    if (filter.startTime || filter.endTime) {
      whereClause.timestamp = {};
      if (filter.startTime) {
        whereClause.timestamp.gte = filter.startTime;
      }
      if (filter.endTime) {
        whereClause.timestamp.lte = filter.endTime;
      }
    }

    return prisma.oHLCVCandle.count({ where: whereClause });
  }

  /**
   * 古いデータを削除（データ保持ポリシー用）
   * 
   * @param symbol - 銘柄シンボル
   * @param timeframe - 時間足
   * @param olderThan - この日時より古いデータを削除
   * @returns 削除された件数
   */
  async deleteOldData(symbol: string, timeframe: string, olderThan: Date): Promise<number> {
    const result = await prisma.oHLCVCandle.deleteMany({
      where: {
        symbol,
        timeframe,
        timestamp: {
          lt: olderThan,
        },
      },
    });
    
    return result.count;
  }

  /**
   * 利用可能な銘柄・時間足の組み合わせを取得
   * 
   * @returns 銘柄・時間足のペア配列
   */
  async getAvailablePairs(): Promise<{ symbol: string; timeframe: string }[]> {
    const result = await prisma.oHLCVCandle.findMany({
      select: {
        symbol: true,
        timeframe: true,
      },
      distinct: ['symbol', 'timeframe'],
    });
    
    return result;
  }
}

// シングルトンインスタンス
export const ohlcvRepository = new OHLCVRepository();
