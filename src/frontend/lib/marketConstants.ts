/**
 * 市場データ関連の共有定数。
 *
 * **なぜ集約するか (2026-06-06)**
 * 同じシンボル一覧 / TF オプション / 本数オプションが `RealtimeChart.tsx` と
 * `app/market-analysis/page.tsx` に別実装で重複していて、片方しか修正されない
 * バグが繰り返し発生した (例: `/api/market-analysis/EURUSD` 経路の生き残り、
 * 1分足デフォルトの不一致)。新しいコンポーネントは必ずこのファイルから import
 * する。リテラル直書きは ESLint で禁止する。
 *
 * **拡張する時のルール**
 * - シンボル追加: `SYMBOL_OPTIONS` に追加。表示順 = 配列順
 * - TF/本数の追加: 同様に対応する OPTIONS を更新。`secondsToApiTimeframe` も同期
 * - 将来的にユーザー設定で「表示する銘柄」「デフォルト本数」を切り替えたい場合は
 *   UserSettings から読む helper をこのファイル内に追加し、生の配列は維持しつつ
 *   `getEnabledSymbols(userSettings)` 等で抽象化する
 */

/** ユーザーが選択できるシンボル一覧 (表示順)。将来は cTrader getAvailableSymbols + ユーザー設定で動的化予定 */
export const SYMBOL_OPTIONS = [
  { value: 'XAUUSD', label: 'XAU/USD' },
  { value: 'EURUSD', label: 'EUR/USD' },
  { value: 'USDJPY', label: 'USD/JPY' },
  { value: 'GBPUSD', label: 'GBP/USD' },
] as const;

export type SymbolValue = (typeof SYMBOL_OPTIONS)[number]['value'];

/** デフォルト選択シンボル (新規セッションで何も選ばれてない時) */
export const DEFAULT_SYMBOL: SymbolValue = 'XAUUSD';

/** タイムフレーム選択肢 (秒単位の数値 = SSE 経路、文字列 = REST 経路で同じ TF を指す) */
export const TIMEFRAME_OPTIONS = [
  { value: 60, label: '1分', api: '1m' },
  { value: 300, label: '5分', api: '5m' },
  { value: 900, label: '15分', api: '15m' },
  { value: 1800, label: '30分', api: '30m' },
  { value: 3600, label: '1時間', api: '1h' },
  { value: 14400, label: '4時間', api: '4h' },
] as const;

export type TimeframeSeconds = (typeof TIMEFRAME_OPTIONS)[number]['value'];
export type TimeframeApi = (typeof TIMEFRAME_OPTIONS)[number]['api'];

/** デフォルト TF (秒) */
export const DEFAULT_TIMEFRAME_SECONDS: TimeframeSeconds = 60;
/** デフォルト TF (API 文字列) */
export const DEFAULT_TIMEFRAME_API: TimeframeApi = '1m';

/** 秒 → API 文字列 (REST `/api/chart/candles?timeframe=` 用) */
export const secondsToApiTimeframe = (seconds: number): TimeframeApi | undefined =>
  TIMEFRAME_OPTIONS.find((tf) => tf.value === seconds)?.api;

/** API 文字列 → 秒 */
export const apiTimeframeToSeconds = (api: string): TimeframeSeconds | undefined =>
  TIMEFRAME_OPTIONS.find((tf) => tf.api === api)?.value;

/** 取得本数 (ローソク足) 選択肢 */
export const DATA_COUNT_OPTIONS = [
  { value: 500, label: '500本' },
  { value: 1000, label: '1000本' },
  { value: 2000, label: '2000本' },
  { value: 5000, label: '5000本' },
] as const;

export type DataCount = (typeof DATA_COUNT_OPTIONS)[number]['value'];

/** デフォルト取得本数 */
export const DEFAULT_DATA_COUNT: DataCount = 1000;

/** ローソク足フォールバック (静的取得) のリフレッシュ間隔 ms */
export const FALLBACK_REFRESH_INTERVAL_MS = 30_000;

/** ブローカー (cTrader) bid/ask quote のポーリング間隔 ms */
export const BROKER_QUOTE_REFRESH_INTERVAL_MS = 30_000;
