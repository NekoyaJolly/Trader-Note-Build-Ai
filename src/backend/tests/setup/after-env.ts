import { prisma } from '../../db/client';

/**
 * Jest worker 側のテスト環境終了処理。
 *
 * `setupFiles` は Jest のテストフレームワーク導入前に実行されるため `afterAll` を使えない。
 * そのため、`setupFilesAfterEnv` から本ファイルを読み込み、各 worker / test environment 内で
 * Prisma の接続プールを閉じる。
 */
afterAll(async () => {
  await prisma.$disconnect();
});
