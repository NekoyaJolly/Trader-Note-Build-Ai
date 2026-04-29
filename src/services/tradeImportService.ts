import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import crypto from 'crypto';
import type { TradeSide } from '@prisma/client';
import { TradeRepository } from '../backend/repositories/tradeRepository';
import { z } from 'zod';

const CsvRowRecordSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.null(), z.undefined()]),
);

function pickCsvCell(row: z.infer<typeof CsvRowRecordSchema>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v === undefined || v === null) continue;
    const s = typeof v === 'string' ? v : String(v);
    if (s !== '') return s;
  }
  return undefined;
}

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
      return { tradesImported: 0, skipped, errors, file: filePath, insertedIds: [], parsedTrades: [] };
    }

    // CSV の有効行を DB に保存する（重複チェック付き）
    const insertResult = await this.tradeRepository.bulkInsert(trades);
    // 本番環境ではデバッグログを抑制
    if (process.env.NODE_ENV !== 'production') {
      console.log(`Imported ${insertResult.count} trades from ${filePath}`);
    }

    // 実際に挿入されたトレードのみを返却し、後続処理（ノート生成等）で利用できるようにする
    const insertedTrades = trades.filter(t => insertResult.insertedIds.includes(t.id));
    return { tradesImported: insertResult.count, skipped, errors, file: filePath, insertedIds: insertResult.insertedIds, parsedTrades: insertedTrades };
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
        .on('data', (rawRow) => {
          try {
            const rowParsed = CsvRowRecordSchema.safeParse(rawRow);
            if (!rowParsed.success) {
              skipped += 1;
              errors.push('行データの形式が不正のためスキップ');
              return;
            }
            const row = rowParsed.data;
            const sideRaw = pickCsvCell(row, 'side') ?? '';
            const parsedSide = sideRaw.toLowerCase();
            const tsRaw = pickCsvCell(row, 'timestamp');
            const timestamp = tsRaw ? new Date(tsRaw) : new Date(NaN);
            const priceRaw = pickCsvCell(row, 'price');
            const qtyRaw = pickCsvCell(row, 'quantity');
            const price = parseFloat(priceRaw ?? 'NaN');
            const quantity = parseFloat(qtyRaw ?? 'NaN');

            // 必須列の欠落をチェック（fee, exchange は任意）
            const missingColumns = this.requiredHeaders.filter((key) => pickCsvCell(row, key) === undefined);
            if (missingColumns.length > 0) {
              skipped += 1;
              errors.push(`必須列欠落: ${missingColumns.join(', ')}`);
              return;
            }

            if (!this.isValidSide(parsedSide)) {
              skipped += 1;
              errors.push(`side が不正のためスキップ: ${sideRaw}`);
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

            const feeRaw = pickCsvCell(row, 'fee');
            const exchangeRaw = pickCsvCell(row, 'exchange');

            trades.push({
              id: crypto.randomUUID(),
              timestamp: new Date(timestamp.toISOString()), // UTC 前提
              symbol: (pickCsvCell(row, 'symbol') ?? '').toUpperCase(),
              side: parsedSide,
              price,
              quantity,
              fee: feeRaw !== undefined ? parseFloat(feeRaw) : undefined,
              exchange: exchangeRaw,
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
   * API 経由でトレードを取り込む
   * 注意: 現在は未実装（将来の拡張用）
   */
  importFromAPI(exchange: string, _apiKey: string): Promise<never[]> {
    // 将来の API 統合用スタブ
    // 本番環境ではログ出力を抑制
    if (process.env.NODE_ENV !== 'production') {
      console.log(`API import from ${exchange} not yet implemented`);
    }
    return Promise.resolve([]);
  }

  // サイドのバリデーション
  private isValidSide(side: string): side is TradeSide {
    return side === 'buy' || side === 'sell';
  }
}
