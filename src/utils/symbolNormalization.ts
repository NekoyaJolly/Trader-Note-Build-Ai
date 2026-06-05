/**
 * 市場データ用シンボル正規化ユーティリティ。
 *
 * cTrader / DB 保存ではスラッシュなし大文字（例: XAUUSD）を正とする。
 * 各用途向けに以下のフォーマット変換を提供する:
 * - スラッシュ区切り (XAU/USD): ローカルキャンドルストアのキー等
 * - EODHD: 市場タイプサフィックス (XAUUSD.FOREX / AAPL.US 等)
 */

const KNOWN_QUOTES = ['USDT', 'USD', 'JPY', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'NZD'] as const;

/** EODHD がサポートする市場タイプ (Phase A は FOREX 中心、Phase C で他系統を拡張予定) */
export const EODHD_MARKET_TYPES = ['FOREX', 'US', 'INDX', 'CC', 'ETF'] as const;
export type EodhdMarketType = (typeof EODHD_MARKET_TYPES)[number];

const EODHD_SUFFIX_PATTERN = /\.(FOREX|US|INDX|CC|ETF)$/;

export function normalizeCTraderSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * スラッシュ区切り形式 (例: XAUUSD → XAU/USD) に変換する。
 * ローカルキャンドルストアのキーなど、スラッシュ表記を要する用途で使う。
 */
export function toSlashSymbol(symbol: string): string {
  const normalized = normalizeCTraderSymbol(symbol);
  for (const quote of KNOWN_QUOTES) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      const base = normalized.slice(0, -quote.length);
      return `${base}/${quote}`;
    }
  }
  return normalized;
}

/**
 * EODHD 形式のシンボルに変換 (例: XAUUSD → XAUUSD.FOREX)
 *
 * サフィックス (.FOREX / .US / .INDX / .CC / .ETF) の有無に関わらず、ベース部分を
 * `normalizeCTraderSymbol()` で正規化してからサフィックスを再付与する。
 * これにより `EUR/USD.FOREX` のような不正混在も `EURUSD.FOREX` に正される。
 * デフォルト market type は FOREX (本プロジェクトの主用途)。
 */
export function toEodhdSymbol(
  symbol: string,
  marketType: EodhdMarketType = 'FOREX',
): string {
  const trimmedUpper = symbol.trim().toUpperCase();
  const suffixMatch = trimmedUpper.match(EODHD_SUFFIX_PATTERN);
  if (suffixMatch) {
    const baseRaw = trimmedUpper.replace(EODHD_SUFFIX_PATTERN, '');
    return `${normalizeCTraderSymbol(baseRaw)}${suffixMatch[0]}`;
  }
  return `${normalizeCTraderSymbol(symbol)}.${marketType}`;
}

/**
 * EODHD 形式から内部正規化形式 (cTrader 互換) に戻す (例: XAUUSD.FOREX → XAUUSD)
 *
 * サフィックスを除去した後、ベース部を `normalizeCTraderSymbol()` で正規化する
 * (スラッシュ・ハイフン等の非許容文字を除去、大文字化)。
 */
export function fromEodhdSymbol(symbol: string): string {
  const withoutSuffix = symbol.trim().toUpperCase().replace(EODHD_SUFFIX_PATTERN, '');
  return normalizeCTraderSymbol(withoutSuffix);
}

/**
 * EODHD Fundamentals API が対応するか判定
 *
 * Fundamentals API は株式系 (US / ETF / INDX) のみサポート。
 * FX / Crypto / Commodity 系は API レベルで非対応のため、呼び出し前にスキップ判定する。
 *
 * 入力は EODHD 形式 (XAUUSD.FOREX / AAPL.US 等) または内部正規化形式 (XAUUSD 等) どちらでも可。
 * 内部正規化形式 (サフィックスなし) は FX とみなして false を返す (Phase A の主用途)。
 */
export function isEodhdFundamentalsSupported(symbol: string): boolean {
  const trimmedUpper = symbol.trim().toUpperCase();
  return /\.(US|ETF|INDX)$/.test(trimmedUpper);
}
