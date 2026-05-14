# Step 4 Lens Parallel Agent Report (PR 1: Phase 0+1+2)

> **作成日**: 2026-05-14
> **対象**: Step 4 Phase 0 (棚卸し) / Phase 1 (静的確認) / Phase 2 (単体 Lens sub-agent wrapper) の実装結果
> **設計書**: [`STEP_4_KICKOFF.md`](./STEP_4_KICKOFF.md)
> **ステータス**: PR 1 完了。Phase 3-6 は後続 PR で追記。

---

## 0. 結論サマリー (先出し)

| 項目 | 結果 |
|---|---|
| Lens 数 (`registerDefaultLenses`) | **8 本** (current_analysis / time_session / dow_theory / volatility_regime / pattern / smc / chart_pattern / wyckoff) |
| Lens 不可侵性チェック | ✅ 全 Lens で DB / network / file / random / global state / 他 Lens 依存 **ゼロ** |
| 失敗分離 (`Promise.allSettled`) | ✅ `LensAggregator.computeAll` で既存実装あり |
| 純粋関数性違反 | ❌ なし (Step 4 対象外候補 = ゼロ) |
| determinism 比較除外フィールド | `LensFeature.computedAt` / `LensFeature.computeDurationMs` (Phase 4 で確定) |
| Phase 2 wrapper 実装 | `src/side-b/adk/agents/lensParallelSmoke.ts` 新規 (`LensSubAgent` + `createLensSubAgent`) |
| Phase 2 test 結果 | **23 cases pass** (新規) |
| ADK 領域累計 | **200 cases pass** (Step 1-3 既存 177 + Phase 2 新規 23) |
| 既存不可侵領域 git diff | ✅ ゼロ (`src/side-b/lenses/` / `src/side-b/agent/` / `src/side-b/skills/` / `prisma/schema.prisma`) |

---

## 1. Phase 0: 事前棚卸し結果

### 1.1 Lens 一覧

`src/side-b/lenses/index.ts` の `registerDefaultLenses()` で登録される 8 Lens:

| # | lensName | クラス | dependencies (主要) | 由来 |
|---|---|---|---|---|
| 1 | `current_analysis` | `CurrentAnalysisLens` | `ohlcv` / `existingAnalysis` | Phase 1 |
| 2 | `time_session` | `TimeSessionLens` | `symbol` / `timestamp` | Phase 1 + PR ⑤D-1 |
| 3 | `dow_theory` | `DowTheoryLens` | `ohlcvBars` | Phase 3 |
| 4 | `volatility_regime` | `VolatilityRegimeLens` | `ohlcvBars` | Phase 3 |
| 5 | `pattern` | `PatternLens` | `precomputedPatternFlags` | PR ②-1 / PR ④F (ローソク足、基本) |
| 6 | `smc` | `SMCLens` | `precomputedSmcStructures` | Phase 7a |
| 7 | `chart_pattern` | `ChartPatternLens` | `precomputedChartPatterns` | Phase 7b (N-bar、応用) |
| 8 | `wyckoff` | `WyckoffLens` | `precomputedWyckoffPhases` | Phase 7c |

各 Lens は同一の `Lens` interface (`src/side-b/lenses/types.ts`) を実装し、`compute(input: LensInput): Promise<LensFeature>` を提供する。

### 1.2 Lens 型契約 (`types.ts`)

| 型 | 役割 |
|---|---|
| `Lens` | 各 Lens 共通の interface。`name` / `version` / `dependencies` / `compute()` |
| `LensInput` | 全 Lens 共通の入力。`symbol` / `timeframe` / `timestamp` + optional payload 群 |
| `LensFeature` | 各 Lens の出力。`lensName` / `lensVersion` / `features` (`Record<string, number\|string\|boolean>`) / `computedAt` / `computeDurationMs?` / `confidence?` |
| `LensFeatureSnapshot` | `LensAggregator.computeAll` の集約結果 |
| `SerializedLensFeatureSnapshot` | 永続化用 JSON 形式 |

**重要な型制約**: `LensFeature.features` は `Readonly<Record<string, number | string | boolean>>`。null / array / object 不可。「なし」は sentinel (`-1.0` / `-1` / `'NONE'` / `'EQUILIBRIUM'` / `'UNKNOWN'` 等) で表現 (Phase 7 で確立)。

### 1.3 既存 `LensAggregator` の特性

`src/side-b/lenses/LensAggregator.ts`:

- `register(lens)` / `unregister(name)` で動的登録、`getRegisteredLenses()` で順序保持の名前一覧
- `computeAll(input)` は **`Promise.allSettled` で全 Lens を並列実行**
- 失敗した Lens は `console.error` で記録、`features` Map には含めない (= 失敗分離 ✅)
- 戻り値 `LensFeatureSnapshot` には成功 Lens の結果のみ集約

**ParallelAgent との関係**: 既に並列実行モデルが存在するため、Step 4 はその上に ADK trace 観測層を被せる構造になる。LensAggregator 自体は ADK サイドカーから利用するだけで改変しない。

### 1.4 既存 Lens テスト状況

`src/side-b/tests/lenses/` 配下:

- `currentAnalysisLens.test.ts` / `TimeSessionLens.test.ts` / `DowTheoryLens.test.ts` / `VolatilityRegimeLens.test.ts` / `PatternLens.test.ts` / `SMCLens.test.ts` / `ChartPatternLens.test.ts` / `WyckoffLens.test.ts` + 統合 test
- 各 Lens で `determinism` を扱うテストが存在 (= Step 4 の Phase 4 で再利用可能)
- Phase 7 完了時点で lenses 領域 **138 cases** (61 既存 + 19 SMC + 18 ChartPattern + 20 Wyckoff + その他、内訳は `phase_7_summary.md` §1)

### 1.5 Step 3 成果物の再利用可否

| Step 3 建材 | Step 4 PR 1 での利用 |
|---|---|
| `BaseAgent` 直接サブクラス (`SmokeSubAgent`) パターン | ✅ `LensSubAgent` で同パターン採用 |
| `safeRecord` ヘルパー | ✅ `lensParallelSmoke.ts` 内に同名/同実装で配置 |
| `adk.subagent.started/completed/failed` event kind | ✅ そのまま再利用 (KICKOFF §4.3 / `traceTypes.ts` 既存) |
| `skillName` フィールドの step 識別子としての再利用 | ✅ Lens 名を `skillName` に格納 |
| `Runner.runEphemeral` + `InMemorySessionService` | ✅ test で同構成 |
| `shortenErrorMessage` / `DEFAULT_ERROR_MESSAGE_MAX` | ✅ failed event の `errorMessage` 短縮で使用 |
| `InMemoryTraceSink` | ✅ test で trace 検証用に使用 |
| `extractSubAgentOrder` 相当 helper | ⬜ Phase 3 (ParallelAgent 並列実行) で必要なら追加 |

新規追加は最小限。Step 4 PR 2 で `createDryRunLensParallelAgent` / `runLensParallelSmoke` を additive で追加する予定。

---

## 2. Phase 1: 純粋関数性 静的確認結果

### 2.1 grep 検索結果 (`src/side-b/lenses/` 配下)

検索パターン: `(prisma|PrismaClient|fetch\(|axios|fs\.|writeFile|readFile|Math\.random|Date\.now|new Date\(|globalThis|process\.env)`

| 検索対象 | 検出数 | 詳細 |
|---|---|---|
| `prisma` / `PrismaClient` | 0 | ❌ DB アクセスなし |
| `fetch(` / `axios` | 0 | ❌ ネットワーク呼び出しなし |
| `fs.*` / `writeFile` / `readFile` | 0 | ❌ ファイル IO なし |
| `Math.random` | 0 | ❌ ランダム要素なし |
| `globalThis` | 0 | ❌ グローバル mutable state なし |
| `process.env` | 0 | ❌ 環境変数依存なし |
| `Date.now()` / `new Date()` | 多数 | ⚠️ ただし全件が `computedAt` / `computeDurationMs` (volatile field) の生成用、features 内には登場しない |

### 2.2 `Date.now()` の使われ方詳細

| Lens / file | 使用箇所 | 用途 | features に影響? |
|---|---|---|---|
| `LensAggregator.ts` | L67, L91 | `totalComputeDurationMs` 計算 | features 外 |
| `CurrentAnalysisLens.ts` 他 7 Lens | 各 compute 冒頭 | `computedAt` / `computeDurationMs` 計算 | features 外 |
| `TimeSessionLens.ts` | L49: `if (ts.getTime() > Date.now() + 60_000)` | input 未来時刻 validation (60s 余裕) | features 外 (throw 判定のみ) |

**結論**: `Date.now()` / `new Date()` は features 値計算には使われていない。determinism 比較対象は `LensFeature.features` 中心で OK。

`TimeSessionLens` の未来時刻 validation は 60s 余裕があるため、同一 `input.timestamp` を渡す限り `Date.now()` の微差で結果が変わることはない (実機テストで同入力 → 同出力を確認、Phase 4 で再検証予定)。

### 2.3 他 Lens 依存の確認

`src/side-b/lenses/` 配下で `from './XxxLens'` 形式の他 Lens import を grep:

```
(該当なし、各 Lens は他 Lens を import せず、types.ts と utils/ のみを参照)
```

✅ レンズ独立性 (ドメイン原則 §4) を全 Lens で遵守。

### 2.4 determinism 比較除外フィールド

KICKOFF §4.2 / §8.2 で「volatile field は除外」と明記。本 Phase で確定:

| field | 除外理由 |
|---|---|
| `LensFeature.computedAt` | `new Date()` で生成、実行ごとに異なる |
| `LensFeature.computeDurationMs` | `Date.now()` 差分、CPU 負荷で変動 |

比較対象は以下とする (Phase 4 で再確認):

- `LensFeature.lensName`
- `LensFeature.lensVersion`
- `LensFeature.features` (= 観測値本体)
- `LensFeature.confidence`

### 2.5 Step 4 対象外候補

**該当なし**。全 8 Lens が ParallelAgent 載せ替え可能と判定。

---

## 3. Phase 2: 単体 Lens sub-agent wrapper 実装結果

### 3.1 新規ファイル

| ファイル | 内容 | 行数 |
|---|---|---|
| `src/side-b/adk/agents/lensParallelSmoke.ts` | `LensSubAgent` クラス + `createLensSubAgent` factory + `LENS_PARALLEL_SMOKE_CALLER_REASON` + `safeRecord` ヘルパー | ~260 |
| `src/side-b/tests/adk/agents/lensParallelSmoke.test.ts` | Phase 2 単体 test 23 cases | ~470 |

### 3.2 採用方式

`LensSubAgent`:

- `BaseAgent` 直接 subclass (LLM 非依存、Step 3 `SmokeSubAgent` と同パターン)
- constructor で `lens` / `input` / `traceSink?` / `nameOverride?` を受け取る
- `runAsyncImpl` 内で:
  1. `adk.subagent.started` event を `traceSink` に record (skillName = lens.name)
  2. `lens.compute(input)` を呼び、結果を `this.result` に保存
  3. `Event` を 1 件 `yield` (Runner event stream 用、本文は `${lens.name} computed` のみ)
  4. 成功: `adk.subagent.completed` を record (status: 'ok'、resultSummary は redacted: true + fieldCount)
  5. 失敗: `adk.subagent.failed` を record (status: 'thrown'、errorCode: 'LENS_SUBAGENT_THROWN'、errorMessage 短縮) → throw を呼び出し元に伝播
- `getResult()` / `getError()` / `getLensName()` / `getLensVersion()` で外部から状態取得

`callerReason`: `lens_parallel_dry_run` (Step 4 共通固定値、KICKOFF §4.3)

`safeRecord`: Step 2/3 と同実装。`traceSink.record()` の同期 throw / Promise reject を握りつぶし、本処理を壊さない。

### 3.3 trace event に乗せる情報 (raw 不保存)

KICKOFF §4.3 の「保存してよい」リストに準拠:

| フィールド | 内容 | 備考 |
|---|---|---|
| `kind` | `adk.subagent.{started,completed,failed}` | Step 3 既存 kind を再利用 |
| `traceId` / `parentTraceId` | UUID | started ↔ completed/failed の紐付け |
| `agentName` | `BaseAgent.name` (override 可) | |
| `skillName` | `lens.name` | step 識別子としての再利用 |
| `callerReason` | `lens_parallel_dry_run` | 固定値 |
| `startedAt` / `endedAt` / `durationMs` | Date / number | completed/failed のみ endedAt+durationMs |
| `status` | `started` / `ok` / `thrown` | |
| `errorCode` | `LENS_SUBAGENT_THROWN` | failed のみ |
| `errorMessage` | 短縮版 (最大 500 文字) | failed のみ、`shortenErrorMessage` 経由 |
| `resultSummary.fieldCount` | features 数 | completed のみ、raw key 名は乗らない |
| `resultSummary.redacted` | `true` (型レベルマーカー) | raw 値非保存の証拠 |

raw input / Lens features の中身 / Lens dependencies は **trace event に乗せない**。

### 3.4 Phase 2 test 内訳 (23 cases)

| グループ | cases | 主な検証 |
|---|---|---|
| `createLensSubAgent: 構築物` | 5 | name 伝搬 / nameOverride / version / traceSink 省略 / 都度新規 instance |
| 成功時の trace | 7 | started→completed 順 / parentTraceId / callerReason / skillName / resultSummary / getResult / durationMs |
| 失敗時の trace | 5 | started→failed 順 / errorCode / errorMessage 短縮 / getError / throw 伝播 |
| traceSink 失敗握りつぶし | 3 | 同期 throw OK / Promise reject OK / Lens 失敗時の throw 伝播 |
| raw payload 不保存 | 2 | secret value 非漏洩 / redacted: true |
| 実 Lens 統合 smoke | 1 | TimeSessionLens 1 件通す |

### 3.5 test double 構成 (KICKOFF §8.3)

`DeterministicFakeLens` / `ThrowingFakeLens` を test 内で定義し、wrapper の責務だけを検証。実 Lens (`TimeSessionLens`) は最後の 1 cases のみで薄く統合 smoke。

`SlowFakeLens` は Phase 3 (ParallelAgent 並列実行の同時性検証) で必要になるため次 PR で追加予定。

---

## 4. KICKOFF DoD 達成状況 (PR 1 範囲)

### 4.1 Phase 0 DoD

- [x] Lens 一覧を実コードから確認している (§1.1)
- [x] Step 3 の trace / BaseAgent パターンを流用できるか確認している (§1.5)
- [x] 実装前提を report に書いている (本書 §1)

### 4.2 Phase 1 DoD

- [x] DB / network / file write がないか確認済み (§2.1)
- [x] global mutable state がないか確認済み (§2.1)
- [x] randomness がないか確認済み (§2.1)
- [x] determinism 比較から除外すべき volatile field を明記している (§2.4)

### 4.3 Phase 2 DoD

- [x] 1 Lens を ADK sub-agent として実行できる (`LensSubAgent` 実装 + 23 test pass)
- [x] 既存 Lens 実装に git diff がない (本 PR では `src/side-b/lenses/` 改変ゼロ)
- [x] trace 契約が Step 3 と互換 (既存 `adk.subagent.*` kind / `skillName` 流用、新規 event kind 追加なし)

---

## 5. 次 PR への引き継ぎ事項

### 5.1 PR 2 (Phase 3: ParallelAgent dry-run)

- `createDryRunLensParallelAgent(lenses, options)` factory: 複数 `LensSubAgent` を `ParallelAgent` で束ねる
- `runLensParallelSmoke(input, options)`: ParallelAgent を `Runner.runEphemeral` で実行し、各 Lens の `LensFeature` を lensName で安定ソートして返す
- `SlowFakeLens` test double: 並列実行の同時性検証用 (Promise.race 的なシナリオ)
- KICKOFF §4.2 / §5 Phase 3 の DoD 検証

### 5.2 PR 3 (Phase 4-6: 決定性 / 失敗分離 / 完了処理)

- Phase 4: 同入力 → 同 features の実機検証、failed Lens が他 Lens を巻き込まない、ADK 経由 vs 直接実行の features 一致
- Phase 5: ADK 領域 + lenses 領域 + side-b 全体の regression 確認
- Phase 6: `STEP_4_SUMMARY.md` 作成 / `ADK_ADOPTION.md` Step 4 進捗更新 / agents/README.md 追記

---

## 6. 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| [`STEP_4_KICKOFF.md`](./STEP_4_KICKOFF.md) | Step 4 KICKOFF (本書はその Phase 0-2 完了報告) |
| [`STEP_3_SUMMARY.md`](./STEP_3_SUMMARY.md) | Step 3 完了サマリー (建材の出典) |
| [`STEP_3_SEQUENTIAL_AGENT_NOTES.md`](./STEP_3_SEQUENTIAL_AGENT_NOTES.md) | Step 3 Phase 2 (`adk.subagent.*` trace 契約の根拠) |
| [`../design/phase_7_summary.md`](../design/phase_7_summary.md) | Phase 7 完了サマリー (Lens 8 本拡張) |
| [`ADK_ADOPTION.md`](./ADK_ADOPTION.md) | ADK 段階導入計画 |
| [`/AGENTS.md`](../../AGENTS.md) | ドメイン原則 §4 (Lens 独立・純粋・決定性) |
| [`/src/side-b/adk/agents/lensParallelSmoke.ts`](../../src/side-b/adk/agents/lensParallelSmoke.ts) | Phase 2 wrapper 実装本体 |
| [`/src/side-b/tests/adk/agents/lensParallelSmoke.test.ts`](../../src/side-b/tests/adk/agents/lensParallelSmoke.test.ts) | Phase 2 test |
