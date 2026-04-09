#!/usr/bin/env npx ts-node

/**
 * XAU/USD 30分足 OHLCV データ取得 → CSV 出力スクリプト
 *
 * 目的: cTrader API から XAU/USD の30分足データを取得し、CSVファイルに保存
 * 対象期間: 2024-01-01 〜 2025-12-31
 *
 * 制約:
 * - cTrader API の M30 最大取得範囲は 30週間（210日）
 * - 30分足 × 150日 ≈ 最大7200本だがAPI上限が5000本のため、100日ごとに分割
 *
 * 使用方法:
 *   npx ts-node scripts/fetch-xauusd-30m-csv.ts
 */

import { PrismaClient } from '@prisma/client';
import { CTraderAuthService } from '../src/backend/services/ctrader/ctraderAuthService';
import { CTraderDataService, OHLCVBarResult } from '../src/backend/services/ctrader/ctraderDataService';
import * as fs from 'fs';
import * as path from 'path';

// 取得設定
const SYMBOL = 'XAUUSD';
const TIMEFRAME = '30m';
const FROM_DATE = new Date('2024-01-01T00:00:00Z');
const TO_DATE = new Date('2025-12-31T23:59:59Z');

// M30 の最大取得範囲: 30週間（210日）
// 30分足 × 100日 ≈ 最大4800本でAPI上限5000本以内に収まる
const CHUNK_DAYS = 100;
const CHUNK_MS = CHUNK_DAYS * 24 * 60 * 60 * 1000;

// リクエスト間の待機時間（レート制限対策）
const DELAY_BETWEEN_CHUNKS_MS = 3000;

const prisma = new PrismaClient();

function splitDateRange(from: Date, to: Date, chunkMs: number): Array<{ from: Date; to: Date }> {
  const chunks: Array<{ from: Date; to: Date }> = [];
  let currentFrom = from.getTime();
  const endTime = to.getTime();
  while (currentFrom < endTime) {
    const currentTo = Math.min(currentFrom + chunkMs, endTime);
    chunks.push({
      from: new Date(currentFrom),
      to: new Date(currentTo),
    });
    currentFrom = currentTo;
  }
  return chunks;
}

function toCSV(bars: OHLCVBarResult[]): string {
  const header = 'timestamp,open,high,low,close,volume';
  const rows = bars.map(bar =>
    `${bar.timestamp.toISOString()},${bar.open},${bar.high},${bar.low},${bar.close},${bar.volume}`
  );
  return [header, ...rows].join('\n') + '\n';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  XAU/USD ${TIMEFRAME} OHLCV データ取得 → CSV 出力`);
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  シンボル: ${SYMBOL}`);
  console.log(`  時間足: ${TIMEFRAME}`);
  console.log(`  期間: ${FROM_DATE.toISOString()} 〜 ${TO_DATE.toISOString()}`);
  console.log(`  チャンクサイズ: ${CHUNK_DAYS}日`);
  console.log('═══════════════════════════════════════════════════════\n');

  const ctraderToken = await prisma.cTraderToken.findFirst({
    orderBy: { lastConnectedAt: 'desc' },
    select: { accountId: true, expiresAt: true },
  });

  if (!ctraderToken) {
    console.error('❌ cTrader アカウントが見つかりません。');
    process.exit(1);
  }

  const authService = new CTraderAuthService(prisma);
  const dataService = new CTraderDataService(authService);
  const chunks = splitDateRange(FROM_DATE, TO_DATE, CHUNK_MS);
  
  console.log(`📋 ${chunks.length} チャンクに分割して取得開始...\n`);
  const allBars: OHLCVBarResult[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`  チャンク ${i + 1}/${chunks.length}: ${chunk.from.toISOString().slice(0, 10)} 〜 ${chunk.to.toISOString().slice(0, 10)}`);

    try {
      const bars = await dataService.fetchTrendbarsInRange(
        ctraderToken.accountId, SYMBOL, TIMEFRAME, chunk.from, chunk.to
      );
      console.log(`    → ${bars.length} 本取得`);
      allBars.push(...bars);

      if (i < chunks.length - 1) {
        await sleep(DELAY_BETWEEN_CHUNKS_MS);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`    ❌ チャンク ${i + 1} でエラー: ${msg}`);
    }
  }

  const uniqueMap = new Map<string, OHLCVBarResult>();
  for (const bar of allBars) {
    uniqueMap.set(bar.timestamp.toISOString(), bar);
  }

  const sortedBars = Array.from(uniqueMap.values())
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  if (sortedBars.length === 0) {
    console.error('❌ データが 0 件です。');
    process.exit(1);
  }

  const outputDir = path.join(process.cwd(), 'data', 'ohlcv');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `XAUUSD_30m_20240101_20251231.csv`);
  const csvContent = toCSV(sortedBars);
  fs.writeFileSync(outputPath, csvContent, 'utf-8');

  console.log(`\n✅ CSV 出力完了: ${outputPath}`);
  console.log(`  データ件数: ${sortedBars.length} 本`);
}

main().catch(err => console.error(err)).finally(() => prisma.$disconnect());
