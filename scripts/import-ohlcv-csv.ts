/**
 * CSV（data/ohlcv/*.csv）を OHLCVCandle に投入するスクリプト
 *
 * 目的:
 * - ローカル検証で「実データ相当」を DB に投入し、バックテストを API/画面経由で実行できる状態にする
 *
 * 前提:
 * - 環境変数 DATABASE_URL / DIRECT_URL が設定済み
 *
 * 使い方（例）:
 * - npx tsx scripts/import-ohlcv-csv.ts --file data/ohlcv/1767379950644_XAUUSD_15m.csv --symbol XAUUSD --timeframe 15m
 */

import fs from 'fs';
import path from 'path';
import csvParser from 'csv-parser';
import { OHLCVRepository, OHLCVInsertData } from '../src/backend/repositories/ohlcvRepository';

type Args = {
  file: string;
  symbol: string;
  timeframe: string;
  source?: string;
};

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const idx = argv.indexOf(k);
    if (idx === -1) return undefined;
    return argv[idx + 1];
  };

  const file = get('--file');
  const symbol = get('--symbol');
  const timeframe = get('--timeframe');
  const source = get('--source');

  if (!file || !symbol || !timeframe) {
    throw new Error('引数が不足しています: --file --symbol --timeframe は必須です');
  }

  return { file, symbol, timeframe, source };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const filePath = path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSVファイルが見つかりません: ${filePath}`);
  }

  const repo = new OHLCVRepository();

  const rows: OHLCVInsertData[] = [];

  // CSVの列: time,open,high,low,close（volume無しの想定）
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('data', (row: Record<string, string>) => {
        try {
          const time = row.time ?? row.timestamp;
          if (!time) return;

          const timestamp = new Date(time);
          if (Number.isNaN(timestamp.getTime())) return;

          const open = Number(row.open);
          const high = Number(row.high);
          const low = Number(row.low);
          const close = Number(row.close);

          if (![open, high, low, close].every((v) => Number.isFinite(v))) return;

          rows.push({
            symbol: args.symbol,
            timeframe: args.timeframe,
            timestamp,
            open,
            high,
            low,
            close,
            // volume がない場合は 0 扱い（バックテスト用途なら十分）
            volume: 0,
            source: args.source ?? 'csv',
          });
        } catch {
          // 1行エラーはスキップ
        }
      })
      .on('end', () => resolve())
      .on('error', (e) => reject(e));
  });

  console.log(`[import-ohlcv-csv] 読み込み完了: ${rows.length}件 file=${args.file}`);

  const inserted = await repo.bulkInsert(rows);
  console.log(`[import-ohlcv-csv] 挿入完了: inserted=${inserted} (skipDuplicates 有効)`);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('[import-ohlcv-csv] failed:', msg);
  process.exitCode = 1;
});
