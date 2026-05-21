import { Prisma } from '@prisma/client';

/**
 * アプリ内の構造化データを Prisma Json 入力へ正規化する。
 *
 * JSON.stringify/parse を通すことで Date などを DB の JSON として
 * 保存可能な表現に寄せる。Prisma の Json 型境界だけで使う。
 *
 * 入力が null / undefined の場合は `Prisma.JsonNull` を返す (= DB 上は NULL)。
 * これにより nullable JSON 列 (`Json?`) と非 nullable 列 (`Json`) の両方で安全に
 * 利用でき、`JSON.parse("undefined")` の crash を防ぐ。
 */
export function toPrismaJsonValue<T>(
  value: T,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function fromPrismaJsonValue<T>(value: Prisma.JsonValue | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : (value as T);
}
