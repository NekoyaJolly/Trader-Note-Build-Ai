/**
 * NoteCoreRepository — ノート統一コア(Note テーブル)のリポジトリ
 *
 * 正本設計: docs/architecture/NOTE_SIMILARITY_FOUNDATION.md §7/§8(テーブル戦略B)
 *
 * 責務:
 * - Note コア行(同一性 + lensSnapshot + 来歴 + userId)の作成・更新・参照
 * - lensSnapshot(JSONB) の保存形は NoteLensSnapshot(Zod 検証済み JSON)
 *
 * 段階移行(§9)中の注意:
 * - 運用フィールド(status/enabled 等)の正は TradeNote 側。本テーブルは特徴とユーザー帰属を担う
 */

import type { Note, TradeSide } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import type { NoteLensSnapshot } from '../../shared/similarity/lensSnapshotTypes';

/** Side-A TradeNote 由来の Note コア行の作成・更新入力 */
export interface UpsertSideANoteCoreInput {
  readonly tradeNoteId: string;
  readonly userId: string | null;
  readonly symbol: string;
  readonly side: TradeSide;
  readonly timeframe: string;
  readonly higherTimeframe?: string;
  readonly entryPrice?: number;
  /** ノート=トレード時刻 */
  readonly eventTime: Date;
  /** 生成済み snapshot(生成失敗時は null = 比較対象外として登録だけ行う) */
  readonly lensSnapshot: NoteLensSnapshot | null;
}

export class NoteCoreRepository {
  /**
   * Side-A TradeNote に対応する Note コア行を作成または更新する(tradeNoteId で冪等)。
   */
  async upsertForTradeNote(input: UpsertSideANoteCoreInput): Promise<Note> {
    // NoteLensSnapshot は Zod 検証済みの JSON 互換オブジェクトなので
    // そのまま InputJsonValue として保存できる(`unknown` 経由のキャストは規約 §2 で不可)
    const snapshotJson: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      input.lensSnapshot === null ? Prisma.JsonNull : input.lensSnapshot;
    const common = {
      userId: input.userId,
      symbol: input.symbol,
      side: input.side,
      timeframe: input.timeframe,
      higherTimeframe: input.higherTimeframe ?? null,
      entryPrice: input.entryPrice ?? null,
      eventTime: input.eventTime,
      lensSnapshot: snapshotJson,
      snapshotSchemaVersion: input.lensSnapshot?.snapshotSchemaVersion ?? null,
    };
    return prisma.note.upsert({
      where: { tradeNoteId: input.tradeNoteId },
      create: {
        source: 'side_a_human',
        tradeNoteId: input.tradeNoteId,
        ...common,
      },
      update: common,
    });
  }

  /** tradeNoteId の集合に対応する Note コア行を取得する */
  async findByTradeNoteIds(tradeNoteIds: ReadonlyArray<string>): Promise<Note[]> {
    if (tradeNoteIds.length === 0) {
      return [];
    }
    return prisma.note.findMany({
      where: { tradeNoteId: { in: [...tradeNoteIds] } },
    });
  }

  /** lensSnapshot 未生成(null)の Side-A Note コア行を持つ tradeNoteId 一覧(バックフィル用) */
  async findTradeNoteIdsWithoutSnapshot(limit: number): Promise<string[]> {
    const rows = await prisma.note.findMany({
      where: {
        source: 'side_a_human',
        // JsonNull(JSON の null)と DbNull(SQL の NULL)の両方を「未生成」として扱う
        lensSnapshot: { equals: Prisma.AnyNull },
        tradeNoteId: { not: null },
      },
      select: { tradeNoteId: true },
      take: limit,
    });
    return rows.flatMap((row) => (row.tradeNoteId === null ? [] : [row.tradeNoteId]));
  }
}
