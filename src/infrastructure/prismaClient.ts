/**
 * Prisma Client シングルトン経由参照ラッパー (互換用)。
 *
 * 設計: 本ファイルは独自に `new PrismaClient()` していたが、
 *       プロジェクト全体で複数 PrismaClient が乱立し
 *       Cloud Run + Supabase pgBouncer で connection pool 枯渇 (PR #152, signal 11) を起こした。
 *       canonical singleton (`src/backend/db/client.ts` の `prisma`) にリダイレクトすることで
 *       既存呼び出し元 (6 ファイル) を破壊変更なしに 1 つの client に集約する。
 *
 * 新規コードは直接 `import { prisma } from '@/backend/db/client'` を推奨。
 */
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../backend/db/client';

/** canonical singleton を返す。プロセス内で常に同一インスタンス。 */
export function getPrismaClient(): PrismaClient {
  return prisma;
}

/**
 * 互換 API: 旧実装は内部 instance を `$disconnect()` して null クリアしていたが、
 * canonical singleton はプロセス全体で共有されるため、ここでは何もしない (= no-op)。
 * 切断は `process.on('exit')` で OS が回収する際に Prisma 自体が処理する。
 */
export function closePrismaClient(): void {
  // no-op: canonical singleton はプロセス共有のため明示切断しない
}
