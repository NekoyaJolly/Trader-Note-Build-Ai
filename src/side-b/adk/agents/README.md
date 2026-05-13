# /src/side-b/adk/agents — ADK Agents サイドカー

> **位置づけ**: ADK 段階導入 Step 3 で構築する agents 領域の設計書 (初版、Phase 5 で最終形に整える)
> **発注者**: Nekoさん
> **作成日**: 2026-05-13 (Step 3 Phase 3 で初版作成)
> **依存方向**: 本ディレクトリ → 既存 `src/side-b/` (read-only) のみ。逆方向の import は禁止 (`/src/side-b/adk/AGENTS.md` §依存方向の制約)
> **撤退時の保証**: 本ディレクトリ含む `/src/side-b/adk/` を `git rm -rf` するだけで完全撤退できる状態を維持 (ADK_ADOPTION.md §5)

---

## このディレクトリの目的

ADK (Google Agent Development Kit) の `Runner` / `LlmAgent` / `SequentialAgent` 等の **agent 構造**をサイドカーとして提供する。Step 1 で構築した `adapters/` (SkillRegistry → FunctionTool) と Step 2 の `tracing/` (TraceSink / AdkTraceEvent) を組み合わせ、既存実装に触れずに ADK 経由の実行経路を観測・dry-run できる状態を作る。

本ディレクトリのコードは:

- ✅ `src/side-b/agent/pdcaLoop.ts` / `src/side-b/agent/agentMemory.ts` 等を **read-only で import** する
- ❌ 既存 `src/side-b/agent/` / `src/side-b/skills/` の **内部改変は禁止** (`ADK_ADOPTION.md` §6 不可侵領域)
- ❌ 本番 `SideBScheduler` / Express server に組み込まない (KICKOFF §3.2)
- ❌ DB 書き込み / 通知 / 取引判断を発生させない (dry-run のみ)
- ❌ ADK SDK の private / internal API に依存しない (public API のみ)
- ❌ `any` / `unknown` / `as any` / `as unknown as` を本番コードで使わない

---

## ファイル構成 (2026-05-13 時点)

| ファイル | 役割 | Step / Phase |
|---------|------|--------------|
| `runnerSmoke.ts` | ADK `Runner` + `LlmAgent` + `InMemorySessionService` の最小 factory。LLM 呼び出しは呼び出し側 (`BaseLlm` 実装) の責任 | Step 3 Phase 1 |
| `sequentialSmoke.ts` | `SequentialAgent` + toy `SmokeSubAgent` の構成 factory。sub-agent 単位の trace event を `adk.subagent.*` で記録 | Step 3 Phase 2 |
| `pdcaDryRunWrapper.ts` | 既存 `PDCALoop` の public API (`start` / `stop` / `getStatus` / `getThinkingLog`) を sub-agent でラップする dry-run wrapper | Step 3 Phase 3 |
| `README.md` | 本書 | Step 3 Phase 3 で初版、Phase 5 で最終形 |

---

## 共通設計方針

### 1. session-less 維持 (`ADK_ADOPTION.md` §2.2)

すべての factory は `InMemorySessionService` + `Runner.runEphemeral()` を採用する。

- ❌ `Runner.runAsync()` — sessionId 必須、session-less 方針と衝突
- ❌ `DatabaseSessionService` — ADK_ADOPTION.md §2.2 で不採用確定
- ✅ `InMemorySessionService` — プロセス内 Map のみ、永続化なし

### 2. trace 契約は Step 2 / Phase 2 拡張をそのまま使う

`AdkTraceEvent` (`/src/side-b/adk/tracing/traceTypes.ts`) に追加した event kind:

- `adk.skill.*` (Step 2 Phase 3): adapter (`skillRegistryToAdkTools`) 経由の Skill 実行
- `adk.subagent.*` (Step 3 Phase 2): SequentialAgent の sub-agent 実行

`skillName` フィールドは step 識別子として両系統で再利用 (`kind` を discriminant)。`callerReason` 固定値で本書 §3 の各サブシステムを識別:

| サブシステム | `callerReason` 定数 |
|--------|---------------------|
| `adapters/skillRegistryToAdkTools` (Step 1) | `ADK_DEFAULT_CALLER_REASON = 'invoked-via-adk-runner'` |
| `agents/sequentialSmoke` (Phase 2) | `SUBAGENT_SMOKE_CALLER_REASON = 'invoked-via-adk-sequential-smoke'` |
| `agents/pdcaDryRunWrapper` (Phase 3) | `PDCA_DRY_RUN_CALLER_REASON = 'invoked-via-adk-pdca-dry-run'` |

### 3. TraceSink 失敗の握りつぶし

すべての sub-agent / adapter は `safeRecord(sink, event)` パターンで `TraceSink.record()` 失敗を握りつぶす (Step 2 Phase 3 で確立した契約)。trace 記録の失敗で本処理を壊さない。

### 4. raw payload 非保存

trace event の `argsSummary` / `resultSummary` は `TracePayloadSummary` のみ (field 数 + 上位キー名 + redacted: true マーカー)。LLM prompt / response 全文、DB row、API key、取引判断の生データを trace に保存しない (KICKOFF §6.3、`/src/side-b/adk/tracing/traceSummaries.ts` の `payloadToSummary` / `shortenErrorMessage` を経由する)。

### 5. 副作用ゼロ (dry-run)

`pdcaDryRunWrapper` 等の wrapper は **`PDCALoop` を `enabled: false` で構築** することを前提とする (`createDryRunPdcaLoop()` ファクトリで強制)。public API を呼んでも `start()` は即 return、`stop()` は `isRunning=false` のため即 return、`getStatus()` / `getThinkingLog()` は read-only。テストで `agentMemory.getState()` の不変性を assert する。

---

## 使用例

### Phase 1 Runner smoke (Step 3 Phase 1)

```typescript
import { buildRunnerSmoke, runEphemeralSmoke } from './runnerSmoke';
import { InMemoryTraceSink } from '../tracing';

const traceSink = new InMemoryTraceSink();
const { runner } = buildRunnerSmoke({
  model: myStubLlm,            // BaseLlm 実装 (stub / mock)
  registry: myRegistry,        // SkillRegistry
  traceSink,
});
const events = await runEphemeralSmoke(runner, {
  userId: 'smoke-user',
  newMessage: { role: 'user', parts: [{ text: '...' }] },
});
// traceSink.events で adk.skill.* event を確認できる
```

### Phase 2 Sequential smoke (Step 3 Phase 2)

```typescript
import {
  buildSequentialSmoke,
  runSequentialSmoke,
  SmokeSubAgent,
  extractSubAgentOrder,
} from './sequentialSmoke';
import { InMemoryTraceSink } from '../tracing';

const sink = new InMemoryTraceSink();
const subA = new SmokeSubAgent({ name: 'plan', traceSink: sink });
const subB = new SmokeSubAgent({ name: 'do', traceSink: sink });
const subC = new SmokeSubAgent({ name: 'check', traceSink: sink });

const { runner } = buildSequentialSmoke({ subAgents: [subA, subB, subC] });
const events = await runSequentialSmoke(runner, {
  userId: 'smoke-user',
  newMessage: { role: 'user', parts: [{ text: '...' }] },
});
const order = extractSubAgentOrder(events); // ['plan', 'do', 'check']
// sink.events で adk.subagent.* event を確認できる
```

### Phase 3 PDCALoop dry-run wrapper (Step 3 Phase 3)

```typescript
import {
  buildPdcaDryRunWrapper,
  runPdcaDryRun,
  createDryRunPdcaLoop,
  PdcaObservationSubAgent,
} from './pdcaDryRunWrapper';
import { InMemoryTraceSink } from '../tracing';

const pdca = createDryRunPdcaLoop({ symbols: ['XAUUSD'] }); // enabled:false 強制
const sink = new InMemoryTraceSink();
const subAgents = [
  new PdcaObservationSubAgent({
    name: 'pre-status', pdcaLoop: pdca, action: 'snapshot-status', traceSink: sink,
  }),
  new PdcaObservationSubAgent({
    name: 'noop-start', pdcaLoop: pdca, action: 'noop-start', traceSink: sink,
  }),
  new PdcaObservationSubAgent({
    name: 'post-status', pdcaLoop: pdca, action: 'snapshot-status', traceSink: sink,
  }),
  new PdcaObservationSubAgent({
    name: 'noop-stop', pdcaLoop: pdca, action: 'noop-stop', traceSink: sink,
  }),
];
const { runner } = buildPdcaDryRunWrapper({ pdcaLoop: pdca, subAgents });
await runPdcaDryRun(runner, {
  userId: 'dry-run-user',
  newMessage: { role: 'user', parts: [{ text: 'observe PDCA' }] },
});
// sink.events に adk.subagent.started/completed が記録され、PDCALoop は無傷
```

---

## 禁止事項 (`/src/side-b/adk/AGENTS.md` 厳守)

- `src/side-b/agent/pdcaLoop.ts` の **改変**
- `src/side-b/agent/agentMemory.ts` の **改変**
- `src/side-b/agent/agentLoop.ts` の **改変**
- `src/side-b/skills/` 配下の **改変**
- `prisma/schema.prisma` の **変更**
- 既存実装から `/src/side-b/adk/` への import 追加
- PDCALoop / AgentMemory の **private method / private field アクセス**
- `as any` / `as unknown as ...` / `// @ts-ignore` での型逃げ
- 本番 `SideBScheduler` から ADK Runner を呼ぶこと
- 本番 Express server に dry-run wrapper を組み込むこと
- ADK SDK の `_getDeclaration` 等 underscore prefix method 依存

---

## 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [`/src/side-b/adk/AGENTS.md`](../AGENTS.md) | ADK サイドカー領域固有ルール |
| [`/src/side-b/adk/adapters/README.md`](../adapters/README.md) | Step 1 adapters 設計書 |
| [`/docs/architecture/ADK_ADOPTION.md`](../../../../docs/architecture/ADK_ADOPTION.md) | ADK 採用計画・撤退基準 |
| [`/docs/architecture/STEP_3_KICKOFF.md`](../../../../docs/architecture/STEP_3_KICKOFF.md) | Step 3 作業指示書 |
| [`/docs/architecture/STEP_3_RUNNER_SMOKE_NOTES.md`](../../../../docs/architecture/STEP_3_RUNNER_SMOKE_NOTES.md) | Phase 1 実測結果 |
| [`/docs/architecture/STEP_3_SEQUENTIAL_AGENT_NOTES.md`](../../../../docs/architecture/STEP_3_SEQUENTIAL_AGENT_NOTES.md) | Phase 2 実測結果 |
| [`/docs/architecture/STEP_3_PDCA_DRYRUN_NOTES.md`](../../../../docs/architecture/STEP_3_PDCA_DRYRUN_NOTES.md) | Phase 3 実測結果 |

---

> **最終更新**: 2026-05-13 (Step 3 Phase 3、初版作成 — Phase 5 で最終形に整える)
