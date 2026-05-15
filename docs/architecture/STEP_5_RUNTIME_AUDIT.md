# STEP 5 段階 2 運用動作完成: 不足ポイント集計 (Phase D 集約)

設計書 `docs/architecture/STEP_5_*.md` で定義された段階 2 (運用動作完成) の Phase A-F 検証で発見された不足ポイントを集約。修正済 / 中程度修正 / 設計判断要 / 未追跡 に分類して、後続タスクの優先順位を Nekoさん と合意する材料とする。

調査時点: 2026-05-15 / main HEAD: `1397d57` (PR #204 マージ後)

## 段階 2 完了判定

**核心条件**: 本番 Side-B が cron / 手動発火で Plan を fallback でなく **実 AI 出力** として生成できる状態。

✅ **達成** (2026-05-15T03:30Z 観察):
- `regime: "volatile"` (前: "range" fallback)
- `regimeConfidence: 0.76` (前: 0)
- `summary`: 実市場分析 ("下落基調だが4607支持を挟む圧縮帯。下抜けで再加速、上抜けは4623〜4630の戻り売り帯が壁。")
- `keyLevels`: 実数値 (support [4610, 4607.19], resistance [4617.9, 4623, 4652.1] 等)
- `scenarios`: 実シナリオ ("4607割れ追随売り" 等、戦略構造 entry/exit/risk 付き)
- `additionalInsights`: 実考察 (MTF 整合性、時間帯特性等)

## 検証結果サマリ (Phase A-F)

| Phase | 状態 | 主要発見 | 詳細リンク |
|---|---|---|---|
| A: Scheduler 稼働確認 | ✅ | 本番 `SIDE_B_SCHEDULER_ENABLED=true`、`isRunning:true`、cron 全部稼働中、Evolution Loop / Discovery 順調 | 本ドキュメント §A |
| B: E2E サイクル観察 | ✅ | cTrader 配線未実装 (root cause #1) + 全 AI 呼び出し maxTokens 不足 (root cause #2) を発見。PR #203 + #204 で解消、再観察で実 AI 出力確認 | 本ドキュメント §B |
| C-bis: エージェント ↔ UI マッピング | ✅ | 設計書原案の「?」マーク 6 箇所のうち 4 箇所が実体とズレ。実コードで確定 | `STEP_5_AGENT_UI_MAPPING.md` |
| C: 本番フロント UI 確認 | 🟡 (Nekoさん 操作待ち) | Vercel フロント `trader-note-build-ai.vercel.app` / Side-B 11 ページ全て 200 OK 確認、UI 表示は Nekoさん が確認 | 本ドキュメント §C |
| F: ADK 可視性検証 | ✅ | InMemoryTraceSink + PDCALoop dry-run + Lens ParallelAgent で trace event 取得、可視性十分と判定 | `STEP_5_OBSERVABILITY_AUDIT.md` |

## 不足ポイント分類

### [完了 - PR マージ済]

| PR | 内容 | main 取込 |
|---|---|---|
| #203 `fix(market-data)` | `MarketDataService.configureCTrader()` 自己配線 (遅延初期化、idempotent + Promise キャッシュ) | 8f3f1af |
| #204 `fix(ai-max-tokens)` | `AI_MAX_TOKENS` を 10 万ベースに引き上げ + ハードコード 7 ファイル集約。`gpt-5.4-mini` reasoning モデルで content:null になる問題解消。BullBearDebate の `unknown` を `JsonValue` 置換で本質修正 | 1397d57 |

### [中程度修正 - 別 KICKOFF / フォロー PR 候補]

| # | 項目 | 検出 Phase | 影響 |
|---|---|---|---|
| 1 | `POST /scheduler/run-daily-plan` の Unique constraint 衝突 (cron 先行で手動発火が `targetDate, symbol` 重複で弾かれる)。Plan upsert/skip ロジックの導入 | B 再観察 | 中 (運用観察で手動発火が常に失敗) |
| 2 | Devil's Advocate Agent が公開 API / UI 表示先を持たない (orchestrator 内部利用のみ) | C-bis | 中 (透明性、デバッグ性) |
| 3 | Skill 実行 event (`adk.skill.*`) の検証スクリプト追加 (Phase F では PDCALoop + Lens のみ) | F | 低 (ADK Step 1-2 既存実装の補完) |
| 4 | `AIProvider.chat` エラーメッセージに `finish_reason` / `completion_tokens` を含めるデバッグ強化 (本番観測時に空応答の原因種別を即時判定可能に) | E (PR #204 副次要望) | 低 (運用品質向上) |
| 5 | 他 service (`reflectionAIService` / `researchAIService` / `agentLoop` 等) の既存 `unknown` eslint-disable も `JsonValue` 置換に統一 (PR #200 で導入済の別箇所) | E (PR #204 副次) | 低 (一貫性、技術的負債解消) |

### [設計判断要 - 別 KICKOFF]

| # | 項目 | 検出 Phase | 影響 |
|---|---|---|---|
| 6 | `MarketDataService` のシングルトン化 / 起動時一括 configure (PR #203 では遅延初期化を採用、本格設計は別タスク) | B | 大 (callsite 6 箇所、影響範囲広い) |
| 7 | `aiTokenLimits` の model-aware 化 / `NON_REASONING` 階層追加 (PR #204 で reasoning モデル前提化を明示。非 reasoning モデル (gpt-4o の 16K 上限等) 切替時の cap が要) | E (PR #204 Copilot 指摘) | 中 (将来の model 切替時に重要) |
| 8 | `ReflectionAI` と `GenerationReflectionAgent` の役割重複 (両者とも learning 抽出を行う、明確な分担が不明) | C-bis | 中 (重複機能整理) |
| 9 | `/side-b/validation` の表示分割仕様 (Strategist Agent と Backtester Agent の結果) が UI 仕様で未定 | C-bis | 中 (UI 完成度) |
| 10 | OTel exporter / Jaeger / Cloud Trace 統合 (Phase F でステップ 2 土台確保済みだが未実装。段階 2 完了 + 短期運用観察開始までは InMemoryTraceSink で十分と判定) | F | 中 (長期運用観察に必要) |
| 11 | TPM (200K/min) 配分の見直し (HEAVY 100k で並列実行時の TPM 制限に当たる可能性、必要なら LIGHT 階層追加) | E (PR #204 副次) | 中 (本番運用安定性) |

### [未追跡 - 続調査]

| # | 項目 | 検出 Phase |
|---|---|---|
| 12 | Strategy Thinker の出力と AITradeNote の紐付け方法 (PlanAIService が AITradePlan に保存するのは確認、Note 経由結合の流れが曖昧) | C-bis |
| 13 | Devil's Advocate の orchestrator 呼出パス (orchestrator 内部利用のみ、誘発エンドポイントが要追跡) | C-bis |
| ~~14~~ | ~~Discovery AI 新仮説の `EdgeHypothesis` 自動登録経路~~ — `src/side-b/agents/DiscoveryAgent.ts:340-362` で `llmOutput.newHypotheses[]` を反復 → `this.ledger.create({..., source: 'discovery'})` で挿入していることを確認済 (PR #205 レビューで判明、本リストから除外) | C-bis |

## §A: Phase A 詳細 (Scheduler 稼働確認)

本番 `/api/side-b/scheduler/status` (2026-05-15T00:46Z 取得):

| 項目 | 値 |
|---|---|
| `isRunning` | `true` |
| `enabled` | `true` |
| `lastDailyPlanRun` | `2026-05-14T23:08:31Z` |
| `lastMonitorRun` | `2026-05-15T00:05:11Z` |
| `marketStatus.isOpen` | `true` (FX サマータイム開場中) |
| `evolutionGenerations` | `2` (観察フェーズ仕様反映済) |
| `errors` | `[]` |
| `summaryScheduler.isRunning` | `true` (weekly + monthly 両方有効) |

Cloud Run env: `SIDE_B_SCHEDULER_ENABLED=true`、`AUTO_EVOLUTION=true`、`EVOLUTION_GENERATIONS=2` 確認済。

**Phase A は本番では既にクリア済み** (設計書原案の「デフォルト無効」前提は開発環境向け)。

## §B: Phase B 詳細 (E2E サイクル観察 → root cause 修正 → 再観察)

### B-1: 初回観察 (PR #203/#204 マージ前)

✅ 動いているもの (市場データ非依存):
- SideBScheduler: cron 全部稼働中
- Evolution Loop: 4 regime × 2 generation = 8 件、`formalBtPassed=[3,3], validationConfirmed=[2,1]`
- Discovery AI: 週次エッジ分析実行中

❌ 動いていないもの (市場データ依存、全て連鎖):
- 直近 Plan は全て `aiModel:"fallback", tokenUsage:0, regimeConfidence:0`
- 直近 Trade は全て `status:"expired", actualEntry:null`
- MatchingService 15 分毎: 「XAU/USD の履歴データを取得できませんでした」
- `POST /scheduler/run-daily-plan`: `0/0 シンボル成功`
- `/api/market-analysis/XAUUSD`: 404 (OHLCV 0 件)

### B-2: root cause 特定

**Root cause #1 (cTrader 配線未実装)**:
- `MarketDataService` は callsite ごとに `new MarketDataService()` で個別 instance 化 (6 箇所)
- 本番起動経路に `configureCTrader(accountId, auth)` を呼ぶ初期化が存在しない
- `marketIngestService.ts:21` の `setTestCTraderConnection` はコメント明記の通り「テスト用、本番はアプリ起動時と同等の設定を行う」、その本番経路が未実装
- → `isCTraderAvailable()` が常に false → `getHistoricalData` が空配列 → 404 連鎖

**Root cause #2 (reasoning モデル + maxTokens 不足)**:
- 本番 `AI_MODEL_OVERRIDE_ALL=gpt-5.4-mini` (`aiProvider.ts:193` の `/^gpt-5/` 判定で reasoning モデル扱い)
- reasoning モデルは思考トークンが `max_completion_tokens` から差し引かれる
- 既存 hardcode 1500/2000/4096 では reasoning step に全部使われて `content: null` 返却 → 「AI APIからの応答が空です」全件エラー

### B-3: 修正 (PR #203 + #204)

#1 → PR #203: 遅延初期化 `ensureCTraderConfigured()` 追加、各 `getHistoricalData` 等で自己配線。
#2 → PR #204: `AI_MAX_TOKENS.HEAVY: 65536 → 100000`、`MEDIUM: 32768 → 50000`、ハードコード 7 ファイル集約。

### B-4: 再観察 (PR #203 + #204 デプロイ後、2026-05-15T03:30Z)

直近 cron 生成の Plan (`66137ed7-fc20-4c1d-8c46-510ce1e9dec5`、targetDate 2026-05-15):
- regime: `"volatile"`
- regimeConfidence: `0.76`
- summary: `"下落基調だが4607支持を挟む圧縮帯。下抜けで再加速、上抜けは4623〜4630の戻り売り帯が壁。"`
- keyLevels: support `[4610, 4607.19]`、resistance `[4617.9, 4623, 4652.1]`、strongSupport `[4607.19]`、strongResistance `[4630.5, 4663.2]`
- scenarios: 戦略構造付き ("4607割れ追随売り" 等)
- additionalInsights: 2 件 (MTF / 時間帯特性)

**段階 2 (運用動作完成) の核心条件達成**。

### B-5: 残課題 (Phase D 中程度修正 #1)

`POST /scheduler/run-daily-plan` の手動発火で `Unique constraint failed on (targetDate, symbol)`。cron が同日 Plan を先に作っていて、手動発火が重複で弾かれる。Plan upsert/skip ロジックを別 PR で対応 (フォロー PR 候補)。

## §C: Phase C 詳細 (本番フロント UI 通し動作確認)

**フロント配信元**: `https://trader-note-build-ai.vercel.app` (Vercel SSR、Cloud Run API とは別ホスティング)

curl で確認した到達性 (HTTP 200 OK):
- `/` (ルート)
- `/side-b/dashboard`
- (その他 Side-B ページ 11 個全て、`src/frontend/app/side-b/` 配下と一致)

### C-1: 実機確認結果 (Nekoさん 共有、2026-05-15)

#### ✅ OK 確認済み

- 台帳ダッシュボード (`/side-b/dashboard`) のボタン遷移先
- 仮説一覧 → 個別仮説詳細の遷移 (`/side-b/hypotheses` → `/side-b/hypotheses/[id]`)
- カード (クイックリンク) からの遷移

#### ❌ 大物課題 6 件

| # | 問題 | 重大度 | 検出ページ |
|---|---|---|---|
| C-1 | **仮説一覧が EUR/USD 15m 固定**。シンボル設定 (オプション部分) は `XAU/USD` に切り替えているのに、Discovery / 仮説の内容は全て EUR/USD 15m のもの。**シンボルハードコード疑い、要調査** | 大 | `/side-b/hypotheses` |
| C-2 | **検証パイプライン「検証待ち」が大量滞留**。「検証中」が少しある一方で「検証待ち」が圧倒的。似た戦略が重複大量発生 (重複検出/フィルタ不足の可能性) | 大 | `/side-b/validation` |
| C-3 | **ダッシュボードが 2 つ並立**: 「台帳ダッシュボード」(`/side-b/dashboard`) と「AI ダッシュボード (エージェント運転席)」(`/side-b/agent`) が両方存在し、ユーザーから見て紛らわしい | 大 UX | `/side-b/dashboard` + `/side-b/agent` |
| C-4 | **進化トラッキングに戦略の中身が見えない**。Run ID + 開始時刻 + 実行件数 (「これだけやりました」) のみで、肝心の「どういう戦略を実行したか」が表示されない。**信頼性ゼロ、現状の表示は無意味** | 大 | `/side-b/evolution` |
| C-5 | **AI ノート / 仮想トレード / 比較ダッシュボードの数字が全くバラバラ**。同じ概念の集計値が画面ごとに不一致 (データ整合性破綻) | 大 | `/side-b/ai-notes` + `/side-b/trades` + `/side-b/comparison` |
| C-6 | **思考ログの「信頼度 0.66%」誤表示**。0.66 (0-1 比率) を表示時に `%` 化、本来 66% 想定 | 小 (表示) | (思考ログ表示先) |

#### ⚠️ 中程度課題 4 件

| # | 問題 | 検出ページ |
|---|---|---|
| C-7 | 現状サマリーカード (総仮説 / コンプリート / 今週の新規仮説 / 直近検証成功率) が hover で action 起こるが click 遷移先なし。「サマリーをここに置くなら click → 遷移先を実装すべき」 | `/side-b/dashboard` |
| C-8 | サイドバーが選択時に閉じない。「現在位置」表示がデュアルで見えてしまう、UX として「選択 → 自動クローズ」が望ましい | 全ページ |
| C-9 | Side-A 側ページ内に Side-B ナビ (台帳/仮説検証運転席/進化/比較) が混入。Side-A ページには不要なので煩わしい | (Side-A ページ全般) |
| C-10 | 世代ごとの学び (lessons) がカード形式で全件並列表示、戦略の前提が前に出てこず読みにくい。後から学習に使うならまとめ表示の方が良い | `/side-b/evolution` 内? |

### C-2: 段階 2 完了判定の更新

§B 再観察で判定した「核心条件達成 (Plan が実 AI 出力)」は維持されるが、UI 表示・データ整合性レベルで段階 2 は **未達**。下流に正しく伝播していない or UI 集計ロジックが壊れている可能性が高い。Plan 出力の品質改善より前に、まずは「データが下流まで一貫しているか」のフロー再点検が必要。

C-1〜C-10 を以下のとおり分類して優先順位を Nekoさん と合意する:

| 分類 | 候補 | 推奨優先 |
|---|---|---|
| データバグ調査 (= 段階 2 完了の阻害要因) | C-1, C-2, C-5 | **最優先** |
| UX 整理 (= ユーザーが信頼できる UI を作るための再構成) | C-3, C-4, C-9, C-10 | 次点 |
| 個別バグ修正 | C-6 (表示), C-7 (リンク欠落), C-8 (サイドバー閉動作) | 段階 2 完了後 |

## 次ステップ

1. 本ドキュメントの追加 (§C-1, C-2) をマージ (現在の追記 PR)
2. C-1〜C-2, C-5 の **データバグ調査** を最優先で着手 (個別フォロー PR)
   - C-1: シンボルハードコード調査 (`src/side-b/agents/DiscoveryAgent.ts`、`HypothesisGeneratorAgent.ts`、Watchlist / Plan の symbol 伝播パス)
   - C-2: 検証パイプラインのキュー滞留原因調査 (`screeningJob`、`fullValidationJob`、重複検出ロジック)
   - C-5: AI ノート / 仮想トレード / 比較ダッシュボードの集計クエリパス調査 (どの数字を集計しているか実コードで確認)
3. C-3, C-4, C-9, C-10 の **UX 整理** は Nekoさん と設計合意後に着手 (別 KICKOFF)
4. C-6, C-7, C-8 の **個別バグ** は段階 2 完了後にまとめて修正 PR
5. 中程度修正 #2-5 / 設計判断要 #6-11 / 未追跡 #12-13 (前述、§§) は本フェーズ完了後の個別 KICKOFF

## 関連ファイル

- 設計正本: `docs/design/DESIGN_DOC_autonomous_trading_architecture.md`
- 段階 2 KICKOFF: 本検証セッションで Nekoさん が提示 (検証中に Nekoさん 側で HTML 形式の設計サマリ `side-b-architecture.html` を整備、git 管理外のため本リポジトリには未収録)
- マッピング表: `docs/architecture/STEP_5_AGENT_UI_MAPPING.md`
- 可視性検証: `docs/architecture/STEP_5_OBSERVABILITY_AUDIT.md`
- 検証スクリプト: `scripts/sideB_runtime_observability_smoke.ts`
- PR #203: https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/203 (cTrader 配線)
- PR #204: https://github.com/NekoyaJolly/Trader-Note-Build-Ai/pull/204 (maxTokens 10 万化)
