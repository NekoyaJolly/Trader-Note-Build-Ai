/**
 * 市場データ用シンボル正規化ユーティリティ。
 *
 * cTrader / DB 保存ではスラッシュなし大文字（例: XAUUSD）を正とする。
 * 各データプロバイダ向けに以下のフォーマット変換を提供する:
 * - Twelve Data: スラッシュ区切り (XAU/USD)
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

export function toTwelveDataSymbol(symbol: string): string {
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
 * 既にサフィックス (.FOREX / .US / .INDX / .CC / .ETF) が付いていればそのまま返す。
 * デフォルト market type は FOREX (本プロジェクトの主用途)。
 */
export function toEodhdSymbol(
  symbol: string,
  marketType: EodhdMarketType = 'FOREX',
): string {
  const trimmedUpper = symbol.trim().toUpperCase();
  if (EODHD_SUFFIX_PATTERN.test(trimmedUpper)) {
    return trimmedUpper;
  }
  const normalized = normalizeCTraderSymbol(symbol);
  return `${normalized}.${marketType}`;
}

/**
 * EODHD 形式から内部正規化形式 (cTrader 互換) に戻す (例: XAUUSD.FOREX → XAUUSD)
 */
export function fromEodhdSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(EODHD_SUFFIX_PATTERN, '');
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
