/**
 * skillContext: ADK Context → 既存 SkillContext へのマッピング
 *
 * Step 1 Ticket T5 で実装。
 * ADK Runner が tool 実行時に渡してくる `Context` オブジェクトから、既存 Side-B
 * `SkillContext` (改変不可) を構築する。
 *
 * 対応する既存実装: `src/side-b/skills/types.ts` の `SkillContext`
 * ADK 化の目的: ADK Runner 経由で SkillRegistry を再利用するためのコンテキスト変換
 *
 * 設計書: /src/side-b/adk/adapters/README.md §3
 *
 * マッピング (T2.5 実測 + Nekoさん T2.5 承認):
 * | SkillContext field | ADK 取得元                                          |
 * |--------------------|----------------------------------------------------|
 * | `callerAgent`      | `Context.agentName` (ReadonlyContext getter)        |
 * | `callerReason`     | adapter 側定数 `ADK_DEFAULT_CALLER_REASON` (ADK 標準に存在しない) |
 * | `timestamp`        | `new Date()` (ADK 標準に存在しない、呼び出し時刻として生成)        |
 *
 * フォールバック (Context が undefined または agentName が空文字の場合):
 * - `callerAgent` → `ADK_DEFAULT_CALLER_AGENT = 'adk-runner'`
 *
 * 依存方向: adk → 既存 (skills/types.ts) のみ。逆向きは禁止 (AGENTS.md)
 */

import type { Context } from '@google/adk';
import type { SkillContext } from '../../skills/types';

// ============================================================================
// adapter 側定数 (T2.5 確定)
// ============================================================================

/**
 * `callerReason` フォールバック値。
 *
 * ADK 標準 `Context` には呼び出し理由を伝えるフィールドが存在しないため、adapter
 * 経由の呼び出しを示す固定文字列を埋める。トレース時にこの値が見えれば「ADK Runner
 * 経由で呼ばれた」と即座に判別できる。
 *
 * 既存 `SkillContext.callerReason?: string` は optional のため、フォールバック値を
 * 埋めるだけで型不整合は発生しない (= 既存型は無改変)。
 */
export const ADK_DEFAULT_CALLER_REASON = 'invoked-via-adk-runner';

/**
 * `callerAgent` フォールバック値。
 *
 * `Context.agentName` が空文字を返す/未定義のケースに備えるデフォルト値。実運用では
 * ADK Runner が常に agentName を設定するため通常は使用されないが、テストやエッジ
 * ケースで備えておく。
 */
export const ADK_DEFAULT_CALLER_AGENT = 'adk-runner';

// ============================================================================
// マッピング関数
// ============================================================================

/**
 * ADK `Context` (または undefined) を既存 `SkillContext` に変換する。
 *
 * - `ctx` が `undefined` の場合: テスト等で Context を渡せないケース。すべて
 *   フォールバック値で SkillContext を構築。
 * - `ctx.agentName` が空文字: フォールバック値 `ADK_DEFAULT_CALLER_AGENT` を使う。
 * - `ctx.agentName` が文字列: そのまま `callerAgent` に入れる。
 *
 * 既存 `SkillContext` 型は無改変。`callerAgent?` / `callerReason?` は optional の
 * ままで、フォールバック値を埋めるだけ。
 *
 * @param ctx ADK Context (Runner 経由ならインスタンス、テストでは undefined OK)。
 * @returns 既存 SkillContext (timestamp は呼び出し時刻)。
 */
export function toSkillContext(ctx: Context | undefined): SkillContext {
  // adapter が触るのは agentName のみ。他フィールド (invocationId / userId / sessionId
  // 等) は将来 Step 2 (Tracing 統合) で活用予定。今は触らない。
  const agentName = ctx?.agentName;
  const callerAgent =
    typeof agentName === 'string' && agentName.length > 0
      ? agentName
      : ADK_DEFAULT_CALLER_AGENT;

  return {
    callerAgent,
    callerReason: ADK_DEFAULT_CALLER_REASON,
    timestamp: new Date(),
  };
}
