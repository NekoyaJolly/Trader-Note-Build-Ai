/**
 * 共通 pattern registry (PR ②-2)。
 *
 * `data/patternRegistry.json` を **canonical** な情報源として、Zod で構造を検証
 * + 型を export する。
 *
 * 用途:
 * - Side-B mutation / crossover prompt の `{{PATTERN_METADATA_TABLE}}` macro で
 *   LLM に pattern の語彙 (= 12 種の意味 / 用法) を渡す
 * - 実装式は `src/shared/patterns/index.ts` (TS 真実) と
 *   `analysis-engine/app/indicators.py` (Python 真実、本格 BT) が保持
 *
 * 同ディレクトリの `index.ts` (= 判定式) と `data/patternRegistry.json` (= metadata)
 * は **役割分離**: 式の更新は `index.ts`、metadata の更新は `data/patternRegistry.json`。
 *
 * registry.json を `data/` サブディレクトリに置く理由は indicator registry と
 * 同じ (= ts-node の .ts/.json 同名衝突回避、PR #115 の経験)。
 */

import { readFileSync } from 'fs';
import path from 'path';

import { z } from 'zod';

import { ALL_CANDLE_PATTERN_IDS, type CandlePatternId } from './index';

const REGISTRY_JSON_PATH = path.join(__dirname, 'data', 'patternRegistry.json');

/**
 * pattern カテゴリ。`reversal` (反転) / `continuation` (継続) /
 * `indecision` (迷い) の 3 種。LLM が戦略の意図を表現するときの語彙。
 */
export const PatternCategorySchema = z.enum(['reversal', 'continuation', 'indecision']);
export type PatternCategory = z.infer<typeof PatternCategorySchema>;

/** 1 pattern 分のメタデータ。 */
export const PatternRegistryEntrySchema = z
  .object({
    /** patternId は `index.ts` の `CandlePatternId` と必ず一致する。 */
    id: z.enum(ALL_CANDLE_PATTERN_IDS as readonly [CandlePatternId, ...CandlePatternId[]]),
    displayName: z.string().min(1),
    category: PatternCategorySchema,
    /** 形状定義 (LLM に「何が pattern か」を伝える) */
    shape: z.string().min(1),
    /** トレード文脈 (= いつ / なぜ使うか) */
    tradeContext: z.string().min(1),
    /** 戦略 DSL での使い方の例 (LLM が即座に組み立てに使える文字列) */
    usageExamples: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type PatternRegistryEntry = z.infer<typeof PatternRegistryEntrySchema>;

export const PatternRegistryFileSchema = z
  .object({
    $comment: z.string().optional(),
    version: z.literal(1),
    patterns: z.array(PatternRegistryEntrySchema).min(1),
  })
  .strict();

const PARSED = PatternRegistryFileSchema.parse(
  JSON.parse(readFileSync(REGISTRY_JSON_PATH, 'utf-8')),
);

function buildIndexById(
  entries: readonly PatternRegistryEntry[],
): Map<string, PatternRegistryEntry> {
  // PR ②-2 Copilot review #2: Map のキー型を string にする (= indicator registry
  // と同じ流儀)。`getPatternRegistryEntry(id: string)` で型アサーション (`as
  // CandlePatternId`) を不要にするため。CandlePatternId は ALL_CANDLE_PATTERN_IDS
  // tuple との整合チェック (本ファイル末尾) で別途担保される。
  const map = new Map<string, PatternRegistryEntry>();
  for (const e of entries) {
    if (map.has(e.id)) {
      throw new Error(`pattern registry: 重複した id="${e.id}" が patternRegistry.json に存在`);
    }
    map.set(e.id, e);
  }
  return map;
}

const INDEX_BY_ID = buildIndexById(PARSED.patterns);

/**
 * 全 pattern の不変リスト (登録順)。順序は patternRegistry.json の記述順に一致する。
 */
export const PATTERN_REGISTRY: readonly PatternRegistryEntry[] = Object.freeze([
  ...PARSED.patterns,
]);

/**
 * patternRegistry.json の id 集合と TS 側 ALL_CANDLE_PATTERN_IDS が一致することを
 * 起動時に検証。drift があるとここで例外を投げる。
 */
{
  const jsonIds = PARSED.patterns.map((e) => e.id);
  const tupleIds: readonly string[] = ALL_CANDLE_PATTERN_IDS;
  if (
    jsonIds.length !== tupleIds.length ||
    jsonIds.some((id, i) => id !== tupleIds[i])
  ) {
    throw new Error(
      `pattern registry: patternRegistry.json と ALL_CANDLE_PATTERN_IDS の id 集合 / 順序が不一致。` +
        ` json=${JSON.stringify(jsonIds)} tuple=${JSON.stringify(tupleIds)}`,
    );
  }
}

/** id でメタデータを取得。未登録なら undefined。 */
export function getPatternRegistryEntry(id: string): PatternRegistryEntry | undefined {
  return INDEX_BY_ID.get(id);
}

/** category でフィルタ。 */
export function getPatternsByCategory(category: PatternCategory): PatternRegistryEntry[] {
  return PATTERN_REGISTRY.filter((e) => e.category === category);
}
