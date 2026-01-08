/**
 * リアルタイムチャート: DBデータ調査スクリプト
 *
 * 目的:
 * - RealtimeOHLCV / TickData に「スケール違い」の汚染データが混入していないかを可視化する
 * - min/max/avg/count を出し、必要なら異常値（レンジ外）を抽出する
 *
 * 実行例:
 *   # XAUUSD (1分足) の価格レンジ調査（2026年1月: 4,000〜5,500 を想定）
 *   DATABASE_URL="postgresql://user:pass@localhost:5432/tradeassist" \
 *   npx ts-node scripts/realtime-chart-db-investigation.ts --symbol XAUUSD --timeframe 60 --min 4000 --max 5500
 *
 *   # 15分足（900秒）
 *   npx ts-node scripts/realtime-chart-db-investigation.ts --symbol XAUUSD --timeframe 900 --min 4000 --max 5500
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

    // 値なしフラグは true 扱い（必要な場合のみ使う）
    out[key] = 'true';
  }
  return out;
}

const ArgsSchema = z.object({
  symbol: z.string().min(1, 'symbol は必須です'),
  timeframe: z.coerce.number().int().positive().optional().default(60),
  limit: z.coerce.number().int().positive().optional().default(20),
  min: z.coerce.number().optional(),
  max: z.coerce.number().optional(),
});

function toNumberOrNull(v: string | number | { toString: () => string } | null | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  // Prisma Decimal は toString() を持つので、ここは string 化を試す
  if (v && typeof v === 'object') {
    const s = String(v.toString());
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function main(): Promise<void> {
  const raw = parseArgs(process.argv.slice(2));
  const parsed = ArgsSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('引数エラー:', parsed.error.format());
    process.exit(1);
  }

  const { symbol, timeframe, limit, min, max } = parsed.data;
  const timeframeStr = `${timeframe}s`;

  console.log('=== リアルタイムチャート DB調査 ===');
  console.log(`symbol=${symbol} timeframe=${timeframeStr} limit=${limit}`);
  if (min !== undefined || max !== undefined) {
    console.log(`レンジ条件: min=${min ?? '(なし)'} max=${max ?? '(なし)'}`);
  }
  console.log('');

  await prisma.$connect();

  // --- RealtimeOHLCV 集計 ---
  const ohlcvAgg = await prisma.realtimeOHLCV.aggregate({
    where: { symbol, timeframe: timeframeStr },
    _count: { _all: true },
    _min: { close: true },
    _max: { close: true },
    _avg: { close: true },
  });

  const ohlcvCount = ohlcvAgg._count._all;
  const ohlcvMin = toNumberOrNull(ohlcvAgg._min.close);
  const ohlcvMax = toNumberOrNull(ohlcvAgg._max.close);
  const ohlcvAvg = toNumberOrNull(ohlcvAgg._avg.close);

  console.log('[RealtimeOHLCV] 集計');
  console.log(`  count=${ohlcvCount}`);
  console.log(`  close.min=${ohlcvMin ?? 'N/A'}`);
  console.log(`  close.max=${ohlcvMax ?? 'N/A'}`);
  console.log(`  close.avg=${ohlcvAvg ?? 'N/A'}`);
  console.log('');

  const latestBars = await prisma.realtimeOHLCV.findMany({
    where: { symbol, timeframe: timeframeStr },
    orderBy: { timestamp: 'desc' },
    take: Math.min(limit, 20),
    select: { timestamp: true, open: true, high: true, low: true, close: true, tickCount: true },
  });

  console.log(`[RealtimeOHLCV] 最新 ${latestBars.length} 件（timestamp desc）`);
  for (const b of latestBars) {
    console.log(
      `  ${b.timestamp.toISOString()} O=${toNumberOrNull(b.open)} H=${toNumberOrNull(b.high)} ` +
      `L=${toNumberOrNull(b.low)} C=${toNumberOrNull(b.close)} T=${b.tickCount}`
    );
  }
  console.log('');

  if (min !== undefined || max !== undefined) {
    const anomalyBars = await prisma.realtimeOHLCV.findMany({
      where: {
        symbol,
        timeframe: timeframeStr,
        OR: [
          ...(min !== undefined ? [{ close: { lt: min } }] : []),
          ...(max !== undefined ? [{ close: { gt: max } }] : []),
        ],
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      select: { id: true, timestamp: true, close: true, open: true, high: true, low: true },
    });

    console.log(`[RealtimeOHLCV] レンジ外（最大 ${limit} 件）`);
    if (anomalyBars.length === 0) {
      console.log('  該当なし');
    } else {
      for (const b of anomalyBars) {
        console.log(
          `  id=${b.id} ts=${b.timestamp.toISOString()} ` +
          `O=${toNumberOrNull(b.open)} H=${toNumberOrNull(b.high)} L=${toNumberOrNull(b.low)} C=${toNumberOrNull(b.close)}`
        );
      }
    }
    console.log('');
  }

  // --- TickData 集計 ---
  const tickAgg = await prisma.tickData.aggregate({
    where: { symbol },
    _count: { _all: true },
    _min: { mid: true },
    _max: { mid: true },
    _avg: { mid: true },
  });

  const tickCount = tickAgg._count._all;
  const tickMin = toNumberOrNull(tickAgg._min.mid);
  const tickMax = toNumberOrNull(tickAgg._max.mid);
  const tickAvg = toNumberOrNull(tickAgg._avg.mid);

  console.log('[TickData] 集計（timeframe なし）');
  console.log(`  count=${tickCount}`);
  console.log(`  mid.min=${tickMin ?? 'N/A'}`);
  console.log(`  mid.max=${tickMax ?? 'N/A'}`);
  console.log(`  mid.avg=${tickAvg ?? 'N/A'}`);
  console.log('');

  const latestTicks = await prisma.tickData.findMany({
    where: { symbol },
    orderBy: { timestamp: 'desc' },
    take: Math.min(limit, 20),
    select: { timestamp: true, bid: true, ask: true, mid: true, spread: true, source: true },
  });

  console.log(`[TickData] 最新 ${latestTicks.length} 件（timestamp desc）`);
  for (const t of latestTicks) {
    console.log(
      `  ${t.timestamp.toISOString()} bid=${toNumberOrNull(t.bid)} ask=${toNumberOrNull(t.ask)} ` +
      `mid=${toNumberOrNull(t.mid)} spread=${toNumberOrNull(t.spread)} src=${t.source}`
    );
  }
  console.log('');

  if (min !== undefined || max !== undefined) {
    const anomalyTicks = await prisma.tickData.findMany({
      where: {
        symbol,
        OR: [
          ...(min !== undefined ? [{ mid: { lt: min } }] : []),
          ...(max !== undefined ? [{ mid: { gt: max } }] : []),
        ],
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      select: { id: true, timestamp: true, mid: true, bid: true, ask: true, spread: true },
    });

    console.log(`[TickData] レンジ外（最大 ${limit} 件）`);
    if (anomalyTicks.length === 0) {
      console.log('  該当なし');
    } else {
      for (const t of anomalyTicks) {
        console.log(
          `  id=${t.id} ts=${t.timestamp.toISOString()} ` +
          `bid=${toNumberOrNull(t.bid)} ask=${toNumberOrNull(t.ask)} mid=${toNumberOrNull(t.mid)} spread=${toNumberOrNull(t.spread)}`
        );
      }
    }
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
    // ここでは握りつぶす（終了処理）
  }
  process.exit(1);
});


