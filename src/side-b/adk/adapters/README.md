# SkillRegistry → ADK FunctionTool アダプター 設計書

> **チケット**: Step 1 Ticket T2 (初期ドラフト) → T2.5 着手中
> **作成日**: 2026-05-13
> **ステータス**: ✅ **T2 ユーザー承認済み (2026-05-13)** / T2.5 スパイク進行中
> **Nekoさん承認時の追加方針** (§3 §8 に反映済み): callerReason フォールバック方針、ADK public API 経由テスト限定
> **計画書**: `docs/architecture/STEP_1_KICKOFF.md` §Ticket T2
> **位置づけ**: ADK 段階導入 Step 1 のサイドカー設計
> **依存方向**: `adk → 既存` (skills, agent 等) のみ。逆向きは禁止

---

## ⚠️ セクションの確定状態 (重要)

本書のセクションには **2 種類** ある:

- ✅ **確定** (§1, §2, §5, §7): 計画書 KICKOFF.md および既存 ADK_ADOPTION.md の方針に基づき、本 T2 ドラフト時点で確定。T2.5 以降で原則変更しない
- 🔍 **T2.5 検証対象** (§3, §4, §6, §8): 現時点では**仮説**。T2.5 スパイクで `@google/adk@1.1.0` の実 API を確認した後、実測結果で更新する

---

## 1. 目的 ✅ 確定

既存の `SkillRegistry` (`/src/side-b/skills/registry.ts`) を **ADK Runner から利用可能な FunctionTool 配列として露出する**。

これにより、Step 2 以降で ADK Agent から既存 Skill を呼び出せる土台を作る。

### スコープ外 (= 本 Step 1 でやらないこと)

- ADK Agent 実装 (Step 2+ で扱う)
- ADK Tracing 統合 (Step 2 範囲)
- 既存 `SkillRegistry` / `Skill` の API 改変 (不可侵領域、`ADK_ADOPTION.md` §6)
- 既存 AgentLoop / PDCALoop から ADK アダプターを呼び出すこと (依存方向違反)

---

## 2. 採用するアダプターパターン ✅ 確定

### 2.1 factory 関数アプローチ

`SkillRegistry` を **1 つのファサードツール**として公開せず、`SkillRegistry.list()` を走査して **1 Skill = 1 FunctionTool** として配列を生成する factory 関数を提供する。

```typescript
// 想定するシグネチャ (T2.5 完了後に確定)
export function skillRegistryToAdkTools(registry: SkillRegistry): FunctionTool[];
```

### 2.2 理由

ADK Agent は `tools` 配列を受け取る API である。`SkillRegistry` を 1 つの汎用ツールとして露出すると、ADK 側で「どの Skill を呼ぶか」を引数で指定する不自然な API になる。1 Skill = 1 FunctionTool の方が:

- ADK Agent の自然な呼び出し慣習に合致
- ADK の Tracing が「どの Skill が呼ばれたか」を tool name 単位で記録できる
- ADK の tool filtering / authorization 機構を Skill 単位で活用できる

### 2.3 対比: 既存 `toMcpToolDefinitions()`

既存 `SkillRegistry.toMcpToolDefinitions()` は MCP 互換の **tool definition 配列** を返す。本アダプターはその ADK 版にあたる: 「定義配列を返す」という方針は既存と同じ。違いは ADK の `FunctionTool` 型に合わせること。

---

## 3. SkillContext マッピング 🔍 T2.5 検証対象

### 3.1 既存 `SkillContext`

```typescript
// src/side-b/skills/types.ts
export interface SkillContext {
  callerAgent?: string;     // 呼び出し元エージェント名 (例: 'discovery', 'strategist')
  callerReason?: string;    // LLM が自由記述で渡す呼び出し理由
  timestamp: Date;          // 呼び出し時刻 (省略時は現在時刻)
}
```

### 3.2 仮説: ADK 実行 context から構築

ADK の Tool 実行時 context (callerAgent / trace_id / invocation_id 相当を含む想定) から `SkillContext` を構築する変換関数 `toSkillContext()` を提供する。

```typescript
// 仮の型 (T2.5 で実型を確定)
export function toSkillContext(adkContext: <T2.5 で確定>): SkillContext;
```

### 3.3 T2.5 で検証する項目

| 項目 | 確認内容 |
|------|---------|
| `callerAgent` 相当 | ADK 実行 context のどのフィールドから取得できるか / フィールド名 |
| `callerReason` 相当 | ADK 側で LLM が自由記述する位置はあるか (なければ固定文字列で代用) |
| `timestamp` 相当 | ADK 側で取得可能か / なければ `new Date()` で生成 |
| `trace_id` / `invocation_id` | ADK 標準フィールドの実態と、`SkillContext` 拡張の必要性 |
| フィールド欠落時 | フォールバック挙動 (例: `callerAgent ?? 'adk-runner'`) |

### 3.4 マッピングの確定時期

T2.5 完了時に本セクションを実 ADK context 型で書き直す。フィールド欠落フォールバックも T2.5 で確定。

### 3.5 ✅ Nekoさん承認時の追加方針 (2026-05-13)

**`callerReason` の取り扱い** (T2 approved with note):

- ADK 標準 Context に `callerReason` 相当が存在しない可能性が高い
- T2.5 で取得不能と判明した場合の対応:
  - **固定文字列**: 例えば `'invoked-via-adk'` のような adapter 側定数として埋める
  - または **adapter 側定数**として明示的に export (例: `ADK_DEFAULT_CALLER_REASON`)
- **重要**: 既存 `SkillContext` 型 (`src/side-b/skills/types.ts`) は**変更しない**
  - 不可侵領域 (`ADK_ADOPTION.md` §6 / `/src/side-b/skills/` 改変禁止) と整合
  - `callerReason?: string` のまま、フォールバック値を埋めるだけ

→ T2.5 で `callerReason` 相当の ADK フィールドの有無を確認し、無ければ本方針に従う。

---

## 4. 型変換方針 (parameters) 🔍 T2.5 検証対象 — 3 案併記

### 4.1 既存 `SkillInputSchema`

```typescript
// src/side-b/skills/types.ts
export interface SkillInputSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}
```

JSONSchema draft-07 サブセット (OpenAI function calling / MCP 互換)。

### 4.2 3 つの実装方式

#### 方式 A: SkillInputSchema → ADK Schema として最小変換

```typescript
// 概念
const tool = new FunctionTool({
  name: skill.name,
  description: skill.description,
  parameters: adaptToAdkSchema(skill.inputSchema), // 形を ADK Schema 型に合わせるのみ
  fn: async (args, ctx) => { /* skill.execute を呼ぶ */ },
});
```

- **メリット**: 変換が浅く、依存ライブラリ追加不要。実装が単純
- **デメリット**: ADK Schema 型が JSONSchema と互換でない場合、変換が複雑化

#### 方式 B: SkillInputSchema → Zod object に変換

```typescript
// 概念
const zodSchema = jsonSchemaToZod(skill.inputSchema); // 新規 ユーティリティ
const tool = new FunctionTool({
  name: skill.name,
  description: skill.description,
  parameters: zodSchema, // ADK が Zod を直接受けるなら
  fn: async (args, ctx) => { /* skill.execute を呼ぶ */ },
});
```

- **メリット**: ADK が Zod-native の場合、型安全性が高い
- **デメリット**: `jsonSchemaToZod()` 自作 or npm パッケージ追加が必要 (= T3 が発生)
- **必要条件**: ADK の parameters が Zod を受けることが T2.5 で確認できた場合

#### 方式 C: 最小 schema + 実行時 Zod parse を Skill 側に委譲

```typescript
// 概念
const tool = new FunctionTool({
  name: skill.name,
  description: skill.description,
  parameters: { /* tool declaration 用の最小限の型情報のみ */ },
  fn: async (args, ctx) => {
    // ADK validation は最小限。詳細 validation は skill.execute() 内の Zod parse に委譲
    return await registry.invoke(skill.name, args, toSkillContext(ctx));
  },
});
```

- **メリット**: 既存 Skill が内部で Zod parse を行っている前提なら最小実装
- **デメリット**: ADK 側の自動 validation が効かず、LLM の不正引数検出が後ろ倒し

### 4.3 採用方式の決定基準

T2.5 で以下を確認した上で決定:

- ADK `FunctionTool` constructor の `parameters` フィールドの**期待型** (Zod / JSONSchema / 独自?)
- ADK が parameters から **runtime validation** を行うか / 行うとしてどういう挙動か
- Zod を受ける場合の Zod バージョン要件

T2.5 完了後、本セクションで **採用方式 (A/B/C) と理由** を明記。不採用方式の理由も併記。

---

## 5. session-less 設計 ✅ 確定

### 5.1 方針

Skill は **stateless** として扱う。ADK の Session オブジェクトに状態を保存しない。

### 5.2 理由

- 既存 `Skill` は実行時 `context` (callerAgent 等) を受けるが、Skill 自体は状態を持たない設計
- 状態管理は既存 `agentMemory` (`/src/side-b/agent/agentMemory.ts`、Prisma 経由) を継続活用
- ADK の `DatabaseSessionService` は MikroORM 依存のため**採用しない** (`ADK_ADOPTION.md` §2.2 / §2.3)

### 5.3 結果

ADK 経由でも直接経由でも、Skill の挙動は同一であるべき (= §8 の等価性検証の前提)。

---

## 6. エラー伝播 🔍 T2.5 検証対象

### 6.1 既存 `Skill.invoke()` の挙動

```typescript
// SkillRegistry.invoke() の戻り値型
type SkillResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };
```

- Skill 内部の例外を catch して `{ ok: false, error: ... }` でラップ
- throw は呼び出し側に伝播しない (= 既存パターン: 「エラーを握りつぶさず、構造化して返す」)

### 6.2 仮説: ADK 経由のエラー伝播

| シナリオ | 既存 `invoke()` の戻り値 | ADK 経由でどう返す? (仮説) |
|---------|------------------------|-------------------------|
| 成功 | `{ ok: true, data }` | tool 戻り値として data |
| Skill 内例外 | `{ ok: false, error: {code, message} }` | ADK の tool error 慣習形式 (T2.5 で確認) |
| Zod parse 失敗 | `{ ok: false, error: { code: 'ZodError', ... } }` | 同上 |

### 6.3 T2.5 で検証する項目

- ADK が期待する tool エラー形式 (throw / `{status: 'error'}` / `{ok: false}` / etc.)
- ADK Runner がエラーをトレースする経路 (Tracing 統合時のため)
- tool 実行のタイムアウト・キャンセル機構の有無

### 6.4 確定方針

- アダプター内で **throw しない** (= 既存と同じ「握りつぶさない、構造化して返す」)
- ADK が期待するエラー形式に変換 (T2.5 で確定)

---

## 7. ディレクトリ構成 ✅ 確定 (一部 T2.5 で追加)

```
/src/side-b/adk/adapters/
├── README.md                 # 本設計書
├── (T2.5 結果次第で追加ファイルが決まる)
```

Phase 1 完了時の想定構成 (採用方式によって変動):

```
/src/side-b/adk/adapters/
├── README.md
├── jsonSchemaToZod.ts        # T3 (方式 B 採用時のみ)
├── jsonSchemaToZod.test.ts   # 同上
```

Phase 2 完了時の想定構成:

```
/src/side-b/adk/adapters/
├── README.md
├── jsonSchemaToZod.ts                  # 方式 B 採用時のみ
├── jsonSchemaToZod.test.ts             # 同上
├── skillContext.ts                     # T5
├── skillContext.test.ts                # T5
├── skillRegistryToAdkTools.ts          # T6
├── skillRegistryToAdkTools.test.ts     # T6
├── equivalence.test.ts                 # T7
```

---

## 8. テスト戦略 🔍 T2.5 検証対象

### 8.1 想定するテストレイヤー

| レイヤー | 対象 | 実装場所 | 備考 |
|---------|------|---------|------|
| ユニット (変換) | `jsonSchemaToZod()` | T3 (方式 B のみ) | プリミティブ / 配列 / オブジェクト / enum / union / null 網羅 |
| ユニット (context) | `toSkillContext()` | T5 | フィールド欠落フォールバック含む |
| ユニット (アダプター) | `skillRegistryToAdkTools()` | T6 | 空 registry / 1 Skill / N Skill / parameters 整合 / エラー変換 |
| **等価性** | ADK 経由 vs 直接 invoke | T7 | 同一入力 → 同一出力を deep equal で検証 |

### 8.2 T2.5 で検証する項目

- ADK SDK 内部の `FunctionTool.execute()` が **public API か internal か**
- public でない場合、Runner や Agent 経由でしか呼べないかを確認
- テストでアダプター単体の検証が可能な経路を特定

### 8.3 等価性検証 (T7) の経路

T2.5 で確定したテスト経路を T7 で利用。**ADK SDK の public API を使う**ことが原則 (internal API 利用は脆い)。

### 8.4 ✅ Nekoさん承認時の追加方針 (2026-05-13)

**ADK public API 経由テストの厳格化** (T2 approved with note):

T2.5 で `FunctionTool` の公開実行 API が以下のいずれかと判明した場合の対応を明文化:

| ケース | T7 等価性検証の経路 |
|--------|--------------------|
| `execute()` が public method として露出 | `execute()` 直接呼び出し可 |
| **`runAsync()` または相当が public method** | `runAsync()` 経由でテスト (`execute()` は internal 扱いの可能性) |
| **Runner / Agent 経由でしか実行できない** | Runner / Agent を T7 テストで構築 (mock Agent + ADK Runner 経由) |
| internal/private な execute のみ | **internal API には依存しない** (= Runner 経由のテストに変更) |

**禁止**: ADK SDK の internal / private API (`@internal` JSDoc、underscore prefix、d.ts 非公開等) に依存するテストコード。脆い (SDK 更新で壊れる) ため。

T2.5 で確定した実行経路を T7 設計時に厳守する。

---

## 9. 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| `docs/architecture/STEP_1_KICKOFF.md` | Step 1 全体の作業手順書 (Nekoさん作成) |
| `docs/architecture/ADK_ADOPTION.md` | ADK 採用範囲・撤退基準・不可侵領域 |
| `docs/architecture/STEP_0_ADK_INSTALL_DRYRUN.md` | @google/adk dry-run 結果 + peer dep 対応方針 |
| `/src/side-b/adk/AGENTS.md` | ADK サイドカー領域の作業ルール (依存方向制約等) |
| `/src/side-b/skills/types.ts` | 既存 Skill / SkillRegistry / SkillContext の型定義 |
| `/src/side-b/skills/registry.ts` | 既存 SkillRegistry の実装 |

---

## 10. ユーザーレビュー履歴

### T2 (初期ドラフト): ✅ 承認済み (2026-05-13)

**Nekoさん回答**: `T2 approved with note` (2 件)

1. **callerReason フォールバック方針** → §3.5 に反映
2. **ADK public API 経由テスト限定 (internal/private API 不依存)** → §8.4 に反映

承認に基づき T2.5 (実測スパイク) に進行中。

### T2.5 (実測スパイク完了後): 🔍 ユーザー承認待ち

T2.5 完了時に本書の §3 / §4 / §6 / §8 を実測結果で更新し、採用方式 (A/B/C) を確定。再度ユーザーレビューを依頼する。
