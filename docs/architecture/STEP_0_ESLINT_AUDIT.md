# STEP_0_ESLINT_AUDIT.md - ESLint 規則強化監査

> **チケット**: Ticket B2
> **作成日**: 2026-05-12
> **対象**: ルート `eslint.config.mjs` (Frontend は ignores で除外、独自設定は `src/frontend/eslint.config.mjs` で `nextTs` 適用済み)
> **方針**: 既存違反は**修正しない**。レポートのみ (KICKOFF.md §B2)

---

## 1. 追加・変更した規則

### 1.1 warn → error に格上げ (5 規則)

| 規則 | 旧 | 新 | 効果 |
|------|-----|-----|------|
| `@typescript-eslint/no-unsafe-assignment` | warn | **error** | `any` への代入を error 化 |
| `@typescript-eslint/no-unsafe-member-access` | warn | **error** | `any` のメンバーアクセスを error 化 |
| `@typescript-eslint/no-unsafe-argument` | warn | **error** | `any` を引数として渡すのを error 化 |
| `@typescript-eslint/no-unsafe-call` | warn | **error** | `any` の呼び出しを error 化 |
| `@typescript-eslint/no-unsafe-return` | warn | **error** | `any` を return するのを error 化 |

### 1.2 新規追加 (1 規則)

| 規則 | レベル | 設定 |
|------|-------|------|
| `@typescript-eslint/ban-ts-comment` | **error** | `ts-ignore: true` `ts-nocheck: true` (一切の例外なし) `ts-expect-error: 'allow-with-description'` (description 10 文字以上必須) |

### 1.3 既存の error 規則 (変更なし、参考)

- `@typescript-eslint/no-explicit-any`: error (既存)
- `no-restricted-syntax` (TSUnknownKeyword 禁止): error (既存)
- `@typescript-eslint/no-floating-promises`: error
- `@typescript-eslint/no-misused-promises`: error
- `@typescript-eslint/consistent-type-imports`: error
- `@typescript-eslint/no-unused-vars`: error

### 1.4 tests/scripts での例外設定

`**/*.test.ts`, `**/*.spec.ts`, `tests/**/*.ts`, `scripts/**/*.ts` では以下を off に:
- `no-restricted-syntax` (TSUnknownKeyword 禁止) — テストで unknown 利用許可
- `@typescript-eslint/no-explicit-any`
- `@typescript-eslint/unbound-method`
- `@typescript-eslint/no-unsafe-*` (5 規則すべて)
- `@typescript-eslint/ban-ts-comment` (本 PR で追加)

---

## 2. 違反件数

| 段階 | errors | warnings | 合計 |
|------|--------|----------|------|
| ベースライン (Phase A 完了直後、warn 含む) | 261 | 464 | 725 |
| **規則強化後** | **488** | **237** | **725** |
| 差分 | +227 (error 化) | -227 (warn から格上げ) | 0 |

合計件数は同じ 725 (規則自体が増えていないため新規違反なし)。**227 件が warn → error に格上げ**された。

`@typescript-eslint/ban-ts-comment` (新規追加) の違反は **0 件**。本番コード上に既存の `@ts-ignore` `@ts-nocheck` は存在しなかった。

---

## 3. 規則別違反件数 (Top 15)

| 件数 | 規則 | レベル | 起因 |
|------|------|--------|------|
| 208 | `@typescript-eslint/require-await` | warn | 既存 (本 PR 変更なし) |
| 109 | `no-restricted-syntax` (TSUnknownKeyword) | **error** | 既存 (unknown 型禁止) |
| 91 | `@typescript-eslint/no-unsafe-member-access` | **error** | 本 PR で格上げ |
| 75 | `@typescript-eslint/no-unsafe-assignment` | **error** | 本 PR で格上げ |
| 44 | `@typescript-eslint/no-unnecessary-type-assertion` | error (既存) | recommendedTypeChecked |
| 33 | `@typescript-eslint/no-unsafe-argument` | **error** | 本 PR で格上げ |
| 29 | `@typescript-eslint/no-explicit-any` | error (既存) | 既存 (any 型禁止) |
| 27 | `@typescript-eslint/consistent-type-imports` | error (既存) | |
| 20 | `@typescript-eslint/no-unsafe-call` | **error** | 本 PR で格上げ |
| 19 | `@typescript-eslint/restrict-template-expressions` | error (既存) | recommendedTypeChecked |
| 18 | `@typescript-eslint/no-unused-vars` | error (既存) | |
| 8 | `@typescript-eslint/no-unsafe-return` | **error** | 本 PR で格上げ |
| 8 | `@typescript-eslint/no-base-to-string` | error (既存) | recommendedTypeChecked |
| 7 | `@typescript-eslint/parser` | parse error | 個別調査が必要 |
| 4 | `@typescript-eslint/unbound-method` | error (既存) | |

### 観察

- **TSUnknownKeyword 違反 109 件** は本番コードに残る `unknown` 型利用箇所。Phase B Ticket B2 で確定した「unknown 禁止」方針 (本 PR で AGENTS.md 群に明文化) に従い、別 PR で順次解消する
- `no-unsafe-*` 5 規則の合計は 91 + 75 + 33 + 20 + 8 = **227 件**。これは「any 由来の伝播」が発生している箇所。`@typescript-eslint/no-explicit-any` (29 件) の解消とセットで対応すべき
- `ts-ignore` `ts-nocheck` の既存違反は **0 件**。`ban-ts-comment` 追加による既存コード破壊はない

---

## 4. 影響範囲 (推奨対応の優先順位)

### 4.1 規則別優先順位 (推奨)

| 優先 | 対応対象 | 件数 | 推奨対応 |
|------|----------|------|----------|
| ★1 | `no-restricted-syntax` (TSUnknownKeyword) | 109 | side-b 優先で `unknown` を Zod スキーマでの具体型に置き換え |
| ★2 | `@typescript-eslint/no-explicit-any` | 29 | `any` の具体型化。下流の `no-unsafe-*` も連鎖解消する |
| 3 | `@typescript-eslint/no-unsafe-*` (連鎖) | 227 | ★2 の解消で大幅減。残った箇所は個別対応 |
| 4 | `@typescript-eslint/require-await` (warn) | 208 | 不要な `async` を削除 (重要度低、warn のまま放置可) |
| 5 | `@typescript-eslint/no-unnecessary-type-assertion` | 44 | 不要な `as T` を削除 |
| 6 | `@typescript-eslint/consistent-type-imports` | 27 | `import type` への置換 (`--fix` で自動修正可) |

### 4.2 段階的解消方針

KICKOFF.md §B2 の禁止事項に従い、本チケットでは違反を修正しない。Step 0 完了後、上記優先順 1〜6 を別 PR として順次解消する。

- side-b 優先 (PromptRegistry / EdgeLedger 等の不可侵領域に触れる場合は ADK_ADOPTION.md §6 のレビュー)
- ★1〜★2 を解消すれば連鎖して 200〜300 件が自動的に減る見込み
- `--fix` で自動修正可能なものは ESLint 単体で 69 errors + 29 warnings (合計 98 件) が修正可能

---

## 5. 監査スナップショット

- 計測日: 2026-05-12
- 計測コマンド: `npx eslint .` (リポジトリルート)
- ESLint バージョン: `package.json` 記載に従う
- ベースライン: feature/step0-phase-b checkout 直後 (PR #155 マージ直後の main)
- 規則強化後: 本 PR commit ae23da3 以降の eslint.config.mjs に基づく

---

## 6. 関連変更 (同 PR 内)

本チケット (B2) は ESLint 規則強化に加え、Phase A の Copilot 指摘 (2) で保留されていた **「unknown 禁止」方針** を確定する。同 PR で以下を更新済み:

- `/AGENTS.md` 冒頭 blockquote §2 と §2 / §2.1 (確定方針として書き換え)
- `/src/side-b/AGENTS.md` 冒頭 blockquote §2
- `/src/side-b/adk/AGENTS.md` 冒頭 blockquote §2
- `/.cursorrules` §2 自動補完 (any + unknown 両方を採用しない)

詳細経緯: Nekoさん判断 (2026-05-12 PR #155 マージ時)「規約を甘くすると最終的にエラーが多発する傾向にあるため、案B (規約強化) を採用」。
