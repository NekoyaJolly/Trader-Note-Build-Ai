# Step 4 Kickoff: Lens ParallelAgent Dry-run

## 0. この Step の目的

Step 4 では、既存の `/src/side-b/lenses/` を改変せず、ADK 側のサイドカー領域だけで Lens 群を `ParallelAgent` として dry-run 実行できるかを検証する。

目的は「本番接続」ではない。目的は以下の 3 点に限定する。

1. Lens 群の純粋関数的性質を壊さず、ADK `ParallelAgent` に載せられるか確認する
2. 各 Lens の実行を `adk.subagent.started/completed/failed` trace event として個別に観測できるようにする
3. 並列実行しても、同一 input に対して同一 output が得られることを実機テストで確認する

この Step でやることは **Lens 並列実行の dry-run wrapper 作成** であり、SideBScheduler / EvolutionLoop / PDCALoop / Express server への接続ではない。

---

## 1. 背景

Step 0〜3 で、ADK は既存中核へ直接混ぜ込まず、`src/side-b/adk/` 配下に閉じる方針で進めている。

Step 3 までに以下が成立している。

- `Runner.runEphemeral` + `InMemorySessionService` による session-less 実行
- `BaseAgent` / `BaseLlm` 継承による LLM 非依存 smoke
- `SequentialAgent` の sub-agent 単位 trace
- `PDCALoop` を public API のみで合成ラップする dry-run wrapper
- `TraceSink` / `AdkTraceEvent` / `safeRecord` / `shortenErrorMessage` の利用方針
- raw payload 非保存
- private / internal API 依存ゼロ
- `as any` / `as unknown as` 禁止
- 既存実装の git diff ゼロを守る進め方

Step 4 はこの延長として、Lens 群だけを対象に `ParallelAgent` dry-run を作る。

---

## 2. 最重要方針

### 2.1 既存 Lens は不可侵

以下を厳守する。

- `/src/side-b/lenses/` の既存実装は原則改変しない
- Lens の public interface を変更しない
- Lens の `compute()` 仕様を変更しない
- Lens の順序、名前、version、dependencies を勝手に変更しない
- Lens 側に ADK import を追加しない
- Lens 側に trace / logging / session / state を持たせない

既存 Lens に問題が見つかった場合でも、この Step で修正しない。報告書に「Step 4 継続不可 / 別 PR で Lens 修正が必要」と記録する。

### 2.2 ADK はサイドカーに閉じる

実装は原則として以下に閉じる。

```text
src/side-b/adk/agents/
src/side-b/adk/tracing/
src/side-b/adk/adapters/   # 必要な場合のみ
src/side-b/tests/adk/agents/
docs/architecture/
```

既存中核へ接続しない。

### 2.3 本番接続禁止

この Step では以下をしない。

- SideBScheduler へ接続しない
- Express server へ接続しない
- EvolutionLoop へ接続しない
- PDCALoop へ接続しない
- DB 永続化しない
- Prisma schema を変更しない
- UI を追加しない
- 実 LLM 呼び出しを DoD に含めない

---

## 3. Step 4 の完成イメージ

最終的に、以下のような状態を目指す。

```text
src/side-b/adk/agents/
  lensParallelSmoke.ts
  __tests__/
    lensParallelSmoke.test.ts

docs/architecture/
  STEP_4_LENS_PARALLEL_AGENT_REPORT.md
  STEP_4_SUMMARY.md
  ADK_ADOPTION.md                 # Step 4 実装状況を追記

src/side-b/adk/agents/README.md    # 必要なら Step 4 節を追記
```

命名は既存 Step 1〜3 の命名規則に合わせてよい。ただし、spike script を最終成果物として残さない。残すならテスト可能な module として整理する。

---

## 4. 推奨実装モデル

### 4.1 Lens sub-agent

各 Lens を ADK `BaseAgent` subclass の sub-agent として薄くラップする。

責務は以下だけ。

- Lens 名を ADK sub-agent 名へ変換する
- `LensInput` を受け取る
- 既存 Lens の `compute(input)` を呼ぶ
- 成功 / 失敗を trace event に出す
- raw input / raw output を trace に保存しない
- 返却結果を LensFeature 相当の安全な構造として集約側へ返す

重要なのは、Lens sub-agent が相場判断を新たに行わないこと。既存 Lens の呼び出し境界を ADK で包むだけにする。

### 4.2 Lens Parallel dry-run wrapper

`ParallelAgent` は Lens sub-agent 群を束ねる dry-run wrapper として扱う。

この wrapper の責務は以下。

- Lens 一覧を受け取る、または既存の Lens registry / aggregator から取得する
- 各 Lens を sub-agent 化する
- 同一 `LensInput` で並列実行する
- 各 Lens の trace event を個別 span 相当に記録する
- 実行結果を lensName で安定ソートして返す
- 並列実行順に依存したテストを書かない

### 4.3 trace event の使い方

Step 3 で追加済みの event kind を再利用する。

```text
adk.subagent.started
adk.subagent.completed
adk.subagent.failed
```

`skillName` は Step 3 と同様に sub-agent 識別子として使ってよい。ただし、意味が Skill 固有に見えすぎる場合は、この Step では既存契約を壊さず README / report に「sub-agent identifier として再利用」と明記する。

`callerReason` は Step 4 専用の固定値を使う。

推奨:

```text
lens_parallel_dry_run
```

trace payload には raw payload を入れない。保存してよいのは以下程度に限定する。

- lensName
- lensVersion
- status
- durationMs
- featureCount
- errorMessage 短縮版
- dependencyCount

OHLCV bars、DB row、LLM prompt / response、API key、巨大 JSON は保存禁止。

---

## 5. Phase 分割

## Phase 0: 事前棚卸し / 現状把握

### 目的

Step 4 実装前に、現在の Lens 実装と Step 3 成果物を確認し、勝手な前提で実装しない。

### 作業

1. Lens 関連の export / registry / aggregator / type を確認する
2. 現在存在する Lens 数と名前を列挙する
3. `LensInput` / `LensFeature` / `LensFeatureSnapshot` の型を確認する
4. 既存 determinism test / lens test の有無を確認する
5. Step 3 の以下を確認する
   - trace types
   - `TraceSink`
   - `InMemoryTraceSink`
   - `safeRecord`
   - `shortenErrorMessage`
   - `extractSubAgentOrder` 相当 helper
   - `BaseAgent` subclass パターン

### 禁止

- この Phase で Lens を修正しない
- この Phase で ADK 実装を増やしすぎない
- この Phase で Prisma / server / scheduler に触らない

### 成果物

- 実装コメント、または `STEP_4_LENS_PARALLEL_AGENT_REPORT.md` の Phase 0 節に棚卸し結果を記録
- Lens 数、名前、依存、既存テスト状況を記録

### DoD

- [ ] Lens 一覧を実コードから確認している
- [ ] Step 3 の trace / BaseAgent パターンを流用できるか確認している
- [ ] 実装前提を report に書いている

---

## Phase 1: Lens 不可侵性 / 純粋関数性の静的確認

### 目的

Lens 群が ParallelAgent に向いているか、まず静的に確認する。

### 作業

1. `/src/side-b/lenses/` 内で以下を grep / 確認する
   - DB access
   - Prisma import
   - file write
   - network call
   - global mutable state
   - `Date.now()` / `new Date()` の扱い
   - random / Math.random
   - logger 副作用
2. Lens の `compute(input)` が他 Lens の結果に依存していないか確認する
3. 既存の `Promise.allSettled` 的な失敗分離思想があるか確認する
4. 問題がある Lens は「Step 4 対象外候補」として記録する

### 注意

`computedAt` や `computeDurationMs` のような時刻 / duration は、完全一致 determinism の対象から除外すべき可能性がある。テストでは features / confidence / lensName / lensVersion を中心に比較する。

### 成果物

- `STEP_4_LENS_PARALLEL_AGENT_REPORT.md` に Lens 不可侵性チェック結果を記録

### DoD

- [ ] DB / network / file write がないか確認済み
- [ ] global mutable state がないか確認済み
- [ ] randomness がないか確認済み
- [ ] determinism 比較から除外すべき volatile field を明記している

---

## Phase 2: 単体 Lens sub-agent wrapper 実装

### 目的

まず 1 Lens を ADK `BaseAgent` subclass で安全に包めることを確認する。

### 推奨ファイル

```text
src/side-b/adk/agents/lensParallelSmoke.ts
src/side-b/tests/adk/agents/lensParallelSmoke.test.ts
```

### 実装方針

以下のような factory / wrapper を作る。

```text
createLensSubAgent(lens, options)
createDryRunLensParallelAgent(lenses, options)
runLensParallelSmoke(input, options)
```

実際の命名は既存 agents 配下の命名に合わせる。

### sub-agent の責務

- constructor で Lens と TraceSink を受け取る
- 実行時に `adk.subagent.started` を記録
- `lens.compute(input)` を呼ぶ
- 成功時に `adk.subagent.completed` を記録
- 失敗時に `adk.subagent.failed` を記録
- traceSink の失敗は握りつぶす
- errorMessage は短縮する
- raw input / raw output は保存しない

### テスト

最低限以下を確認する。

- [ ] 成功時に started → completed が記録される
- [ ] 失敗時に started → failed が記録される
- [ ] traceSink.record が同期 throw しても実行本体は壊れない
- [ ] traceSink.record が Promise reject しても実行本体は壊れない
- [ ] raw payload が trace event に含まれない
- [ ] errorMessage が上限文字数で短縮される
- [ ] 本番コードに `any` / `unknown` / `as any` / `as unknown as` がない

### DoD

- [ ] 1 Lens を ADK sub-agent として実行できる
- [ ] 既存 Lens 実装に git diff がない
- [ ] trace 契約が Step 3 と互換

---

## Phase 3: ParallelAgent dry-run 実装

### 目的

複数 Lens sub-agent を `ParallelAgent` で束ね、並列実行できることを確認する。

### 実装方針

- `ParallelAgent` に渡す sub-agent は Lens ごとに 1 つ
- input は全 Lens で同一
- output は lensName を key にした map、または lensName で安定ソートした array に正規化する
- trace event の順序は並列実行のため固定しない
- テストでは順序ではなく、各 Lens の started/completed/failed の存在で検証する

### 重要なテスト観点

- [ ] 複数 Lens が同一 input で実行される
- [ ] 各 Lens の trace が lensName 単位で分離される
- [ ] trace event の順序に依存しない検証になっている
- [ ] output が安定ソート / 安定 key で返る
- [ ] 1 Lens が failed でも他 Lens の completed を確認できる
- [ ] 並列実行回数を増やしても同一 features が返る

### DoD

- [ ] ParallelAgent dry-run が成功する
- [ ] 各 Lens が独立 span として観測できる
- [ ] 並列実行順に依存した flaky test がない

---

## Phase 4: 決定性 / 失敗分離の実測

### 目的

ADK を挟んでも Lens の決定性と失敗分離が崩れないことを確認する。

### 作業

1. 同一 `LensInput` で複数回実行する
2. volatile field を除外して features を比較する
3. 1 Lens を意図的に throw させる fake Lens を混ぜる
4. 他 Lens の結果が失われないことを確認する
5. `ParallelAgent` 経由結果と、既存 Lens 直接実行結果を比較する

### 比較対象

原則、以下を比較する。

- lensName
- lensVersion
- features
- confidence

以下は完全一致比較から除外してよい。

- computedAt
- computeDurationMs

ただし、除外する理由は report に明記する。

### DoD

- [ ] 同一 input / 同一 features が成立する
- [ ] 直接実行と ADK 経由実行の features が一致する
- [ ] failed Lens が他 Lens を巻き込まない
- [ ] volatile field の扱いを文書化している

---

## Phase 5: テスト統合 / 既存テスト整合

### 目的

Step 4 の追加が Step 1〜3 と既存 Side-B 実装を壊していないことを確認する。

### 実行するテスト

実際の package scripts に合わせて実行する。

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

プロジェクトの script 名が違う場合は、実在する script に読み替える。

### 必須確認

- Step 1 テストが壊れていない
- Step 2 trace テストが壊れていない
- Step 3 agents テストが壊れていない
- Step 4 新規テストが通る
- 既存 Side-B の Lens / Evolution / Scheduler 周辺テストが壊れていない

### DoD

- [ ] ADK 領域既存 177 cases が維持される
- [ ] Step 4 新規テストが pass
- [ ] typecheck pass
- [ ] lint pass、または既存違反と新規違反を分離して報告
- [ ] 既存中核の git diff がない

---

## Phase 6: ドキュメント更新

### 目的

Step 4 の実装結果を、次 Step に渡せる形で文書化する。

### 作成 / 更新するドキュメント

```text
docs/architecture/STEP_4_LENS_PARALLEL_AGENT_REPORT.md
docs/architecture/STEP_4_SUMMARY.md
docs/architecture/ADK_ADOPTION.md
src/side-b/adk/agents/README.md
```

### STEP_4_LENS_PARALLEL_AGENT_REPORT.md に書くこと

- Phase 0 棚卸し結果
- Lens 一覧
- Lens 不可侵性チェック結果
- ParallelAgent 採用可否
- trace event の設計
- volatile field の扱い
- 直接実行 vs ADK 経由実行の比較結果
- failure isolation の結果
- 採用継続 / Step 6 撤退判断への該当有無

### STEP_4_SUMMARY.md に書くこと

- 変更ファイル一覧
- 新規ファイル一覧
- 削除ファイル一覧
- テスト結果
- 既存実装の git diff 有無
- any / unknown / private API 違反の有無
- Step 5 へ進む条件
- Step 6 へ切り替える条件

### ADK_ADOPTION.md 更新内容

- Step 4 の進捗を `[x]` にするか、部分完了として記録
- Step 4 DoD の実測結果を追記
- Step 5 に進む条件を明確化
- もし問題があれば Step 6 判断へ回す

### DoD

- [ ] Step 4 の判断材料が文書化されている
- [ ] 次 Step の判断ができる状態になっている
- [ ] 実装だけで終わっていない

---

## 6. 禁止事項

この Step では以下を禁止する。

- `/src/side-b/lenses/` の仕様変更
- Lens 側への ADK import 追加
- Lens の compute signature 変更
- SideBScheduler への接続
- Express server への接続
- EvolutionLoop への接続
- PDCALoop への接続
- Prisma schema 変更
- MikroORM 導入
- DatabaseSessionService 導入
- 実 LLM 呼び出しを DoD に入れること
- raw payload の trace / log 保存
- `any` / `unknown` の本番コード使用
- `as any` / `as unknown as`
- `@ts-ignore` / `@ts-nocheck`
- ADK SDK private / internal API 依存
- unrelated refactor
- 既存 lint / typecheck 既存違反の大規模修正を混ぜること
- spike script を最終成果物として放置すること

---

## 7. 撤退 / 中断基準

以下のいずれかに該当した場合、Step 4 は無理に完走しない。

1. `ParallelAgent` に載せるために既存 Lens の設計変更が必要
2. Lens の純粋関数性 / 決定性が崩れる
3. trace を取るために ADK private / internal API 依存が必要
4. raw payload を保存しないと実装できない
5. `as any` / `as unknown as` なしでは成立しない
6. session-less 実行が成立しない
7. 既存 Step 1〜3 テストを壊す
8. SideBScheduler / server / DB への接続が必要になる
9. テストが並列実行順依存で flaky になる

該当した場合は、実装を拡張せず `STEP_4_LENS_PARALLEL_AGENT_REPORT.md` に中断理由を書き、Step 6 の継続採用 / 部分採用 / 撤退判断へ回す。

---

## 8. 実装時の注意点

### 8.1 並列実行順に依存しない

ParallelAgent では trace event の順序が固定されない可能性がある。テストは `started -> completed` の相対順だけを Lens 単位で確認し、Lens 間の順序は検証しない。

悪い例:

```text
trend が必ず oscillator より先に completed することを期待する
```

良い例:

```text
trend / oscillator / volatility それぞれに started と completed が存在することを確認する
```

### 8.2 volatile field を比較から除外する

`computedAt` / `computeDurationMs` のような field は完全一致しない可能性が高い。determinism test では features を中心に比較し、除外理由を report に残す。

### 8.3 fake Lens を使って失敗分離を確認する

既存 Lens を壊すのではなく、テスト用 fake Lens を用意して throw させる。

```text
ThrowingLens
SlowLens
DeterministicLens
```

このような test double で、ParallelAgent wrapper の責務だけを検証する。

### 8.4 実 Lens との統合テストは薄くする

実 Lens 全部を使った重いテストは最小限にする。中心は wrapper の契約テストに置く。

---

## 9. 最終 DoD

Step 4 完了条件は以下。

- [ ] Lens 群を `ParallelAgent` dry-run で実行できる
- [ ] 各 Lens の started / completed / failed trace が観測できる
- [ ] raw payload が trace / log に保存されない
- [ ] 1 Lens の失敗が他 Lens を巻き込まない
- [ ] 同一 input で同一 features が返る
- [ ] 既存 Lens 実装の git diff がゼロ
- [ ] 既存 Side-B 中核の git diff がゼロ
- [ ] Step 1〜3 の ADK テストが壊れていない
- [ ] Step 4 新規テストが pass
- [ ] typecheck が pass
- [ ] lint が pass、または既存違反と新規違反が分離されている
- [ ] private / internal API 依存ゼロ
- [ ] `any` / `unknown` / `as any` / `as unknown as` の本番コード使用ゼロ
- [ ] `STEP_4_LENS_PARALLEL_AGENT_REPORT.md` が作成されている
- [ ] `STEP_4_SUMMARY.md` が作成されている
- [ ] `ADK_ADOPTION.md` が更新されている
- [ ] Step 5 へ進むか Step 6 判断へ回すかが明記されている

---

## 10. エージェントへの最終指示

あなたは Trader-Note-Build-Ai の ADK Step 4 を実装する。

今回の任務は **Lens ParallelAgent dry-run** の構築である。

既存 `/src/side-b/lenses/` は不可侵領域として扱い、Lens の改変ではなく ADK 側の wrapper / adapter で解決すること。Step 3 までに確立した `Runner.runEphemeral`、`InMemorySessionService`、`BaseAgent` subclass、`TraceSink`、`safeRecord`、`shortenErrorMessage`、`adk.subagent.*` trace event を流用すること。

実装は小さく進める。まず Lens 棚卸し、次に 1 Lens wrapper、次に ParallelAgent、最後に determinism / failure isolation / docs 更新の順に進める。

この Step で本番接続してはいけない。SideBScheduler、Express server、EvolutionLoop、PDCALoop、Prisma schema、UI には触れない。

問題が見つかった場合は、既存 Lens をその場で直そうとせず、Step 4 を中断して report に記録し、Step 6 判断へ回すこと。

最終成果物は、動くコード、テスト、Step 4 report、Step 4 summary、ADK_ADOPTION.md 更新である。人類はすぐ「ついでに直す」を始めるが、今回はついで禁止。サイドカーの中だけで勝つこと。

