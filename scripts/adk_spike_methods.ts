/**
 * ADK FunctionTool 3 方式検証スパイク (T2.5)
 *
 * `@google/adk@1.1.0` の FunctionTool に対して、parameters 渡し方の 3 方式
 * (A: Schema, B: Zod, C: parameters なし) を実コードで動作確認する。
 *
 * 検証結果は scripts/adk_spike_typedefs.md と /src/side-b/adk/adapters/README.md
 * §4 に反映する。
 *
 * 削除予定: Phase 2 / Ticket T8 (使い捨てファイル)
 *
 * 実行: npx tsx scripts/adk_spike_methods.ts
 */

import { FunctionTool } from '@google/adk';
import { Type, type Schema } from '@google/genai';
import { z } from 'zod';

// ============================================================================
// 方式 A: Schema (from @google/genai) を渡す
// ============================================================================

console.log('\n=== 方式 A: Schema を渡す ===');

const schemaA: Schema = {
  type: Type.OBJECT,
  properties: {
    symbol: { type: Type.STRING, description: '通貨ペア (例: XAU/USD)' },
    timeframe: { type: Type.STRING, description: '時間足 (例: 15m)' },
  },
  required: ['symbol'],
};

const toolA = new FunctionTool({
  name: 'method_a_tool',
  description: '方式 A: ADK Schema を parameters に渡すパターン',
  parameters: schemaA,
  execute: async (input: unknown) => {
    return { method: 'A', input };
  },
});

console.log(`  ✅ 方式 A: コンパイル OK / name=${toolA.name}`);

// ============================================================================
// 方式 B: Zod を渡す
// ============================================================================

console.log('\n=== 方式 B: Zod を渡す ===');

const schemaB = z.object({
  symbol: z.string().describe('通貨ペア (例: XAU/USD)'),
  timeframe: z.string().optional().describe('時間足 (例: 15m)'),
});

const toolB = new FunctionTool({
  name: 'method_b_tool',
  description: '方式 B: Zod を parameters に渡すパターン (ADK が自動 validation)',
  parameters: schemaB,
  execute: async (input) => {
    // ADK が input を Zod parse 済みの状態で渡してくれる
    return { method: 'B', symbol: input.symbol, timeframe: input.timeframe };
  },
});

console.log(`  ✅ 方式 B: コンパイル OK / name=${toolB.name}`);
console.log('  (input は z.infer 結果として型付け済み = 方式 A より型安全)');

// ============================================================================
// 方式 C: parameters なし (実行時 validation を execute 内で行う)
// ============================================================================

console.log('\n=== 方式 C: parameters なし ===');

const toolC = new FunctionTool({
  name: 'method_c_tool',
  description: '方式 C: parameters を渡さず、execute 内で Zod parse',
  // parameters なし (= undefined)
  execute: async (input: unknown) => {
    // execute 内で Zod parse する想定
    const parsed = z.object({ symbol: z.string() }).parse(input);
    return { method: 'C', symbol: parsed.symbol };
  },
});

console.log(`  ✅ 方式 C: コンパイル OK / name=${toolC.name}`);
console.log('  (ADK 側の自動 validation なし = LLM 不正引数の検出が後ろ倒し)');

// ============================================================================
// 採用方式: B (Zod) — 理由は adk_spike_typedefs.md §2.§4 参照
// ============================================================================

console.log('\n=== T2.5 結論 ===');
console.log('採用方式: B (Zod)');
console.log('理由:');
console.log('  - ADK の parameters 型が z3/z4 ZodObject を直接受ける (= ネイティブ対応)');
console.log('  - ADK が parameters.parse(req.args) で自動 validation を行う');
console.log('  - input が z.infer 結果として型付けされる (型安全)');
console.log('  - 方式 A (Schema) は @google/genai 型からの変換が必要で複雑');
console.log('  - 方式 C (parameters なし) は LLM 不正引数の検出が遅れる');
console.log('\n→ T3 (jsonSchemaToZod ユーティリティ) を実装する');
console.log('\n[ADK spike] 完了');
