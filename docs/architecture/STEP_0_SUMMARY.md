# STEP_0_SUMMARY.md - Step 0 (設計ガード) 完了サマリー

> **ステータス**: ✅ 完了 (2026-05-12)
> **期間**: 2026-05-12 (3 セッション + クロージング 1 PR)
> **完了 PR**: #155 / #156 / #157 / #158
> **次ステップ**: Step 1 (Skill → ADK FunctionTool アダプター) — Nekoさんが KICKOFF.md を作成予定

---

## 1. Step 0 の目的

Trader-Note-Build-AI プロジェクトに Google ADK (Agent Development Kit) を段階導入する計画の **最初の Step**。**コードを 1 行も書く前に**、エージェント (Claude Code / Cursor / Gemini) が遵守すべきガードレールを整備することが目的。

実現したこと:
1. 全エージェント・全ディレクトリ共通の **単一情報源**を確立 (`/AGENTS.md` 正本)
2. ディレクトリ階層に応じた**特化ルールの配置場所**を確立
3. `any` / `unknown` などの **型安全規約** を設計書層 (L1) と CI 層 (L3) の両方で強制
4. ADK 採用範囲・撤退基準・実装状況管理の運用ルールを明文化

---

## 2. Phase 構造と完了 PR

| Phase | PR | 主要成果 |
|-------|----|----------|
| **Phase A** (設計書層 L1) | [#155](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/155) ✅ | ルート `/AGENTS.md` 正本化、CLAUDE/.cursorrules/GEMINI シム化、`/src/side-b/AGENTS.md` 新設、ADK サイドカー scaffold、`ADK_ADOPTION.md` 作成 |
| **Phase B** (CI/CD 層 L3) | [#156](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/156) ✅ | tsconfig strict 強化 (audit 分離)、ESLint 5 規則 error 化 + `ban-ts-comment` 追加、**unknown 禁止方針確定** を AGENTS.md 群に反映 |
| **Phase C** (IDE 層 + 環境準備) | [#157](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/157) ✅ | pre-commit hook 確認 (`simple-git-hooks` 既存利用)、`@google/adk` dry-run、ADK_ADOPTION.md §7 を完了状態に更新 |
| **クロージング** (ADK 採用方針確定) | [#158](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/158) ✅ | `--legacy-peer-deps` 採用、`DatabaseSessionService` 系不採用、Prisma 単独 ORM 維持 |

---

## 3. 確定した主要方針

Step 0 を通じて Nekoさん判断で確定した方針 (Step 1 以降に継続適用):

### 3.1 型安全方針: `any` も `unknown` も書かない (案B 規約強化)

- **対象**: 本番コード全般
- **例外**: `**/*.test.ts`, `**/*.spec.ts`, `tests/**/*.ts`, `scripts/**/*.ts`
- **理由**: 規約を甘くするとエラーが多発する傾向にあるため、ESLint 実態 (`TSUnknownKeyword` error) に合わせて規約側を強化
- **反映先**: `/AGENTS.md` 最優先5原則 §2 / §2 / §2.1、`/src/side-b/AGENTS.md`、`/src/side-b/adk/AGENTS.md`、`/.cursorrules` の全 blockquote
- **詳細**: [`STEP_0_ESLINT_AUDIT.md`](./STEP_0_ESLINT_AUDIT.md)

### 3.2 `@ts-ignore` / `@ts-nocheck`: 一切の例外なし禁止

- **対象**: tests/scripts 含む全コード
- **例外**: `@ts-expect-error` のみ description 10 文字以上付きで限定許可 (ESLint `ban-ts-comment` の `allow-with-description`)
- **詳細**: [`STEP_0_ESLINT_AUDIT.md`](./STEP_0_ESLINT_AUDIT.md) §1.4

### 3.3 ADK 採用方針: MikroORM 不採用 / Prisma 単独 ORM

- **インストール**: `npm install @google/adk --legacy-peer-deps` で peer dep の MikroORM 要件を解決対象から外す
- **採用しない**: `DatabaseSessionService` および ADK 内部の永続化 API
- **採用する**: `Runner` / `SequentialAgent` / `ParallelAgent` / `LoopAgent` / `FunctionTool` / `Tracing`
- **代替**: セッション / 状態管理は既存 `src/side-b/agent/agentMemory.ts` (Prisma 経由) を継続活用、必要に応じ Prisma ベースで自作
- **理由**: Prisma で既に作り込んでおり MikroORM 導入は ORM 二重管理。プロジェクト全体で **ORM は Prisma 単独**
- **詳細**: [`ADK_ADOPTION.md`](./ADK_ADOPTION.md) §2.2 / §2.3、[`STEP_0_ADK_INSTALL_DRYRUN.md`](./STEP_0_ADK_INSTALL_DRYRUN.md) §3

### 3.4 ワークフロー方針: Phase 完了ごとに PR

- main 直接 commit 禁止
- PR (Code) → Copilot レビュー → 対応 (Code) → マージ判断 (Nekoさん) の 4 ステップ
- Phase 完了 = PR の最小単位

---

## 4. tsconfig audit 分離 (Phase B の重要な設計判断)

Phase B Ticket B1 で当初は本番 `tsconfig.json` に直接 strict オプション 3 つを追加していたが、PR #156 の Copilot レビュー指摘で **`npm run build` / `next build` が破壊される** ことが発覚 → audit 専用ファイルに分離する方式に変更。

```
/tsconfig.json                    # 本番 (strict のみ、build/dev 用)
/tsconfig.audit.json              # 監査用 (extends + 3 オプション)
/src/frontend/tsconfig.json       # 本番 (strict のみ、next build 用)
/src/frontend/tsconfig.audit.json # 監査用 (extends + 3 オプション)
```

これにより:
- 本番 tsc: **0 errors** (ビルド・CI 動作保証)
- audit tsc: 1044 (root) + 379 (frontend) = **1423 errors** を継続観察

**詳細**: [`STEP_0_TSCONFIG_AUDIT.md`](./STEP_0_TSCONFIG_AUDIT.md)

---

## 5. 監査レポート一覧 (合計 6 件)

| ドキュメント | 内容 |
|-------------|------|
| [`STEP_0_ANALYSIS.md`](./STEP_0_ANALYSIS.md) | 既存設計書 (旧 AGENTS/CLAUDE/DESIGN) 全 57 項目の分類結果と再配置先 (G/D/F/C)、Q1〜Q7 ユーザー承認内容 |
| [`STEP_0_TSCONFIG_AUDIT.md`](./STEP_0_TSCONFIG_AUDIT.md) | tsconfig audit 3 オプション (`noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`) 追加で検出された 1423 errors の内訳と推奨対応 |
| [`STEP_0_ESLINT_AUDIT.md`](./STEP_0_ESLINT_AUDIT.md) | ESLint 5 規則 error 化 + `ban-ts-comment` 追加による 488 errors + 237 warnings の内訳と推奨対応 |
| [`STEP_0_CI_STATUS.md`](./STEP_0_CI_STATUS.md) | CI / ブランチ保護の現状 (ESLint は root に lint script 不在で未実行、main は保護未設定)、ユーザー対応依頼 |
| [`STEP_0_HUSKY_SETUP.md`](./STEP_0_HUSKY_SETUP.md) | pre-commit hook (`simple-git-hooks` + `lint-staged` 既存導入) の確認と Mac/Windows 動作確認手順 |
| [`STEP_0_ADK_INSTALL_DRYRUN.md`](./STEP_0_ADK_INSTALL_DRYRUN.md) | `@google/adk@1.1.0` dry-run 結果と peer dep (MikroORM) 不整合の対応方針 |

---

## 6. Step 0 完了後も継続する課題 (Nekoさん側対応)

これらは Step 1 着手と並行して、または別途のタイミングで Nekoさん側の対応が必要:

1. **main ブランチ保護ルール設定** (`Settings → Branches → Add rule`)
   - 必須 status check: `Lint & TypeCheck`
   - 詳細: [`STEP_0_CI_STATUS.md`](./STEP_0_CI_STATUS.md) §3.1
2. **ESLint PR ゲート化と既存違反 488 件の段階解消**
   - 現状 root に `lint` スクリプト不在で CI 上 ESLint 未実行
   - 詳細: [`STEP_0_CI_STATUS.md`](./STEP_0_CI_STATUS.md) §3.2 / [`STEP_0_ESLINT_AUDIT.md`](./STEP_0_ESLINT_AUDIT.md) §4
3. **Frontend tsc を CI に追加するか判断**
   - 詳細: [`STEP_0_CI_STATUS.md`](./STEP_0_CI_STATUS.md) §3.3
4. **tsconfig audit 違反 1423 件の side-b 優先解消**
   - 別 PR で順次対応 (Step 0 完了後)
   - 詳細: [`STEP_0_TSCONFIG_AUDIT.md`](./STEP_0_TSCONFIG_AUDIT.md) §5.1

5. ~~**@google/adk peer dep 対応方針**~~ → **✅ 確定済み (2026-05-12)**: §3.3 参照

---

## 7. 数値スナップショット

| 項目 | 値 |
|------|----|
| 期間 | 2026-05-12 (1 日) |
| セッション数 | 3 (Phase A / B / C) + クロージング 1 |
| PR 数 | 4 (#155, #156, #157, #158) |
| コミット数 | Phase A 8 + Phase B 6 + Phase C 3 + クロージング 1 + Copilot レビュー対応 3 = **約 21 commits** |
| Copilot レビュー | 4 件 (Phase A) + 4 件 (Phase B) + 3 件 (Phase C) = **11 件、全件対応済み** |
| 新規ドキュメント | AGENTS.md 群 5 ファイル + 監査レポート 6 件 + ADK_ADOPTION.md + 本書 = **13 件** |
| 検出した既存違反 (修正は別 PR で順次解消) | tsconfig audit 1423 errors / ESLint 488 errors + 237 warnings |
| 本番 tsc | 0 errors (ビルド回帰なし、audit 分離方式) |

---

## 8. 次ステップ

**Step 1: Skill → ADK FunctionTool アダプター** へ移行。

- Nekoさん側で `docs/design/STEP_1_KICKOFF.md` を作成 (Step 0 と同流儀)
- 作成後、Claude Code がそれを読み Phase A から実装着手
- ワークフロー: Phase 完了ごとに PR → Copilot レビュー対応 → Nekoさんマージ判断

---

## 9. 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [`docs/design/STEP_0_KICKOFF.md`](../design/STEP_0_KICKOFF.md) | Step 0 のキックオフ (作業手順書、本書の元になった計画) |
| [`docs/architecture/ADK_ADOPTION.md`](./ADK_ADOPTION.md) | ADK 段階導入の採用範囲・撤退基準・実装状況 (Step 1 以降も継続更新) |
| [`/AGENTS.md`](../../AGENTS.md) | 全エージェント共通ルール (正本) |
| [`/src/side-b/AGENTS.md`](../../src/side-b/AGENTS.md) | side-b 固有ルール |
| [`/src/side-b/adk/AGENTS.md`](../../src/side-b/adk/AGENTS.md) | ADK サイドカー領域固有ルール |

---

> **作成日**: 2026-05-12
> **最終更新**: 2026-05-12
