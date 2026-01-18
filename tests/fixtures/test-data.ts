/**
 * テストデータフィクスチャ
 * 目的: E2Eテストで使用する一貫したテストデータを提供
 */

export const testUsers = {
  validUser: {
    email: 'test@example.com',
    password: 'password123',
    cTraderId: '12345678',
  },
  adminUser: {
    email: 'admin@example.com',
    password: 'admin123',
    cTraderId: '87654321',
  },
};

export const testTradeNotes = {
  buyNote: {
    symbol: 'USDJPY',
    direction: 'BUY',
    entryPrice: 150.50,
    quantity: 10000,
    strategy: 'RSIが30を下回ったため買いエントリー',
    timestamp: new Date('2024-01-15T09:30:00Z'),
  },
  sellNote: {
    symbol: 'EURUSD',
    direction: 'SELL',
    entryPrice: 1.0850,
    quantity: 5000,
    strategy: 'レジスタンスラインでの反発を狙った売りエントリー',
    timestamp: new Date('2024-01-15T14:45:00Z'),
  },
};

export const testMarketData = {
  usdjpy: {
    symbol: 'USDJPY',
    price: 150.45,
    timestamp: new Date('2024-01-15T10:00:00Z'),
    open: 150.30,
    high: 150.60,
    low: 150.20,
    close: 150.45,
    volume: 1000000,
  },
  eurusd: {
    symbol: 'EURUSD',
    price: 1.0845,
    timestamp: new Date('2024-01-15T15:00:00Z'),
    open: 1.0840,
    high: 1.0855,
    low: 1.0835,
    close: 1.0845,
    volume: 500000,
  },
};

export const testNotifications = {
  matchNotification: {
    type: 'MATCH_FOUND',
    title: '一致判定: USDJPY',
    message: 'トレードノートとの類似度: 85%',
    timestamp: new Date('2024-01-15T10:05:00Z'),
    read: false,
  },
  orderNotification: {
    type: 'ORDER_SUGGESTION',
    title: '発注支援: EURUSD',
    message: 'エントリーポイント到達',
    timestamp: new Date('2024-01-15T15:10:00Z'),
    read: false,
  },
};

export const testProfiles = {
  defaultProfile: {
    name: 'デフォルトプロファイル',
    description: 'RSI + SMA戦略',
    indicators: [
      {
        configId: 'rsi-1',
        indicatorId: 'rsi',
        label: 'RSI (14)',
        params: { period: 14 },
        enabled: true,
      },
      {
        configId: 'sma-1',
        indicatorId: 'sma',
        label: 'SMA (20)',
        params: { period: 20 },
        enabled: true,
      },
    ],
    isDefault: true,
  },
};
