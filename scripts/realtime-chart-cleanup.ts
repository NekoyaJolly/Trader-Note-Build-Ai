/**
 * リアルタイムチャート: 汚染データのクリーンアップスクリプト
 *
 * 目的:
 * - RealtimeOHLCV / TickData に混入した「明らかな異常値」を安全に削除する
 * - デフォルトは dry-run（件数確認のみ）。削除するには --execute を付ける
 *
 * 実行例:
 *   # まずは件数確認（dry-run）
 *   npx ts-node scripts/realtime-chart-cleanup.ts --symbol XAUUSD --timeframe 60 --min 4000 --max 5500
 *
 *   # 実際に削除
 *   npx ts-node scripts/realtime-chart-cleanup.ts --symbol XAUUSD --timeframe 60 --min 4000 --max 5500 --execute
 *
 *   # 期間指定で削除（例: 2026-01-08 より前）
 *   npx ts-node scripts/realtime-chart-cleanup.ts --symbol XAUUSD --timeframe 60 --before 2026-01-08T00:00:00.000Z --execute
 */

import { z } from 'zod';
import { prisma } from '../src/backend/db/client';

type ArgMap = Record<string, string | undefined>;

function parseArgs(argv: string[]): ArgMap {
  const out: ArgMap = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const [rawKey, maybeValue] = token.split('=', 2);
    const key = rawKey.replace(/^--/, '');

    if (maybeValue !== undefined) {
      out[key] = maybeValue;
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
      continue;
    }

    // 値なしフラグは true 扱い
    out[key] = 'true';
  }
  return out;
}

const DateTimeStringSchema = z
  .string()
  .datetime({ message: 'before は ISO8601 (例: 2026-01-08T00:00:00.000Z) を指定してください' })
  .transform((s) => new Date(s));

const ArgsSchema = z
  .object({
    symbol: z.string().min(1, 'symbol は必須です'),
    timeframe: z.coerce.number().int().positive().optional().default(60),
    min: z.coerce.number().optional(),
    max: z.coerce.number().optional(),
    before: DateTimeStringSchema.optional(),
    target: z.enum(['bars', 'ticks', 'both']).optional().default('both'),
    execute: z.enum(['true', 'false']).optional().default('false').transform((v) => v === 'true'),
    sample: z.coerce.number().int().positive().optional().default(5),
  })
  .refine(
    (v) => v.before !== undefined || v.min !== undefined || v.max !== undefined,
    { message: 'before または min/max のいずれかを指定してください' }
  )
  .refine(
    (v) => (v.min !== undefined && v.max !== undefined ? v.min < v.max : true),
    { message: 'min/max を同時指定する場合は min < max にしてください' }
  );

type ParsedArgs = z.infer<typeof ArgsSchema>;

function toNumberOrNull(v: string | number | { toString: () => string } | null | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (v && typeof v === 'object') {
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function cleanupBars(args: ParsedArgs): Promise<void> {
  const timeframeStr = `${args.timeframe}s`;

  const whereBase = {
    symbol: args.symbol,
    timeframe: timeframeStr,
  };

  const ors: Array<
    | { timestamp: { lt: Date } }
    | { close: { lt: number } }
    | { close: { gt: number } }
  > = [];
  if (args.before) ors.push({ timestamp: { lt: args.before } });
  if (args.min !== undefined) ors.push({ close: { lt: args.min } });
  if (args.max !== undefined) ors.push({ close: { gt: args.max } });

  const where = {
    ...whereBase,
    OR: ors,
  };

  const count = await prisma.realtimeOHLCV.count({ where });
  console.log(`[RealtimeOHLCV] 対象件数: ${count} (symbol=${args.symbol}, timeframe=${timeframeStr})`);

  const samples = await prisma.realtimeOHLCV.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: Math.min(args.sample, 20),
    select: { id: true, timestamp: true, open: true, high: true, low: true, close: true, tickCount: true },
  });

  for (const b of samples) {
    console.log(
      `  id=${b.id} ts=${b.timestamp.toISOString()} ` +
      `O=${toNumberOrNull(b.open)} H=${toNumberOrNull(b.high)} L=${toNumberOrNull(b.low)} C=${toNumberOrNull(b.close)} T=${b.tickCount}`
    );
  }

  if (!args.execute) {
    console.log('[RealtimeOHLCV] dry-run のため削除は実行しません（--execute で実行）');
    return;
  }

  const deleted = await prisma.realtimeOHLCV.deleteMany({ where });
  console.log(`[RealtimeOHLCV] 削除完了: ${deleted.count} 件`);
}

async function cleanupTicks(args: ParsedArgs): Promise<void> {
  const whereBase = {
    symbol: args.symbol,
  };

  const ors: Array<
    | { timestamp: { lt: Date } }
    | { mid: { lt: number } }
    | { mid: { gt: number } }
  > = [];
  if (args.before) ors.push({ timestamp: { lt: args.before } });
  if (args.min !== undefined) ors.push({ mid: { lt: args.min } });
  if (args.max !== undefined) ors.push({ mid: { gt: args.max } });

  const where = {
    ...whereBase,
    OR: ors,
  };

  const count = await prisma.tickData.count({ where });
  console.log(`[TickData] 対象件数: ${count} (symbol=${args.symbol})`);

  const samples = await prisma.tickData.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: Math.min(args.sample, 20),
    select: { id: true, timestamp: true, bid: true, ask: true, mid: true, spread: true, source: true },
  });

  for (const t of samples) {
    console.log(
      `  id=${t.id} ts=${t.timestamp.toISOString()} ` +
      `bid=${toNumberOrNull(t.bid)} ask=${toNumberOrNull(t.ask)} mid=${toNumberOrNull(t.mid)} spread=${toNumberOrNull(t.spread)} src=${t.source}`
    );
  }

  if (!args.execute) {
    console.log('[TickData] dry-run のため削除は実行しません（--execute で実行）');
    return;
  }

  const deleted = await prisma.tickData.deleteMany({ where });
  console.log(`[TickData] 削除完了: ${deleted.count} 件`);
}

async function main(): Promise<void> {
  const raw = parseArgs(process.argv.slice(2));
  const parsed = ArgsSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('引数エラー:', parsed.error.format());
    process.exit(1);
  }

  const args = parsed.data;
  const timeframeStr = `${args.timeframe}s`;

  console.log('=== リアルタイムチャート DBクリーンアップ ===');
  console.log(`symbol=${args.symbol} timeframe=${timeframeStr} target=${args.target} execute=${args.execute}`);
  if (args.before) console.log(`before=${args.before.toISOString()}`);
  if (args.min !== undefined || args.max !== undefined) {
    console.log(`range: min=${args.min ?? '(なし)'} max=${args.max ?? '(なし)'}`);
  }
  console.log('');

  await prisma.$connect();

  if (args.target === 'bars' || args.target === 'both') {
    await cleanupBars(args);
    console.log('');
  }

  if (args.target === 'ticks' || args.target === 'both') {
    await cleanupTicks(args);
    console.log('');
  }

  await prisma.$disconnect();
  console.log('=== 完了 ===');
}

main().catch(async (err) => {
  console.error('スクリプト実行エラー:', err);
  try {
    await prisma.$disconnect();
  } catch {
    // 終了処理のため握りつぶす
  }
  process.exit(1);
});


