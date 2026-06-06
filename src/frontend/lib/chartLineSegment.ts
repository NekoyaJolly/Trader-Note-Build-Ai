/**
 * 手描きライン (2 点の線分) を lightweight-charts の LineSeries 用に正規化するユーティリティ。
 *
 * lightweight-charts は LineSeries data に「時刻が昇順かつ重複なし」を要求し、違反すると
 * setData が throw してチャート全体の描画が壊れる (ローソク足が消える)。手描きライン
 * (水平線=単発クリックで start==end / トレンド=右→左で降順) はこの条件を破りやすいため、
 * 描画前に必ず本関数で正規化する。
 */

export interface LineSegmentPoint {
  /** lightweight-charts の time (Unix 秒) */
  time: number;
  value: number;
}

/**
 * 2 点を「昇順かつ別時刻」に正規化する。
 * - 同一時刻: 2 点目を stepSec (= 1 本分) 後ろにずらす
 * - 降順: 2 点を入れ替える (値も対応して入れ替え)
 *
 * @param stepSec 同一時刻時にずらす秒数 (足の長さ)。1 未満は 1 秒に丸める。
 */
export function normalizeLineSegment(
  p1: LineSegmentPoint,
  p2: LineSegmentPoint,
  stepSec: number,
): [LineSegmentPoint, LineSegmentPoint] {
  const step = Math.max(1, Math.floor(stepSec));
  if (p1.time === p2.time) {
    return [p1, { time: p2.time + step, value: p2.value }];
  }
  if (p1.time > p2.time) {
    return [p2, p1];
  }
  return [p1, p2];
}
