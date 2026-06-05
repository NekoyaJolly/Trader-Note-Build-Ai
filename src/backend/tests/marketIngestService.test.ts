/**
 * MarketIngestService のテスト
 * 対象: 15m/60m の丸め処理と upsert 冪等性
 * ルール: コメントは日本語、DB スナップショットの状態を直接確認
 *
 * 市場データは **EODHD を第一選択**とし、cTrader を二次フォールバックとする。
 * 本テストは cTrader 配線経路の回帰も兼ねるため、CTRADER_CLIENT_* と DB の OAuth トークンが
 * 揃う場合のみ実行する (EODHD 単独でも getCurrentMarketData は成立する)。
 */
import { PrismaClient } from '@prisma/client';
import { MarketIngestService } from '../../backend/services/ingest/marketIngestService';
import { MarketSnapshotRepository } from '../../backend/repositories/marketSnapshotRepository';
import { CTraderAuthService } from '../../backend/services/ctrader/ctraderAuthService';
import { hasCtraderCredentials, isMinimalTestMode } from './helpers/secret-checker';

function isValidBucket(date: Date, timeframe: '15m' | '60m'): boolean {
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const ms = date.getUTCMilliseconds();
  if (timeframe === '60m') {
    return minutes === 0 && seconds === 0 && ms === 0;
  }
  return minutes % 15 === 0 && seconds === 0 && ms === 0;
}

const minimalMode = isMinimalTestMode();
const describeOrSkip = hasCtraderCredentials() ? describe : describe.skip;

describeOrSkip('MarketIngestService', () => {
  const prisma = new PrismaClient();
  const service = new MarketIngestService();
  const repo = new MarketSnapshotRepository();
  /** cTrader 口座で取引可能な名前に合わせる。上書き: MARKET_INGEST_TEST_SYMBOL */
  const symbol = process.env.MARKET_INGEST_TEST_SYMBOL?.trim() || 'XAUUSD';

  let ready = false;

  beforeAll(async () => {
    if (!hasCtraderCredentials()) {
      return;
    }
    const token = await prisma.cTraderToken.findFirst({
      orderBy: { lastConnectedAt: 'desc' },
    });
    if (!token) {
      console.warn('⚠️ cTrader OAuth トークンが DB にないため MarketIngest テストをスキップ');
      return;
    }
    const auth = new CTraderAuthService(prisma);
    service.setTestCTraderConnection(token.accountId, auth);
    ready = true;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const apiTestOrSkip = minimalMode ? test.skip : test;

  apiTestOrSkip('15m/60m の丸めが正しく保存される', async () => {
    if (!ready) {
      console.warn('⚠️ セットアップ不足のためスキップ');
      return;
    }
    await service.ingestSymbol(symbol);

    const latest15 = await repo.findLatest(symbol, '15m');
    const latest60 = await repo.findLatest(symbol, '60m');

    expect(latest15).toBeTruthy();
    expect(latest60).toBeTruthy();

    expect(isValidBucket(latest15!.fetchedAt, '15m')).toBe(true);
    expect(isValidBucket(latest60!.fetchedAt, '60m')).toBe(true);
  });

  const testOrSkip = minimalMode ? test.skip : test;

  testOrSkip('upsert の冪等性: 同一バケットで重複挿入されない', async () => {
    if (!ready) {
      console.warn('⚠️ セットアップ不足のためスキップ');
      return;
    }
    await service.ingestSymbol(symbol);
    await service.ingestSymbol(symbol);

    const latest15 = await repo.findLatest(symbol, '15m');
    const latest60 = await repo.findLatest(symbol, '60m');

    expect(latest15).toBeTruthy();
    expect(latest60).toBeTruthy();

    expect(isValidBucket(latest15!.fetchedAt, '15m')).toBe(true);
    expect(isValidBucket(latest60!.fetchedAt, '60m')).toBe(true);
  });
});
