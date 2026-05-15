# バックエンド ESLint ハードニング作業サマリー（PR #56）

> **目的**: `fix/backend-lint-hardening` ブランチで行った一連の変更の**原因・対応・再発防止**を記録する。  
> **マージ**: `c665fd5`（`Merge pull request #56 from …/fix/backend-lint-hardening`）時点の内容に基づく。

---

## 1. 背景・目的

- バックエンド（ルートの `src/**/*.ts`、**フロントエンド・`analysis-engine` は除外**）に ESLint（`typescript-eslint`、type-aware）を導入・厳格化し、**ESLint エラーをゼロ**にする。
- プロジェクト規約（`any` / `unknown` の扱い、Zod による境界検証、型インポートの統一など）と CI を一致させる。

**主な参照ファイル**

- `eslint.config.mjs` — ルール・テスト／スクリプト向けオーバーライド
- `tsconfig.eslint.json` — lint 用プロジェクト（include / exclude）

---

## 2. 原因（なぜ大きな差分になったか）

###2.1 ルールと既存コードのギャップ

新規／強化されたルール例:

- `@typescript-eslint/no-explicit-any`
- `no-restricted-syntax`（`unknown` キーワードの直接使用を禁止 — 日本語メッセージで Zod 等を促す）
- `@typescript-eslint/no-floating-promises`
- `@typescript-eslint/consistent-type-imports`
- `@typescript-eslint/no-unused-vars`（`_` プレフィックスで許容）

既存コードでは、**HTTP 境界・CSV・Prisma JSON** などが緩い型や `unknown` 周りに残っており、ルール適用で一括して修正対象となった。

### 2.2 本番コードとテストの切り分け

- **本番コード**: `JsonValue`、Prisma JSON ヘルパー、Zod スキーマで境界を型安全に。
- **テスト（`*.test.ts` 等）・`scripts/**`**: モック・実行速度の都合で、`eslint.config.mjs` の **`files` オーバーライドで一部ルールを緩和**。

この二層構造を意識しないと、「テストでは通るが本番では禁止」のパターンを本番に持ち込むリスクがある。

### 2.3 附帯: `no-loss-of-precision` と `gammaLn`

- 高精度定数を **数値リテラル**で書くと `no-loss-of-precision` に抵触する場合がある。
- 対策として **`Number('…')` を関数内で毎回実行**すると、ホットパスで無駄なパースが発生する（Copilot レビュー指摘）。
- **対応**: 係数・定数を **モジュールスコープで一度だけ** `Number('…')` 初期化し、`gammaLn` 内では参照のみ（コミット `7d3a9d9`）。

---

## 3. 対応内容（コミット列の要約）

| 段階 | 内容 |
|------|------|
| 設定 | `eslint.config.mjs` 追加、`tsconfig.eslint.json` で lint 用パス定義 |
| 自動修正 | Prettier/ESLint 系の機械的修正を一括適用 |
| ルール調整 | 段階導入向けの緩急・オーバーライド |
| Side-B / 基盤 | JSON 境界、cTrader WebSocket、仮説・マッチング、ノート評価、Prisma JSON ヘルパー等 |
| API / サービス | `req.body`・CSV 行・indicator 設定などの **Zod 化**、cause 付与、同期 I/O の整理 |
| 仕上げ | バックエンド ESLint エラーゼロ（本番は JsonValue/Prisma、テストはルール緩和） |
| レビュー追随 | `parseCSVRow` コメントと実装の整合 |
| パフォーマンス | `gammaLn` 係数のモジュール初期化 |

**規模感（マージ直前のブランチ先端 `7d3a9d9` 付近）**: 約 194 ファイル、+4190 / −1645 行（ベース `0280267` との差分統計）。

---

## 4. 再発防止チェックリスト（新規 PR での確認用）

1. **バックエンド対象**で `eslint` が **エラー 0** か（フロントは別設定のため混同しない）。
2. **新規の `req.body` / クエリ / アップロード・CSV 行**に、プロジェクト方針どおり **Zod** を通したか。
3. **`unknown` を型として増やしていないか**（境界で具体型に閉じる）。
4. **`void` で誤魔化した浮動 Promise** を増やしていないか（適切に `await` / `.catch` / 明示的な設計）。
5. **ホットパスで `Number('高精度文字列')` を毎回実行していないか**（モジュール定数か、eslint-disable + コメントで意図を明記）。
6. **`coverage/**` 等の生成物をコミットに含めていないか**。

---

## 5. 関連

- **Pull Request**: #56（`fix/backend-lint-hardening` → `main`）
- **代表的な実装ファイル（例）**: `src/backend/services/backtestCalculations.ts`（`gammaLn` の定数配置）
- **プロジェクト全体のエージェント指示**: ルートの `AGENTS.md`、`CLAUDE.md`

---

*文書作成: 作業記録・再発防止用。ルール値や対象パスは `eslint.config.mjs` を正とする。*
