import { Prisma } from '@prisma/client';

/**
 * アプリ内の構造化データを Prisma Json 入力へ正規化する。
 *
 * JSON.stringify/parse を通すことで Date などを DB の JSON として
 * 保存可能な表現に寄せる。Prisma の Json 型境界だけで使う。
 *
 * **入力契約**: value は non-null, non-undefined であること。呼び出し側で
 * 値の有無をチェックしてから渡す。null/undefined を渡すと throw する
 * (`JSON.parse("undefined")` の silent crash を早期に検知するため)。
 *
 * - 非 nullable JSON 列 (`Json` 必須) の create/update で使う。
 * - nullable JSON 列 (`Json?`) で SQL NULL を入れたい場合は
 *   `toPrismaJsonValueOrDbNull()` を使うこと。
 */
export function toPrismaJsonValue<T>(value: T): Prisma.InputJsonValue {
  if (value === null || value === undefined) {
    throw new TypeError(
      'toPrismaJsonValue: null/undefined を渡せません。' +
        'nullable JSON 列で SQL NULL を入れたい場合は toPrismaJsonValueOrDbNull を使ってください。',
    );
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * nullable JSON 列 (`Json?`) 専用: null/undefined を **SQL NULL** (`Prisma.DbNull`) に変換、
 * それ以外は `toPrismaJsonValue` と同じく正規化して返す。
 *
 * セマンティクス: `Prisma.DbNull` = PostgreSQL の真の SQL NULL (`IS NULL` で検出可能)。
 * `Prisma.JsonNull` (JSONB の `null` 値、`jsonb_typeof = 'null'`) とは別物なので注意。
 * 「データなし」を意味するなら本関数 (`DbNull`) が正解。
 */
export function toPrismaJsonValueOrDbNull<T>(
  value: T | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) {
    return Prisma.DbNull;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function fromPrismaJsonValue<T>(value: Prisma.JsonValue | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : (value as T);
}
