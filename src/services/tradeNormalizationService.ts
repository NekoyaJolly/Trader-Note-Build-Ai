/**
 * トレードデータ正規化サービス
 * 
 * 目的:
 * - CSVインポートされたトレードデータを統一フォーマットに正規化
 * - UTC タイムスタンプ変換
 * - シンボル名の標準化
 * - Side 値の正規化
 * - ユーザーフレンドリーなエラーメッセージ生成
 * 
 * 設計方針:
 * - 入力データの多様性（取引所ごとの形式差異）を吸収
 * - バリデーションエラーは修正方法を明示
 */

import { Trade } from '../models/types';
import { NormalizedTrade } from '../models/tradeDefinition';
import { v4 as uuidv4 } from 'uuid';

/**
 * 正規化結果
 */
export interface NormalizationResult {
  // 成功フラグ
  success: boolean;
  // 正規化されたトレード（成功時）
  trade?: NormalizedTrade;
  // エラーメッセージ配列（失敗時）
  errors?: string[];
  // 警告メッセージ配列（部分的な問題）
  warnings?: string[];
}

/**
 * バッチ正規化結果
 */
export interface BatchNormalizationResult {
  // 処理件数
  total: number;
  // 成功件数
  succeeded: number;
  // 失敗件数
  failed: number;
  // 各トレードの結果
  results: NormalizationResult[];
}

/**
 * CSV行のパース結果
 */
export interface ParsedCSVRow {
  // 行番号（1始まり、ヘッダー除く）
  lineNumber: number;
  // パースされた値
  values: Record<string, string>;
}

/**
 * シンボル正規化マッピング
 * 
 * 各取引所の表記揺れを標準形式に変換
 */
const SYMBOL_NORMALIZATION_MAP: Record<string, string> = {
  // BTC
  'BTCUSD': 'BTC/USD',
  'BTC-USD': 'BTC/USD',
  'BTC_USD': 'BTC/USD',
  'XBTUSD': 'BTC/USD',
  'XBT/USD': 'BTC/USD',
  'BTCUSDT': 'BTC/USDT',
  'BTC-USDT': 'BTC/USDT',
  'BTC_USDT': 'BTC/USDT',
  'BTCJPY': 'BTC/JPY',
  'BTC-JPY': 'BTC/JPY',
  'BTC_JPY': 'BTC/JPY',
  // ETH
  'ETHUSD': 'ETH/USD',
  'ETH-USD': 'ETH/USD',
  'ETH_USD': 'ETH/USD',
  'ETHUSDT': 'ETH/USDT',
  'ETH-USDT': 'ETH/USDT',
  'ETH_USDT': 'ETH/USDT',
  'ETHJPY': 'ETH/JPY',
  'ETH-JPY': 'ETH/JPY',
  'ETH_JPY': 'ETH/JPY',
  // その他主要ペア
  'XRPUSD': 'XRP/USD',
  'XRP-USD': 'XRP/USD',
  'SOLUSD': 'SOL/USD',
  'SOL-USD': 'SOL/USD',
  'ADAUSD': 'ADA/USD',
  'ADA-USD': 'ADA/USD',
  // FX
  'USDJPY': 'USD/JPY',
  'USD-JPY': 'USD/JPY',
  'EURUSD': 'EUR/USD',
  'EUR-USD': 'EUR/USD',
  'GBPUSD': 'GBP/USD',
  'GBP-USD': 'GBP/USD',
};

/**
 * Side 正規化マッピング
 */
const SIDE_NORMALIZATION_MAP: Record<string, 'buy' | 'sell'> = {
  // 英語
  'buy': 'buy',
  'BUY': 'buy',
  'Buy': 'buy',
  'long': 'buy',
  'LONG': 'buy',
  'Long': 'buy',
  'sell': 'sell',
  'SELL': 'sell',
  'Sell': 'sell',
  'short': 'sell',
  'SHORT': 'sell',
  'Short': 'sell',
  // 日本語
  '買い': 'buy',
  '買': 'buy',
  '売り': 'sell',
  '売': 'sell',
  // 数値
  '1': 'buy',
  '0': 'sell',
  '-1': 'sell',
};

/**
 * トレード正規化サービスクラス
 */
export class TradeNormalizationService {
  /**
   * 単一トレードを正規化
   * 
   * @param rawTrade - 生のトレードデータ（Partial<Trade>）
   * @param lineNumber - CSV行番号（エラーメッセージ用）
   * @returns 正規化結果
   */
  normalizeTradeData(
    rawTrade: Partial<Trade> & { originalSymbol?: string; originalTimestamp?: string },
    lineNumber?: number
  ): NormalizationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const linePrefix = lineNumber ? `${lineNumber}行目: ` : '';

    // === 必須フィールドのバリデーション ===
    if (!rawTrade.timestamp) {
      errors.push(`${linePrefix}timestamp（取引日時）が未入力です。ISO形式（例: 2024-01-15T10:30:00Z）で入力してください`);
    }
    if (!rawTrade.symbol) {
      errors.push(`${linePrefix}symbol（通貨ペア/銘柄）が未入力です。例: BTC/USD, ETH/USDT`);
    }
    if (!rawTrade.side) {
      errors.push(`${linePrefix}side（売買方向）が未入力です。buy または sell を入力してください`);
    }
    if (rawTrade.price === undefined || rawTrade.price === null) {
      errors.push(`${linePrefix}price（価格）が未入力です。数値を入力してください`);
    }
    if (rawTrade.quantity === undefined || rawTrade.quantity === null) {
      errors.push(`${linePrefix}quantity（数量）が未入力です。数値を入力してください`);
    }

    // 必須フィールドエラーがあれば即座に返す
    if (errors.length > 0) {
      return { success: false, errors };
    }

    // === タイムスタンプの正規化 ===
    let normalizedTimestamp: Date;
    const originalTimestamp = rawTrade.originalTimestamp || 
      (rawTrade.timestamp instanceof Date ? rawTrade.timestamp.toISOString() : String(rawTrade.timestamp));
    
    try {
      normalizedTimestamp = this.normalizeTimestamp(rawTrade.timestamp as Date | string | number);
    } catch (error) {
      errors.push(`${linePrefix}timestamp の形式が不正です。「${originalTimestamp}」を解析できません。ISO形式（例: 2024-01-15T10:30:00Z）または Unix タイムスタンプを使用してください`);
      return { success: false, errors };
    }

    // 未来の日時チェック
    if (normalizedTimestamp > new Date()) {
      warnings.push(`${linePrefix}timestamp が未来の日時です: ${normalizedTimestamp.toISOString()}`);
    }

    // === シンボルの正規化 ===
    const originalSymbol = rawTrade.originalSymbol || String(rawTrade.symbol);
    const normalizedSymbol = this.normalizeSymbol(String(rawTrade.symbol));
    
    if (!normalizedSymbol) {
      errors.push(`${linePrefix}symbol「${rawTrade.symbol}」の形式が認識できません。例: BTC/USD, BTCUSD, BTC-USD などの形式を使用してください`);
      return { success: false, errors };
    }

    // === Side の正規化 ===
    const normalizedSide = this.normalizeSide(String(rawTrade.side));
    if (!normalizedSide) {
      errors.push(`${linePrefix}side「${rawTrade.side}」が認識できません。buy または sell を入力してください`);
      return { success: false, errors };
    }

    // === 数値フィールドのバリデーション ===
    const price = Number(rawTrade.price);
    if (isNaN(price) || price <= 0) {
      errors.push(`${linePrefix}price「${rawTrade.price}」は不正な値です。0より大きい数値を入力してください`);
    }

    const quantity = Number(rawTrade.quantity);
    if (isNaN(quantity) || quantity <= 0) {
      errors.push(`${linePrefix}quantity「${rawTrade.quantity}」は不正な値です。0より大きい数値を入力してください`);
    }

    // オプションフィールド
    let fee: number | undefined;
    const rawFee = rawTrade.fee;
    if (rawFee !== undefined && rawFee !== null && String(rawFee) !== '') {
      fee = Number(rawFee);
      if (isNaN(fee) || fee < 0) {
        warnings.push(`${linePrefix}fee「${rawFee}」は不正な値のためスキップされます`);
        fee = undefined;
      }
    }

    if (errors.length > 0) {
      return { success: false, errors, warnings: warnings.length > 0 ? warnings : undefined };
    }

    // === 正規化済みトレードを構築 ===
    const normalizedTrade: NormalizedTrade = {
      id: rawTrade.id || uuidv4(),
      timestamp: normalizedTimestamp,
      symbol: normalizedSymbol,
      normalizedSymbol,
      originalSymbol,
      side: normalizedSide,
      price,
      quantity,
      fee,
      exchange: rawTrade.exchange,
      normalized: true,
    };

    return {
      success: true,
      trade: normalizedTrade,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * 複数トレードを一括正規化
   * 
   * @param rawTrades - 生のトレードデータ配列
   * @returns バッチ正規化結果
   */
  normalizeTrades(
    rawTrades: Array<Partial<Trade> & { originalSymbol?: string; originalTimestamp?: string }>
  ): BatchNormalizationResult {
    const results: NormalizationResult[] = [];
    let succeeded = 0;
    let failed = 0;

    rawTrades.forEach((rawTrade, index) => {
      const result = this.normalizeTradeData(rawTrade, index + 1);
      results.push(result);
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    });

    return {
      total: rawTrades.length,
      succeeded,
      failed,
      results,
    };
  }

  /**
   * タイムスタンプを UTC に正規化
   * 
   * @param timestamp - 入力タイムスタンプ（Date, ISO文字列, Unix秒/ミリ秒）
   * @returns UTC の Date オブジェクト
   * @throws パースエラー
   */
  normalizeTimestamp(timestamp: Date | string | number): Date {
    if (timestamp instanceof Date) {
      if (isNaN(timestamp.getTime())) {
        throw new Error('Invalid Date object');
      }
      return timestamp;
    }

    if (typeof timestamp === 'number') {
      // Unix タイムスタンプ判定（秒 vs ミリ秒）
      // 1970年から2100年の範囲で判定
      if (timestamp < 4102444800) {
        // 秒単位（2100年未満）
        return new Date(timestamp * 1000);
      } else {
        // ミリ秒単位
        return new Date(timestamp);
      }
    }

    // 文字列の場合
    const trimmed = String(timestamp).trim();
    
    // ISO 8601 形式
    const isoDate = new Date(trimmed);
    if (!isNaN(isoDate.getTime())) {
      return isoDate;
    }

    // 日本語形式（例: 2024/01/15 10:30:00）
    const jpPattern = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})[\s]?(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?$/;
    const jpMatch = trimmed.match(jpPattern);
    if (jpMatch) {
      const [, year, month, day, hour = '0', minute = '0', second = '0'] = jpMatch;
      // JST (UTC+9) として解釈し UTC に変換
      const jstDate = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second)
      );
      // JST → UTC（-9時間）
      return new Date(jstDate.getTime() - 9 * 60 * 60 * 1000);
    }

    throw new Error(`Unable to parse timestamp: ${timestamp}`);
  }

  /**
   * シンボルを標準形式に正規化
   * 
   * @param symbol - 入力シンボル
   * @returns 正規化されたシンボル（例: BTC/USD）または null
   */
  normalizeSymbol(symbol: string): string | null {
    const trimmed = symbol.trim().toUpperCase();
    
    // マッピングテーブルから検索
    if (SYMBOL_NORMALIZATION_MAP[trimmed]) {
      return SYMBOL_NORMALIZATION_MAP[trimmed];
    }

    // 既に正規化済み形式（BASE/QUOTE）の場合
    const slashPattern = /^([A-Z]{2,10})\/([A-Z]{2,10})$/;
    if (slashPattern.test(trimmed)) {
      return trimmed;
    }

    // 単純結合形式（BTCUSD → BTC/USD）の推測
    // 3-4文字のベース通貨 + 3-4文字のクォート通貨を想定
    const commonQuotes = ['USD', 'USDT', 'USDC', 'JPY', 'EUR', 'GBP', 'BTC', 'ETH'];
    for (const quote of commonQuotes) {
      if (trimmed.endsWith(quote) && trimmed.length > quote.length) {
        const base = trimmed.slice(0, -quote.length);
        if (base.length >= 2 && base.length <= 6) {
          return `${base}/${quote}`;
        }
      }
    }

    // パース不能
    return null;
  }

  /**
   * Side を標準形式に正規化
   * 
   * @param side - 入力 Side 値
   * @returns 'buy' | 'sell' または null
   */
  normalizeSide(side: string): 'buy' | 'sell' | null {
    const trimmed = side.trim();
    return SIDE_NORMALIZATION_MAP[trimmed] || null;
  }

  /**
   * CSV行データを Trade 互換オブジェクトにパース
   * 
   * @param row - CSVパース済みの行データ
   * @param lineNumber - 行番号
   * @returns パースされたトレードデータ
   */
  parseCSVRow(row: Record<string, string>, _lineNumber: number): Partial<Trade> & { originalSymbol?: string; originalTimestamp?: string } {
    // カラム名の正規化（大文字小文字、空白を無視）
    const normalizedRow: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      normalizedRow[key.trim().toLowerCase()] = value?.trim() || '';
    }

    const timestampStr = normalizedRow['timestamp'] || normalizedRow['time'] || normalizedRow['date'] || normalizedRow['datetime'];
    const sideStr = normalizedRow['side'] || normalizedRow['type'] || normalizedRow['direction'];
    const normalizedSide = this.normalizeSide(sideStr);

    return {
      // timestamp は後で normalizeTradeData で Date に変換されるため、一時的に any を使用
      timestamp: timestampStr ? new Date(timestampStr) : undefined as unknown as Date,
      originalTimestamp: timestampStr,
      symbol: normalizedRow['symbol'] || normalizedRow['pair'] || normalizedRow['market'],
      originalSymbol: normalizedRow['symbol'] || normalizedRow['pair'] || normalizedRow['market'],
      side: normalizedSide || undefined,
      price: parseFloat(normalizedRow['price'] || normalizedRow['rate'] || '0'),
      quantity: parseFloat(normalizedRow['quantity'] || normalizedRow['amount'] || normalizedRow['size'] || normalizedRow['qty'] || '0'),
      fee: normalizedRow['fee'] || normalizedRow['commission'] ? parseFloat(normalizedRow['fee'] || normalizedRow['commission']) : undefined,
      exchange: normalizedRow['exchange'] || normalizedRow['venue'] || undefined,
    };
  }
}

// シングルトンインスタンスをエクスポート
export const tradeNormalizationService = new TradeNormalizationService();
