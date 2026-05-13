# STEP_3_KICKOFF.md

# Step 3: ADK Runner / SequentialAgent Smoke + PDCALoop Dry-run Wrapper

## 0. このドキュメントの目的

本ドキュメントは、Trader-Note-Build-Ai の Side-B ADK 段階導入における **Step 3 実装指示書**である。

Step 1 では既存 `SkillRegistry` を ADK `FunctionTool[]` として利用する adapter 基盤を確立した。Step 2 では `TraceSink` / redaction / adapter 内 trace を確立し、ADK Runner が動いた場合に「何が起きたか」を追跡できる土台を作った。

Step 3 では、いよいよ ADK の Runner / LlmAgent / SequentialAgent を実機で動かす。ただし、本 Step は本番統合ではない。目的は、既存 Side-B loop を ADK に置換することではなく、**ADK 実行経路を既存実装の外側に隔離したまま、dry-run と trace で観測可能にすること**である。

雑に接続すると、せっかくスリム化した SideBScheduler がまた神クラスの幼体に戻る。今回はそれを避ける。

---

## 1. 現在地

### 1.1 Step 1 完了状態

Step 1 で以下が完了済み。

- `SkillRegistry` から ADK `FunctionTool[]` を生成する adapter を実装
- `jsonSchemaToZod` による parameters 変換を実装
- `toSkillContext()` による ADK `Context` → 既存 `SkillContext` 変換を実装
- 既存 `Skill` / `SkillRegistry` / `SkillContext` を改変しない方針を維持
- ADK public API のみ利用する方針を確定
- 既存 `Skill.invoke()` と ADK `FunctionTool.runAsync()` の等価性検証を実装

### 1.2 Step 2 完了状態

Step 2 で以下が完了済み。

- `/src/side-b/adk/tracing/` に trace contract を追加
- `TraceSink` interface を確定
- `NoopTraceSink` を実装
- `InMemoryTraceSink` を実装
- `TracePayloadSummary` による redaction-first の summary 設計を確定
- raw args / raw result / prompt / response 全文を trace に保存しない方針を確定
- `skillRegistryToAdkTools()` に optional `{ traceSink }` を追加
- traceSink 未指定時の既存挙動維持を確認
- traceSink 指定時に FunctionTool 実行前後の trace event が記録されることを確認
- traceSink 側の失敗が Skill 実行結果を壊さないことを確認
- 既存 `/src/side-b/skills/` / `/src/side-b/agent/` / `prisma/schema.prisma` を改変しない方針を維持
- `DatabaseSessionService` を採用しない方針を維持
- Step 3 に Runner / LlmAgent / SequentialAgent / PDCALoop dry-run wrapper を回す判断を確定

### 1.3 Step 3 の役割

Step 3 の役割は以下。

1. ADK Runner / LlmAgent を最小構成で実機 smoke する
2. ADK SequentialAgent を toy sub-agent 構成で実機 smoke する
3. 既存 PDCALoop を **合成による wrapper** として dry-run 観測する
4. 既存 Side-B loop へ接続してよいかどうかを判断ドキュメントにまとめる

重要: Step 3 では **接続しない**。判断だけ行う。

---

## 2. 基本方針

### 2.1 Step 3 の最重要方針

本 Step では、ADK を既存 Side-B 実装の外側に隔離する。

- 既存実装は不可侵
- ADK 側から既存実装を読む / 呼ぶのは可
- 既存実装から ADK 側への import は不可
- `SideBScheduler` から ADK Runner を呼ばない
- `PDCALoop` / `AgentLoop` / `EvolutionLoop` を ADK に置換しない
- DB 書き込み・通知・取引判断を発生させない
- dry-run wrapper は `/src/side-b/adk/agents/` 配下に隔離する
- trace は `TraceSink` 経由で記録する
- raw payload は保存しない

### 2.2 session-less 方針

Step 3 では原則として `Runner.runEphemeral()` を優先する。

理由:

- `Runner.runAsync()` は `sessionId` / `userId` が必要になる
- 現時点では ADK 側の session 永続化を本番採用しない
- `DatabaseSessionService` は MikroORM peer dependency との絡みがあり、Prisma 採用プロジェクトとは相性確認が必要
- 既存プロジェクトは Prisma ORM 採用であり、ADK の session 管理を無理に既存DBへ混ぜる理由がまだない

本 Step では `InMemorySessionService` と `runEphemeral()` の組み合わせを第一候補とする。

### 2.3 SequentialAgent の扱い

`SequentialAgent` は、順序固定の workflow agent として扱う。

本 Step では以下を検証する。

- sub-agent が指定順に実行されるか
- 各 sub-agent が同じ invocation context / state を共有するか
- step ごとの trace event を記録できるか
- error 時に `started` が `failed` で閉じるか

ただし、`SequentialAgent` で既存 PDCALoop の private state handler を直接 sub-agent 化しない。

### 2.4 PDCALoop dry-run wrapper の扱い

PDCALoop は既存実装を改変せず、public API 経由で wrapper する。

本 Step で目指すのは、PDCALoop の内部 state machine を ADK sub-agent に分解することではない。private method / private state handler に触れると既存設計の封じ込めを破壊する。人類は「ちょっとだけ private を覗く」を何度も文明の敗北にしてきたので、今回はやらない。

本 Step では以下を採用する。

- PDCALoop 全体または public API 実行単位を span 化する
- private state handler 単位の span 化は必須完了条件に含めない
- state handler 単位の観測が必要な場合は、Step 4 以降で PDCALoop 側に正式 hook を追加するか別途判断する

---

## 3. スコープ

### 3.1 本 Step でやること

- `Runner.runEphemeral()` + `InMemorySessionService` + `LlmAgent` + `skillRegistryToAdkTools()` の実機 smoke
- Runner 経由でも `TraceSink` に event が記録されることを確認
- ADK `Context.invocationId` / `agentName` / `functionCallId` が adapter execute に届くか確認
- ADK `SequentialAgent` の最小構成 smoke
- toy sub-agent の順序実行と trace を確認
- `/src/side-b/adk/agents/` 配下に PDCALoop dry-run wrapper を追加
- PDCALoop public API 経由で観測可能な実行単位を trace event として記録
- 既存 Side-B loop との接続可否を `STEP_3_INTEGRATION_DECISION.md` にまとめる
- Step 1 / Step 2 のテストを未改変で全 pass 維持
- Step 3 summary を作成

### 3.2 本 Step でやらないこと

- `SideBScheduler` から ADK Runner を呼ぶこと
- 既存 loop を ADK に置換すること
- `pdcaLoop.ts` の内部改変
- `agentLoop.ts` の内部改変
- `agentMemory.ts` の内部改変
- `evolutionLoop` 系の内部改変
- `/src/side-b/skills/` の改変
- `PromptRegistry` の改変
- Prisma schema 変更
- ADK `DatabaseSessionService` 導入
- 外部 observability backend への本番接続
- Cloud Trace / Datadog / Grafana 連携
- UI 追加
- 本番 scheduler への組み込み
- unrelated refactor
- ESLint / tsconfig の既存違反を巻き取る大規模修正

### 3.3 dry-run wrapper の定義

本 Step における dry-run wrapper とは以下を満たすもの。

- ADK 側の新規コードとして実装される
- 既存 PDCALoop を import して利用することは可
- 既存 PDCALoop の source code は改変しない
- private method / private field にアクセスしない
- DB 書き込みを起こさない
- 通知を送らない
- 取引判断を本番経路に流さない
- SideBScheduler から呼ばれない
- trace だけを観測成果物として残す
- いつでも `git rm -rf src/side-b/adk/` で撤退できる

---

## 4. 成果物

Step 3 の最終成果物は以下。

### 4.1 実装成果物

候補パス:

- `/src/side-b/adk/agents/runnerSmoke.ts`
- `/src/side-b/adk/agents/sequentialSmoke.ts`
- `/src/side-b/adk/agents/pdcaDryRunWrapper.ts`
- `/src/side-b/adk/agents/index.ts`
- `/src/side-b/adk/agents/README.md`

実際のファイル名は実装上の整合を優先して調整してよい。ただし `/src/side-b/adk/agents/` 配下に閉じること。

### 4.2 テスト成果物

候補パス:

- `/src/side-b/adk/agents/runnerSmoke.test.ts`
- `/src/side-b/adk/agents/sequentialSmoke.test.ts`
- `/src/side-b/adk/agents/pdcaDryRunWrapper.test.ts`

テストでは最低限以下を確認する。

- traceSink あり / なしの両方で壊れない
- started / completed が対で記録される
- error ケースでは failed が記録される
- raw payload が保存されない
- 既存 loop / skills / agent の source を改変していない
- ADK public API のみ使用している

### 4.3 ドキュメント成果物

- `STEP_3_RUNNER_SMOKE_NOTES.md`
- `STEP_3_SEQUENTIAL_AGENT_NOTES.md`
- `STEP_3_PDCA_DRYRUN_NOTES.md`
- `STEP_3_INTEGRATION_DECISION.md`
- `STEP_3_SUMMARY.md`
- `ADK_ADOPTION.md` 更新
- `/src/side-b/adk/agents/README.md`

---

## 5. Phase 構成

## Phase 1: Runner / LlmAgent smoke

### 5.1 目的

ADK Runner / LlmAgent / FunctionTool adapter が最小構成で実行可能か確認する。

ここでは賢いことをしない。Runner が動くか、trace が取れるか、Context が adapter execute に届くかを確認するだけでよい。

### 5.2 作業内容

1. `Runner.runEphemeral()` を使う最小 smoke を作成
2. `InMemorySessionService` を使用
3. `LlmAgent` を最小構成で作成
4. `skillRegistryToAdkTools()` で生成した tools を `LlmAgent` に渡す
5. traceSink を渡した場合に event が記録されるか確認
6. `Context.agentName` / `invocationId` / `functionCallId` の取得状況を記録
7. 実 LLM を呼ばずに完了できるならそれを優先
8. 実 LLM が不可避なら、低コスト・非本番・最小入力で smoke する
9. 結果を `STEP_3_RUNNER_SMOKE_NOTES.md` に記録

### 5.3 LLM 呼び出し方針

優先順位は以下。

1. LLM 呼び出しなしで Runner / LlmAgent / tool wiring だけ確認
2. stub / mock model が ADK public API 上許容されるならそれを使う
3. tool call を必要としない短い入力で `runEphemeral()` を確認
4. どうしても必要なら低コストモデルで実行

実 LLM を使う場合でも、Step 3 の成功条件を LLM 出力の内容に依存させない。

### 5.4 DoD

- [ ] `Runner.runEphemeral()` が最小構成で実行できる
- [ ] `InMemorySessionService` を使用している
- [ ] `Runner.runAsync()` の sessionId 必須経路に進んでいない
- [ ] `skillRegistryToAdkTools()` 由来の tools を LlmAgent に渡せる
- [ ] traceSink ありで trace event が記録される
- [ ] traceSink なしで既存挙動が壊れない
- [ ] raw payload が trace に保存されない
- [ ] ADK Context の実測結果が notes に記録されている
- [ ] 本番 Side-B loop に接続していない
- [ ] 既存 `/src/side-b/skills/` を改変していない

---

## Phase 2: SequentialAgent smoke

### 5.5 目的

ADK `SequentialAgent` を使い、順序固定の workflow 実行と trace 記録が可能か確認する。

PDCALoop に触る前に、toy sub-agent で挙動を確認する。いきなり本丸を触るのは、配線確認せずに発電所へ突っ込むようなものなのでやらない。

### 5.6 作業内容

1. toy sub-agent を 2〜3 個作成
2. `SequentialAgent` に sub-agent を順序指定で渡す
3. 実行順序が固定されることを確認
4. 同一 execution 内で state / context がどう共有されるか確認
5. sub-agent 単位で trace event を記録する wrapper を検討
6. error ケースを 1 つ用意し、failed trace が記録されることを確認
7. 結果を `STEP_3_SEQUENTIAL_AGENT_NOTES.md` に記録

### 5.7 DoD

- [ ] toy sub-agent が指定順に実行される
- [ ] SequentialAgent の実行単位を trace event として記録できる
- [ ] error ケースで failed trace が記録される
- [ ] started が completed / failed のどちらかで閉じる
- [ ] raw payload が trace に保存されない
- [ ] `SequentialAgent` の知見が PDCALoop wrapper 設計に転用可能か notes に記録されている
- [ ] PDCALoop にはまだ接続していない

---

## Phase 3: PDCALoop dry-run wrapper

### 5.8 目的

既存 `PDCALoop` を改変せず、ADK 側の wrapper から public API 経由で観測可能にする。

本 Phase は「ADK で PDCALoop を置換する」工程ではない。あくまで「既存 PDCALoop を外側から包み、dry-run で観測できるか」を確認する工程である。

### 5.9 作業内容

1. `/src/side-b/adk/agents/pdcaDryRunWrapper.ts` を作成
2. 既存 PDCALoop の public API を確認
3. public API 経由で呼べる安全な dry-run 単位を選定
4. private method / private field には触れない
5. wrapper 実行前後で trace event を記録
6. 可能であれば public API レベルで `start` / `tick` / `status` / `stop` 相当の span を分ける
7. 無理なら PDCALoop 全体を 1 span として扱う
8. wrapper 実行で DB 書き込み・通知・本番判断が発生しないことを確認
9. 結果を `STEP_3_PDCA_DRYRUN_NOTES.md` に記録

### 5.10 state handler 粒度の扱い

本 Phase では、PDCALoop の private state handler 単位の span 化を必須条件にしない。

許容する粒度:

- PDCALoop 全体を 1 span
- public API レベルの複数 span
- dry-run wrapper 内の明示的な段階を span 化

禁止する粒度:

- private state handler を直接呼ぶ
- private field を読む
- TypeScript の型逃げで内部構造にアクセスする
- `as any` / `as unknown as ...` で強引に突破する

### 5.11 DoD

- [ ] `/src/side-b/adk/agents/` 配下に dry-run wrapper がある
- [ ] `pdcaLoop.ts` の git diff がゼロ
- [ ] `agentLoop.ts` の git diff がゼロ
- [ ] `agentMemory.ts` の git diff がゼロ
- [ ] `/src/side-b/skills/` の git diff がゼロ
- [ ] private method / private field にアクセスしていない
- [ ] wrapper 実行が DB 書き込み・通知・取引判断を発生させない
- [ ] wrapper 実行が traceSink に記録される
- [ ] error ケースで failed trace が記録される
- [ ] `STEP_3_PDCA_DRYRUN_NOTES.md` に実測結果がある

---

## Phase 4: Integration decision

### 5.12 目的

Step 3 の実測結果をもとに、ADK を既存 Side-B loop に接続する価値があるか判断する。

ここでも接続はしない。判断だけ行う。

### 5.13 判断軸

| 判断軸 | 確認内容 | 採用寄り | 撤退寄り |
|---|---|---|---|
| 安定性 | Runner / SequentialAgent が安定して動くか | smoke が安定 | API が不安定 / 非決定的 |
| 観測性 | 既存ログより意味のある trace が取れるか | trace が調査に使える | 既存ログと差がない |
| 侵襲性 | 既存実装をどれだけ触る必要があるか | `/adk/` 内で完結 | 既存 loop 改変が必要 |
| 撤退性 | ADK を外しても無傷か | `git rm -rf src/side-b/adk/` で撤退可 | 既存側に import が逆流 |
| 型安全 | any / unknown / as 逃げがないか | 型が閉じている | 型逃げが多い |
| session 整合 | session-less 方針と合うか | runEphemeral で十分 | DB session 必須 |
| コスト | 実 LLM 呼び出しが必要か | LLM 非依存 smoke 可能 | smoke すら LLM 依存 |

### 5.14 成果物

`STEP_3_INTEGRATION_DECISION.md` を作成し、以下を記載する。

- Step 3 で実測した構成
- Runner smoke の結果
- SequentialAgent smoke の結果
- PDCALoop dry-run wrapper の結果
- 既存 Side-B loop へ接続する場合の候補箇所
- 接続しない場合の理由
- Step 4 へ進む条件
- Step 6 撤退判断へ進む条件
- 未解決課題

### 5.15 DoD

- [ ] `STEP_3_INTEGRATION_DECISION.md` がある
- [ ] 接続可否が明記されている
- [ ] 接続する場合でも Step 3 では実装していない
- [ ] 撤退基準への該当有無が明記されている
- [ ] 次 Step の候補が明記されている

---

## Phase 5: Summary / cleanup

### 5.16 目的

Step 3 の成果をまとめ、spike / smoke 用の一時コードを整理する。

### 5.17 作業内容

1. `STEP_3_SUMMARY.md` を作成
2. `ADK_ADOPTION.md` を Step 3 完了状態に更新
3. `/src/side-b/adk/agents/README.md` を最終状態に更新
4. 一時 script があれば削除
5. Step 1 / Step 2 / Step 3 の関連テストを全 pass にする
6. `npm run build` を green にする
7. 差分が `/src/side-b/adk/` と docs に閉じているか確認

### 5.18 DoD

- [ ] `STEP_3_SUMMARY.md` がある
- [ ] `ADK_ADOPTION.md` が更新されている
- [ ] agents README がある
- [ ] 一時 script が残っていない
- [ ] 関連テスト green
- [ ] build green
- [ ] 既存不可侵領域の git diff がゼロ

---

## 6. 実装制約

### 6.1 依存方向

許可:

```text
src/side-b/adk/* → src/side-b/skills/*
src/side-b/adk/* → src/side-b/agent/*
src/side-b/adk/* → src/side-b/evolution/*
```

禁止:

```text
src/side-b/skills/* → src/side-b/adk/*
src/side-b/agent/* → src/side-b/adk/*
src/side-b/evolution/* → src/side-b/adk/*
SideBScheduler → src/side-b/adk/*
```

### 6.2 型安全

- 本番コードで `any` を使わない
- 本番コードで不要な `unknown` を使わない
- `as` は最小限にする
- `as any` は禁止
- `as unknown as ...` の二段階逃げは禁止
- public API の型で閉じる
- ADK internal / private API に依存しない

### 6.3 trace 安全

- raw args を保存しない
- raw result を保存しない
- prompt 全文を保存しない
- model response 全文を保存しない
- error stack 全文を保存しない
- field count / top-level keys / redacted flag 程度に抑える
- traceSink 失敗で本処理を壊さない

### 6.4 dry-run 安全

- DB 書き込み禁止
- 通知禁止
- 本番 scheduler 接続禁止
- 取引判断の外部出力禁止
- agentMemory 変更禁止
- PromptRegistry 変更禁止
- Prisma schema 変更禁止

---

## 7. レビュー観点

### 7.1 不可侵領域

レビュー時に以下を確認する。

- `git diff -- src/side-b/agent/pdcaLoop.ts` がゼロ
- `git diff -- src/side-b/agent/agentLoop.ts` がゼロ
- `git diff -- src/side-b/agent/agentMemory.ts` がゼロ
- `git diff -- src/side-b/skills` がゼロ
- `git diff -- prisma/schema.prisma` がゼロ
- 既存 Side-B から `/src/side-b/adk/` への import がない

### 7.2 観測性

- Runner 実行が trace に残る
- SequentialAgent の step が trace に残る
- PDCALoop wrapper 実行が trace に残る
- started / completed / failed の対応が崩れない
- error ケースが観測できる
- redaction が維持されている

### 7.3 撤退性

- `/src/side-b/adk/` を削除すれば ADK 関連実装を撤退できる
- 既存実装に ADK import が逆流していない
- docs 以外に不可逆な変更がない

### 7.4 Step 3 の成功を誤読しないこと

Runner smoke が通ったことは、本番統合してよいことを意味しない。

SequentialAgent smoke が通ったことは、PDCALoop を ADK に置換してよいことを意味しない。

PDCALoop dry-run wrapper が動いたことは、SideBScheduler に接続してよいことを意味しない。

Step 3 の成果は **接続判断の材料**であり、接続そのものではない。

---

## 8. テスト方針

### 8.1 継続して通す既存テスト

- Step 1 adapter / equivalence tests
- Step 2 tracing tests
- 既存 Side-B tests
- build

### 8.2 新規テスト

最低限以下を追加する。

#### Runner smoke tests

- traceSink なしで実行可能
- traceSink ありで実行可能
- trace event が redacted summary のみ持つ
- runEphemeral 経路で動く

#### SequentialAgent tests

- sub-agent が指定順に実行される
- step trace が記録される
- error 時に failed trace が記録される

#### PDCALoop dry-run wrapper tests

- wrapper が public API のみ利用する
- traceSink ありで event が記録される
- traceSink なしで壊れない
- error ケースで failed trace が記録される
- DB 書き込み・通知・本番接続がない

---

## 9. PR 分割案

Phase 単位で PR を分ける。

### PR 1: Runner smoke

含めるもの:

- Runner / LlmAgent smoke 実装
- Runner smoke tests
- `STEP_3_RUNNER_SMOKE_NOTES.md`

### PR 2: SequentialAgent smoke

含めるもの:

- SequentialAgent smoke 実装
- SequentialAgent tests
- `STEP_3_SEQUENTIAL_AGENT_NOTES.md`

### PR 3: PDCALoop dry-run wrapper

含めるもの:

- PDCALoop dry-run wrapper
- wrapper tests
- `STEP_3_PDCA_DRYRUN_NOTES.md`

### PR 4: Integration decision / summary

含めるもの:

- `STEP_3_INTEGRATION_DECISION.md`
- `STEP_3_SUMMARY.md`
- `ADK_ADOPTION.md` 更新
- agents README 更新
- 一時ファイル cleanup

PR 番号は実際の進行に合わせて調整してよい。ただし Phase 単位で差分を小さく保つこと。

---

## 10. エージェントへの実行指示

あなたは Trader-Note-Build-Ai の ADK Step 3 実装エージェントです。

以下を厳守してください。

1. Step 3 は本番統合ではありません。
2. `SideBScheduler` から ADK Runner を呼ばないでください。
3. 既存 `PDCALoop` / `AgentLoop` / `AgentMemory` / `Skill` / `PromptRegistry` を改変しないでください。
4. `/src/side-b/adk/` 配下に実装を閉じてください。
5. 既存実装から `/src/side-b/adk/` への import を追加しないでください。
6. ADK public API のみ使用してください。
7. private method / private field / underscore prefix method に依存しないでください。
8. `any` / `as any` / `as unknown as ...` で型を逃げないでください。
9. raw payload を trace に保存しないでください。
10. DB 書き込み・通知・取引判断を発生させないでください。
11. Runner smoke、SequentialAgent smoke、PDCALoop dry-run wrapper、integration decision の順に進めてください。
12. Phase ごとにテストと notes を残してください。
13. Step 3 の最後に summary を作成してください。

---

## 11. 撤退基準

以下のいずれかに該当する場合、Step 4 へ進まず撤退判断に回す。

- Runner smoke が public API だけで安定しない
- LlmAgent / Runner の最小実行に過度な LLM 依存が必要
- SequentialAgent の観測価値が既存ログと大差ない
- PDCALoop dry-run wrapper に既存実装改変が必要
- private API 依存が必要
- `DatabaseSessionService` または ADK session 永続化が前提になる
- Prisma schema 変更が必要
- 既存 Side-B から ADK への import 逆流が必要
- `git rm -rf src/side-b/adk/` で撤退できなくなる

---

## 12. Step 4 への候補

Step 3 が成功した場合、次の候補は以下。

### 候補 A: Step 4 ParallelAgent for Lens dry-run

- Lens 系を ADK `ParallelAgent` で並列 dry-run
- 既存 Lens 実装は不可侵
- 各 Lens 実行を trace event として観測
- 並列実行の価値があるか確認

### 候補 B: Step 5 LoopAgent for Evolution dry-run

- Evolution loop を ADK `LoopAgent` で表現可能か検証
- 既存 evolution 探索アルゴリズムは不可侵
- 決定論性と再現性を最優先

### 候補 C: Step 6 撤退判断

- ADK の価値が観測性・構造化・撤退性の面で十分でない場合
- `/src/side-b/adk/` を削除して撤退
- 既存実装は維持

---

## 13. 最終メッセージ

Step 3 は、ADK を信用する工程ではない。疑う工程である。

Runner が動くか。SequentialAgent が本当に役に立つか。PDCALoop を外側から安全に観測できるか。既存 Side-B loop に接続する価値があるか。

この4点だけを確認する。

本 Step の完了条件は「ADK で置換できた」ではない。

**既存実装を壊さず、ADK の実行経路を隔離したまま観測し、次に進むか撤退するか判断できる状態になったこと**である。
