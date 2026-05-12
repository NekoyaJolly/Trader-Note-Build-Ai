/**
 * ADK SDK 動作確認用 smoke test (Step 1 Ticket T1)
 *
 * @google/adk@1.1.0 が正常に import できることを確認する**使い捨て**スクリプト。
 * Phase 2 Ticket T8 で削除予定。
 *
 * 確認内容:
 * - `@google/adk` モジュールが import 可能
 * - `FunctionTool` クラスが存在する
 * - 簡単な FunctionTool インスタンスを作成して `.name` が取得できる
 *
 * 実行: `npx tsx scripts/adk_smoke_test.ts`
 */

import { FunctionTool } from '@google/adk';

const tool = new FunctionTool({
  name: 'smoke_test_tool',
  description: 'Step 1 T1 smoke test: SDK が動作することを確認するだけのダミーツール',
  fn: ({ x }: { x: number }): { result: number } => {
    return { result: x * 2 };
  },
});

console.log(`[ADK smoke test] FunctionTool 作成成功: name="${tool.name}"`);
console.log('[ADK smoke test] OK — @google/adk が正常に動作しています');
