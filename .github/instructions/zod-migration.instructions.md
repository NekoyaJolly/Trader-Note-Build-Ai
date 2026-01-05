---
applyTo: "src/**/*.ts,src/**/*.tsx"
---

# Zod バリデーション必須ガイドライン

## 概要

本プロジェクトでは **Zod によるランタイムバリデーションが必須** です。
手動の if 文によるバリデーションは禁止されています。

---

## スキーマ配置ルール

### 共通スキーマ: `src/schemas/`

```
src/schemas/
├── index.ts           # 全エクスポート
├── common.ts          # 共通スキーマ（日付、ページネーション、ID等）
├── api/               # APIエンドポイント別スキーマ
│   ├── trade.ts       # トレード関連
│   ├── note.ts        # ノート関連
│   ├── profile.ts     # プロファイル関連
│   ├── indicator.ts   # インジケーター関連
│   ├── notification.ts # 通知関連
│   └── sideB.ts       # Side-B関連
└── external/          # 外部APIレスポンススキーマ
    ├── twelveData.ts  # Twelve Data API
    └── openai.ts      # OpenAI API
```

---

## 実装パターン

### 1. APIリクエストバリデーション

```typescript
// ✅ 正しい例: Zodスキーマを使用
import { CreateProfileRequestSchema } from '@/schemas/api/profile';

router.post('/', async (req: Request, res: Response) => {
  // safeParse でバリデーション
  const result = CreateProfileRequestSchema.safeParse(req.body);
  
  if (!result.success) {
    // Zodエラーを整形して返却
    return res.status(400).json({
      success: false,
      error: 'バリデーションエラー',
      details: result.error.format(),
    });
  }
  
  // result.data は型安全
  const { name, indicators } = result.data;
  // ...
});

// ❌ 禁止: 手動if文によるバリデーション
router.post('/', async (req, res) => {
  if (!req.body.name || typeof req.body.name !== 'string') {
    return res.status(400).json({ error: 'プロファイル名は必須です' });
  }
  // ...
});
```

### 2. 外部APIレスポンスパース

```typescript
// ✅ 正しい例: Zodでパース
import { TwelveDataResponseSchema } from '@/schemas/external/twelveData';

const response = await fetch(url);
const json = await response.json();

const result = TwelveDataResponseSchema.safeParse(json);
if (!result.success) {
  throw new Error(`Twelve Data APIレスポンスが不正: ${result.error.message}`);
}

const data = result.data; // 型安全

// ❌ 禁止: as any や as SomeType でのキャスト
const data = await response.json() as any;
const data = await response.json() as TwelveDataResponse;
```

### 3. AI出力パース

```typescript
// ✅ 正しい例: AI出力をZodでパース
import { TradePlanAIOutputSchema } from '@/schemas/api/sideB';

const aiResponse = await callOpenAI(prompt);
const content = aiResponse.choices[0]?.message?.content;

// JSON部分を抽出してパース
const jsonMatch = content?.match(/```json\n([\s\S]*?)\n```/);
if (!jsonMatch) {
  throw new Error('AI出力にJSONが含まれていません');
}

const result = TradePlanAIOutputSchema.safeParse(JSON.parse(jsonMatch[1]));
if (!result.success) {
  console.error('AI出力パースエラー:', result.error);
  // リトライロジック
}

const plan = result.data;
```

### 4. 型定義の生成

```typescript
// ✅ 正しい例: スキーマから型を生成
// src/schemas/api/profile.ts
import { z } from 'zod';

export const IndicatorConfigSchema = z.object({
  configId: z.string(),
  indicatorId: z.string(),
  label: z.string(),
  params: z.record(z.union([z.number(), z.string(), z.boolean()])),
  enabled: z.boolean(),
});

export const CreateProfileRequestSchema = z.object({
  name: z.string().min(1, 'プロファイル名は必須です'),
  description: z.string().optional(),
  indicators: z.array(IndicatorConfigSchema),
  isDefault: z.boolean().optional(),
});

// 型はスキーマから推論（手動で型定義を書かない）
export type IndicatorConfig = z.infer<typeof IndicatorConfigSchema>;
export type CreateProfileRequest = z.infer<typeof CreateProfileRequestSchema>;

// ❌ 禁止: 手動で型定義を書いてスキーマと二重管理
interface CreateProfileRequest {
  name: string;
  description?: string;
  // ...
}
```

---

## 共通スキーマ例

### common.ts

```typescript
import { z } from 'zod';

// 日付スキーマ（ISO文字列またはDateオブジェクト）
export const DateSchema = z.union([
  z.string().datetime(),
  z.date(),
]).transform((val) => (typeof val === 'string' ? new Date(val) : val));

// ページネーション
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// UUID
export const UUIDSchema = z.string().uuid();

// 成功レスポンス
export const SuccessResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

// エラーレスポンス
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  details: z.unknown().optional(),
});
```

---

## エラーハンドリング

### 共通バリデーションミドルウェア

```typescript
// src/middleware/validateRequest.ts
import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

// バリデーションエラーを整形
export function formatZodError(error: ZodError): string {
  return error.errors
    .map((e) => `${e.path.join('.')}: ${e.message}`)
    .join(', ');
}

// リクエストボディのバリデーションミドルウェア
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: 'バリデーションエラー',
        details: formatZodError(result.error),
      });
    }
    req.body = result.data;
    next();
  };
}

// クエリパラメータのバリデーション
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: 'クエリパラメータが不正です',
        details: formatZodError(result.error),
      });
    }
    req.query = result.data as any;
    next();
  };
}
```

### ルートでの使用

```typescript
import { validateBody, validateQuery } from '@/middleware/validateRequest';
import { CreateProfileRequestSchema, GetProfilesQuerySchema } from '@/schemas/api/profile';

router.get('/', validateQuery(GetProfilesQuerySchema), async (req, res) => {
  // req.query は型安全
});

router.post('/', validateBody(CreateProfileRequestSchema), async (req, res) => {
  // req.body は型安全
});
```

---

## 移行チェックリスト

新しいエンドポイントを実装する際、または既存コードを修正する際は以下を確認:

- [ ] リクエストボディのZodスキーマが `src/schemas/api/` に存在する
- [ ] クエリパラメータのZodスキーマが定義されている
- [ ] 型は `z.infer<>` でスキーマから生成されている
- [ ] 外部APIレスポンスはZodでパースされている
- [ ] AI出力はZodでパースされている
- [ ] `as any` や `as SomeType` を使用していない
- [ ] 手動のif文バリデーションを使用していない

---

## 禁止パターン

```typescript
// ❌ 禁止: any型
const data = await response.json() as any;

// ❌ 禁止: 型アサーションのみ（ランタイム検証なし）
const { name } = req.body as CreateProfileRequest;

// ❌ 禁止: 手動if文バリデーション
if (!req.body.name || typeof req.body.name !== 'string') {
  return res.status(400).json({ error: '...' });
}

// ❌ 禁止: 型定義とスキーマの二重管理
interface MyType { ... }  // 手動定義
const MySchema = z.object({ ... }); // 別途スキーマ
```

---

## 参考リンク

- Zod公式ドキュメント: https://zod.dev
- AGENTS.md の型安全ルールセクション
