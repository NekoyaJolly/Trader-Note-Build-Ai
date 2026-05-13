# STEP_3_SEQUENTIAL_AGENT_NOTES.md — ADK SequentialAgent 実機 Smoke 実測結果

> **作成日**: 2026-05-13
> **対象**: `@google/adk@1.1.0`
> **位置づけ**: Step 3 Phase 2 (`STEP_3_KICKOFF.md` §5 Phase 2) の成果物 — `SequentialAgent` を toy sub-agent 構成で実機 smoke した結果
> **前提**: Step 3 Phase 1 (`STEP_3_RUNNER_SMOKE_NOTES.md`) で Runner / LlmAgent 経由の trace 機構を確認済み
> **完了条件**: KICKOFF §5.7 Phase 2 DoD をすべて満たすこと
> **次フェーズ**: Step 3 Phase 3 (`STEP_3_PDCA_DRYRUN_NOTES.md`) で PDCALoop dry-run wrapper に転用

---

## 1. 結論サマリー (先出し)

| 項目 | 採用結果 |
|------|---------|
| sub-agent 形態 | `BaseAgent` を直接 subclass した `SmokeSubAgent` (LLM 非依存、deterministic) |
| 順序保証 | `SequentialAgent.subAgents` の宣言順がそのまま実行順、Runner Event の `author` でも観測可能 |
| trace event kind | `adk.subagent.started/completed/failed` を新規追加 (`traceTypes.ts` の `AdkTraceEventKind` を additive 拡張) |
| `skillName` の扱い | sub-agent event では step 識別子 (= sub-agent 名) として再利用 (Step 1/2 既存テスト 130 cases に影響なし) |
| error 伝播 | sub-agent throw → `adk.subagent.failed` を record してから rethrow、`SequentialAgent` が以降の sub-agent を skip |
| state 共有 | 同一 `runEphemeral` 内の全 Event が共通 `invocationId` (Phase 1 と同じ性質) |
| raw payload 漏出 | sub-agent の `output` 文字列も trace event JSON には含まれない |
| 既存テスト | Step 1 (71) + Step 2 (59) + Step 3 Phase 1 (11) + Phase 2 (15) = **計 156 cases 全 pass** |

実装場所:

- 本番コード: `/src/side-b/adk/agents/sequentialSmoke.ts`
- テスト: `/src/side-b/tests/adk/agents/sequentialSmoke.test.ts` (15 cases)
- trace 契約拡張: `/src/side-b/adk/tracing/traceTypes.ts` (additive、新 kind 追加のみ)

---

## 2. 採用構成

KICKOFF §5.5 / §5.6 で示した構成を実機で組んだ最小フロー:

```
SmokeSubAgent[] (BaseAgent 直接 subclass、LLM 不使用)
   ↓ new SequentialAgent({ name, subAgents })
SequentialAgent (root agent)
   ↓ new Runner({ appName, agent, sessionService: new InMemorySessionService() })
Runner
   ↓ runner.runEphemeral({ userId, newMessage })
AsyncGenerator<Event>
   ↓ for await ... 全 Event 回収
Event[]                                              (sub-agent 順に author が並ぶ)
```

各 `SmokeSubAgent` の `runAsyncImpl` 内部:

```
1. traceSink.record({ kind: 'adk.subagent.started', traceId, ... })
2. shouldThrow なら throw、そうでなければ yield 1 Event (text content)
3. 成功時: traceSink.record({ kind: 'adk.subagent.completed', parentTraceId, ... })
4. throw 時: traceSink.record({ kind: 'adk.subagent.failed', errorMessage, ... }) → rethrow
```

---

## 3. trace 契約の拡張 (additive)

### 3.1 追加した event kind

`/src/side-b/adk/tracing/traceTypes.ts` の `AdkTraceEventKind` 型を **additive に拡張**:

```typescript
export type AdkTraceEventKind =
  | 'adk.skill.started'
  | 'adk.skill.completed'
  | 'adk.skill.failed'
  | 'adk.subagent.started'    // ★ Phase 2 で追加
  | 'adk.subagent.completed'  // ★
  | 'adk.subagent.failed';    // ★
```

### 3.2 `skillName` フィールドの再利用 (フィールド名は無改変)

`AdkTraceEvent.skillName` は Step 1/2 では「Skill 名」だったが、Phase 2 で **「step 識別子」** という汎用解釈に拡張。

| event kind | `skillName` の意味 |
|-----------|------------------|
| `adk.skill.*` | adapter が把握している `Skill.name` (= Step 1/2 と完全同義) |
| `adk.subagent.*` | SequentialAgent の sub-agent 名 (= `BaseAgent.name`) |

`kind` を discriminant にすればどちらを指しているか型レベルで判別できる。`AdkTraceEvent` インターフェースには新規 field を追加していないため、**Step 1/2 既存テスト 130 cases は未改変で全 pass** を維持。

### 3.3 採否の判断根拠

検討した代替案:

| 案 | 内容 | 採否 |
|---|------|------|
| A. 新 field `subAgentName?: string` を追加 | 型は綺麗だが、`skillName` / `subAgentName` の使い分けを呼び出し側で意識する必要 | ❌ |
| B. `skillName` を optional 化 + 新 field `stepName` 追加 | 既存テスト code が `skillName!` 等の non-null 化を要求される、修正範囲が広がる | ❌ |
| C. `skillName` を step 識別子として再利用 (採用) | additive、既存テスト無改変、`kind` で意味が明確 | ✅ |
| D. trace 契約を変えずに Phase 2 独自の event 型を作る | TraceSink を分割するか、2 系統の trace を維持する必要、整合性が崩れる | ❌ |

→ 案 C を採用。NOTES §3.2 のとおりフィールド再利用方針を traceTypes.ts JSDoc に明記。

---

## 4. 実機実測の発見事項

### 4.1 SequentialAgent は LLM 非依存で動作する

`SequentialAgent` の constructor は `{ name, subAgents }` のみ。`LlmAgent` のような `model` 引数なし。

- ✅ 純粋に sub-agent を順序実行する shell agent (`base_agent.d.ts` `BaseAgent` を継承)
- ✅ LLM 呼び出しは sub-agent 側で発生する (sub-agent が `LlmAgent` の場合)
- ✅ 本 smoke では sub-agent も LLM 非依存 (`SmokeSubAgent`) → LLM コールゼロで完了

### 4.2 sub-agent の宣言順 = 実行順 (Event.author 順序)

実機確認 (test "指定した順で sub-agent が実行される"):

- `subAgents: [subA, subB, subC]` で構築
- Runner Event を `extractSubAgentOrder()` で抽出
- 結果: `['sub_a', 'sub_b', 'sub_c']` (完全一致)

→ SequentialAgent の順序保証は実装レベルで信頼できる。

### 4.3 sub-agent throw 時の伝播挙動

実機確認 (test "error ケース: sub-agent が throw すると adk.subagent.failed が記録される"):

- `[sub_a (OK), sub_b (throw), sub_c (OK)]` を構築
- `runEphemeral` が **rethrow** する (`expect.rejects.toThrow`)
- trace 記録:
  - `sub_a`: started + completed ✅
  - `sub_b`: started + failed (status: 'thrown', errorMessage 保持) ✅
  - `sub_c`: started すら記録されない ✅ (SequentialAgent が後続を skip)

→ Phase 3 の PDCALoop dry-run wrapper でも、失敗 sub-agent の後続 sub-agent は実行されない前提で設計してよい。

### 4.4 同一 `runEphemeral` 内の全 Event が共通 `invocationId`

Phase 1 で確認した性質が SequentialAgent + 複数 sub-agent でも維持される (test "同一 runEphemeral 内の全 Event が共通 invocationId を持つ"):

- Runner Event の `invocationId` を Set に投入
- `Set.size === 1` で全 event が共通 ID を持つことを検証

→ trace event の `invocationId` は **全 sub-agent で同じ値**。これを集約キーにして「1 invocation で起きた全 sub-agent の trace」を後から再構成できる。Phase 3 の dry-run wrapper でも同じ集約キーが使える。

### 4.5 started は必ず completed/failed で閉じる (orphan が出ない)

test "started は必ず completed または failed で閉じる" で:

- 各 `adk.subagent.started` の `traceId` を Set 化
- `adk.subagent.completed` または `adk.subagent.failed` の `parentTraceId` も Set 化
- 全 started ID が closer の親として現れることを確認
- `closers.length === started.length` も検証

→ trace の close 保証は `SmokeSubAgent.runAsyncImpl` 内の try/catch で担保。Phase 3 でも同パターンを踏襲する。

### 4.6 raw payload 非保存の検証

test "trace event を JSON 化しても sub-agent の output 文字列が漏れない":

- sub-agent の `output` に `'TOP-SECRET-PHASE2-PAYLOAD'` を設定
- このリテラルは Runner の Event.content には載る (LLM が見るような content)
- 一方 trace event 側は `JSON.stringify(event)` しても**含まれない**

→ Step 2 Phase 2 の redaction-first 設計 (`TracePayloadSummary` 制約) が、新 event kind に対しても自然に守られる。`SmokeSubAgent` 側で raw payload を trace に詰めていないため。

### 4.7 sub-agent の callerReason は専用識別子に分離

`SmokeSubAgent` は trace event の `callerReason` に `SUBAGENT_SMOKE_CALLER_REASON = 'invoked-via-adk-sequential-smoke'` 固定値を入れる (Step 1/2 で使う `ADK_DEFAULT_CALLER_REASON = 'invoked-via-adk-runner'` とは別系統)。

→ trace consumer 側で「これは sub-agent 由来か、Skill 由来か」を `callerReason` でも識別できる (`kind` 判定の補助として)。

---

## 5. KICKOFF §5.7 Phase 2 DoD 対応

| # | DoD | 対応 |
|---|-----|------|
| 1 | toy sub-agent が指定順に実行される | ✅ test "指定した順で sub-agent が実行される" (`extractSubAgentOrder` 検証) |
| 2 | SequentialAgent の実行単位を trace event として記録できる | ✅ `adk.subagent.*` event kind 追加 + `SmokeSubAgent.runAsyncImpl` 内で record |
| 3 | error ケースで failed trace が記録される | ✅ test "error ケース" |
| 4 | started が completed / failed のどちらかで閉じる | ✅ test "started は必ず completed または failed で閉じる" |
| 5 | raw payload が trace に保存されない | ✅ test "trace event を JSON 化しても sub-agent の output 文字列が漏れない" |
| 6 | SequentialAgent の知見が PDCALoop wrapper 設計に転用可能か notes に記録されている | ✅ 本書 §6 |
| 7 | PDCALoop にはまだ接続していない | ✅ `sequentialSmoke.ts` は `src/side-b/agent/` への import なし (grep 確認可) |

---

## 6. Phase 3 (PDCALoop dry-run wrapper) への転用方針

Phase 3 で `pdcaLoopAdkWrapper.ts` を構築する際、本 Phase で確立した以下のパターンをそのまま採用する。

### 6.1 sub-agent パターン: BaseAgent 直接 subclass

`SmokeSubAgent` の構造をそのまま転用:

```text
class PdcaPhaseAgent extends BaseAgent {
  constructor(options: { name; pdcaLoopRef; phaseHandler; traceSink? })
  protected async *runAsyncImpl(context) {
    traceSink?.record(adk.subagent.started, parentTraceId, ...)
    try {
      // ★ pdcaLoop の **public API のみ** を呼ぶ (start / stop / updateConfig / getStatus / getThinkingLog)
      // ★ private state handler (`handleMonitoring` 等) を呼ばない (KICKOFF §5.10 禁止粒度)
      // ★ DB 書き込み / 通知 / 取引判断を起こさない (dry-run)
      yield event
      traceSink?.record(adk.subagent.completed, ...)
    } catch (err) {
      traceSink?.record(adk.subagent.failed, ...)
      throw err
    }
  }
}
```

### 6.2 sub-agent 分割粒度

KICKOFF §5.10 で許容される粒度:

- PDCALoop 全体を 1 span (= sub-agent 1 個)
- public API レベルの複数 span (= sub-agent 複数個)

本 Phase の実機検証から、**public API レベルで複数 sub-agent に分ける案を推奨**:

- PDCALoop の `getStatus()` 系で実行前 / 実行後の snapshot を取る sub-agent
- `start()` / `stop()` を span として分ける sub-agent
- 各 sub-agent が個別 span として trace 記録される
- 失敗 sub-agent 以降を SequentialAgent が skip する性質を dry-run の安全網として利用

ただし、本 Phase はあくまで toy で確認しただけ。Phase 3 着手時に PDCALoop 公開 API を実際に grep して、span 分割の自然な切れ目を決める。

### 6.3 trace 契約はそのまま流用

Phase 3 で新たに event kind を追加しない (`adk.subagent.*` を再利用)。`skillName` フィールドを PDCALoop の sub-agent 名 (= PdcaPhaseAgent.name) に詰めればよい。

### 6.4 既存実装の不可侵性

Phase 3 で書く `pdcaLoopAdkWrapper.ts` は:

- ✅ `src/side-b/agent/pdcaLoop.ts` から import (public class / 関数のみ)
- ❌ `pdcaLoop.ts` を改変しない (git diff ゼロ、KICKOFF §5.11 DoD)
- ❌ `agentMemory.ts` を改変しない
- ❌ private method / private field にアクセスしない (`as any` 禁止、KICKOFF §6.2)
- ❌ 本番 SideBScheduler / Express server に組み込まない

本 Phase の `sequentialSmoke.ts` は `agent/` への import がゼロ。Phase 3 で初めて `pdcaLoop.ts` を import するが、その import は read-only に限定する。

### 6.5 未解決事項 (Phase 3 着手時に判断)

- PDCALoop の状態 (`AgentState` enum) を sub-agent の境界として使うかどうか
- sub-agent 内で `pdcaLoop.start()` を実際に呼ぶか (start すると `scheduleTick` で副作用が出る可能性、まず `getStatus()` の read-only smoke から始める案)
- PDCALoop の `agentMemory` 状態変更が dry-run 中に起きないか実機確認 (KICKOFF §5.11 DoD)

---

## 7. 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [`STEP_3_KICKOFF.md`](./STEP_3_KICKOFF.md) | Step 3 作業指示書 (本書は §5 Phase 2 の成果物) |
| [`STEP_3_RUNNER_SMOKE_NOTES.md`](./STEP_3_RUNNER_SMOKE_NOTES.md) | Step 3 Phase 1 実測 (Runner / LlmAgent 経由 trace) |
| [`STEP_2_SUMMARY.md`](./STEP_2_SUMMARY.md) | Step 2 完了サマリー (trace 契約 / redaction の前提) |
| [`STEP_2_ADK_TRACING_SPIKE.md`](./STEP_2_ADK_TRACING_SPIKE.md) | Step 2 Phase 1 spike (BasePlugin callback 不依存方針) |
| [`ADK_ADOPTION.md`](./ADK_ADOPTION.md) | §6 不可侵領域 / §2.2 session-less 方針 |
| [`/src/side-b/adk/agents/sequentialSmoke.ts`](../../src/side-b/adk/agents/sequentialSmoke.ts) | 本書で扱った Phase 2 実装 |
| [`/src/side-b/adk/tracing/traceTypes.ts`](../../src/side-b/adk/tracing/traceTypes.ts) | Phase 2 で `adk.subagent.*` kind を additive 追加 |
