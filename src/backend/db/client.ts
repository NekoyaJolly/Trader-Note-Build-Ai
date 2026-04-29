import { PrismaClient } from '@prisma/client';

/**
 * PrismaClient のシングルトンインスタンス
 * - 開発環境: warn, error ログを出力
 * - 本番環境: error のみを出力（ログ量を抑制）
 */
/** Prisma を開発時のホットリロードで複数生成しないためのグローバル保持 */
interface GlobalWithPrisma {
  prisma?: PrismaClient;
}

const globalForPrisma = globalThis as typeof globalThis & GlobalWithPrisma;

// 本番環境かどうかを判定
const isProduction = process.env.NODE_ENV === 'production';

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    // 本番環境ではエラーログのみに限定してログ量を抑制
    log: isProduction ? ['error'] : ['warn', 'error'],
  });

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}
