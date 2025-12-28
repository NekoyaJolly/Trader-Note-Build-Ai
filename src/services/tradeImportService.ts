import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import crypto from 'crypto';
import { TradeSide } from '@prisma/client';
import { TradeRepository } from '../backend/repositories/tradeRepository';

export class TradeImportService {
  private tradeRepository: TradeRepository;
  private readonly requiredHeaders = ['timestamp', 'symbol', 'side', 'price', 'quantity'];

  constructor() {
    this.tradeRepository = new TradeRepository();
  }

  /**
   * CSV からトレードを取り込み DB に保存する
   * 期待フォーマット: timestamp,symbol,side,price,quantity,fee,exchange
   */
  async importFromCSV(filePath: string): Promise<{ tradesImported: number; skipped: number; errors: string[]; file: string; insertedIds: string[]; parsedTrades: Array<{ id: string; timestamp: Date; symbol: string; side: TradeSide; price: number; quantity: number; fee?: number; exchange?: string }> }> {
    this.validateFile(filePath);

    const { trades, skipped, errors } = await this.parseCSV(filePath);

    if (trades.length === 0) {
      // 有効行が存在しない場合は DB への書き込みを行わずに終了する
      // 有効行が存在しない場合は DB への書き込みを行わずに終了する
      return { tradesImported: 0, skipped, errors, file: filePath, insertedIds: [], parsedTrades: [] };
    }

    // CSV の有効行を DB に保存する
    const inserted = await this.tradeRepository.bulkInsert(trades);
    console.log(`Imported ${inserted} trades from ${filePath}`);

    // 取り込んだトレードの ID を返却し、後続処理（ノート生成等）で利用できるようにする
    return { tradesImported: inserted, skipped, errors, file: filePath, insertedIds: trades.map((t) => t.id), parsedTrades: trades };
  }

  // CSV ファイルの存在・拡張子・ヘッダーを検証する
  private validateFile(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      throw new Error(`CSV ファイルが見つかりません: ${filePath}`);
    }

    if (path.extname(filePath).toLowerCase() !== '.csv') {
      throw new Error('拡張子が .csv ではないファイルは取り込めません');
    }

    const firstLine = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)[0];
    const headers = firstLine.split(',').map((h) => h.trim());
    const missing = this.requiredHeaders.filter((h) => !headers.includes(h));

    if (missing.length > 0) {
      throw new Error(`CSV ヘッダーが不足しています: ${missing.join(', ')}`);
    }
  }

  // CSV をストリームで読み込み、行ごとにバリデーションを行う
  private async parseCSV(filePath: string): Promise<{
    trades: Array<{
      id: string;
      timestamp: Date;
      symbol: string;
      side: TradeSide;
      price: number;
      quantity: number;
      fee?: number;
      exchange?: string;
    }>;
    skipped: number;
    errors: string[];
  }> {
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

    let skipped = 0;
    const errors: string[] = [];

    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          try {
            const parsedSide = String(row.side || '').toLowerCase();
            const timestamp = new Date(row.timestamp);
            const price = parseFloat(row.price);
            const quantity = parseFloat(row.quantity);

            // 必須列の欠落をチェック（fee, exchange は任意）
            const missingColumns = this.requiredHeaders.filter((key) => !(key in row));
            if (missingColumns.length > 0) {
              skipped += 1;
              errors.push(`必須列欠落: ${missingColumns.join(', ')}`);
              return;
            }

            if (!this.isValidSide(parsedSide)) {
              skipped += 1;
              errors.push(`side が不正のためスキップ: ${row.side}`);
              return;
            }

            if (Number.isNaN(timestamp.getTime())) {
              skipped += 1;
              errors.push('timestamp が不正のためスキップ');
              return;
            }

            if (!(price > 0) || !(quantity > 0)) {
              skipped += 1;
              errors.push('price または quantity が不正のためスキップ');
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
            skipped += 1;
            errors.push(`行のパースエラー: ${(error as Error).message}`);
          }
        })
        .on('end', () => resolve())
        .on('error', (error) => reject(error));
    });

    return { trades, skipped, errors };
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
