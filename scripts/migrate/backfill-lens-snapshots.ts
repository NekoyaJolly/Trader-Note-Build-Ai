/**
 * 既存 TradeNote の LensSnapshot バックフィル (Phase α-2)
 *
 * 目的:
 * - NOTE_SIMILARITY_FOUNDATION.md §9-5 に基づき、既存ノートに Note コア行 +
 *   lensSnapshot を遡及生成する(トレード時刻 eventTime 起点で再現)
 * - Note コア行はあるが lensSnapshot=null のもの(生成失敗・データ未到達)も再試行する
 *
 * 実行コマンド:
 *   npx tsx scripts/migrate/backfill-lens-snapshots.ts [--limit N] [--dry-run] [--include-archived]
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
import { prisma } from '../../src/backend/db/client';
import { LensNoteCoreService } from '../../src/services/lensNoteCoreService';
import type { IndicatorLensSourceConfig } from '../../src/shared/similarity/indicatorLenses';

interface CliOptions {
  limit: number;
  dryRun: boolean;
  includeArchived: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { limit: 1000, dryRun: false, includeArchived: false };
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
    } else {
      throw new Error(`未知の引数です: ${arg}`);
    }
  }
  return options;
}

/**
 * TradeNote.indicatorConfig(NoteProfileConfig JSON)から有効なインジケーター設定を復元する。
 * 形式が想定外なら空配列(状態レンズのみ)に倒す。
 */
function extractIndicatorConfigs(indicatorConfig: unknown): IndicatorLensSourceConfig[] {
  if (indicatorConfig === null || typeof indicatorConfig !== 'object') {
    return [];
  }
  const indicators = (indicatorConfig as { indicators?: unknown }).indicators;
  if (!Array.isArray(indicators)) {
    return [];
  }
  const configs: IndicatorLensSourceConfig[] = [];
  for (const item of indicators) {
    if (item === null || typeof item !== 'object') {
      continue;
    }
    const candidate = item as {
      indicatorId?: unknown;
      params?: unknown;
      enabled?: unknown;
    };
    if (typeof candidate.indicatorId !== 'string') {
      continue;
    }
    if (candidate.enabled === false) {
      continue;
    }
    const params =
      candidate.params !== null && typeof candidate.params === 'object'
        ? (candidate.params as IndicatorLensSourceConfig['params'])
        : {};
    configs.push({ indicatorId: candidate.indicatorId, params, enabled: true });
  }
  return configs;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log(
    `[backfill-lens-snapshots] 開始: limit=${options.limit} dryRun=${options.dryRun} ` +
      `includeArchived=${options.includeArchived}`
  );

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
}

main()
  .catch((error) => {
    console.error('[backfill-lens-snapshots] 致命的エラー:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
