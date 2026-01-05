/**
 * 市場データプロバイダー - インデックス
 * 
 * Side-A/B 共通のデータソース抽象化レイヤー
 */

// 抽象インターフェース・型定義
export {
  // 型定義
  OHLCVBarSchema,
  OHLCVBar,
  TickDataSchema,
  TickData,
  MarketDataResultSchema,
  MarketDataResult,
  TimeframeSchema,
  Timeframe,
  ProviderTypeSchema,
  ProviderType,
  ConnectionStateSchema,
  ConnectionState,
  TickCallback,
  ConnectionStateCallback,
  // インターフェース
  IMarketDataProvider,
  BaseMarketDataProvider,
  ProviderFactoryConfig,
} from './IMarketDataProvider';

// Twelve Data プロバイダー（Side-B 用）
export {
  TwelveDataProvider,
  TwelveDataConfigSchema,
  TwelveDataConfig,
} from './TwelveDataProvider';

// CTrader プロバイダー（Side-A 用）
export {
  CTraderProvider,
  CTraderMessageType,
  CTraderSpotEventSchema,
  CTraderSpotEvent,
} from './CTraderProvider';
