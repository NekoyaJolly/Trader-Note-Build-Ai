/**
 * 既存 TradeNote の LensSnapshot バックフィル (Phase α-2)
 *
 * 目的:
 * - NOTE_SIMILARITY_FOUNDATION.md §9-5 に基づき、既存ノートに Note コア行 +
 *   lensSnapshot を遡及生成する(トレード時刻 eventTime 起点で再現)
 * - Note コア行はあるが lensSnapshot=null のもの(生成失敗・データ未到達)も再試行する
 *
 * 実行コマンド:
 *   npx tsx scripts/migrate/backfill-lens-snapshots.ts --dry-run [--limit N] [--include-archived]
 *   npx tsx scripts/migrate/backfill-lens-snapshots.ts --confirm-write [--limit N] [--include-archived]
 *
 * 挙動:
 * - 対象: status が draft / active の TradeNote(--include-archived で archived も対象)
 * - インジケーター設定はノート保存時のスナップショット(TradeNote.indicatorConfig)から復元
 * - OHLCV が不足する場合は fetchAndCacheOhlcv が期間指定で補完を試みる(レート制限あり)
 * - 1 件ずつ順次処理(外部 API 負荷を抑える)。失敗はスキップして継続、最後に集計を出す
 *
 * 削除条件: 全既存ノートのバックフィル完了が確認され、マッチング経路の切替(§9-3)後に
 *           旧データの再生成ニーズが無くなった場合
 */

import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { IndicatorLensSourceConfig } from '../../src/shared/similarity/indicatorLenses';

interface CliOptions {
  limit: number;
  dryRun: boolean;
  includeArchived: boolean;
  confirmWrite: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { limit: 1000, dryRun: false, includeArchived: false, confirmWrite: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--limit') {
      const value = Number.parseInt(argv[i + 1] ?? '', 10);
      if (!Number.isFinite(value) || value < 1) {
        throw new Error(`--limit には正の整数を指定してください: ${argv[i + 1]}`);
      }
      options.limit = value;
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--include-archived') {
      options.includeArchived = true;
    } else if (arg === '--confirm-write') {
      options.confirmWrite = true;
    } else {
      throw new Error(`未知の引数です: ${arg}`);
    }
  }
  return options;
}

/**
 * NoteProfileConfig(JSON)からレンズ生成に必要な部分だけを抜き出す Zod スキーマ。
 * 形式ドリフト(古い形式・破損)時は safeParse 失敗 → 空配列(状態レンズのみ)に倒す。
 */
const StoredIndicatorConfigSchema = z.object({
  indicatorId: z.string().min(1),
  enabled: z.boolean().optional(),
  params: z
    .object({
      period: z.number().optional(),
      fastPeriod: z.number().optional(),
      slowPeriod: z.number().optional(),
      signalPeriod: z.number().optional(),
    })
    // 他のパラメータキー(step 等)はレンズ解決に不要なので無視して通す
    .passthrough()
    .optional(),
});

const StoredNoteProfileConfigSchema = z.object({
  indicators: z.array(StoredIndicatorConfigSchema).default([]),
});

/**
 * TradeNote.indicatorConfig(NoteProfileConfig JSON)から有効なインジケーター設定を復元する。
 * 形式が想定外なら空配列(状態レンズのみ)に倒す。
 */
function extractIndicatorConfigs(indicatorConfig: unknown): IndicatorLensSourceConfig[] {
  const parsed = StoredNoteProfileConfigSchema.safeParse(indicatorConfig);
  if (!parsed.success) {
    return [];
  }
  return parsed.data.indicators
    .filter((config) => config.enabled !== false)
    .map((config) => ({
      indicatorId: config.indicatorId,
      params: config.params ?? {},
      enabled: true,
    }));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log(
    `[backfill-lens-snapshots] 開始: limit=${options.limit} dryRun=${options.dryRun} ` +
      `includeArchived=${options.includeArchived} confirmWrite=${options.confirmWrite}`
  );

  if (!options.dryRun && !options.confirmWrite) {
    throw new Error(
      '書き込み実行には --confirm-write が必要です。まず --dry-run と scripts/check/lens-snapshot-backfill-status.ts で対象を確認してください。'
    );
  }

  const { prisma } = await import('../../src/backend/db/client');
  try {

    const statuses: Array<'draft' | 'active' | 'archived'> = options.includeArchived
      ? ['draft', 'active', 'archived']
      : ['draft', 'active'];

    // Note コア行が無い、または lensSnapshot=null のノートを対象にする
    const notes = await prisma.tradeNote.findMany({
      where: {
        status: { in: statuses },
        OR: [{ coreNote: null }, { coreNote: { lensSnapshot: { equals: Prisma.AnyNull } } }],
      },
      include: { trade: { select: { timestamp: true } } },
      orderBy: { createdAt: 'asc' },
      take: options.limit,
    });

    console.log(`[backfill-lens-snapshots] 対象ノート: ${notes.length} 件`);
    if (options.dryRun) {
      for (const note of notes) {
        console.log(
          `  - ${note.id} ${note.symbol} ${note.status} eventTime=${note.trade.timestamp.toISOString()}`
        );
      }
      console.log('[backfill-lens-snapshots] dry-run のため終了');
      return;
    }

    const { LensNoteCoreService } = await import('../../src/services/lensNoteCoreService');
    const service = new LensNoteCoreService();
    let succeeded = 0;
    let withoutSnapshot = 0;
    let failed = 0;

    for (let i = 0; i < notes.length; i += 1) {
      const note = notes[i];
      try {
        const result = await service.createForSideATradeNote({
          tradeNoteId: note.id,
          userId: note.userId,
          symbol: note.symbol,
          side: note.side,
          timeframe: note.timeframe ?? '15m',
          entryPrice: note.entryPrice.toNumber(),
          eventTime: note.trade.timestamp,
          indicatorConfigs: extractIndicatorConfigs(note.indicatorConfig),
        });
        if (result.snapshotGenerated) {
          succeeded += 1;
        } else {
          withoutSnapshot += 1;
          console.warn(
            `  [${i + 1}/${notes.length}] snapshot 生成できず(null 登録): ${note.id} ${note.symbol} ` +
              result.warnings.join(' / ')
          );
        }
        if ((i + 1) % 10 === 0) {
          console.log(`  進捗: ${i + 1}/${notes.length}`);
        }
      } catch (error) {
        failed += 1;
        console.error(`  [${i + 1}/${notes.length}] 失敗: ${note.id}`, error);
      }
    }

    console.log(
      `[backfill-lens-snapshots] 完了: snapshot 生成=${succeeded} / null 登録=${withoutSnapshot} / 失敗=${failed}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error('[backfill-lens-snapshots] 致命的エラー:', error);
    process.exitCode = 1;
  });
