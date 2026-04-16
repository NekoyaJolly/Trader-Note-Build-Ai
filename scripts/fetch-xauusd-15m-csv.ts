#!/usr/bin/env npx ts-node

/**
 * XAU/USD 15分足 OHLCV データ取得 → CSV 出力スクリプト
 *
 * 目的: cTrader API から XAU/USD の15分足データを取得し、CSVファイルに保存
 * 対象期間: 2025-06-01 〜 2025-12-20
 *
 * 制約:
 * - cTrader API の M15 最大取得範囲は 105日（15週間）
 * - 203日分のデータを取得するため、自動チャンク分割で複数回リクエスト
 *
 * 前提条件:
 * - .env に CTRADER_CLIENT_ID, CTRADER_CLIENT_SECRET, DATABASE_URL が設定済み
 * - DB に cTrader トークンが登録済み（OAuth 完了していること）
 *
 * 使用方法:
 *   npx ts-node scripts/fetch-xauusd-15m-csv.ts
 */

import { PrismaClient } from '@prisma/client';
import { CTraderAuthService } from '../src/backend/services/ctrader/ctraderAuthService';
import { CTraderDataService, OHLCVBarResult } from '../src/backend/services/ctrader/ctraderDataService';
import * as fs from 'fs';
import * as path from 'path';

// 取得設定
const SYMBOL = 'XAUUSD';
const TIMEFRAME = '15m';
const FROM_DATE = new Date('2025-01-01T00:00:00Z');
const TO_DATE = new Date('2025-05-31T23:59:59Z');

// M15 の最大取得範囲: 105日
// 15分足 × 50日 ≈ 最大4800本でAPI上限5000本以内に収まる
const CHUNK_DAYS = 50;
const CHUNK_MS = CHUNK_DAYS * 24 * 60 * 60 * 1000;

// リクエスト間の待機時間（レート制限対策）
const DELAY_BETWEEN_CHUNKS_MS = 3000;

const prisma = new PrismaClient();

/**
 * 日付範囲をチャンクに分割
 * cTrader API の期間制限に対応するため、安全な単位に分割する
 */
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

/**
 * OHLCV バー配列を CSV 文字列に変換
 */
function toCSV(bars: OHLCVBarResult[]): string {
    const header = 'timestamp,open,high,low,close,volume';
    const rows = bars.map(bar =>
        `${bar.timestamp.toISOString()},${bar.open},${bar.high},${bar.low},${bar.close},${bar.volume}`
    );
    return [header, ...rows].join('\n') + '\n';
}

/**
 * スリープ（レート制限対策）
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  XAU/USD 15分足 OHLCV データ取得 → CSV 出力');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  シンボル: ${SYMBOL}`);
    console.log(`  時間足: ${TIMEFRAME}`);
    console.log(`  期間: ${FROM_DATE.toISOString()} 〜 ${TO_DATE.toISOString()}`);
    console.log(`  チャンクサイズ: ${CHUNK_DAYS}日`);
    console.log('═══════════════════════════════════════════════════════\n');

    // 1. DB からアカウント情報取得
    console.log('📋 1. cTrader アカウント確認...');
    const ctraderToken = await prisma.cTraderToken.findFirst({
        orderBy: { lastConnectedAt: 'desc' },
        select: {
            accountId: true,
            expiresAt: true,
        },
    });

    if (!ctraderToken) {
        console.error('❌ cTrader アカウントが見つかりません。OAuth ログインを完了してください。');
        process.exit(1);
    }

    console.log(`  アカウントID: ${ctraderToken.accountId}`);
    console.log(`  トークン有効期限: ${ctraderToken.expiresAt.toISOString()}`);

    // 2. データ取得サービス初期化
    const authService = new CTraderAuthService(prisma);
    const dataService = new CTraderDataService(authService);

    // 3. チャンク分割
    const chunks = splitDateRange(FROM_DATE, TO_DATE, CHUNK_MS);
    console.log(`\n📋 2. ${chunks.length} チャンクに分割して取得開始...\n`);

    const allBars: OHLCVBarResult[] = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(
            `  チャンク ${i + 1}/${chunks.length}: ` +
            `${chunk.from.toISOString().slice(0, 10)} 〜 ${chunk.to.toISOString().slice(0, 10)}`
        );

        try {
            const bars = await dataService.fetchTrendbarsInRange(
                ctraderToken.accountId,
                SYMBOL,
                TIMEFRAME,
                chunk.from,
                chunk.to,
            );

            console.log(`    → ${bars.length} 本取得`);
            allBars.push(...bars);

            // レート制限対策（最後のチャンク以外は待機）
            if (i < chunks.length - 1) {
                console.log(`    ⏳ ${DELAY_BETWEEN_CHUNKS_MS / 1000}秒待機...`);
                await sleep(DELAY_BETWEEN_CHUNKS_MS);
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`    ❌ チャンク ${i + 1} でエラー: ${msg}`);
            // エラーがあっても続行する（部分的なデータでもCSVに保存）
        }
    }

    // 4. 重複除去 & ソート
    // チャンク境界で重複バーが発生する可能性があるため、timestampで重複除去
    console.log(`\n📋 3. データ整理中...`);
    const uniqueMap = new Map<string, OHLCVBarResult>();
    for (const bar of allBars) {
        const key = bar.timestamp.toISOString();
        uniqueMap.set(key, bar);
    }

    const sortedBars = Array.from(uniqueMap.values())
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    console.log(`  取得合計: ${allBars.length} 本`);
    console.log(`  重複除去後: ${sortedBars.length} 本`);

    if (sortedBars.length === 0) {
        console.error('❌ データが 0 件です。取得に失敗した可能性があります。');
        process.exit(1);
    }

    // 最初と最後のバーを表示
    const first = sortedBars[0];
    const last = sortedBars[sortedBars.length - 1];
    console.log(`  最初のバー: ${first.timestamp.toISOString()} O=${first.open}`);
    console.log(`  最後のバー: ${last.timestamp.toISOString()} O=${last.open}`);

    // 5. CSV ファイル出力
    const outputDir = path.join(process.cwd(), 'data', 'ohlcv');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(
        outputDir,
        `XAUUSD_15m_20250101_20250531.csv`
    );

    const csvContent = toCSV(sortedBars);
    fs.writeFileSync(outputPath, csvContent, 'utf-8');

    console.log(`  ファイル: ${outputPath}`);
    console.log(`  データ件数: ${sortedBars.length} 本`);
    console.log(`  ファイルサイズ: ${(Buffer.byteLength(csvContent) / 1024).toFixed(1)} KB`);
    console.log(`═══════════════════════════════════════════════════════\n`);
}

main()
    .catch((err) => {
        console.error('Fatal:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
