/**
 * Filter Evolution Phase B-2 (2026-05-09): EvolutionInstanceCarry Repository
 *
 * 進化ループの世代間 in-memory cache (tradesByDslId / lastRepairHints /
 * lastRepairBaselines) を DB に永続化し、cron 起動を跨いだ「学ぶ」サイクルを成立させる。
 *
 * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.2
 *
 * 設計方針:
 * - payload は Zod schema で厳密に検証 (= 不正データで EvolutionLoop が壊れない)
 * - 復元失敗 (Zod 不適合 / DB 例外) は warning ログ + 空 cache に fallback (= 既存挙動維持)
 * - retention は本 repo では `deleteOlderThan` を提供するのみ (= 呼び出しは別 cron job)
 */

import type { EvolutionInstanceCarry } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../db/client';
import { toPrismaJsonValue } from '../../utils/prismaJson';

/**
 * carry payload に含める trade entry。
 * EvolutionBacktestRun.trades と同じ shape (= Phase B-1 と整合)。
 */
export const CarriedTradeSchema = z.object({
  entryTime: z.string(),
  side: z.enum(['long', 'short']),
  pnl: z.number(),
  outcome: z.enum(['win', 'loss', 'timeout']),
});
export type CarriedTrade = z.infer<typeof CarriedTradeSchema>;

/**
 * carry payload に含める RepairHint。
 *
 * `repairHintPolicy.RepairHint` と structurally 同形 (= 循環 import を避けるため
 * カスタム Zod schema として独立定義。フィールド構成は repairHintPolicy.ts の
 * `RepairHint` interface と必ず同期させる)。
 */
/**
 * `RepairTarget` (= repairHintPolicy.ts) と同じ enum 値を Zod で定義。
 * 元の型と同期させること (= 値の追加時はこの schema も更新する)。
 */
const RepairTargetEnum = z.enum([
  'entry',
  'exit',
  'risk',
  'filters',
  'timeframe',
  'parameters',
  'dsl_shape',
  'evaluation_runtime',
  'none',
]);

export const CarriedRepairHintSchema = z.object({
  failureReason: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'fatal']),
  summary: z.string(),
  actions: z.array(
    z.object({
      target: RepairTargetEnum,
      instruction: z.string(),
      allowedChangeScope: z.enum(['small', 'medium', 'large', 'none']),
    }),
  ),
  mutationGuidance: z.string(),
  shouldUseForRepairMutation: z.boolean(),
  shouldExcludeFromParentPool: z.boolean(),
  warnings: z.array(z.string()).default([]),
});
export type CarriedRepairHint = z.infer<typeof CarriedRepairHintSchema>;

/**
 * carry payload に含める RepairOutcomeBaseline。
 *
 * `repairOutcomeTelemetry.RepairOutcomeBaseline` と structurally 同形。
 * metrics 各フィールドは元の interface に合わせて `number | null` を許容。
 */
export const CarriedRepairBaselineSchema = z.object({
  candidateId: z.string(),
  dslId: z.string().optional(),
  failureReason: z.string(),
  route: z.string().optional(),
  metrics: z.object({
    pf: z.number().nullable().optional(),
    tradeCount: z.number().nullable().optional(),
    maxDrawdown: z.number().nullable().optional(),
    expectancy: z.number().nullable().optional(),
  }),
});
export type CarriedRepairBaseline = z.infer<typeof CarriedRepairBaselineSchema>;

/** payload 全体の Zod schema。*/
export const EvolutionCarryPayloadSchema = z.object({
  /** dslId → trade list (= 当 evolutionRunId 内の formal BT 結果)。 */
  tradesByDslId: z.record(z.string(), z.array(CarriedTradeSchema)).default({}),
  /** dslId → RepairHint (= 次世代 mutation の修復ヒント)。 */
  repairHints: z.record(z.string(), CarriedRepairHintSchema).default({}),
  /** dslId → RepairOutcomeBaseline (= 次世代 outcome 比較用)。 */
  repairBaselines: z.record(z.string(), CarriedRepairBaselineSchema).default({}),
});
export type EvolutionCarryPayload = z.infer<typeof EvolutionCarryPayloadSchema>;

/**
 * EvolutionLoop が repository に求める最小契約。
 *
 * `null` injection / DI 用に Pick 経由で公開する。テストでは型付きモックを書ける。
 */
export type EvolutionInstanceCarryPersister = Pick<
  EvolutionInstanceCarryRepository,
  'create' | 'findLatestByRegime' | 'deleteOlderThan'
>;

export interface EvolutionInstanceCarryInsertData {
  evolutionRunId: string;
  regime: string;
  generation: number;
  payload: EvolutionCarryPayload;
}

/**
 * 復元時の戻り値。`null` = 該当 regime に carry が存在しない / 復元不能。
 */
export interface EvolutionInstanceCarryRecord {
  id: string;
  evolutionRunId: string;
  regime: string;
  generation: number;
  payload: EvolutionCarryPayload;
  recordedAt: Date;
}

export class EvolutionInstanceCarryRepository {
  /**
   * 当世代の cache を 1 行として永続化する。
   *
   * payload の Zod 検証は呼び出し側で済ませる前提 (= 型システムで弾く)。本メソッドは
   * `toPrismaJsonValue` で JSONB 化して書き込むだけ。
   */
  async create(data: EvolutionInstanceCarryInsertData): Promise<EvolutionInstanceCarry> {
    return prisma.evolutionInstanceCarry.create({
      data: {
        evolutionRunId: data.evolutionRunId,
        regime: data.regime,
        generation: data.generation,
        payload: toPrismaJsonValue(data.payload),
      },
    });
  }

  /**
   * regime 単位で最新の carry を 1 件取得する (= cron 跨ぎ復元の主用途)。
   *
   * - `evolutionRunId` でフィルタしない: 別 cron 起動の最新 carry を読むため
   * - `recordedAt DESC` で最新を採用 (= multi-gen 内の最終世代の carry が必ず最後に書かれる)
   * - payload が Zod 不適合の場合は null を返す + warning ログ (= 上位は空 cache fallback)
   */
  async findLatestByRegime(regime: string): Promise<EvolutionInstanceCarryRecord | null> {
    const row = await prisma.evolutionInstanceCarry.findFirst({
      where: { regime },
      orderBy: { recordedAt: 'desc' },
    });
    if (!row) return null;
    const parsed = EvolutionCarryPayloadSchema.safeParse(row.payload);
    if (!parsed.success) {
      console.warn(
        `[EvolutionInstanceCarryRepository] payload Zod 不適合: id=${row.id} regime=${regime} ` +
          `error=${parsed.error.message.slice(0, 200)}`,
      );
      return null;
    }
    return {
      id: row.id,
      evolutionRunId: row.evolutionRunId,
      regime: row.regime,
      generation: row.generation,
      payload: parsed.data,
      recordedAt: row.recordedAt,
    };
  }

  /**
   * retention: `recordedAt` が指定日数より古い行を削除する。
   *
   * 本メソッド単体では cron スケジューリングを行わない。Phase B-3 で別 job が呼ぶ想定。
   * 戻り値は削除件数。
   */
  async deleteOlderThan(daysAgo: number): Promise<number> {
    const cutoff = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    const result = await prisma.evolutionInstanceCarry.deleteMany({
      where: { recordedAt: { lt: cutoff } },
    });
    return result.count;
  }
}

export const evolutionInstanceCarryRepository = new EvolutionInstanceCarryRepository();
