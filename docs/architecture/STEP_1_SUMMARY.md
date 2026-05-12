# STEP_1_SUMMARY.md - Step 1 (Skill → ADK FunctionTool アダプター) 完了サマリー

> **ステータス**: ✅ 完了 (2026-05-13)
> **期間**: 2026-05-13 (Phase 1 と Phase 2 を同日進行、各 Phase は別 PR)
> **完了 PR**: #164 (Phase 1) / #TBD (Phase 2)
> **次ステップ**: Step 2 (Tracing / Telemetry 統合) — Nekoさんが KICKOFF.md を作成予定

---

## 1. Step 1 の目的

Step 0 (設計ガード) で整備したガードレールを土台に、`@google/adk@1.1.0` を実コードに組み込む **最初の機能 Step**。既存 `SkillRegistry` (= 自律エージェントの 8 スキル群) を ADK Runner / LlmAgent から再利用可能な `FunctionTool[]` に変換するアダプターを実装する。

実現したこと:
1. ADK FunctionTool API の **実測検証** (T2.5 スパイク) と、検証に基づく設計確定
2. SkillInputSchema (JSONSchema draft-07 subset) → Zod 変換ユーティリティ (`jsonSchemaToZod`) の **自前実装** (外部パッケージ不採用)
3. ADK `Context` → 既存 `SkillContext` マッピング (`toSkillContext`)
4. `SkillRegistry` → `FunctionTool[]` factory (`skillRegistryToAdkTools`) と **等価性検証テスト**
5. 既存実装 (`/src/side-b/skills/`, `/src/side-b/agent/` 等) の **改変ゼロ** を git で確認

---

## 2. Phase 構造と完了 PR

| Phase | PR | 主要成果 |
|-------|----|----------|
| **Phase 1** (基盤 + 設計確定) | [#164](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/164) ✅ | `@google/adk@1.1.0` インストール、アダプター設計書 (Nekoさん T2 承認)、ADK FunctionTool API 実測スパイク (T2.5 承認、方式 B 確定)、`jsonSchemaToZod` 実装 (47 cases PASS、実 Skill 全 8 件検証)、Copilot レビュー 7 件全対応 |
| **Phase 2** (アダプター本体 + 等価性検証) | #TBD ✅ | `skillContext.ts` + `skillRegistryToAdkTools.ts` 本体実装、`_testHelpers.ts` (テスト専用)、等価性検証テスト (deep equal)、スパイク + smoke test 削除、`ADK_ADOPTION.md` §7 を完了状態に更新、`AGENTS.md` 更新 |

---

## 3. 確定した主要方針

Step 1 を通じて Nekoさん判断で確定した方針 (Step 2 以降に継続適用):

### 3.1 採用方式: 方式 B (Zod を直接渡す)

- **採用**: `jsonSchemaToZod(SkillInputSchema)` で Zod object に変換し、ADK FunctionTool `parameters` にそのまま渡す
- **不採用**: 方式 A (Schema 型変換) / 方式 C (parameters なし、execute 内で parse)
- **理由**: ADK の `parameters` 型が `z3/z4 ZodObject | Schema | undefined` を受け、内部で自動 `parse(req.args)` validation を行う。Zod ネイティブ対応 = 型安全性とデバッグ性が最も高い
- **詳細**: [`/src/side-b/adk/adapters/README.md`](../../src/side-b/adk/adapters/README.md) §4

### 3.2 SkillContext マッピング: 固定文字列 + フォールバック

- **`callerAgent`** ← `Context.agentName` (ReadonlyContext getter)、空文字なら `ADK_DEFAULT_CALLER_AGENT = 'adk-runner'`
- **`callerReason`** ← adapter 側定数 `ADK_DEFAULT_CALLER_REASON = 'invoked-via-adk-runner'` (ADK 標準に対応フィールドなし)
- **`timestamp`** ← `new Date()` (ADK 標準に対応フィールドなし)
- **理由**: 既存 `SkillContext` 型 (`src/side-b/skills/types.ts`) は不可侵領域。型は無改変、フォールバック値を埋めるだけ
- **詳細**: [`/src/side-b/adk/adapters/README.md`](../../src/side-b/adk/adapters/README.md) §3 / `skillContext.ts`

### 3.3 エラー伝播: アダプターでは throw しない

- **採用**: アダプター `execute` は `registry.invoke()` の戻り値 (`SkillResult`) を **そのまま return** する
- **理由**: 既存 `invoke()` の挙動 (`{ ok: false, error }` で例外を wrap) を完全保持。ADK 経由でも LLM 視点で構造化エラーが見える。等価性検証 (T7) で deep equal を担保
- **例外**: ADK の自動 Zod validation 失敗時 (`parameters.parse()` の throw) は ADK が `Error in tool '...': ...` で wrap して伝播。これは ADK 標準挙動のためアダプターでは捕捉しない
- **詳細**: [`/src/side-b/adk/adapters/README.md`](../../src/side-b/adk/adapters/README.md) §6

### 3.4 テスト経路: ADK public API のみ

- **採用**: `FunctionTool.runAsync()` (public method) のみ使用
- **不採用**: `FunctionTool.execute` (private field) / `_getDeclaration` (`_` prefix で internal 扱い)
- **理由**: 内部 API 依存テストは ADK SDK 更新で壊れる。public method 経由なら SDK バージョンアップで挙動が保証される
- **テスト用 Context mock**: `_testHelpers.ts` の `createMinimalAdkContext` (`Object.create(Context.prototype) + defineProperty` で必要最小限のみ)。本番コードからの import は禁止
- **詳細**: [`/src/side-b/adk/adapters/README.md`](../../src/side-b/adk/adapters/README.md) §8

### 3.5 jsonSchemaToZod の振る舞い (Nekoさん T2.5 承認)

- **外部パッケージ不採用** (json-schema-to-zod 等): 自前実装で変換可能範囲を明示的に文書化、未対応 schema は確実に throw
- **`z.any()` フォールバック禁止**: 未対応 schema は **必ず throw** (`JsonSchemaToZodError` with skillName + fieldPath)
- **`additionalProperties` の方針**: `false` → `.strict()` (reject)、`true` / 未指定 → strip (`passthrough()` は LLM 安全性のため採用しない)
- **詳細**: [`/src/side-b/adk/adapters/README.md`](../../src/side-b/adk/adapters/README.md) §4.7

---

## 4. 数値スナップショット (Step 1 完了時)

| 項目 | 値 |
|------|----|
| 新規実装ファイル (adapters/) | 4 (jsonSchemaToZod.ts / skillContext.ts / skillRegistryToAdkTools.ts / _testHelpers.ts) + README.md |
| 新規テストファイル (tests/adk/) | 4 (jsonSchemaToZod / skillContext / skillRegistryToAdkTools / equivalence) |
| 全テストケース | **71/71 PASS** (47 + 8 + 9 + 7) |
| 既存実装の変更 | **0 ファイル** (`git log --oneline -- src/side-b/skills/ src/side-b/agent/` で確認) |
| any / unknown 違反 | **0** (型ガード 1 箇所のみ ESLint コメントで例外宣言) |
| ADK SDK 内部 API 依存 | **0** (`@internal` / `_` prefix / private field への参照ゼロ) |
| 削除した使い捨てコード | scripts/adk_smoke_test.ts + scripts/adk_spike_methods.ts + scripts/adk_spike_typedefs.md (T8) |

---

## 5. ワークフロー実績

Step 0 で確立した「Phase 完了ごとに PR、Copilot レビュー対応、Nekoさんマージ判断」を継続:

| Phase | PR 提出 → Copilot レビュー → 対応 → マージ | 主な学び |
|-------|-------------------------------------------|---------|
| Phase 1 | PR #164 提出 → Copilot 7 件 (inline 3 + suppressed 4) → 全件対応 → マージ | suppressed 指摘も内容を見て対応する価値あり (重複削除、description 反映漏れ、追加プロパティ方針明文化) |
| Phase 2 | 本 PR | 等価性検証は実 Skill ではなくモック Skill で十分 (KICKOFF §T7 で許容) |

PR 作成後の自動マージ確認ポーリング (60s 間隔) により、Nekoさんが外部デバイスからマージするだけで次 Phase が自動着手される運用を維持。

---

## 6. Step 2 への引き継ぎ事項

Step 1 完了時点で **未対応 / 継続検討** の項目:

1. **本番 Runner / LlmAgent への統合**: `skillRegistryToAdkTools()` は実装済みだが、実際に ADK Runner や LlmAgent.tools に渡して動作させる統合は Step 2 以降のスコープ。本 Step では単体機能の正しさに集中
2. **Tracing 統合**: 現状 `SkillContext.timestamp` は `new Date()` で生成しているが、ADK の `invocationId` / `functionCallId` を将来 Tracing で使う想定 (README §3 注記)。Step 2 で対応
3. **session-less 設計の継続**: Step 1 では session を扱わない (T2.5 承認方針)。Step 2 以降で session が必要になった時点で `DatabaseSessionService` 不採用方針 (ADK_ADOPTION.md §2.2) との整合を再確認

Step 0 から継続している**ユーザー対応依頼** (本 Step では未着手):
- main ブランチ保護ルール設定
- ESLint 既存違反 488 件の段階解消
- tsconfig audit 違反 1423 件の side-b 優先解消

---

## 7. 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [`ADK_ADOPTION.md`](./ADK_ADOPTION.md) | ADK 段階導入計画 (§7 実装状況を Step 1 完了に更新) |
| [`STEP_1_KICKOFF.md`](./STEP_1_KICKOFF.md) | Step 1 全体の作業手順書 (Nekoさん作成) |
| [`STEP_0_SUMMARY.md`](./STEP_0_SUMMARY.md) | Step 0 (設計ガード) 完了サマリー |
| [`/src/side-b/adk/adapters/README.md`](../../src/side-b/adk/adapters/README.md) | アダプター設計書 (Nekoさん T2 / T2.5 承認、§3 §4 §6 §8 確定) |
| [`/src/side-b/adk/AGENTS.md`](../../src/side-b/adk/AGENTS.md) | ADK サイドカー領域の作業ルール (依存方向制約等) |

---

> **Step 1 完了**: 2026-05-13。ADK FunctionTool アダプター基盤確立。次は Step 2 (Tracing) — KICKOFF.md は Nekoさん作成待ち。
