import { PrismaClient } from '@prisma/client';

/**
 * Prisma Client シングルトンインスタンス
 * 全体で唯一のDB接続を使用する
 */

console.log('[Prisma] PrismaClient をインスタンス化中...');

let prismaInstance: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    console.log('[Prisma] 新規PrismaClientを作成します');
    try {
      prismaInstance = new PrismaClient({
        log: [
          { emit: 'stdout', level: 'warn' },
          { emit: 'stdout', level: 'error' },
        ],
      });
      console.log('[Prisma] ✅ PrismaClient作成成功');
    } catch (error) {
      console.error('[Prisma] ❌ PrismaClient作成失敗:', error);
      throw error;
    }
  }
  return prismaInstance;
}

export function closePrismaClient(): void {
  if (prismaInstance) {
    console.log('[Prisma] PrismaClientを切断中...');
    prismaInstance.$disconnect();
    prismaInstance = null;
  }
}

// グローバルエラーハンドラー（Prisma接続エラー時）
process.on('exit', () => {
  closePrismaClient();
});
