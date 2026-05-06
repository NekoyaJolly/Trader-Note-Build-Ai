/**
 * 共通インジケーター registry (PR #115)。
 *
 * `registry.json` を **canonical** な情報源として、Zod で構造を検証 + 型を export する。
 * - Side-A の指標 UI / バリデーション (src/models/indicatorConfig.ts)
 * - Side-B の DSL / mutation prompt 拡張 (PR #116, #117)
 * - analysis-engine 側の対応状況 (`support.pythonSeries`)
 *
 * すべて同じ 23 件の定義を共有するためのハブ。`registry.json` 以外の場所で
 * INDICATOR_METADATA の一覧を独自に書かないこと (= drift 防止)。
 *
 * `support.pythonSeries`: analysis-engine `app/indicators.py:compute_indicator_series`
 * で実装されているか。false の指標は Python 側で評価できない (PR #118+ で順次拡張)。
 *
 * `support.tsSurrogate`: TS surrogate (EvolutionLoop の軽量近似) で
 * 計算されるか。PR #115 段階では全 false、PR #116 で IndicatorService 接続時に
 * 実反映 (= EMA/SMA/RSI/MACD/BB/ATR の subset を true 化予定)。
 */

import { z } from 'zod';

import registryJson from './registry.json';

/** 指標カテゴリ。 */
export const IndicatorCategorySchema = z.enum([
  'momentum',
  'trend',
  'volatility',
  'volume',
  'support_resistance',
]);
export type IndicatorCategory = z.infer<typeof IndicatorCategorySchema>;

/**
 * Pivot 計算方式。`paramConstraints` を緩めに保つため、ここで明示する。
 */
export const PivotTypeSchema = z.enum(['standard', 'fibonacci', 'camarilla']);

/**
 * 23 指標の登録 ID を const tuple で持つ (= 型レベルで string-literal union 化)。
 *
 * canonical は `registry.json` 側だが、JSON 経由では const literal の型推論ができない。
 * Side-A 既存コード (`indicatorProfileService.ts` 等) の `IndicatorId` が string-literal
 * union として機能するためには TS 側にも tuple を持たせる必要がある。
 *
 * 整合性は本ファイル末尾の runtime チェックと `indicatorRegistry.test.ts` で pin。
 */
export const INDICATOR_IDS = [
  'rsi', 'stochastic', 'williamsR', 'roc', 'mfi',
  'sma', 'ema', 'dema', 'tema', 'macd', 'aroon', 'cci', 'psar', 'ichimoku',
  'atr', 'bb', 'kc',
  'obv', 'vwap', 'cmf',
  'adx', 'supertrend', 'pivot',
] as const satisfies readonly string[];

/** 全指標 ID の string-literal union。 */
export type IndicatorId = (typeof INDICATOR_IDS)[number];

/**
 * `defaultParams` の許容値。number / string で十分 (例: pivotType="standard")。
 */
export const IndicatorParamValueSchema = z.union([z.number(), z.string()]);
export type IndicatorParamValue = z.infer<typeof IndicatorParamValueSchema>;

/**
 * `paramConstraints` の許容形。Side-A 既存実装が参照するキーのみ optional 化。
 * 不明キーは許容しない (= 余計な drift 防止)。
 */
export const ParamConstraintsSchema = z
  .object({
    minPeriod: z.number().int().positive().optional(),
    maxPeriod: z.number().int().positive().optional(),
  })
  .strict();
export type ParamConstraints = z.infer<typeof ParamConstraintsSchema>;

/**
 * 各指標の評価器サポート状況。`pythonSeries` は analysis-engine 側、
 * `tsSurrogate` は EvolutionLoop の TS surrogate 側。
 */
export const IndicatorSupportSchema = z
  .object({
    pythonSeries: z.boolean(),
    tsSurrogate: z.boolean(),
  })
  .strict();
export type IndicatorSupport = z.infer<typeof IndicatorSupportSchema>;

/** 1 指標分のメタデータ。 */
export const IndicatorRegistryEntrySchema = z
  .object({
    id: z.enum(INDICATOR_IDS),
    displayName: z.string().min(1),
    category: IndicatorCategorySchema,
    description: z.string().min(1),
    defaultParams: z.record(z.string(), IndicatorParamValueSchema),
    paramConstraints: ParamConstraintsSchema,
    support: IndicatorSupportSchema,
  })
  .strict();
export type IndicatorRegistryEntry = z.infer<typeof IndicatorRegistryEntrySchema>;

/** registry.json ルート。 */
export const IndicatorRegistryFileSchema = z
  .object({
    $comment: z.string().optional(),
    version: z.literal(1),
    indicators: z.array(IndicatorRegistryEntrySchema).min(1),
  })
  .strict();

const PARSED = IndicatorRegistryFileSchema.parse(registryJson);

/** registry を id 重複なく登録。重複はビルド時に検出する。 */
function buildIndexById(entries: readonly IndicatorRegistryEntry[]): Map<string, IndicatorRegistryEntry> {
  const map = new Map<string, IndicatorRegistryEntry>();
  for (const e of entries) {
    if (map.has(e.id)) {
      throw new Error(`indicator registry: 重複した id="${e.id}" が registry.json に存在`);
    }
    map.set(e.id, e);
  }
  return map;
}

const INDEX_BY_ID = buildIndexById(PARSED.indicators);

/**
 * 全指標の不変リスト (登録順)。順序は registry.json の記述順に一致するため、
 * UI のリスト表示やテストで snapshot に使っても良い。
 */
export const INDICATOR_REGISTRY: readonly IndicatorRegistryEntry[] = Object.freeze([...PARSED.indicators]);

/**
 * registry.json の id 集合と TS 側 INDICATOR_IDS tuple が一致することを起動時に検証。
 * drift があるとここで例外を投げ、import 側の TS 型と実データが食い違ったまま動くのを防ぐ。
 */
{
  const jsonIds = PARSED.indicators.map((e) => e.id);
  const tupleIds: readonly string[] = INDICATOR_IDS;
  if (jsonIds.length !== tupleIds.length || jsonIds.some((id, i) => id !== tupleIds[i])) {
    throw new Error(
      `indicator registry: registry.json と INDICATOR_IDS tuple の id 集合 / 順序が不一致。` +
        ` json=${JSON.stringify(jsonIds)} tuple=${JSON.stringify(tupleIds)}`,
    );
  }
}

/** id でメタデータを取得。未登録なら undefined。 */
export function getIndicatorRegistryEntry(id: string): IndicatorRegistryEntry | undefined {
  return INDEX_BY_ID.get(id);
}

/** カテゴリでフィルタ。 */
export function getIndicatorsByCategory(category: IndicatorCategory): IndicatorRegistryEntry[] {
  return INDICATOR_REGISTRY.filter((e) => e.category === category);
}

/** Python 評価器 (analysis-engine) で計算可能な指標一覧。 */
export function getPythonSupportedIndicators(): IndicatorRegistryEntry[] {
  return INDICATOR_REGISTRY.filter((e) => e.support.pythonSeries);
}

/** id が registry に登録された有効な指標 ID か判定する type guard。 */
export function isIndicatorId(value: string): value is IndicatorId {
  return INDEX_BY_ID.has(value);
}
