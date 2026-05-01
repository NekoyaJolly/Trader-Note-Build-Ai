# Backend Lint Baseline (2026-05-02)

> `fix/backend-lint-hardening` ブランチで進めている lint hardening の現状把握用 baseline。
> CI で `npm run lint` がスクリプト不在のため握り潰されていた状態を、今後 errors=0 にしてから CI 有効化するための基準。

## 計測条件

- **対象ブランチ**: `main` (HEAD = 78bf905 / PR-B 適用後 + PR-A マージ済み)
- **計測コマンド**: `npm run lint:backend`
  - `eslint "src/**/*.ts" --ignore-pattern "src/frontend/**" --ignore-pattern "**/*.test.ts" --ignore-pattern "**/*.spec.ts"`
- **計測日時**: 2026-05-02 深夜
- **テストコード側 (`lint:backend:tests`)**: ESLint v10 の glob 互換性問題で動作せず、別途調査要

## 現状サマリー

| 区分 | 件数 |
|---|---|
| **Total** | **293 problems** |
| Errors | **184** |
| Warnings | **109** |
| 影響ファイル数 | **103** |

> 直近で 1500 件超 → 293 件まで削減済み(Nekoさん 主導の hardening 進行中)

## ルール別内訳(Top 12)

| Rule | 件数 |
|---|---|
| `@typescript-eslint/no-unused-vars` | 42 |
| `@typescript-eslint/no-unsafe-assignment` | 39 |
| `@typescript-eslint/require-await` | 33 |
| `@typescript-eslint/no-unsafe-argument` | 21 |
| `@typescript-eslint/no-unsafe-member-access` | 11 |
| `@typescript-eslint/consistent-type-imports` | 6 |
| `@typescript-eslint/no-unsafe-call` | 5 |
| `@typescript-eslint/restrict-template-expressions` | 4 |
| `@typescript-eslint/no-floating-promises` | 3 |
| `@typescript-eslint/no-unsafe-enum-comparison` | 1 |
| `@typescript-eslint/no-namespace` | 1 |
| `@typescript-eslint/no-base-to-string` | 1 |

### 観察

- **`no-unused-vars` (42 件)**: 単純削除で対応可。低リスク・大量に潰せる
- **`no-unsafe-*` (76 件 = 39 + 21 + 11 + 5)**: 多くは Prisma 結果や `req.body` などの any 化由来。zod / Pick で型を絞ることで解消(中規模 refactor)
- **`require-await` (33 件)**: SSE / express handler で意図的なものと、本当に await 不要なものが混在。1 件ずつ確認必要
- **`consistent-type-imports` (6 件)**: `import type { X }` への自動修正可。`--fix` で潰せるはず

## ディレクトリ別影響(top-level)

| ディレクトリ | 影響ファイル数 |
|---|---|
| `src/side-b/` | 47 |
| `src/services/` | 24 |
| `src/backend/` | 16 |
| `src/infrastructure/` | 5 |
| `src/schemas/` | 4 |
| `src/middleware/` | 2 |
| `src/domain/` | 2 |
| その他 | 3 (`src/mcp-server`, `src/index.ts`, `src/app.ts`) |

## CI 統合の現状(問題)

`.github/workflows/ci.yml:52`:

```yaml
- name: ESLint チェック
  run: npm run lint --if-present || echo "ESLint スキップ"
```

`package.json` には `"lint"` というスクリプトが存在せず、`--if-present` でスキップされ、`|| echo` でエラーも握り潰されている。**結果として CI で ESLint は 1 行も動いていない**。

歴史的経緯(推定): 当初 `lint` 1 本だったのが、`lint:backend` / `lint:backend:tests` に分割されたタイミングで CI workflow が古い参照のまま取り残された。

## 対応計画(別 PR)

### 段階 1: `lint:backend` の **errors を 0** にする(warnings は残す)

優先順位:
1. `no-unused-vars` 42 件(最も機械的)
2. `consistent-type-imports` 6 件(`--fix` で自動)
3. `no-unsafe-*` 76 件(file 単位で zod / Pick refactor)
4. `require-await` 33 件(意図的 / 不要を 1 件ずつ判定)
5. その他散発的なもの

### 段階 2: CI 統合

- `package.json` に `"lint": "npm run lint:backend"` を追加
- CI workflow を `npm run lint:backend` 直呼びに修正
- `lint:backend:tests` の glob 互換性問題を別途修正

### 段階 3: warnings の段階的削減

errors=0 維持しつつ、warnings 109 件を計画的に潰す。`--max-warnings 0` を導入して新規 warnings をブロックする運用に。

## 関連

- `fix/backend-lint-hardening` ブランチで Nekoさん 主導の hardening 進行中
- PR #69 (Critical-PrismaClient PR-A) の strategyNoteService.ts で `no-unsafe-return` 1 件を修正済み(機械的 fix の例)
- PR #70 (Critical-PrismaClient PR-B) でも同種の warnings を発見、機械的範囲外として別 PR スコープに切り出し
