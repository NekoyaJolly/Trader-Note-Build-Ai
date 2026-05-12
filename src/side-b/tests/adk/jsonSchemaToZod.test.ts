/**
 * jsonSchemaToZod 単体テスト (Step 1 Ticket T3)
 *
 * SkillInputSchema (JSONSchema draft-07 subset) を Zod スキーマに変換する
 * ユーティリティのテスト。
 *
 * 設計書: /src/side-b/adk/adapters/README.md §4.7
 *
 * 合格条件 (Nekoさん T2.5 承認時の追加指示):
 * - 未対応 JSONSchema は z.any() で握りつぶさず、必ず throw
 * - throw 時は skill 名 / field path を含むメッセージ
 */

import { jsonSchemaToZod, JsonSchemaToZodError } from '../../adk/adapters/jsonSchemaToZod';

// テストヘルパー: 実 Skill 全件を動的にロード
import { buildDefaultSkillRegistry } from '../../skills';

const opts = (skillName = 'test_skill') => ({ skillName });

// ============================================================================
// プリミティブ型
// ============================================================================

describe('jsonSchemaToZod: プリミティブ型', () => {
  it("type: 'string' → z.string()", () => {
    const result = jsonSchemaToZod({ type: 'string' }, opts());
    expect(result.safeParse('hello').success).toBe(true);
    expect(result.safeParse(123).success).toBe(false);
  });

  it("type: 'number' → z.number()", () => {
    const result = jsonSchemaToZod({ type: 'number' }, opts());
    expect(result.safeParse(1.5).success).toBe(true);
    expect(result.safeParse('1.5').success).toBe(false);
  });

  it("type: 'integer' → z.number().int()", () => {
    const result = jsonSchemaToZod({ type: 'integer' }, opts());
    expect(result.safeParse(42).success).toBe(true);
    expect(result.safeParse(1.5).success).toBe(false);
  });

  it("type: 'boolean' → z.boolean()", () => {
    const result = jsonSchemaToZod({ type: 'boolean' }, opts());
    expect(result.safeParse(true).success).toBe(true);
    expect(result.safeParse('true').success).toBe(false);
  });

  it("type: 'null' → z.null()", () => {
    const result = jsonSchemaToZod({ type: 'null' }, opts());
    expect(result.safeParse(null).success).toBe(true);
    expect(result.safeParse(undefined).success).toBe(false);
  });
});

// ============================================================================
// オブジェクト型
// ============================================================================

describe('jsonSchemaToZod: object 型', () => {
  it('properties + required 必須フィールド', () => {
    const result = jsonSchemaToZod(
      {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      },
      opts(),
    );
    expect(result.safeParse({ name: 'Alice', age: 30 }).success).toBe(true);
    expect(result.safeParse({ name: 'Bob' }).success).toBe(true); // age 任意
    expect(result.safeParse({ age: 30 }).success).toBe(false); // name 必須
  });

  it('required なし = 全 property optional', () => {
    const result = jsonSchemaToZod(
      {
        type: 'object',
        properties: { name: { type: 'string' } },
      },
      opts(),
    );
    expect(result.safeParse({}).success).toBe(true);
    expect(result.safeParse({ name: 'x' }).success).toBe(true);
  });

  it('properties なし object = z.object({})', () => {
    const result = jsonSchemaToZod({ type: 'object' }, opts());
    expect(result.safeParse({}).success).toBe(true);
  });

  it('ネスト object', () => {
    const result = jsonSchemaToZod(
      {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
        required: ['user'],
      },
      opts(),
    );
    expect(result.safeParse({ user: { name: 'Alice' } }).success).toBe(true);
    expect(result.safeParse({ user: {} }).success).toBe(false);
  });
});

// ============================================================================
// 配列型
// ============================================================================

describe('jsonSchemaToZod: array 型', () => {
  it('items: { type: string } → z.array(z.string())', () => {
    const result = jsonSchemaToZod(
      { type: 'array', items: { type: 'string' } },
      opts(),
    );
    expect(result.safeParse(['a', 'b']).success).toBe(true);
    expect(result.safeParse([1, 2]).success).toBe(false);
  });

  it('items が enum 配列', () => {
    const result = jsonSchemaToZod(
      {
        type: 'array',
        items: { type: 'string', enum: ['unverified', 'confirmed'] },
      },
      opts(),
    );
    expect(result.safeParse(['unverified', 'confirmed']).success).toBe(true);
    expect(result.safeParse(['invalid']).success).toBe(false);
  });

  it('items が object', () => {
    const result = jsonSchemaToZod(
      {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      opts(),
    );
    expect(result.safeParse([{ id: 'h1' }]).success).toBe(true);
    expect(result.safeParse([{}]).success).toBe(false);
  });

  it('items なし array は throw (要素型不明)', () => {
    expect(() =>
      jsonSchemaToZod({ type: 'array' }, opts()),
    ).toThrow(JsonSchemaToZodError);
  });
});

// ============================================================================
// enum
// ============================================================================

describe('jsonSchemaToZod: enum', () => {
  it('string enum → z.enum', () => {
    const result = jsonSchemaToZod(
      { type: 'string', enum: ['a', 'b', 'c'] },
      opts(),
    );
    expect(result.safeParse('a').success).toBe(true);
    expect(result.safeParse('x').success).toBe(false);
  });

  it('mixed enum (string + number) → z.union(z.literal())', () => {
    const result = jsonSchemaToZod(
      { enum: ['a', 1, true] },
      opts(),
    );
    expect(result.safeParse('a').success).toBe(true);
    expect(result.safeParse(1).success).toBe(true);
    expect(result.safeParse(true).success).toBe(true);
    expect(result.safeParse('x').success).toBe(false);
  });

  it('空 enum は throw', () => {
    expect(() =>
      jsonSchemaToZod({ enum: [] }, opts()),
    ).toThrow(JsonSchemaToZodError);
  });
});

// ============================================================================
// type union (type が配列)
// ============================================================================

describe('jsonSchemaToZod: type union (配列形)', () => {
  it("type: ['string', 'number'] → z.union", () => {
    const result = jsonSchemaToZod(
      { type: ['string', 'number'] },
      opts(),
    );
    expect(result.safeParse('hello').success).toBe(true);
    expect(result.safeParse(42).success).toBe(true);
    expect(result.safeParse(true).success).toBe(false);
  });
});

// ============================================================================
// description
// ============================================================================

describe('jsonSchemaToZod: description', () => {
  it('description → Zod .describe()', () => {
    const result = jsonSchemaToZod(
      { type: 'string', description: '通貨ペア' },
      opts(),
    );
    // Zod の internal description フィールドにアクセス
    expect(result.description).toBe('通貨ペア');
  });
});

// ============================================================================
// 未対応 schema → throw (z.any() で握りつぶさない)
// ============================================================================

describe('jsonSchemaToZod: 未対応 schema は throw', () => {
  it('pattern → throw with skill name + field path', () => {
    try {
      jsonSchemaToZod(
        { type: 'string', pattern: '^[a-z]+$' },
        { skillName: 'mySkill', fieldPath: 'name' },
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JsonSchemaToZodError);
      const e = err as JsonSchemaToZodError;
      expect(e.skillName).toBe('mySkill');
      expect(e.fieldPath).toBe('name');
      expect(e.message).toContain('pattern');
      expect(e.message).toContain('mySkill');
      expect(e.message).toContain('name');
    }
  });

  it('format → throw', () => {
    expect(() =>
      jsonSchemaToZod({ type: 'string', format: 'email' }, opts()),
    ).toThrow(JsonSchemaToZodError);
  });

  it('minimum / maximum → throw', () => {
    expect(() =>
      jsonSchemaToZod({ type: 'number', minimum: 0 }, opts()),
    ).toThrow(JsonSchemaToZodError);
    expect(() =>
      jsonSchemaToZod({ type: 'number', maximum: 100 }, opts()),
    ).toThrow(JsonSchemaToZodError);
  });

  it('minLength / maxLength → throw', () => {
    expect(() =>
      jsonSchemaToZod({ type: 'string', minLength: 1 }, opts()),
    ).toThrow(JsonSchemaToZodError);
  });

  it('oneOf / anyOf / allOf → throw', () => {
    expect(() =>
      jsonSchemaToZod({ oneOf: [{ type: 'string' }] }, opts()),
    ).toThrow(JsonSchemaToZodError);
    expect(() =>
      jsonSchemaToZod({ anyOf: [{ type: 'string' }] }, opts()),
    ).toThrow(JsonSchemaToZodError);
    expect(() =>
      jsonSchemaToZod({ allOf: [{ type: 'string' }] }, opts()),
    ).toThrow(JsonSchemaToZodError);
  });

  it('$ref → throw', () => {
    expect(() =>
      jsonSchemaToZod({ $ref: '#/definitions/foo' }, opts()),
    ).toThrow(JsonSchemaToZodError);
  });

  it('未知 type → throw', () => {
    expect(() =>
      jsonSchemaToZod({ type: 'unknown-type' }, opts()),
    ).toThrow(JsonSchemaToZodError);
  });

  it('ネスト object 内の未対応 schema でも throw + field path 表示', () => {
    try {
      jsonSchemaToZod(
        {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                email: { type: 'string', format: 'email' },
              },
            },
          },
        },
        { skillName: 'nested' },
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(JsonSchemaToZodError);
      const e = err as JsonSchemaToZodError;
      expect(e.fieldPath).toContain('user');
      expect(e.fieldPath).toContain('email');
    }
  });
});

// ============================================================================
// JsonSchemaToZodError クラス
// ============================================================================

describe('JsonSchemaToZodError', () => {
  it('skillName / fieldPath / reason を保持する', () => {
    const err = new JsonSchemaToZodError('mySkill', 'user.email', 'unsupported pattern');
    expect(err.skillName).toBe('mySkill');
    expect(err.fieldPath).toBe('user.email');
    expect(err.reason).toBe('unsupported pattern');
    expect(err.message).toContain('mySkill');
    expect(err.message).toContain('user.email');
    expect(err.message).toContain('unsupported pattern');
    expect(err.name).toBe('JsonSchemaToZodError');
  });

  it('Error の instanceof', () => {
    const err = new JsonSchemaToZodError('s', 'f', 'r');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(JsonSchemaToZodError);
  });
});

// ============================================================================
// 実 Skill の inputSchema 全件動作確認
// ============================================================================

describe('jsonSchemaToZod: 実 Skill 全件 (動的ロード)', () => {
  const skills = buildDefaultSkillRegistry().list();

  it('SkillRegistry に Skill が 1 件以上登録されている (テストの前提)', () => {
    expect(skills.length).toBeGreaterThan(0);
  });

  for (const skill of skills) {
    it(`Skill '${skill.name}' の inputSchema を変換できる`, () => {
      // throw しないこと = 全 features がサポート対象に含まれていること
      const zodSchema = jsonSchemaToZod(skill.inputSchema, { skillName: skill.name });
      // 結果は z.ZodObject (SkillInputSchema は常に type: 'object')
      expect(zodSchema).toBeDefined();
      expect(typeof zodSchema.safeParse).toBe('function');
    });
  }
});
