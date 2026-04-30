/**
 * Side-B 全体の timeframe(時間足)定義の単一の真実の源泉
 *
 * orchestration_health_report.md Critical-1.5 のフォローアップとして導入。
 * 過去は `'multi'` や `'15m'` がコード各所にハードコードされ、その不整合が
 * 「Twelve Data API が interval=multi を rejecting する」という詰まりに
 * つながった。ここに集約することで:
 *
 * - サポートする値が一箇所で確認できる
 * - 既定値の変更が 1 行で済む
 * - 受理可能な timeframe を Set で型安全に判定できる
 *
 * 注意: BacktestTimeframe は別系統(Side-A 由来、外部API 互換)に存在するため、
 * ここでは「Side-B が screening / plan で扱う」値だけを規定する。
 */

/** Side-B が screening / plan で扱う timeframe の列挙。 */
export const SUPPORTED_TIMEFRAMES = [
    '1m',
    '5m',
    '15m',
    '30m',
    '1h',
    '4h',
    '1d',
    '1w',
] as const;

export type SupportedTimeframe = (typeof SUPPORTED_TIMEFRAMES)[number];

/** 既定値。MarketResearch / EdgeHypothesis に明示指定がない場合のフォールバック。 */
export const DEFAULT_TIMEFRAME: SupportedTimeframe = '15m';

/** O(1) 判定用の Set。受理可能な timeframe か検証する。 */
const SUPPORTED_TIMEFRAME_SET: ReadonlySet<string> = new Set<string>(SUPPORTED_TIMEFRAMES);

/**
 * 与えられた値が受理可能な timeframe かを判定する型ガード。
 */
export function isSupportedTimeframe(value: string): value is SupportedTimeframe {
    return SUPPORTED_TIMEFRAME_SET.has(value);
}

/**
 * 任意の文字列を受理可能な timeframe に正規化する。
 *
 * 入力が小文字化して `SUPPORTED_TIMEFRAMES` に含まれればそれを返す。
 * `'multi'` / 空文字 / 未知の値は `DEFAULT_TIMEFRAME` に倒す。
 *
 * @param value 任意のタイムフレーム文字列(undefined / null も許容)
 * @returns SupportedTimeframe(必ず受理可能な値)
 */
export function normalizeTimeframe(
    value: string | undefined | null,
): SupportedTimeframe {
    if (typeof value !== 'string') return DEFAULT_TIMEFRAME;
    const normalized = value.trim().toLowerCase();
    if (isSupportedTimeframe(normalized)) return normalized;
    return DEFAULT_TIMEFRAME;
}
