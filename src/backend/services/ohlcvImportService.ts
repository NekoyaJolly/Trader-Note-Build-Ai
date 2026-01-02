/**
 * OHLCV データインポートサービス
 * 
 * 目的: ユーザーが持つヒストリカルCSVデータをDBにインポート
 * 
 * CSVフォーマット: time,open,high,low,close
 * ファイル命名規則: {SYMBOL}_{TIMEFRAME}.csv（例: BTCUSD_15m.csv）
 * 
 * 機能:
 * - CSV パースとバリデーション
 * - ファイル名からシンボル・時間足を推定
 * - UPSERT（重複時は上書き）
 * - DataPreset メタ情報の作成・更新
 * 
 * @see NOTE.md - ドメイン仕様
 */

import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { PrismaClient, Prisma } from '@prisma/client';
import { OHLCVRepository, OHLCVInsertData } from '../repositories/ohlcvRepository';

const prisma = new PrismaClient();

/**
 * インポート結果
 */
export interface OHLCVImportResult {
  /** インポートされたレコード数 */
  recordsImported: number;
  /** スキップされた行数（無効データ） */
  skipped: number;
  /** エラーメッセージ一覧 */
  errors: string[];
  /** シンボル */
  symbol: string;
  /** 時間足 */
  timeframe: string;
  /** データ開始日時 */
  startDate: Date | null;
  /** データ終了日時 */
  endDate: Date | null;
  /** 作成されたプリセット ID */
  presetId: string | null;
}

/**
 * OHLCV インポートオプション
 */
export interface OHLCVImportOptions {
  /** シンボル（省略時はファイル名から推定） */
  symbol?: string;
  /** 時間足（省略時はファイル名から推定） */
  timeframe?: string;
  /** データソース名 */
  source?: string;
  /** プリセット名（表示用） */
  presetName?: string;
  /** 説明 */
  description?: string;
}

/**
 * 有効な時間足一覧
 */
const VALID_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

/**
 * OHLCV データインポートサービス
 */
export class OHLCVImportService {
  private ohlcvRepository: OHLCVRepository;
  private readonly requiredHeaders = ['time', 'open', 'high', 'low', 'close'];

  constructor() {
    this.ohlcvRepository = new OHLCVRepository();
  }

  /**
   * CSV ファイルから OHLCV データをインポート
   * 
   * @param filePath - CSV ファイルパス
   * @param options - インポートオプション
   * @returns インポート結果
   */
  async importFromCSV(filePath: string, options: OHLCVImportOptions = {}): Promise<OHLCVImportResult> {
    // ファイルバリデーション
    this.validateFile(filePath);

    // シンボル・時間足を決定（オプション > ファイル名から推定）
    const { symbol, timeframe } = this.resolveSymbolAndTimeframe(filePath, options);

    // CSV パース
    const { candles, skipped, errors } = await this.parseCSV(filePath, symbol, timeframe, options.source);

    if (candles.length === 0) {
      return {
        recordsImported: 0,
        skipped,
        errors,
        symbol,
        timeframe,
        startDate: null,
        endDate: null,
        presetId: null,
      };
    }

    // UPSERT でデータを挿入
    const insertedCount = await this.ohlcvRepository.bulkInsert(candles);

    // 日付範囲を計算
    const timestamps = candles.map(c => c.timestamp.getTime());
    const startDate = new Date(Math.min(...timestamps));
    const endDate = new Date(Math.max(...timestamps));

    // DataPreset メタ情報を作成・更新
    const preset = await this.upsertPreset({
      symbol,
      timeframe,
      startDate,
      endDate,
      recordCount: candles.length,
      name: options.presetName,
      description: options.description,
      sourceFile: path.basename(filePath),
    });

    console.log(`[OHLCVImport] インポート完了: ${symbol}/${timeframe} - ${insertedCount}件`);

    return {
      recordsImported: insertedCount,
      skipped,
      errors,
      symbol,
      timeframe,
      startDate,
      endDate,
      presetId: preset.id,
    };
  }

  /**
   * ファイルの存在・拡張子・ヘッダーを検証
   */
  private validateFile(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      throw new Error(`CSV ファイルが見つかりません: ${filePath}`);
    }

    if (path.extname(filePath).toLowerCase() !== '.csv') {
      throw new Error('拡張子が .csv ではないファイルは取り込めません');
    }

    const firstLine = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)[0];
    const headers = firstLine.split(',').map(h => h.trim().toLowerCase());
    const missing = this.requiredHeaders.filter(h => !headers.includes(h));

    if (missing.length > 0) {
      throw new Error(`CSV ヘッダーが不足しています: ${missing.join(', ')} (必須: time,open,high,low,close)`);
    }
  }

  /**
   * ファイル名からシンボル・時間足を推定
   * 例: BTCUSD_15m.csv → { symbol: 'BTCUSD', timeframe: '15m' }
   */
  private resolveSymbolAndTimeframe(
    filePath: string,
    options: OHLCVImportOptions
  ): { symbol: string; timeframe: string } {
    // オプションで指定されていればそれを使用
    if (options.symbol && options.timeframe) {
      return { symbol: options.symbol.toUpperCase(), timeframe: options.timeframe.toLowerCase() };
    }

    // ファイル名から推定
    const fileName = path.basename(filePath, '.csv');
    const parts = fileName.split('_');

    let symbol = options.symbol?.toUpperCase() || '';
    let timeframe = options.timeframe?.toLowerCase() || '';

    if (parts.length >= 2) {
      // 最後の部分が有効な時間足かチェック
      const lastPart = parts[parts.length - 1].toLowerCase();
      if (VALID_TIMEFRAMES.includes(lastPart)) {
        timeframe = timeframe || lastPart;
        symbol = symbol || parts.slice(0, -1).join('_').toUpperCase();
      } else {
        // 時間足が見つからない場合は全体をシンボルとして扱う
        symbol = symbol || fileName.toUpperCase();
      }
    } else {
      symbol = symbol || fileName.toUpperCase();
    }

    // デフォルト値
    if (!symbol) {
      throw new Error('シンボルを特定できません。ファイル名を {SYMBOL}_{TIMEFRAME}.csv 形式にするか、options.symbol を指定してください');
    }
    if (!timeframe) {
      timeframe = '15m'; // デフォルト時間足
      console.warn(`[OHLCVImport] 時間足を推定できません。デフォルト値 '15m' を使用します`);
    }

    return { symbol, timeframe };
  }

  /**
   * CSV をパースして OHLCV データ配列を生成
   */
  private async parseCSV(
    filePath: string,
    symbol: string,
    timeframe: string,
    source?: string
  ): Promise<{
    candles: OHLCVInsertData[];
    skipped: number;
    errors: string[];
  }> {
    const candles: OHLCVInsertData[] = [];
    let skipped = 0;
    const errors: string[] = [];
    let lineNumber = 1; // ヘッダー行をスキップ

    return new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          lineNumber++;
          try {
            // time カラムをパース
            const timeValue = row.time || row.Time || row.TIME || row.timestamp || row.Timestamp;
            if (!timeValue) {
              skipped++;
              errors.push(`行 ${lineNumber}: time カラムが見つかりません`);
              return;
            }

            // 日時パース（ISO形式、Unix秒、Unix ミリ秒に対応）
            let timestamp: Date;
            const numericTime = Number(timeValue);
            if (!isNaN(numericTime)) {
              // Unix タイムスタンプ（秒 or ミリ秒）
              timestamp = numericTime > 1e12
                ? new Date(numericTime)           // ミリ秒
                : new Date(numericTime * 1000);   // 秒
            } else {
              // ISO 形式などの文字列
              timestamp = new Date(timeValue);
            }

            if (isNaN(timestamp.getTime())) {
              skipped++;
              errors.push(`行 ${lineNumber}: 無効な日時フォーマット: ${timeValue}`);
              return;
            }

            // OHLC 値をパース
            const open = parseFloat(row.open || row.Open || row.OPEN);
            const high = parseFloat(row.high || row.High || row.HIGH);
            const low = parseFloat(row.low || row.Low || row.LOW);
            const close = parseFloat(row.close || row.Close || row.CLOSE);
            // volume は任意（なければ 0）
            const volume = parseFloat(row.volume || row.Volume || row.VOLUME || '0');

            // 数値バリデーション
            if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
              skipped++;
              errors.push(`行 ${lineNumber}: 無効な OHLC 値`);
              return;
            }

            // OHLC 論理チェック
            if (high < low) {
              errors.push(`行 ${lineNumber}: 警告 - high(${high}) < low(${low})`);
            }

            candles.push({
              symbol,
              timeframe,
              timestamp,
              open,
              high,
              low,
              close,
              volume: isNaN(volume) ? 0 : volume,
              source: source || 'csv',
            });
          } catch (err) {
            skipped++;
            errors.push(`行 ${lineNumber}: パースエラー - ${err instanceof Error ? err.message : String(err)}`);
          }
        })
        .on('end', () => {
          resolve({ candles, skipped, errors });
        })
        .on('error', (err) => {
          reject(new Error(`CSV 読み込みエラー: ${err.message}`));
        });
    });
  }

  /**
   * DataPreset メタ情報を作成・更新
   */
  private async upsertPreset(params: {
    symbol: string;
    timeframe: string;
    startDate: Date;
    endDate: Date;
    recordCount: number;
    name?: string;
    description?: string;
    sourceFile?: string;
  }): Promise<{ id: string }> {
    const preset = await prisma.dataPreset.upsert({
      where: {
        symbol_timeframe: {
          symbol: params.symbol,
          timeframe: params.timeframe,
        },
      },
      update: {
        startDate: params.startDate,
        endDate: params.endDate,
        recordCount: params.recordCount,
        name: params.name,
        description: params.description,
        sourceFile: params.sourceFile,
        updatedAt: new Date(),
      },
      create: {
        symbol: params.symbol,
        timeframe: params.timeframe,
        startDate: params.startDate,
        endDate: params.endDate,
        recordCount: params.recordCount,
        name: params.name,
        description: params.description,
        sourceFile: params.sourceFile,
      },
    });

    return { id: preset.id };
  }

  /**
   * 全プリセット一覧を取得
   */
  async listPresets(): Promise<Array<{
    id: string;
    symbol: string;
    timeframe: string;
    startDate: Date;
    endDate: Date;
    recordCount: number;
    name: string | null;
    description: string | null;
    sourceFile: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>> {
    return prisma.dataPreset.findMany({
      orderBy: [
        { symbol: 'asc' },
        { timeframe: 'asc' },
      ],
    });
  }

  /**
   * プリセットを削除（関連 OHLCV データも削除）
   */
  async deletePreset(presetId: string): Promise<{ deletedOhlcvCount: number }> {
    const preset = await prisma.dataPreset.findUnique({
      where: { id: presetId },
    });

    if (!preset) {
      throw new Error(`プリセットが見つかりません: ${presetId}`);
    }

    // 関連 OHLCV データを削除
    const deleteResult = await prisma.oHLCVCandle.deleteMany({
      where: {
        symbol: preset.symbol,
        timeframe: preset.timeframe,
        source: 'csv', // CSV インポートされたデータのみ削除
      },
    });

    // プリセットを削除
    await prisma.dataPreset.delete({
      where: { id: presetId },
    });

    console.log(`[OHLCVImport] プリセット削除: ${preset.symbol}/${preset.timeframe} - OHLCV ${deleteResult.count}件削除`);

    return { deletedOhlcvCount: deleteResult.count };
  }

  /**
   * 指定期間のデータカバレッジをチェック
   * 
   * @returns カバレッジ情報（不足期間があれば返す）
   */
  async checkCoverage(params: {
    symbol: string;
    timeframe: string;
    startDate: Date;
    endDate: Date;
  }): Promise<{
    hasCoverage: boolean;
    presetExists: boolean;
    dataCount: number;
    missingStart?: Date;
    missingEnd?: Date;
  }> {
    // プリセットの存在確認
    const preset = await prisma.dataPreset.findUnique({
      where: {
        symbol_timeframe: {
          symbol: params.symbol,
          timeframe: params.timeframe,
        },
      },
    });

    if (!preset) {
      return {
        hasCoverage: false,
        presetExists: false,
        dataCount: 0,
        missingStart: params.startDate,
        missingEnd: params.endDate,
      };
    }

    // 期間内のデータ数をカウント
    const dataCount = await prisma.oHLCVCandle.count({
      where: {
        symbol: params.symbol,
        timeframe: params.timeframe,
        timestamp: {
          gte: params.startDate,
          lte: params.endDate,
        },
      },
    });

    // プリセットの期間と要求期間を比較
    const presetStart = preset.startDate.getTime();
    const presetEnd = preset.endDate.getTime();
    const reqStart = params.startDate.getTime();
    const reqEnd = params.endDate.getTime();

    let missingStart: Date | undefined;
    let missingEnd: Date | undefined;

    if (reqStart < presetStart) {
      missingStart = params.startDate;
      missingEnd = new Date(presetStart);
    }
    if (reqEnd > presetEnd) {
      if (!missingStart) {
        missingStart = new Date(presetEnd);
      }
      missingEnd = params.endDate;
    }

    const hasCoverage = !missingStart && !missingEnd && dataCount > 0;

    return {
      hasCoverage,
      presetExists: true,
      dataCount,
      missingStart,
      missingEnd,
    };
  }
}

// シングルトンインスタンス
export const ohlcvImportService = new OHLCVImportService();
