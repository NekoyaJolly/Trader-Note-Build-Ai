import dotenv from 'dotenv';

dotenv.config();

/**
 * アプリケーション設定
 * 環境変数から設定値を取得し、型安全に提供する
 * 注意: DATABASE_URL は Prisma が直接参照するため、ここでの定義は参考用
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

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
    apiUrl: process.env.MARKET_API_URL || '',
    apiKey: process.env.MARKET_API_KEY || '',
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
  paths: {
    trades: './data/trades',
    notes: './data/notes',
  },
};
