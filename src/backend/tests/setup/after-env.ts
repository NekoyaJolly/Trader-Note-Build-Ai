import { afterAll } from '@jest/globals';

/**
 * Jest worker 側のテスト環境終了処理。
 *
 * `setupFiles` は Jest のテストフレームワーク導入前に実行されるため `afterAll` を使えない。
 * そのため、`setupFilesAfterEnv` から本ファイルを読み込み、各 worker / test environment 内で
 * Prisma の接続プールを閉じる。
 *
 * ここで Prisma singleton を静的 import すると、各 test file の `jest.mock('../db/client')`
 * より先に実体が module cache へ入り、unit test が実 DB へ接続してしまう。
 * afterAll 内で遅延 import し、mock 済み test では mock の `$disconnect`、実 Prisma 利用 test
 * では実体の `$disconnect` を呼ぶ。
 */
afterAll(async () => {
  const { prisma } = await import('../../db/client');
  if (typeof prisma.$disconnect !== 'function') {
    return;
  }
  await prisma.$disconnect();
});
