/**
 * cTrader Token 動作確認スクリプト
 * 
 * 目的: 取得したTokenが正しく動作するか確認
 * 
 * 使用方法:
 *   npx ts-node scripts/test-ctrader-token.ts
 */

import { config } from '../src/config';

// テスト用のToken情報（Playground で取得したもの）
const TEST_ACCESS_TOKEN = process.env.CTRADER_TEST_ACCESS_TOKEN || '';
const TEST_REFRESH_TOKEN = process.env.CTRADER_TEST_REFRESH_TOKEN || '';

/**
 * cTrader Open API のアカウント情報を取得
 * REST API でトークンの有効性を確認
 */
async function testTokenValidity(): Promise<void> {
  console.log('='.repeat(60));
  console.log('cTrader Token 動作確認');
  console.log('='.repeat(60));
  
  // 1. 設定確認
  console.log('\n📋 設定確認:');
  console.log(`  Client ID: ${config.ctrader.clientId ? '設定済み ✅' : '未設定 ❌'}`);
  console.log(`  Client Secret: ${config.ctrader.clientSecret ? '設定済み ✅' : '未設定 ❌'}`);
  console.log(`  Auth URL: ${config.ctrader.authUrl}`);
  console.log(`  Token URL: ${config.ctrader.tokenUrl}`);
  console.log(`  Redirect URI: ${config.ctrader.redirectUri}`);
  
  if (!TEST_ACCESS_TOKEN) {
    console.log('\n⚠️  テスト用アクセストークンが設定されていません');
    console.log('   環境変数 CTRADER_TEST_ACCESS_TOKEN を設定してください');
    console.log('\n   例: CTRADER_TEST_ACCESS_TOKEN=your_token npx ts-node scripts/test-ctrader-token.ts');
    return;
  }
  
  // 2. トークン情報表示（一部マスク）
  console.log('\n🔑 トークン情報:');
  console.log(`  Access Token: ${maskToken(TEST_ACCESS_TOKEN)}`);
  console.log(`  Refresh Token: ${TEST_REFRESH_TOKEN ? maskToken(TEST_REFRESH_TOKEN) : '未設定'}`);
  
  // 3. cTrader API テスト（アカウント情報取得）
  console.log('\n🔄 API テスト中...');
  
  try {
    // cTrader Open API は WebSocket ベースなので、
    // REST API でのトークン検証は限定的
    // ここでは Token Introspection エンドポイントを試す
    
    const introspectUrl = 'https://connect.spotware.com/apps/token/introspect';
    
    const response = await fetch(introspectUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: TEST_ACCESS_TOKEN,
        client_id: config.ctrader.clientId,
        client_secret: config.ctrader.clientSecret,
      }).toString(),
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('\n✅ トークン検証成功!');
      console.log('  レスポンス:', JSON.stringify(data, null, 2));
    } else {
      const errorText = await response.text();
      console.log(`\n❌ トークン検証失敗: ${response.status}`);
      console.log('  エラー:', errorText);
      
      // 401/403 の場合はトークンが無効または期限切れ
      if (response.status === 401 || response.status === 403) {
        console.log('\n💡 ヒント: トークンが無効または期限切れの可能性があります');
        console.log('   リフレッシュトークンで更新を試みてください');
      }
    }
  } catch (error) {
    console.log('\n❌ API 接続エラー:', error);
  }
  
  // 4. リフレッシュトークンテスト
  if (TEST_REFRESH_TOKEN) {
    console.log('\n🔄 リフレッシュトークンテスト...');
    await testRefreshToken();
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('テスト完了');
  console.log('='.repeat(60));
}

/**
 * リフレッシュトークンでアクセストークンを更新
 */
async function testRefreshToken(): Promise<void> {
  try {
    const response = await fetch(config.ctrader.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: TEST_REFRESH_TOKEN,
        client_id: config.ctrader.clientId,
        client_secret: config.ctrader.clientSecret,
      }).toString(),
    });
    
    if (response.ok) {
      const data = await response.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };
      console.log('✅ トークン更新成功!');
      console.log('  新しい Access Token:', data.access_token ? maskToken(data.access_token) : '取得失敗');
      console.log('  新しい Refresh Token:', data.refresh_token ? maskToken(data.refresh_token) : '取得失敗');
      console.log('  有効期限:', data.expires_in ?? '不明', '秒');
      console.log('\n📝 新しいトークン（保存用）:');
      console.log(`  CTRADER_TEST_ACCESS_TOKEN=${data.access_token || ''}`);
      console.log(`  CTRADER_TEST_REFRESH_TOKEN=${data.refresh_token || ''}`);
    } else {
      const errorText = await response.text();
      console.log(`❌ トークン更新失敗: ${response.status}`);
      console.log('  エラー:', errorText);
    }
  } catch (error) {
    console.log('❌ リフレッシュエラー:', error);
  }
}

/**
 * トークンをマスク表示
 */
function maskToken(token: string): string {
  if (token.length <= 10) return '***';
  return `${token.substring(0, 5)}...${token.substring(token.length - 5)}`;
}

// 実行
testTokenValidity().catch(console.error);

