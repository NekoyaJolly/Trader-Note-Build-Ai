/**
 * EODHD 外部要因 context 取得 orchestration (Phase A A-6、2026-05-21)
 *
 * aiOrchestrator から呼ばれ、ResearchAIInput に渡す 5 種の context を並列取得。
 *
 * 設計方針:
 * - 各 fetch は個別 try-catch で graceful degradation (失敗 = undefined)
 * - EODHD APIキー未設定なら全てスキップ (1 API call も発生させない)
 * - Fundamentals は対応シンボル判定で内部スキップ
 * - 観測性 (call cost / cache hit rate) は A-9 で別途追加予定
 *
 * 関連: docs/architecture/EODHD_PHASE_A_WBS.md PR #2 A-6
 */

import { config } from '../../config';
import {
  toEodhdSymbol,
  isEodhdFundamentalsSupported,
} from '../../utils/symbolNormalization';
import {
  fetchNews,
  fetchSentiments,
  fetchEconomicEvents,
  fetchMacroIndicator,
  fetchFundamentals,
} from './eodhdResearchClient';
import {
  toNewsContext,
  toSentimentContext,
  toEconomicEventsContext,
  toMacroContext,
  toFundamentalsContext,
  type NewsContext,
  type SentimentContext,
  type EconomicEventsContext,
  type MacroContext,
  type FundamentalsContext,
} from '../../schemas/external/eodhd';

/**
 * 5 種の context を ResearchAIInput に partial 追加する形で返す。
 * すべて optional なので、取得失敗 / API キー未設定でも undefined にして欠落許容。
 */
export interface EodhdResearchContexts {
  newsContext?: NewsContext;
  sentimentContext?: SentimentContext;
  economicEvents?: EconomicEventsContext;
  macroContext?: MacroContext;
  fundamentalsContext?: FundamentalsContext;
}

/**
 * 対象シンボルから主要国の ISO コードを推定する (Macro Indicator 用)
 *
 * Phase A は FX 中心: 通貨ペアの quote currency を国コードにマップ。
 * 例: XAUUSD → US、EURJPY → JP、GBPUSD → US。
 * マッチしない場合は undefined (Macro 取得をスキップ)。
 */
function inferCountryFromSymbol(symbol: string): string | undefined {
  const normalized = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const quoteToCountry: Record<string, string> = {
    USD: 'US',
    JPY: 'JP',
    EUR: 'DE',
    GBP: 'GB',
    AUD: 'AU',
    CAD: 'CA',
    CHF: 'CH',
    NZD: 'NZ',
  };
  for (const quote of Object.keys(quoteToCountry)) {
    if (normalized.endsWith(quote)) {
      return quoteToCountry[quote];
    }
  }
  return undefined;
}

/**
 * 5 種の context を並列取得 (各失敗は graceful)
 *
 * @param symbol 内部正規化形式 (例: XAUUSD) — 必要に応じて EODHD 形式に変換
 */
export async function fetchEodhdContextsForResearch(
  symbol: string,
): Promise<EodhdResearchContexts> {
  if (!config.eodhd.apiToken) {
    // API キー未設定: 全コンテキストを undefined (= EODHD 配線前の動作と同等)
    return {};
  }

  const eodhdSymbol = toEodhdSymbol(symbol);
  const country = inferCountryFromSymbol(symbol);

  // 各 fetch を Promise.allSettled で並列実行、失敗時は undefined にする
  const [newsResult, sentimentResult, eventsResult, macroResult, fundResult] =
    await Promise.allSettled([
      fetchNews({ symbol: eodhdSymbol, limit: 10 }).then((articles) =>
        toNewsContext(eodhdSymbol, articles),
      ),
      fetchSentiments({ symbol: eodhdSymbol }).then((raw) =>
        toSentimentContext(eodhdSymbol, raw),
      ),
      fetchEconomicEvents({ country, limit: 20 }).then((raw) =>
        toEconomicEventsContext(raw, 20, country),
      ),
      country
        ? fetchMacroIndicator({ country }).then((items) =>
            toMacroContext(country, items),
          )
        : Promise.resolve(undefined),
      isEodhdFundamentalsSupported(eodhdSymbol)
        ? fetchFundamentals({ symbol: eodhdSymbol }).then((raw) =>
            toFundamentalsContext(eodhdSymbol, raw),
          )
        : Promise.resolve(undefined),
    ]);

  const result: EodhdResearchContexts = {};

  // A-9 観測性: API call cost を集計してログ (5 + 1 + 1 + 1 + 10 = max 18 calls/research)
  const costEstimate = {
    news: newsResult.status === 'fulfilled' ? 5 : 0,
    sentiment: sentimentResult.status === 'fulfilled' ? 1 : 0,
    economicEvents: eventsResult.status === 'fulfilled' ? 1 : 0,
    macro: macroResult.status === 'fulfilled' && macroResult.value ? 1 : 0,
    fundamentals: fundResult.status === 'fulfilled' && fundResult.value ? 10 : 0,
  };
  const totalCost = Object.values(costEstimate).reduce((a, b) => a + b, 0);
  console.log(
    `[EODHD] Research context 取得: total=${totalCost} calls ` +
      `(news=${costEstimate.news}, sentiment=${costEstimate.sentiment}, ` +
      `events=${costEstimate.economicEvents}, macro=${costEstimate.macro}, ` +
      `fundamentals=${costEstimate.fundamentals})`,
  );

  if (newsResult.status === 'fulfilled' && newsResult.value) {
    result.newsContext = newsResult.value;
  } else if (newsResult.status === 'rejected') {
    console.warn('[EODHD] News 取得失敗 (graceful):', newsResult.reason);
  }

  if (sentimentResult.status === 'fulfilled' && sentimentResult.value) {
    result.sentimentContext = sentimentResult.value;
  } else if (sentimentResult.status === 'rejected') {
    console.warn('[EODHD] Sentiment 取得失敗 (graceful):', sentimentResult.reason);
  }

  if (eventsResult.status === 'fulfilled' && eventsResult.value) {
    result.economicEvents = eventsResult.value;
  } else if (eventsResult.status === 'rejected') {
    console.warn('[EODHD] EconomicEvents 取得失敗 (graceful):', eventsResult.reason);
  }

  if (macroResult.status === 'fulfilled' && macroResult.value) {
    result.macroContext = macroResult.value;
  } else if (macroResult.status === 'rejected') {
    console.warn('[EODHD] MacroIndicator 取得失敗 (graceful):', macroResult.reason);
  }

  if (fundResult.status === 'fulfilled' && fundResult.value) {
    result.fundamentalsContext = fundResult.value;
  } else if (fundResult.status === 'rejected') {
    console.warn('[EODHD] Fundamentals 取得失敗 (graceful):', fundResult.reason);
  }

  return result;
}
