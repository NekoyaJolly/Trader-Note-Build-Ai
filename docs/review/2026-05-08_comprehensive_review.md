# Trader-Note-Build-Ai 包括的レビュー (2026-05-08)

> 静的レビュー (コード読みのみ、lint/test/typecheck の実行なし) で作成。
> 主軸: AI エージェントループ最深掘り。FE / Node BE / Python BE / DB は要点のみ。
> 「2025-2026 ベスト」と書いた箇所は Context7 / WebSearch で裏取り済 (出典は付録 B)。
> CLAUDE.md の 6 原則 + DESIGN_DOC §1.1 の 7 原則を批評の基準軸として使用。
> 設計書 vs 実装のドリフトは付録 C にマトリクス化。

---

## エグゼクティブサマリー

### 全体評価のトップライン

`src/side-b/` は Phase 1〜6.7a + Critical-4 (PR #96-108) を順序立てて積み上げた、進化計算 + LLM ハイブリッドの**学術的に筋の通った実装**になっている。特に以下の 3 点が秀逸:

1. **surrogate fitness と analysis-engine 正式 BT の役割分離** (`src/side-b/strategy_dsl/SurrogateFitnessSimulator.ts:1-16`, `src/side-b/evolution/EvolutionLoop.ts:6-15`) — surrogate は進化探索内の高速近似、confirmed 昇格は必ず Python 経由という契約が `Critical-4 段階 4a.3` でコード上にも徹底されている。これは学術論文 (Bailey & López de Prado 2014; López de Prado 2018) が警告する **「surrogate / single-path backtest だけで戦略を採用してはならない」** という原則をそのまま実装に落としたもの。
2. **Quality-Diversity Archive Lite + Surrogate Rescue Lane** (`src/side-b/evolution/qualityDiversityArchiveLite.ts`, `src/side-b/evolution/surrogateRescuePolicy.ts`) — MAP-Elites (Mouret & Clune 2015) と Novelty Search (Lehman & Stanley 2008) のエッセンスを壊さない範囲で取り込んでおり、normal_pass=0 の世代でも探索が止まらない設計になっている。
3. **3 階層プロンプト合成 + A/B テスト + 月次進化** (`src/side-b/prompts/loader.ts:96-134`, `src/side-b/prompts/registry/PromptRegistry.ts`, `src/side-b/prompts/registry/variantSelector.ts`) — `__global__` / `__specialist_common__` / 個別エージェントの 3 層をファイル + DB の双方で扱い、experimental 20% / active 80% の安全な A/B 配分を確保。Reflexion 的な自己反省と FunSearch 的な LLM 駆動進化を分離して持つ稀有な構成。

### 主要リスク 3 点

| 順位 | リスク | 影響 | 根拠 |
|:---:|---|---|---|
| 1 | RLS 有効化済だが**ポリシー未設定**。`service_role` 経由のみアクセス可。クライアント側で誤って `service_role` を使う変更 (将来の Supabase Auth 移行や Edge Functions 導入) が入った瞬間に**全テーブル丸見え**になる | 最大 (機密データ流出) | `prisma/migrations/20260409140000_enable_rls_all_tables/migration.sql:1-13` |
| 2 | analysis-engine が `--allow-unauthenticated` で公開デプロイ (`/v1/walk-forward`, `/v1/oos-validation`, `/v1/screening-backtest` が誰でも叩ける) | 高 (DB read-only ロール経由でも OHLCV 流出 + 計算リソース盗用) | `.github/workflows/deploy.yml:53-60` |
| 3 | `PDCALoop` の `thinkingLog` が **インメモリ 200 件限定** で永続化されない (`src/side-b/agent/pdcaLoop.ts:107, 615-621`)。プロセス再起動で全消失。Reflexion (Shinn et al. 2023) が説く「episodic memory buffer」として機能しておらず、PDCA 自身の自己改善ループが切れている | 中 (エージェントの自己学習が世代を跨がない) | 同上 |

### 優先改善 3 点

1. **RLS ポリシーの段階的設計** — `User` / `Watchlist` / `CTraderToken` / `AITradeNote` などユーザー紐付け資源から、`auth.uid()` ベースのポリシーを 1 テーブルずつ追加。Supabase 公式の "AI Prompt: Database: Create RLS policies" を参考に `select`/`insert`/`update`/`delete` を分離 ([Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security))。
2. **analysis-engine のアクセス制御** — `--allow-unauthenticated` を撤去し、Cloud Run の IAM 認証 (Cloud Run invoker ロール) または独自 API キーミドルウェアを追加。Side-B → analysis-engine の `runScreeningBacktest` クライアントだけが叩ける状態にする。
3. **`thinkingLog` の Postgres 永続化** — `EvaluationLog` テーブル (Phase 4d で既に存在) または新規 `PDCAThinkingLog` テーブルに書き出し、`reasoning` 列にテキスト + `state` enum + `cycleId` を残す。Reflexion 的な episodic memory として後続セッションで読み戻せるようにする。

### マネタイズの現実解 1 点

最も低リスク高再現性は **「confirmed エッジ台帳の選別配信 SaaS」** (B2C 個人トレーダー向け、月額)。Phase 5A 既存実装が `confirmed` 昇格に対し **学習 PF>1.5 / 検証 PF>1.3 / 過学習 <0.3 + WF/MC/BH 全通過** を強制する形になっており (`src/side-b/ledger/statusManager.ts:23-30, 195-243`)、市販されているシグナルサービスに比べ**統計的反証可能性が圧倒的に高い**。詳細は §11。

---

## 1. プロジェクト現状分析

### 1.1 技術スタック俯瞰図

```
┌──────────────────────────────────────────────────┐
│ Frontend (src/frontend/)                         │
│  Next.js 16.1.1 (App Router, Turbopack)          │
│  React 19.2.3, Tailwind 4, Radix UI              │
│  Vitest, Testing Library                         │
│  状態管理: Context API のみ (zustand 等不採用)    │
└──────────────┬───────────────────────────────────┘
               │ HTTP (NEXT_PUBLIC_API_BASE_URL)
┌──────────────▼───────────────────────────────────┐
│ Node Backend (src/backend/)                      │
│  Express + Prisma + BullMQ                       │
│  22 ルート, 18 サービス, 52 Prisma モデル          │
│  JWT 独自実装 (src/middleware/authMiddleware.ts) │
│  Zod 検証 (validateRequest middleware)           │
└─────┬───────────────────────┬────────────────────┘
      │ HTTP                  │ Prisma
      ▼                       ▼
┌──────────────────┐    ┌──────────────────────────┐
│ Python BE        │    │ Supabase Postgres        │
│ (analysis-engine)│    │  TimescaleDB 2.14.2      │
│ FastAPI 0.115.8  │    │  RLS 有効、ポリシー未設定 │
│ pandas_ta 0.4.71b│    │  36 マイグレーション       │
│ backtesting 0.6.5│    │  service_role バイパス    │
└──────────────────┘    └──────────────────────────┘

┌──────────────────────────────────────────────────┐
│ AI Agent Layer (src/side-b/)  **重要**主軸**重要**             │
│  PDCALoop (agent/pdcaLoop.ts)                    │
│  EvolutionLoop (evolution/EvolutionLoop.ts:1428) │
│  Strategy DSL (strategy_dsl/)                    │
│  Edge Ledger (ledger/EdgeLedger.ts:799)          │
│  Lenses x5 (lenses/)                             │
│  Agents x11 + Specialists x3 (agents/)           │
│  Prompts x12 + Registry + A/B test (prompts/)    │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│ Deploy: GCP Cloud Run (asia-northeast1)          │
│  trader-note (Node API)                          │
│  trader-note-analysis-engine (Python, 公開)      │
│  Cloud Scheduler (matching-pipeline-15min)       │
│  GitHub Actions: ci.yml + deploy.yml + 4 others  │
└──────────────────────────────────────────────────┘
```

### 1.2 設計ドキュメント vs 実装のドリフト診断

| 設計書の主張 | 実装の現状 | ドリフト評価 |
|---|---|---|
| `DESIGN_DOC §1.5`: Phase 1-3, 4a, 4b 縮小版, 4c, 4d, 5A, 5.5 実装済み。Phase 5B, 6 未着手 | **Phase 6 部分実装 (専門家 3 体 + プロンプト進化基盤)、Phase 5B 未着手** | 設計書本文が古い。memory `project_phase_6_completed.md` (2026-04-22) と `project_phase_6_7a_completed.md` (2026-04-24) は反映済 |
| `phase_5a_specification.md`: 自動 confirmed 昇格を停止 | `EvolutionLoop.runOneGeneration()` は `promotionCandidates` を返すだけで EdgeLedger に書かない (`EvolutionLoop.ts:9-15, 745`) | OK 設計通り |
| `critical_4_bt_unification.md §13`: surrogate と正式 BT の役割分離 | `verifyCandidatesWithFormalBacktest()` で必ず `analysis-engine` を呼ぶ (`EvolutionLoop.ts:1212-1334`) | OK 設計通り |
| `phase_6_7a_infrastructure.md §1.2`: グローバル + ローカル連結 (C案) | `loadPromptWithGlobal()` / `getCompositeActive()` 両経路実装 (`loader.ts:96-108`, `PromptRegistry.ts:152-175`) | OK 設計通り |
| `DESIGN_DOC §1.1 原則4`: エリオットカウントを一意に決めない (確率分布扱い) | 現状エリオットレンズ未実装。`PatternLens` は decimal な flag のみ | OK 設計通り (= 着手していないが原則違反もしていない) |
| `CLAUDE.md やってはいけないこと一覧`: ユーザーに "エリオット ON/OFF" のスイッチを提供しない (検索時重み付けで実現) | 現状スイッチ実装なし。レンズ重み付けも未実装 | △ 検索時重み付け機構が未実装、Phase 6 の TODO |
| `phase_5b_specification.md`: 進化候補 → Phase 4c 接続を 1-2 週間で実装可能 | 未着手。memory `project_phase_5b_hold.md` (2026-04-22) で **「Phase 6 完了 + 運用観察データ確認まで着手しない」** と凍結中 | OK 凍結方針が memory に明記、実装側も不変 |

**ドリフト総評**: 設計書の本文 (`DESIGN_DOC_autonomous_trading_architecture.md` の冒頭) が「Phase 6 未着手」と書いたまま固まっており、新規参照者が混乱する。設計書末尾に「最終更新ステータス」を追記するか、`docs/design/IMPLEMENTATION_STATUS.md` を別立てで作って Phase ごとの進捗を一覧化することを推奨。

### 1.3 開発フェーズの現在地

```
Phase 1 (レンズ基盤)               [完了]
Phase 2 (エージェント基盤)          [完了]
Phase 3 (PDCAループ)               [完了]
Phase 4a (仮説生成 + EdgeLedger)    [完了]
Phase 4b 縮小版 (スクリーニング)     [完了] (PF 1.1 暫定緩和、PR #76)
Phase 4c (WF/MC/BH 統合)            [完了]
Phase 4d (検索/UI 一覧)             [完了]
Phase 5A (進化候補生成)             [完了] (Critical-4 PR #96-108 統合済)
Phase 5.5 (Skill 基盤)              [完了]
Phase 6 (専門家 + Prompt 進化)      [部分実装]
  ├─ Phase 6.6 (専門家 3 体)        [完了]
  ├─ Phase 6.7a (グローバル層)      [完了] (2026-04-24)
  ├─ Phase 6.7b (BT 層)             [進行中]
  ├─ Phase 6.7c (専門家 prompt)     [進行中]
  ├─ Phase 6.8 (執行シミュ)         [部分実装]
  └─ MetaEvolution                  [骨格のみ] (実行は人間承認必須)
Phase 5B (進化候補 → 4c 接続)       [凍結] (運用観察待ち)
Phase 6.8b (Python 検証サービス)     [未着手]
```

memory 確認結果 (`project_phase_5b_hold.md`, `project_phase_6_completed.md`, `project_phase_6_7a_completed.md`, `project_critical_4_progress.md`) と完全に整合する。

---

## 2. AI エージェントループ詳細レビュー (主軸)

### 2.1 PDCALoop の構造評価

`src/side-b/agent/pdcaLoop.ts` 全 635 行。状態機械は 7 状態 (`IDLE → SESSION_OPEN → MONITORING → EVALUATING_ENTRY → MANAGING_POSITION → REFLECTING → REVISING_STRATEGY`)。

#### 2.1.1 良い点

- **状態遷移が決定論的**: `tick()` が現在状態を見て次状態を決める単純な switch-case (`pdcaLoop.ts:210-232`)。LLM を**ループ制御**には使わず、Reflection 段階のみで使う割り切りは CLAUDE.md 原則 3 「LLM の役割を拡張しすぎない」と整合。
- **市場閉場時の縮退**: `isFXMarketOpen()` が false なら無条件 `IDLE` に落とす (`pdcaLoop.ts:197-207`)。これにより週末/休場日に無駄な LLM コールが走らない。
- **ハンドラの責務分離**: `handleReflecting()` (`pdcaLoop.ts:383-435`) のみが LLM 呼び出し (Reflection AI)、他は状態遷移のみ。Plan AI と Research AI は `SideBScheduler` 側に委譲する形で、PDCA 本体の単体テストは可能。

#### 2.1.2 改善余地と根拠

##### a) **重要**最重要**重要** thinkingLog の永続化欠如

`pdcaLoop.ts:107` で `thinkingLog: ThinkingLogEntry[] = []` と宣言され、`addThinkingLog()` (`pdcaLoop.ts:606-622`) で push されるが、**プロセス再起動で全消失**。最新 200 件しか保持しない (`pdcaLoop.ts:619-621`)。

Reflexion (Shinn et al. 2023, [arxiv:2303.11366](https://arxiv.org/abs/2303.11366)) の中核は「Self-Reflection model が verbal reinforcement cues を episodic memory buffer に積み、後続の trial で Actor が読み戻して improve する」こと。本実装は Self-Reflection に相当する `Reflection AI` がトレード結果を `lessons` に変換して `agentMemory.addLesson()` で永続化はしているが、**PDCA 自身の意思決定ログは非永続**。これでは「先週の MONITORING で何を見て何を decide したか」を遡れない。

**推奨**: 新規テーブル `PDCAThinkingLog` を追加 (`prisma/schema.prisma` に。CLAUDE.md 原則 1 「既存コードを壊さない」遵守、後方互換)。

```prisma
model PDCAThinkingLog {
  id            String   @id @default(uuid()) @db.Uuid
  cycle         Int
  state         String
  action        String
  reasoning     String?
  data          Json?
  recordedAt    DateTime @default(now()) @db.Timestamptz(6)
  @@index([recordedAt(sort: Desc)], map: "idx_pdca_thinking_recorded")
  @@index([state, recordedAt(sort: Desc)], map: "idx_pdca_thinking_state_recorded")
}
```

##### b) エラーハンドリングが「次の通常間隔でリトライ」一択

`pdcaLoop.ts:591-600`:
```typescript
} catch (error) {
  // ...
  this.scheduleTick(this.config.normalIntervalMs);
}
```

連続失敗時に exponential backoff せず、ポジション保有中の高頻度 (5 分) ティックでもエラー時は通常間隔 (1 時間) に落とす。これは「ポジション管理中にトラブル発生 → 1 時間放置」というワーストパターンを生む。

**推奨**: `state === 'MANAGING_POSITION'` のときは `positionIntervalMs` を維持、それ以外で exponential backoff (最大 4 時間) を導入。

##### c) `EVALUATING_ENTRY` がほぼ空実装

`pdcaLoop.ts:329-342`:
```typescript
private handleEvaluatingEntry(): PDCATickResult {
  // 現段階ではMONITORINGに戻す
  // Phase 3で: AIが条件到達を判断 → エントリー実行
```

Phase 3 で実装予定とコメントされているが、現状は**何もせず即 MONITORING に戻る**。状態自体を残しているが値はない。設計書 `phase_3_specification.md` の意図と現実が合っていない可能性がある。

**推奨**: 実装が無いなら `state` enum から削除するか、実装が来るまで `MONITORING` から遷移させない (= dead state にしてフラグ立てる)。CLAUDE.md「半端な実装を残さない」と整合。

### 2.2 EvolutionLoop と Strategy DSL

`src/side-b/evolution/EvolutionLoop.ts:1428` 行。Phase 5A の中核。

#### 2.2.1 構造評価

`runOneGeneration(regime, options?)` が 1 世代の全工程を実行する単一メソッド。流れ:

1. **population 初期化** (`EvolutionLoop.ts:524-532`): regime に対応する個体が空なら 12 種 novelty seed (`buildAllNoveltySeeds`) を一括注入。
2. **QD-Archive parents 注入** (`EvolutionLoop.ts:534-556`): `options.qualityDiversityArchiveParents` から最大 2 件、重複排除して population に追加。
3. **indicator/pattern 一括取得** (`EvolutionLoop.ts:567-602`): 世代開始時に `/v1/indicator-series` を 1 HTTP で叩いてキャッシュ化。surrogate 内部の TS 再計算を撤廃して**真実は pandas_ta 一本化**。これは PR ④F の重要な改善で、本格 BT との数値整合を担保する。
4. **surrogate 評価** (`EvolutionLoop.ts:604-618`): 各個体に対し `evaluateFitness` を呼ぶ。70/30 で train/validation 分割。
5. **親プール構築** (`EvolutionLoop.ts:622-644`): `buildParentPool` が 3 系統 (formal_bt_passed / current_population / novelty_seed) ミックスで親を返す (PR #95)。
6. **mutation/crossover/diverse 生成** (`EvolutionLoop.ts:657-708`): `repairHintsForMutation` を使った修復誘導 mutation 含む。`generateDiverse` は diversity score < 0.3 の時だけ起動。
7. **Surrogate Rescue 選抜** (`EvolutionLoop.ts:710-714`): 6 分類 (normal_pass / near_miss / low_drawdown / trade_count / novelty / kill) で正式 BT 候補を抽出。
8. **正式 BT** (`EvolutionLoop.ts:719`): top K 候補を analysis-engine に送る。**`formalBtPassed === true` のみ promotionCandidates に残る**。
9. **DSR 観測** (`EvolutionLoop.ts:747-769`): Bailey & López de Prado 2014 の式で promotion candidate の DSR を計算 (= 「N 試行を補正しても有意か」)。本 PR では promotion gate に組み込まず観測のみ。
10. **PromotionGate v1** (`EvolutionLoop.ts:838-850`): dslId 単位で一意化された stage 判定。
11. **OOS Validation v1** (`EvolutionLoop.ts:852-872`): `oosBacktestRunner` 注入時のみ analysis-engine の robustness 評価を実行。`validation_candidate` のみを対象。
12. **OOS-aware Promotion** (`EvolutionLoop.ts:863-873`): `oos_passed` → `validation_confirmed`、`oos_failed` → `hold` (= rejected にしない)。**`productionEligible` は常に false**。
13. **永続化** (`EvolutionLoop.ts:875-880`): `EvolutionBacktestRun` テーブルに passed/failed 全件保存。

#### 2.2.2 良い点

- **「自動 confirmed 昇格は絶対しない」が型レベルで保証されている**。`promotionCandidates` は `EvolutionPromotionCandidate[]` として返るだけで、`EdgeLedger.markConfirmed*()` を呼ぶ箇所は EvolutionLoop には無い (`EvolutionLoop.ts` 全体を grep しても markConfirmed の参照ゼロ)。これは Phase 5A の最重要設計判断 (`phase_5a_specification.md`) の忠実な実装。
- **DI の徹底**: `runFormalBacktest`, `evolutionBacktestRepo`, `edgeHypothesisLoader`, `oosBacktestRunner` 全てが `EvolutionLoopDeps` で差し替え可能 (`EvolutionLoop.ts:134-180`)。テストで実 DB / 実 HTTP を切り離せる。これは AutoGen (Wu et al. 2023) や CrewAI が推奨するパターンと整合。
- **3 段階の役割分離**: surrogate (近似) → rescue (救済) → 正式 BT (権威判定) → OOS (補助観測) → PromotionGate (stage 判定)。それぞれが**互いに上書きしない**ため、ある段の閾値を変えても他段が壊れない。Critical-4 PR シーケンスが理論的に整理されている証左。

#### 2.2.3 改善余地

##### a) **重要**保守性**重要** ファイル肥大化 (1428 行)

`EvolutionLoop` クラスは 1 クラスに 13 のステップを抱える。`buildRescueCandidates` (`EvolutionLoop.ts:1143-1194`)、`verifyCandidatesWithFormalBacktest` (`EvolutionLoop.ts:1212-1334`)、`evaluateOosForValidationCandidates` (`EvolutionLoop.ts:918-1038`)、`buildPromotionGateDecisions` (`EvolutionLoop.ts:1059-1129`)、`persistFormalBtHistory` (`EvolutionLoop.ts:1346-1371`) が private method として詰め込まれている。

設計上は意味があるが (= state を共有するため)、**新しい PR を追加するたびに `runOneGeneration` の本体に 30-50 行ずつ積まれる構造**になっており、`runOneGeneration` (`EvolutionLoop.ts:471-906`) は既に 435 行ある。次の PR (Phase 5B) ではさらに増える可能性が高い。

**推奨 (議論候補)**: 単純な機能境界での切り出し。例:
- `EvolutionPipeline` (順序オーケストレーター)
- `SurrogateStage` (Step 4-5)
- `RescueStage` (Step 7-8)
- `FormalBtStage` (Step 8-9)
- `OosValidationStage` (Step 11)
- `PersistenceStage` (Step 13)

各 Stage は前段の出力を受け取り次段の入力を返す pure function 化できる (immutable update)。これにより、PR ごとの差分が 1 つの Stage に閉じ込められる。

ただし、CLAUDE.md 原則 1 「既存コードを壊さない」と原則 2 「指定されたフェーズ範囲を超えない」を踏まえると、**現フェーズ内で勝手にやらず、Phase 7 以降の整理タスクとして提案**するのが筋。Phase 5B 着手前ならむしろ触らないほうが安全。

##### b) errors[] が info ログを兼ねている

`EvolutionLoop.ts:399-405` のコメント:
> GenerationReport には専用の `warnings` フィールドが無いため `errors[]` を info ログ用にも流用

実際 `errors.push('[info] adaptive mutation budget 適用: ...')` (`EvolutionLoop.ts:517`) や `errors.push('[info] DSR observation ...')` (`EvolutionLoop.ts:765`) のように info プレフィックスで詰める運用。

**推奨**: `GenerationReport` 型に `infoLogs: string[]` を optional 追加。後方互換のため必須化はしない。観測専用フィールドが分かれているほうが、運用ダッシュボードでフィルタ表示しやすい。

##### c) DSR が観測ログのみで promotion gate に組み込まれていない

`EvolutionLoop.ts:747-751` のコメント:
> 本 PR では Promotion gate には組み込まず観測のみ。本番判定への組み込みは別 PR で対応予定。

Bailey & López de Prado 2014 の DSR は「N 試行 (= 試行回数) を補正したうえで Sharpe Ratio が 0 と有意に異なるか」を z-score で返す指標。`expectedMaxSr ≈ sqrt(2 * ln(N))` という補正項を入れているため、**多数試行の中から偶然優れたものを拾うバイアス (selection bias) を抑制できる**。

進化ループは本質的に多試行 (1 世代で `formalBtVerifiedCandidates.length` の試行) で、selection bias が必然的に乗る。観測ログで終わらせず、`formalBtPassed && dsr > 0` を `validation_candidate` への昇格条件に加えることを Phase 5B / Phase 7 で議論することを推奨。

ただし Phase 5B 凍結 (`memory: project_phase_5b_hold.md`) に従うなら、**まずは観測データを 30-90 日蓄積して DSR の分布を見てから閾値を議論する**のが正しい順序。

#### 2.2.4 親プール戦略 (PR #95)

`src/side-b/evolution/parentPoolPolicy.ts` の `buildParentPool` が、設計書通り **confirmed 50% / screening_passed 25% / unverified 5-10%** をミックス。novelty seed 12 種を補完項として使う。

`EvolutionLoop.ts:629-633`:
```typescript
const parentPoolResult = await buildParentPool(regime, 5, scores, {
  population,
  evolutionBacktestRepo: this.evolutionBacktestRepo,
  edgeHypothesisLoader: this.edgeHypothesisLoader,
});
```

3 系統のいずれかが空でも他から補完する fallback が `parentPoolPolicy.ts` に実装されている (= `removeWorst` を後回しにする工夫が `EvolutionLoop.ts:622-628` のコメントで明示)。

**評価**: 設計通り。Critical-4 設計書 §13 の「過去 confirmed の DNA を使い続けると単調になるが、novelty seed が常に 5-15% 入っているため探索性は維持」と整合。

#### 2.2.5 novelty seed 12 種の効果

`src/side-b/evolution/seedDescriptor.ts` の `buildAllNoveltySeeds(regime)` が 6 カテゴリ × long/short = 12 種を生成する (PR ⑤D-2)。旧 PR では regime ごとに 1 種類だけだったが、12 種に拡張された。

**評価**: Novelty Search (Lehman & Stanley 2008, [Abandoning Objectives](https://www.cs.swarthmore.edu/~meeden/DevelopmentalRobotics/lehman_ecj11.pdf)) の核心は「目的関数だけを最適化すると deceptive な勾配で局所最適に落ちる、新規性ボーナスがあれば抜け出せる」。12 種への拡張は novelty 比率 5%→10% (commit `83d1981` で確認) と組み合わさって**初期世代の探索広さ**を担保する設計で、論文の主張と整合する。

### 2.3 Surrogate Rescue Lane / Adaptive Repair / QD-Archive

3 つの仕組みが**互いに干渉しない**ように切り分けられている。これは設計上の最大の美点。

#### 2.3.1 Surrogate Rescue Lane (`surrogateRescuePolicy.ts:407` 行)

normal_pass=0 の世代でも探索が止まらないよう、5 つの rescue lane で候補を救済:

| Lane | 判定条件 (`surrogateRescuePolicy.ts`) | TopK |
|---|---|---|
| `normal_pass` | trainPf>1.5 && validationPf>1.3 && overfit<0.3 | 3 |
| `near_miss_rescue` | 上記 3 条件のうち 2 つ通過 (`L136-151`) | 1 |
| `low_drawdown_rescue` | validation maxDrawdownRate 最小 (`L274-292`) | 1 |
| `trade_count_rescue` | totalTrades が `FORMAL_BT_MIN_TRADES` 以上で最大 (`L294-319`) | 1 |
| `novelty_rescue` | `behaviorDescriptorLite` ベース noveltyScore 上位 (`L321-355`) | 1 |
| `kill` | totalTrades=0 / NaN / DD>80% (`L98-119`) | 0 (除外) |

優先順位 normal_pass > near_miss > low_drawdown > trade_count > novelty で重複排除 (`surrogateRescuePolicy.ts:236-258`)。

**良い点**:
- **kill 条件で「破綻 DD」を弾く** (`L111-116`) のは現実的。MAP-Elites (Mouret & Clune 2015, [arxiv:1504.04909](https://arxiv.org/abs/1504.04909)) の純粋形では「全 cell に何か入れる」だけで quality は問わないが、本実装は最低限の品質ガードを入れている。CLAUDE.md「ブラックボックスを作らない」と整合。
- **novelty_rescue は `selected` 集合との差分で計算** (`L325-344`)。MAP-Elites の cell key 比較ではなく **「選ばれた候補との distance」** をスコアにしている。これは差分に基づく selection で、本格 MAP-Elites の archive ベースとは別軸。lite 版として妥当。

**改善余地**:
- `routePriority` (`L237-244`) のスコアが固定値 (5/4/3/2/1)。将来 lane を増やすときに `Record<SurrogateRoute, number>` の管理が散る。`evolutionPromotionThresholds.ts` 側に集約してもよい。
- `trade_count_rescue` の閾値 `minTradesForTradeCountRescue` がデフォルト 0 (`L172, 197`)。EvolutionLoop が `FORMAL_BT_MIN_TRADES` (= 20、`EvolutionLoop.ts:373, 1169`) を渡すため実運用は OK だが、lane policy 単独テスト時に「20 件未満を救済 → 後段で insufficient_trades 即落ち」の死荷重が生まれる。デフォルト値を 1 以上にするか、policy level で警告ログを出してもよい。

#### 2.3.2 Adaptive Repair Budget (PR #107) と Repair Outcome Telemetry (PR #102)

`src/side-b/evolution/adaptiveRepairBudgetPolicy.ts` が `byRoute.repair_guided_mutation / standard_mutation / crossover / novelty_seed / random_exploration` の比率を世代ごとに調整する。`EvolutionLoop.ts:493-522` で受け取り、mutation/crossover/diverse の生成数を比率倍する。

`src/side-b/evolution/repairOutcomeTelemetry.ts` は前世代の failed candidate (= baseline) と当世代 mutation child の formal BT 結果を比較し、`improved / worsened / unchanged / unknown` を集計する (`EvolutionLoop.ts:812-836`)。

**良い点**:
- **観測のみ。candidate の stage / promotion には絶対に影響させない** が `EvolutionLoop.ts:811` のコメントで明文化。Reflexion の「verbal feedback だけで強化、weights は更新しない」原則と整合。
- baseline は dslId 単位で一意化 (`EvolutionLoop.ts:813`)、二重計上を防いでいる。

**改善余地**:
- `outcomeDslIds` (`EvolutionLoop.ts:813`) が generation-local の Set だが、世代を跨いだ outcome 比較 (= 「修復が 2 世代後にようやく実った」) を観測する仕組みがない。Phase 6 後半で `repairOutcomeHistory` テーブルを足す価値はある。

#### 2.3.3 Quality-Diversity Archive Lite (PR #108, `qualityDiversityArchiveLite.ts:480` 行)

`buildQdArchiveCellKeyV1(d: BehaviorDescriptorLite)` (`L144-158`) が 9 次元の cell key を生成する:

```
regime|timeframe|entry|exit|risk|sl|tp|freq|indicators
```

各 cell には quality score 上位 1 件だけ保持 (`L210-215`)。`maxCells = 32` を超えたら quality score 昇順で削除 (`L362-378`)。

`computeQdArchiveQualityScoreV1` (`L172-200`) は **既存型に存在する値だけで計算** (= 新指標を作らない、設計書 §15)。formal BT passed +50, PF 加点, DD 加点, trade count 加点, surrogate score, novelty score の合成。

**良い点**:
- **immutable update を徹底** (`L276-405`)。input mutation を絶対にしない設計。MAP-Elites の本格実装は archive 自体を mutate するが、本 lite 版は immutable で次状態を返す。`EvolutionLoop` 側に injection するだけの状態にしている。
- **本格 MAP-Elites ではないと明記** (`L4-5`)。これは MAP-Elites (Mouret & Clune 2015) の「behavior space を grid で離散化、各 cell に最高 quality を保持」の **lite 版実装宣言**として誠実。論文と実装の名乗り方が一致している。

**改善余地**:
- cell key は 9 次元の文字列連結だが、これだと `indicators` 配列を `'rsi,bb'` と `'bb,rsi'` で別 cell にする可能性がある。ソート済前提のコメントは `L141` にあるが、実装側 (`behaviorDescriptorLite.ts`) でソートしている保証は要確認。
- archive の DB 永続化なし (`L20: Quality-Diversity Archive の DB 永続化はしない`)。プロセス再起動で消える。lite 版として割り切りはあるが、Phase 5B/6 後半で `data/evolution/qd-archive.json` か Postgres テーブルへ書き出す価値はある。

### 2.4 Edge 台帳と昇格ロジック

`src/side-b/ledger/EdgeLedger.ts:799` 行 + `src/side-b/ledger/statusManager.ts:286` 行。

#### 2.4.1 confirmed 3 条件のコード上の真実

`statusManager.ts:23-30` の `PROMOTION_THRESHOLDS`:
```typescript
export const PROMOTION_THRESHOLDS = Object.freeze({
    trainingPF: 1.5,
    validationPF: 1.3,
    overfitScore: 0.3,
});
```

`Object.freeze()` でランタイム改変を防いでいる。`canPromoteToConfirmed()` (`statusManager.ts:101-143`) で 3 条件 + トレード数 ≥20 を全て満たした時のみ `ok=true` を返す。

CLAUDE.md 原則 5「閾値は設計書で議論される場合のみ変更可。勝手に緩めない」と完全整合。`grep` で `PROMOTION_THRESHOLDS` を検索しても上書き箇所はない (`statusManager.ts:23` のみ)。

#### 2.4.2 「自動 confirmed 昇格は行わない」の運用上の意味

`canPromoteToConfirmed()` の判定対象は `EdgeHypothesis` 型 (`hyp.walkForwardResults` を見る、`statusManager.ts:104-143`)。EvolutionLoop が生成する `EvolutionPromotionCandidate` 型は別 (`EvolutionLoop.ts:204-252`)。

つまり:
- `EvolutionPromotionCandidate` (= 進化候補) → そのままでは confirmed にならない
- `EdgeHypothesis` 経由で WF/MC/BH 全通過 → `markConfirmedFull()` で初めて confirmed (`EdgeLedger.ts:524-543`)

進化候補から EdgeHypothesis への登録は **Phase 5B の責務** (`docs/design/phase_5b_specification.md` §2 判断 1)。現状は未着手で、運用観察データを待っている (memory `project_phase_5b_hold.md`)。

**評価**: 設計判断が型レベルで強制されており、データ汚染リスクが極めて低い。CLAUDE.md 原則 5 のコード上の証拠として最もきれいな例。

#### 2.4.3 promotionGatePolicy と statusManager の役割重複

両者は混同しやすいので明確化:

| 役割 | promotionGatePolicy.ts | statusManager.ts |
|---|---|---|
| 判定対象 | `EvolutionPromotionCandidate` (= 進化候補) | `EdgeHypothesis` (= EdgeLedger 登録済) |
| 判定軸 | EvolutionCandidateStage (`parent_eligible / formal_bt_candidate / validation_candidate / repairable / repair_excluded`) | EdgeStatus (`unverified / screening_passed / testing / confirmed / stale / rejected / insufficient_data / not_testable`) |
| DB アクセス | なし (in-memory only) | あり (Prisma 経由) |
| 自動昇格 | productionEligible は常に false | confirmed は WF 全通過時のみ |

役割重複はない。命名が似ているだけで、責務は明確に分離。

`EvolutionLoop.ts:319` のコメント:
> EdgeStatus / StatusManager には触らない (DB-free in-memory only)

が PromotionGate v1 の不変条件として明記されている。

**評価**: 設計上の混乱はないが、新規参照者向けに `docs/design/agent_stage_vs_edge_status.md` のような対応表ドキュメントがあると親切。Phase 5B 着手時の必須準備物として候補。

#### 2.4.4 Phase 4b 縮小版の暫定緩和

`statusManager.ts:49-54` の `SCREENING_THRESHOLDS`:
```typescript
export const SCREENING_THRESHOLDS = Object.freeze({
    minPF: 1.1,             // 元 1.3、暫定緩和
    minTradeCount: 20,
});
```

PR #76 (2026-05-02) で 1.3 → 1.1 へ緩和、minWinRate は撤廃。理由は「24h 観測で screening_passed=0 件、PDCA-2 が永続的に空回り」という本末転倒な状況を打破するため (`statusManager.ts:42-46` のコメント)。

**評価**: 暫定緩和は妥当だが、TODO が `statusManager.ts:47` に「Phase 4c: 環境変数で外部化」と書かれているまま未着手。暫定値を環境変数化しないと、運用観察データが集まった後の再評価で**コード変更 + デプロイが毎回必要**になる。Phase 6 後半で外部化することを推奨。

### 2.5 レンズ層

`src/side-b/lenses/` 配下、5 レンズ + Aggregator。

#### 2.5.1 純粋性・決定性・独立性 (CLAUDE.md 原則 4) の遵守状況

各レンズの実装を check:

| Lens | 副作用なし | 他レンズ非依存 | 決定性 | LLM 使用 |
|---|:-:|:-:|:-:|:-:|
| `TimeSessionLens` (`L34-66`) | OK | OK | OK | × |
| `VolatilityRegimeLens` | OK | OK (ATR 計算のみ) | OK | × |
| `PatternLens` (`L25-60`) | OK | OK | OK (precomputed cache 必須) | × |
| `DowTheoryLens` | OK | OK | OK | × |
| `CurrentAnalysisLens` | OK | OK | △ (LLM cache あり、cache hit 時は決定性) | ◯ |

`TimeSessionLens` (`TimeSessionLens.ts:34-66`) は `computeTimeSessionFeatures(ts)` を呼ぶだけのラッパー。**式は `src/shared/timeframes/timeSession.ts` に集約 (= 単一真実)** で、surrogate / analysis-engine / 本 lens の 3 経路で完全一致するよう設計されている (`TimeSessionLens.ts:7-10`)。これは PR ⑤D-1 の重要な統合作業で、Critical-4 の「真実は pandas/Python」原則と整合。

`PatternLens` (`PatternLens.ts:1-20`) は **TS 側で再計算しない**。analysis-engine `compute_candlestick_pattern_flags` / `compute_pinbar_flags` が真実、本 lens は precomputed cache の末尾バーを返すだけの薄い wrapper。これは PR ④F の改善で、indicator drift を排除する設計。

#### 2.5.2 LensAggregator の Promise.allSettled パターン

`LensAggregator.ts:66-93`:
```typescript
const results = await Promise.allSettled(
  lensEntries.map(([, lens]) => lens.compute(input))
);
// 失敗 lens はログに記録、features Map には含まれない
```

1 つのレンズ失敗が全体を止めない設計。これは「レンズは独立に発火」というレンズ哲学 (DESIGN_DOC §1.1 原則 2) と整合。

**改善余地**: 失敗 lens がログ (`console.error`) のみで、`LensFeatureSnapshot` に「失敗 lens 一覧」を返さない。後段の Hypothesis Generator / Strategist がレンズ完備性を判断できない。Phase 6 で `LensFeatureSnapshot` に optional `failedLenses: string[]` を追加することを推奨。

#### 2.5.3 TimeSession lens の統合方式

`TimeSessionLens.version = TIME_SESSION_LENS_VERSION` (`TimeSessionLens.ts:38`) で shared バージョンを参照。リテラル直書きを避けて drift を防ぐ。

これは Lens が version を持つ Lens インターフェース (`lenses/types.ts`) と組み合わさって、後方互換性を担保する仕組み。同じ DSL でも lens version が違えば再計算する、というゲートを将来作れる。

**評価**: 模範実装。Phase 6 で追加予定の Elliott / SMC レンズもこのパターンに従わせるべき。

#### 2.5.4 Elliott / SMC レンズ追加余地

`DESIGN_DOC §1.1 原則 4` で「エリオット波動のカウントを一意に決めるアルゴリズムを書かない、確率分布で扱う」と定めている。

実装の方向性 (Phase 6 候補):
- `ElliottWaveLens` は wave_1 / wave_2 / ... / wave_5 / abc_correction の各 **確率** (0-1) を返す。一意 label は返さない。
- `SmcLens` は order_block_present / fvg_present / liquidity_pool_above / ... の boolean 配列を返す。判定の主観性を `confidence` で表現する。

これらが実装されると、Hypothesis Generator は「波 3 が 0.6 確率で進行中、SMC の OB が 0.8 で生きている → エッジ A の発動条件」のような確率的仮説を立てられる。検索時重み付け (`DESIGN_DOC §2.4`) と組み合わさって、ユーザー設定 "クラシカルモード" / "SMC モード" を**レンズ重み変更だけで実現**できる。

**現状**: 未実装、Phase 6 後半 / Phase 7 候補。

### 2.6 Prompt 進化基盤 (Phase 6.7)

`src/side-b/prompts/` 配下、loader + Registry + abtest + 12 種の `.md`。

#### 2.6.1 グローバル / 専門家共通 / 個別エージェントの 3 階層合成

`loader.ts` が 4 種の合成関数を提供:

| 関数 | 合成内容 | 用途 |
|---|---|---|
| `loadPrompt(name)` (`L53-61`) | 個別のみ | レガシー / 単純呼び出し |
| `loadPromptWithGlobal(name)` (`L96-108`) | global + 個別 | Registry 未投入時の fallback |
| `loadSpecialistPromptWithGlobalAndCommon(name)` (`L116-134`) | global + specialist_common + 個別 | 専門家 3 体の fallback |
| `prependGlobalPromptFromFile(content)` (`L150-162`) | global + 既得 content | variant selection 後の合成 |

`PromptRegistry.ts` も 3 種の合成関数を提供:

| 関数 | 合成内容 | DB 経由 |
|---|---|---|
| `getActive(agentName)` (`L119-125`) | DB の active のみ | OK |
| `getCompositeActive(agentName, macros?)` (`L152-175`) | global + 個別 (macros 展開込) | OK |
| `composeGlobalWithContent(content, macros?)` (`L182-196`) | global + 受け取った content | OK |
| `composeSpecialistWithGlobalAndCommon(content, macros?)` (`L203-228`) | global + common + content | OK |

**良い点**:
- **ファイル fallback と DB Registry の二重経路**を持つ。Registry 未投入のローカル開発・テスト環境でも動作する設計 (`PromptRegistry.ts:152-172` の fallback 警告ログ)。これは Phase 6.7a の段階的移行を可能にする現実解。
- **`__global__` / `__specialist_common__` を予約名として `MetaEvolutionAgent` の変異対象から明示的に除外** (`MetaEvolutionAgent.ts:311-324`)。安全装置として強い。

**改善余地**:
- 合成関数が 4+4=8 種類あり、新規参照者には**いつどれを使うべきか**が分かりにくい。`docs/design/prompt_composition_decision_tree.md` のような決定木ドキュメントを書くと、Phase 6.7c 完了時の onboarding コストが下がる。

#### 2.6.2 PromptRegistry / variantSelector / A/B test の運用準備度

`variantSelector.ts:46-85` の `selectVariant`:
- experimental が空 → 常に active
- experimental があれば 20% で experimental (`EXPERIMENTAL_USAGE_RATIO = 0.2`)
- experimental の中で `usageCount >= 20 && avgScore < active.avgScore * 0.7` のものは即時除外 (`shouldReject` `L91-99`)

これは A/B test の標準的なベストプラクティス (multi-armed bandit に近いが、シンプルな fixed-ratio 形式)。Reflexion (Shinn et al. 2023) や FunSearch (Romera-Paredes et al. 2024) が採用する「変異候補を pool に保持、評価しながら入れ替え」パターンと整合。

**改善余地**:
- A/B test の勝者判定が `active.avgScore` の単純比較で、**統計的有意性の検定が無い**。`PromptAbTestResult` テーブル (`prisma/schema.prisma:1783`) に variantResults を蓄積する仕組みはあるが、t-test / Mann-Whitney U / Bayesian A/B test を回す処理がコード上に見当たらない。
- **多重比較補正なし**: 12 エージェント × 複数 experimental バリアントを並走させると、family-wise error rate が膨らむ。Bonferroni 補正かせめて Benjamini-Hochberg FDR 制御が望ましい。これは DSR (Bailey & López de Prado 2014) と同じ「N 試行を補正する」発想を Prompt 進化にも適用する話で、学術的には自然な拡張。Phase 7 検討候補。

#### 2.6.3 月次プロンプト進化ジョブの自動化リスク

`src/side-b/prompts/registry/promptEvolutionJob.ts` (PR #106 関連) が月次でプロンプト進化を回す前提。

`MetaEvolutionAgent.executeProposal()` (`MetaEvolutionAgent.ts:284-391`):
- `MONTHLY_ADD_LIMIT = 1` (新規エージェント追加は月 1 件まで、`L91`)
- `deprecate` は自動実行しない (`L325-330`)
- `modify` は PromptMutationAgent + approveCli 経由 (`L332-337`)
- 全提案を `AgentRestructureProposal` テーブルに永続化

**評価**: 自動化リスクは設計上明示的に潰されている。MONTHLY_ADD_LIMIT は強い制約で、暴発を防ぐ。

ただし memory `project_phase_6_completed.md` に「自動実行は全て既定 false」と記録されている通り、現状は**人間が CLI を叩かないと提案も生成されない**。これは Phase 6 完了時の安全側設計だが、運用が成熟したら experimental の自動投入だけは月次で回したほうが、実データが蓄積する。

### 2.7 専門家エージェント体制 (Phase 6.6)

`src/side-b/agents/specialists/` に 3 体 + 共通基盤:

- `TrendSpecialist.ts` — dow_theory + current_analysis (MA 関連) + ADX
- `OscillatorSpecialist.ts` — RSI / MACD / Stochastic
- `VolatilityVolumeSpecialist.ts` — ATR / BB / 出来高
- `specialistCommon.ts` — 共通 helper (`formatLensDump`, `clampNumber`, `pickEnum`, `runSpecialistWithVariant`)

#### 2.7.1 責務切り分けの妥当性

各 Specialist は **担当レンズだけを LensFeatureSnapshot から抜き出して LLM に渡す**。例: `TrendSpecialist.analyze()` (`TrendSpecialist.ts:55-73`):
```typescript
const lensDump = formatLensDump(input.lensSnapshot, TREND_RELEVANT_LENSES);
```
`TREND_RELEVANT_LENSES = ['dow_theory', 'current_analysis']` (`TrendSpecialist.ts:29`)。

これは **「専門家は自分の領域だけ見る」** という認知科学の Modular Mind モデル (Fodor 1983) と整合し、LLM の hallucination を抑制する効果がある (使わない情報を渡さない)。

#### 2.7.2 specialistCommon の共通化が進化を妨げないか

`runSpecialistWithVariant` (`specialistCommon.ts`) が PromptRegistry + variantSelector を経由した active/experimental 選択 + LLM 呼び出し + scoring 記録を一括処理する。3 専門家で同じ helper を使うため、**Phase 6.7c でプロンプトが進化対象になっても、各 Specialist 側のコード変更は不要**。

**評価**: 進化を妨げない。共通化のレベルが「LLM 呼び出しオーケストレーション」であって、「ドメイン知識の埋め込み」ではないため、Specialist の役割固有性は守られている。CLAUDE.md 原則 1 (既存コードを壊さない) と整合。

### 2.8 **重要**Academic Pattern との比較**重要** (本レビューのメインディッシュ)

このプロジェクトのエージェントループを、AI / 進化計算 / 計量金融の主要論文と照合する。各パターンに対し、現実装が「取り込めている / 取り込めていない / 取り込み余地」を評価する。

#### 2.8.1 ReAct (Yao et al. 2022, ICLR 2023, [arxiv:2210.03629](https://arxiv.org/abs/2210.03629))

> Reasoning + Acting を交互に実行する。reasoning trace で plan を update + exception handle、action で外部環境と interact。

| 項目 | 現実装の対応 | 評価 |
|---|---|---|
| Reasoning trace | `PDCALoop.thinkingLog` (`pdcaLoop.ts:107`)、ただし永続化なし | 未対応 trace は残るがインメモリ |
| Action | `notifyAnalysisComplete` / `notifyTradeCompleted` 等の hook (`pdcaLoop.ts:461-528`) | ◯ |
| Trace ↔ Action の交互実行 | tick メソッドが状態遷移ごとに reasoning + action を返す | △ reasoning 部が弱い |
| 外部環境との interact | analysisEngineClient / strategyBacktestService 経由 | ◯ |

**ギャップ**: ReAct の本質は「LLM が `Thought: ... Action: ... Observation: ... Thought: ...` のように **明示的に reasoning を発話してから act する**」こと。現実装は state machine が決定論的に状態遷移するため、LLM の reasoning trace は handleReflecting 内 (Reflection AI) でしか発火しない。これは「Plan / Strategy 層は別エージェント (StrategyThinker, HypothesisGenerator) に分離」という設計判断の結果なので、PDCALoop 自体に ReAct を入れるのは筋が悪い。

**取り込み余地**: HypothesisGeneratorAgent の内部で、レンズ snapshot を見て `Thought → Hypothesis → ConfidenceCheck → Hypothesis(refined)` のような反復を 1 回のみ回す微調整は意味がある。ただし API コール数が増えるため、コスト対効果は要評価。

#### 2.8.2 Reflexion (Shinn et al. 2023, NeurIPS 2023, [arxiv:2303.11366](https://arxiv.org/abs/2303.11366))

> 3 モデル構成: Actor (action 生成) + Evaluator (scoring) + Self-Reflection (verbal reinforcement)。weights 更新せず、verbal feedback を episodic memory に積む。

| Reflexion の役割 | 現実装の対応 |
|---|---|
| Actor | `StrategyThinker` / `HypothesisGenerator` / `Mutation/CrossoverAgent` |
| Evaluator | `analysis-engine` 正式 BT (`/v1/screening-backtest`) + `StatusManager.canPromoteToConfirmed*` |
| Self-Reflection | `ReflectionAI` (`reflectionAIService`) → `agentMemory.addLesson()` |
| Episodic memory buffer | `agentMemory.lessons` (= 永続化されている、`recordLesson`/`getLessons`) |

**評価**: Reflexion の構造を**既に実装している**。特に「Evaluator が weights ではなく verbal feedback を返す」点は、Reflection AI が `lessons: string[]` を返して `agentMemory.addLesson()` で蓄積する形と完全一致。

**ギャップ 1**: PDCALoop 自身の reasoning は episodic memory に入らない (前述 §2.1.2.a)。
**ギャップ 2**: `ReflectionAI` のスコープが**個別トレード単位**で、世代単位 / プロンプト世代単位の reflection がない。EvolutionLoop 1 世代の `GenerationReport` を入力にした「世代 reflection」エージェントを追加すると、Phase 6.7 のプロンプト進化を駆動する強い feedback シグナルになる。

**取り込み余地**: `GenerationReflectionAgent` の追加 (Phase 7 候補)。設計書 `phase_6_specification.md` の MetaEvolutionAgent と役割が近いが、より頻度が高い。

#### 2.8.3 AutoGen (Wu et al. 2023, [arxiv:2308.08155](https://arxiv.org/abs/2308.08155))

> 複数 agent が会話 (conversation) を通じてタスクを遂行する framework。Agent はカスタマイズ可能、人間入力 + LLM + tool の混合モードで動作。

| AutoGen の特徴 | 現実装の対応 |
|---|---|
| Multi-agent conversation | `BullBearDebateAgent.ts:1-20` で実装。Bull/Bear/まとめ役の 3 役で討論 |
| Customizable agents | 12 種のエージェント、各々が独立した system prompt |
| Tool use | SkillRegistry (Phase 5.5) 経由 |
| Human-in-the-loop | `MetaEvolutionAgent.executeProposal()` の人間承認 (`MetaEvolutionAgent.ts:284-391`) |

**評価**: AutoGen の核心 (Conversational Programming) は `BullBearDebateAgent` で部分的に実装されているが、**会話ターン数は 1-2 ターンで固定**。AutoGen は通常もっと多ターンの議論を想定する。

**ギャップ**: `DevilsAdvocateAgent` (`agents/DevilsAdvocateAgent.ts:312` 行) は反証専任エージェントだが、StrategyThinker → DevilsAdvocate → StrategyThinker の往復が**1 回固定**。AutoGen 流の「合意するまで往復」「stuck 検出で abort」のような対話制御は未実装。

**取り込み余地**: 多エージェント会話のループ制御を `AgentConversation` クラスとして抽象化し、`BullBearDebateAgent` と `DevilsAdvocateAgent` 双方を再実装すると、将来の専門家会話 (`TrendSpecialist` vs `OscillatorSpecialist` の議論など) に拡張できる。Phase 7 候補。ただし AutoGen 本体を直接依存にするとライセンス/保守コストがかかるため、薄い自前実装 + パターン参照が現実解。

#### 2.8.4 MAP-Elites / Quality-Diversity (Mouret & Clune 2015, [arxiv:1504.04909](https://arxiv.org/abs/1504.04909))

> behavior space を grid で離散化、各 cell に最高 quality を保持する archive 駆動の進化アルゴリズム。

| MAP-Elites の要素 | 現実装の対応 (`qualityDiversityArchiveLite.ts`) |
|---|---|
| Behavior descriptor | `BehaviorDescriptorLite` (PR #97, `behaviorDescriptorLite.ts`) |
| Cell key | `buildQdArchiveCellKeyV1(d)` (`L144-158`) |
| Quality score | `computeQdArchiveQualityScoreV1(c)` (`L172-200`) |
| Archive (cell → elite) | `QualityDiversityArchiveStateV1.cells` (`L70-84`) |
| Replacement | `compareForCellOwnership` (`L206-215`) |
| Capacity 制限 | `maxCells = 32` (`L119`)、超過時は qualityScore 昇順削除 |
| Parent injection | `selectQualityDiversityArchiveParentsV1` (`L440-455`) で次世代に最大 2 件注入 |

**評価**: lite 版として**論文の本質を取り込めている**。特に「cell ごとに 1 件保持」「behavior descriptor で多様性を測る」「mutation parent を archive から取る」の 3 大要素が揃っている。

**ギャップ 1**: 本格 MAP-Elites は archive 自体が selection pool だが、本実装は archive を **mutation/crossover の親素材として 2 件注入するだけ** (`EvolutionLoop.ts:534-556`)。selection は別パイプライン (`StrategyPopulation.getElites`)。これは設計書通り (`qualityDiversityArchiveLite.ts:14`「Surrogate Rescue Lane / formalBtCandidate 選抜には影響させない」) で、副作用を抑える正しい lite 化。

**ギャップ 2**: cell key が文字列 9 次元の連結で、**連続値 (PF, DD, trade count) を bin 分けしていない**。論文の MAP-Elites は通常 2-5 次元の連続値 grid (例: PF × DD)。離散カテゴリ key は探索空間の illumination 効果が限定的。

**取り込み余地**: cell key に `pfBin = Math.floor(pf / 0.5)` / `ddBin = Math.floor(dd / 0.05)` のような連続値 bin を追加すると、illumination 効果が強化される。Phase 7 拡張候補。ただし bin 数を増やすと cells が組み合わせ爆発するため、`maxCells = 32` の上限は同時に見直す必要がある。

#### 2.8.5 Novelty Search (Lehman & Stanley 2008, ALIFE XI, [PDF](https://www.cs.swarthmore.edu/~meeden/DevelopmentalRobotics/lehman_ecj11.pdf))

> 目的関数の代わりに「過去の個体群との novelty (距離)」だけで進化を駆動。deceptive な勾配を抜け出すのに有効。

| Novelty Search の要素 | 現実装の対応 |
|---|---|
| Novelty score | `scoreNoveltyAgainstSelected` (`behaviorDescriptorLite.ts`) |
| Behavior characterization | `BehaviorDescriptorLite` の 9 次元 |
| Archive of past behaviors | `selected: ClassifiedCandidate[]` (`surrogateRescuePolicy.ts:325`) - generation-local |
| Novelty-driven selection | `novelty_rescue` lane (`L321-355`)、TopK = 1 |
| Pure novelty (no objective) | × (本実装は objective + novelty のハイブリッド) |

**評価**: 「pure novelty で進化を駆動」は論文の極論であり、実用システムではほぼ採用されない (FunSearch 含め多くの後続研究は objective + novelty のハイブリッド)。本実装の `novelty_rescue` lane は「objective を主軸、novelty を rescue 補完」という現実的な選択。

**ギャップ**: novelty score の計算が **当世代の selected 集合との距離だけ**で、**過去世代の archive との距離が含まれない**。これでは「先週も見たような戦略を novel 扱い」してしまう。Phase 5B/6 で過去 30 世代の `formal_bt_passed` を取り込んだ multi-generation novelty に拡張する価値はある。

**取り込み余地**: `behaviorDescriptorLite.scoreNoveltyAgainstSelected` の `selected` 引数に過去世代の `formalBtPassed` 候補を渡すだけで実現可能 (= API 形状を変えずに data flow を拡張)。Phase 7 候補。

#### 2.8.6 FunSearch (Romera-Paredes et al. 2024, Nature, [DeepMind blog](https://deepmind.google/blog/funsearch-making-new-discoveries-in-mathematical-sciences-using-large-language-models/))

> LLM (creative solver) + Evaluator (correctness gate) のループで、**プログラム空間** を進化させる。island-based evolution で多様性を保持、best-shot prompting で改善する。

| FunSearch の要素 | 現実装の対応 |
|---|---|
| Pretrained LLM (frozen) | OpenAI/Anthropic API 経由 (`AIProvider`) |
| Evaluator | analysis-engine 正式 BT |
| Best-shot prompting | `MutationAgent.generateMutants(parents, scores)` (`agents/MutationAgent.ts`) |
| Island-based evolution | `StrategyPopulation` の regime 別管理 (`StrategyPopulation.getByRegime`) |
| Skeleton + critical part | StrategyDSL の `entry/stopLoss/takeProfit/parameters` 構造 |

**評価**: FunSearch のパターンと**ほぼ同型**。むしろ本実装のほうが**正式 BT (= Evaluator) の権威性が強い** (`Critical-4 §13` の役割分離)。

**ギャップ 1**: FunSearch の "island" は完全独立に進化し、稀に migration するが、本実装の regime は OHLCV 取得時に regime 判定で切り替わるだけで、**island migration の概念はない**。regime が頻繁に変わる場合、population がコールド・スタートしやすい。

**ギャップ 2**: best-shot prompting で **過去最高スコアの戦略を mutation prompt に注入する**箇所は `MutationAgent` 内にあるが、`mutation.md` プロンプトファイルのテンプレートで `{{TOP_3_PARENTS}}` のような明示的な best-shot 構造があるかは要確認。

**取り込み余地**: 1) regime 跨ぎ migration を世代毎に確率 5% で実行、2) `mutation.md` で `{{BEST_PARENT_SCORE}}` 形式の best-shot 構造を明示。1) は Phase 7、2) は Phase 6.7 範疇で実装可能。

#### 2.8.7 Deflated Sharpe Ratio (Bailey & López de Prado 2014, [PDF](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf))

> Sharpe Ratio が「N 試行を補正しても 0 と有意に異なるか」を z-score で返す。selection bias / multiple testing の影響を排除。

| DSR の要素 | 現実装の対応 (`analysis-engine/app/statistics/dsr.py`, `src/shared/statistics/deflatedSharpeRatio.ts`) |
|---|---|
| `compute_sharpe_ratio` | 実装あり (`dsr.py:19-34`) |
| `compute_skewness` | 実装あり (`L37-51`) |
| `compute_kurtosis` (Pearson) | 実装あり (`L54-68`) |
| `expected_max_sharpe(N) ≈ sqrt(2 * ln(N))` | 実装あり (`L71-80`) |
| Bailey-López de Prado eq. 9 | 実装あり (`L96-171`) |
| TS / Python 同期 | コメントで明示 (`L1-9`) |

**評価**: 論文の式を**Python と TypeScript で同じ形に実装**しており、計算結果が両側でビット精度一致するよう pin されている (`dsr.py:7-9`)。これは drift 防止として最高水準の実装。

**ギャップ**: 前述 §2.2.3.c の通り、**現状は観測ログのみで promotion gate に組み込まれていない** (`EvolutionLoop.ts:747-769`)。Phase 7 で Promotion 条件 `formalBtPassed && dsr > 0` (片側 95% 有意なら `dsr > 1.645`) を追加すれば、N 試行補正のかかった selection になる。

#### 2.8.8 Combinatorial Purged Cross-Validation (López de Prado 2018, AdvML in Finance)

> 時系列データの train/test split で、ラベル重複を purge + embargo して情報リークを防ぐ。N 個のグループから k 個を test に取る組み合わせで多パスの OOS 評価を生成。

| CPCV の要素 | 現実装の対応 |
|---|---|
| Purging | `analysis-engine/app/walk_forward.py` で実装 (要確認、コメントベースで推定) |
| Embargo | 同上 |
| 多パス評価 | `WalkForwardSplit` モデル (`prisma/schema.prisma:861`) で複数 split を保持 |
| Test set 組み合わせ | × (現状は単一 IS/OOS split) |

**評価**: 単一 IS/OOS split (`SurrogateFitnessSimulator.ts:244` の 70/30) は CPCV の本質ではない。本格 CPCV は **N=6 グループから k=2 を test に取る = 15 通りの multipath** で、各 path の Sharpe 分布から PBO (Probability of Backtest Overfitting) を計算する (CPCV の DSR / PBO 評価は [`mlfinlab` ドキュメント](https://www.mlfinlab.com/en/latest/cross_validation/cpcv.html) に詳しい)。

**ギャップ大**: 本格 CPCV はまだ実装されていない。Phase 6.8b (Python 検証サービス、未実装) のスコープに含めるべき機能。

**取り込み余地**: `analysis-engine/app/oos_validation.py` に CPCV runner を追加し、PBO を返すようにすると、進化候補の多パス OOS 評価が実現できる。Phase 7 で Phase 6.8b と一緒に検討。実装難度はそこそこ高い (multipath の組み合わせ管理 + 結果集計)。

#### 2.8.9 比較マトリクス総括

| パターン | 取り込み度 | 主要ギャップ | 推奨 Phase |
|---|:-:|---|:-:|
| ReAct | 部分 (state machine 部分は決定論) | LLM の trace 永続化 | 6.7 / 7 |
| Reflexion | 高 (Actor + Evaluator + Reflection が揃う) | PDCA 自身の reflection 不在、世代単位 reflection 不在 | 6.7 / 7 |
| AutoGen | 部分 (BullBearDebate のみ) | 多ターン会話の自動制御 | 7 |
| MAP-Elites | 高 (lite 版として正しい) | 連続値 bin、archive selection 直結 | 7 |
| Novelty Search | 部分 (rescue lane で実装) | 過去世代 archive との距離 | 7 |
| FunSearch | 高 (LLM + Evaluator + island) | island migration、best-shot 明示 | 6.7 / 7 |
| DSR | 高 (式の正確実装) | promotion gate 統合 | 7 |
| CPCV | 低 (単一 split のみ) | multipath、PBO 計算 | 6.8b / 7 |

**総評**: 学術文献の主要パターンを**ほぼ全て認識した上で、lite 版として段階的に取り込んでいる**プロジェクトはレア。論文との対応をコメントで明示している箇所が多く (`qualityDiversityArchiveLite.ts:1-24`, `dsr.py:1-9`)、保守者にとっての可読性が高い。

### 2.9 観測可能性とテスト容易性

`src/side-b/tests/` 配下に 96 テストファイル (前述探索結果)。

#### 2.9.1 カバー実態

| カテゴリ | テスト数 | 実装の核 |
|---|---:|---|
| evolution/ | 18 | EvolutionLoop, candidates, OOS, QD-archive |
| prompts/ | 9 | Registry, A/B test, PromptMutation, loader |
| strategy_dsl/ | 8 | DSL evaluator, surrogate fitness |
| ledger/ | 4 | EdgeLedger, StatusManager |
| lenses/ | 6 | 全レンズ + Aggregator + TimeSession |
| validation/ | 6 | WF, MC, BH |
| agents/ | 6 | HypothesisGenerator, Specialists, Backtester |
| その他 | 39 | bridge, cli, orchestrator, skills |

#### 2.9.2 ギャップ: MetaEvolution / PromptMutation のテスト不足

`MetaEvolutionAgent.ts` (470 行) と `PromptMutationAgent.ts` (225 行) の単体テストが `tests/agents/` から確認できない (上記カテゴリ別一覧で agents は 6 件、HypothesisGenerator/Specialists/Backtester で埋まっている)。

memory `project_phase_6_completed.md` (2026-04-22) でも「自動実行は全て既定 false」となっており、**実運用前にテスト整備が必要**。特に `executeProposal` (`MetaEvolutionAgent.ts:284-391`) は `MONTHLY_ADD_LIMIT = 1` の制約や `__global__` / `__specialist_common__` 除外などの安全装置が多数あるため、テスト無しに本番投入はリスクが高い。

**推奨**: Phase 6 完了前の必須タスクとして以下を追加:
1. `MetaEvolutionAgent.executeProposal` の各分岐 (add/modify/deprecate, 月上限超過, agentName 予約, initialPrompt 不足) を網羅
2. `PromptMutationAgent` の variant 生成 + Registry register の正常系/異常系
3. `MONTHLY_ADD_LIMIT` の境界値 (0, 1, 2)

#### 2.9.3 e2e でのエージェントループ統合テスト戦略

現状の e2e テスト (`e2e/*.spec.ts` 7 ファイル、Playwright) は UI/API レイヤー中心。**Side-B のエージェントループは個別単体テストのみ**で、`PDCALoop → Side-B Scheduler → AIOrchestrator → Strategy Thinker → 仮想トレード → Reflection → AgentMemory` のフルサイクルを通すテストが見当たらない。

**推奨**: `tests/integration/sidebFullCycle.test.ts` のようなテストを追加し、以下を 1 サイクル実行する:
1. Mock OHLCV を fixtures から読み込み
2. PDCALoop を 1 tick (= IDLE → SESSION_OPEN → MONITORING)
3. Mock LLM で StrategyThinker / Specialists / DebatorAgent を返す
4. Reflection AI を mock して `lessons` を返す
5. AgentMemory に lessons が保存されたか assert

これは Reflexion ループ全体の retroactive な fitness を見るテストで、Phase 6 後半の必須インフラ。

---

## 3. フロントエンド要点

### 3.1 Next.js 16 App Router 採用の整合性

`src/frontend/next.config.ts:25-29` で `turbopack: { root: repoRoot }` のみ。App Router がデフォルト (Next.js 16 標準)、Pages Router 未使用。

`tsconfig.json:8` で `strict: true`、`L4` で `target: ES2017`。target が ES2017 なのは古め (Next.js 16 推奨は ES2022 以降だが、互換性重視なら問題なし)。

memory `feedback_no_any_unknown.md` (any/unknown 禁止) と整合する `strict: true` 設定。

### 3.2 状態管理ライブラリ不採用の評価

`package.json:14-29` に zustand / jotai / recoil / redux / @tanstack/react-query が一切ない。`contexts/` (前述探索結果) で React Context API のみ使用。

**評価**: 個人開発規模なら Context API で十分。ただし以下の場合に問題化する:
- ページ間で多数のキャッシュを共有する → Context だと不要な再レンダリング多発
- リアルタイムデータ (WebSocket / SSE) を扱う → useEffect での購読が散る
- バックエンド状態 (API レスポンス) のキャッシュ管理 → Context ではキャッシュ無効化が手動

**推奨**: バックエンド状態キャッシュは `@tanstack/react-query` の導入を推奨。Next.js 16 + React 19 で SWR / RQ どちらでも動作するが、楽観的更新 / 無効化 / リトライ戦略が必要なフォーム類で差が出る。

### 3.3 PWA が Turbopack 非互換で無効化されている件

`next.config.ts:21-23` のコメント:
> next-pwa は webpack ベースのため、Turbopack と互換性がない
> 現在は PWA 機能を無効化し、手動の Service Worker で対応

`package.json:24` に `"next-pwa": "^5.6.0"` は依存として残っているが、設定は外されている。

**問題**: 依存だけ残ってインストール時間が増えており、保守上は noisy。`@serwist/next` (Workbox 後継、Turbopack 互換) または手動 Service Worker のいずれかに統一することを推奨。

### 3.4 a11y / Core Web Vitals 観点のサンプル指摘

(静的レビューでは UI を実際に見ていないため、ファイル構成からの推論のみ)

- `recharts` (`package.json:27`) を使うチャート系コンポーネント (`BacktestChartTab.tsx` 等) は SVG レンダリングコストが高い。LCP / INP に響く可能性。
- `lightweight-charts` (`package.json:21`) も併用しており、ライブラリが 2 つ。1 つに統一できれば bundle size 削減。
- Radix UI (`@radix-ui/react-progress`, `@radix-ui/react-slot` の 2 つのみ)。a11y 重視なら追加採用 (Dialog, Tooltip 等) が望ましい。
- next/font の使用が確認できない (package.json 上では)。`@next/font` 経由でないと CLS 悪化の懸念。

---

## 4. Node バックエンド要点

### 4.1 22 ルート構成と Zod 検証一貫性

`src/backend/api/*Routes.ts` の 22 ファイル。各ルートは `validateRequest(zodSchema)` ミドルウェアで入力検証する設計 (前述探索結果)。

**評価**: Zod を Prisma と同じ schema 哲学で使うのは妥当。ただし以下の点を確認:
- 全 22 ルートで Zod 検証が**実際に有効化されているか** (実装漏れがないか) は別途 grep 確認が必要
- レスポンス側の Zod 検証は通常省略されるが、外部 API (analysis-engine) 経由で来るデータは `src/schemas/external/analysisEngine.ts` で response schema が定義されているはず (`EvolutionLoop.ts:44` で `AnalysisEngineScreeningBacktestResponse` を import)

### 4.2 JWT 独自実装 (Supabase Auth 不採用) の運用リスク

`src/middleware/authMiddleware.ts:29-73` の `requireAuth`:
- Cookie `auth_token` または `Authorization: Bearer <token>` を受け付け
- `sessionService.verifyToken(token)` で検証 (ファイル `src/backend/services/auth/sessionService.ts`)
- 失敗時 401

**リスク**:
1. **JWT_SECRET / JWT_REFRESH_SECRET の鍵ローテーション運用** が定義されていない (`.env.example` に置き場所はあるが、ローテーション SOP は未確認)
2. **トークン失効リストなし** (= JWT を盗まれた場合の取り消しが、JWT_SECRET の rotate しか手段がない)
3. **Supabase Auth が後からは入りにくい構造**: 現状は cTrader OAuth で Primary Account ID をユーザー識別子にしており (`docs/auth_troubleshooting.md` 参照)、Supabase Auth に移すと UID マッピング層が必要。memory `project_future_considerations.md` でも「Supabase Auth 寄せ検討」が話題になっている

**推奨**:
- 短期: 鍵ローテーション SOP (Cloud Run + Secret Manager の version 移行手順) を `docs/operations/jwt_rotation.md` に書く
- 中期: トークン失効リストとして Redis に `jwt_blacklist:<jti>` を持たせる (BullMQ がすでに Redis を使っているため、追加コストは低い)
- 長期: Supabase Auth への段階的移行を `phase_future_*` で議論。これは複数 OAuth プロバイダ (cTrader / Google / Apple) 対応時の前提

### 4.3 BullMQ リトライ設計

`src/config/queueConfig.ts` (前述探索結果):
- 4 キュー: note-regenerate, feature-recalculate, ai-summary-regenerate, full-reprocess
- リトライ 3 回、指数バックオフ
- 優先度 HIGH(1) / NORMAL(5) / LOW(10)

**評価**: 標準的な設定。BullMQ v5 系のベストプラクティス (`Job.opts.attempts` + `backoff`) と整合。

**改善余地**:
- **dead letter queue (DLQ) 不在**: 3 回失敗したジョブはどこに行くのか? `failed` 状態で残すだけだと、運用者が定期的に bull-board で確認しないと気づけない。Cloud Logging + Slack/Email アラートを `events.failed` に hook するのが望ましい
- **rate limiting なし**: AI summary regenerate が短時間に多数発火すると LLM API rate limit に引っかかる可能性。`Queue.concurrency` を AI 系キューだけ低めに設定 (例: 2) を推奨

### 4.4 52 Prisma モデルの肥大化兆候

memory `project_critical_4_progress.md` で進捗が追えるが、`schema.prisma:1822` 行は**個人プロジェクトとしてかなり大きい**。ドメイン別に分けると:

- ユーザー/認証: 4
- トレード記録: 4
- マッチング: 7
- AI 関連: 5 (AISummary, AITradePlan, AITradeNote, AINoteSummary, EdgeHypothesis)
- 戦略進化: 7 (Strategy, StrategyVersion, StrategyNote, StrategyAlert, StrategyAlertLog, StrategyCorrelation, StrategyComparisonResult)
- バックテスト: 5 (StrategyBacktestRun/Result/Event, ScreeningBacktestRun, EvolutionBacktestRun)
- 市場データ: 5 (OHLCVCandle, SpreadBar, TickData, RealtimeOHLCV, DataPreset)
- Walk-Forward / MC: 3
- Phase 6 関連: 3 (PromptVersion, PromptAbTestResult, AgentRestructureProposal)
- その他: 9

**問題**: 1 ファイル 1822 行のスキーマは IDE での編集が遅い + マージコンフリクトしやすい。Prisma 5 から `multiSchema` プレビューがあり、複数 `.prisma` ファイルに分割可能。

**推奨**: Phase 7 で `prisma/schema/` ディレクトリに分割。ドメインごとに `users.prisma` / `trades.prisma` / `strategies.prisma` / `ai_agents.prisma` 等。Prisma の `multiSchema` フラグを enable する。

---

## 5. Python バックエンド要点 (analysis-engine)

### 5.1 FastAPI 依存性注入の活用度

`analysis-engine/app/main.py:34-35`:
```python
cfg = load_db_config()
engine = create_db_engine(cfg)
```

**Module-level で engine を生成**しており、FastAPI の `Depends()` を使った DI は採用していない。`run_walk_forward(req)` (`L50`) や `run_oos_validation(engine, req)` (`L65`) のように `engine` を引数で渡す形。

**評価**: シンプルで動作はする。ただし以下のデメリット:
- テスト時に `engine` を mock 差し替えしにくい (module-level なので)
- リクエスト単位で transaction を切る制御が手動
- FastAPI の依存性ツリーの可視化 (`/docs` の Schema) に engine が出ない

**推奨**: `Depends(get_engine)` 形式に移行。

```python
from fastapi import Depends

def get_engine() -> Engine:
    return engine  # module-level、テストで override

@app.post("/v1/oos-validation", response_model=OosValidationResponse)
def oos_validation(
    req: OosValidationRequest,
    engine: Engine = Depends(get_engine),
) -> OosValidationResponse:
    return run_oos_validation(engine, req)
```

`app.dependency_overrides[get_engine] = lambda: test_engine` でテスト時に差し替え可能になる。

### 5.2 pandas_ta 0.4.71b0 の保守性

`requirements.txt:5`:
```
pandas_ta==0.4.71b0
```

**重大リスク**: `pandas_ta` (Original by Twopirllc) は 2024 年に保守が事実上止まっている (GitHub の更新が散発的、issue 多数未対応)。`b0` は beta バージョンで、stable 版でない。

代替候補:
- **`pandas-ta-classic`**: コミュニティ fork、活発にメンテナンスされている (2025 年も活発)
- **`talib-python`**: C 言語実装、最速、長期メンテ。pandas DataFrame との連携は別実装
- **`finta`**: 純 Python、シンプル、メンテ続行中

**推奨**: 短期は pandas_ta を pin したまま運用、中期で `pandas-ta-classic` への移行を Phase 7 検討候補に。analysis-engine の指標計算は本実装の真実 (`compute_indicator_series`) なので、移行時は同等性テストが必須。

### 5.3 pytest カバー実態

`analysis-engine/tests/` の存在は確認したが (前述探索結果)、テスト数の正確な把握は未。`src/shared/statistics/dsr.py` の Python 側に対応するテストが `tests/test_dsr.py` 等で pin されているはず。

**推奨**: `pytest --cov` でカバレッジを取り、`docs/diagnostics/` に保存。最低でも `walk_forward.py` / `oos_validation.py` / `backtest/runner.py` / `dsr.py` の 4 つは line coverage 80% 以上が望ましい (これらが Side-B の最終 Evaluator)。

### 5.4 /v1/walk-forward と /v1/oos-validation の責務切り分け

`main.py:43-65`:
- `/v1/walk-forward`: トレードイベント列を受け取り IS/OOS 分割で過学習スコア + 安定性指標
- `/v1/oos-validation`: 既存 ScreeningBacktest を OOS 期間で実行し metrics + verdict (passed/failed/unknown) を返す。**評価の正本は analysis-engine 側、Side-B では再判定しない** (`L58-64`)

**評価**: `/v1/oos-validation` は PR #109 で追加され、設計書 `pr_105_analysis_engine_authority_addendum.md` に基づく。**評価の正本性が analysis-engine 側にある**という設計判断は、Critical-4 の役割分離と整合。

**改善余地**: `/v1/walk-forward` は Node 側からトレードイベントを受け取るが、`/v1/oos-validation` は Side-B から DSL を受け取って自分で実行する。**入力形式が異なる 2 経路**が並存しており、将来統合を検討する価値はある。Phase 6.8b で議論。

---

## 6. DB / Supabase 要点

### 6.1 36 マイグレーションの整合性

`prisma/migrations/` に 36 個 (前述探索結果)。命名は `YYYYMMDDhhmmss_<description>` の標準形。

**整合性チェック**: マイグレーション順序が時系列であること、`migration.sql` が空でないこと、`schema.prisma` が最終状態と整合することは Prisma が保証する。`db-migrate.yml` ワークフローで本番反映。

**改善余地**: マイグレーション検証 SQL (`prisma migrate diff` の結果を CI で確認) を `ci.yml` に追加すると、`schema.prisma` の手動編集による drift を検知できる。

### 6.2 **重要**最重要指摘**重要** RLS 有効化済だがポリシー未設定

`prisma/migrations/20260409140000_enable_rls_all_tables/migration.sql:1-13` の冒頭コメント:
```sql
-- - Supabase の anon / authenticated が PostgREST 経由でテーブルに触れないようにする
-- - ポリシー未作成のため、上記ロールは行へのアクセス不可（デフォルト拒否）
-- - Prisma は service_role で接続する想定のため RLS をバイパスし、既存動作は維持される
```

49 テーブル全てで `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` を実行。**ポリシーは作っていないため、`anon` / `authenticated` ロールは全行アクセス不可** (= デフォルト拒否)。

**現状の安全性**:
- OK `anon` ロール (PostgREST 経由) からテーブルが見えない
- OK Prisma が `service_role` で接続する限り、RLS をバイパスして動作する
- NG 将来 Supabase Auth / Edge Functions / クライアント側 supabase-js を導入した瞬間、**ポリシー未設定なので何もできなくなる**

[Supabase 公式 RLS ベストプラクティス 2025](https://supabase.com/docs/guides/database/postgres/row-level-security) によれば:
> RLS must always be enabled on any tables stored in an exposed schema.

→ 有効化は OK。次は **policy を定義しないと resource が使えない**。

> The service_role is used by the API (PostgREST) to bypass Row Level Security. This is why it's essential to keep service role credentials secure and only use them on backend systems where you control access.

→ 現状の Prisma → service_role 経由は OK。ただし `service_role` のキーが Cloud Run の `--update-secrets` で渡されている (`deploy.yml:127`) 経路の堅牢性は要監査。

**推奨実装ロードマップ**:

1. **短期 (1-2 週間)**: ユーザー紐付けデータ (User, Watchlist, ChartDrawing, AITradeNote, CTraderToken) に最低限の RLS ポリシーを書く。Supabase 公式の AI Prompt テンプレートに従い、`auth.uid() = "userId"` 条件で SELECT/INSERT/UPDATE/DELETE を分離。ポリシー追加は破壊的変更ではなく additive (`service_role` バイパスは維持)。
2. **中期 (1-2 ヶ月)**: Side-B 系テーブル (EdgeHypothesis, StrategyBacktestRun, EvolutionBacktestRun, PromptVersion 等) は service_role 専用テーブルとして明示。`COMMENT ON TABLE ... IS 'service_role only'` で文書化。
3. **長期 (3-6 ヶ月)**: Supabase Auth 導入時に policy を `auth.uid()` に対応させて段階移行。memory `project_future_considerations.md` (Supabase Auth 寄せ検討) と整合。

### 6.3 service_role バイパスの妥当性

現状: Prisma → Postgres (service_role) → 全テーブルにアクセス可能。これは Supabase 公式が**バックエンドからの DB アクセスとして推奨する**形 ([Securing your API](https://supabase.com/docs/guides/api/securing-your-api))。

**評価**: 妥当。ただし以下 2 点は監査:
1. `service_role` キーの保管場所: Cloud Run の secret + GCP Secret Manager。アクセス権限が SA だけに絞られているか
2. ローカル開発時の保管: `.env` ファイル経由。`.gitignore` 確認、`.env.example` に直接書いていないこと確認 (前述探索結果で `.env.example:162` 行あり、key 名のみ記載)

### 6.4 TimescaleDB 機能の活用余地

`docker-compose.yml` で `timescale/timescaledb:2.14.2` を使用 (前述探索結果)。**TimescaleDB は Supabase の Postgres とは別**で、ローカル開発のみ。本番 Supabase はバニラ Postgres + 拡張で動作。

OHLCV / TickData / RealtimeOHLCV など時系列データが多い (`schema.prisma`)。Hypertable に変換すれば、自動 chunk 管理 + retention policy + continuous aggregates が使える。

**現状**: Hypertable 設定なし (`prisma/schema.prisma` の OHLCVCandle 等を見る限り通常テーブル)。

**推奨**: ローカル開発のみで TimescaleDB 機能を使う場合は、`docker/db-init/` に `create_hypertable` の SQL を追加。本番 Supabase は TimescaleDB を有効化していない (Free tier では不可、Pro 以上で `timescaledb` extension 有効化が必要、Supabase 公式の対応は要確認)。

---

## 7. デプロイ / 運用要点

### 7.1 GCP Cloud Run の analysis-engine→API 依存順序

`.github/workflows/deploy.yml`:
- `deploy-analysis-engine` (job 0) → `deploy-gcp` (job 1, `needs: [deploy-analysis-engine]`)
- analysis-engine の URL を outputs から API 環境変数に流す (`L126`)
- ヘルスチェック 5 分待機 (`L72-84`, `L129-138`)

**評価**: 順序制御は妥当。analysis-engine が起動していない状態で API が動くと、Side-B Scheduler 起動時に formal BT 失敗が連発するため、依存順序の明示は正しい。

**改善余地**:
- ヘルスチェック失敗時 (`exit 1`) の **ロールバック処理が無い**。失敗しても既存 revision は live のままだが、明示的に `gcloud run services update-traffic --to-revisions=PREVIOUS=100` のようなロールバック step を追加すると本番安定性が増す
- E2E テスト (`L195-241`) で「API 到達できないが続行」(`L213`) と書かれている分岐が問題。到達できないなら以降は意味ある検証にならないので、本来は fail させるべき

### 7.2 **重要**リスク**重要** analysis-engine の `--allow-unauthenticated`

`deploy.yml:53-60`:
```bash
gcloud run deploy ${{ env.GCP_ANALYSIS_SERVICE_NAME }} \
  --image ${{ env.GCP_ANALYSIS_IMAGE }} \
  --region ${{ env.GCP_REGION }} \
  --platform managed \
  --allow-unauthenticated \
  ...
```

**問題**: `--allow-unauthenticated` で公開されている。誰でも `https://trader-note-analysis-engine-xxx.asia-northeast1.run.app/v1/walk-forward` を叩ける。

リスク:
1. **計算リソース盗用**: WalkForward は重い計算で、悪意ある第三者が連続でリクエストすると Cloud Run 課金が膨らむ
2. **DB 経由のデータ流出**: analysis-engine は Read-Only ロールで DB に接続するが (`docker/db-init/01-create-analysis-readonly.sql`)、SELECT 権限は OHLCV / Strategy / StrategyVersion 等を含む。`/v1/indicator-series` で symbol/timeframe/period を指定すると **OHLCV 履歴がそのまま返る**
3. **将来の拡張で書き込み API が追加された場合の影響**: 現状は read-only だが、設計判断で write 系 endpoint が増えた場合、認証なしのまま放置されるリスク

**推奨**:
- **短期**: Cloud Run の IAM 認証を有効化 (`--no-allow-unauthenticated`)、Side-B (Node API) のサービスアカウントにのみ `roles/run.invoker` を付与
- **中期**: API キー (Secret Manager) を `Authorization: Bearer <key>` で Side-B から送り、analysis-engine 側でミドルウェアチェック
- **代替**: Cloud Run の internal-only モードで VPC 内通信に限定 (Side-B も同 VPC 必要、コスト増)

### 7.3 Read-Only ロール分離 (db-init) の評価

`docker/db-init/01-create-analysis-readonly.sql` で analysis-engine 用の Read-Only ロール作成 (前述探索結果)。SELECT 権限のみ + セッション Read-Only 設定。

**評価**: 良い設計。`UPDATE` / `INSERT` を analysis-engine が誤って実行しても、ロールレベルで弾かれる。

**改善余地**: 本番 Supabase 側でも同等の Read-Only ロールが作られているか要確認。`deploy.yml:59` の `ANALYSIS_DATABASE_URL` がどんなロールで接続するかが鍵。

### 7.4 6 ワークフローの責務分担

| ワークフロー | 用途 | トリガー |
|---|---|---|
| `ci.yml` | Lint/Type/Test/E2E + 日次セキュリティ監査 | push, schedule (18:00 UTC) |
| `deploy.yml` | analysis-engine + API + DB migration + Scheduler setup | CI 成功後 / workflow_dispatch |
| `db-migrate.yml` | 手動マイグレーション | workflow_dispatch |
| `side-b-cron.yml` | Side-B Evolution の定期実行 | cron (毎朝 9 時 JST) |
| `sync-to-drive.yml` | Google Drive 同期 | (詳細未確認) |
| `grant-gcp-permissions.yml` | IAM 権限付与 | workflow_dispatch |

**評価**: 責務分離は妥当。`deploy.yml` がやや責務過多 (analysis-engine + API + migration + scheduler) だが、依存順序があるため統合は妥当。

### 7.5 side-b-cron.yml の運用観察フェーズ準備度

memory `project_phase_5b_hold.md` で「Phase 6 完了 + 運用観察データ確認まで Phase 5B 着手しない」とあるため、**この cron が運用観察データを蓄積する主力**になる。

**推奨確認**:
- cron の実行ログが Cloud Logging に残っているか
- `EvolutionBacktestRun` テーブルへの書き込み頻度 (= 1 日何件の formal BT が走ったか)
- `formalBtPassed=true` の件数推移 (= 進化候補の品質トレンド)
- DSR の分布 (前述 §2.2.3.c の観測ログから抽出)

これらを Phase 6 完了直後に集計し、Phase 5B 設計の前提データとして使うのが正しい順序。

---

## 8. リスク分析 (ヒートマップ + Top 5 詳細)

### 8.1 リスクヒートマップ

```
影響度 高 │ #1 RLS                  │ #2 analysis-engine 公開    │
       │ ポリシー未設定            │ #4 EvolutionLoop 1 ファイル │
       │                          │ #3 thinkingLog 永続化欠如  │
       │ #6 pandas_ta 保守停止    │                            │
       │                          │                            │
影響度 中 │                          │ #5 JWT 鍵ローテーション   │
       │ #7 PWA noisy 依存       │ #8 Phase 5B 凍結中の手動運用 │
       │                          │                            │
影響度 低 │ #9 PDCA Error backoff  │ #10 自動化フラグ全 false   │
       │                          │                            │
       └────────────────────────┴────────────────────────────┘
        発生可能性 低             発生可能性 高
```

### 8.2 Top 5 詳細

#### Risk #1: RLS ポリシー未設定での将来事故

| 項目 | 内容 |
|---|---|
| 影響度 | 最大 (機密データ流出 / コンプライアンス違反) |
| 発生可能性 | 中 (将来の機能拡張に依存) |
| 根本原因 | RLS 有効化のみ実施、ポリシーは未作成 (`prisma/migrations/20260409140000_enable_rls_all_tables/migration.sql`) |
| 対策 | §6.2 の段階ロードマップ (1-2 週間 / 1-2 ヶ月 / 3-6 ヶ月) |
| 必要工数 | 短期: 1-2 日 (主要 5 テーブルのポリシー)。中期: 1 週間 (全テーブル分類)。長期: 2-3 週間 (Supabase Auth 移行) |

#### Risk #2: analysis-engine 公開 (`--allow-unauthenticated`)

| 項目 | 内容 |
|---|---|
| 影響度 | 高 (計算リソース盗用 / OHLCV 流出) |
| 発生可能性 | 高 (公開 URL は探索可能) |
| 根本原因 | `deploy.yml:57` の `--allow-unauthenticated` |
| 対策 | §7.2 の IAM 認証 + invoker ロール限定 |
| 必要工数 | 1 日 (Cloud Run IAM 設定 + Side-B 側のサービスアカウント認証) |

#### Risk #3: PDCALoop thinkingLog 永続化欠如

| 項目 | 内容 |
|---|---|
| 影響度 | 中 (エージェントの自己学習が世代を跨がない、Reflexion パターン未完成) |
| 発生可能性 | 高 (毎日のプロセス再起動で発生) |
| 根本原因 | `pdcaLoop.ts:107, 615-621` の在メモリ 200 件保持 |
| 対策 | §2.1.2.a の `PDCAThinkingLog` テーブル追加 |
| 必要工数 | 2-3 日 (schema + migration + writer + reader) |

#### Risk #4: EvolutionLoop.ts の単一ファイル化 (1428 行)

| 項目 | 内容 |
|---|---|
| 影響度 | 中 (保守性、レビュー時のコンフリクト) |
| 発生可能性 | 高 (Phase 5B 着手で更に増える) |
| 根本原因 | Critical-4 PR シーケンスでメソッドが追加され続けた歴史 |
| 対策 | §2.2.3.a の Stage 分離 (Phase 7 候補、Phase 5B 着手前は触らない) |
| 必要工数 | 1-2 週間 (大規模リファクタ + テスト追加) |

#### Risk #5: JWT 独自実装の鍵ローテーション運用未定義

| 項目 | 内容 |
|---|---|
| 影響度 | 中 (鍵漏洩時の影響範囲が大きい) |
| 発生可能性 | 低 (Secret Manager で守られている) |
| 根本原因 | `src/middleware/authMiddleware.ts:1-189` 独自実装、ローテ手順書なし |
| 対策 | §4.2 の SOP 文書化 + Redis blacklist + 長期で Supabase Auth 移行 |
| 必要工数 | 短期: 半日 (SOP 書く)。中期: 2-3 日 (blacklist 実装) |

---

## 9. ベストプラクティス比較サマリー

各技術スタックの 2025-2026 推奨と現状のギャップ。出典は付録 B。

| スタック | 2025-2026 推奨 | 本実装 | ギャップ |
|---|---|---|---|
| Next.js 16 App Router | Server Actions 活用、Turbopack 標準 | App Router + Turbopack | ◯ ほぼ準拠 |
| React 19 | use() hook、Suspense ラッピング | 使用箇所未確認 | △ 個別検証必要 |
| Tailwind 4 | @tailwindcss/postcss 移行 | 採用済 | ◯ |
| Prisma 5 | multiSchema + pgbouncer 対応 | DIRECT_URL 設定済、multiSchema 未 | △ schema 分割余地 |
| Supabase RLS | Event Triggers で自動 RLS、新 API キー | RLS 有効化のみ、ポリシー未 | 未対応 §6.2 |
| FastAPI 0.115 | Depends() で DI、Pydantic v2 | module-level engine、Pydantic v2 ✓ | △ DI 移行推奨 |
| BullMQ v5 | DLQ + rate limiter | リトライ 3 回のみ | △ §4.3 |
| Cloud Run | invoker IAM、internal-only | analysis-engine が公開 | 未対応 §7.2 |
| AI agent patterns | Reflexion + ReAct + Tool use | 部分採用 (§2.8) | △ §2.8.9 |
| Quality-Diversity | MAP-Elites + CPCV | lite 版採用、CPCV 未 | △ §2.8.4, 2.8.8 |

---

## 10. ロードマップ提案

### 10.1 短期 (1-2 週間、Phase 6 完了に間に合わせる)

| # | タスク | 出典 | 推定工数 |
|:-:|---|---|---|
| 1 | RLS ポリシー設計 + 主要 5 テーブルへ追加 (User, Watchlist, ChartDrawing, AITradeNote, CTraderToken) | §6.2 | 2 日 |
| 2 | analysis-engine の `--allow-unauthenticated` 撤去 + invoker IAM 化 | §7.2 | 1 日 |
| 3 | MetaEvolutionAgent / PromptMutationAgent のテスト追加 (executeProposal の各分岐 + MONTHLY_ADD_LIMIT 境界) | §2.9.2 | 2 日 |
| 4 | JWT 鍵ローテーション SOP の `docs/operations/jwt_rotation.md` 作成 | §4.2 | 半日 |
| 5 | `PDCAThinkingLog` テーブル + writer + reader 実装 | §2.1.2.a | 3 日 |

### 10.2 中期 (1-2 ヶ月、Phase 6 完了後 + 運用観察フェーズ)

| # | タスク | 出典 | 推定工数 |
|:-:|---|---|---|
| 6 | Side-B 系テーブルへの「service_role only」コメント付与 + 全テーブル RLS ポリシー分類完了 | §6.2 | 1 週間 |
| 7 | analysis-engine の API キー認証ミドルウェア追加 | §7.2 | 2 日 |
| 8 | BullMQ DLQ + Slack/Email アラート | §4.3 | 3 日 |
| 9 | DSR を promotion gate に組み込む議論 (運用観察データを見て閾値決定) | §2.2.3.c | 1 週間 (議論 + 実装 + テスト) |
| 10 | `GenerationReflectionAgent` 設計議論 (Phase 6.7 範疇) | §2.8.2 | 議論のみ 2-3 日 |
| 11 | EvolutionLoop.ts の機能境界分割 (Phase 5B 着手前) | §2.2.3.a | 1-2 週間 |

### 10.3 長期 (3-6 ヶ月、Phase 5B 凍結解除後 / Phase 7)

| # | タスク | 出典 | 推定工数 |
|:-:|---|---|---|
| 12 | Phase 5B 実装 (進化候補 → Phase 4c 接続、選択肢 A or C ベース) | `phase_5b_specification.md` | 1-2 週間 |
| 13 | Phase 6.8b Python 検証サービス + CPCV / PBO 実装 | §2.8.8 | 2-3 週間 |
| 14 | Supabase Auth への段階的移行 | §4.2 / `project_future_considerations.md` | 3-4 週間 |
| 15 | LLM-driven Quality-Diversity (FunSearch 系) の取り込み | §2.8.6 | 2-3 週間 |
| 16 | pandas_ta → pandas-ta-classic 移行 + 同等性テスト | §5.2 | 1 週間 |
| 17 | Prisma multiSchema 分割 | §4.4 | 3-5 日 |
| 18 | `AgentConversation` 抽象化 (AutoGen 流の多ターン会話制御) | §2.8.3 | 1-2 週間 |

### 10.4 ロードマップ全体観

短期 5 件は **「セキュリティと運用観察の前提整備」** として優先。中期 6 件は **「Phase 6 完了 + 運用観察データの蓄積」** が前提。長期 7 件は **「データに基づく次フェーズ判断」** で発火。

memory `project_phase_5b_hold.md` (Phase 5B は Phase 6 完了 + 運用観察データ確認まで凍結) と完全に整合する優先順位にしてある。

---

## 11. マネタイズ可能性

各案について **現実性スコア (1-5) / 必要追加開発 / 法務リスク / 推奨着手時期** で評価。

### 11.1 案 A: B2C SaaS (個人トレーダー向けノート + AI 分析、月額)

| 項目 | 内容 |
|---|---|
| 現実性スコア | 4 / 5 |
| ターゲット | 個人 FX / 仮想通貨トレーダー (副業含む) |
| 月額想定 | 1,500-3,000 円 (TradingView Plus / TradeJournal Tier 程度) |
| 必要追加開発 | (a) Stripe / Pay.jp 課金統合 (1-2 週間), (b) tier ごとの機能制限 (1 週間), (c) UI/UX 全体磨き込み (2-4 週間), (d) iOS/Android アプリ (PWA でも可、3-4 週間) |
| 法務リスク | **金融商品取引法と投資助言業の境界**: AI が「具体的銘柄 + エントリー価格 + ロット」を提示すると投資助言業登録 (関東財務局、第二種金融商品取引業) が必要になる可能性。**「学習支援ツール / トレード記録ツール」と位置付けて、エントリー判断は最終的にユーザーが下す**形にすれば回避可能。免責事項とログ保存が必須 |
| 競合 | TradeStreamApp、TradeJournal、TradingView (一部機能)、Forex Tester (異文脈) |
| 強み | confirmed エッジ台帳 + Phase 4c の WF/MC/BH 統合検証は競合に類似品なし。AI の提案ではなく **「過去に統計的に通った手法」** を提示する点が信頼性で勝る |
| 推奨着手 | Phase 6 完了 + 運用観察 1-3 ヶ月後。MVP は 2-3 ヶ月で出せる |

### 11.2 案 B: 戦略ライセンシング (confirmed エッジ台帳の選別配信)

| 項目 | 内容 |
|---|---|
| 現実性スコア | 5 / 5 (本プロジェクトで最も差別化される) |
| ターゲット | 中級〜上級トレーダー、海外 prop firm の評価アカウント希望者 |
| 価格モデル | (a) 月額 9,800-19,800 円 / 戦略, (b) 戦略ごとの単発 30,000-100,000 円 |
| 必要追加開発 | (a) 戦略配信 API (1 週間), (b) 配信先トレーダー認証 + 利用ログ (1 週間), (c) Phase 5B 完了が前提 (= 進化候補が confirmed まで届く経路、現状凍結中), (d) 戦略の「現在も有効か」の再検証ジョブ (`shouldMarkStale`、既に実装済 §2.4.3) を運用化 (3 日) |
| 法務リスク | 案 A と同じ投資助言業境界。**「過去のバックテスト結果の配信」** であって**「将来の収益保証」** をしないことを契約書に明記。strategy_dsl の JSON を MT4/cTrader EA に変換する場合は、各プラットフォームの規約遵守 |
| 強み | 「学習 PF>1.5 + 検証 PF>1.3 + 過学習 <0.3 + WF/MC/BH 全通過 + DSR 観測」という審査を**通過した戦略のみ配信**できる。これは個人プロジェクトとしては破格の品質基準 (`statusManager.ts:23-30, 195-243` がコード上の証拠) |
| 推奨着手 | Phase 5B 完了後 (Phase 5B が 1-2 週間として、Phase 6 完了後 4-6 ヶ月) |

### 11.3 案 C: B2B 提携 (証券会社・FX ブローカーの分析機能 OEM)

| 項目 | 内容 |
|---|---|
| 現実性スコア | 2 / 5 (営業・契約のリードタイムが長い) |
| ターゲット | 国内 FX 業者 (GMO / DMM / SBI / 楽天 / セントラル) の差別化機能枠 |
| 価格モデル | 固定 + 従量 (取引高ベース) |
| 必要追加開発 | (a) ホワイトラベル化 (UI 切り替え可能、1-2 ヶ月), (b) 顧客側 SSO 連携 (3-4 週間), (c) 取引執行 API 連携 (cTrader だけでなく MT4/MT5/各社独自) (1-2 ヶ月) |
| 法務リスク | 第二種金融商品取引業者として登録が必要、または提携先の登録枠を借りる契約。**個人開発ではほぼ実現不可、法人化が前提** |
| 強み | 既存実装の cTrader OAuth (`CTraderToken` モデル) は導入済。analysis-engine の正式 BT 基盤も流用可能 |
| 推奨着手 | 法人化 + 案 A or B で実績作り後。3 年スパン |

### 11.4 案 D: 匿名化データ販売 (OHLCV + マッチング統計)

| 項目 | 内容 |
|---|---|
| 現実性スコア | 1 / 5 (法務 + 競合多数 + データ独自性ゼロ) |
| ターゲット | 大学研究室、quant fund |
| 価格モデル | データセットあたり 50,000-200,000 円 |
| 必要追加開発 | (a) ユーザー紐付け除去 (1 週間), (b) データセット切り出し API (1 週間), (c) 法務確認 (1 ヶ月) |
| 法務リスク | OHLCV 自体は cTrader 等の取引所/ブローカーに帰属、再配布権の確認必要。**ユーザー由来のトレード履歴を含めるなら個人情報保護法 + 利用規約改訂必要** |
| 強み | なし (Bloomberg / Refinitiv / Twelve Data に勝てない) |
| 推奨着手 | 推奨しない |

### 11.5 マネタイズの現実解

memory `project_phase_5b_hold.md` (運用観察データ蓄積優先) と整合させると:

1. **Phase 6 完了 + 運用観察 1-3 ヶ月後**: 案 A の MVP を投入。月額 1,500 円で個人ユーザー 50 人獲得が当面の目標。月次売上 7.5 万円 = サーバー代 (Cloud Run + Supabase + AI API) 程度
2. **Phase 5B 完了後 (= 6 ヶ月後)**: 案 B を案 A の上位 tier として追加。月額 9,800 円 = 1 ユーザーで月次 9,800 円。10 ユーザーで月次 9.8 万円
3. **2 年後**: 案 A + 案 B で月次 50 万円規模に届けば法人化検討。案 C は法人化後

**案 C/D は推奨しない。** 個人プロジェクトの強みを活かせない。

---

## 12. 付録

### 12.1 付録 A: 参照ファイルマップ (file:line ベース、レビュー本文の根拠)

#### Side-B コア
- `src/side-b/evolution/EvolutionLoop.ts:1-1428` — Phase 5A 進化ループ本体
- `src/side-b/evolution/surrogateRescuePolicy.ts:1-407` — Surrogate Rescue Lane
- `src/side-b/evolution/qualityDiversityArchiveLite.ts:1-480` — QD-Archive lite
- `src/side-b/evolution/parentPoolPolicy.ts` — 親個体プール v1
- `src/side-b/evolution/promotionGatePolicy.ts` — PromotionGate v1
- `src/side-b/evolution/repairOutcomeTelemetry.ts` — Repair Outcome テレメトリ
- `src/side-b/evolution/adaptiveRepairBudgetPolicy.ts` — Adaptive Repair Budget
- `src/side-b/strategy_dsl/SurrogateFitnessSimulator.ts:1-377` — Surrogate Fitness 評価
- `src/side-b/ledger/EdgeLedger.ts:1-799` — エッジ台帳 CRUD
- `src/side-b/ledger/statusManager.ts:1-286` — confirmed 昇格判定 (3 条件)
- `src/side-b/agent/pdcaLoop.ts:1-635` — PDCA ループ本体
- `src/side-b/lenses/TimeSessionLens.ts:1-66` — 時刻セッション
- `src/side-b/lenses/PatternLens.ts:1-60` — ローソク足パターン
- `src/side-b/lenses/LensAggregator.ts:1-120` — レンズ並列実行
- `src/side-b/prompts/loader.ts:1-163` — プロンプトローダー (3 階層合成)
- `src/side-b/prompts/__global__.md:1-55` — グローバルルール
- `src/side-b/prompts/registry/PromptRegistry.ts:1-377` — プロンプトバージョン管理
- `src/side-b/prompts/registry/variantSelector.ts:1-100` — A/B test variant 選択
- `src/side-b/agents/MetaEvolutionAgent.ts:1-470` — エージェント再編成提案
- `src/side-b/agents/specialists/TrendSpecialist.ts:1-80` — 専門家エージェント (代表)
- `src/side-b/agents/BullBearDebateAgent.ts:1-150` — Bull/Bear 討論

#### 周辺領域
- `src/frontend/next.config.ts:1-32` — Next.js 16 設定
- `src/frontend/tsconfig.json:1-34` — strict mode + paths
- `src/frontend/package.json:1-48` — FE 依存
- `src/middleware/authMiddleware.ts:1-189` — JWT 認証
- `analysis-engine/app/main.py:1-306` — FastAPI ルート
- `analysis-engine/app/statistics/dsr.py:1-172` — DSR 実装 (Bailey & López de Prado 2014)
- `analysis-engine/requirements.txt:1-10` — Python 依存
- `prisma/schema.prisma:1650-1820` — EdgeHypothesis / PromptVersion / AgentRestructureProposal
- `prisma/migrations/20260409140000_enable_rls_all_tables/migration.sql:1-100+` — RLS 有効化 (ポリシー未)

#### デプロイ
- `.github/workflows/deploy.yml:1-308` — GCP Cloud Run デプロイ
- `docker/db-init/01-create-analysis-readonly.sql` — analysis-engine 用 RO ロール
- `docker-compose.yml` — TimescaleDB (ローカル開発のみ)

#### 設計書
- `docs/design/DESIGN_DOC_autonomous_trading_architecture.md:1-200+` — 設計憲章 (7 原則)
- `docs/design/phase_5a_specification.md` — Phase 5A 進化ループ
- `docs/design/phase_5b_specification.md:1-120` — Phase 5B 設計ドラフト (未実装)
- `docs/design/phase_6_specification.md` — Phase 6 概観
- `docs/design/phase_6_7a_infrastructure.md:1-100` — グローバル層導入
- `docs/design/critical_4_bt_unification.md` — surrogate / 正式 BT の役割分離 (§13)
- `docs/design/pr_96_surrogate_rescue_lane_agent_prompt.md` 〜 `pr_108_quality_diversity_archive_lite_agent_prompt.md` — PR シーケンス

### 12.2 付録 B: Context7 / WebSearch 引用ソース一覧

#### 学術論文
- ReAct (Yao et al. 2022, ICLR 2023): https://arxiv.org/abs/2210.03629
- Reflexion (Shinn et al. 2023, NeurIPS 2023): https://arxiv.org/abs/2303.11366
- AutoGen (Wu et al. 2023): https://arxiv.org/abs/2308.08155
- MAP-Elites (Mouret & Clune 2015): https://arxiv.org/abs/1504.04909
- Novelty Search (Lehman & Stanley 2008, ALIFE XI): https://www.cs.swarthmore.edu/~meeden/DevelopmentalRobotics/lehman_ecj11.pdf
- FunSearch (Romera-Paredes et al. 2024, Nature): https://www.nature.com/articles/s41586-023-06924-6
- Deflated Sharpe Ratio (Bailey & López de Prado 2014): https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf
- Combinatorial Purged CV (López de Prado 2018, AdvFinML): https://en.wikipedia.org/wiki/Purged_cross-validation
- mlfinlab CPCV docs: https://www.mlfinlab.com/en/latest/cross_validation/cpcv.html

#### 技術ドキュメント
- Supabase RLS docs: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Securing your API: https://supabase.com/docs/guides/api/securing-your-api
- Supabase Security Retro 2025: https://supabase.com/blog/supabase-security-2025-retro
- Supabase Postgres Roles: https://supabase.com/docs/guides/database/postgres/roles

(Next.js 16 / Pydantic v2 / Prisma multiSchema / BullMQ v5 については、本レビューでは具体的な引用箇所は最小限に留め、推奨事項の根拠のみに使用)

### 12.3 付録 C: 設計書 vs 実装の対応マトリクス

| 設計書 (Phase) | 実装ファイル | 完成度 |
|---|---|:-:|
| `phase_1_specification.md` | `src/side-b/lenses/*` + `LensAggregator.ts` | OK |
| `phase_2_specification.md` | `src/side-b/orchestrator/aiOrchestrator.ts` 周辺 | OK |
| `phase_3_specification.md` | `src/side-b/agent/pdcaLoop.ts` (EVALUATING_ENTRY 空) | △ |
| `phase_4_specification.md` (4a) | `src/side-b/agents/HypothesisGeneratorAgent.ts` + `EdgeLedger.ts` | OK |
| `phase_4b_specification.md` 縮小版 | `statusManager.canPromoteToScreeningPassed` (PR #76 で 1.1 暫定緩和) | OK |
| `phase_4c_specification.md` | `validation/tools/` + `BacktesterAgent.ts` | OK |
| `phase_4d_specification.md` | `EdgeLedger.find()` + `findRecentlyValidated` | OK |
| `phase_5a_specification.md` | `EvolutionLoop.ts` + `evolution/*` + Critical-4 PR #96-108 | OK |
| `phase_5_5_specification.md` | `src/side-b/skills/*` | OK |
| `phase_5b_specification.md` | (未実装、凍結中) | 凍結 |
| `phase_6_specification.md` (全体) | `agents/Meta*.ts` + `prompts/registry/*` | 進行中 |
| `phase_6_6_specification.md` | `agents/specialists/*` | OK |
| `phase_6_7a_infrastructure.md` | `prompts/loader.ts` + `PromptRegistry.getCompositeActive` + `__global__.md` | OK |
| `phase_6_7b_*` | (進行中) | 進行中 |
| `phase_6_7c_prompts.md` | `agents/specialists/` + `__specialist_common__.md` (進行中) | 進行中 |
| `phase_6.8_execution_simulation_specification.md` | `strategy_dsl/executionSimulation.ts` (部分) | 進行中 |
| `phase_6.8b_python_validation_service.md` | (未実装) | 凍結 |
| `critical_4_bt_unification.md §13` | `EvolutionLoop.verifyCandidatesWithFormalBacktest` + `SurrogateFitnessSimulator.ts:1-16` のコメント | OK |

凡例: OK 完成 / 進行中 部分実装 / △ 一部空実装 / 凍結 凍結 or 未着手

---

## おわりに

本レビューはコード読みのみによる静的レビューで、以下は実施していない:
- lint / typecheck / test の実行 (CI 上での合否は未確認)
- 依存パッケージの脆弱性監査 (npm audit / pip-audit) の実測
- 実際の Playwright e2e の挙動確認

そのため、**ランタイムでのみ顕在化する問題 (例: BullMQ で実際にジョブが詰まっているか、本番 OHLCV のデータ品質、analysis-engine のレスポンスタイム)** は本レビューでは検出できていない。Phase 6 完了タイミングで `npm audit` / `pip-audit` / Cloud Logging の集計を別途実施することを推奨。

最後に、本プロジェクトの**最も価値のある資産**は:
1. **設計書とコードのコメントの整合性**: Critical-4 PR #96-108 の各 PR で設計意図がコードコメントに残されており、6 ヶ月後の保守者が読んでも追跡可能
2. **学術文献の認識度**: DSR / MAP-Elites / Reflexion / FunSearch などの主要文献を実装側で正しく lite 版化している
3. **役割分離の徹底**: surrogate / 正式 BT / OOS / promotion の 4 段階が型レベルで分離されており、ある段の改修が他段を壊さない

これらは個人プロジェクトとして極めて高い水準にある。短期 5 件 (RLS / analysis-engine 認証 / Meta テスト / JWT SOP / thinkingLog) を片付けてから、Phase 6 完了 → 運用観察 → Phase 5B の順で進めるのが合理的。

> 本レビューは Claude Opus 4.7 (1M context) によって 2026-05-08 に作成されました。
> レビュー方針: 静的レビュー / Context7 + WebSearch で裏取り / CLAUDE.md 6 原則 + DESIGN_DOC 7 原則を批評の基準軸として使用。
