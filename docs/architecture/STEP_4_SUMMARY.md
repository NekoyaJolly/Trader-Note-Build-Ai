# Step 4 完了サマリー: Lens ParallelAgent Dry-run

> **作成日**: 2026-05-14
> **対象**: Step 4 全 Phase (Phase 0-6) の総括
> **設計書**: [`STEP_4_KICKOFF.md`](./STEP_4_KICKOFF.md)
> **次フェーズ**: Step 5 (進化ループの LoopAgent ラップ、条件付き) / Step 6 (継続採用判断)
> **ステータス**: ✅ 完了 (2026-05-14)

---

## 1. 結論サマリー (先出し)

| 項目 | 結果 |
|---|---|
| Step 4 期間 | 2026-05-14 (KICKOFF #194 → PR 3 マージ、約半日で完走) |
| 新規ファイル | **3 本** (`lensParallelSmoke.ts` / `lensParallelSmoke.test.ts` / `STEP_4_LENS_PARALLEL_AGENT_REPORT.md`) + 本 SUMMARY + KICKOFF |
| Lens ParallelAgent dry-run wrapper | ✅ 動作確認済 (`createDryRunLensParallelAgent` factory) |
| failure isolation | ✅ 実装 (`LensSubAgent.isolateFailure` で ADK `Promise.race` 経路を吸収) |
| 決定性 (ADK 経由 = 直接実行) | ✅ 実機検証 (`stripVolatile` で features 完全一致) |
| ADK 領域累計 | **226 cases pass** (Step 1: 71 + Step 2: 59 + Step 3: 47 + Step 4: 49) |
| side-b 全体 regression | ✅ **1678/1682 PASS** (128 suites、4 skipped) |
| 既存不可侵領域 git diff | ✅ ゼロ (`src/side-b/lenses/` / `src/side-b/agent/` / `src/side-b/skills/` / `prisma/schema.prisma`) |
| 本番コードの `any` / `unknown` / `as any` / `as unknown as` | ✅ ゼロ |
| ADK SDK private / internal API 依存 | ✅ ゼロ |
| Copilot レビュー累計指摘 | **5 件** (PR #194: 4 件 / PR #196: 1 件) — 全件対応済 |
| PR | #194 (Phase 0+1+2) / #196 (Phase 3) / PR 3 (Phase 4+5+6、本 PR) |

---

## 2. Phase 別 成果

### 2.1 Phase 0 — 事前棚卸し ([PR #194](https://github.com/NekoyaJolly/Trader-Note-Build-ai/pull/194))

- `registerDefaultLenses()` 登録 **8 本** (Phase 7 完了時点) 確認
- `Lens` / `LensInput` / `LensFeature` 型契約確認
- 既存 `LensAggregator.computeAll` が `Promise.allSettled` で並列+失敗分離済 ✅
- Step 3 建材 (`BaseAgent` subclass / `safeRecord` / `adk.subagent.*` / `runEphemeral` / `shortenErrorMessage` / `InMemoryTraceSink`) を再利用可能と確定

### 2.2 Phase 1 — 純粋関数性 静的確認 ([PR #194](https://github.com/NekoyaJolly/Trader-Note-Build-ai/pull/194))

`src/side-b/lenses/` 全件 grep:

| 検索対象 | 検出数 |
|---|---|
| `prisma` / `PrismaClient` | **0** |
| `fetch(` / `axios` / `fs.*` | **0** |
| `Math.random` / `globalThis` / `process.env` | **0** |
| `Date.now()` / `new Date()` | features 計算には不使用 (`computedAt` / `computeDurationMs` のみ) |

→ **Step 4 対象外候補ゼロ**、全 8 Lens が ParallelAgent 載せ替え可能。

### 2.3 Phase 2 — 単体 Lens sub-agent wrapper ([PR #194](https://github.com/NekoyaJolly/Trader-Note-Build-ai/pull/194))

| シンボル | 用途 |
|---|---|
| `LensSubAgent` (BaseAgent 直接 subclass) | 1 Lens を ADK sub-agent としてラップ |
| `createLensSubAgent` factory | 構築 entry point |
| `LENS_PARALLEL_SMOKE_CALLER_REASON = 'lens_parallel_dry_run'` | Step 4 固定 callerReason |
| 内部 `safeRecord` ヘルパー | traceSink 失敗握りつぶし (Step 2/3 と同実装) |

test 23 cases pass (構築物 5 / 成功 trace 7 / 失敗 trace 5 / sink 失敗握りつぶし 3 / raw 不保存 2 / 実 Lens 統合 1)。

### 2.4 Phase 3 — ParallelAgent dry-run wrapper ([PR #196](https://github.com/NekoyaJolly/Trader-Note-Build-ai/pull/196))

| 重要発見 | 内容 |
|---|---|
| ADK `ParallelAgent` の `mergeAgentRuns` | 内部で `Promise.race` を使う → 1 sub-agent throw で全体停止 |
| 解決策 | `LensSubAgent.isolateFailure: true` で例外を握りつぶし、`getError()` に保存 |

| 新規 API | 用途 |
|---|---|
| `LensParallelSmokeConfig` / `Artifacts` / `ExecutionResult` / `Failure` | 型定義 |
| `buildLensParallelSmoke(config)` | 構築 (空 lenses / 同名 lens で throw、`lensName` 昇順ソート) |
| `runLensParallelSmoke(artifacts, params?)` | `runEphemeral` 実行 + 集約 (`successes` / `failures` 共に `lensName` 昇順) |
| `createDryRunLensParallelAgent(config, params?)` | build + run 一発便利関数 |

test 22 cases pass + Phase 4 で 4 cases 追加 = Step 4 累計 49 cases。

### 2.5 Phase 4 — 決定性 / 失敗分離 実機再検証 (本 PR)

新規 test ブロック (PR #196 の Phase 3 test に加え本 PR で追加):

| グループ | cases | 主な検証 |
|---|---|---|
| ADK 経由 vs 直接実行の features 完全一致 | 3 | DeterministicFakeLens / TimeSessionLens / 複数 Lens 集約 |
| failure isolation 実機再検証 | 1 | throw + success Lens 混在で success features が直接実行と一致 |

`stripVolatile` ヘルパーで `computedAt` / `computeDurationMs` を除外して比較 (KICKOFF §4.2 / §8.2)。**ADK を挟んでも features が変わらない** ことを実機確認。

### 2.6 Phase 5 — テスト統合 (本 PR)

| テスト範囲 | 結果 |
|---|---|
| `src/side-b/tests/adk/agents/lensParallelSmoke.test.ts` | **49 cases pass** |
| ADK 領域全体 (`src/side-b/tests/adk/**`) | **226 cases pass** (12 suites) |
| side-b 全体 (`src/side-b/**`) | **1678/1682 pass** (128 suites、4 skipped、failures ゼロ) |
| `npx tsc --noEmit` | ✅ clean |
| `npm run lint:backend` | 既存 246 problems (215 errors + 31 warnings、Step 4 開始前と同数値、新規違反ゼロ) |

### 2.7 Phase 6 — 完了 docs (本 PR)

| ファイル | 状態 |
|---|---|
| `STEP_4_SUMMARY.md` | ✅ 新規 (本書) |
| `STEP_4_LENS_PARALLEL_AGENT_REPORT.md` | ✅ Phase 4-6 結果を §5 / §6 に追記 |
| `ADK_ADOPTION.md` §3 / §7 | ✅ Step 4 を `[x]` に + §7 に Step 4 詳細追記 |
| `src/side-b/adk/agents/README.md` | ✅ Step 4 節追記 (`lensParallelSmoke.ts` 含む 4 ファイル構成へ更新) |

---

## 3. KICKOFF 最終 DoD (§9) 達成状況

| # | DoD | 達成 |
|---|---|---|
| 1 | Lens 群を `ParallelAgent` dry-run で実行できる | ✅ `createDryRunLensParallelAgent` |
| 2 | 各 Lens の `started` / `completed` / `failed` trace が観測できる | ✅ `adk.subagent.*` event 3 種 |
| 3 | raw payload が trace / log に保存されない | ✅ `resultSummary.fieldCount` のみ + `redacted: true` マーカー |
| 4 | 1 Lens の失敗が他 Lens を巻き込まない | ✅ `LensSubAgent.isolateFailure: true` で `ParallelAgent` の `Promise.race` 経路を吸収 |
| 5 | 同一 input で同一 features が返る | ✅ `determinism` test 3 件 + `Phase 4 ADK 経由 vs 直接実行` test 3 件 |
| 6 | 既存 Lens 実装の git diff がゼロ | ✅ `src/side-b/lenses/` 改変なし |
| 7 | 既存 Side-B 中核の git diff がゼロ | ✅ `src/side-b/agent/` / `src/side-b/skills/` / `prisma/schema.prisma` 改変なし |
| 8 | Step 1〜3 の ADK テストが壊れていない | ✅ Step 1-3 既存 177 cases 全 pass |
| 9 | Step 4 新規テストが pass | ✅ 49 cases |
| 10 | typecheck が pass | ✅ `npx tsc --noEmit` clean |
| 11 | lint が pass、または既存違反と新規違反が分離 | ✅ 既存 246 件、Step 4 新規違反ゼロ |
| 12 | private / internal API 依存ゼロ | ✅ ADK public API のみ (`BaseAgent` / `ParallelAgent` / `Runner` / `InMemorySessionService` / `createEvent` / `InvocationContext` / `Event`) |
| 13 | `any` / `unknown` / `as any` / `as unknown as` の本番コード使用ゼロ | ✅ |
| 14 | `STEP_4_LENS_PARALLEL_AGENT_REPORT.md` 作成 | ✅ |
| 15 | `STEP_4_SUMMARY.md` 作成 | ✅ 本書 |
| 16 | `ADK_ADOPTION.md` 更新 | ✅ §3 / §7 / §8 |
| 17 | Step 5 へ進むか Step 6 判断へ回すかが明記されている | ✅ §5 |

---

## 4. 撤退基準該当チェック (KICKOFF §7)

| # | 基準 | 該当 |
|---|---|---|
| 1 | `ParallelAgent` に載せるために既存 Lens の設計変更が必要 | ❌ 該当なし (既存 Lens 改変ゼロ) |
| 2 | Lens の純粋関数性 / 決定性が崩れる | ❌ 該当なし (`features` レベルで一致確認) |
| 3 | trace を取るために ADK private / internal API 依存が必要 | ❌ 該当なし (public API のみ) |
| 4 | raw payload を保存しないと実装できない | ❌ 該当なし (`fieldCount` のみで成立) |
| 5 | `as any` / `as unknown as` なしでは成立しない | ❌ 該当なし |
| 6 | session-less 実行が成立しない | ❌ 該当なし (`InMemorySessionService` + `runEphemeral`) |
| 7 | 既存 Step 1〜3 テストを壊す | ❌ 該当なし |
| 8 | SideBScheduler / server / DB への接続が必要 | ❌ 該当なし |
| 9 | テストが並列実行順依存で flaky | ❌ 該当なし (Map で集計、順序非依存) |

**全 9 基準で非該当** → Step 5 着手可能。

---

## 5. Step 5 への引き継ぎ事項

### 5.1 Step 5 のスコープ (`ADK_ADOPTION.md` §3)

- 進化ループの `LoopAgent` ラップ (条件付き)
- KICKOFF DoD: エッジ昇格率 (PF/WF) が ADK 採用前後で 10% 以内の差

### 5.2 Step 4 から Step 5 が流用できる建材

| 建材 | 用途 |
|---|---|
| `LensSubAgent` (isolateFailure 含む) | LoopAgent 内で Lens を呼ぶシナリオに再利用 |
| `buildLensParallelSmoke` / `runLensParallelSmoke` | LoopAgent の評価フェーズで並列 Lens 観測 |
| `LensParallelExecutionResult` 集約パターン | 進化世代ごとの features 集約 |
| `adk.subagent.*` trace event | LoopAgent 配下 sub-agent でも同 kind を再利用 (additive ゼロ) |
| 撤退ルート (`/src/side-b/adk/` 全削除のみ) | Step 5 でも維持 |

### 5.3 Step 4 で確認した制約

- **同名 Lens 拒否**: `buildLensParallelSmoke` で同名 Lens 2 つ以上は throw。Step 5 で複数 Aggregator を束ねる場合も命名空間を分ける必要あり。
- **失敗時 result/error の状態混入**: `runAsyncImpl` 冒頭で reset 済 (PR #196 review 対応)。LoopAgent で同 instance を多世代回す場合も安全。

---

## 6. 数値スナップショット (Step 4 完了時)

- 新規ファイル: 3 (本体 + test + report) + 2 (KICKOFF + 本 SUMMARY) + 1 (agents/README.md Step 4 節追記) = **6 ファイル touch**
- 既存実装変更: `ADK_ADOPTION.md` のみ (§3 ロードマップ + §7 Step 4 詳細 + §8 関連 docs)
- 削除ファイル: なし
- テストケース (Step 4 増分): **49 cases pass** (Phase 2 23 + Phase 3 22 + Phase 4 4)
- adk 領域累計: **226 cases pass** (Step 1: 71 + Step 2: 59 + Step 3: 47 + Step 4: 49)
- side-b 全体: 128 suites、1678/1682 pass
- 既存実装 (`src/side-b/lenses/` / `src/side-b/agent/` / `src/side-b/skills/` / `prisma/schema.prisma`) の変更: **ゼロ**
- 本番コードの `any` / `unknown` / `as any` / `as unknown as` 違反: **ゼロ**
- 本番コードからの ADK SDK 内部 API 依存: **ゼロ**
- Copilot レビュー累計指摘: 5 件 (PR #194: 4 / PR #196: 1)、全件対応済

---

## 7. 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| [`STEP_4_KICKOFF.md`](./STEP_4_KICKOFF.md) | Step 4 KICKOFF (Neko さん作成、2026-05-14) |
| [`STEP_4_LENS_PARALLEL_AGENT_REPORT.md`](./STEP_4_LENS_PARALLEL_AGENT_REPORT.md) | Step 4 Phase 0-6 結果の集約 report |
| [`STEP_3_SUMMARY.md`](./STEP_3_SUMMARY.md) | Step 3 完了サマリー (建材の出典) |
| [`ADK_ADOPTION.md`](./ADK_ADOPTION.md) | ADK 段階導入計画 (本 PR で §3 / §7 更新) |
| [`../design/phase_7_summary.md`](../design/phase_7_summary.md) | Phase 7 完了サマリー (Lens 8 本拡張の出典) |
| [`/src/side-b/adk/agents/README.md`](../../src/side-b/adk/agents/README.md) | agents 領域設計書 (本 PR で Step 4 節追記) |
| [`/src/side-b/adk/agents/lensParallelSmoke.ts`](../../src/side-b/adk/agents/lensParallelSmoke.ts) | Phase 2-3 本体実装 |
| [`/AGENTS.md`](../../AGENTS.md) | ドメイン原則 §4 (Lens 独立・純粋・決定性) |

---

## 8. 最終メッセージ

Step 4 は KICKOFF §10 で明記された「Lens ParallelAgent dry-run」を、既存 Lens に一切触れずに ADK サイドカー領域だけで構築する工程だった。

達成事項:

1. **既存 8 Lens を `ParallelAgent` 経由で並列観測可能にした** — 1 Lens の失敗が他 Lens を巻き込まない `failure isolation` を `LensSubAgent.isolateFailure` で実現
2. **ADK 経由実行と直接実行で features が完全一致することを実機検証** — `stripVolatile` で `computedAt` / `computeDurationMs` を除外して比較
3. **既存中核 (lenses / agent / skills / prisma) を git diff ゼロで維持** — KICKOFF §2.1 / §6 不可侵領域厳守
4. **撤退ルートを保持** — 9 基準すべて非該当、Step 6 へ回す必要なし

KICKOFF §10 の最終指示「サイドカーの中だけで勝つこと」を達成。次は Step 5 (進化ループの LoopAgent ラップ、条件付き) または Step 6 (継続採用判断) — Neko さん判断で進行する。
