# STEP_3_INTEGRATION_DECISION.md — Step 3 後の進路判断ドキュメント

> **作成日**: 2026-05-14
> **位置づけ**: Step 3 Phase 4 (`STEP_3_KICKOFF.md` §5 Phase 4) の成果物 — Phase 1〜3 の実機検証結果に基づき、ADK を既存 Side-B loop に**接続するかしないか**と次 Step の進路を判断するドキュメント
> **重要**: 本書は **判断ドキュメントのみ**。本 PR でも以降の PR でも、Step 3 範囲内では既存ループへの接続実装は**一切しない** (KICKOFF §5.12)
> **完了条件**: KICKOFF §5.15 Phase 4 DoD をすべて満たすこと

---

## 1. 結論サマリー (先出し)

| 項目 | 判断 |
|------|------|
| **次に進む Step** | **Step 4 (ParallelAgent for Lens dry-run) を推奨** |
| 既存 Side-B loop への ADK 接続 | **本 Step では実装しない**。接続するなら Step 6 (最終評価) 後 |
| 接続候補 entry point | (採用時) read-only / dry-run script からのみ、本番 SideBScheduler は触らない |
| 撤退基準への該当 | **なし** (`ADK_ADOPTION.md` §5 撤退基準 5 項目すべて非該当) |
| 不採用の条件 | Step 4 着手時に Lens 群の現状が ADK と整合しない場合は **Step 6 (撤退判断) に直行** する |

判断根拠は §3 (7 軸評価) と §4 (実機検証された事実) に詳述。

---

## 2. Step 3 で実機検証できた事実 (Phase 1〜3 サマリ)

KICKOFF §5.14 の判断材料として、本書 §3 評価の根拠を集約する。各 Phase の詳細は対応する NOTES を参照:

| Phase | 検証対象 | 主要発見 | NOTES |
|-------|---------|----------|-------|
| Phase 1 | Runner / LlmAgent / FunctionTool adapter の最小構成 | • `Runner.runEphemeral()` + `InMemorySessionService` が session-less で動く<br>• BaseLlm を継承した stub model で実 LLM 呼び出しなしで smoke 完了<br>• Runner 経由でも adapter 内 `traceSink.record()` がそのまま発火 | [`STEP_3_RUNNER_SMOKE_NOTES.md`](./STEP_3_RUNNER_SMOKE_NOTES.md) |
| Phase 2 | SequentialAgent + toy sub-agent | • `subAgents` の宣言順 = 実機実行順 (Event.author で確認)<br>• sub-agent throw 時に Sequential が後続を skip、orphan started なし<br>• trace 契約に `adk.subagent.*` を additive 追加、Step 1/2 既存テスト 130 cases に影響なし | [`STEP_3_SEQUENTIAL_AGENT_NOTES.md`](./STEP_3_SEQUENTIAL_AGENT_NOTES.md) |
| Phase 3 | PDCALoop dry-run wrapper (合成ラップ) | • `pdcaLoop.ts` / `agentMemory.ts` / `agentLoop.ts` の git diff ゼロを実証<br>• `enabled: false` + public API のみで副作用ゼロを実測 (agentMemory state 不変)<br>• `as any` / `as unknown as` / private アクセスゼロ | [`STEP_3_PDCA_DRYRUN_NOTES.md`](./STEP_3_PDCA_DRYRUN_NOTES.md) |

**累計テスト**: Step 1 (71) + Step 2 (59) + Phase 1 (11) + Phase 2 (18) + Phase 3 (18) = **177 cases 全 pass**。Step 1〜3 の既存契約 130 cases は全 Phase で未改変、全 pass を維持。

---

## 3. 判断軸別の評価 (KICKOFF §5.13)

KICKOFF §5.13 の 7 軸を Phase 1〜3 の実測結果に当てはめる。各軸を「採用寄り」「撤退寄り」「中立」で評価する。

### 3.1 安定性

> Runner / SequentialAgent が安定して動くか

| 軸 | 評価 |
|----|------|
| smoke の安定性 | Phase 1/2/3 の **計 47 cases** が一度も flake せずに pass。複数回のローカル実行 (build + jest) でも安定 |
| ADK SDK 更新リスク | `package.json` は `@google/adk@^1.1.0` の caret range で宣言 (`package-lock.json` で 1.1.0 に lock 中)。SDK の internal / private API には依存ゼロのため、SDK 内部実装が変わっても影響を受けにくい |
| Runner の挙動 | Event stream / invocationId / author 順序がすべて期待通り (Phase 1 NOTES §3.4 / Phase 2 NOTES §4.2-4.4) |

→ **採用寄り**

### 3.2 観測性

> 既存ログより意味のある trace が取れるか

| 軸 | 評価 |
|----|------|
| trace の構造 | `started → completed/failed` 対が `parentTraceId` で紐付く、orphan started なし (Phase 2 で実証) |
| 観測粒度 | adapter 単位 (Skill 実行) + sub-agent 単位の 2 階層を、同一 `invocationId` で共通化して観測できる |
| 既存ログとの差 | 既存 `PDCALoop.thinkingLog` は `addThinkingLog` の都度 push (private 経路、外部出力なし) のみ。ADK trace は redaction 済み summary + duration + status + error code を構造化して持つ。Cloud Trace / Datadog 等への流出経路を `OtelTraceSink` 等の `TraceSink` 実装追加で確保可能 (Step 2 で interface 抽象化済み) |
| raw payload 漏出リスク | `payloadToSummary` 経由のみで Phase 3 まで一度も漏出なし (test で JSON.stringify 検索検証) |

→ **採用寄り**

### 3.3 侵襲性

> 既存実装をどれだけ触る必要があるか

| 軸 | 評価 |
|----|------|
| 既存改変 | Step 1/2/3 を通じて `src/side-b/agent/` / `src/side-b/skills/` / `prisma/schema.prisma` の git diff **常にゼロ** |
| 不可侵領域への接触 | `pdcaLoop.ts` / `agentMemory.ts` / `agentLoop.ts` の private method / private field アクセスゼロ。TS コンパイラで防御 |
| `as any` / `as unknown as` 使用 | 本番コード全ファイルでゼロ (KICKOFF §6.2 厳守) |
| 依存方向 | `adk → 既存` のみ。逆方向の import (`既存 → adk`) は Step 1/2/3 を通じてゼロ |

→ **採用寄り** (最も強い)

### 3.4 撤退性

> ADK を外しても無傷か

| 軸 | 評価 |
|----|------|
| 撤退手順 | `git rm -rf src/side-b/adk/ && npm uninstall @google/adk` のみで完全撤退可能 (`/src/side-b/adk/AGENTS.md` §撤退手順) |
| 既存側への波及 | 既存 `src/side-b/` から `src/side-b/adk/` への import 逆流ゼロを Step 3 まで継続維持 |
| docs / 設定の波及 | `docs/architecture/STEP_*.md` 群と `package.json` の `@google/adk` 依存のみ。撤退時はこれらも削除すれば clean |

→ **採用寄り** (撤退性は最重要、Step 0 から一貫した方針)

### 3.5 型安全

> any / unknown / as 逃げがないか

| 軸 | 評価 |
|----|------|
| `any` 使用 | 本番コードゼロ (tests / scripts も最小限) |
| `unknown` 使用 | 本番コードゼロ (`ESLint` で error 設定済み、Phase B Ticket B2 確定) |
| `as` 使用 | `as never` (unreachable yield 用) のみ、`as any` / `as unknown as ...` の二段階逃げゼロ |
| `@ts-ignore` / `@ts-nocheck` | ゼロ (`ESLint` `ban-ts-comment` で禁止済み) |
| 型レベル網羅性 | `switch` の exhaustive check (`exhaustive: never`) で観測アクションの網羅性を TS コンパイラ検証 |

→ **採用寄り**

### 3.6 session 整合

> session-less 方針と合うか

| 軸 | 評価 |
|----|------|
| `Runner.runEphemeral` | session 永続化不要、Phase 1/2/3 全実行で sessionId 要求なし |
| `InMemorySessionService` | プロセス内 Map のみ、永続化なし。`DatabaseSessionService` 不採用方針を維持 |
| `runAsync` 使用 | ゼロ (sessionId 必須経路には進まず) |
| Prisma 整合 | Prisma schema 変更ゼロ、`agentMemory` の Prisma 連携も無改変 |

→ **採用寄り**

### 3.7 コスト

> 実 LLM 呼び出しが必要か

| 軸 | 評価 |
|----|------|
| smoke の LLM 依存 | ゼロ。Phase 1 は `BaseLlm` 継承 stub、Phase 2/3 は `BaseAgent` 直接 subclass で LLM 経路を回避 |
| テスト実行コスト | ローカル jest 32〜38 秒、CI でも増分小さい |
| 本番接続のコスト | 本 Step では本番接続しないため発生なし |

→ **採用寄り**

### 3.8 7 軸総合評価

| 軸 | 評価 |
|----|------|
| 安定性 | 採用寄り |
| 観測性 | 採用寄り |
| 侵襲性 | 採用寄り |
| 撤退性 | 採用寄り |
| 型安全 | 採用寄り |
| session 整合 | 採用寄り |
| コスト | 採用寄り |

**7 軸すべて採用寄り**。撤退寄りに振れる軸はゼロ。

---

## 4. 撤退基準への該当有無

`ADK_ADOPTION.md` §5 撤退基準 5 項目を Phase 1〜3 の実測結果に当てはめる。

| # | 基準 | 該当有無 | 根拠 |
|---|------|---------|------|
| 1 | OpenRouter 経由で `reasoning_effort` が正しく伝達されない事案発生 | ❌ 非該当 | Step 3 では LLM 呼び出し自体を発生させていない (stub model 採用)。`reasoning_effort` 経路には触れていない |
| 2 | PromptRegistry スコアリングが ADK 経由で 10% 以上劣化 | ❌ 非該当 | PromptRegistry には触れていない (不可侵領域、Step 3 で改変ゼロ) |
| 3 | `@google/adk` が 6 ヶ月間メジャー更新されない | ❌ 非該当 | 1.1.0 が最新、リリース日は本書時点で 6 ヶ月以内 |
| 4 | Google が ADK を deprecated 宣言 | ❌ 非該当 | 公式 deprecation 宣言なし (2026-05-14 時点) |
| 5 | ユーザー判断で継続不適切と判断 | ❌ 非該当 | Nekoさん判断は引き続き継続採用 (Step 3 KICKOFF 発注時点) |

**5 項目すべて非該当**。撤退判断 (Step 6) に直行する根拠はない。

---

## 5. 進路選択肢の評価

KICKOFF §11 / §12 で示された 3 候補を、§3 §4 の評価結果に基づいて比較する。

### 候補 A: Step 4 (ParallelAgent for Lens dry-run) へ進む

**前提条件**:
- Lens 群 (`/src/side-b/lenses/`) が ADK_ADOPTION.md §6 不可侵領域 (純粋関数特性 + 副作用なし + 決定性あり) を満たしていること
- Step 3 で確立した 3 つの建材 (`runnerSmoke.ts` / `sequentialSmoke.ts` / `pdcaDryRunWrapper.ts`) を Step 4 で流用可能

**作業内容 (見込み)**:
- `/src/side-b/adk/agents/lensParallelSmoke.ts` を新規追加
- `ParallelAgent` の構築方法と sub-agent (= 各 Lens の dry-run wrapper) を実装
- 各 Lens の実行を `adk.subagent.*` event として観測 (trace 契約は Step 3 Phase 2 拡張版をそのまま使う)
- 既存 Lens 実装は不可侵、合成ラップのみ

**メリット**:
- Step 3 で確立した 3 パターン (Runner factory / SequentialAgent + sub-agent / read-only public API ラップ) をそのまま転用できる
- Lens の決定性検証 (KICKOFF §4 Step 4 DoD: 「並列実行で同入力同出力」) に Step 1/2 の trace 機構を活かせる
- 撤退性は Step 3 と同じく `/src/side-b/adk/` を削除すれば撤退完了

**リスク**:
- ADK `ParallelAgent` の並列実行モデルが Lens の純粋関数前提と合わない可能性 (Step 4 Phase 1 spike で実機検証)
- Lens 実装に動的に増減する I/O や副作用が含まれていた場合は ADK 化が困難 (Step 4 着手時に grep 等で確認)

### 候補 B: Step 5 (LoopAgent for Evolution dry-run) へ進む

**前提条件**:
- Evolution 探索アルゴリズム (`/src/side-b/evolution/`) が ADK_ADOPTION.md §6 不可侵領域 (決定論性) を満たしていること
- Step 4 (Lens 並列) を飛ばすか、並行作業として進める

**メリット**:
- 進化ループのスパン化は trace 観測価値が高い (世代 / 候補 / 評価の階層が見える)

**リスク**:
- 進化探索は本プロジェクトの中核 (撤退基準 §2 PromptRegistry / §4 過学習スコア閾値 等の影響範囲)
- Step 4 (Lens) を飛ばすと、Lens 並列観測が後回しになり trace 構造の整合性確認が遅れる
- LoopAgent は反復回数の制御や halting 条件が ADK API に依存する (Step 5 Phase 1 spike で実機検証)

### 候補 C: Step 6 (撤退判断) へ直行する

**条件**:
- §4 撤退基準のいずれかに該当 → **本書時点では該当なし**
- Step 4 / 5 のいずれも実機検証に失敗 → 未着手のため判断できず

→ 本書時点では候補 C は不採用 (撤退基準非該当のため)。

### 5.1 推奨判断

**候補 A (Step 4) を推奨**。理由:

1. ロードマップ順序通りで自然 (Step 番号順、§3 ADK_ADOPTION.md ロードマップ)
2. Step 3 で確立した 3 つの建材 (`runnerSmoke.ts` / `sequentialSmoke.ts` / `pdcaDryRunWrapper.ts`) をほぼそのまま転用可能で技術的負債が小さい
3. 7 軸評価がすべて採用寄り、撤退基準も非該当
4. Lens は「副作用なし・依存なし・決定性あり」の純粋関数特性が `/src/side-b/AGENTS.md` でドメイン原則 §4 として明文化されており、ADK `ParallelAgent` の並列実行モデルと **構造的に親和性が高い**

ただし、Step 4 着手時の **Phase 1 spike で以下を最初に確認**:

- Lens 群の現状が純粋関数特性を維持しているか (grep / 静的解析)
- 各 Lens の input / output 型が ADK `BaseAgent` に乗せやすい形か
- 並列実行で各 Lens の trace event が混線せず観測可能か

**spike で問題が見つかれば、Step 4 中断 → Step 6 撤退判断に切り替え** する余地を残す。

---

## 6. 接続する場合の段階的開放プラン (本 Step では実装しない)

§5.1 で「Step 4 で進む」と判断したが、ADK 経由を**本番経路**に接続する判断はさらに先 (Step 6 = 最終評価) で行う。本書では将来的に接続する場合の段階的開放プランを文書化するに留める。

### 6.1 接続レベル A: dry-run スクリプトからの呼び出しのみ

- `scripts/` 配下に CLI / 一時 script を置き、そこから `pdcaDryRunWrapper` / `lensParallelSmoke` 等を呼ぶ
- 本番 SideBScheduler / Express server は無改変
- 副作用ゼロ、観測 trace のみが成果物
- **本 Step 3 完了時点での開放レベル**

### 6.2 接続レベル B: 開発環境の SideBScheduler から read-only 観測

- 開発環境 (`.env.local` で feature flag 制御) の SideBScheduler から、PDCALoop の status / log を ADK trace 経由でも観測する経路を追加
- 本番判断 (取引判断 / DB 書き込み / 通知) は引き続き既存経路で完結
- ADK trace は **追加観測** のみ
- 採用条件: Step 4 / Step 5 完了 + 本番 trace backend (Cloud Trace 等) との接続準備が整っていること

### 6.3 接続レベル C: 本番 SideBScheduler への trace 追加

- 本番 SideBScheduler が PDCALoop と並走で ADK 観測を起動
- 取引判断は引き続き既存経路、ADK は trace 観測のみ
- 採用条件: Step 6 (最終評価) でユーザー承認、撤退基準すべて非該当維持

### 6.4 接続レベル D: ADK 経由の本番判断 (Step 番号外)

- ADK 経由で本番取引判断・DB 書き込みを行う
- 採用条件: Step 6 以降の追加 Step 検討 + ユーザー明示承認 + 撤退基準厳守
- 現時点では **Step 番号外、検討未着手**

**Step 4 着手時に判断する開放レベル**: レベル A 維持 (= 本番接続しない)。レベル B 以降は Step 6 で再判断。

---

## 7. 未解決課題 (Step 4 以降に持ち越し)

Phase 1〜3 の実機検証で未解決のまま残った技術課題:

| # | 未解決事項 | 関連 | 持ち越し先 |
|---|----------|------|-----------|
| 1 | Zod validation error の Runner event stream 側からの捕捉経路 | Step 2 Phase 3 で意図的に未記録、Step 3 Phase 1 で再確認 | Step 4 / Step 5 (Runner 統合時に再評価) |
| 2 | `Context.functionCallId` の取得頻度 (optional 扱い) | Step 3 Phase 1 NOTES §3.5 | Step 4 (実 LLM smoke が必要になった時点) |
| 3 | OTel exporter 統合 (`OtelTraceSink` 実装追加) | Step 2 完了時点で interface 抽象化済み | Step 6 直前 (本番 backend 接続前) |
| 4 | 実 LLM 呼び出し smoke の必要性 | Step 3 で stub のみ完結 | 別 PR (本 Step 範囲外) |
| 5 | 同一 ADK Runner で複数 LlmAgent を切り替える場合の trace 集約方針 | Step 3 ではすべて単一 root agent | Step 4 (ParallelAgent で複数 sub-agent を持つ場合) |

---

## 8. KICKOFF §5.15 Phase 4 DoD 対応

| # | DoD | 対応 |
|---|-----|------|
| 1 | `STEP_3_INTEGRATION_DECISION.md` がある | ✅ 本書 |
| 2 | 接続可否が明記されている | ✅ §1 結論サマリー / §5 進路選択肢評価 / §6 段階的開放プラン |
| 3 | 接続する場合でも Step 3 では実装していない | ✅ §6 で「Step 4 着手時もレベル A 維持」と明記、本 PR でも実装変更ゼロ |
| 4 | 撤退基準への該当有無が明記されている | ✅ §4 で 5 項目すべて非該当を明示 |
| 5 | 次 Step の候補が明記されている | ✅ §5 で 3 候補 + 推奨判断 (候補 A = Step 4) を明示 |

---

## 9. 関連ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [`STEP_3_KICKOFF.md`](./STEP_3_KICKOFF.md) | Step 3 作業指示書 (本書は §5 Phase 4 の成果物) |
| [`STEP_3_RUNNER_SMOKE_NOTES.md`](./STEP_3_RUNNER_SMOKE_NOTES.md) | Phase 1 実測 |
| [`STEP_3_SEQUENTIAL_AGENT_NOTES.md`](./STEP_3_SEQUENTIAL_AGENT_NOTES.md) | Phase 2 実測 (sub-agent trace 契約拡張) |
| [`STEP_3_PDCA_DRYRUN_NOTES.md`](./STEP_3_PDCA_DRYRUN_NOTES.md) | Phase 3 実測 (PDCALoop 不可侵性) |
| [`STEP_3_SUMMARY.md`](./STEP_3_SUMMARY.md) | Step 3 完了サマリー (Phase 5 で作成) |
| [`ADK_ADOPTION.md`](./ADK_ADOPTION.md) | ADK 採用計画・撤退基準 |
| [`/src/side-b/AGENTS.md`](../../src/side-b/AGENTS.md) | Side-B ドメイン原則 §4 (Lens の純粋関数特性) |
