---
applyTo: "src/side-b/**/*.ts,src/frontend/app/side-b/**/*.tsx"
---

# Side-B 実装ガイドライン

## このファイルが適用されるパス
- `src/side-b/**/*.ts` - Side-B バックエンド
- `src/frontend/app/side-b/**/*.tsx` - Side-B フロントエンド

---

## コーディング規約

### 必須
- コメントは日本語で記述
- `any` / `unknown` 型は使用禁止
- Zodスキーマでランタイムバリデーション
- エラーハンドリングは明示的に

### AIサービス実装時
- Research AI: `gpt-4o-mini` を使用
- Plan AI: `gpt-4o` を使用
- AI出力は必ずZodでパース
- 失敗時は最大3回リトライ

### リポジトリ実装時
- Prisma Client を使用
- トランザクションは適切に使用
- 期限切れキャッシュの扱いを考慮

---

## 型定義

12次元特徴量は `src/side-b/models/featureVector.ts` で定義。
各値は 0-100 の範囲で正規化。

```typescript
// 必ずこのインターフェースを使用
import { FeatureVector12D } from '../models/featureVector';
```

---

## テスト

- 新規ファイルには対応するテストを作成
- テストファイル: `*.test.ts`
- AIレスポンスはモックを使用

---

## 禁止事項

❌ 以下は絶対に実装しない:
- 実際の取引所への発注
- 自動売買ロジック
- Side-A コードの直接編集
