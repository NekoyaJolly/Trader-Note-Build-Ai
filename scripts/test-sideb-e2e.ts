/**
 * Side-B E2E統合テスト
 *
 * テスト対象フロー:
 *   1. cTrader アカウント自動検出（DBから）
 *   2. cTrader OHLCV取得（執行足 + 上位足）
 *   3. OHLCV永続化（OHLCVCandle テーブル）
 *   4. AI分析（Research → Plan）
 *   5. VirtualTrade作成
 *
 * 実行: npx tsx scripts/test-sideb-e2e.ts
 */

import { PrismaClient } from '@prisma/client';
import { CTraderAuthService } from '../src/backend/services/ctrader/ctraderAuthService';
import { MarketDataService } from '../src/services/marketDataService';
import { ohlcvRepository } from '../src/backend/repositories/ohlcvRepository';
import { AIOrchestrator } from '../src/side-b/orchestrator/aiOrchestrator';
import { config } from '../src/config';

const prisma = new PrismaClient();

// テスト設定
const TEST_SYMBOL = 'XAUUSD';
const TEST_TIMEFRAME = '15m';
const HIGHER_TIMEFRAME = '4h';
const OHLCV_COUNT = 50; // テスト用に少なめ

// 結果トラッカー
const results: { step: string; status: '✅' | '❌' | '⚠️'; detail: string; durationMs?: number }[] = [];

function log(step: string, msg: string) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Step] ${step}`);
    console.log(`${'='.repeat(60)}`);
    console.log(msg);
}

function pass(step: string, detail: string, durationMs?: number) {
    results.push({ step, status: '✅', detail, durationMs });
    console.log(`✅ ${step}: ${detail}${durationMs ? ` (${durationMs}ms)` : ''}`);
}

function fail(step: string, detail: string) {
    results.push({ step, status: '❌', detail });
    console.error(`❌ ${step}: ${detail}`);
}

function warn(step: string, detail: string) {
    results.push({ step, status: '⚠️', detail });
    console.warn(`⚠️ ${step}: ${detail}`);
}

async function main() {
    console.log('\n🚀 Side-B E2E 統合テスト開始\n');
    console.log(`テスト銘柄: ${TEST_SYMBOL}`);
    console.log(`執行足: ${TEST_TIMEFRAME} / 上位足: ${HIGHER_TIMEFRAME}`);
    console.log(`AI設定: ${config.ai.model} @ ${config.ai.baseURL}`);
    console.log(`AI APIキー: ${config.ai.apiKey ? '設定済み' : '❌ 未設定'}`);
    console.log('');

    let accountId: string | undefined;
    let marketDataService: MarketDataService;

    // ─────────────────────────────────────────────
    // Step 1: cTrader アカウント自動検出
    // ─────────────────────────────────────────────
    try {
        log('1. cTrader自動検出', 'CTraderTokenテーブルからaccountIdを検索...');
        const t0 = Date.now();

        const latestToken = await prisma.cTraderToken.findFirst({
            orderBy: { updatedAt: 'desc' },
            select: { accountId: true, expiresAt: true, updatedAt: true },
        });

        if (!latestToken) {
            fail('1. cTrader自動検出', 'CTraderTokenが見つかりません');
            console.log('→ cTraderでログインしてからテストを実行してください');
            return;
        }

        const isExpired = new Date(latestToken.expiresAt) < new Date();
        if (isExpired) {
            warn('1. cTrader自動検出', `トークン期限切れ (expires: ${latestToken.expiresAt})`);
        }

        accountId = latestToken.accountId;
        pass('1. cTrader自動検出', `accountId=${accountId}, expires=${latestToken.expiresAt}`, Date.now() - t0);
    } catch (error) {
        fail('1. cTrader自動検出', String(error));
        return;
    }

    // ─────────────────────────────────────────────
    // Step 2: MarketDataService + cTrader設定
    // ─────────────────────────────────────────────
    try {
        log('2. cTrader接続設定', 'MarketDataService に cTrader を設定...');
        const t0 = Date.now();

        marketDataService = new MarketDataService();
        const authService = new CTraderAuthService(prisma);
        marketDataService.configureCTrader(accountId!, authService);

        if (!marketDataService.isCTraderAvailable()) {
            fail('2. cTrader接続設定', 'configureCTrader後もisCTraderAvailable=false');
            return;
        }

        pass('2. cTrader接続設定', `cTrader有効化完了 (accountId: ${accountId})`, Date.now() - t0);
    } catch (error) {
        fail('2. cTrader接続設定', String(error));
        return;
    }

    // ─────────────────────────────────────────────
    // Step 3: 執行足OHLCVデータ取得
    // ─────────────────────────────────────────────
    let ohlcvData: Awaited<ReturnType<MarketDataService['getHistoricalData']>> = [];
    try {
        log('3. 執行足OHLCV取得', `${TEST_SYMBOL} ${TEST_TIMEFRAME} × ${OHLCV_COUNT}本`);
        const t0 = Date.now();

        ohlcvData = await marketDataService!.getHistoricalData(TEST_SYMBOL, TEST_TIMEFRAME, OHLCV_COUNT);

        if (!ohlcvData || ohlcvData.length === 0) {
            fail('3. 執行足OHLCV取得', 'データが0件');
            return;
        }

        const latest = ohlcvData[ohlcvData.length - 1];
        pass('3. 執行足OHLCV取得',
            `${ohlcvData.length}本取得 | 最新: ${new Date(latest.timestamp).toISOString()} O:${latest.open} H:${latest.high} L:${latest.low} C:${latest.close}`,
            Date.now() - t0
        );
    } catch (error) {
        fail('3. 執行足OHLCV取得', String(error));
        return;
    }

    // ─────────────────────────────────────────────
    // Step 4: 上位足OHLCVデータ取得
    // ─────────────────────────────────────────────
    let higherTFOhlcv: typeof ohlcvData = [];
    try {
        log('4. 上位足OHLCV取得', `${TEST_SYMBOL} ${HIGHER_TIMEFRAME} × ${OHLCV_COUNT}本`);
        const t0 = Date.now();

        higherTFOhlcv = await marketDataService!.getHistoricalData(TEST_SYMBOL, HIGHER_TIMEFRAME, OHLCV_COUNT);

        if (!higherTFOhlcv || higherTFOhlcv.length === 0) {
            warn('4. 上位足OHLCV取得', 'データが0件（単一TFで続行）');
        } else {
            const latest = higherTFOhlcv[higherTFOhlcv.length - 1];
            pass('4. 上位足OHLCV取得',
                `${higherTFOhlcv.length}本取得 | 最新: ${new Date(latest.timestamp).toISOString()} O:${latest.open} C:${latest.close}`,
                Date.now() - t0
            );
        }
    } catch (error) {
        warn('4. 上位足OHLCV取得', `エラー（続行可）: ${error}`);
    }

    // ─────────────────────────────────────────────
    // Step 5: OHLCV永続化
    // ─────────────────────────────────────────────
    try {
        log('5. OHLCV永続化', `OHLCVCandleテーブルにbulkInsert...`);
        const t0 = Date.now();

        const normalizedSymbol = TEST_SYMBOL.replace('/', '');

        // 執行足
        const execInsert = await ohlcvRepository.bulkInsert(
            ohlcvData.map(d => ({
                symbol: normalizedSymbol,
                timeframe: TEST_TIMEFRAME,
                timestamp: new Date(d.timestamp),
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
                volume: d.volume ?? 0,
                source: 'ctrader',
            }))
        );

        // 上位足
        let htfInsert = 0;
        if (higherTFOhlcv.length > 0) {
            htfInsert = await ohlcvRepository.bulkInsert(
                higherTFOhlcv.map(d => ({
                    symbol: normalizedSymbol,
                    timeframe: HIGHER_TIMEFRAME,
                    timestamp: new Date(d.timestamp),
                    open: d.open,
                    high: d.high,
                    low: d.low,
                    close: d.close,
                    volume: d.volume ?? 0,
                    source: 'ctrader',
                }))
            );
        }

        pass('5. OHLCV永続化',
            `執行足 ${execInsert}本 + 上位足 ${htfInsert}本 をDBに保存`,
            Date.now() - t0
        );

        // 確認クエリ
        const count = await prisma.oHLCVCandle.count({
            where: { symbol: normalizedSymbol, timeframe: TEST_TIMEFRAME }
        });
        console.log(`   → DB内の ${normalizedSymbol}/${TEST_TIMEFRAME} レコード数: ${count}`);
    } catch (error) {
        fail('5. OHLCV永続化', String(error));
        // 永続化エラーでもAI処理は続行
    }

    // ─────────────────────────────────────────────
    // Step 6: AI Research + Plan 生成
    // ─────────────────────────────────────────────
    try {
        log('6. AI分析 (Research → Plan)', `${config.ai.model} を使用...`);
        const t0 = Date.now();

        if (!config.ai.apiKey) {
            fail('6. AI分析', 'AI_API_KEYが未設定');
            return;
        }

        const orchestrator = new AIOrchestrator();
        const today = new Date().toISOString().split('T')[0];

        const higherTFData = higherTFOhlcv.length > 0 ? {
            timeframe: HIGHER_TIMEFRAME,
            ohlcvData: higherTFOhlcv.map(d => ({
                timestamp: new Date(d.timestamp),
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
                volume: d.volume,
            })),
        } : undefined;

        const planResult = await orchestrator.generatePlan({
            symbol: TEST_SYMBOL,
            targetDate: today,
            ohlcvData: ohlcvData.map(d => ({
                timestamp: new Date(d.timestamp),
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
                volume: d.volume,
            })),
            higherTFData,
        });

        if (planResult.success && planResult.data) {
            const plan = planResult.data;
            pass('6. AI分析',
                `Plan生成成功 | ID: ${plan.id} | シナリオ数: ${(plan as Record<string, unknown>).scenarios ? 'あり' : '不明'}`,
                Date.now() - t0
            );
            console.log(`   → Plan direction: ${(plan as Record<string, unknown>).direction || 'N/A'}`);
            console.log(`   → confidence: ${(plan as Record<string, unknown>).confidenceScore || 'N/A'}`);
        } else {
            fail('6. AI分析', `Plan生成失敗: ${planResult.error}`);
        }
    } catch (error) {
        fail('6. AI分析', String(error));
    }

    // ─────────────────────────────────────────────
    // 最終結果サマリー
    // ─────────────────────────────────────────────
    console.log('\n');
    console.log('═'.repeat(60));
    console.log('  Side-B E2E 統合テスト結果');
    console.log('═'.repeat(60));
    for (const r of results) {
        const time = r.durationMs ? ` (${r.durationMs}ms)` : '';
        console.log(`  ${r.status} ${r.step}: ${r.detail}${time}`);
    }
    console.log('═'.repeat(60));

    const passed = results.filter(r => r.status === '✅').length;
    const failed = results.filter(r => r.status === '❌').length;
    const warned = results.filter(r => r.status === '⚠️').length;
    console.log(`\n  合計: ${passed} passed, ${failed} failed, ${warned} warnings\n`);

    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
    console.error('Fatal error:', error);
    await prisma.$disconnect();
    process.exit(1);
});
