/**
 * PostgreSQL 接続テストスクリプト
 */
import { config } from 'dotenv';
import { getPrismaClient } from '../src/infrastructure/prismaClient';

config();

async function testConnection() {
  console.log('='.repeat(60));
  console.log('PostgreSQL 接続テスト開始');
  console.log('='.repeat(60));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL が設定されていません');
    process.exit(1);
  }

  // パスワード部分をマスク
  const maskedUrl = databaseUrl.replace(/:([^@]+)@/, ':****@');
  console.log(`DATABASE_URL: ${maskedUrl}`);
  console.log('');

  let prisma;
  try {
    console.log('[1/3] Prisma Client を初期化中...');
    prisma = getPrismaClient();
    console.log('✅ Prisma Client 初期化成功');
    console.log('');

    console.log('[2/3] データベース接続テスト中...');
    await prisma.$connect();
    console.log('✅ データベース接続成功');
    console.log('');

    console.log('[3/3] クエリテスト中...');
    const result = await prisma.$queryRaw`SELECT NOW() as current_time`;
    console.log('✅ クエリ実行成功');
    console.log(`   サーバー時刻: ${JSON.stringify(result)}`);
    console.log('');

    console.log('='.repeat(60));
    console.log('✅ すべての接続テストに成功しました');
    console.log('='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('='.repeat(60));
    console.error('❌ 接続テスト失敗');
    console.error('='.repeat(60));
    console.error('エラー詳細:');
    console.error(error);
    process.exit(1);
  } finally {
    if (prisma) {
      await prisma.$disconnect();
    }
  }
}

testConnection();
