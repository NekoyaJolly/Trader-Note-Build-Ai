/**
 * Phase 6.8 調査用: cTrader historical tick raw 形式を少量ダンプする。
 *
 * 使用:
 *   SYMBOL=XAUUSD START=2026-04-24T12:00:00Z END=2026-04-24T12:05:00Z npm run debug:ctrader-tick-raw
 */

import { PrismaClient } from '@prisma/client';
import { config } from '../src/config';
import { CTraderAuthService } from '../src/backend/services/ctrader/ctraderAuthService';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { CTraderConnection } = require('@reiryoku/ctrader-layer');

type RawTick = { timestamp?: number | string; tick?: number | string };

async function connectAndAuth(accountId: string, auth: CTraderAuthService) {
  const accessToken = await auth.getValidAccessToken(accountId);
  const hosts = [config.ctrader.wsLiveHost, config.ctrader.wsDemoHost];
  let lastError: Error | null = null;
  for (const host of hosts) {
    try {
      const connection = new CTraderConnection({ host, port: config.ctrader.wsPort });
      await connection.open();
      await connection.sendCommand('ProtoOAApplicationAuthReq', {
        clientId: config.ctrader.clientId,
        clientSecret: config.ctrader.clientSecret,
      });
      await connection.sendCommand('ProtoOAAccountAuthReq', {
        ctidTraderAccountId: parseInt(accountId, 10),
        accessToken,
      });
      return connection;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError ?? new Error('cTrader 接続に失敗');
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const auth = new CTraderAuthService(prisma);
  const token = await prisma.cTraderToken.findFirst({ orderBy: { lastConnectedAt: 'desc' } });
  if (!token) throw new Error('cTraderToken がありません');

  const symbol = process.env.SYMBOL?.trim() || 'XAUUSD';
  const start = new Date(process.env.START || '2026-04-24T12:00:00Z');
  const end = new Date(process.env.END || '2026-04-24T12:05:00Z');

  const connection = await connectAndAuth(token.accountId, auth);
  try {
    const symbolsRes = await connection.sendCommand('ProtoOASymbolsListReq', {
      ctidTraderAccountId: parseInt(token.accountId, 10),
      includeArchivedSymbols: false,
    });
    const symbols = (symbolsRes as { symbol?: Array<{ symbolId: number; symbolName: string; digits?: number; pipPosition?: number }> }).symbol ?? [];
    const info = symbols.find((s) => s.symbolName.replace(/[\/\s]/g, '').toUpperCase() === symbol.replace(/[\/\s]/g, '').toUpperCase());
    if (!info) throw new Error(`symbol not found: ${symbol}`);
    console.log({ symbol, symbolId: info.symbolId, digits: info.digits, pipPosition: info.pipPosition, start, end });

    for (const [label, type] of [['bid', 1], ['ask', 2]] as const) {
      const res = await connection.sendCommand('ProtoOAGetTickDataReq', {
        ctidTraderAccountId: parseInt(token.accountId, 10),
        symbolId: info.symbolId,
        type,
        fromTimestamp: start.getTime(),
        toTimestamp: end.getTime(),
      });
      const raw = res as { tickData?: RawTick[]; hasMore?: boolean };
      console.log(`\n=== ${label.toUpperCase()} hasMore=${String(raw.hasMore)} count=${String(raw.tickData?.length ?? 0)} ===`);
      console.log(JSON.stringify((raw.tickData ?? []).slice(0, 20), null, 2));
    }
  } finally {
    try { await connection.close(); } catch { /* noop */ }
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
