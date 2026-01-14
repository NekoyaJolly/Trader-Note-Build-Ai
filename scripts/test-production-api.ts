/**
 * 本番 API 疎通確認スクリプト
 * 
 * 目的: Vercel → Railway の API 呼び出しが正常に動作するか確認
 */

const RAILWAY_API_BASE_URL = 'https://trader-note-build-ai-production.up.railway.app';

async function testHealthCheck(): Promise<void> {
  console.log('='.repeat(60));
  console.log('1. Health Check');
  console.log('='.repeat(60));
  
  try {
    const response = await fetch(`${RAILWAY_API_BASE_URL}/health`);
    const data = await response.json();
    
    console.log(`✅ Status: ${response.status}`);
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

async function testAuthUrl(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('2. cTrader 認証 URL 取得');
  console.log('='.repeat(60));
  
  try {
    const response = await fetch(`${RAILWAY_API_BASE_URL}/api/auth/ctrader/url`);
    const data = await response.json() as { authUrl?: string; error?: string };
    
    console.log(`✅ Status: ${response.status}`);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    if (data.authUrl) {
      console.log('\n📝 認証URL:');
      console.log(data.authUrl);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

async function main(): Promise<void> {
  console.log('🔍 本番 API 疎通確認');
  console.log(`API Base URL: ${RAILWAY_API_BASE_URL}\n`);
  
  await testHealthCheck();
  await testAuthUrl();
}

main().catch(console.error);
