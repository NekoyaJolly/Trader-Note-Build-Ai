# ADK外側オーケストレーター + RunLedgerService内側台帳 + StrategyDraftService 完全版WBS

対象: Trader-Note-Build-Ai / Side-B

目的: `SideBScheduler` に戻りそうな実行ハブ責務を再集約せず、外側の実行順序は `ADK Orchestrator Wrapper`、内側の実行記録は `RunLedgerService`、Evolution候補の業務ライフサイクルは `StrategyDraftService` に分離する。

---

## 0. 結論

今回の完成形は、次の4層で分ける。

| 層 | 役割 | 持ってよい責務 | 持ってはいけない責務 |
|---|---|---|---|
| `SideBScheduler` | 起動入口 | cron / manual trigger / feature flag / ADK wrapper起動 | Job間状態管理、候補CRUD、台帳更新の直接実装 |
| `ADK Orchestrator Wrapper` | 外側の順序制御 | `Readiness → Plan → Monitor → Evolution → Draft → Validation` の実行順、skip/stop判断、runId伝播 | DB台帳の詳細CRUD、StrategyDraftの承認判定、既存Job内部改変 |
| `RunLedgerService` | 内側の実行台帳 | `AgentRun` / `AgentRunStep` の作成・更新・状態遷移・trace要約保存 | 実行順序の意思決定、Evolution候補の業務承認 |
| `StrategyDraftService` | Evolution候補の受け皿 | candidate受領、draft化、承認/却下、validation投入、重複抑止 | ADK orchestration、RunStepの汎用台帳処理 |

つまり、**ADKは指揮者、RunLedgerServiceは黒子の台帳、StrategyDraftServiceは候補の窓口、SideBSchedulerは目覚まし時計**。目覚まし時計に会計と人事と戦略会議をやらせていたのが元の惨劇なので、二度と戻さない。

---

## 1. 今回追加する3つの補強点

既存WBSに、以下3点を明示追加する。

### 1.1 Job Execution Contract / JobPort

分離済みJobをADKから呼ぶため、各Jobの入力・出力・失敗・skip・retryの形を揃える。

| 項目 | 内容 |
|---|---|
| 目的 | Jobごとの戻り値や例外処理がバラついて、ADK側が巨大な条件分岐地獄になるのを防ぐ |
| 作るもの | `JobExecutionContract` / `JobPort` / `JobResultEnvelope` 相当 |
| 最低限の情報 | `runId`, `stepName`, `status`, `startedAt`, `finishedAt`, `durationMs`, `summary`, `errorCode`, `nextAction`, `idempotencyKey` |
| 完了条件 | ADK Orchestratorが各Jobを同じ形で呼べる |

### 1.2 Run State Machine / 冪等性 / 排他制御

RunLedgerは単なるログテーブルではなく、実行状態の正本に近い。なので状態遷移ルールを明示する。

| 項目 | 内容 |
|---|---|
| 目的 | 二重実行、途中失敗、再実行、skip、部分成功を安全に扱う |
| 作るもの | `AgentRunStatus`, `AgentRunStepStatus`, 状態遷移テスト、`idempotencyKey`、必要ならlock/lease |
| 最低限の状態 | `pending`, `running`, `succeeded`, `failed`, `skipped`, `cancelled` |
| 完了条件 | 同じrun/stepが二重作成されない。失敗後の再実行ルールがテストされている |

### 1.3 StrategyDraft Lifecycle / 承認境界

Evolutionの成果物をすぐ検証・昇格に流さず、Draftとして受け止める業務境界を作る。

| 項目 | 内容 |
|---|---|
| 目的 | Evolution候補、検証投入、承認/却下、重複排除をSideBSchedulerやADKに持たせない |
| 作るもの | `StrategyDraftService`, `StrategyDraft` model, lifecycle status, validation queue投入API |
| 最低限の状態 | `draft`, `approved`, `rejected`, `queued_for_validation`, `validated`, `archived` |
| 完了条件 | Evolution候補をDraft化し、人間またはルールで承認/却下できる。Validation投入はDraft経由になる |

---

## 2. アーキテクチャ前提

### 2.1 依存方向

```text
SideBScheduler
  ↓ 起動だけ
ADK Orchestrator Wrapper
  ↓ JobPort / Tool Adapter 経由
既存Job群
  ↓ 実行事実を記録
RunLedgerService
  ↓ Evolution候補のみ業務管理
StrategyDraftService
```

禁止する依存方向:

```text
既存Job → ADK SDK 直接依存
RunLedgerService → ADK SDK 直接依存
StrategyDraftService → ADK SDK 直接依存
SideBScheduler → AgentRunStep 直接CRUD
SideBScheduler → StrategyDraft 直接CRUD
```

### 2.2 ADKの役割

ADKは、既存実装を置き換えない。やることは次だけ。

- 既存Job / Skill / Agent wrapperを順序通り呼ぶ
- `runId` と `stepName` を伝播する
- 途中失敗時の `stop / skip / retry / continue` を判断する
- trace eventを `TraceSink` に流す
- 最終的な実行summaryを返す

ADKが持たないもの:

- プロダクトDBの詳細CRUD
- Evolution候補の承認・却下判断
- PDCALoop / EvolutionLoop / Lens内部の実装
- raw prompt / raw output / secret / DB row全文

### 2.3 RunLedgerServiceの役割

RunLedgerServiceは、Side-Bの実行記録の共通サービス。ADK経由でも、Scheduler直呼びでも、将来の手動実行でも同じAPIを使う。

最低限のAPI案:

| API | 役割 |
|---|---|
| `startRun(input)` | `AgentRun` を開始する |
| `finishRun(runId, result)` | run全体を成功/失敗/キャンセルで閉じる |
| `startStep(runId, step)` | `AgentRunStep` を開始する |
| `succeedStep(runId, stepName, summary)` | step成功を記録する |
| `failStep(runId, stepName, error)` | step失敗を記録する |
| `skipStep(runId, stepName, reason)` | step skipを記録する |
| `appendTraceEvent(runId, event)` | redaction済みtrace要約を追記する |
| `findRunWithSteps(runId)` | UI/調査用にrun詳細を読む |

### 2.4 StrategyDraftServiceの役割

StrategyDraftServiceは、Evolution候補を受け取り、Draftとして保管し、検証投入までのライフサイクルを管理する。

最低限のAPI案:

| API | 役割 |
|---|---|
| `createFromEvolutionCandidate(candidate, context)` | Evolution候補をDraft化する |
| `dedupeDraft(candidateHash)` | 同一候補の重複作成を防ぐ |
| `approveDraft(draftId, reviewer)` | Draftを承認する |
| `rejectDraft(draftId, reviewer, reason)` | Draftを却下する |
| `queueForValidation(draftId)` | Validation投入対象にする |
| `markValidated(draftId, result)` | 検証結果を紐づける |
| `archiveDraft(draftId, reason)` | 不要Draftを保管終了する |

---

## 3. 完成時のGolden Path

```text
1. SideBScheduler が起動条件を満たす
2. SideBScheduler が ADK Orchestrator Wrapper を起動する
3. ADK Orchestrator Wrapper が RunLedgerService.startRun() で runId を作る
4. Readiness Job を JobPort 経由で実行
5. Plan Job を JobPort 経由で実行
6. Monitor Job を JobPort 経由で実行
7. Evolution Job を JobPort 経由で実行
8. Evolution候補があれば StrategyDraftService.createFromEvolutionCandidate() へ渡す
9. Draft承認済み、または自動投入条件を満たすものだけ Validation Job へ渡す
10. RunLedgerService.finishRun() でrun全体を閉じる
11. UI / logs / report から AgentRun / AgentRunStep / StrategyDraft を追跡できる
```

重要: Validationへ直接流すかどうかは、最初は保守的にする。Evolution候補が出たから即Validation投入、という人類おなじみの「動いたから本番へ行こう」事故を避ける。

---

## 4. WBS全体像

| Phase | 名称 | 目的 | PR単位の目安 |
|---|---|---|---|
| Phase 0 | 前提固定 / 差分棚卸し | 既存状態と不可侵領域を固定する | 1 PR or docs only |
| Phase 1 | Prisma Schema / Domain Model | `AgentRun`, `AgentRunStep`, `StrategyDraft` のDB実体を作る | 1 PR |
| Phase 2 | RunLedgerService | 実行台帳の共通CRUDと状態遷移を実装する | 1 PR |
| Phase 3 | Job Execution Contract / JobPort | 分離済みJobを共通I/Oで呼べるようにする | 1 PR |
| Phase 4 | StrategyDraftService | Evolution候補のDraftライフサイクルを実装する | 1 PR |
| Phase 5 | TraceSink → RunLedger Adapter | ADK/Job traceをRunLedgerへ接続する | 1 PR |
| Phase 6 | ADK Orchestrator Wrapper | Golden Pathの外側制御を実装する | 1 PR |
| Phase 7 | SideBScheduler接続 | Schedulerを起動入口に限定して接続する | 1 PR |
| Phase 8 | API / UI / Admin確認口 | Run / Step / Draft を確認できる導線を作る | 1 PR |
| Phase 9 | 統合テスト / 失敗系 / 回帰 | 既存テストと新規テストの整合を取る | 1 PR |
| Phase 10 | Docs / 運用Runbook / 撤退条件 | 引き継ぎと運用判断を文書化する | 1 PR |

---

## 5. Phase 0: 前提固定 / 差分棚卸し

### 目的

実装前に、既存の責務分離状態・8 Job構成・既存テスト・不可侵領域を固定する。

| WBS ID | タスク | 詳細 | 主担当 | 依存 | 成果物 | 完了条件 |
|---|---|---|---|---|---|---|
| 0.1 | 現状Job一覧作成 | 分離済み8 Jobのファイル、責務、入出力、依存DBを一覧化 | Backend | なし | `CURRENT_SIDE_B_JOBS.md` | 各Jobの責務が1行で説明できる |
| 0.2 | SideBScheduler責務確認 | Schedulerに残っている責務を棚卸し | Backend | 0.1 | Scheduler責務表 | 起動入口以外の責務が残っていれば移譲先を決める |
| 0.3 | 不可侵領域再確認 | `skills`, `agent`, `lenses`, `evolution`, `ledger` などの改変禁止範囲を確認 | Owner / Backend | なし | 不可侵リスト | 変更禁止範囲がPR説明に載る |
| 0.4 | 既存テストbaseline取得 | 現時点のtest/typecheck/lint結果を取得 | QA | なし | baseline log | 後続PRで壊したか判定できる |
| 0.5 | 実装順序最終確認 | Phase 1〜10のPR分割を確定 | Owner | 0.1〜0.4 | 実装順序メモ | 1 PRに複数Phaseを混ぜない方針が確認済み |

### Phase 0 DoD

- [ ] 分離済みJob一覧がある
- [ ] Schedulerの残責務が把握されている
- [ ] 既存テストbaselineが保存されている
- [ ] 不可侵領域に対するgit diff禁止が明文化されている

---

## 6. Phase 1: Prisma Schema / Domain Model

### 目的

RunLedgerとStrategyDraftのDB実体を追加する。ここではサービスロジックを作り込みすぎない。

| WBS ID | タスク | 詳細 | 主担当 | 依存 | 成果物 | 完了条件 |
|---|---|---|---|---|---|---|
| 1.1 | `AgentRun` model設計 | run全体の状態、起動元、trigger、status、summaryを保存 | Backend | Phase 0 | Prisma schema案 | 必須fieldとindexが決まる |
| 1.2 | `AgentRunStep` model設計 | step単位の状態、順序、error、nextAction、traceKindを保存 | Backend | 1.1 | Prisma schema案 | `runId + stepName + attempt` の一意性方針が決まる |
| 1.3 | `StrategyDraft` model設計 | Evolution候補、hash、status、承認者、検証投入状態を保存 | Backend | Phase 0 | Prisma schema案 | 重複排除用hash/indexがある |
| 1.4 | enum設計 | run/step/draftのstatus enumを作る | Backend | 1.1〜1.3 | enum定義 | 状態遷移表と対応している |
| 1.5 | migration作成 | Prisma migrationを作成 | Backend | 1.1〜1.4 | migration | local DBへ適用できる |
| 1.6 | schema smoke test | modelの作成・参照・削除の最低限テスト | QA | 1.5 | DB test | CIで通る |

### 推奨field

#### AgentRun

| field | 用途 |
|---|---|
| `id` | runId |
| `kind` | `side_b_cycle`, `manual`, `dry_run` など |
| `triggeredBy` | `scheduler`, `manual`, `test`, `adk` など |
| `status` | `pending/running/succeeded/failed/skipped/cancelled` |
| `startedAt` / `finishedAt` | 実行時刻 |
| `summary` | redaction済み要約 |
| `errorCode` / `errorMessage` | 失敗時の短い情報 |
| `idempotencyKey` | 二重実行防止 |

#### AgentRunStep

| field | 用途 |
|---|---|
| `id` | step id |
| `runId` | AgentRun外部キー |
| `stepName` | `readiness`, `plan`, `monitor`, `evolution`, `draft`, `validation` など |
| `status` | step status |
| `attempt` | retry回数 |
| `startedAt` / `finishedAt` | step時刻 |
| `durationMs` | 所要時間 |
| `summary` | redaction済み要約 |
| `errorCode` / `errorMessage` | 短縮エラー |
| `nextAction` | `continue`, `stop`, `skip`, `retry`, `manual_review` など |
| `traceKind` | `adk`, `job`, `service` など |

#### StrategyDraft

| field | 用途 |
|---|---|
| `id` | draft id |
| `sourceRunId` | 生成元run |
| `sourceStepId` | 生成元step |
| `candidateHash` | 重複排除 |
| `status` | draft lifecycle |
| `strategySummary` | redaction済み候補要約 |
| `riskSummary` | リスク要約 |
| `approvalReason` / `rejectionReason` | 判断理由 |
| `validatedAt` | 検証完了時刻 |
| `validationResultId` | 検証結果への参照が必要なら追加 |

### Phase 1 DoD

- [ ] Prisma schemaに `AgentRun`, `AgentRunStep`, `StrategyDraft` が追加されている
- [ ] migrationが通る
- [ ] index / unique制約が二重実行・重複Draftを防ぐ設計になっている
- [ ] 既存schemaの破壊的変更がない

---

## 7. Phase 2: RunLedgerService

### 目的

ADK / Scheduler / 各Job / PDCA から共通利用できる実行台帳サービスを作る。

| WBS ID | タスク | 詳細 | 主担当 | 依存 | 成果物 | 完了条件 |
|---|---|---|---|---|---|---|
| 2.1 | Repository実装 | AgentRun / AgentRunStepのDB操作を閉じ込める | Backend | Phase 1 | `RunLedgerRepository` | create/update/findがテスト済み |
| 2.2 | Service API実装 | `startRun`, `finishRun`, `startStep`, `succeedStep`, `failStep`, `skipStep` | Backend | 2.1 | `RunLedgerService` | ADK非依存で使える |
| 2.3 | 状態遷移ルール実装 | 不正遷移を防ぐ | Backend | 2.2 | state transition helper | `succeeded → running` などが拒否される |
| 2.4 | 冪等性実装 | `idempotencyKey` / unique制約で二重実行を抑止 | Backend | 2.1〜2.3 | idempotency処理 | 同一keyで二重runが作られない |
| 2.5 | retry / attempt設計 | step retry時のattempt増加と前回失敗の扱いを決める | Backend / QA | 2.3 | retry仕様 | attemptごとのstepが追跡できる |
| 2.6 | redaction helper接続 | trace summary以外を保存しない | Backend | 2.2 | redaction utility | raw prompt / raw output が保存されない |
| 2.7 | Service test | 正常/失敗/skip/retry/二重実行をテスト | QA | 2.1〜2.6 | Jest tests | 状態遷移が網羅される |

### Phase 2 DoD

- [ ] RunLedgerServiceがADK SDKに依存していない
- [ ] run/stepの状態遷移がテストされている
- [ ] 二重実行を抑止できる
- [ ] redaction済みsummaryしか保存しない
- [ ] SideBSchedulerから直接AgentRunStepを触る必要がない

---

## 8. Phase 3: Job Execution Contract / JobPort

### 目的

分離されたJob群を、ADKから同じ形で呼べるようにする。ここを曖昧にすると、ADK Orchestratorが再びSideBScheduler級の巨大条件分岐怪物になる。やめよう、人類はすぐ怪物を作る。

| WBS ID | タスク | 詳細 | 主担当 | 依存 | 成果物 | 完了条件 |
|---|---|---|---|---|---|---|
| 3.1 | 既存Job I/O棚卸し | 8 Jobの引数、戻り値、例外、DB依存を一覧化 | Backend | Phase 0 | Job I/O表 | 共通化できる項目が見えている |
| 3.2 | `JobResultEnvelope`設計 | 全Jobが返す共通結果型を決める | Backend | 3.1 | 型定義 | `ok/status/summary/nextAction/error` がある |
| 3.3 | `JobPort` interface設計 | ADK Orchestratorが呼ぶ共通interfaceを作る | Backend / ADK担当 | 3.2 | interface | 各Jobを差し替え可能 |
| 3.4 | Job adapter実装 | 既存Jobを改変せずadapterで包む | Backend | 3.3 | adapters | 既存Job内部のgit diffが最小 |
| 3.5 | RunLedger連携 | adapterがstep開始/成功/失敗/skipを記録 | Backend | Phase 2, 3.4 | ledger-aware adapters | Job実行ごとにRunStepが残る |
| 3.6 | エラー正規化 | Jobごとの例外/戻り値失敗を共通errorへ変換 | Backend | 3.4 | error mapper | ADK側が個別Job例外を知らなくてよい |
| 3.7 | adapter test | 各Job adapterの正常/失敗/skipをテスト | QA | 3.4〜3.6 | Jest tests | ADKなしでもadapter単体で検証できる |

### JobResultEnvelope案

| 項目 | 内容 |
|---|---|
| `ok` | 実行成功か |
| `status` | `succeeded/failed/skipped` |
| `stepName` | RunStep名 |
| `summary` | redaction済み要約 |
| `dataRef` | 必要なら生成物IDだけ。生データは持たない |
| `errorCode` | 失敗コード |
| `errorMessage` | 短縮メッセージ |
| `nextAction` | `continue/stop/skip/retry/manual_review` |

### Phase 3 DoD

- [ ] ADK OrchestratorがJobごとの詳細を知らずに呼べる
- [ ] 各Job adapterがRunLedgerへstepを残す
- [ ] Job内部にADK依存を入れていない
- [ ] エラーが構造化されている

---

## 9. Phase 4: StrategyDraftService

### 目的

Evolution候補の受け皿を作る。候補のDraft化、重複排除、承認/却下、Validation投入を一箇所に集める。

| WBS ID | タスク | 詳細 | 主担当 | 依存 | 成果物 | 完了条件 |
|---|---|---|---|---|---|---|
| 4.1 | Evolution候補I/O棚卸し | EvolutionJobが出す候補情報を確認 | Backend | Phase 3 | candidate spec | Draft化に必要な情報が決まる |
| 4.2 | Repository実装 | StrategyDraft DB操作を閉じ込める | Backend | Phase 1 | `StrategyDraftRepository` | create/update/findがテスト済み |
| 4.3 | Service API実装 | `createFromEvolutionCandidate`, `approve`, `reject`, `queueForValidation` | Backend | 4.2 | `StrategyDraftService` | ADK非依存で使える |
| 4.4 | 重複排除実装 | `candidateHash`で同一候補を抑止 | Backend | 4.3 | dedupe処理 | 同一候補でDraftが増殖しない |
| 4.5 | status transition実装 | Draft lifecycleの不正遷移を拒否 | Backend | 4.3 | transition helper | `rejected → queued_for_validation` などが拒否される |
| 4.6 | Validation投入連携 | 承認済みDraftをValidation Jobへ渡す口を作る | Backend | 4.3, Phase 3 | validation handoff | Draft経由でValidationに流せる |
| 4.7 | Service test | 作成/重複/承認/却下/投入/不正遷移をテスト | QA | 4.2〜4.6 | Jest tests | lifecycleが守られる |

### Phase 4 DoD

- [ ] Evolution候補がStrategyDraftとして保存される
- [ ] Draft重複が抑止される
- [ ] 承認/却下/検証投入の状態遷移がテストされている
- [ ] ADKやSchedulerがDraftのDBを直接触らない
- [ ] Validation投入はStrategyDraftService経由になる

---

## 10. Phase 5: TraceSink → RunLedger Adapter

### 目的

既存のADK trace contractを、RunLedgerの永続台帳へ接続する。ただしraw payloadは保存しない。

| WBS ID | タスク | 詳細 | 主担当 | 依存 | 成果物 | 完了条件 |
|---|---|---|---|---|---|---|
| 5.1 | 既存TraceSink確認 | Step 2〜4で作ったTraceSink契約を確認 | ADK担当 | Phase 0 | trace contract memo | event種別が把握済み |
| 5.2 | `RunLedgerTraceSink`設計 | trace eventをAgentRunStep/trace summaryへ変換 | ADK担当 / Backend | Phase 2 | adapter設計 | ADK eventがRunLedgerへ流れる |
| 5.3 | redaction保証 | raw args/result/prompt/responseを保存しない | Backend | 5.2 | redaction tests | 生payload保存がテストで落ちる |
| 5.4 | failure isolation | TraceSink失敗でJob本体を壊さない | ADK担当 | 5.2 | isolation処理 | sink throw/rejectでもJob結果は維持 |
| 5.5 | adapter test | started/completed/failed/skipを記録 | QA | 5.2〜5.4 | Jest tests | RunLedgerに期待通り残る |

### Phase 5 DoD

- [ ] ADK trace eventがRunLedgerに保存される
- [ ] TraceSink失敗が本体実行を壊さない
- [ ] raw payloadを保存しない
- [ ] RunLedgerServiceはADK SDKへ依存しない。依存するのはadapter側だけ

---

## 11. Phase 6: ADK Orchestrator Wrapper

### 目的

`Readiness → Plan → Monitor → Evolution → Draft → Validation` のGolden Pathを、ADK側の外側レイヤーで束ねる。

| WBS ID | タスク | 詳細 | 主担当 | 依存 | 成果物 | 完了条件 |
|---|---|---|---|---|---|---|
| 6.1 | sequence設計 | Golden Pathの順序、入力、出力、停止条件を定義 | ADK担当 / Owner | Phase 3〜5 | sequence設計書 | 全stepの分岐が決まる |
| 6.2 | Wrapper骨格実装 | `runSideBOrchestratedCycle()` 相当を作る | ADK担当 | 6.1 | orchestrator wrapper | runId付きで起動できる |
| 6.3 | Readiness step接続 | readiness失敗時のstop/skipを実装 | ADK担当 / Backend | Phase 3 | step adapter | readiness結果がRunStepに残る |
| 6.4 | Plan / Monitor step接続 | PlanとMonitorを順序通り呼ぶ | ADK担当 / Backend | 6.3 | step adapters | 成功/失敗がRunStepに残る |
| 6.5 | Evolution step接続 | EvolutionJobを呼び候補を取得 | ADK担当 / Backend | 6.4 | evolution adapter | 候補0件時のskipが定義済み |
| 6.6 | Draft step接続 | Evolution候補をStrategyDraftServiceへ渡す | Backend / ADK担当 | Phase 4, 6.5 | draft handoff | Draft作成結果がRunStepに残る |
| 6.7 | Validation step接続 | Draft承認済み/投入可能なものだけValidationへ渡す | Backend / ADK担当 | 6.6 | validation handoff | 未承認Draftを勝手に流さない |
| 6.8 | 失敗分岐実装 | stop/skip/retry/manual_reviewを扱う | ADK担当 | 6.3〜6.7 | branch handling | nextActionがRunLedgerに残る |
| 6.9 | Orchestrator test | 正常系、候補0件、途中失敗、Draft未承認、Validation失敗 | QA | 6.2〜6.8 | Jest tests | Golden Pathが検証済み |

### Phase 6 DoD

- [ ] ADKが外側の順序を表現している
- [ ] 各step結果がRunLedgerに残る
- [ ] StrategyDraftService経由で候補が扱われる
- [ ] SideBSchedulerには台帳・候補管理が戻っていない
- [ ] PDCALoop/EvolutionLoop/Lens内部を置き換えていない

---

## 12. Phase 7: SideBScheduler接続

### 目的

SideBSchedulerを「起動入口」に限定し、ADK Orchestrator Wrapperを呼ぶ。

| WBS ID | タスク | 詳細 | 主担当 | 依存 | 成果物 | 完了条件 |
|---|---|---|---|---|---|---|
| 7.1 | Scheduler現行経路確認 | 既存run経路、cron/manual trigger、feature flagを確認 | Backend | Phase 0 | scheduler map | 置換箇所が明確 |
| 7.2 | feature flag追加 | ADK Orchestrator経由を段階ONにする | Backend | Phase 6 | config | OFFなら既存経路に戻せる |
| 7.3 | Scheduler接続 | SchedulerからWrapperを起動する | Backend | 7.2 | scheduler integration | runId付きで起動できる |
| 7.4 | Scheduler責務削減確認 | Scheduler内に台帳CRUD/Draft CRUDがないか確認 | QA / Backend | 7.3 | diff review | 肥大化していない |
| 7.5 | rollback確認 | feature flag OFF / adk配下削除時の戻し方を確認 | Backend | 7.3 | rollback memo | 即戻せる |

### Phase 7 DoD

- [ ] Schedulerは起動入口に留まる
- [ ] RunLedgerService / StrategyDraftServiceを直接CRUDしない。必要ならWrapper経由
- [ ] feature flagで旧経路へ戻せる
- [ ] Schedulerファイルが再び巨大化していない

---

## 13. Phase 8: API / UI / Admin確認口

### 目的

Run / Step / Draftを人間が確認できるようにする。台帳を作っても見えなければ、ただの高級なブラックボックス。しかも人類はだいたい見えないものを信じない。

| WBS ID | タスク | 詳細 | 主担当 | 依存 | 成果物 | 完了条件 |
|---|---|---|---|---|---|---|
| 8.1 | Run一覧API | AgentRun一覧を取得 | Backend | Phase 2 | API | status/trigger/startedAtで見られる |
| 8.2 | Run詳細API | AgentRun + AgentRunStepを取得 | Backend | 8.1 | API | step時系列が見える |
| 8.3 | Draft一覧API | StrategyDraft一覧を取得 | Backend | Phase 4 | API | status/hash/sourceRunで見られる |
| 8.4 | Draft操作API | approve/reject/queueForValidation | Backend | 8.3 | API | 不正遷移が拒否される |
| 8.5 | 最小UIまたは管理ビュー | Run詳細とDraft操作を確認できる画面 | Frontend | 8.1〜8.4 | UI | 手動確認ができる |
| 8.6 | 権限/安全確認 | Draft承認操作の権限を確認 | Backend / Owner | 8.4 | auth check | 誰でも承認できない |

### Phase 8 DoD

- [ ] Run/Step/Draftが確認できる
- [ ] Draft承認/却下/投入が安全に操作できる
- [ ] raw payloadやsecretがUIに出ない
- [ ] 操作権限が最低限守られている

---

## 14. Phase 9: 統合テスト / 失敗系 / 回帰

### 目的

単体では動くが統合すると死ぬ、というソフトウェア界の伝統芸能を潰す。

| WBS ID | タスク | 詳細 | 主担当 | 依存 | 成果物 | 完了条件 |
|---|---|---|---|---|---|---|
| 9.1 | Golden Path integration test | Scheduler起動相当からRun完了まで通す | QA | Phase 7 | integration test | Run/Step/Draftが期待通り残る |
| 9.2 | Readiness失敗test | readiness失敗で後続stepがskip/stopされる | QA | Phase 6 | failure test | nextActionが残る |
| 9.3 | Evolution候補0件test | Draftなしで正常終了またはskip扱い | QA | Phase 6 | edge test | 候補0件が失敗扱いにならない |
| 9.4 | Draft未承認test | 未承認DraftがValidationへ流れない | QA | Phase 4,6 | safety test | 勝手に検証投入されない |
| 9.5 | Validation失敗test | validation失敗時にRunStepがfailedになる | QA | Phase 6 | failure test | 失敗理由が残る |
| 9.6 | 冪等性test | 同一trigger/idempotencyKeyで二重runが作られない | QA | Phase 2,7 | idempotency test | 二重起動が抑止される |
| 9.7 | rollback test | feature flag OFFで旧経路へ戻る | QA | Phase 7 | rollback test | ADKなしでも動く |
| 9.8 | 既存回帰test | 既存Side-B / ADK Step 1〜4 testsを全実行 | QA | 全Phase | test log | 既存が壊れていない |

### 実行コマンド

```bash
# 実行場所: リポジトリルート
npm test -- --runInBand src/side-b/adk

# 実行場所: リポジトリルート
npm test -- --runInBand src/side-b

# 実行場所: リポジトリルート
npm run typecheck

# 実行場所: リポジトリルート
npm run lint
```

プロジェクトのscript名が違う場合は、実在するscriptへ読み替える。

### Phase 9 DoD

- [ ] Golden Pathが統合テストで通る
- [ ] 主要失敗系がRunLedgerに残る
- [ ] 未承認DraftがValidationへ流れない
- [ ] 同一triggerの二重runが抑止される
- [ ] 既存テストが壊れていない

---

## 15. Phase 10: Docs / 運用Runbook / 撤退条件

### 目的

次の作業者が迷子にならないように、構造と運用を文書化する。迷子のエージェントはだいたいSchedulerに責務を戻す。危険生物である。

| WBS ID | タスク | 詳細 | 主担当 | 依存 | 成果物 | 完了条件 |
|---|---|---|---|---|---|---|
| 10.1 | Architecture更新 | ADK / RunLedger / StrategyDraft / Schedulerの責務を文書化 | Docs / Backend | 全Phase | `ADK_ADOPTION.md`更新 | 責務境界が明確 |
| 10.2 | Runbook作成 | 失敗run調査、再実行、Draft承認/却下、rollback手順 | Backend / Ops | Phase 8,9 | `RUNBOOK_SIDE_B_ORCHESTRATION.md` | 実運用で使える |
| 10.3 | API/Service README | 各ServiceのAPIと禁止事項を書く | Backend | Phase 2,4,6 | README | 直接CRUD禁止が明記 |
| 10.4 | Step Summary作成 | 実装結果、変更ファイル、テスト結果、残課題 | Docs | 全Phase | Summary | 次Stepへ引き継げる |
| 10.5 | 撤退条件確認 | ADKサイドカー削除時の影響範囲を確認 | Owner / Backend | 全Phase | rollback section | `/src/side-b/adk`削除だけで戻せる範囲が明確 |

### Phase 10 DoD

- [ ] 責務境界が文書化されている
- [ ] Runbookがある
- [ ] 直接DB CRUD禁止が明記されている
- [ ] 撤退可能性が維持されている

---

## 16. GitHub Issue化する場合の推奨単位

| Issue | 内容 | 含めるPhase |
|---|---|---|
| `ORCH-00` | 前提固定 / Job棚卸し | Phase 0 |
| `ORCH-01` | Prisma schema: AgentRun / AgentRunStep / StrategyDraft | Phase 1 |
| `ORCH-02` | RunLedgerService実装 | Phase 2 |
| `ORCH-03` | JobPort / JobResultEnvelope実装 | Phase 3 |
| `ORCH-04` | StrategyDraftService実装 | Phase 4 |
| `ORCH-05` | RunLedgerTraceSink adapter | Phase 5 |
| `ORCH-06` | ADK Orchestrator Wrapper | Phase 6 |
| `ORCH-07` | SideBScheduler接続 / feature flag | Phase 7 |
| `ORCH-08` | Run/Draft API/UI | Phase 8 |
| `ORCH-09` | 統合テスト / 回帰 | Phase 9 |
| `ORCH-10` | Docs / Runbook / Summary | Phase 10 |

---

## 17. PRごとの禁止事項

全PR共通:

- `SideBScheduler` に台帳CRUDを戻さない
- `SideBScheduler` にStrategyDraft CRUDを戻さない
- 既存Job内部にADK SDK依存を入れない
- `RunLedgerService` / `StrategyDraftService` にADK SDK依存を入れない
- raw prompt / raw response / API key / DB row全文を保存しない
- `any` / `as any` / `as unknown as` で型を逃がさない
- 既存不可侵領域をADK都合で書き換えない
- 1 PRに複数Phaseを混ぜない

---

## 18. 最終DoD

このWBS全体の完了条件:

- [ ] `SideBScheduler` は起動入口に戻っている
- [ ] ADK Orchestrator Wrapper がGolden Pathを外側から束ねている
- [ ] RunLedgerService が `AgentRun` / `AgentRunStep` を共通台帳として管理している
- [ ] StrategyDraftService がEvolution候補のDraft lifecycleを管理している
- [ ] 各JobはJobPort/adapter経由で共通I/O化されている
- [ ] Run / Step / Draft が人間から確認できる
- [ ] 主要失敗系がテストされている
- [ ] 二重実行・未承認投入・raw payload保存が防がれている
- [ ] 既存Side-B中核の不可侵領域が守られている
- [ ] ADKを外しても既存実装が壊れない

---

## 19. 実装開始時のエージェント向け短縮指示

```text
目的:
SideBSchedulerに戻りそうな実行ハブ責務を、ADK Orchestrator Wrapper / RunLedgerService / StrategyDraftServiceへ分離する。

最重要方針:
- ADKは外側の順序制御だけを持つ
- RunLedgerServiceはrun/stepの永続台帳だけを持つ
- StrategyDraftServiceはEvolution候補のDraft lifecycleだけを持つ
- SideBSchedulerは起動入口だけに戻す
- 既存Job / PDCALoop / EvolutionLoop / Lens内部は置き換えない

まずやること:
1. 現在の8 JobとSideBScheduler残責務を棚卸しする
2. AgentRun / AgentRunStep / StrategyDraft schemaを設計する
3. RunLedgerServiceの状態遷移と冪等性を先に固める
4. JobPort / JobResultEnvelopeで各Jobの呼び方を揃える
5. StrategyDraftServiceでEvolution候補の受け皿を作る
6. 最後にADK Orchestrator WrapperでGolden Pathを束ねる

禁止:
- Schedulerに台帳CRUDやDraft CRUDを戻すな
- ADKを既存Job内部に侵入させるな
- raw payloadを保存するな
- 型をanyで逃げるな
```

