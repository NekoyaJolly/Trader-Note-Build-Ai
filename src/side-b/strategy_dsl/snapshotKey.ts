/**
 * Indicator series の snapshot key 正規化 (PR #116a, PR ⑤ で MTF 拡張)。
 *
 * DSL の Condition / IndicatorOperand を評価する際、indicator series を
 * 一意に特定するためのキー文字列を構築する。
 *
 * フォーマット:
 *   - 主 timeframe + params なし: `${lens}.${feature}`              (例: `ohlcv.rsi`)
 *   - 主 timeframe + params あり: `${lens}.${feature}(${stable})`  (例: `ohlcv.ema(period=20)`)
 *   - **上位足 + params なし**:    `${lens}@${tf}.${feature}`         (例: `ohlcv@1h.rsi`)
 *   - **上位足 + params あり**:    `${lens}@${tf}.${feature}(${stable})` (例: `ohlcv@1h.ema(period=20)`)
 *
 * 主 timeframe (= `StrategyDSL.timeframe`) と一致する条件は **接尾なし** で従来 key
 * と完全互換。上位足 (= 戦略の主時間足より長い時間足) のみ `@<tf>` を lens に修飾
 * する形で区別する。
 *
 * `stable` は params を **キー昇順 + 安定 JSON 化** して文字列化したもの。
 * 同じ params (順序違い) からは必ず同じ key が出るため、cache hit 率を保てる。
 */

import type { CanonicalTimeframe } from '../../shared/timeframes';
import { normalizeTimeframe } from '../../shared/timeframes';
import type { ConditionParams } from './schema';

/**
 * indicator series 用の snapshot key を構築する。
 *
 * @param lens   レンズ名 (例: `ohlcv`)
 * @param feature 特徴量名 (例: `rsi`, `ema`, `macd`)
 * @param params 動的パラメータ。undefined / 空オブジェクトは「params なし」扱い
 * @param timeframe 上位足を指定する場合の canonical timeframe
 *                  (例: `'1h'`)。`undefined` または主 timeframe と同じ値なら接尾なし
 *                  (= 後方互換)。**呼び出し側が「主 timeframe と同じか」を判定して
 *                  渡す責務**を持つ (= ここで判定するには `primaryTimeframe` 引数が
 *                  必要になり API が膨らむため、判定は `buildSnapshotKeyWithPrimary`
 *                  に切り出してある)。
 */
export function buildSnapshotKey(
  lens: string,
  feature: string,
  params?: ConditionParams,
  timeframe?: CanonicalTimeframe,
): string {
  const lensWithTf = timeframe ? `${lens}@${timeframe}` : lens;
  if (!params || Object.keys(params).length === 0) {
    return `${lensWithTf}.${feature}`;
  }
  return `${lensWithTf}.${feature}(${formatStableParams(params)})`;
}

/**
 * 主 timeframe と比較して上位足の場合のみ `@<tf>` 修飾を付ける snapshot key を構築する。
 *
 * - `conditionTimeframe` が undefined → 主 timeframe 扱い (= 修飾なし)
 * - `conditionTimeframe` が主と一致 → 修飾なし
 * - `conditionTimeframe` が主と異なる → `@<canonical>` 修飾
 *
 * canonical 化に失敗した場合 (= 未知 timeframe) は例外を投げる。
 */
export function buildSnapshotKeyWithPrimary(
  lens: string,
  feature: string,
  params: ConditionParams | undefined,
  conditionTimeframe: string | undefined,
  primaryTimeframe: string,
): string {
  const primary = normalizeTimeframe(primaryTimeframe);
  if (primary === null) {
    throw new Error(`buildSnapshotKeyWithPrimary: 未知の primaryTimeframe '${primaryTimeframe}'`);
  }
  if (!conditionTimeframe) {
    return buildSnapshotKey(lens, feature, params);
  }
  const tf = normalizeTimeframe(conditionTimeframe);
  if (tf === null) {
    throw new Error(`buildSnapshotKeyWithPrimary: 未知の conditionTimeframe '${conditionTimeframe}'`);
  }
  if (tf === primary) {
    // 主 timeframe と同じなら接尾なし (後方互換)
    return buildSnapshotKey(lens, feature, params);
  }
  return buildSnapshotKey(lens, feature, params, tf);
}

/**
 * params を「キー昇順 + 値を Number で正規化」して安定キー文字列に変換する。
 *
 * 例: `{ slowPeriod: 26, fastPeriod: 12 }` → `fastPeriod=12,slowPeriod=26`
 *
 * 出力形式は **JSON ではなく `key=value,key=value` 形式**。理由:
 *   - 人が読みやすい
 *   - snapshot dump や log で目視確認しやすい
 *   - JSON.stringify の whitespace / unicode escape / プロパティ列挙順の差異を避ける
 */
export function formatStableParams(params: ConditionParams): string {
  const sortedKeys = Object.keys(params).sort();
  return sortedKeys.map((k) => `${k}=${formatStableNumber(params[k])}`).join(',');
}

/**
 * 数値を「値が同じなら表現も同じ」になるよう正規化する。
 * Integer は `12`、float は `0.02` のように、JS の Number → String が安定する範囲で扱う。
 */
function formatStableNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`snapshot key params: 非有限値は使えない (${n})`);
  }
  // -0 を 0 に正規化
  if (n === 0) return '0';
  return String(n);
}
