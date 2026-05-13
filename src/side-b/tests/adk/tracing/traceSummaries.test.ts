/**
 * traceSummaries テスト (Step 2 Phase 2)
 *
 * payloadToSummary / shortenErrorMessage の動作と、raw payload が保存されないことを確認する。
 *
 * 設計書: STEP_2_KICKOFF.md §5.2 (raw payload 禁止)
 */

import {
  payloadToSummary,
  shortenErrorMessage,
  TOP_LEVEL_KEYS_LIMIT,
  KEY_NAME_LIMIT,
  DEFAULT_ERROR_MESSAGE_MAX,
} from '../../../adk/tracing/traceSummaries';

// ============================================================================
// payloadToSummary: primitives
// ============================================================================

describe('payloadToSummary: プリミティブ', () => {
  it('null → { primitiveType: "null", redacted: true }', () => {
    expect(payloadToSummary(null)).toEqual({ primitiveType: 'null', redacted: true });
  });

  it('undefined → { primitiveType: "undefined", redacted: true }', () => {
    expect(payloadToSummary(undefined)).toEqual({ primitiveType: 'undefined', redacted: true });
  });

  it('string → primitiveType: "string"', () => {
    expect(payloadToSummary('hello')).toEqual({ primitiveType: 'string', redacted: true });
  });

  it('number → primitiveType: "number"', () => {
    expect(payloadToSummary(42)).toEqual({ primitiveType: 'number', redacted: true });
  });

  it('boolean → primitiveType: "boolean"', () => {
    expect(payloadToSummary(true)).toEqual({ primitiveType: 'boolean', redacted: true });
  });

  it('bigint → primitiveType: "bigint"', () => {
    expect(payloadToSummary(BigInt(1))).toEqual({ primitiveType: 'bigint', redacted: true });
  });

  it('function → primitiveType: "function"', () => {
    expect(payloadToSummary(() => 1)).toEqual({ primitiveType: 'function', redacted: true });
  });
});

// ============================================================================
// payloadToSummary: array
// ============================================================================

describe('payloadToSummary: array', () => {
  it('空配列 → fieldCount: 0', () => {
    expect(payloadToSummary([])).toEqual({ fieldCount: 0, redacted: true });
  });

  it('5 要素配列 → fieldCount: 5', () => {
    expect(payloadToSummary([1, 2, 3, 4, 5])).toEqual({ fieldCount: 5, redacted: true });
  });

  it('要素の値は保存されない (raw payload 禁止)', () => {
    const s = payloadToSummary(['secret-token', 'api-key-abc']);
    expect(JSON.stringify(s)).not.toContain('secret-token');
    expect(JSON.stringify(s)).not.toContain('api-key-abc');
  });
});

// ============================================================================
// payloadToSummary: object
// ============================================================================

describe('payloadToSummary: object', () => {
  it('plain object → fieldCount + topLevelKeys', () => {
    const s = payloadToSummary({ name: 'Alice', age: 30 });
    expect(s).toEqual({
      fieldCount: 2,
      topLevelKeys: ['name', 'age'],
      redacted: true,
    });
  });

  it('値は保存されない (raw payload 禁止)', () => {
    const s = payloadToSummary({ apiKey: 'sk-secret-12345', password: 'p4ssw0rd' });
    const json = JSON.stringify(s);
    expect(json).not.toContain('sk-secret');
    expect(json).not.toContain('p4ssw0rd');
    expect(s.topLevelKeys).toEqual(['apiKey', 'password']);
  });

  it(`topLevelKeys は最大 ${TOP_LEVEL_KEYS_LIMIT} 件まで`, () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 50; i++) obj[`key${i}`] = i;
    const s = payloadToSummary(obj);
    expect(s.fieldCount).toBe(50);
    expect(s.topLevelKeys).toHaveLength(TOP_LEVEL_KEYS_LIMIT);
  });

  it(`単一 key 名は最大 ${KEY_NAME_LIMIT} 文字まで (超過は ... で短縮)`, () => {
    const longKey = 'x'.repeat(KEY_NAME_LIMIT + 10);
    const s = payloadToSummary({ [longKey]: 1 });
    expect(s.topLevelKeys).toBeDefined();
    expect(s.topLevelKeys?.[0]).toHaveLength(KEY_NAME_LIMIT + 1); // KEY_NAME_LIMIT + '…' (1 char)
    expect(s.topLevelKeys?.[0]?.endsWith('…')).toBe(true);
  });

  it('ネスト object の値は再帰展開しない (top level のみ要約)', () => {
    const s = payloadToSummary({
      user: { secret: 'top-secret' },
      config: { apiKey: 'sk-12345' },
    });
    expect(s.topLevelKeys).toEqual(['user', 'config']);
    expect(JSON.stringify(s)).not.toContain('top-secret');
    expect(JSON.stringify(s)).not.toContain('sk-12345');
  });

  it('空 object → fieldCount: 0, topLevelKeys: []', () => {
    expect(payloadToSummary({})).toEqual({
      fieldCount: 0,
      topLevelKeys: [],
      redacted: true,
    });
  });
});

// ============================================================================
// shortenErrorMessage
// ============================================================================

describe('shortenErrorMessage', () => {
  it('短い message はそのまま返す', () => {
    expect(shortenErrorMessage('short error')).toBe('short error');
  });

  it(`デフォルト ${DEFAULT_ERROR_MESSAGE_MAX} 文字を超えると末尾を切り … を付与`, () => {
    const long = 'x'.repeat(DEFAULT_ERROR_MESSAGE_MAX + 100);
    const result = shortenErrorMessage(long);
    expect(result).toHaveLength(DEFAULT_ERROR_MESSAGE_MAX);
    expect(result.endsWith('…')).toBe(true);
  });

  it('maxLength を指定可能', () => {
    expect(shortenErrorMessage('hello world', 5)).toBe('hell…');
  });

  it('null → 空文字', () => {
    expect(shortenErrorMessage(null)).toBe('');
  });

  it('undefined → 空文字', () => {
    expect(shortenErrorMessage(undefined)).toBe('');
  });

  it('maxLength=0 → 空文字 (上限ゼロは "…" 1 文字も含まない)', () => {
    expect(shortenErrorMessage('hello', 0)).toBe('');
  });

  it('maxLength=-1 → 空文字', () => {
    expect(shortenErrorMessage('hello', -1)).toBe('');
  });
});
