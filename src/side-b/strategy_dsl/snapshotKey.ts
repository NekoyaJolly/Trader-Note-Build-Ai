/**
 * Indicator series の snapshot key 正規化 (PR #116a)。
 *
 * DSL の Condition / IndicatorOperand を評価する際、indicator series を
 * 一意に特定するためのキー文字列を構築する。
 *
 * フォーマット:
 *   - params なし: `${lens}.${feature}`              (例: `ohlcv.rsi`)
 *   - params あり: `${lens}.${feature}(${stable})`  (例: `ohlcv.ema(period=20)`)
 *
 * `stable` は params を **キー昇順 + 安定 JSON 化** して文字列化したもの。
 * 同じ params (順序違い) からは必ず同じ key が出るため、cache hit 率を保てる。
 *
 * 評価器側 (PR #116b TS surrogate / PR #116c Python) はこの key で
 * indicator series を取得・cache する。analysis-engine 側の同等関数は
 * `analysis-engine/app/indicators.py:make_cache_key` (既存)、
 * `condition_evaluator.py` 側の正規化キーもこの形式に揃える予定。
 */

import type { ConditionParams } from './schema';

/**
 * indicator series 用の snapshot key を構築する。
 *
 * @param lens   レンズ名 (例: `ohlcv`)
 * @param feature 特徴量名 (例: `rsi`, `ema`, `macd`)
 * @param params 動的パラメータ。undefined / 空オブジェクトは「params なし」扱い
 */
export function buildSnapshotKey(
  lens: string,
  feature: string,
  params?: ConditionParams,
): string {
  if (!params || Object.keys(params).length === 0) {
    return `${lens}.${feature}`;
  }
  return `${lens}.${feature}(${formatStableParams(params)})`;
}

/**
 * params を「キー昇順 + 値を Number で正規化」して安定文字列に変換する。
 *
 * 例: `{ slowPeriod: 26, fastPeriod: 12 }` → `fastPeriod=12,slowPeriod=26`
 *
 * JSON ではなく `key=value,key=value` 形式にしているのは:
 *   - 人が読みやすい
 *   - パースしやすい (snapshot dump や log で目視確認できる)
 *   - JSON.stringify の whitespace / unicode escape の差異を回避
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
