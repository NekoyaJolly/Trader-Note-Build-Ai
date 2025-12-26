import fs from 'fs';
import csv from 'csv-parser';
import crypto from 'crypto';
import { TradeSide } from '@prisma/client';
import { TradeRepository } from '../backend/repositories/tradeRepository';

export class TradeImportService {
  private tradeRepository: TradeRepository;

  constructor() {
    this.tradeRepository = new TradeRepository();
  }

  /**
   * CSV からトレードを取り込み DB に保存する
   * 期待フォーマット: timestamp,symbol,side,price,quantity,fee,exchange
   */
  async importFromCSV(filePath: string): Promise<{ tradesImported: number }> {
    const trades: Array<{
      id: string;
      timestamp: Date;
      symbol: string;
      side: TradeSide;
      price: number;
      quantity: number;
      fee?: number;
      exchange?: string;
    }> = [];

    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          try {
            const parsedSide = String(row.side || '').toLowerCase();
            if (!this.isValidSide(parsedSide)) {
              // サイドが不正な行はスキップ
              return;
            }

            const timestamp = new Date(row.timestamp);
            if (Number.isNaN(timestamp.getTime())) {
              // 日付が不正な行はスキップ
              return;
            }

            const price = parseFloat(row.price);
            const quantity = parseFloat(row.quantity);
            if (!(price > 0) || !(quantity > 0)) {
              // 価格・数量が不正な行はスキップ
              return;
            }

            trades.push({
              id: crypto.randomUUID(),
              timestamp: new Date(timestamp.toISOString()), // UTC 前提
              symbol: String(row.symbol || '').toUpperCase(),
              side: parsedSide as TradeSide,
              price,
              quantity,
              fee: row.fee ? parseFloat(row.fee) : undefined,
              exchange: row.exchange || undefined,
            });
          } catch (error) {
            console.error('Error parsing row:', row, error);
          }
        })
        .on('end', () => resolve())
        .on('error', (error) => reject(error));
    });

    const inserted = await this.tradeRepository.bulkInsert(trades);
    console.log(`Imported ${inserted} trades from ${filePath}`);

    return { tradesImported: inserted };
  }

  /**
   * Import trades from API
   * This is a placeholder for actual API integration
   */
  async importFromAPI(exchange: string, apiKey: string): Promise<[]> {
    // Placeholder for API integration
    // In a real implementation, this would call the exchange API
    console.log(`API import from ${exchange} not yet implemented`);
    return [];
  }

  // サイドのバリデーション
  private isValidSide(side: string): side is TradeSide {
    return side === 'buy' || side === 'sell';
  }
}
