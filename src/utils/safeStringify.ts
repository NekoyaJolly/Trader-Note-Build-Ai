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
 */
export function safeStringify(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (value instanceof Error) {
        return `${value.name}: ${value.message || '(empty message)'}`;
    }
    try {
        return JSON.stringify(value);
    } catch {
        // BigInt / 循環参照 / toJSON throw 等のフォールバック
        try {
            return String(value);
        } catch {
            return '[unserializable value]';
        }
    }
}
