# STEP 5 段階 2: ADK 可視性 / 監視ソリューションの実地確認 (Phase F)

ADK 採用理由の一つ「エージェントループの可視性」が実機でどの程度効くかを、Step 3 PDCALoop dry-run wrapper + Step 4 Lens ParallelAgent wrapper を回して確認した結果。STEP 5 (段階 2 運用動作完成) Phase F のアウトプット。

調査時点: 2026-05-15 / main HEAD: `8f3f1af` (PR #203 マージ後)

## 検証手段

- **検証スクリプト**: `scripts/sideB_runtime_observability_smoke.ts`
- **trace sink**: `InMemoryTraceSink` (`src/side-b/adk/tracing/inMemoryTraceSink.ts`)
- **実行コマンド**: `npx tsx scripts/sideB_runtime_observability_smoke.ts`
- **生成ファイル**: `.observability-trace.json` (全 trace event の JSON ダンプ、git ignore 対象)

## 実行結果

```
=== Phase F: Side-B Runtime Observability Smoke ===

--- Scenario 1: PDCALoop Dry-Run Wrapper ---
[pdca-dry-run] eventCount=4 duration=19ms
  (snapshot-status + snapshot-log の 2 sub-agent を SequentialAgent 経由で実行)

--- Scenario 2: Lens ParallelAgent (failure isolation 確認) ---
[lens-parallel-dry-run] eventCount=6 duration=2ms
  (successes=2 failures=1; 1 lens 失敗で他 lens が完走することを確認)

Trace Event 種別内訳:
  adk.subagent.started:   5
  adk.subagent.completed: 4
  adk.subagent.failed:    1

総 event 数: 10
```

## 得られた event の構造 (実サンプル)

### started

```json
{
  "kind": "adk.subagent.started",
  "traceId": "98cb6226-...",
  "invocationId": "e-f2b8b767-...",
  "agentName": "observe-status",
  "skillName": "observe-status",
  "callerReason": "invoked-via-adk-pdca-dry-run",
  "startedAt": "2026-05-15T01:31:55.361Z",
  "status": "started"
}
```

### completed

```json
{
  "kind": "adk.subagent.completed",
  "traceId": "2f9b6bb9-...",
  "parentTraceId": "8f9b9407-...",
  "invocationId": "e-579b7c43-...",
  "agentName": "fake-success-lens-b",
  "callerReason": "lens_parallel_dry_run",
  "startedAt": "2026-05-15T01:31:55.390Z",
  "endedAt":   "2026-05-15T01:31:55.391Z",
  "durationMs": 1,
  "status": "ok",
  "resultSummary": { "fieldCount": 4, "redacted": true }
}
```

### failed (failure isolation 確認用)

```json
{
  "kind": "adk.subagent.failed",
  "traceId": "3090de6f-...",
  "parentTraceId": "5bd377b5-...",
  "invocationId": "e-579b7c43-...",
  "agentName": "fake-failing-lens",
  "callerReason": "lens_parallel_dry_run",
  "startedAt": "2026-05-15T01:31:55.390Z",
  "endedAt":   "2026-05-15T01:31:55.390Z",
  "durationMs": 0,
  "status": "thrown",
  "errorCode": "LENS_SUBAGENT_THROWN",
  "errorMessage": "synthetic failure: fake-failing-lens always fails for smoke testing"
}
```

## 評価 (「エージェントループの可視化として十分か」)

### 十分と判断する根拠

| 観点 | 状況 | 判定 |
|---|---|---|
| event 種別 | `started` / `completed` / `failed` の 3 状態が網羅 | ✅ |
| 親子関係 | `parentTraceId` で sub-agent 間の階層追跡が可能 | ✅ |
| 実行系統識別 | `callerReason` で `invoked-via-adk-pdca-dry-run` / `lens_parallel_dry_run` 等の文字列で識別 | ✅ |
| 時間計測 | `durationMs` で per-agent 性能観測可能 | ✅ |
| 失敗追跡 | `failed` event に `errorCode` + 短縮済 `errorMessage` (Step 2 `DEFAULT_ERROR_MESSAGE_MAX` 適用) | ✅ |
| 機密保護 | `resultSummary.redacted: true` で生 features を伏せ、`fieldCount` のみ公開 | ✅ |
| failure isolation | 1 Lens 失敗で他 Lens が完走 (Lens ParallelAgent で `failed=1, completed=4` 確認) | ✅ |

### 現状の制限 / 不足

| 観点 | 状況 | 影響 |
|---|---|---|
| Skill 実行 event (`adk.skill.*`) | 本スクリプトでは未検証 (Skill registry の依存解決が複雑、別 smoke で対応) | 中 |
| PDCALoop 内部の sub-step 可視性 | 現状は PdcaObservationSubAgent の `snapshot-*` action 単位。実 PDCALoop の Research → Plan → Trade → Reflection の各 step は ADK event として現れない (本番未接続のため当然) | 中 (Step 5 以降で本番接続するなら必要) |
| 永続化 / 横断検索 | InMemoryTraceSink (= プロセス内配列) のみ。再起動で消える、他プロセスから覗けない | 大 (本番運用には不十分) |
| OTel exporter / Jaeger / Cloud Trace | Step 2 で土台確保済みだが未実装 | OTel 取り回しが要るなら別 KICKOFF |

## 判定 (Nekoさん 確認用)

**結論案**: 「**段階 2 完了 + 短期の運用観察開始までは現状の InMemoryTraceSink で十分。OTel exporter / Jaeger / Cloud Trace への流し込みは段階 2 完了後の別判断。**」

根拠:
1. event の粒度・情報量は十分 (上表参照)
2. 段階 2 のゴールは「Side-B が cTrader 配線 (PR #203) で実動して E2E が回るか」の確認。本番接続前なので、ADK wrapper の dry-run 観測で十分
3. OTel exporter を本格化するのは「ADK Step 5/6 で本番 PDCALoop 接続を判断した後」が筋。今やると過剰投資

## Phase D への引き継ぎ事項

- Skill 実行 (`adk.skill.*`) event の検証スクリプト追加は **未着手** (Phase D に「中程度修正」候補として記録)
- OTel exporter 統合は **未実装** (Phase D に「設計判断要」候補として記録、段階 2 完了後の別 KICKOFF)

## 関連ファイル

- 検証スクリプト: `scripts/sideB_runtime_observability_smoke.ts`
- trace sink: `src/side-b/adk/tracing/inMemoryTraceSink.ts`
- PDCA dry-run wrapper: `src/side-b/adk/agents/pdcaDryRunWrapper.ts`
- Lens parallel wrapper: `src/side-b/adk/agents/lensParallelSmoke.ts`
- Step 2 tracing 設計: `docs/architecture/STEP_2_ADK_TRACING_SPIKE.md`
- Step 3 PDCA dry-run notes: `docs/architecture/STEP_3_PDCA_DRYRUN_NOTES.md`
