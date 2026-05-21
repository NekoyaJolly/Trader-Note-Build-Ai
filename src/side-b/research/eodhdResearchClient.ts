/**
 * EODHD Research API クライアント (Phase A A-2、2026-05-21)
 *
 * ResearchAgent (researchAIService) が必要とする外部要因データを取得する
 * 6 メソッドの薄いラッパー:
 *   1. News             - 銘柄関連のニュース記事
 *   2. Sentiments       - 銘柄関連のセンチメントスコア (日次)
 *   3. EconomicEvents   - 経済指標カレンダー
 *   4. MacroIndicator   - マクロ経済指標 (国別)
 *   5. CalendarEarnings - 決算カレンダー (主に株式系シンボル向け)
 *   6. Fundamentals     - ファンダメンタルズ (株式系シンボルのみ、API レベル制約)
 *
 * 設計方針:
 * - SDK 型をそのまま返却 (Zod でドメイン型に narrow するのは A-3 で別ファイル)
 * - エラー (rate limit / auth / network) は SDK が EODHD* エラークラスで投げる、
 *   呼び出し側 (aiOrchestrator) で graceful degradation する責務
 * - SDK インスタンスはモジュールスコープでキャッシュ (apiToken 変更は環境変数経由)
 *
 * 関連: docs/architecture/EODHD_PHASE_A_WBS.md PR #2 A-2
 */

import {
  EODHDClient,
  type NewsArticle,
  type NewsParams,
  type SentimentItem,
  type SentimentsParams,
  type EconomicEventsResponse,
  type EconomicEventsParams,
  type MacroIndicatorItem,
  type MacroIndicatorParams,
  type CalendarEarningsResponse,
  type CalendarEarningsParams,
  type FundamentalsData,
  type FundamentalsParams,
} from 'eodhd';
import { config } from '../../config';
import { isEodhdFundamentalsSupported } from '../../utils/symbolNormalization';

// ===========================================
// クライアント singleton
// ===========================================

let cachedClient: EODHDClient | null = null;

/**
 * 共有 EODHDClient インスタンスを返す
 *
 * apiToken は config (.env の EODHD_API_KEY) から取得。
 * apiToken 未設定 (空文字) でも instance は生成するが、API 呼び出し時に
 * SDK が EODHDAuthError を投げる。これは aiOrchestrator 側で吸収する設計。
 */
function getEodhdClient(): EODHDClient {
  if (!cachedClient) {
    cachedClient = new EODHDClient({
      apiToken: config.eodhd.apiToken,
      baseUrl: config.eodhd.baseUrl,
    });
  }
  return cachedClient;
}

/** テスト用に singleton をリセット (本番経路では使用しない) */
export function __resetEodhdClientForTesting(): void {
  cachedClient = null;
}

/**
 * テスト用にカスタム client を注入 (jest モック等で使用)
 * 本番経路では使用しない
 */
export function __setEodhdClientForTesting(client: EODHDClient | null): void {
  cachedClient = client;
}

// ===========================================
// 公開メソッド (6 種)
// ===========================================

export interface FetchNewsInput {
  /** EODHD 形式のシンボル (例: XAUUSD.FOREX、AAPL.US) */
  symbol: string;
  /** YYYY-MM-DD */
  from?: string;
  /** YYYY-MM-DD */
  to?: string;
  /** 取得件数上限 (default 10) */
  limit?: number;
}

/**
 * News API 呼び出し (5 calls / request)
 */
export async function fetchNews(input: FetchNewsInput): Promise<NewsArticle[]> {
  const params: NewsParams = {
    s: input.symbol,
    from: input.from,
    to: input.to,
    limit: input.limit ?? 10,
  };
  return getEodhdClient().news(params);
}

export interface FetchSentimentsInput {
  /** EODHD 形式のシンボル */
  symbol: string;
  from?: string;
  to?: string;
}

/**
 * Sentiments API 呼び出し (1 call / request)
 *
 * 戻り値は `Record<symbol, SentimentItem[]>` 形式 (SDK 仕様)。
 */
export async function fetchSentiments(
  input: FetchSentimentsInput,
): Promise<Record<string, SentimentItem[]>> {
  const params: SentimentsParams = {
    s: input.symbol,
    from: input.from,
    to: input.to,
  };
  return getEodhdClient().sentiments(params);
}

export interface FetchEconomicEventsInput {
  /** ISO 国コード (例: US, JP, EU) */
  country?: string;
  from?: string;
  to?: string;
  comparison?: 'mom' | 'qoq' | 'yoy';
  type?: string;
  limit?: number;
}

/**
 * EconomicEvents API 呼び出し (1 call / request)
 */
export async function fetchEconomicEvents(
  input: FetchEconomicEventsInput = {},
): Promise<EconomicEventsResponse> {
  const params: EconomicEventsParams = {
    country: input.country,
    from: input.from,
    to: input.to,
    comparison: input.comparison,
    type: input.type,
    limit: input.limit,
  };
  return getEodhdClient().economicEvents(params);
}

export interface FetchMacroIndicatorInput {
  /** ISO 国コード (例: US, JP, EU) */
  country: string;
  /** EODHD MacroIndicator コード (例: gdp_current_usd) */
  indicator?: string;
}

/**
 * MacroIndicator API 呼び出し (1 call / request)
 */
export async function fetchMacroIndicator(
  input: FetchMacroIndicatorInput,
): Promise<MacroIndicatorItem[]> {
  const params: MacroIndicatorParams = {
    indicator: input.indicator,
  };
  return getEodhdClient().macroIndicator(input.country, params);
}

export interface FetchCalendarEarningsInput {
  /** カンマ区切りの EODHD シンボル (例: "AAPL.US,MSFT.US") */
  symbols?: string;
  from?: string;
  to?: string;
}

/**
 * Calendar (earnings) API 呼び出し (1 call / request)
 *
 * 決算カレンダーは主に株式系シンボルで意味を持つ。
 */
export async function fetchCalendarEarnings(
  input: FetchCalendarEarningsInput = {},
): Promise<CalendarEarningsResponse> {
  const params: CalendarEarningsParams = {
    symbols: input.symbols,
    from: input.from,
    to: input.to,
  };
  return getEodhdClient().calendar.earnings(params);
}

export interface FetchFundamentalsInput {
  /** EODHD 形式のシンボル (US/ETF/INDX のみ対応) */
  symbol: string;
  /** 取得フィルタ (例: "General::Description") */
  filter?: string;
  /** 履歴フラグ (1=履歴含む、0=最新のみ) */
  historical?: 0 | 1;
}

/**
 * Fundamentals API 呼び出し (10 calls / request、最も高コスト)
 *
 * **シンボル制約**: FX / Crypto / Commodity は API 非対応のため、呼び出し前に
 * `isEodhdFundamentalsSupported()` で判定する。非対応シンボルが渡された場合は
 * `null` を返す (例外を投げない、aiOrchestrator 側の graceful degradation 用)。
 */
export async function fetchFundamentals(
  input: FetchFundamentalsInput,
): Promise<FundamentalsData | null> {
  if (!isEodhdFundamentalsSupported(input.symbol)) {
    return null;
  }
  const params: FundamentalsParams = {
    filter: input.filter,
    historical: input.historical,
  };
  return getEodhdClient().fundamentals(input.symbol, params);
}
