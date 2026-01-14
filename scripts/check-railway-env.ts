/**
 * Railway 環境変数チェッカー
 * 
 * 実行方法:
 * npx tsx scripts/check-railway-env.ts
 * 
 * Railway で環境変数が不足していないか確認します
 */

import { config as dotenvConfig } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Railway 環境変数チェッカー');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

// .env ファイルを読み込み
const envPath = path.join(process.cwd(), '.env');
const envLocalPath = path.join(process.cwd(), '.env.local');
const envProdPath = path.join(process.cwd(), '.env.production');

console.log('[1/3] .env ファイル確認');
console.log('');

let loadedEnv: { [key: string]: string } = {};

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const envLines = envContent.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  loadedEnv = {};
  
  envLines.forEach(line => {
    const [key, ...valueParts] = line.split('=');
    const cleanKey = key.trim();
    const cleanValue = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
    loadedEnv[cleanKey] = cleanValue;
  });
  
  console.log(`✅ .env ファイルが見つかりました`);
  console.log(`   設定済みの環境変数: ${Object.keys(loadedEnv).length} 個`);
  console.log('');
} else {
  console.log('❌ .env ファイルが見つかりません');
  console.log('');
}

console.log('[2/3] 必須環境変数チェック');
console.log('');

const requiredVars = [
  { key: 'DATABASE_URL', description: 'PostgreSQL 接続文字列' },
  { key: 'NODE_ENV', description: 'Node.js 環境（production）' },
  { key: 'JWT_SECRET', description: 'JWT 署名鍵' },
  { key: 'JWT_REFRESH_SECRET', description: 'JWT リフレッシュ鍵' },
  { key: 'AI_API_KEY', description: 'OpenAI API キー' },
  { key: 'AI_MODEL', description: 'AI モデル名' },
  { key: 'MARKET_API_URL', description: '市場データ API URL' },
  { key: 'MARKET_API_KEY', description: '市場データ API キー' },
  { key: 'VAPID_PUBLIC_KEY', description: 'Web Push 公開鍵' },
  { key: 'VAPID_PRIVATE_KEY', description: 'Web Push 秘密鍵' },
  { key: 'VAPID_SUBJECT', description: 'Web Push subject' },
  { key: 'CTRADER_CLIENT_ID', description: 'cTrader クライアント ID' },
  { key: 'CTRADER_CLIENT_SECRET', description: 'cTrader クライアント秘密鍵' },
];

let missingCount = 0;
let setCount = 0;

requiredVars.forEach(({ key, description }) => {
  const isSet = !!loadedEnv[key];
  const status = isSet ? '✅' : '❌';
  
  if (isSet) {
    const value = loadedEnv[key];
    // シークレット値は隠す
    const isSensitive = ['SECRET', 'KEY', 'URL', 'PASSWORD'].some(sensitive => key.toUpperCase().includes(sensitive));
    const displayValue = isSensitive 
      ? value.substring(0, 8) + '****' + value.substring(value.length - 4)
      : value.length > 40 ? value.substring(0, 40) + '...' : value;
    console.log(`${status} ${key.padEnd(25)} = ${displayValue}`);
    setCount++;
  } else {
    console.log(`${status} ${key.padEnd(25)} 未設定`);
    missingCount++;
  }
});

console.log('');
console.log(`結果: ${setCount}/${requiredVars.length} 設定済み`);
console.log('');

if (missingCount > 0) {
  console.log(`⚠️  ${missingCount} 個の必須環境変数が未設定です`);
  console.log('');
  console.log('修正方法:');
  console.log('1. ローカルで .env を編集');
  console.log('2. Railway ダッシュボード → Settings → Variables で追加');
  console.log('3. 全ての必須変数を設定してから再デプロイ');
  console.log('');
} else {
  console.log('✅ 全ての必須環境変数が設定されています');
  console.log('');
}

console.log('[3/3] Railway デプロイ手順');
console.log('');
console.log('1. Railway ダッシュボールを開く');
console.log('   https://railway.app');
console.log('');
console.log('2. プロジェクト → Node.js サービス → Settings');
console.log('');
console.log('3. Variables タブで以下を確認:');
console.log('   - DATABASE_URL: Railway PostgreSQL から直接コピー（参照ではなく実値）');
console.log('   - NODE_ENV: production');
console.log('   - その他の必須変数: .env から転記');
console.log('');
console.log('4. 全て設定後、Redeploy ボタンをクリック');
console.log('');
console.log('═══════════════════════════════════════════════════════════════');
