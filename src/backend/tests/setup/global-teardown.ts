import { prisma } from '../../db/client';

/**
 * Jest Global Teardown - テスト終了後の共有リソース解放。
 *
 * Unit Tests でも app/routes/service の import 経由で PrismaClient が初期化される。
 * Prisma の接続プールを閉じないと、全テスト成功後に Node の open handle が残り、
 * GitHub Actions の Unit Tests が完了扱いにならず滞留するため明示的に切断する。
 */
export default async function globalTeardown(): Promise<void> {
  await prisma.$disconnect();
}
