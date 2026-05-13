# STEP_3_PDCA_DRYRUN_NOTES.md — PDCALoop Dry-Run Wrapper 実測結果

> **作成日**: 2026-05-13
> **対象**: 既存 `src/side-b/agent/pdcaLoop.ts` の **改変なし**観測
> **位置づけ**: Step 3 Phase 3 (`STEP_3_KICKOFF.md` §5 Phase 3) の成果物
> **前提**: Step 3 Phase 1 (`STEP_3_RUNNER_SMOKE_NOTES.md`) / Phase 2 (`STEP_3_SEQUENTIAL_AGENT_NOTES.md`) 完了
> **完了条件**: KICKOFF §5.11 Phase 3 DoD をすべて満たすこと
> **次フェーズ**: Step 3 Phase 4 (`STEP_3_INTEGRATION_DECISION.md`) で接続可否判断

---

## 1. 結論サマリー (先出し)

| 項目 | 採用結果 |
|------|---------|
| PDCALoop ラップ方針 | **合成によるラップのみ** (`/src/side-b/adk/agents/pdcaDryRunWrapper.ts` 新規追加、`pdcaLoop.ts` 無改変) |
| sub-agent 形態 | `PdcaObservationSubAgent` (BaseAgent 直接 subclass、Phase 2 `SmokeSubAgent` の Phase 3 特化版) |
| 公開 API 利用 | `start` / `stop` / `getStatus` / `getThinkingLog` のみ。private method / private field 一切アクセスなし (TS コンパイラで防御) |
| 副作用ゼロの保証 | `enabled: false` で構築した PDCALoop を渡す → `start()` は即 return、`stop()` は `isRunning=false` で即 return、`getStatus()` / `getThinkingLog()` は read-only |
| 副作用無発生の実測 | wrapper 実行前後で `agentMemory.getState()` / `pdcaLoop.getStatus()` の **不変性を assert** (test "4 アクションすべてを連続実行しても agentMemory state は変わらない") |
| trace event kind | Phase 2 で追加した `adk.subagent.*` をそのまま再利用 (新規 kind 追加なし) |
| 観測アクション | 4 種類: `noop-start` / `noop-stop` / `snapshot-status` / `snapshot-log` |
| raw payload 漏出 | `payloadToSummary` 経由で `resultSummary` のみ記録 (KICKOFF §6.3 厳守) |
| エラー伝播 | sub-agent throw → `adk.subagent.failed` 記録後 rethrow、SequentialAgent が後続 skip (Phase 2 と同挙動) |
| 既存テスト | Step 1 (71) + Step 2 (59) + Phase 1 (11) + Phase 2 (18) + Phase 3 (18) = **計 177 cases 全 pass** |
| 不可侵領域 git diff | `src/side-b/agent/` / `src/side-b/skills/` / `prisma/schema.prisma` すべて **diff ゼロ** (git diff --stat で確認) |

実装場所:

- 本番コード: `/src/side-b/adk/agents/pdcaDryRunWrapper.ts`
- テスト: `/src/side-b/tests/adk/agents/pdcaDryRunWrapper.test.ts` (18 cases)
- agents 領域設計書: `/src/side-b/adk/agents/README.md` (Phase 3 で初版)

---

## 2. 採用構成

```
PDCALoop (enabled:false で構築、副作用が発生しない安全状態)
   │
   ├─→ PdcaObservationSubAgent { action: 'snapshot-status' }   public API: getStatus()
   ├─→ PdcaObservationSubAgent { action: 'noop-start' }         public API: start()  (即 return)
   ├─→ PdcaObservationSubAgent { action: 'snapshot-log' }       public API: getThinkingLog(N)
   └─→ PdcaObservationSubAgent { action: 'noop-stop' }          public API: stop()   (即 return)
       ↓
   SequentialAgent { subAgents: [...] }
       ↓
   Runner { sessionService: InMemorySessionService } (Phase 1/2 と同じ)
       ↓
   runner.runEphemeral({ userId, newMessage })
```

各 `PdcaObservationSubAgent.runAsyncImpl`:

```
1. safeRecord(traceSink, adk.subagent.started)
2. executeAction() で public API を 1 つ呼ぶ
   - noop-start / noop-stop: 副作用なし、resultSummary は undefined
   - snapshot-status / snapshot-log: 戻り値を payloadToSummary() で summary 化
3. Runner event stream に text event 1 件 yield (本番判断には流れない)
4. safeRecord(traceSink, adk.subagent.completed, resultSummary)
5. throw 時: shortenErrorMessage で短縮 → adk.subagent.failed 記録 → rethrow
```

---

## 3. 不可侵領域の遵守

### 3.1 git diff ゼロ確認 (KICKOFF §5.11 DoD)

本 PR で変更したファイル (新規追加のみ):

```text
+ src/side-b/adk/agents/pdcaDryRunWrapper.ts
+ src/side-b/adk/agents/README.md
+ src/side-b/tests/adk/agents/pdcaDryRunWrapper.test.ts
+ docs/architecture/STEP_3_PDCA_DRYRUN_NOTES.md
```

`git diff --stat -- src/side-b/agent/ src/side-b/skills/ prisma/schema.prisma` → **empty** (diff ゼロ)。

### 3.2 import 経路

`pdcaDryRunWrapper.ts` の import:

| import | 種類 | 用途 |
|--------|------|------|
| `@google/adk` | external | BaseAgent / SequentialAgent / Runner / InMemorySessionService / createEvent (public API のみ) |
| `@google/genai` | external | Content (type only) |
| `node:crypto` | std | randomUUID |
| `../../agent/pdcaLoop` (PDCALoop) | internal | **read-only**、constructor + 公開 method (start / stop / getStatus / getThinkingLog) のみ参照 |
| `../tracing` | internal | TraceSink / AdkTraceEvent / TracePayloadSummary / payloadToSummary / shortenErrorMessage |

逆方向の import (`src/side-b/agent/` → `src/side-b/adk/`) はゼロ (依存方向の制約、`/src/side-b/adk/AGENTS.md`)。

### 3.3 private アクセスゼロ

- `pdcaLoop.config` (private) → 直接アクセスせず、`pdcaLoop.getStatus().config` 経由で取得
- `pdcaLoop.memory` (private) → 直接アクセスせず、`pdcaLoop.getStatus().state` 経由
- `pdcaLoop.thinkingLog` (private) → `pdcaLoop.getThinkingLog(N)` 経由
- `handleMonitoring` / `handleSessionOpen` 等 private state handler → **呼ばない** (KICKOFF §5.10 禁止粒度)
- `scheduleTick` / `addThinkingLog` / `log` (private) → **呼ばない**
- `as any` / `as unknown as ...` → **使わない** (KICKOFF §6.2)

TypeScript コンパイラが private アクセスをコンパイル時に拒否するため、レビュー時にも grep で `(pdca|loop)\.handle|\.scheduleTick|as any|as unknown as` を検索すれば違反なしを再確認できる。

---

## 4. 観測アクションの設計

### 4.1 アクション一覧

| `PdcaObservationAction` | 内部で呼ぶ public API | 副作用 | resultSummary |
|------------------------|-----------------------|--------|---------------|
| `noop-start` | `pdcaLoop.start()` | enabled:false で即 return、副作用なし | undefined |
| `noop-stop` | `pdcaLoop.stop()` | isRunning=false で即 return、副作用なし | undefined |
| `snapshot-status` | `pdcaLoop.getStatus()` | read-only | `payloadToSummary(status)` (top-level keys: `isRunning` / `state` / `config` / `recentLog` 等) |
| `snapshot-log` | `pdcaLoop.getThinkingLog(N)` | read-only、`this.thinkingLog.slice(-N)` でコピー返却 | `payloadToSummary(log)` (配列 summary) |

`exhaustive: never` で switch 網羅性をコンパイラ検証 (`as any` 不要)。

### 4.2 副作用ゼロの実測 (KICKOFF §5.11 DoD #7)

test "4 アクションすべてを連続実行しても agentMemory state は変わらない":

```typescript
const stateBefore = agentMemory.getState();
const watchSymbolsBefore = pdca.getStatus().config.symbols.slice();

await runPdcaDryRun(runner, { ... }); // 4 sub-agent 実行

expect(agentMemory.getState()).toBe(stateBefore);                  // ← OK
expect(pdca.getStatus().config.symbols).toEqual(watchSymbolsBefore); // ← OK
expect(pdca.getStatus().isRunning).toBe(false);                    // ← OK
```

→ 4 アクション連続実行でも agentMemory / pdcaLoop の状態は不変 (副作用ゼロを実機確認)。

### 4.3 想定外の副作用が起きる可能性 (検討済み)

| 想定可能な副作用 | 起こり得るか | 防御策 |
|----------------|-------------|--------|
| `start()` から `scheduleTick(0)` 経由で tick が走る | ❌ `enabled: false` でガード | `createDryRunPdcaLoop()` で enabled:false 強制 |
| `addThinkingLog` で thinkingLog に push される | ❌ public API には `addThinkingLog` がない、private | TypeScript で防御 |
| `agentMemory.setState` が呼ばれる | ❌ public API 経由では呼ばれない | テストで before/after 比較 |
| `getStatus()` 戻り値が config の参照を返し、呼び出し側で mutate | ⚠️ 理論上可能 | wrapper では mutate しない (`payloadToSummary` は read-only) |

→ 4 番目の理論リスクのみ存在するが、wrapper では `payloadToSummary(status)` 経由で読み取るのみで mutate しない。

---

## 5. KICKOFF §5.11 Phase 3 DoD 対応

| # | DoD | 対応 |
|---|-----|------|
| 1 | `/src/side-b/adk/agents/` 配下に dry-run wrapper がある | ✅ `pdcaDryRunWrapper.ts` |
| 2 | `pdcaLoop.ts` の git diff がゼロ | ✅ git diff --stat で確認 (NOTES §3.1) |
| 3 | `agentLoop.ts` の git diff がゼロ | ✅ 同上 |
| 4 | `agentMemory.ts` の git diff がゼロ | ✅ 同上 |
| 5 | `/src/side-b/skills/` の git diff がゼロ | ✅ 同上 |
| 6 | private method / private field にアクセスしていない | ✅ TS コンパイラで防御、NOTES §3.3 で詳細 |
| 7 | wrapper 実行が DB 書き込み・通知・取引判断を発生させない | ✅ test "4 アクションすべてを連続実行しても agentMemory state は変わらない" + 4 アクション個別 test |
| 8 | wrapper 実行が traceSink に記録される | ✅ test "成功時 / error ケース" 等で `adk.subagent.*` event 数を assert |
| 9 | error ケースで failed trace が記録される | ✅ test "sub-agent が throw すると adk.subagent.failed が記録され、PDCALoop は無傷" |
| 10 | `STEP_3_PDCA_DRYRUN_NOTES.md` に実測結果がある | ✅ 本書 |

---

## 6. テスト結果

```
PASS src/side-b/tests/adk/agents/pdcaDryRunWrapper.test.ts (18 cases)
  createDryRunPdcaLoop: 安全な PDCALoop ファクトリ (3 cases)
  buildPdcaDryRunWrapper: 構築物 (4 cases)
  観測アクション: 副作用なし + trace 記録 (4 cases)
  副作用無発生 (KICKOFF §5.11 DoD) (2 cases)
  error ケース: failed trace が記録される (2 cases)
  traceSink.record() 失敗の握りつぶし (2 cases)
  raw payload 非保存 (redaction) (1 case)

Test Suites: 11 passed, 11 total (Step 1 + Step 2 + Phase 1 + Phase 2 + Phase 3)
Tests:       177 passed, 177 total
```

内訳: Step 1 (71) + Step 2 (59) + Phase 1 (11) + Phase 2 (18) + Phase 3 (18) = **177 cases**。

Step 1 / Step 2 / Phase 1 / Phase 2 のテストは未改変で全 pass。

---

## 7. Phase 4 (Integration decision) への引き継ぎ事項

### 7.1 Phase 1/2/3 で確認済みの事実

| 確認事項 | 結果 |
|---------|------|
| ADK Runner / LlmAgent / FunctionTool adapter の最小構成は動く | ✅ Phase 1 で実機検証 |
| SequentialAgent の sub-agent 順序保証 / error 伝播 / trace 記録 | ✅ Phase 2 で実機検証 |
| 既存 PDCALoop に **触らずに** dry-run wrapper を構築できる | ✅ 本 Phase で実機検証 |
| public API のみで観測可能、副作用ゼロを担保できる | ✅ 本 Phase で実機検証 |
| trace 契約 (`AdkTraceEvent` / `TraceSink`) は両系統で共通 | ✅ Phase 2 で additive 拡張済み、本 Phase は無改変 |
| ADK SDK internal / private API への依存なし | ✅ public API のみ使用、grep 確認可 |
| 撤退性 (`git rm -rf src/side-b/adk/`) | ✅ 依存方向 `adk → 既存` のみ、本 Phase で再確認 |

### 7.2 Phase 4 で判断する論点

KICKOFF §5.12-§5.15 に基づき、Phase 4 (`STEP_3_INTEGRATION_DECISION.md`) では以下を文書化する:

1. **Step 4 / Step 5 / Step 6 のどれに進むか**
   - Step 4: ParallelAgent for Lens dry-run
   - Step 5: LoopAgent for Evolution dry-run
   - Step 6: 撤退判断
2. **既存 Side-B loop へ接続するなら、どの entry point から**
   - 候補 A: read-only entry point (`getStatus` 系) のみを SideBScheduler から呼ぶ
   - 候補 B: dry-run wrapper を SideBScheduler 起動経路の外側 (CLI / batch) で実行する
   - 候補 C: 接続しない (Step 3 完了時点で撤退判断)
3. **観測性の評価**
   - 既存ログ (console + thinkingLog) に対して ADK trace は何を追加で見られるか
   - Cloud Trace / Datadog 等への流出経路 (`OtelTraceSink` 等の `TraceSink` 実装追加で可能)
4. **撤退基準 (`ADK_ADOPTION.md` §5) への該当有無**
   - Phase 1/2/3 を通じて撤退基準 5 項目のいずれかに該当する事例があったか

### 7.3 Phase 4 が判断**しない**こと (KICKOFF §5.12 厳守)

- 接続実装そのもの (本 Step では絶対に接続しない)
- 本番 SideBScheduler の変更
- 本番 Express server の変更
- Prisma schema 変更
- agentMemory 変更

---

## 8. 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [`STEP_3_KICKOFF.md`](./STEP_3_KICKOFF.md) | Step 3 作業指示書 (本書は §5 Phase 3 の成果物) |
| [`STEP_3_RUNNER_SMOKE_NOTES.md`](./STEP_3_RUNNER_SMOKE_NOTES.md) | Phase 1 実測 |
| [`STEP_3_SEQUENTIAL_AGENT_NOTES.md`](./STEP_3_SEQUENTIAL_AGENT_NOTES.md) | Phase 2 実測 (sub-agent trace 契約拡張) |
| [`ADK_ADOPTION.md`](./ADK_ADOPTION.md) | §6 不可侵領域 / §5 撤退基準 |
| [`/src/side-b/adk/agents/pdcaDryRunWrapper.ts`](../../src/side-b/adk/agents/pdcaDryRunWrapper.ts) | 本書で扱った Phase 3 実装 |
| [`/src/side-b/adk/agents/README.md`](../../src/side-b/adk/agents/README.md) | agents 領域設計書 (Phase 3 で初版、Phase 5 で最終) |
| [`/src/side-b/agent/pdcaLoop.ts`](../../src/side-b/agent/pdcaLoop.ts) | 観測対象の既存実装 (**本 PR で改変なし**) |
