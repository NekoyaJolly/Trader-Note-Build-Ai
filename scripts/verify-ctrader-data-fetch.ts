/**
 * cTrader API データ取得検証スクリプト
 *
 * 目的: cTrader API から OHLCV データが取得できることを検証する
 *
 * 前提条件:
 * - .env に CTRADER_CLIENT_ID, CTRADER_CLIENT_SECRET, DATABASE_URL が設定済み
 * - DB に cTrader トークンが登録済み（OAuth 完了していること）
 *
 * 使用方法:
 *   npx ts-node scripts/verify-ctrader-data-fetch.ts
 *   # または本番DBで検証する場合
 *   DATABASE_URL="postgresql://..." npx ts-node scripts/verify-ctrader-data-fetch.ts
 *
 * オプション:
 *   SYMBOL=EURUSD TIMEFRAME=1h COUNT=10  # デフォルト: EURUSD, 1h, 10本
 */

import { PrismaClient } from '@prisma/client';
import { config } from '../src/config';
import { CTraderAuthService } from '../src/backend/services/ctrader/ctraderAuthService';
import { CTraderDataService } from '../src/backend/services/ctrader/ctraderDataService';

const prisma = new PrismaClient();

const SYMBOL = process.env.SYMBOL || 'EURUSD';
const TIMEFRAME = process.env.TIMEFRAME || '1h';
const COUNT = parseInt(process.env.COUNT || '10', 10);

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('cTrader API データ取得検証');
  console.log('='.repeat(60));

  // 1. 設定確認
  console.log('\n📋 1. 設定確認');
  const hasClientId = !!config.ctrader.clientId;
  const hasClientSecret = !!config.ctrader.clientSecret;
  console.log(`  CTRADER_CLIENT_ID: ${hasClientId ? '✅ 設定済み' : '❌ 未設定'}`);
  console.log(`  CTRADER_CLIENT_SECRET: ${hasClientSecret ? '✅ 設定済み' : '❌ 未設定'}`);

  if (!hasClientId || !hasClientSecret) {
    console.log('\n❌ 検証失敗: cTrader 認証情報が未設定です');
    console.log('   .env に CTRADER_CLIENT_ID と CTRADER_CLIENT_SECRET を設定してください');
    process.exit(1);
  }

  // 2. DB トークン確認
  console.log('\n📋 2. DB トークン確認');
  const ctraderToken = await prisma.cTraderToken.findFirst({
    orderBy: { lastConnectedAt: 'desc' },
    select: {
      accountId: true,
      expiresAt: true,
      lastConnectedAt: true,
    },
  });

  if (!ctraderToken) {
    console.log('  ❌ cTrader アカウント未登録');
    console.log('\n  対策: アプリで cTrader OAuth ログインを完了してください');
    console.log('  - 本番: https://trader-note-build-ai.vercel.app/auth/ctrader/callback へリダイレクト後ログイン');
    console.log('  - ローカル: npm run dev 起動後、認証URL にアクセス');
    process.exit(1);
  }

  const isExpired = ctraderToken.expiresAt < new Date();
  console.log(`  アカウントID: ${ctraderToken.accountId}`);
  console.log(`  有効期限: ${ctraderToken.expiresAt.toISOString()} ${isExpired ? '⚠️ 期限切れ（リフレッシュ試行）' : '✅'}`);
  console.log(`  最終接続: ${ctraderToken.lastConnectedAt?.toISOString() ?? 'なし'}`);

  // 3. cTrader API でデータ取得
  console.log('\n📋 3. cTrader API でデータ取得');
  console.log(`  シンボル: ${SYMBOL}, 時間足: ${TIMEFRAME}, 本数: ${COUNT}`);

  const authService = new CTraderAuthService(prisma);
  const dataService = new CTraderDataService(authService);

  try {
    const bars = await dataService.fetchTrendbars(
      ctraderToken.accountId,
      SYMBOL,
      TIMEFRAME,
      COUNT
    );

    if (bars.length === 0) {
      console.log('\n⚠️ データが 0 件返されました');
      console.log('  - シンボル名が正しいか確認（例: EURUSD, XAUUSD）');
      console.log('  - 市場が開いている時間帯か確認');
      process.exit(1);
    }

    console.log(`\n✅ cTrader API からのデータ取得に成功（${bars.length} 件）`);
    console.log('\n  取得サンプル（直近3件）:');
    bars.slice(-3).forEach((bar, i) => {
      console.log(
        `    ${i + 1}. ${bar.timestamp.toISOString()} O=${bar.open} H=${bar.high} L=${bar.low} C=${bar.close} V=${bar.volume}`
      );
    });

    console.log('\n' + '='.repeat(60));
    console.log('✅ 検証完了: cTrader API データ取得は正常に動作しています');
    console.log('='.repeat(60));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('\n❌ cTrader API データ取得エラー:', msg);
    if (stack) {
      console.error('\nスタックトレース:');
      console.error(stack);
    }
    console.log('\n  よくある原因:');
    console.log('  - トークン期限切れ → アプリで再ログイン');
    console.log('  - シンボル名不一致 → SYMBOL=EURUSD 等で指定');
    console.log('  - ネットワーク/ファイアウォール → cTrader API への接続を確認');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
