import dotenv from 'dotenv';

dotenv.config();

/**
 * アプリケーション設定
 * 環境変数から設定値を取得し、型安全に提供する
 * 注意: DATABASE_URL は Prisma が直接参照するため、ここでの定義は参考用
 */

console.log('[Config] 環境変数をロード中...');
console.log('[Config] NODE_ENV:', process.env.NODE_ENV);
console.log('[Config] PORT:', process.env.PORT);
console.log('[Config] BACKEND_PORT:', process.env.BACKEND_PORT);
console.log('[Config] DATABASE_URL 存在:', !!process.env.DATABASE_URL);
console.log('[Config] process.env のキー数:', Object.keys(process.env).length);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('═══════════════════════════════════════');
  console.error('  ⚠️ DATABASE_URL が見つかりません');
  console.error('═══════════════════════════════════════');
  console.error('');
  console.error('設定されている環境変数:');
  const envKeys = Object.keys(process.env)
    .filter(key => !key.includes('npm_') && !key.includes('TERM') && !key.includes('PATH'))
    .sort();
  
  if (envKeys.length === 0) {
    console.error('  ❌ 環境変数が全く設定されていません（.env ファイル読み込み失敗？）');
  } else {
    envKeys.forEach(key => {
      const value = process.env[key] || '';
      const displayValue = value.length > 60 ? value.substring(0, 60) + '...' : value;
      console.error(`  ${key}=${displayValue}`);
    });
  }
  console.error('');
  console.error('必須環境変数チェックリスト:');
  const requiredVars = [
    'DATABASE_URL',
    'NODE_ENV',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'AI_API_KEY',
    'MARKET_API_KEY',
  ];
  requiredVars.forEach(varName => {
    const isSet = !!process.env[varName];
    console.error(`  ${isSet ? '✅' : '❌'} ${varName}`);
  });
  console.error('═══════════════════════════════════════');
  throw new Error('DATABASE_URL is required but not found in environment variables');
}

// DATABASE_URL が参照変数のままになっていないかチェック
if (databaseUrl.includes('${{')) {
  console.error('═══════════════════════════════════════');
  console.error('  ⚠️ DATABASE_URL が参照変数形式のまま');
  console.error('═══════════════════════════════════════');
  console.error('DATABASE_URL が Railway の参照変数形式です:');
  console.error(`  ${databaseUrl}`);
  console.error('');
  console.error('修正方法:');
  console.error('1. Railway ダッシュボードを開く');
  console.error('2. PostgreSQL サービスの Variables タブで DATABASE_URL をコピー');
  console.error('3. Node.js サービスの Variables で DATABASE_URL を直接設定（参照ではなく実値）');
  console.error('═══════════════════════════════════════');
  throw new Error('DATABASE_URL contains unexpanded Railway variable reference');
}

console.log('[Config] DATABASE_URL（プロトコル）:', databaseUrl.split('://')[0]);
console.log('[Config] DATABASE_URL（ホスト）:', databaseUrl.split('@')[1]?.split('/')[0] || 'unknown');
console.log('[Config] ✅ 設定ロード成功');
console.log('[Config] NODE_ENV:', process.env.NODE_ENV === 'production' ? '本番' : '開発');
console.log('[Config] サーバーポート:', process.env.BACKEND_PORT || process.env.PORT || '3100');

export const config = {
  server: {
    // 優先度: BACKEND_PORT > PORT > 3100（env設定がある場合はそちらを優先）
    port: parseInt(process.env.BACKEND_PORT || process.env.PORT || '3100', 10),
    env: process.env.NODE_ENV || 'development',
    // 本番環境かどうかを判定するヘルパー
    isProduction: process.env.NODE_ENV === 'production',
  },
  database: {
    // Prisma が DATABASE_URL を直接参照するため、ここでは参照用として保持
    url: databaseUrl,
  },
  ai: {
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-5-mini',
    baseURL: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  },
  market: {
    // Twelve Data API のデフォルトURL を設定
    apiUrl: process.env.MARKET_API_URL || process.env.TWELVE_DATA_API_URL || 'https://api.twelvedata.com',
    // TWELVE_DATA_API_KEY も MARKET_API_KEY のエイリアスとして使用可能
    apiKey: process.env.MARKET_API_KEY || process.env.TWELVE_DATA_API_KEY || '',
  },
  matching: {
    threshold: parseFloat(process.env.MATCH_THRESHOLD || '0.75'),
    checkIntervalMinutes: parseInt(process.env.CHECK_INTERVAL_MINUTES || '15', 10),
  },
  notification: {
    pushKey: process.env.PUSH_NOTIFICATION_KEY || '',
    // 本番環境ではDBモード、開発環境ではFSモード（環境変数で上書き可能）
    storageMode: (process.env.NOTIFICATION_STORAGE_MODE || 
      (process.env.NODE_ENV === 'production' ? 'db' : 'fs')) as 'db' | 'fs',
  },
  ctrader: {
    clientId: process.env.CTRADER_CLIENT_ID || '',
    clientSecret: process.env.CTRADER_CLIENT_SECRET || '',
    // OAuth エンドポイント（connect.spotware.com を使用）
    authUrl: 'https://connect.spotware.com/apps/auth',
    tokenUrl: 'https://connect.spotware.com/apps/token',
    // WebSocket エンドポイント
    wsUrl: 'wss://live.ctraderapi.com',
    wsDemoUrl: 'wss://demo.ctraderapi.com',
    // WebSocket接続設定（ホストとポート）
    wsLiveHost: process.env.CTRADER_WS_LIVE_HOST || 'live.ctraderapi.com',
    wsDemoHost: process.env.CTRADER_WS_DEMO_HOST || 'demo.ctraderapi.com',
    wsPort: parseInt(process.env.CTRADER_WS_PORT || '5035', 10),
    // Redirect URI（Vercel）
    redirectUri: process.env.CTRADER_REDIRECT_URI || 'https://trader-note-build-ai.vercel.app/auth/ctrader/callback',
  },
  paths: {
    trades: './data/trades',
    notes: './data/notes',
  },
};
