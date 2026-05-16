/**
 * 任意の値をログ出力可能な文字列に安全に変換する。
 *
 * 設計:
 * - `JSON.stringify` 単独だと BigInt / 循環参照 / `toJSON` で throw する値で 2 次例外が起きる。
 *   ログ整形パスで 2 次例外を出すと、元のエラー (Twelve Data fetch 失敗等) を潰してしまうため、
 *   必ず文字列化に成功するヘルパーで包む。
 * - Error インスタンスは `name: message` 形式に整形 (= 構造化されており JSON より読みやすい)。
 * - その他は `JSON.stringify` を試し、失敗したら `String(v)` にフォールバック。
 *
 * 用途: catch ブロックでの `err.cause` ログ、`console.warn` の第二引数等。
 *
 * 型設計上のメモ:
 * - 本関数は「型が確定していない catch の err」「外部ライブラリから渡る任意の値」を
 *   ログ用に文字列化することが存在意義であり、`unknown` を受けることが本質的に必要。
 * - そのため例外的に `unknown` を許容し、no-restricted-syntax を 1 行 disable する。
 */
// eslint-disable-next-line no-restricted-syntax -- 文字列化対象が任意型である本関数の本質的要件
export function safeStringify(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (value instanceof Error) {
        return `${value.name}: ${value.message || '(empty message)'}`;
    }
    try {
        return JSON.stringify(value);
    } catch {
        // BigInt / 循環参照 / toJSON throw 等のフォールバック。
        // String(obj) は object の場合 '[object Object]' になるため、
        // プリミティブ系のみ文字列化し、それ以外は型タグを返す。
        try {
            if (typeof value === 'bigint') return `${value.toString()}n`;
            if (typeof value === 'symbol') return value.toString();
            if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
            if (typeof value === 'object') return `[object ${Object.prototype.toString.call(value).slice(8, -1)}]`;
            if (typeof value === 'string') return value;
            if (typeof value === 'number' || typeof value === 'boolean') return String(value);
            // 想定外の型 (TS の型システムでは到達不能だがランタイム保険)
            return '[unknown type]';
        } catch {
            return '[unserializable value]';
        }
    }
}
