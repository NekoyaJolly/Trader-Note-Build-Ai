import type { Prisma } from '@prisma/client';

/**
 * アプリ内の構造化データを Prisma Json 入力へ正規化する。
 *
 * JSON.stringify/parse を通すことで undefined や Date などを DB の JSON として
 * 保存可能な表現に寄せる。Prisma の Json 型境界だけで使う。
 */
export function toPrismaJsonValue<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function fromPrismaJsonValue<T>(value: Prisma.JsonValue | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : (value as T);
}
