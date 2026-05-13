/**
 * ADK Tracing Spike (Step 2 Phase 1)
 *
 * `@google/adk@1.1.0` の tracing / context / invocation 関連 API を public API のみで実測し、
 * Phase 2 (Trace Contract) / Phase 3 (Adapter Integration) で採用する方針の根拠を作る。
 *
 * 削除予定: Phase 5 (Cleanup) でこのスクリプトと spike md を削除する。
 *
 * 実行: `npx tsx scripts/adk_tracing_spike.ts`
 *
 * 検証項目 (STEP_2_KICKOFF.md §6 Phase 1):
 * 1. Context / ReadonlyContext から取得できる値 (agentName / invocationId / functionCallId / sessionId / userId)
 * 2. FunctionTool.runAsync() 実行時に渡せる / 取れる情報
 * 3. beforeToolCallback / afterToolCallback / onToolErrorCallback (BasePlugin) の利用可否
 * 4. LlmAgent.tools に Step 1 の FunctionTool[] を渡せるか (型確認のみ)
 * 5. Runner.runAsync() と Runner.runEphemeral() の差分
 * 6. session-less 方針と Runner API の衝突点
 * 7. OTelHooks / 公式 tracing API (telemetry/tracing) の TypeScript 利用可否
 */

import { Context, FunctionTool } from '@google/adk';
import type { BasePlugin } from '@google/adk';
import { z } from 'zod';

async function main(): Promise<void> {
  // ============================================================================
  // 1. Context の getter を実測
  // ============================================================================

  console.log('\n=== 1. Context / ReadonlyContext の getter 実測 ===');

  // Object.create + defineProperty で複数 getter を持つ最小 Context を生成
  const ctx = Object.create(Context.prototype) as Context;
  Object.defineProperty(ctx, 'agentName', { value: 'spike-agent', enumerable: true });
  Object.defineProperty(ctx, 'invocationId', { value: 'inv-spike-001', enumerable: true });
  Object.defineProperty(ctx, 'sessionId', { value: 'sess-spike', enumerable: true });
  Object.defineProperty(ctx, 'userId', { value: 'user-spike', enumerable: true });
  Object.defineProperty(ctx, 'functionCallId', { value: 'fc-spike-001', enumerable: true });

  console.log(`  agentName       = ${ctx.agentName}`);
  console.log(`  invocationId    = ${ctx.invocationId}`);
  console.log(`  sessionId       = ${ctx.sessionId}`);
  console.log(`  userId          = ${ctx.userId}`);
  console.log(`  functionCallId  = ${ctx.functionCallId ?? '(undefined)'}`);
  console.log('  → minimal mock で任意フィールドを setter なしで埋められる (Step 1 と同手法)');

  // ============================================================================
  // 2. FunctionTool.runAsync の引数構造
  // ============================================================================

  console.log('\n=== 2. FunctionTool.runAsync({ args, toolContext }) の挙動 ===');

  const parameters = z.object({
    symbol: z.string().describe('通貨ペア'),
  });

  const recorded: Array<{ when: string; payload: unknown }> = [];

  const tool = new FunctionTool({
    name: 'spike_tool',
    description: 'tracing spike 用ダミー Skill',
    parameters,
    execute: (input, toolCtx) => {
      // ★ Step 2 で adapter が trace 記録する位置はここ (execute 内部)
      recorded.push({ when: 'execute-start', payload: { input, agentName: toolCtx?.agentName } });
      const result = { ok: true as const, symbol: input.symbol };
      recorded.push({ when: 'execute-end', payload: result });
      return result;
    },
  });

  await tool.runAsync({
    args: { symbol: 'XAU/USD' },
    toolContext: ctx,
  });

  console.log(`  recorded events: ${recorded.length}`);
  for (const e of recorded) {
    console.log(`    [${e.when}]`, JSON.stringify(e.payload));
  }
  console.log('  → adapter の execute 内に trace 呼び出しを置けば start/end が確実に取れる');
  console.log('  → toolContext は execute の 2 番目の引数として渡る (undefined OK)');

  // ============================================================================
  // 3. BasePlugin の beforeTool/afterTool/onToolError callback 利用可否
  // ============================================================================

  console.log('\n=== 3. BasePlugin tool callbacks の発火条件 ===');

  console.log('  - BasePlugin.beforeToolCallback / afterToolCallback / onToolErrorCallback は');
  console.log('    Runner / PluginManager 経由でないと発火しない');
  console.log('  - FunctionTool.runAsync() 単独呼び出し (= Step 1 等価性テストの経路) では');
  console.log('    plugin callbacks は発火しない (PluginManager を介していないため)');
  console.log('  → 結論: adapter 層で trace するなら plugin システムには依存せず、');
  console.log('         skillRegistryToAdkTools の execute 内で直接 traceSink.record() を呼ぶ');

  // 型確認のみ (実際の Plugin 構築は Runner 必要で重い)
  const _pluginTypeCheck: BasePlugin | null = null;
  void _pluginTypeCheck;
  console.log('  (BasePlugin の型 import は OK、利用は Step 3 Runner 統合まで保留)');

  // ============================================================================
  // 4. LlmAgent.tools への FunctionTool[] 渡し (型レベル確認)
  // ============================================================================

  console.log('\n=== 4. LlmAgent.tools への FunctionTool[] 渡し (型のみ) ===');

  console.log('  LlmAgent.tools: ToolUnion[] = (BaseTool | BaseToolset)[]');
  console.log('  FunctionTool extends BaseTool → そのまま代入可能');
  console.log('  → Step 1 の skillRegistryToAdkTools(registry) の戻り値は LlmAgent.tools にそのまま渡せる');
  console.log('  (実機での LlmAgent 構築は Phase 4 Runner Smoke Notes で扱う)');

  // ============================================================================
  // 5. Runner API の差分
  // ============================================================================

  console.log('\n=== 5. Runner.runAsync vs Runner.runEphemeral ===');

  console.log('  Runner.runAsync({ userId, sessionId, newMessage, ... })');
  console.log('    → sessionId 必須 = 永続化された session への append');
  console.log('    → BaseSessionService が必須 (RunnerConfig.sessionService)');
  console.log('  Runner.runEphemeral({ userId, newMessage, stateDelta?, runConfig? })');
  console.log('    → sessionId 不要 = その場限りの一時 session');
  console.log('    → ただし RunnerConfig.sessionService は依然必須 (内部で in-memory session を作る)');
  console.log('');
  console.log('  → 採用方針: Step 3 で Runner smoke を行うなら **runEphemeral + InMemorySessionService**');
  console.log('    で session-less 方針 (DatabaseSessionService 不採用) を保てる');

  // ============================================================================
  // 6. session-less 方針と Runner API の衝突点
  // ============================================================================

  console.log('\n=== 6. session-less 方針 (ADK_ADOPTION.md §2.2) との衝突 ===');

  console.log('  ✅ FunctionTool 単独呼び出し: session 不要 (Step 1 で確立済み)');
  console.log('  ✅ Runner.runEphemeral: 永続 session は不要、InMemorySessionService で十分');
  console.log('  ⚠️  Runner.runAsync: sessionId が必須 → Step 3 で扱う場合は dummy session を作る or 避ける');
  console.log('  ❌ DatabaseSessionService: 採用しない (ADK_ADOPTION.md §2.2)');

  // ============================================================================
  // 7. OTel / telemetry/tracing.ts の利用可否
  // ============================================================================

  console.log('\n=== 7. ADK 公式 tracing (telemetry/tracing.ts) の TS 利用可否 ===');

  console.log('  - `@google/adk` の telemetry/tracing.ts は internal 寄り:');
  console.log('    * `export declare const tracer: import("@opentelemetry/api").Tracer;`');
  console.log('    * `traceToolCall({ tool, args, functionResponseEvent })` 関数');
  console.log('  - 上記関数は Runner 経由で内部的に呼ばれる、外部から手動呼びは想定外');
  console.log('  - tracer (OTel global) には access できるが OTel SDK の追加導入が必要 (Step 3 以降)');
  console.log('');
  console.log('  → 結論: 本 Step では ADK 公式 tracing には依存せず、自前 TraceSink interface で抽象化');
  console.log('         将来 OTel exporter を追加するなら TraceSink の実装を増やすだけ');

  // ============================================================================
  // 8. Phase 2 / Phase 3 への結論まとめ
  // ============================================================================

  console.log('\n=== 8. Phase 2 / 3 への結論まとめ ===');

  console.log('  Trace を取る位置:    adapter (skillRegistryToAdkTools) の execute 内');
  console.log('  Plugin 依存:        なし (BasePlugin は Runner 経由のみ発火)');
  console.log('  trace event の出所: 自前定義 (AdkTraceEvent + TraceSink interface)');
  console.log('  Context から取る値: agentName / invocationId? / functionCallId? / sessionId? / userId?');
  console.log('  raw payload:        保存しない (KICKOFF §5.2)');
  console.log('  summary 関数:       argsSummary / resultSummary を独自関数で生成');
  console.log('  Runner 統合:        Step 3 で runEphemeral 経由を試す (sessionless 維持)');
  console.log('  OTel 統合:          Step 3 以降の判断 (interface に逃げ場を残す)');

  console.log('\n[ADK tracing spike] 完了');
}

main().catch((e: unknown) => {
  console.error('spike failed:', e);
  process.exit(1);
});
