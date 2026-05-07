/**
 * 戦略 JSON DSL スキーマ（Phase 5）
 *
 * @see docs/design/phase_5_specification.md §4.1
 */

import { z } from 'zod';

/**
 * 比較演算子。
 *
 * post-Phase 5A 拡張 (PR ①-B): Side-A 戦略表現力 (`strategyConditionEvaluator`) と
 * 揃えるため、状態変化系 (`cross_above` / `cross_below`) と Touch 系
 * (`touch_close` / `touch_wick`) と boolean 系 (`is_true` / `is_false`) を追加。
 * 評価本体は `src/shared/strategy-evaluator/operators.ts` の `compareValues` に
 * 委譲する (= Side-A / Side-B で評価結果が必ず一致する drift 防止)。
 */
export const OpSchema = z.enum([
  '<',
  '<=',
  '>',
  '>=',
  '==',
  '!=',
  'between',
  'in',
  // PR ①-B: 状態遷移系 (= 前バー snapshot 必要)
  'cross_above',
  'cross_below',
  // PR ①-B: タッチ系
  'touch_close',
  'touch_wick',
  // PR ①-B: boolean 評価系 (= pattern lens の is_true / is_false に使う)
  'is_true',
  'is_false',
]);

/** パラメーター参照("$p1" のような記法) */
export const ParamRefSchema = z.string().regex(/^\$[a-z][a-z0-9_]*$/);

/**
 * 条件式の値型 (literal / ParamRef / range / set)。
 * 後方互換のため Phase 5 既存の表現は全て継続して通す。
 */
export const ConditionValueSchema = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  ParamRefSchema,
  z.tuple([z.number(), z.number()]),
  z.array(z.union([z.number(), z.string()])),
]);
export type ConditionValue = z.infer<typeof ConditionValueSchema>;

/**
 * 期間系パラメータキーの集合。
 *
 * これらは indicator 計算側 (TS `IndicatorService.calculate*` / Python `compute_indicator_series`)
 * で int として扱われる (例: `length=int(params.get('period', 14))`)。
 *
 * PR #120 Copilot review #3-#4-#7: 非整数 (例: `period: 20.5`) を許容すると、
 * snapshot key (`period=20.5`) と実計算 (`length=20`) が **不一致** になり、
 * 評価器が series を引けず leaf が常に false 評価になる。schema レベルで
 * 整数 + 正値を強制して入力時点で弾く。
 */
export const INTEGER_PARAM_KEYS = new Set([
  'period',
  'fastPeriod',
  'slowPeriod',
  'signalPeriod',
  'kPeriod',
  'dPeriod',
  'lookbackBars',
  'displacement',
  'spanBPeriod',
  'basePeriod',
  'conversionPeriod',
]);

/**
 * Indicator パラメータ (PR #116a で追加)。
 *
 * 動的パラメータを持つ feature (ema, sma, rsi, macd 等) の場合、period や
 * fastPeriod などをここに格納する。snapshot key はこれを安定 JSON に正規化して
 * `lens.feature(stable_params)` で一意特定する (`buildSnapshotKey` 参照)。
 *
 * v1 では数値パラメータのみ受け付ける。pivot.pivotType のような string は
 * 必要になった時点で拡張する (PR #118+ 想定)。
 *
 * PR #116a Copilot review #2: `z.number()` だけだと `Infinity` / `NaN` が通って
 * 後段の `formatStableNumber` (snapshotKey 構築) で例外になる。`finite()` で
 * parse 時点で弾く (= invalid 入力は DSL Schema レベルで早期検出)。
 *
 * PR #120 Copilot review #3: `INTEGER_PARAM_KEYS` に列挙された期間系キーは
 * **正の整数** であることを `superRefine` で強制 (= TS と Python で snapshot key
 * と実計算が一致するよう保証)。
 */
export const ConditionParamsSchema = z
  .record(z.string(), z.number().finite())
  .superRefine((val, ctx) => {
    for (const [key, value] of Object.entries(val)) {
      if (INTEGER_PARAM_KEYS.has(key)) {
        if (!Number.isInteger(value)) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} は整数である必要がある (got: ${value})`,
          });
        } else if (value <= 0) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} は正の値である必要がある (got: ${value})`,
          });
        }
      }
    }
  });
export type ConditionParams = z.infer<typeof ConditionParamsSchema>;

/**
 * Indicator operand (PR #116a で追加)。
 *
 * `value` の代わりに比較対象として「別の indicator series」を指定するための型。
 * 例えば `close > ema(20)` は `compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 20 } }`
 * で表現する。
 *
 * 評価器側の対応は PR #116b (TS surrogate) / PR #116c (Python) で順次行うため、
 * v1 (= PR #116a) では schema レベルで受け入れ可能にするのみ。既存評価器は
 * compareTarget を持つ leaf を評価できないので、入力 DSL に出てくると
 * `false` 扱いになる (= 既存挙動と同じ「対応していない条件は false」)。
 */
export const IndicatorOperandSchema = z.object({
  lens: z.string(),
  feature: z.string(),
  params: ConditionParamsSchema.optional(),
});
export type IndicatorOperand = z.infer<typeof IndicatorOperandSchema>;

/**
 * 条件式 (レンズ特徴量と値の比較)。
 *
 * v1 (= PR #116a 以前): `value` で literal / ParamRef / range / set と比較
 * v2 (= PR #116a 以降):
 *   - `params` で動的 indicator パラメータを指定 (snapshot key の正規化用)
 *   - `compareTarget` で別 indicator series との比較が可能 (value の排他的代替)
 *
 * 後方互換: `params` / `compareTarget` 双方 optional。既存 DSL は無変更で通る。
 *
 * superRefine 制約:
 *   - `value` と `compareTarget` はちょうど一方だけ指定する (排他、両方 / どちらも無し は不可)
 */
/**
 * 数学的に常時 true / false な leaf を弾く判定 (post-Phase 5A 汚染防止)。
 *
 * 本番 smoke で `close > 0` / `volume > -1` 等の trivial 条件が StrategyPopulation
 * に残り続け、mutation がそれを継承して再生産する汚染を観測したため schema レベル
 * で弾く。LLM 出力 / DB 永続化の両方を防ぐ。
 *
 * 弾く対象 (ohlcv lens のみ):
 *   - open/high/low/close: 価格は通常正なので `> ≤0` / `>= ≤0` は常時 true、
 *     `< ≤0` / `<= ≤0` は常時 false
 *   - volume: 出来高は >= 0 なので `> <0` / `>= <0` は常時 true、
 *     `< <0` / `<= <0` は常時 false
 *
 * 注: 価格が負値になる商品 (歴史的原油先物等) は対象外。本プロジェクトは forex 中心
 * のため価格 > 0 を前提として判定。RSI/ATR は範囲が複雑 (0-100 / 0+) で「常時 true」
 * の境界が曖昧なため本判定では対象外 (= 別の品質チェックに委ねる)。
 */
const TRIVIAL_PRICE_FEATURES = new Set(['open', 'high', 'low', 'close']);
const TRIVIAL_NONNEG_FEATURES = new Set(['volume']);

function detectTriviallyAlwaysTrueOrFalse(c: {
  lens: string;
  feature: string;
  op: string;
  value?: ConditionValue;
}): string | null {
  if (c.lens !== 'ohlcv') return null;
  if (typeof c.value !== 'number') return null;

  const isPriceFeature = TRIVIAL_PRICE_FEATURES.has(c.feature);
  const isNonNegFeature = TRIVIAL_NONNEG_FEATURES.has(c.feature);
  if (!isPriceFeature && !isNonNegFeature) return null;

  if (isPriceFeature) {
    if ((c.op === '>' || c.op === '>=') && c.value <= 0) {
      return `${c.feature} ${c.op} ${c.value} は常時 true (価格 > 0 前提)`;
    }
    if ((c.op === '<' || c.op === '<=') && c.value <= 0) {
      return `${c.feature} ${c.op} ${c.value} は常時 false (価格 > 0 前提)`;
    }
  }
  if (isNonNegFeature) {
    if ((c.op === '>' || c.op === '>=') && c.value < 0) {
      return `${c.feature} ${c.op} ${c.value} は常時 true (volume >= 0 前提)`;
    }
    if ((c.op === '<' || c.op === '<=') && c.value < 0) {
      return `${c.feature} ${c.op} ${c.value} は常時 false (volume >= 0 前提)`;
    }
  }
  return null;
}

export const ConditionSchema = z
  .object({
    lens: z.string(),
    feature: z.string(),
    op: OpSchema,
    value: ConditionValueSchema.optional(),
    params: ConditionParamsSchema.optional(),
    compareTarget: IndicatorOperandSchema.optional(),
  })
  .superRefine((val, ctx) => {
    // PR ①-B: is_true / is_false は left を Boolean 評価するだけで value/compareTarget は不要
    // (例: pattern lens の `pinbar_bull is_true`)。排他性検証もスキップ。
    if (val.op === 'is_true' || val.op === 'is_false') {
      // 念のため value/compareTarget が指定されていてもエラーにはしない (= 互換)。
      // ただし trivial 弾きは数値 op 用なので、is_true/is_false は対象外。
      return;
    }
    const hasValue = val.value !== undefined;
    const hasTarget = val.compareTarget !== undefined;
    if (!hasValue && !hasTarget) {
      ctx.addIssue({
        code: 'custom',
        message: '条件式は value または compareTarget のどちらかを指定する必要がある',
      });
      return;
    }
    if (hasValue && hasTarget) {
      ctx.addIssue({
        code: 'custom',
        message: '条件式に value と compareTarget を同時指定することはできない (排他)',
      });
      return;
    }
    // post-Phase 5A: 数学的に常時 true / false な leaf を弾く (mutation 汚染防止)
    const trivialMessage = detectTriviallyAlwaysTrueOrFalse(val);
    if (trivialMessage !== null) {
      ctx.addIssue({
        code: 'custom',
        message: `数学的に常時 true / false な条件は不可: ${trivialMessage}`,
      });
    }
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
