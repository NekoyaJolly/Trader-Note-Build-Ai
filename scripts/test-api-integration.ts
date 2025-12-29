/**
 * API 統合テストスクリプト
 * 
 * 目的: AI API と Market Data API の接続確認
 * 
 * 使用方法:
 *   npx ts-node scripts/test-api-integration.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { MarketDataService } from '../src/services/marketDataService';
import { AISummaryService, TradeDataForSummary } from '../src/services/aiSummaryService';
import { config } from '../src/config';

// コンソール出力用のユーティリティ
const log = {
  section: (title: string) => {
    console.log('\n' + '='.repeat(60));
    console.log(`📌 ${title}`);
    console.log('='.repeat(60));
  },
  success: (msg: string) => console.log(`✅ ${msg}`),
  error: (msg: string) => console.log(`❌ ${msg}`),
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  warn: (msg: string) => console.log(`⚠️  ${msg}`),
  data: (label: string, data: any) => {
    console.log(`📊 ${label}:`);
    console.log(JSON.stringify(data, null, 2));
  },
};

/**
 * 環境変数の設定状況を確認
 */
function checkEnvironmentVariables(): boolean {
  log.section('環境変数確認');

  const checks = [
    { name: 'AI_API_KEY', value: config.ai.apiKey, required: false },
    { name: 'AI_MODEL', value: config.ai.model, required: false },
    { name: 'AI_BASE_URL', value: config.ai.baseURL, required: false },
    { name: 'MARKET_API_URL', value: config.market.apiUrl, required: false },
    { name: 'MARKET_API_KEY', value: config.market.apiKey, required: false },
  ];

  let allSet = true;
  for (const check of checks) {
    if (check.value) {
      // API キーは一部マスク表示
      const displayValue = check.name.includes('KEY') 
        ? `${check.value.substring(0, 8)}...${check.value.substring(check.value.length - 4)}`
        : check.value;
      log.success(`${check.name}: ${displayValue}`);
    } else {
      if (check.required) {
        log.error(`${check.name}: 未設定（必須）`);
        allSet = false;
      } else {
        log.warn(`${check.name}: 未設定（オプション）`);
      }
    }
  }

  return allSet;
}

/**
 * 市場データ API のテスト
 */
async function testMarketDataAPI(): Promise<boolean> {
  log.section('市場データ API テスト');

  const service = new MarketDataService();

  // API 設定確認
  if (!service.isApiConfigured()) {
    log.warn('市場 API が設定されていません。シミュレーションモードでテストします。');
  } else {
    log.success('市場 API が設定されています。実際の API を呼び出します。');
  }

  try {
    // テスト1: 現在の市場データ取得
    log.info('テスト 1: 現在の市場データ取得 (BTC/USD, 15m)');
    const currentData = await service.getCurrentMarketData('BTC/USD', '15m');
    log.data('取得データ', {
      symbol: currentData.symbol,
      timestamp: currentData.timestamp,
      open: currentData.open,
      high: currentData.high,
      low: currentData.low,
      close: currentData.close,
      volume: currentData.volume,
      indicators: currentData.indicators,
    });
    log.success('現在の市場データ取得成功');

    // テスト2: EUR/USD のデータ取得
    log.info('テスト 2: 別の銘柄 (EUR/USD, 1h)');
    const eurData = await service.getCurrentMarketData('EUR/USD', '1h');
    log.data('取得データ', {
      symbol: eurData.symbol,
      timestamp: eurData.timestamp,
      close: eurData.close,
    });
    log.success('EUR/USD データ取得成功');

    // テスト3: 履歴データ取得
    log.info('テスト 3: 履歴データ取得 (BTC/USD, 15m, 5件)');
    const historicalData = await service.getHistoricalData('BTC/USD', '15m', 5);
    log.info(`取得件数: ${historicalData.length}`);
    if (historicalData.length > 0) {
      log.data('最初のデータ', {
        timestamp: historicalData[0].timestamp,
        close: historicalData[0].close,
      });
      log.data('最後のデータ', {
        timestamp: historicalData[historicalData.length - 1].timestamp,
        close: historicalData[historicalData.length - 1].close,
      });
    }
    log.success('履歴データ取得成功');

    return true;
  } catch (error) {
    log.error(`市場データ API テスト失敗: ${error}`);
    return false;
  }
}

/**
 * AI API のテスト
 */
async function testAIAPI(): Promise<boolean> {
  log.section('AI API テスト');

  const service = new AISummaryService();

  // テスト用のトレードデータ
  const testTradeData: TradeDataForSummary = {
    symbol: 'BTC/USD',
    side: 'buy',
    price: 50000,
    quantity: 0.1,
    timestamp: new Date(),
    marketContext: {
      trend: 'uptrend',
      rsi: 65,
      macd: 150,
      timeframe: '15m',
    },
  };

  try {
    log.info('AI 要約生成テスト開始...');
    log.data('入力データ', testTradeData);

    const result = await service.generateTradeSummary(testTradeData);

    log.data('AI 要約結果', {
      summary: result.summary,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    });

    if (result.model === 'fallback') {
      log.warn('API キー未設定のため、基本要約を使用しました');
    } else {
      log.success(`AI API 呼び出し成功 (モデル: ${result.model})`);
      log.info(`トークン使用量: ${(result.promptTokens || 0) + (result.completionTokens || 0)}`);
    }

    return true;
  } catch (error) {
    log.error(`AI API テスト失敗: ${error}`);
    return false;
  }
}

/**
 * メイン実行関数
 */
async function main() {
  console.log('\n🚀 API 統合テスト開始\n');
  console.log('日時:', new Date().toLocaleString('ja-JP'));

  // 環境変数確認
  checkEnvironmentVariables();

  // 市場データ API テスト
  const marketResult = await testMarketDataAPI();

  // AI API テスト
  const aiResult = await testAIAPI();

  // 結果サマリー
  log.section('テスト結果サマリー');
  console.log(`市場データ API: ${marketResult ? '✅ 成功' : '❌ 失敗'}`);
  console.log(`AI API: ${aiResult ? '✅ 成功' : '❌ 失敗'}`);

  if (marketResult && aiResult) {
    console.log('\n🎉 すべてのテストが成功しました！\n');
    process.exit(0);
  } else {
    console.log('\n⚠️ 一部のテストが失敗しました。設定を確認してください。\n');
    process.exit(1);
  }
}

// 実行
main().catch((error) => {
  console.error('テスト実行エラー:', error);
  process.exit(1);
});
