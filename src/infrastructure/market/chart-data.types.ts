/**
 * チャート / ブローカー overlay 共通型定義
 *
 * 設計方針 (チャート基盤 EODHD 主体化, 2026-06):
 * - チャートのローソク足 (OHLCV) は EODHD / ローカルキャッシュを主データソースとする。
 *   cTrader 接続が落ちてもローソク足は表示できることを型レベルで保証する。
 * - cTrader は「チャートの土台」ではなく「チャート上に重ねる broker overlay」として扱う。
 *   bid/ask・スプレッド・発注・ポジションは broker レイヤーに閉じる。
 * - データソースと価格基準が異なりうるため、API レスポンスに source / priceBasis /
 *   isRealtime / delayMs / provider のメタ情報を必ず持たせ、UI でズレを把握できるようにする。
 *
 * 本ファイルは「API レスポンス用ドメイン型」を定義する。lightweight-charts 等の
 * UI 描画用型 (timestamp が ms 等) とは混ぜない。
 */

import type { Timeframe } from './IMarketDataProvider';

/**
 * ローソク足のデータソース種別
 * - EODHD: EODHD REST (intraday / eod)
 * - cTrader: ブローカー由来 (将来 broker 形成足用に予約)
 * - local: LocalCandleStore (OHLCVCandle テーブル) 由来のキャッシュ
 */
export type CandleSource = 'EODHD' | 'cTrader' | 'local';

/**
 * ローソク足の価格基準
 * - mid: 仲値
 * - bid / ask: 売り / 買い
 * - unknown: 不明 (EODHD の OHLCV は基準が公開されないため通常 unknown)
 */
export type PriceBasis = 'mid' | 'bid' | 'ask' | 'unknown';

/**
 * チャート 1 本のローソク足
 * time は lightweight-charts と整合する Unix 秒 (UTC)。
 */
export interface ChartCandle {
  /** Unix 秒 (UTC) */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** EODHD eod 等で信用できない場合は null を許容する */
  volume?: number | null;
}

/**
 * チャートデータのメタ情報。
 * ローソク足の出所・遅延・リアルタイム性を UI / API 消費側へ明示する。
 */
export interface ChartDataMeta {
  source: CandleSource;
  provider: string;
  priceBasis: PriceBasis;
  symbol: string;
  /** 未対応の時間足を型レベルで弾くため Timeframe に固定 */
  timeframe: Timeframe;
  isRealtime: boolean;
  /** 想定遅延 (ミリ秒)。不明な場合は null */
  delayMs: number | null;
  /** レスポンス生成時刻 (ISO 8601) */
  generatedAt: string;
}

/**
 * GET /api/chart/candles のレスポンス本体。
 */
export interface ChartCandlesResponse {
  candles: ChartCandle[];
  meta: ChartDataMeta;
  /** データ遅延・フォールバック等の注意を日本語で表現する任意フィールド */
  warning?: string;
}

/**
 * チャート用 OHLCV 取得プロバイダーの抽象。
 * cTrader 依存を排し、EODHD やローカルキャッシュを差し替え可能にする。
 */
export interface ChartDataProvider {
  /** プロバイダー識別名 (ログ・meta.provider 用) */
  readonly name: string;

  getCandles(params: GetCandlesParams): Promise<ChartCandlesResponse>;
}

/**
 * チャート用 OHLCV 取得パラメータ。
 */
export interface GetCandlesParams {
  /** 内部シンボル (例 'XAUUSD' / 'XAU/USD' どちらも許容、Provider 側で正規化) */
  symbol: string;
  timeframe: Timeframe;
  from?: Date;
  to?: Date;
  /** 取得本数の上限 (省略時は Provider のデフォルト) */
  limit?: number;
}

/**
 * ブローカー (cTrader) の現在 quote。
 * ローソク足とは別レイヤーの overlay として扱う。
 */
export interface BrokerQuote {
  symbol: string;
  broker: 'cTrader';
  bid: number;
  ask: number;
  /** ask - bid */
  spread: number;
  /** quote のタイムスタンプ (ISO 8601) */
  timestamp: string;
  isRealtime: boolean;
}

/**
 * GET /api/broker/quote のレスポンス本体。
 * - connected: 最新 quote を取得できた
 * - degraded: ブローカー設定済みだが quote を取得できなかった (一時障害)
 * - disconnected: ブローカー未接続 (OAuth 未設定等)
 */
export interface BrokerQuoteResponse {
  quote: BrokerQuote | null;
  status: 'connected' | 'degraded' | 'disconnected';
  warning?: string;
}

/**
 * チャートデータ取得時のエラー種別。
 * HTTP ステータスへのマッピングは route 層が行う (404 乱用を避けるため種別を明示する)。
 * - invalid_symbol: シンボル形式が不正 / 未対応 → 404
 * - invalid_timeframe: 時間足が未対応 → 400
 * - upstream_unavailable: 外部プロバイダー障害かつキャッシュ無し → 503
 *
 * 「symbol は有効だがデータが無い」は **エラーではなく** 200 + 空 candles + warning で返すため
 * 本 enum には含めない。
 */
export type ChartDataErrorKind =
  | 'invalid_symbol'
  | 'invalid_timeframe'
  | 'upstream_unavailable';

/**
 * チャートデータ取得エラー。
 * route 層で `kind` を見て HTTP ステータスを決定する。
 */
export class ChartDataError extends Error {
  readonly kind: ChartDataErrorKind;
  /** 原因の補足 (上流エラーメッセージ等)。ログ用 */
  readonly detail?: string;

  constructor(kind: ChartDataErrorKind, message: string, detail?: string) {
    super(message);
    this.name = 'ChartDataError';
    this.kind = kind;
    this.detail = detail;
  }
}
