/**
 * 表示用フォーマッタ群 (Wave 1 G5-1, 2026-05-18)
 *
 * 責務: UI で「0-1 の小数」と「0-100 の整数」が混在する数値 (confidence /
 * win rate / probability 等) を一律で 0-100% 表示に揃える helper を集約する。
 *
 * 統合しなかった理由: 既存の `lib/` 配下に汎用 number formatter は存在せず、
 * `HypothesisDetail.tsx` 内のみに local 定義 (line 72) があった。Last-Mile 探索で
 * Agent 運転席 (`/side-b/agent`) の confidence 表示が素通し (`0.66` と `71` が
 * 混在) になっていることが確認されたため、再利用可能な lib に切り出して
 * 横断適用する (= 同種の混在バグの再発防止)。
 *
 * 恒久 or 一時: 恒久
 * 参照経路: import { formatPercent } from '@/lib/format'
 * 削除条件: backend が confidence の単位を 0-1 に完全統一し、frontend での
 *           heuristic 補正 (value <= 1 ? *100 : value) が不要になった場合。
 *           その段階で `formatPercent` は単純な `*100.toFixed()` に縮退する。
 */

/**
 * 数値を 0-100% 表記の文字列に整形する。
 *
 * - `value` が 0-1 の範囲なら 100 倍して % 表示 (= 確率 / 信頼度の標準形)
 * - `value` が 1 より大きければ既に 0-100 と解釈してそのまま表示
 * - undefined / NaN / Infinity は em-dash ("—") を返す
 *
 * 注: 上記の heuristic 補正は backend で 0-1 と 0-100 が混在している現状への
 * 防衛措置 (Last-Mile 探索 2026-05-18 で発見)。最終的には backend を 0-1 に
 * 統一して本 helper は単純化する。
 */
export function formatPercent(value: number | null | undefined, digits = 1): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const normalized = value <= 1 ? value * 100 : value;
    return `${normalized.toFixed(digits)}%`;
}
