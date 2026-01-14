import type { ParsedQs } from 'qs';

/**
 * Express リクエストパラメータヘルパー
 * req.params と req.query の値を安全に string として取得
 */

// Express の req.query の完全な型
type QueryValue = string | ParsedQs | string[] | ParsedQs[] | (string | ParsedQs)[] | undefined;

/**
 * リクエストパラメータを string として取得
 * 配列の場合は最初の要素を返す
 */
export function getStringParam(value: QueryValue): string {
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === 'string') {
      return first;
    }
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return '';
}

/**
 * リクエストパラメータを string | undefined として取得
 * 配列の場合は最初の要素を返す
 */
export function getOptionalStringParam(value: QueryValue): string | undefined {
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === 'string') {
      return first;
    }
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

/**
 * リクエストパラメータを number として取得
 * パース失敗時は undefined を返す
 */
export function getNumberParam(value: QueryValue): number | undefined {
  const str = getOptionalStringParam(value);
  if (!str) return undefined;
  const num = Number(str);
  return isNaN(num) ? undefined : num;
}
