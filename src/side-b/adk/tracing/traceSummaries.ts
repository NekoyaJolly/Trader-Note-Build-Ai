/**
 * payload summary / redaction (Step 2 Phase 2)
 *
 * args / result の raw payload を **trace event に保存しない**ための要約関数群。
 *
 * 設計書: docs/architecture/STEP_2_KICKOFF.md §5.2 / STEP_2_ADK_TRACING_SPIKE.md §3.1
 *
 * 提供する関数:
 * - `payloadToSummary(value)`: 任意の値 (object / array / primitive) を `TracePayloadSummary` に縮約
 * - `shortenErrorMessage(msg, maxLength?)`: error message の長さを制限
 *
 * **重要な実装方針**:
 * - raw value は一切返さない
 * - object のキー名のみ保存 (値は保存しない)
 * - `topLevelKeys` には上限を設ける (デフォルト 20 件)
 * - 関数 / Symbol / BigInt 等の非 JSON プリミティブも安全に扱う
 *
 * 型方針: 「任意の値を受ける」境界層だが、リポジトリ規約 (`unknown` 禁止) を守るため
 * ジェネリック `<T>(value: T)` で受ける。呼び出し側は推論で自然に通り、本関数内では
 * `typeof` / `Array.isArray` / `value === null` で narrow できる。
 */

import type { TracePayloadSummary } from './traceTypes';

// ============================================================================
// 定数
// ============================================================================

/**
 * `topLevelKeys` 配列に保存するキーの上限。
 *
 * Skill の input/output で 20 を超えるキー数は実用上 rare、かつ上限を設けないと
 * trace event のサイズが膨張する。
 */
export const TOP_LEVEL_KEYS_LIMIT = 20;

/** 単一 key 名の文字数上限 (異常に長い key 名で trace を肥大化させない)。 */
export const KEY_NAME_LIMIT = 64;

/** `shortenErrorMessage` のデフォルト最大長。 */
export const DEFAULT_ERROR_MESSAGE_MAX = 500;

// ============================================================================
// 公開関数
// ============================================================================

/**
 * 任意の値を `TracePayloadSummary` に縮約する。
 *
 * - `null` / `undefined` / primitives → `primitiveType` のみ設定
 * - `array` → `fieldCount` (= length) のみ設定
 * - `object` → `fieldCount` + `topLevelKeys` (最大 20 件、各 64 文字まで)
 * - 値本体は一切保存しない
 *
 * `redacted: true` リテラルは常に付与。
 *
 * @param value 要約対象 (任意の値、ジェネリック `T` で受ける)。
 * @returns raw value を含まない `TracePayloadSummary`。
 */
export function payloadToSummary<T>(value: T): TracePayloadSummary {
  // null
  if (value === null) {
    return { primitiveType: 'null', redacted: true };
  }

  // undefined
  if (value === undefined) {
    return { primitiveType: 'undefined', redacted: true };
  }

  // array
  if (Array.isArray(value)) {
    return {
      fieldCount: value.length,
      redacted: true,
    };
  }

  // primitive
  const t = typeof value;
  if (
    t === 'string' ||
    t === 'number' ||
    t === 'boolean' ||
    t === 'bigint' ||
    t === 'symbol' ||
    t === 'function'
  ) {
    return { primitiveType: t, redacted: true };
  }

  // plain object (= typeof === 'object' && value !== null && !Array.isArray(value))
  // value は object 型として narrow 済み。Object.keys は値型を必要としないため
  // Record<string, unknown> ではなく Record<string, never> でキャストして unknown 露出を避ける。
  const obj = value as Record<string, never>;
  const allKeys = Object.keys(obj);
  const truncatedKeys = allKeys
    .slice(0, TOP_LEVEL_KEYS_LIMIT)
    .map((k) => (k.length > KEY_NAME_LIMIT ? `${k.slice(0, KEY_NAME_LIMIT)}…` : k));

  return {
    fieldCount: allKeys.length,
    topLevelKeys: truncatedKeys,
    redacted: true,
  };
}

/**
 * error message を最大 `maxLength` 文字に短縮する。
 *
 * - 元 message が短い場合は無加工で返す
 * - 超過する場合は末尾を切り、`…` を付与
 * - `null` / `undefined` は `''` に正規化
 *
 * @param msg 元 message。string 以外なら空文字を返す
 * @param maxLength 最大長 (デフォルト 500)
 */
export function shortenErrorMessage(
  msg: string | null | undefined,
  maxLength: number = DEFAULT_ERROR_MESSAGE_MAX,
): string {
  if (typeof msg !== 'string') return '';
  // maxLength <= 0 は「上限ゼロ」= 空文字。"…" 1 文字も返さない (契約: 戻り値長 ≤ maxLength)。
  if (maxLength <= 0) return '';
  if (msg.length <= maxLength) return msg;
  // 末尾を切る (前半 maxLength-1 文字 + '…' 計 maxLength 文字)
  return `${msg.slice(0, maxLength - 1)}…`;
}
