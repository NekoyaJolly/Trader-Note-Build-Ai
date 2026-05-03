/**
 * 戦略 JSON DSL スキーマ（Phase 5）
 *
 * @see docs/design/phase_5_specification.md §4.1
 */

import { z } from 'zod';

/** 比較演算子 */
export const OpSchema = z.enum(['<', '<=', '>', '>=', '==', '!=', 'between', 'in']);

/** パラメーター参照("$p1" のような記法) */
export const ParamRefSchema = z.string().regex(/^\$[a-z][a-z0-9_]*$/);

/** 条件式(レンズ特徴量と値の比較) */
export const ConditionSchema = z.object({
  lens: z.string(),
  feature: z.string(),
  op: OpSchema,
  value: z.union([
    z.number(),
    z.string(),
    z.boolean(),
    ParamRefSchema,
    z.tuple([z.number(), z.number()]),
    z.array(z.union([z.number(), z.string()])),
  ]),
});

/** 条件グループ(AND/OR) */
export type ConditionGroup = {
  logic: 'AND' | 'OR';
  conditions: Array<z.infer<typeof ConditionSchema> | ConditionGroup>;
};

export const ConditionGroupSchema: z.ZodType<ConditionGroup> = z.lazy(() =>
  z.object({
    logic: z.enum(['AND', 'OR']),
    conditions: z.array(z.union([ConditionSchema, ConditionGroupSchema])),
  }),
);

/** 条件木から ohlcv 以外のレンズを列挙（wait_for_trigger 用バリデーション） */
function collectNonOhlcvLensesInGroup(g: ConditionGroup): string[] {
  const out: string[] = [];
  for (const c of g.conditions) {
    if ('logic' in c) {
      out.push(...collectNonOhlcvLensesInGroup(c));
    } else {
      if (c.lens !== 'ohlcv') {
        out.push(`${c.lens}.${c.feature}`);
      }
    }
  }
  return out;
}

/** 即時エントリー（従来・Phase 5） */
export const ImmediateEntrySchema = z.object({
  type: z.literal('immediate').optional(),
  direction: z.enum(['long', 'short']),
  trigger: ConditionGroupSchema,
  orderType: z.enum(['market', 'limit', 'stop']).default('market'),
});

/** トリガー待ち → 次バー始値（Phase 6.7b） */
export const WaitForTriggerEntrySchema = z.object({
  type: z.literal('wait_for_trigger'),
  direction: z.enum(['long', 'short']),
  triggerConditions: ConditionGroupSchema,
  maxWaitBars: z.number().int().min(1),
  executionType: z.enum(['market', 'limit']),
  limitPrice: z.number().optional(),
});

/** エントリー: 従来形と wait_for_trigger の union */
export const EntrySchema = z.union([WaitForTriggerEntrySchema, ImmediateEntrySchema]);

/** ストップロス定義 */
export const StopLossSchema = z.union([
  z.object({ type: z.literal('atr_multiple'), value: z.union([z.number(), ParamRefSchema]) }),
  z.object({ type: z.literal('fixed_pips'), value: z.union([z.number(), ParamRefSchema]) }),
  z.object({ type: z.literal('swing_point'), lookbackBars: z.union([z.number(), ParamRefSchema]) }),
]);

/** テイクプロフィット定義 */
export const TakeProfitSchema = z.union([
  z.object({ type: z.literal('rr_ratio'), value: z.union([z.number(), ParamRefSchema]) }),
  z.object({ type: z.literal('fixed_pips'), value: z.union([z.number(), ParamRefSchema]) }),
  z.object({ type: z.literal('atr_multiple'), value: z.union([z.number(), ParamRefSchema]) }),
]);

/** パラメーター定義 (legacy: range + default + type の structured 形式) */
export const ParameterDefSchema = z.object({
  range: z.tuple([z.number(), z.number()]),
  default: z.number(),
  type: z.enum(['int', 'float']),
});

/** Phase 6.7b: min〜max を step 刻みでスイープ */
export const ParameterRangeV2Schema = z.object({
  kind: z.literal('range'),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  default: z.number(),
});

/**
 * Critical-4 4a-parameters: LLM が直接出す raw 値も許容する。
 * MutationAgent / CrossoverAgent は `parameters: { minImpulse: 0.5 }` のような
 * raw scalar を返すことが多く、structured 定義を強制すると Zod で 9/10 が落ちる。
 *
 * 代わりに Zod は「JSON として表現可能な値」までしか見ない。
 * 意味検証 (= 「`minImpulse` という名前が有効か」「値が想定範囲か」) は
 *   `dslParameterUtils.ts` / `SurrogateFitnessSimulator.ts` /
 *   `dslToBacktestNotePayload.ts` 等の **consumer 側** で行う方針。
 */
export const ParameterValueSchema = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.null(),
]);

/** raw 値の浅いオブジェクト (例: `{ min: 0.5, max: 1.0 }` のような自由構造) */
export const SimpleParameterObjectSchema = z.record(z.string(), ParameterValueSchema);

/**
 * 1 キーに対する parameter 値の許容形:
 *   - structured 形式 (legacy ParameterDef / ParameterRangeV2) → そのまま grid 展開対象
 *   - raw scalar (number / string / boolean / null)            → 単一値として使用
 *   - 浅いオブジェクト                                           → consumer 側で warning
 *
 * Zod 配列の評価順は上記の通り (上から先勝ち)。structured を先に置くことで、
 * legacy DSL は従来通り評価される。
 */
export const ParameterFieldSchema = z.union([
  ParameterDefSchema,
  ParameterRangeV2Schema,
  ParameterValueSchema,
  SimpleParameterObjectSchema,
]);

/** 戦略DSLルート */
export const StrategyDSLSchema = z.object({
  id: z.string(),
  generation: z.number().default(0),
  parentIds: z.array(z.string()).default([]),
  regimeTarget: z.string(),
  symbol: z.string(),
  timeframe: z.string(),
  entry: EntrySchema,
  stopLoss: StopLossSchema,
  takeProfit: TakeProfitSchema,
  parameters: z.record(z.string(), ParameterFieldSchema).default({}),
  metadata: z.object({
    createdAt: z.string(),
    createdBy: z.enum(['initial_random', 'mutation', 'crossover', 'llm_generated']),
    description: z.string().optional(),
  }),
})
  .superRefine((val, ctx) => {
    // Phase 6.7b: wait_for_trigger では BT 可能なレンズのみ（漏洩防止の最低限）
    const ent = val.entry;
    if ('type' in ent && ent.type === 'wait_for_trigger') {
      const bad = collectNonOhlcvLensesInGroup(ent.triggerConditions);
      for (const feat of bad) {
        ctx.addIssue({
          code: 'custom',
          message: `wait_for_trigger の条件に BT 未対応レンズが含まれる: ${feat}`,
          path: ['entry', 'triggerConditions'],
        });
      }
    }
  });

export type StrategyDSL = z.infer<typeof StrategyDSLSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type ParameterField = z.infer<typeof ParameterFieldSchema>;
