/**
 * EODHD 外部要因 context 取得 orchestration (Phase A A-6 / A-9、2026-05-21)
 *
 * aiOrchestrator から呼ばれ、ResearchAIInput に渡す 5 種の context を並列取得。
 *
 * 設計方針:
 * - 各 fetch は個別 try-catch で graceful degradation (失敗 = undefined)
 * - EODHD APIキー未設定なら全てスキップ (1 API call も発生させない)
 * - Fundamentals は対応シンボル判定で内部スキップ
 * - 観測性: API call cost は本ファイル末尾で集計してログ出力 (= A-9 の call cost 部分)。
 *   cache hit rate は Phase E (運用フェーズ) で Redis 層を入れた後に追加予定。
 *
 * 関連: docs/architecture/EODHD_PHASE_A_WBS.md PR #2 A-6 / A-9
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

  // A-9 観測性: 試行ベースで API call cost を集計 (成功/失敗ともに実 call が発生したぶんを加算)。
  // 「未実行」(country 未推定 / Fundamentals 非対応) のみ 0 とする。
  // Copilot review (PR #234) 指摘 1 対応。
  const fundamentalsAttempted = isEodhdFundamentalsSupported(eodhdSymbol);
  const costEstimate = {
    news: 5,
    sentiment: 1,
    economicEvents: 1,
    macro: country ? 1 : 0,
    fundamentals: fundamentalsAttempted ? 10 : 0,
  };
  const totalCost = Object.values(costEstimate).reduce((a, b) => a + b, 0);
  console.log(
    `[EODHD] Research context 試行: total=${totalCost} calls ` +
      `(news=${costEstimate.news}, sentiment=${costEstimate.sentiment}, ` +
      `events=${costEstimate.economicEvents}, macro=${costEstimate.macro}, ` +
      `fundamentals=${costEstimate.fundamentals})`,
  );

  if (newsResult.status === 'fulfilled' && newsResult.value) {
    result.newsContext = newsResult.value;
  } else if (newsResult.status === 'rejected') {
    console.warn('[EODHD] News 取得失敗 (graceful):', formatRejectionReason(newsResult.reason));
  }

  if (sentimentResult.status === 'fulfilled' && sentimentResult.value) {
    result.sentimentContext = sentimentResult.value;
  } else if (sentimentResult.status === 'rejected') {
    console.warn(
      '[EODHD] Sentiment 取得失敗 (graceful):',
      formatRejectionReason(sentimentResult.reason),
    );
  }

  if (eventsResult.status === 'fulfilled' && eventsResult.value) {
    result.economicEvents = eventsResult.value;
  } else if (eventsResult.status === 'rejected') {
    console.warn(
      '[EODHD] EconomicEvents 取得失敗 (graceful):',
      formatRejectionReason(eventsResult.reason),
    );
  }

  if (macroResult.status === 'fulfilled' && macroResult.value) {
    result.macroContext = macroResult.value;
  } else if (macroResult.status === 'rejected') {
    console.warn(
      '[EODHD] MacroIndicator 取得失敗 (graceful):',
      formatRejectionReason(macroResult.reason),
    );
  }

  if (fundResult.status === 'fulfilled' && fundResult.value) {
    result.fundamentalsContext = fundResult.value;
  } else if (fundResult.status === 'rejected') {
    console.warn(
      '[EODHD] Fundamentals 取得失敗 (graceful):',
      formatRejectionReason(fundResult.reason),
    );
  }

  return result;
}

/**
 * `Promise.allSettled` の rejection.reason をログ用文字列に整形する。
 *
 * Copilot review (PR #234) 指摘 2 対応: 生の例外オブジェクトを直接ログ出力すると、
 * SDK エラー次第ではリクエスト URL / トークン等の機微情報が混入し得るため、
 * `Error` 系は `name: message` のみに redaction し、それ以外は短い既定文字列で返す。
 *
 * `Promise.allSettled` の reason は仕様上 `unknown` 型のため、本関数 1 箇所で narrow を集約する。
 */
// eslint-disable-next-line no-restricted-syntax -- Promise.allSettled の rejection reason は ES 仕様で unknown、本関数で narrow して集約
function formatRejectionReason(reason: unknown): string {
  if (reason instanceof Error) {
    return `${reason.name}: ${reason.message}`;
  }
  if (typeof reason === 'string') {
    return reason;
  }
  return 'unknown error';
}
