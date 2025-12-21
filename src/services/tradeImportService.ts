import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { Trade } from '../models/types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Service for importing trade history from CSV files
 */
export class TradeImportService {
  /**
   * Import trades from CSV file
   * Expected CSV format: timestamp,symbol,side,price,quantity,fee,exchange
   */
  async importFromCSV(filePath: string): Promise<Trade[]> {
    const trades: Trade[] = [];

    return new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          try {
            const trade: Trade = {
              id: uuidv4(),
              timestamp: new Date(row.timestamp),
              symbol: row.symbol.toUpperCase(),
              side: row.side.toLowerCase() as 'buy' | 'sell',
              price: parseFloat(row.price),
              quantity: parseFloat(row.quantity),
              fee: row.fee ? parseFloat(row.fee) : undefined,
              exchange: row.exchange || undefined,
            };
            trades.push(trade);
          } catch (error) {
            console.error('Error parsing row:', row, error);
          }
        })
        .on('end', () => {
          console.log(`Imported ${trades.length} trades from ${filePath}`);
          resolve(trades);
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Import trades from API
   * This is a placeholder for actual API integration
   */
  async importFromAPI(exchange: string, apiKey: string): Promise<Trade[]> {
    // Placeholder for API integration
    // In a real implementation, this would call the exchange API
    console.log(`API import from ${exchange} not yet implemented`);
    return [];
  }

  /**
   * Validate trade data
   */
  validateTrade(trade: Trade): boolean {
    return (
      !!trade.id &&
      !!trade.timestamp &&
      !!trade.symbol &&
      (trade.side === 'buy' || trade.side === 'sell') &&
      trade.price > 0 &&
      trade.quantity > 0
    );
  }
}
