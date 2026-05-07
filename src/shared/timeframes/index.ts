/**
 * Timeframe alias / 比較ユーティリティ (PR ⑤)。
 *
 * 用途:
 * - 戦略 DSL / 進化ループ / Side-A UI / analysis-engine の timeframe 表記ゆらぎ
 *   ('1h' / '60m' / 'H1' / '1H') を **canonical な表記** ('1h') に正規化する。
 * - MTF (= マルチタイムフレーム) 戦略で「上位足 / 下位足」の判定に使う
 *   `compareTimeframes(a, b)` を提供。
 *
 * 設計:
 * - canonical は **小文字 + 単位接尾** ('1m' / '15m' / '1h' / '4h' / '1d')
 *   に統一する。registry の単一情報源として `TIMEFRAME_REGISTRY` を export
 * - 単位は m (分) / h (時間) / d (日) のみ対応。1 timeframe の絶対秒数を内部
 *   で持ち、上位下位判定はこれを使う
 * - 未知の timeframe (= registry にない) は normalizeTimeframe で null 戻し
 *   → 呼び出し側でエラー処理する (= silent fallback しない)
 */

/** canonical timeframe (= 戦略 DSL / API で使う標準表記)。 */
export type CanonicalTimeframe =
  | '1m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '4h'
  | '1d';

/** canonical timeframe の一覧 (= 短い順)。 */
export const ALL_CANONICAL_TIMEFRAMES: readonly CanonicalTimeframe[] = [
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  '1d',
];

interface TimeframeEntry {
  /** canonical な表記。 */
  readonly canonical: CanonicalTimeframe;
  /** 1 バーの秒数 (= 上位下位判定に使う)。 */
  readonly seconds: number;
  /** alias (= 同義表記。canonical 含めて全部受け入れる)。 */
  readonly aliases: readonly string[];
}

const TIMEFRAME_REGISTRY: readonly TimeframeEntry[] = [
  { canonical: '1m', seconds: 60, aliases: ['1m', 'm1', '1min'] },
  { canonical: '5m', seconds: 300, aliases: ['5m', 'm5', '5min'] },
  { canonical: '15m', seconds: 900, aliases: ['15m', 'm15', '15min'] },
  { canonical: '30m', seconds: 1800, aliases: ['30m', 'm30', '30min'] },
  { canonical: '1h', seconds: 3600, aliases: ['1h', '60m', 'h1', '1H'] },
  { canonical: '4h', seconds: 14400, aliases: ['4h', '240m', 'h4', '4H'] },
  { canonical: '1d', seconds: 86400, aliases: ['1d', 'd1', '1D', 'daily'] },
];

const ALIAS_TO_CANONICAL = (() => {
  const map = new Map<string, CanonicalTimeframe>();
  for (const e of TIMEFRAME_REGISTRY) {
    for (const a of e.aliases) {
      map.set(a.toLowerCase(), e.canonical);
    }
  }
  return map;
})();

const CANONICAL_TO_SECONDS = new Map<CanonicalTimeframe, number>(
  TIMEFRAME_REGISTRY.map((e) => [e.canonical, e.seconds]),
);

/**
 * timeframe 文字列を canonical 表記に正規化する。
 *
 * - 大文字小文字の差異 / 既知 alias を吸収
 * - 未知の表記は null を返す (= 呼び出し側でエラー化する)
 *
 * @example
 * normalizeTimeframe('1H')   // → '1h'
 * normalizeTimeframe('60m')  // → '1h'
 * normalizeTimeframe('xxx')  // → null
 */
export function normalizeTimeframe(value: string): CanonicalTimeframe | null {
  return ALIAS_TO_CANONICAL.get(value.trim().toLowerCase()) ?? null;
}

/**
 * `value` が canonical timeframe か判定する type guard。
 */
export function isCanonicalTimeframe(value: string): value is CanonicalTimeframe {
  return CANONICAL_TO_SECONDS.has(value as CanonicalTimeframe);
}

/** canonical timeframe の 1 バー秒数。 */
export function timeframeSeconds(tf: CanonicalTimeframe): number {
  const s = CANONICAL_TO_SECONDS.get(tf);
  if (s === undefined) {
    throw new Error(`未知の canonical timeframe: ${tf}`);
  }
  return s;
}

/**
 * timeframe a と b を比較する。
 *
 * - 戻り値 < 0: a が **下位足** (= 短い時間足)
 * - 戻り値 > 0: a が **上位足** (= 長い時間足)
 * - 戻り値 = 0: 同じ
 *
 * 入力は canonical または alias どちらでも可 (= 内部で normalize)。未知 timeframe
 * は例外を投げる。
 */
export function compareTimeframes(a: string, b: string): number {
  const ca = normalizeTimeframe(a);
  const cb = normalizeTimeframe(b);
  if (ca === null) throw new Error(`compareTimeframes: 未知の timeframe '${a}'`);
  if (cb === null) throw new Error(`compareTimeframes: 未知の timeframe '${b}'`);
  return timeframeSeconds(ca) - timeframeSeconds(cb);
}

/**
 * `tf` が `base` の **上位足** か判定 (= 厳密に長い時間足)。
 * 同じ場合は false。
 */
export function isHigherTimeframe(tf: string, base: string): boolean {
  return compareTimeframes(tf, base) > 0;
}
