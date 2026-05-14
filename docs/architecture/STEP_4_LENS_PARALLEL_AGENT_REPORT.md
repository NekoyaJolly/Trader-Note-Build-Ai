# Step 4 Lens Parallel Agent Report (PR 1+2+3: Phase 0-6 完全版)

> **作成日**: 2026-05-14 (PR 1)、2026-05-14 (PR 2 追記)、2026-05-14 (PR 3 追記)
> **対象**: Step 4 全 Phase (Phase 0-6) の実装結果
> **設計書**: [`STEP_4_KICKOFF.md`](./STEP_4_KICKOFF.md)
> **ステータス**: ✅ 全 Phase 完了 (2026-05-14)。最終総括は [`STEP_4_SUMMARY.md`](./STEP_4_SUMMARY.md)

---

## 0. 結論サマリー (先出し)

| 項目 | 結果 |
|---|---|
| Lens 数 (`registerDefaultLenses`) | **8 本** (current_analysis / time_session / dow_theory / volatility_regime / pattern / smc / chart_pattern / wyckoff) |
| Lens 不可侵性チェック | ✅ 全 Lens で DB / network / file / random / global state / 他 Lens 依存 **ゼロ** |
| 失敗分離 (`Promise.allSettled`) | ✅ `LensAggregator.computeAll` で既存実装あり |
| 純粋関数性違反 | ❌ なし (Step 4 対象外候補 = ゼロ) |
| determinism 比較除外フィールド | `LensFeature.computedAt` / `LensFeature.computeDurationMs` (Phase 4 で確定) |
| Phase 2 wrapper 実装 | `src/side-b/adk/agents/lensParallelSmoke.ts`: `LensSubAgent` + `createLensSubAgent` |
| Phase 3 wrapper 実装 | `lensParallelSmoke.ts`: `buildLensParallelSmoke` + `runLensParallelSmoke` + `createDryRunLensParallelAgent` + `LensParallelExecutionResult` (failure isolation 設計、ADK `Promise.race` 挙動への対応として `LensSubAgent.isolateFailure` オプション追加) |
| Phase 2+3+4 test 結果 | **49 cases pass** (Phase 2: 23 / Phase 3: 22 / Phase 4: 4) |
| ADK 領域累計 | **226 cases pass** (Step 1-3 既存 177 + Phase 2 23 + Phase 3 22 + Phase 4 4) |
| side-b 全体 regression (Phase 5) | **1678/1682 PASS** (128 suites、4 skipped、failure ゼロ) |
| 完了 docs (Phase 6) | `STEP_4_SUMMARY.md` 新規 + `ADK_ADOPTION.md` §3/§7/§8 更新 + `agents/README.md` Step 4 節追記 |
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

## 5. Phase 3: ParallelAgent dry-run wrapper 実装結果 (PR 2 追記)

### 5.1 重要発見: ADK ParallelAgent の failure 伝播挙動

`node_modules/@google/adk/dist/cjs/agents/parallel_agent.js` の `mergeAgentRuns` を実機確認した結果:

```javascript
async function* mergeAgentRuns(agentRuns) {
  // ...
  while (pendingPromises.size > 0) {
    const { result, index } = await Promise.race(pendingPromises.values());
    // ...
  }
}
```

**`Promise.race`** で sub-agent generators を merge する。**1 sub-agent が throw すると `Promise.race` 全体が reject** し、他 sub-agent の結果を待たずに ParallelAgent が停止する。

→ KICKOFF §5 Phase 3 DoD「1 Lens が failed でも他 Lens の completed を確認できる」を満たすには、**sub-agent 側で throw を吸収する** 必要がある。

### 5.2 解決策: `LensSubAgent.isolateFailure` オプション追加

`LensSubAgent` に optional `isolateFailure: boolean` (default `false`) を additive 追加:

| 値 | 挙動 | 使用シーン |
|---|---|---|
| `false` (default) | Phase 2 既存挙動。Lens throw を呼び出し元へ伝播 | 単体検証 (Phase 2 test) |
| `true` | Lens throw を握りつぶし、`getError()` に保存して generator は正常終了 | `ParallelAgent` 配下 (Phase 3 並列実行) |

いずれの場合でも `traceSink` に `adk.subagent.failed` event は必ず記録される (失敗の事実は trace 側で保存)。

### 5.3 新規追加 API (lensParallelSmoke.ts、additive)

| シンボル | 用途 |
|---|---|
| `LensParallelSmokeConfig` | 構築 config (`lenses` + `input` + optional `traceSink` / `appName` / `agentName`) |
| `LensParallelSmokeArtifacts` | `runner` + `rootAgent` (ParallelAgent) + `sessionService` + `subAgents` (lensName 昇順済み) |
| `LensParallelExecutionResult` | `successes: LensFeature[]` + `failures: LensParallelFailure[]` (両者 lensName 昇順) |
| `LensParallelFailure` | `{ lensName, error }` |
| `LENS_PARALLEL_SMOKE_DEFAULT_APP_NAME` / `_AGENT_NAME` | デフォルト識別子 |
| `buildLensParallelSmoke(config)` | 構築 (実行はしない、validation のみ) |
| `runLensParallelSmoke(artifacts, params?)` | `runEphemeral` 実行 + `subAgents.getResult/getError` 集約 + lensName 昇順返却 |
| `createDryRunLensParallelAgent(config, params?)` | build + run の一発便利関数 |

### 5.4 KICKOFF Phase 3 DoD 達成状況

| DoD | 達成 | 確認方法 |
|---|---|---|
| 複数 Lens が同一 input で実行される | ✅ | `runLensParallelSmoke: 並列実行` の test 3 件 |
| 各 Lens の trace が lensName 単位で分離される | ✅ | `trace event が lensName 単位で分離される` test (6 event を skillName でグルーピング) |
| trace event の順序に依存しない検証になっている | ✅ | 上記 test は順序固定せず Map で集計 |
| output が安定ソート / 安定 key で返る | ✅ | `successes` / `failures` 共に `lensName` 昇順、入力順序変更でも同結果 (`lenses 入力順序を変えても` test) |
| 1 Lens が failed でも他 Lens の completed を確認できる | ✅ | `failure isolation` 3 cases (1 throw / 複数 throw / 全 throw) |
| 並列実行回数を増やしても同一 features が返る | ✅ | `determinism` 3 cases (2 回比較 / 3 回比較 / 入力順序変更) |

### 5.5 重要な実装上の制約

- **同名 Lens 拒否**: `buildLensParallelSmoke` が同名 Lens 2 つ以上を含む config を受けると throw。理由: `subAgents` を `lensName` で集約・ソートする設計で、同名があると結果集約が破綻するため。
- **`lensName` 安定 key の起点**: `subAgents` を構築時に `lensName` 昇順でソート。これにより `result.successes` / `failures` の順序が並列実行順 (`Promise.race` で merge) に依存しなくなる。
- **`isolateFailure: true` での型安全**: catch ブロックは `throw error` 経路 (Phase 2 修正) と `// 握りつぶし` 経路の両方を持つ。`getError()` で外側から失敗を取得できるため情報損失なし。

### 5.6 Phase 3 test 内訳 (新規 20 cases)

| グループ | cases | 主な検証 |
|---|---|---|
| LensSubAgent isolateFailure オプション | 2 | true で握りつぶし / false で従来の throw 伝播 |
| `buildLensParallelSmoke: 構築物` | 7 | 空 throw / 同名 throw / artifacts 揃う / ソート / app/agent name default / override / isolateFailure 適用確認 |
| `runLensParallelSmoke: 並列実行` | 3 | 3 Lens 並列 / 個別 features / trace lensName 分離 |
| `failure isolation` | 3 | 1 throw / 複数 throw / 全 throw |
| `determinism` | 3 | 2 回比較 / 3 回比較 / 入力順序非依存 |
| `createDryRunLensParallelAgent` 便利関数 | 1 | build + run 一発 |
| Phase 3 実 Lens 統合 smoke | 1 | TimeSessionLens 1 件並列観測 |

合計 Phase 2+3: **43 cases pass**。

### 5.7 累計テスト結果

- Phase 2 既存 23 cases: 全 pass 維持 (Phase 3 拡張で破壊なし)
- Phase 3 新規 20 cases: 全 pass
- ADK 領域累計: **220 cases pass** (Step 1-3 既存 177 + Phase 2 23 + Phase 3 20)
- 既存不可侵領域 (`src/side-b/lenses/` / `src/side-b/agent/` / `src/side-b/skills/` / `prisma/schema.prisma`) git diff: **ゼロ**
- 本番コードの `any` / `unknown` / `as any` / `as unknown as`: ゼロ

---

## 6. Phase 4: 決定性 / 失敗分離 実機再検証 (PR 3 追記)

### 6.1 検証内容

`lensParallelSmoke.test.ts` に Phase 4 describe ブロックを追加し、以下を実機 test で確認:

| 検証項目 | test cases |
|---|---|
| ADK 経由 vs Lens 直接実行の features 完全一致 (`stripVolatile` で `computedAt` / `computeDurationMs` 除外) | DeterministicFakeLens / TimeSessionLens (実 Lens) / 複数 Lens 集約 = **3 cases** |
| failure isolation 実機再検証 (throw + success 混在で success features が直接実行と一致) | **1 case** |

Phase 4 累計: **+4 cases** (Phase 2+3 既存 45 と合わせて 49 cases pass)。

### 6.2 結論

**ADK を挟んでも Lens features が変わらない**。volatile field 除外で features / lensName / lensVersion / confidence が完全一致。

これにより KICKOFF Phase 4 DoD すべて充足:
- [x] 同一 input / 同一 features が成立する
- [x] 直接実行と ADK 経由実行の features が一致する
- [x] failed Lens が他 Lens を巻き込まない
- [x] volatile field の扱いを文書化している (本書 §2.4 + Phase 4 test の `stripVolatile` ヘルパー)

---

## 7. Phase 5: テスト統合 (PR 3 追記)

### 7.1 実行コマンドと結果

| コマンド | 結果 |
|---|---|
| `npx tsc --noEmit` | ✅ clean (warning / error ゼロ) |
| `npx jest src/side-b/tests/adk/agents/lensParallelSmoke.test.ts` | **49 cases pass** |
| `npx jest src/side-b/tests/adk` | **226 cases pass** (12 suites) |
| `npx jest src/side-b` | **1678/1682 pass** (128 suites、4 skipped、failure ゼロ) |
| `npm run lint:backend` | 既存 246 problems (215 errors + 31 warnings)、Step 4 開始前と同数値 = 新規違反ゼロ |

### 7.2 既存テストへの影響

- Step 1-3 ADK 領域 177 cases: 全 pass 維持
- Phase 7 lenses 領域: 全 pass 維持
- side-b 中核 (agent / scheduler / dsl / evolution / ledger / skills): 全 pass 維持

→ Step 4 追加が既存実装を破壊していない。

### 7.3 KICKOFF Phase 5 DoD 達成

- [x] ADK 領域既存 177 cases が維持される
- [x] Step 4 新規テストが pass (49 cases)
- [x] typecheck pass
- [x] lint pass、または既存違反と新規違反を分離して報告 (本書 §7.1 で既存 246 件を明示、Step 4 新規違反ゼロ)
- [x] 既存中核の git diff がない

---

## 8. Phase 6: ドキュメント更新 (PR 3 追記)

### 8.1 作成 / 更新ファイル

| ファイル | 状態 |
|---|---|
| [`STEP_4_SUMMARY.md`](./STEP_4_SUMMARY.md) | ✅ 新規作成 (Step 4 全体総括) |
| [`STEP_4_LENS_PARALLEL_AGENT_REPORT.md`](./STEP_4_LENS_PARALLEL_AGENT_REPORT.md) | ✅ 本書、Phase 4-6 結果を §6 / §7 / §8 に追記 |
| [`ADK_ADOPTION.md`](./ADK_ADOPTION.md) | ✅ §3 ロードマップ Step 4 を `[x]` / §7 に Step 4 詳細追記 / §8 関連 docs に Step 4 リンク 3 件 |
| [`/src/side-b/adk/agents/README.md`](../../src/side-b/adk/agents/README.md) | ✅ Step 4 節追記 (`lensParallelSmoke.ts` 4 ファイル目に追加、failure isolation / ADK 経由=直接実行パターン明記) |

### 8.2 KICKOFF Phase 6 DoD 達成

- [x] Step 4 の判断材料が文書化されている (本書 + SUMMARY + ADK_ADOPTION §7)
- [x] 次 Step の判断ができる状態になっている (SUMMARY §4 撤退基準チェック + §5 Step 5 引き継ぎ)
- [x] 実装だけで終わっていない

---

## 9. 次 Step への引き継ぎ事項

### 9.1 Step 5 (進化ループの LoopAgent ラップ、条件付き)

詳細は [`STEP_4_SUMMARY.md`](./STEP_4_SUMMARY.md) §5 を参照。要点:

- `LensSubAgent` (isolateFailure 含む) を LoopAgent 配下 sub-agent としても再利用可能
- `buildLensParallelSmoke` / `runLensParallelSmoke` を LoopAgent の評価フェーズに組み込む選択肢あり
- `adk.subagent.*` trace event kind と `skillName` 再利用パターンを LoopAgent でも継続 (additive 拡張なし)
- Step 5 着手前に「LoopAgent が進化的探索の決定論性を壊さないか」spike が必要 (Step 6 撤退判断と直結)

### 9.2 Step 4 で確認した制約 (Step 5 でも継続)

- **同名 Lens 拒否**: `buildLensParallelSmoke` で同名 Lens 2 つ以上は throw。複数 Aggregator を束ねる場合は命名空間を分ける
- **失敗時 result/error 状態混入**: `runAsyncImpl` 冒頭で reset 済 (PR #196 review 対応)。LoopAgent で同 instance を多世代回す場合も安全

---

## 10. 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| [`STEP_4_KICKOFF.md`](./STEP_4_KICKOFF.md) | Step 4 KICKOFF (Neko さん作成) |
| [`STEP_4_SUMMARY.md`](./STEP_4_SUMMARY.md) | Step 4 完了サマリー (撤退基準チェック + Step 5 引き継ぎの正本) |
| [`STEP_3_SUMMARY.md`](./STEP_3_SUMMARY.md) | Step 3 完了サマリー (建材の出典) |
| [`STEP_3_SEQUENTIAL_AGENT_NOTES.md`](./STEP_3_SEQUENTIAL_AGENT_NOTES.md) | Step 3 Phase 2 (`adk.subagent.*` trace 契約の根拠) |
| [`../design/phase_7_summary.md`](../design/phase_7_summary.md) | Phase 7 完了サマリー (Lens 8 本拡張) |
| [`ADK_ADOPTION.md`](./ADK_ADOPTION.md) | ADK 段階導入計画 (本 PR で §3 / §7 / §8 更新) |
| [`/AGENTS.md`](../../AGENTS.md) | ドメイン原則 §4 (Lens 独立・純粋・決定性) |
| [`/src/side-b/adk/agents/lensParallelSmoke.ts`](../../src/side-b/adk/agents/lensParallelSmoke.ts) | Phase 2-3 wrapper 実装本体 |
| [`/src/side-b/tests/adk/agents/lensParallelSmoke.test.ts`](../../src/side-b/tests/adk/agents/lensParallelSmoke.test.ts) | Step 4 全 49 cases test |
| [`/src/side-b/adk/agents/README.md`](../../src/side-b/adk/agents/README.md) | agents 領域設計書 (本 PR で Step 4 節追記) |
