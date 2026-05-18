/**
 * Jest Global Setup - テスト実行前の環境確認
 * 
 * 目的:
 * - テスト開始時にシークレットの設定状況を表示
 * - テストモード（最小限/フル）を明示
 * - 料金発生APIの呼び出し数を事前に警告
 */

export default (): Promise<void> => {
  console.log('\n🔧 Test Environment Setup\n');

  const secrets = {
    AI_API_KEY: !!process.env.AI_API_KEY,
    MARKET_API_KEY: !!process.env.MARKET_API_KEY,
    CTRADER_CLIENT_ID: !!process.env.CTRADER_CLIENT_ID,
    CTRADER_CLIENT_SECRET: !!process.env.CTRADER_CLIENT_SECRET,
  };
  
  const isMinimalMode = process.env.CI === 'true' && 
                        process.env.RUN_FULL_PAID_API_TESTS !== 'true';
  
  console.log(`Test Mode: ${isMinimalMode ? '💰 Minimal (Cost Optimized)' : '🚀 Full'}\n`);
  
  if (secrets.AI_API_KEY) {
    if (isMinimalMode) {
      console.log('✅ AI_API_KEY configured - Running MINIMAL tests (1-2 API calls)');
    } else {
      console.log('✅ AI_API_KEY configured - Running FULL tests (multiple API calls)');
    }
  } else {
    console.warn('⚠️  AI_API_KEY not set - AI tests will be skipped');
  }
  
  if (secrets.MARKET_API_KEY) {
    if (isMinimalMode) {
      console.log('✅ MARKET_API_KEY configured - Running MINIMAL tests (1-2 API calls)');
    } else {
      console.log('✅ MARKET_API_KEY configured - Running FULL tests (multiple API calls)');
    }
  } else {
    console.warn('⚠️  MARKET_API_KEY not set - Market Data tests will be skipped');
  }
  
  if (secrets.CTRADER_CLIENT_ID && secrets.CTRADER_CLIENT_SECRET) {
    console.log('✅ cTrader credentials configured - Running ALL tests (no cost limit)');
  } else {
    console.warn('⚠️  cTrader credentials not set - cTrader tests will be skipped');
  }
  
  console.log('');
  return Promise.resolve();
};
