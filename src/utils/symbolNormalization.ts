/**
 * 市場データ用シンボル正規化ユーティリティ。
 *
 * cTrader / DB 保存ではスラッシュなし大文字（例: XAUUSD）を正とする。
 * Twelve Data フォールバック時だけ、APIが受け付けやすいスラッシュ区切りへ変換する。
 */

const KNOWN_QUOTES = ['USDT', 'USD', 'JPY', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'NZD'] as const;

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
