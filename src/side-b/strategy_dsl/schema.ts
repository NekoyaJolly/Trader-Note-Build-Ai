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

/** エントリー定義 */
export const EntrySchema = z.object({
  direction: z.enum(['long', 'short']),
  trigger: ConditionGroupSchema,
  orderType: z.enum(['market', 'limit', 'stop']).default('market'),
});

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

/** パラメーター定義 */
export const ParameterDefSchema = z.object({
  range: z.tuple([z.number(), z.number()]),
  default: z.number(),
  type: z.enum(['int', 'float']),
});

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
  parameters: z.record(z.string(), ParameterDefSchema).default({}),
  metadata: z.object({
    createdAt: z.string(),
    createdBy: z.enum(['initial_random', 'mutation', 'crossover', 'llm_generated']),
    description: z.string().optional(),
  }),
});

export type StrategyDSL = z.infer<typeof StrategyDSLSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
