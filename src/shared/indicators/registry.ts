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
 * `support.tsSurrogate`: PR ④F (post-Phase 5A) 以降は **`pythonSeries=true` と
 * 同義** (= TS 側で indicator を再計算しない、analysis-engine `/v1/indicator-series`
 * 経由で取得する)。フィールド自体は registry スキーマ後方互換のため残してある。
 * PR #115 〜 PR #116 期は「TS 側で indicator を計算する」設計だったため独立した
 * フラグだったが、PR ④F で TS 計算経路を撤廃した結果、両者は実質同じ意味になった。
 */

import { readFileSync } from 'fs';
import path from 'path';

import { z } from 'zod';

/**
 * registry.json は canonical 情報源。`data/` サブディレクトリに置くのは
 * registry.ts と同名 (`registry.json` ↔ `registry.ts`) の衝突を避けるため。
 *
 * 同ディレクトリに同名 .ts と .json を置くと、Node の require resolver が
 * 拡張子なし import (`from '../shared/indicators/registry'`) を解決する際
 * `.json` を `.ts` より先に選んでしまうケースがある (CI E2E で
 * `INDICATOR_REGISTRY` が undefined になる事象として顕在化、PR #115)。
 * subfolder に分けることで衝突が起きない構造にする。
 *
 * fs.readFileSync で読むのは ts-node や bundler の JSON resolution 挙動に
 * 依存しないため。本ファイルは server-side / build-time のみで利用する前提
 * (Side-A の API ルート、Side-B の EvolutionLoop 等)。client bundle に
 * 含まれる経路では import しないこと。
 */
const REGISTRY_JSON_PATH = path.join(__dirname, 'data', 'registry.json');

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
  .strict()
  .superRefine((val, ctx) => {
    // PR #115 Copilot review #1 + #2:
    // defaultParams は全体で number | string を許容するが、`validateIndicatorConfig`
    // 等の下流は数値比較を前提とするため、indicator ごとに value 型を厳密化する。
    //   - pivot.pivotType: PivotTypeSchema ('standard' | 'fibonacci' | 'camarilla') のみ
    //   - それ以外の全 indicator / 全 key: 必ず number (period: "14" のような string 数値は弾く)
    for (const [key, value] of Object.entries(val.defaultParams)) {
      if (val.id === 'pivot' && key === 'pivotType') {
        const parsed = PivotTypeSchema.safeParse(value);
        if (!parsed.success) {
          ctx.addIssue({
            code: 'custom',
            path: ['defaultParams', key],
            message: `pivotType は ${PivotTypeSchema.options.join(' / ')} のいずれか`,
          });
        }
        continue;
      }
      if (typeof value !== 'number') {
        ctx.addIssue({
          code: 'custom',
          path: ['defaultParams', key],
          message: `${val.id}.defaultParams.${key} は数値である必要がある (pivot.pivotType を除く)`,
        });
      }
    }
  });
export type IndicatorRegistryEntry = z.infer<typeof IndicatorRegistryEntrySchema>;

/** registry.json ルート。 */
export const IndicatorRegistryFileSchema = z
  .object({
    $comment: z.string().optional(),
    version: z.literal(1),
    indicators: z.array(IndicatorRegistryEntrySchema).min(1),
  })
  .strict();

// JSON.parse の戻り値は any/unknown で危ういので Zod の入力にだけ使い、
// 中間変数を作らずに parse 結果 (型付き) のみ保持する。
const PARSED = IndicatorRegistryFileSchema.parse(
  JSON.parse(readFileSync(REGISTRY_JSON_PATH, 'utf-8')),
);

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

/**
 * PR ④F: id が **analysis-engine (= pandas_ta) で計算可能** な指標か判定。
 *
 * 用途: Side-B 進化ループの `collectDslIndicatorNeeds` で「世代開始時に
 * `/v1/indicator-series` に投げる集合」を絞り込む。adx / supertrend / pivot は
 * Python 側も実装無し (= pythonSeries=false) なので collect しても fetch 結果が
 * 戻らないため、ここで除外する。
 */
export function isPythonSupportedIndicatorId(value: string): value is IndicatorId {
  const entry = INDEX_BY_ID.get(value);
  return entry !== undefined && entry.support.pythonSeries;
}
