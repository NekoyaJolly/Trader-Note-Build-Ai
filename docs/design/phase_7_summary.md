# Phase 7 完了サマリー: Lens 拡張 (SMC + ChartPattern + Wyckoff)

> **作成日**: 2026-05-14
> **対象**: Phase 7 全体 (Phase 7a / 7b / 7c) の総括
> **設計書**: [`phase_7_specification.md`](./phase_7_specification.md)
> **次フェーズ**: Step 4 (ADK ParallelAgent dry-run、Lens 並列観測)
> **ステータス**: ✅ 完了 (2026-05-14)

---

## 1. 結論サマリー (先出し)

| 項目 | 結果 |
|---|---|
| Phase 7 期間 | 2026-05-14 (Phase 7 KICKOFF #185 → Phase 7c マージ #191、約 1 日で完走) |
| 新規追加 Lens | **3 本** (SMCLens / ChartPatternLens / WyckoffLens) |
| rename された Lens | **0 本** (PatternLens は名称無改変、Neko さん判断 2026-05-14) |
| `registerDefaultLenses` 登録数 | **5 本 → 8 本** (Current / TimeSession / DowTheory / VolatilityRegime / Pattern + SMC / ChartPattern / Wyckoff) |
| analysis-engine 新規 module | **3 本** (`smc.py` / `chart_patterns.py` / `wyckoff.py`) |
| analysis-engine API 拡張方針 | `/v1/indicator-series` を additive 拡張 (`includeSmc` / `includeChartPatterns` / `includeWyckoff`) |
| テストケース合計 | **295 cases 全 pass** (adk 177 + lenses 既存 61 + SMC 19 + ChartPattern 18 + Wyckoff 20) |
| 既存不可侵領域 git diff | **ゼロ** (pdcaLoop / agentMemory / agentLoop / skills / 他 Lens 本体 / prisma) |
| Copilot レビュー累計指摘 | **18 件** (Phase 7a: 7 / Phase 7b: 4 / Phase 7c: 7) — 全件対応済み |
| PR | #185 (KICKOFF) / #186 (Phase 7a) / #189 (Phase 7b) / #191 (Phase 7c) |

---

## 2. Phase 別 成果と PR

### 2.1 Phase 7a — SMC Lens (PR [#186](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/186))

| 項目 | 内容 |
|---|---|
| Lens 名 | `SMCLens` (`lensName: 'smc'`、`lensVersion: '1.0.0'`) |
| 観測対象 | Order Block / Liquidity / FVG / BOS / CHOCH / Premium-Discount zone |
| features 数 | 10 個 (`SMC_LENS_FEATURE_KEYS`) |
| analysis-engine | `compute_smc_structures(df)` を `smc.py` に新規 |
| API | `/v1/indicator-series` に `includeSmc: bool` 追加 (additive) |
| dependencies | `['symbol', 'precomputedSmcStructures']` |
| sentinel 設計 | `-1.0` (距離 / pips)、`'NONE'` (event)、`'EQUILIBRIUM'` (zone) |
| テスト | 19 cases pass |
| Copilot 指摘 | **7 件** — Node Zod 拡張漏れ (critical: silently strip 防止) / sentinel 設計 / dependencies / OB 方向制約 / zone docstring 整合 / import path / dead deps |
| ノート | [`phase_7a_smc_notes.md`](./phase_7a_smc_notes.md) |

### 2.2 Phase 7b — ChartPattern Lens (PR [#189](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/189))

| 項目 | 内容 |
|---|---|
| Lens 名 | `ChartPatternLens` (`lensName: 'chart_pattern'`、`lensVersion: '1.0.0'`) |
| 観測対象 | 11 種 N-bar 構造 (FLAG / PENNANT / TRIANGLE×3 / HEAD_SHOULDER×2 / DOUBLE×2 / WEDGE×2) |
| features 数 | 5 個 (`pattern_detected` enum + confidence + break_imminent + bars_count + direction_bias) |
| analysis-engine | `compute_chart_patterns(df)` を `chart_patterns.py` に新規 |
| API | `/v1/indicator-series` に `includeChartPatterns: bool` 追加 |
| dependencies | `['symbol', 'precomputedChartPatterns']` |
| **PatternLens の扱い** | **無改変** (rename しない決定、§3 参照) |
| テスト | 18 cases pass |
| Copilot 指摘 | **4 件** — dead parameter `is_top` / pandas `idxmax()` label vs position 混在 (numpy.argmax + offset で修正) / magic number → MIN/MAX_PATTERN_BARS 定数化 / HEAD_SHOULDER 系のリセンシー制約 |
| ノート | [`phase_7b_chart_pattern_notes.md`](./phase_7b_chart_pattern_notes.md) |

### 2.3 Phase 7c — Wyckoff Lens (PR [#191](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/191))

| 項目 | 内容 |
|---|---|
| Lens 名 | `WyckoffLens` (`lensName: 'wyckoff'`、`lensVersion: '1.0.0'`) |
| 観測対象 | 7 phase 判定 (Accumulation / Markup / Distribution / Markdown / RE_*×2 / UNKNOWN) + Spring / Upthrust / SOS / SOW |
| features 数 | 6 個 (`wyckoff_phase` enum + confidence + spring_bool + upthrust_bool + last_sos_bars_ago + last_sow_bars_ago) |
| analysis-engine | `compute_wyckoff_phases(df, smc_context: Optional[SmcStructuresPayload])` を `wyckoff.py` に新規 |
| API | `/v1/indicator-series` に `includeWyckoff: bool` 追加。SMC context を引数で連携 |
| dependencies | `['symbol', 'precomputedWyckoffPhases']` |
| sentinel 設計 | `-1` (SOS / SOW なし)、`'UNKNOWN'` (phase 不明 → confidence 0.0 で API/Lens 整合) |
| **SMC 連携** | BOS/CHOCH で phase 判定 confidence を boost (0.85 vs 0.55)、SMC context なしでも動作 |
| テスト | 20 cases pass |
| Copilot 指摘 | **7 件** (第 1 走 5 + 第 2 走 2) — Zod/Pydantic `ge=-1` / `.min(-1)` 制約 4 件 / SOS/SOW で `avg_volume_20<=0` の fallback 2 件 / UNKNOWN phase で confidence 0.3→0.0 の API/Lens 契約整合 2 件 |
| ノート | [`phase_7c_wyckoff_notes.md`](./phase_7c_wyckoff_notes.md) |

---

## 3. PatternLens rename を実施しなかった経緯 (§5.3 / §12.1 の最終判断)

KICKOFF (`phase_7_specification.md` §5.3 / §12.1) では Phase 7b 内で `PatternLens` → `CandlePatternLens` rename を予定していた。理由は「ローソク足 12 種 (既存 `PatternLens`)」と「N-bar 構造 11 種 (新規 `ChartPatternLens`)」の命名衝突を避けるため。

**実際は rename を行わなかった**。Neko さんが Phase 7b 着手前 (2026-05-14) に以下の判断を下した:

> 「パターンっていうのを基本って考えれば、ローソク足の基本のパターンがあって、そっから応用であったりとか組み合わせてチャートパターンが作られるわけだから、整合性は取れるよね、それで。ローソク足は今まで通りパターンを使って、チャートパターンに関してはチャートパターンでいいわね。」 — Neko さん

つまり、命名上の階層関係を以下のように扱うことで衝突回避と意味の明瞭さを両立した:

- **`PatternLens` (基本)** — ローソク足 12 種のような「最も単位の小さい構造パターン」
- **`ChartPatternLens` (応用)** — N-bar スパンで成立する「複合チャート構造」

この階層関係は両 Lens の docstring と本ノート §1 / §2 で明文化される。`lensName` 値も次のとおりで衝突しない:

| Lens | lensName | 観測軸 |
|---|---|---|
| PatternLens | `pattern` | ローソク足単位の構造 (1-3 bar) |
| ChartPatternLens | `chart_pattern` | チャート全体の構造 (5-25 bar) |

**結果として KICKOFF §5.3 / §12.1 の 3 案 (A: 全データ書き換え / B: alias 機構 / C: 既存データ放置) は採用見送り**。永続化データ (`AITradeNote.lensSnapshot` 等) の `'pattern'` key も無改変のまま継続使用される。

---

## 4. analysis-engine と side-b の 2 層パターン

Phase 7 全体で踏襲した実装パターン (Phase 7a / 7b / 7c で完全に同じ):

```
EvolutionLoop (将来) / Lens 評価経路
   ↓ POST /v1/indicator-series { includeSmc: true, includeChartPatterns: true, includeWyckoff: true }
analysis-engine (Python, FastAPI)
   ├─→ compute_smc_structures(df)              → SmcStructuresPayload          (Phase 7a)
   ├─→ compute_chart_patterns(df)              → ChartPatternsPayload          (Phase 7b)
   └─→ compute_wyckoff_phases(df, smc_payload) → WyckoffPhasesPayload          (Phase 7c)
                                              ↑ SMC 結果を optional 引数で渡す (Phase 7c の特徴)
   ↓ IndicatorSeriesResponse.{smc,chartPatterns,wyckoff}
side-b (TypeScript, Zod でランタイム検証)
   LensInput.precomputed{SmcStructures,ChartPatterns,WyckoffPhases} = payload
   ↓
   {SMCLens,ChartPatternLens,WyckoffLens}.compute(input)
   ↓
   LensFeature.features = Record<string, number | string | boolean>
```

### 4.1 知見継承サイクル

各 Phase で Copilot レビュー指摘から得た知見を次 Phase の着手時に self-review checklist として最初から適用。

| Phase | 主要 checklist 追加項目 | 結果 |
|---|---|---|
| Phase 7a 完了時 | Node Zod 同時拡張 / sentinel 設計の明文化 / dependencies は実使用分のみ / OB 方向制約 / docstring 整合 | (次 Phase に継承) |
| Phase 7b 着手時 | + pandas `idxmax` label/position 混在禁止 (numpy.argmax + offset 推奨) / magic number はモジュール定数 / リセンシー制約 / dead parameter 撲滅 | Copilot 指摘 7→4 件に減少 |
| Phase 7c 着手時 | + Phase 7a/7b 全項目 + idxmax 不使用 | Copilot 第 1 走 5 件 (Wyckoff 固有の境界制約 + volume 0 fallback)、bf02abd 後の第 2 走で 2 件 (UNKNOWN 契約整合) |

**知見継承の効果と限界**: Phase 7c では Phase 7a/7b で蓄積した checklist 全項目を着手前から適用したにもかかわらず Copilot 指摘 7 件 (第 1+2 走合計) が出た。これは Phase 7c 固有の論点 (SMC 連携を持つ新軸、UNKNOWN semantics、volume 0 fallback など、過去 Phase に存在しない領域) によるもので、knowledge transfer cycle で防げない種類の指摘が一定数あることが実測された。

### 4.2 `LensFeature.features` の型制約と sentinel 設計

`Record<string, number | string | boolean>` を厳守 (null / array / object は不可)。「データなし」は sentinel で表現:

| sentinel | 用途 | 例 |
|---|---|---|
| `-1.0` (number) | 距離 / pips 系の「なし」 | `nearest_ob_bull_distance_pips = -1.0` |
| `-1` (number, int) | バー数の「なし」 | `last_sos_bars_ago = -1` |
| `'NONE'` (string) | 列挙型の「なし」 | `last_structure_event = 'NONE'` |
| `'EQUILIBRIUM'` (string) | zone の「中立」 | `current_zone = 'EQUILIBRIUM'` |
| `'UNKNOWN'` (string) + `confidence = 0.0` | phase 判定不能 | `wyckoff_phase = 'UNKNOWN'` の場合は `wyckoff_phase_confidence = 0.0` を返す |

`UNKNOWN + 0.0` は Phase 7c で Copilot 第 2 走指摘 (PR #191 inline) を受けて確定した契約。WyckoffLens.test.ts が enforce している。

---

## 5. Phase 7 期間中の付随トピック

Phase 7 そのものではないが、Phase 7 期間中に発生した重要事項:

### 5.1 Docker `npm ci` 失敗 (PR [#184](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/184))

Production Deployment が #457 以降 15 連続失敗。原因は Dockerfile `COPY package*.json ./` が `.npmrc` を含まず、Docker 内 `npm ci` が strict mode で MikroORM peer dep を解決できなかった。

修正: `COPY package*.json .npmrc ./`

**Phase 7 への影響**: Phase 7 期間中の deploy 失敗連鎖を早期検知できなかった反省から WORKFLOW.md §9 (pre-merge docker-build ゲート + post-merge 瞬間チェック) を整備。

### 5.2 ES2022 Error.cause と tsconfig (PR [#188](https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/188) / PR #191 hotfix)

Copilot Coding Agent の auto-lint-fix PR #188 が ESLint `preserve-caught-error` ルール対応で `new Error(msg, { cause: e })` を導入したが、tsconfig `lib: ["ES2020"]` が ES2022 の Error options 第 2 引数を許可せず CI が TS2554 で落ちた。

修正 (PR #191 `bf02abd`): `lib` に `ES2022.Error` を additive 追加 (`target: "ES2020"` は維持、Node 22 ランタイム互換性に影響なし)。

**確立した方針**: catch の `e` は `unknown` のまま `cause: e` に渡す。`ErrorOptions.cause?: unknown` なので narrow 不要、文字列化での情報損失を避ける。

---

## 6. Step 4 (ADK ParallelAgent dry-run) への引き継ぎ事項

Phase 7 完了により Lens カバレッジは **5 → 8 本**。Step 4 では以下を構築する:

### 6.1 Step 4 のスコープ

`ADK_ADOPTION.md` §3 / §4 より、Step 4 で実装するのは:

- ADK `ParallelAgent` で 8 Lens を並列観測する dry-run wrapper
- 各 Lens 実行を `adk.subagent.*` event として観測 (Phase 2 trace 契約を再利用)
- Lens の決定性 (並列実行で同入力同出力) を実機検証

### 6.2 Phase 7 から Step 4 が利用する建材

| 建材 | 由来 | 利用方法 |
|---|---|---|
| `defaultLensAggregator` (8 Lens 登録済み) | Phase 7c 完了時点 | ParallelAgent でラップして並列実行 |
| `Lens` interface / `LensInput` / `LensFeature` | Phase 1 以来不変 (additive 拡張のみ) | Lens の純粋関数特性を活かして並列化 |
| `runnerSmoke.ts` / `sequentialSmoke.ts` / `pdcaDryRunWrapper.ts` | Step 3 完了 | ParallelAgent dry-run wrapper の構築パターンとして流用 |
| `adk.subagent.*` trace event | Step 3 Phase 2 で additive 拡張済み | ParallelAgent でも同 event kind を再利用 |
| analysis-engine `/v1/indicator-series` | Phase 7a/7b/7c で additive 拡張済み | EvolutionLoop が世代開始時に bulk fetch → LensInput に詰める経路 |

### 6.3 Step 4 着手前 TODO (Phase 7 で着手しなかったもの)

Phase 7a notes §6.3 / Phase 7b notes §8.4 / Phase 7c notes §7.4 で挙げられた未実施項目:

- [ ] analysis-engine の E2E 動作確認 (Docker 起動 + curl で SMC / ChartPattern / Wyckoff endpoint)
- [ ] Python 単体テスト infra 整備 (現状は TypeScript 側テストで payload→features 契約を検証)
- [ ] `IndicatorSeriesByVersionRequest` への `includeSmc` / `includeChartPatterns` / `includeWyckoff` 拡張
- [ ] DSL Evaluator での Phase 7 features 参照互換性確認

これらは Step 4 の Phase 1 spike で扱うか、独立した別 PR で先行解消するかを着手時に判断する。

---

## 7. オープン課題と将来構想

### 7.1 Phase 8 (Elliott Wave) — 構想のみ

`docs/design/lens_elliott_wave_future_design.md` 参照。SMC + ChartPattern + Wyckoff の実運用結果を踏まえてから着手判断する。Lens features は配列禁止 (`Record<string, number | string | boolean>`) なので、波カウント Top-3 を保存するなら enum 化 (`wave_count_1_5_a_b_c` 等) が必要 — 設計時の重要制約として記録。

### 7.2 Phase 9 (Point & Figure) — 構想のみ

KICKOFF §3.2 で「優先度最後」と明示。Phase 8 完了後、または Phase 8 不採用の場合に再評価。

### 7.3 Lens バージョニング戦略 (§12.3)

Phase 7 全 Lens は `lensVersion: '1.0.0'` で公開。将来 features を増減した際のルールは:

- features 追加 → minor bump (`1.0.0` → `1.1.0`)
- features 削除 → major bump (`1.0.0` → `2.0.0`)

歴史的学習データとの互換性検証は `lensVersion` 値で行う。実運用上 features 削除が発生したケースが出るまで仮ルールとして運用。

---

## 8. 全体 DoD 達成状況 (`phase_7_specification.md` §7)

### 8.1 実装 DoD

- [x] `SMCLens` (Phase 7a) が動作する
- [x] `ChartPatternLens` (Phase 7b) が動作する
- [x] ~~`CandlePatternLens` (Phase 7b、`PatternLens` から rename)~~ → **rename 不実施、`PatternLens` のまま継続** (§3 経緯)
- [x] `WyckoffLens` (Phase 7c) が動作する
- [x] `defaultLensAggregator` に新規 3 Lens (SMC / ChartPattern / Wyckoff) が登録されている
- [x] analysis-engine 側に SMC / ChartPattern / Wyckoff の compute 関数 + API endpoint が追加されている
- [x] 既存 5 Lens の本体ロジックが改変されていない (rename 不実施につき diff ゼロ)

### 8.2 テスト DoD

- [x] 新規 Lens 3 種の単体テスト全 pass (SMC 19 / ChartPattern 18 / Wyckoff 20 cases、いずれも KICKOFF 最低数 8/11/7 を上回る)
- [x] 既存 Lens (Current / TimeSession / DowTheory / VolatilityRegime / Pattern) のテスト全 pass
- [x] `npx tsc --noEmit` green
- [x] `npx jest` green (adk + lenses 領域 295/295 pass)

### 8.3 設計 DoD

- [x] 既存 `pdcaLoop.ts` / `agentMemory.ts` / `agentLoop.ts` の git diff ゼロ
- [x] 既存 `src/side-b/skills/` の git diff ゼロ
- [x] `prisma/schema.prisma` の git diff ゼロ
- [x] 新 Lens が他 Lens に依存していない (レンズ独立性、ドメイン原則 §4)
- [x] 新 Lens に副作用 (DB / 通知 / 外部 IO) がない
- [x] 新 Lens が決定論的 (同入力 → 同出力、各 test で実機検証)
- [x] DSL 文法を拡張していない (Phase 7 範囲外)
- [x] EvolutionLoop の進化対象 Lens 指定を変更していない (Phase 7 範囲外)

### 8.4 ドキュメント DoD

- [x] [`phase_7a_smc_notes.md`](./phase_7a_smc_notes.md)
- [x] [`phase_7b_chart_pattern_notes.md`](./phase_7b_chart_pattern_notes.md)
- [x] [`phase_7c_wyckoff_notes.md`](./phase_7c_wyckoff_notes.md)
- [x] [`phase_7_summary.md`](./phase_7_summary.md) (本書)
- [x] [`phase_7_specification.md`](./phase_7_specification.md) §5.3 / §12.1 を rename 不実施反映に更新 (本 PR で同時更新)
- [x] [`ADK_ADOPTION.md`](../architecture/ADK_ADOPTION.md) §3 ロードマップに Lens 8 本拡張済みを注釈 (本 PR で同時更新)
- [x] 各 PR description にテスト結果と実機検証手順がある (#186 / #189 / #191)

---

## 9. 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| [`phase_7_specification.md`](./phase_7_specification.md) | Phase 7 KICKOFF (本書はその完了報告) |
| [`phase_7a_smc_notes.md`](./phase_7a_smc_notes.md) | Phase 7a SMC 実装ノート |
| [`phase_7b_chart_pattern_notes.md`](./phase_7b_chart_pattern_notes.md) | Phase 7b ChartPattern 実装ノート |
| [`phase_7c_wyckoff_notes.md`](./phase_7c_wyckoff_notes.md) | Phase 7c Wyckoff 実装ノート |
| [`lens_elliott_wave_future_design.md`](./lens_elliott_wave_future_design.md) | Phase 8 (Elliott Wave) 将来構想 |
| [`../architecture/ADK_ADOPTION.md`](../architecture/ADK_ADOPTION.md) | ADK 段階導入計画 (Step 4 で Lens ParallelAgent ラップ) |
| [`../architecture/WORKFLOW.md`](../architecture/WORKFLOW.md) | 開発ワークフロー (§9 post-merge 瞬間チェック含む) |
| [`/AGENTS.md`](../../AGENTS.md) | ドメイン原則 §4 (Lens 独立・純粋・決定性) |

---

## 10. 最終メッセージ

Phase 7 は KICKOFF §14 で述べた通り、Neko さんの観測哲学:

> マーケットを観測 → 情報を統合 → 複数シナリオを構築 → シナリオごとにトレードプランを練る → 実行 → ノートに保存 → 検証 → エッジ蓄積 → エッジで判断

の **「観測」** の章を 5 Lens から 8 Lens に拡張する工程だった。

設計書で予告した「Lens を追加する」を字義通り達成しただけでなく、より重要な達成として:

1. **ドメイン原則 §4 (独立・純粋・決定性) を 8 Lens 全てで実機検証** — Lens 同士の結合ゼロ、副作用ゼロ、決定論性検証テスト含む
2. **analysis-engine と side-b の 2 層パターンの確立** — 「計算重い処理は Python、features 変換は TypeScript」を 3 Lens で再現可能と実証
3. **knowledge transfer cycle の実測** — Phase 7a → 7b → 7c で Copilot 指摘の主要テーマがシフトする様子を記録、自動レビューと self-review checklist の併用効果を測定
4. **既存 PatternLens 無改変** — 命名階層化 (基本 / 応用) で 12 件の rename を回避、永続化データの後方互換性を保ったまま新 Lens を導入

次は Step 4 (ADK ParallelAgent dry-run)。本 Phase で確立した 8 Lens を並列観測する wrapper を、Step 3 で建てた 3 つの建材 (`runnerSmoke.ts` / `sequentialSmoke.ts` / `pdcaDryRunWrapper.ts`) と同じ「合成によるラップ」方式で構築する。
