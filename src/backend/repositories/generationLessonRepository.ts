/**
 * Filter Evolution Phase D-1a (2026-05-09): GenerationLesson Repository
 *
 * 世代単位 reflection lessons (= GenerationReflectionAgent が Phase D-1b 以降に出す) を
 * `GenerationLesson` テーブルに保存し、後続世代の mutation/crossover prompt に流す経路の下層。
 *
 * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.1 / §5.D
 *
 * 設計方針:
 * - lesson は LLM 出力なので Zod 厳密検証 (= 不正値で AgentMemory が壊れない)
 * - retention は本 repo では `deleteOlderThan` を提供するのみ (= 呼び出しは別 cron job)
 * - findRecentByRegime は AgentMemory.getGenerationLessons() の主データソース
 */

import type { GenerationLesson } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../db/client';
import { toPrismaJsonValue } from '../../utils/prismaJson';
import type { JsonValue } from '../../utils/jsonValue';

/**
 * GenerationReflectionAgent が出すカテゴリの Zod 列挙 (= 設計書 §5.D.1)。
 *
 * 値の追加時は `GenerationReflectionAgent` の prompt 側 (Phase D-1b) も同期更新する。
 */
export const GenerationLessonCategorySchema = z.enum([
  'breakthrough',
  'stagnation',
  'mutation_decay',
  'novelty_emerged',
  'regime_shift_detected',
  'filter_efficacy_increased',
  // 想定外カテゴリの fallback (= LLM が新カテゴリを出した場合の受け皿)
  'other',
]);
export type GenerationLessonCategory = z.infer<typeof GenerationLessonCategorySchema>;

// PR #144 Copilot review #1: GenerationLessonMetricsSchema を定義していたが
// `create` / `toRecord` で実際には使っておらず死蔵していた。Phase D-1a の段階では
// LLM 出力 (= Phase D-1b で来る) の metrics 検証は意味薄いので、Zod schema は削除して
// JsonValue ベースの型表現に統一する。Phase D-1b で必要になれば再導入。

/**
 * insert に使う最低限の入力。`metrics` / `confidence` は optional。
 * `recordedAt` は DB 既定値 (= now) を使うため insert 時には渡さない。
 */
export interface GenerationLessonInsertData {
  evolutionRunId: string;
  regime: string;
  generation: number;
  category: GenerationLessonCategory;
  lesson: string;
  /** supporting metrics (= dsr / lift 等の数値根拠)、未指定なら null */
  metrics?: { readonly [key: string]: JsonValue | undefined };
  /** LLM が報告した confidence (0.0-1.0)、未報告時 undefined */
  confidence?: number;
}

/**
 * findRecentByRegime / findById の戻り値で使う読み出し型。
 *
 * Prisma の `GenerationLesson` をそのまま使うと `metrics: Prisma.JsonValue | null` で
 * narrow が必要になるため、構造的型として外部に公開する。
 */
export interface GenerationLessonRecord {
  id: string;
  evolutionRunId: string;
  regime: string;
  generation: number;
  category: GenerationLessonCategory;
  lesson: string;
  metrics: { readonly [key: string]: JsonValue | undefined } | null;
  confidence: number | null;
  recordedAt: Date;
}

/**
 * EvolutionLoop / AgentMemory が repo に求める最小契約。
 * `null` injection / DI 用に Pick 経由で公開する。
 */
export type GenerationLessonPersister = Pick<
  GenerationLessonRepository,
  'create' | 'findRecentByRegime' | 'deleteOlderThan'
>;

/** Prisma 行を `GenerationLessonRecord` に変換する。category Zod 不適合は 'other' fallback。 */
function toRecord(row: GenerationLesson): GenerationLessonRecord {
  const cat = GenerationLessonCategorySchema.safeParse(row.category);
  // Prisma.JsonValue を JsonObject に narrow。配列 / プリミティブは null 扱い。
  // memory feedback_no_any_unknown.md「any/unknown 禁止」のため JsonValue 経由で受ける。
  const rawMetrics: JsonValue | null = row.metrics;
  const metricsObject =
    rawMetrics !== null && typeof rawMetrics === 'object' && !Array.isArray(rawMetrics)
      ? rawMetrics
      : null;
  return {
    id: row.id,
    evolutionRunId: row.evolutionRunId,
    regime: row.regime,
    generation: row.generation,
    category: cat.success ? cat.data : 'other',
    lesson: row.lesson,
    metrics: metricsObject,
    confidence: row.confidence,
    recordedAt: row.recordedAt,
  };
}

export class GenerationLessonRepository {
  /**
   * 1 件の lesson を永続化する。
   *
   * `metrics` / `confidence` 未指定時は SQL NULL に統一 (= Phase B-1 と同じ意味論)。
   */
  async create(data: GenerationLessonInsertData): Promise<GenerationLesson> {
    return prisma.generationLesson.create({
      data: {
        evolutionRunId: data.evolutionRunId,
        regime: data.regime,
        generation: data.generation,
        category: data.category,
        lesson: data.lesson,
        metrics: data.metrics ? toPrismaJsonValue(data.metrics) : Prisma.DbNull,
        confidence: data.confidence ?? null,
      },
    });
  }

  /**
   * 一括登録 (= 1 世代分の lessons をまとめて永続化する想定)。
   *
   * - 並列実行で行数増加時の遅延を抑える
   * - 1 行失敗しても他は永続化を継続 (= 観察ログテーブル方針、EvolutionBacktestRunRepository と同じ)
   */
  async createMany(rows: GenerationLessonInsertData[]): Promise<GenerationLesson[]> {
    if (rows.length === 0) return [];
    const settled = await Promise.allSettled(rows.map((row) => this.create(row)));
    const successes: GenerationLesson[] = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        successes.push(r.value);
      } else {
        const row = rows[i];
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.warn(
          `[GenerationLessonRepository] 永続化失敗: evolutionRunId=${row.evolutionRunId} ` +
            `regime=${row.regime} generation=${row.generation} category=${row.category} reason=${reason}`,
        );
      }
    });
    return successes;
  }

  /**
   * 指定 regime の最新 lessons を取得する。
   *
   * AgentMemory.getGenerationLessons() の主データソース。`limit` は呼び出し側で適切に絞る
   * (= mutation/crossover prompt に流す件数を抑制するため、通常 5-10 件程度)。
   */
  async findRecentByRegime(
    regime: string,
    limit: number = 10,
  ): Promise<GenerationLessonRecord[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = await prisma.generationLesson.findMany({
      where: { regime },
      orderBy: { recordedAt: 'desc' },
      take: safeLimit,
    });
    return rows.map(toRecord);
  }

  /**
   * regime を指定せず、全 regime の最新 lessons を取得する (= cross-symbol 学習 / 全体観察)。
   */
  async findRecent(limit: number = 20): Promise<GenerationLessonRecord[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const rows = await prisma.generationLesson.findMany({
      orderBy: { recordedAt: 'desc' },
      take: safeLimit,
    });
    return rows.map(toRecord);
  }

  /**
   * retention: `recordedAt` が指定日数より古い行を削除する。
   *
   * 本 repo は cron スケジューリングを行わない (= sideBScheduler が呼ぶ前提)。
   * 戻り値は削除件数。Phase B-3 と同じ pattern。
   */
  async deleteOlderThan(daysAgo: number): Promise<number> {
    const cutoff = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    const result = await prisma.generationLesson.deleteMany({
      where: { recordedAt: { lt: cutoff } },
    });
    return result.count;
  }
}

export const generationLessonRepository = new GenerationLessonRepository();
