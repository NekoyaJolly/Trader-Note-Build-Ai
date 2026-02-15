/**
 * cTrader 認証フロー動作確認スクリプト
 * 
 * 目的: 取得した code をローカルのバックエンド API に送信してDB保存をテスト
 * 
 * 使用方法:
 *   1. 認証URLにアクセスして code を取得
 *   2. CTRADER_AUTH_CODE=取得したcode npx ts-node scripts/test-ctrader-auth-flow.ts
 * 
 * または、既存のトークンをDBに保存:
 *   CTRADER_SAVE_TOKEN=true \
 *   CTRADER_TEST_ACCESS_TOKEN=xxx \
 *   CTRADER_TEST_REFRESH_TOKEN=xxx \
 *   npx ts-node scripts/test-ctrader-auth-flow.ts
 */

import { PrismaClient } from '@prisma/client';
import { config } from '../src/config';

const prisma = new PrismaClient();

// 環境変数
const AUTH_CODE = process.env.CTRADER_AUTH_CODE || '';
const SAVE_TOKEN = process.env.CTRADER_SAVE_TOKEN === 'true';
const ACCESS_TOKEN = process.env.CTRADER_TEST_ACCESS_TOKEN || '';
const REFRESH_TOKEN = process.env.CTRADER_TEST_REFRESH_TOKEN || '';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3100';

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('cTrader 認証フロー動作確認');
  console.log('='.repeat(60));

  // モード判定
  if (SAVE_TOKEN && ACCESS_TOKEN && REFRESH_TOKEN) {
    // 既存トークンをDBに保存
    await saveTokenToDb();
  } else if (AUTH_CODE) {
    // 認可コードでトークン交換
    await exchangeCodeViaApi();
  } else {
    // 認証URLを表示
    await showAuthUrl();
  }

  await prisma.$disconnect();
}

/**
 * 認証URLを表示
 */
async function showAuthUrl(): Promise<void> {
  console.log('\n📋 使用方法:');
  console.log('');
  console.log('【方法1】認可コードを使用（推奨）');
  console.log('  1. 以下のURLにアクセスして cTrader でログイン');
  console.log('  2. リダイレクト先URLの ?code=xxx から code を取得');
  console.log('  3. 以下のコマンドを実行:');
  console.log('');

  // 認証URL生成
  const authUrl = `${config.ctrader.authUrl}?` + new URLSearchParams({
    client_id: config.ctrader.clientId,
    redirect_uri: config.ctrader.redirectUri,
    response_type: 'code',
    scope: 'accounts trading',
  }).toString();

  console.log(`  🔗 認証URL:\n     ${authUrl}`);
  console.log('');
  console.log('  📝 コマンド:');
  console.log('     CTRADER_AUTH_CODE=取得したcode npx ts-node scripts/test-ctrader-auth-flow.ts');
  console.log('');
  console.log('【方法2】既存トークンをDBに保存');
  console.log('  CTRADER_SAVE_TOKEN=true \\');
  console.log('  CTRADER_TEST_ACCESS_TOKEN=xxx \\');
  console.log('  CTRADER_TEST_REFRESH_TOKEN=xxx \\');
  console.log('  npx ts-node scripts/test-ctrader-auth-flow.ts');
  console.log('');

  // 現在のDB状態を確認
  await checkDbStatus();
}

/**
 * API経由で認可コードをトークンに交換
 */
async function exchangeCodeViaApi(): Promise<void> {
  console.log('\n🔄 API経由でトークン交換中...');
  console.log(`  API: ${API_BASE_URL}/api/auth/ctrader/exchange`);
  console.log(`  Code: ${AUTH_CODE.substring(0, 10)}...`);

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/ctrader/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: AUTH_CODE }),
    });

    const data = await response.json() as {
      success?: boolean;
      accountId?: string;
      expiresAt?: string;
      error?: string;
      details?: string;
    };

    if (response.ok && data.success) {
      console.log('\n✅ トークン交換成功！');
      console.log(`  アカウントID: ${data.accountId}`);
      console.log(`  有効期限: ${data.expiresAt}`);
    } else {
      console.log(`\n❌ トークン交換失敗: ${response.status}`);
      console.log(`  エラー: ${data.error || 'Unknown error'}`);
      console.log(`  詳細: ${data.details || 'No details'}`);
    }
  } catch (error) {
    console.log('\n❌ API接続エラー:', error);
    console.log('  ヒント: バックエンドが起動しているか確認してください');
    console.log('         npm run dev:backend');
  }

  // DB状態確認
  await checkDbStatus();
}

/**
 * 既存トークンをDBに直接保存
 */
async function saveTokenToDb(): Promise<void> {
  console.log('\n💾 トークンをDBに保存中...');

  // 有効期限を30日後に設定
  const expiresAt = new Date(Date.now() + 2628000 * 1000);
  const accountId = `ctrader_manual_${Date.now()}`;

  try {
    const saved = await prisma.cTraderToken.upsert({
      where: { accountId },
      create: {
        accountId,
        accessToken: ACCESS_TOKEN,
        refreshToken: REFRESH_TOKEN,
        expiresAt,
        scope: 'accounts trading',
      },
      update: {
        accessToken: ACCESS_TOKEN,
        refreshToken: REFRESH_TOKEN,
        expiresAt,
        scope: 'accounts trading',
      },
    });

    console.log('\n✅ トークン保存成功！');
    console.log(`  アカウントID: ${saved.accountId}`);
    console.log(`  有効期限: ${saved.expiresAt.toISOString()}`);
  } catch (error) {
    console.log('\n❌ DB保存エラー:', error);
  }

  // DB状態確認
  await checkDbStatus();
}

/**
 * DB内のトークン状態を確認
 */
async function checkDbStatus(): Promise<void> {
  console.log('\n📊 DB内のcTraderトークン:');

  try {
    const tokens = await prisma.cTraderToken.findMany({
      select: {
        accountId: true,
        expiresAt: true,
        lastConnectedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (tokens.length === 0) {
      console.log('  （トークンなし）');
    } else {
      tokens.forEach((token, i) => {
        const isExpired = token.expiresAt < new Date();
        const status = isExpired ? '❌ 期限切れ' : '✅ 有効';
        console.log(`  ${i + 1}. ${token.accountId}`);
        console.log(`     有効期限: ${token.expiresAt.toISOString()} ${status}`);
        console.log(`     作成日時: ${token.createdAt.toISOString()}`);
      });
    }
  } catch (error) {
    console.log('  DB接続エラー:', error);
  }
}

// 実行
main().catch(console.error);

