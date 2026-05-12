/**
 * adapters テスト専用ヘルパー
 *
 * ★★ 本ファイルはテストヘルパー専用。本番コードからは絶対に import しない。
 *
 * Step 1 Ticket T6 (テスト先行) で実装。
 * 設計書: /src/side-b/adk/adapters/README.md §8.5
 *
 * 命名規約: `_` prefix で「内部用」を明示。本ディレクトリの公開エントリポイントには含めない。
 *
 * 用途:
 * - ADK `Context` のフル `InvocationContext` 構築は重い (agent / session / pluginManager
 *   全部必要)。adapter が触るのは `agentName` のみのため、最小 mock で十分。
 * - `Object.create(Context.prototype)` + `Object.defineProperty` で標準 JS API のみ
 *   を使い、ADK SDK の internal API には依存しない。
 *
 * 禁止事項 (Nekoさん T2.5 承認):
 * - 本ヘルパーを本番コードから import すること
 * - ADK SDK の internal/private API に依存すること
 */

import { Context } from '@google/adk';

/**
 * テスト専用: `Context` の最小 mock を生成する。
 *
 * adapter が触るのは `agentName` のみのため、それだけ持つ Context を返す。
 *
 * @param options.agentName - `Context.agentName` getter が返す値 (省略時 'test-agent')。
 * @returns `Context` 型として使える mock オブジェクト。
 */
export function createMinimalAdkContext(
  options: { agentName?: string } = {},
): Context {
  const ctx = Object.create(Context.prototype) as Context;
  Object.defineProperty(ctx, 'agentName', {
    value: options.agentName ?? 'test-agent',
    enumerable: true,
  });
  return ctx;
}
