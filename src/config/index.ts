import dotenv from 'dotenv';

dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
  },
  ai: {
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
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
  },
  paths: {
    trades: './data/trades',
    notes: './data/notes',
  },
};
