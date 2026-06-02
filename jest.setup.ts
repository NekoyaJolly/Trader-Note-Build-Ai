// Jest セットアップ: 環境変数の読み込みと DATABASE_URL の既定値設定
// すべての時刻は UTC 保存を前提にする（DB 側で timestamptz）
import dotenv from 'dotenv';
import { prisma } from './src/backend/db/client';

dotenv.config();

// DATABASE_URL が未設定の場合、ローカル開発用の既定値を適用
// 注意: DB_URL は非推奨。DATABASE_URL を使用すること
if (!process.env.DATABASE_URL) {
  // ユーザー環境のローカルロールに合わせて調整（ここでは nekoya を既定）
  process.env.DATABASE_URL = 'postgresql://nekoya@localhost:5432/tradeassist';
}

// Jest の globalTeardown はテスト worker とは別プロセスで動くため、
// worker 内で import された PrismaClient の open handle を閉じられない。
// setupFilesAfterEnv で各 test environment に afterAll を登録し、Unit Tests 完了後に
// worker 側の Prisma 接続プールを確実に解放する。
afterAll(async () => {
  await prisma.$disconnect();
});
