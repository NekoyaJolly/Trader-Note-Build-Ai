/**
 * MTF (マルチタイムフレーム) バーアライメント (PR ⑤B)。
 *
 * 主 timeframe (例: 15m) で進行する各バー i に対して、その時点で **確定済み**
 * (= close が完了している) **最新の上位足バー j** のインデックスを求める。
 *
 * **look-ahead bias 防止**:
 * - 上位足バー j は、その close 時刻が「主バー i の close 時刻 **以下**」のときに
 *   初めて参照可能 (= バーが完全に閉じている)
 * - 「主バー i の close 時刻」 = `t_i + interval(primary_tf)`
 * - 「上位足 j の close 時刻」 = `t_j + interval(upper_tf)`
 * - 条件: `t_j + interval(upper_tf) <= t_i + interval(primary_tf)`
 * - ↔ `t_j <= t_i + interval(primary_tf) - interval(upper_tf)`
 *
 * 例 (主=15m, 上位=1h):
 * - 15m バー i: t=03:30 (close = 03:45)
 * - 1h バー j=1: t=02:00 (close = 03:00) → close (03:00) <= 03:45 OK → 参照可
 * - 1h バー j=2: t=03:00 (close = 04:00) → close (04:00) > 03:45 → 参照不可
 * - つまり 15m i=03:30 の時点では 1h j=1 (t=02:00) が最新確定
 *
 * バーの timestamp は **バー開始時刻** を表す (= cTrader / pandas_ta 標準)。
 * 上位足が開始されていない期間 (= 主バーが上位足の最初のバー前) は j=-1。
 *
 * **forward fill**:
 * - 同じ上位足 j の値を、対応する主バー区間で繰り返し参照する
 * - alignment 配列を作れば、`upperSeries[alignment[i]]` で主バー i の値が取れる
 * - j=-1 のバーは値なし (= 呼び出し側で NaN / null に倒す)
 */

import type { OhlcvBar } from './OhlcvSource';
import { type CanonicalTimeframe, timeframeSeconds } from '../timeframes';

/**
 * 主バー列の各 i に対して、look-ahead bias を防いだ上位足の最新確定インデックス j
 * を返す。j=-1 は「i 時点では確定上位足なし」(= 上位足が開始される前)。
 *
 * 計算量: O(N + M) (= 双方を時刻順にスキャン)。bars は時刻昇順前提。
 *
 * @param primaryBars 主 timeframe バー列 (時刻昇順)
 * @param upperBars   上位足バー列 (時刻昇順)
 * @param primaryTf   主 timeframe (canonical)
 * @param upperTf     上位足 timeframe (canonical)
 */
export function buildBarAlignment(
  primaryBars: readonly OhlcvBar[],
  upperBars: readonly OhlcvBar[],
  primaryTf: CanonicalTimeframe,
  upperTf: CanonicalTimeframe,
): number[] {
  const primaryTfSec = timeframeSeconds(primaryTf);
  const upperTfSec = timeframeSeconds(upperTf);
  // 上位足の close 時刻配列 (= timestamp + interval) を ms に変換しておく
  const upperCloseMs: number[] = upperBars.map(
    (b) => b.timestamp.getTime() + upperTfSec * 1000,
  );
  const result = new Array<number>(primaryBars.length);

  let j = -1;
  for (let i = 0; i < primaryBars.length; i++) {
    const primaryCloseMs = primaryBars[i].timestamp.getTime() + primaryTfSec * 1000;
    // j を進めて「close 時刻が primaryCloseMs 以下の最大 j」を探す
    while (j + 1 < upperCloseMs.length && upperCloseMs[j + 1] <= primaryCloseMs) {
      j += 1;
    }
    result[i] = j; // j=-1 のままなら参照不可
  }
  return result;
}

/**
 * 上位足の値配列 `upperSeries` を **主 timeframe バー長に forward fill** する。
 *
 * 具体的には、主バー i に対して `alignment[i] = j` を適用して
 * `out[i] = upperSeries[j]` を返す。`j=-1` のバーは `null` (= warm-up 扱い)。
 *
 * 上位足 series が `(number | null)[]` 型 (= analysis-engine `/v1/indicator-series`
 * の戻り値) でも、boolean 配列でも汎用に動かせるよう generic で実装。
 */
export function forwardFillSeriesToPrimary<T extends number | null | boolean>(
  upperSeries: readonly T[],
  alignment: readonly number[],
  fallback: T,
): T[] {
  const out = new Array<T>(alignment.length);
  for (let i = 0; i < alignment.length; i++) {
    const j = alignment[i];
    if (j < 0 || j >= upperSeries.length) {
      out[i] = fallback;
      continue;
    }
    const v = upperSeries[j];
    out[i] = v === null || v === undefined ? fallback : v;
  }
  return out;
}
