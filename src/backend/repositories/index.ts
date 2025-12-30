/**
 * リポジトリモジュールエクスポート
 * 
 * 全ての DB アクセスはこれらのリポジトリを経由する
 */

// === OHLCV ===
export { OHLCVRepository, ohlcvRepository } from './ohlcvRepository';
export type { OHLCVInsertData, OHLCVQueryFilter } from './ohlcvRepository';

// === TradeNote ===
export { TradeNoteRepository } from './tradeNoteRepository';
export type { 
  CreateTradeNoteInput, 
  CreateAISummaryInput, 
  UpdateTradeNoteInput,
  TradeNoteWithSummary,
  FindNotesOptions,
} from './tradeNoteRepository';

// === Trade ===
export { TradeRepository } from './tradeRepository';

// === MatchResult ===
export { MatchResultRepository } from './matchResultRepository';

// === MarketSnapshot ===
export { MarketSnapshotRepository } from './marketSnapshotRepository';

// === NotificationLog ===
export { NotificationLogRepository } from './notificationLogRepository';

// === Notification (DB版) ===
export { DbNotificationRepository, dbNotificationRepository } from './notificationRepository';
export type { 
  CreateNotificationInput, 
  NotificationWithMatch,
  FindNotificationsOptions,
} from './notificationRepository';

// === Backtest ===
export { BacktestRepository, backtestRepository } from './backtestRepository';
export type { 
  CreateBacktestRunInput, 
  CreateBacktestResultInput,
  CreateBacktestEventInput,
  BacktestRunWithDetails,
} from './backtestRepository';

// === Push通知 ===
export { PushSubscriptionRepository, pushSubscriptionRepository } from './pushSubscriptionRepository';
export type { 
  CreatePushSubscriptionInput, 
  CreatePushLogInput,
} from './pushSubscriptionRepository';
