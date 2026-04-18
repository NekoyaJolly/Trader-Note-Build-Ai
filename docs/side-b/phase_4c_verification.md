# Phase 4c 動作確認ガイド & 完了報告

> **対象フェーズ**: Phase 4c (Side-B 本格検証パイプライン)
> **仕様書**: `docs/design/phase_4c_specification.md`
> **本ドキュメントの位置づけ**: Phase 4c 完了報告 (仕様書 §6) + 手動動作確認手順 + Phase 4d 引き継ぎメモ

---

## 1. 実装サマリー

Phase 4c は 2 層エージェント (Strategist + Backtester) + 検証ツール群 (Python Docker 経由の WalkForward / TS 自前の MonteCarlo / TS 自前の BuyAndHold) + スケジューラ統合 + 手動トリガー API まで完了。

### 1.1 Step 分割と commit 対応

| Step | commit | 内容 |
|------|--------|------|
| A | `fee574e` | ValidationTool 基盤 + MonteCarloTool + BuyAndHoldTool |
| B | `f026c91` | Python Docker 環境 + PythonBridge (stdin/stdout 経由ではなく共有ボリューム経由の JSON 受け渡し) |
| C | `4bf1c2a` | WalkForwardTool (Python 経由) |
| D | `6be5f95` | BacktesterAgent (3ツール並列実行) |
| E | `bf587ca` | StrategistAgent (判定 + LLM 解釈) |
| F | `e598b8c` | EdgeHypothesis に `fullValidationReport` 等の Phase 4c フィールド追加 + Prisma マイグレーション |
| G | `c704083` | 日次フル検証ジョブ + 手動トリガー API |
| - | `0934fd1` | fix: `gpt-4o` ゾンビフォールバック除去 (全 LLM 呼び出しを `config.ai.model` に統一) |

### 1.2 新規 / 改修ファイル一覧

**新規作成**

- エージェント: `src/side-b/agents/{StrategistAgent,BacktesterAgent}.ts`
- プロンプト: `src/side-b/prompts/strategist.md`
- ツール: `src/side-b/validation/tools/{types,WalkForwardTool,MonteCarloTool,BuyAndHoldTool,index}.ts`
- レポート型: `src/side-b/validation/reports.ts`
- Python ブリッジ: `src/side-b/validation/python_bridge/{PythonBridge,types,index}.ts`
- 閾値設定: `src/side-b/config/validationThresholds.ts`
- API: `src/side-b/routes/validationRoutes.ts`, `src/side-b/controllers/validationController.ts`
- Python: `python/{Dockerfile,docker-compose.yml,requirements.txt,ping.py,echo.py,README.md,.gitignore,shared/.gitkeep}`
- Python ロジック: `python/walk_forward/{__init__.py,walk_forward.py}`
- Python テスト: `python/tests/{__init__.py,test_walk_forward.py}`
- テスト: `src/side-b/tests/validation/*.test.ts`, `src/side-b/tests/agents/{strategistAgent,backtesterAgent,validationController}.test.ts`, `src/side-b/tests/ledger/statusManagerConfirmedFull.test.ts`, `src/side-b/tests/sideBScheduler.fullValidation.test.ts`

**改修**

- `src/side-b/models/edgeHypothesis.ts` — `fullValidationReport` / `confirmationInterpretation` / `rejectionInterpretation` / `actionableInsights` フィールドを全てオプショナルで追加 (破壊的変更なし)
- `src/side-b/ledger/{EdgeLedger,statusManager}.ts` — 新ステータス対応、`canPromoteToConfirmedFull` を Phase 4c 完全版に置換
- `src/side-b/jobs/sideBScheduler.ts` — `autoFullValidation` / `fullValidationMaxPerRun` 設定、起動時&24時間毎の `runFullValidationNow` 追加
- `src/side-b/routes/sideBRoutes.ts` — `/hypotheses` 配下に `validationRoutes` をマウント
- `prisma/schema.prisma` + `prisma/migrations/20260419000000_add_phase_4c_validation_report/` — `EdgeHypothesis` に Phase 4c フィールド追加
- 各 AI サービス (`aiNoteService`, `planAIService`, `researchAIService` 等) — `'gpt-4o'` ハードコードを `config.ai.model` に統一

---

## 2. Python ライブラリ選定

**採用: Python 標準ライブラリのみ (stdlib 完結)**。依存は `pytest` (テスト用途のみ)。

仕様書 §4.1 の候補 (vectorbt / backtrader / backtesting.py) を検討したが、本プロジェクトの Walk-Forward は「Side-A が確定させたトレードイベント列を時間軸で分割して IS/OOS 勝率・PF を比較する」だけで足り、OHLCV → シグナル → トレード生成のパイプラインは不要と判断した。

**選定理由**

- 真の Walk-Forward (各窓で最適化パラメーターを再学習) は本アーキテクチャでは不要。Side-B の仮説は固定条件・固定 SL/TP のため。
- stdlib 完結 → Docker イメージ軽量、numba/llvmlite の M1/M2 ビルド問題を完全回避
- コード規模最小 (`walk_forward.py` 約 240 行)、将来のメンテナンスコストが低い

**詳細根拠**: `python/README.md` §ライブラリ選定、`python/walk_forward/walk_forward.py` の docstring

---

## 3. Docker 起動手順

プロジェクトルートから:

```bash
# 起動 (初回はイメージビルドで 30-60 秒)
docker compose -f python/docker-compose.yml up -d

# コンテナ稼働確認
docker compose -f python/docker-compose.yml ps
# → side_b_python_validator  Up

# ヘルスチェック (PythonBridge が使うのと同じコマンド)
docker exec side_b_python_validator python /app/ping.py
# → {"status":"ok","pid":1,...}

# Round-trip 疎通 (shared ボリューム経由の JSON 受け渡し)
docker exec side_b_python_validator python /app/echo.py /app/shared/in.json /app/shared/out.json

# 停止
docker compose -f python/docker-compose.yml down
```

実統合テストは `RUN_PYTHON_INTEGRATION=1` を付けて実行:

```bash
RUN_PYTHON_INTEGRATION=1 npm test -- --testPathPattern=pythonBridge
```

通常 skip される 4 件が実行され、Docker コンテナ相手に実際の JSON 受け渡しとタイムアウト処理を検証する。

---

## 4. エンドツーエンドフロー

### 4.1 前提条件

1. Docker コンテナ `side_b_python_validator` が稼働中
2. 対象仮説が `status === 'screening_passed'` (Phase 4b で事前スクリーニング通過済み)
3. `hypothesis.materializedTradeNoteIds[0]` に Side-A の BacktestRun が紐付いた TradeNote ID がある

### 4.2 3 つの起動経路

**(A) 手動 API**

```
POST /api/side-b/hypotheses/:id/validate
→ 200 { success, verdict: 'confirmed'|'rejected'|'insufficient_data'|'not_testable',
         report: ConsolidatedValidationReport, interpretation, actionableInsights, ... }
```

**(B) スケジューラ自動実行**

`SideBScheduler` 起動時および 24 時間毎に、`screening_passed` 仮説を最大 `fullValidationMaxPerRun` 件 (既定 5) ピックして `strategistAgent.validate` を順次実行。各仮説間に 10 秒クールダウン (Python + LLM 保護)。

**(C) プログラムから直接**

```ts
import { strategistAgent } from 'src/side-b/agents/StrategistAgent';
const verdict = await strategistAgent.validate(hypothesisId);
```

### 4.3 内部フロー (StrategistAgent.validate)

```
1. EdgeLedger から仮説取得 (未発見は throw)
2. materializedTradeNoteIds[0] を取得
   → 無ければ markNotTestable → 'not_testable' を返して終了
3. status を 'testing' に遷移
4. BacktesterAgent.runFullValidation(hypothesis, tradeNoteId, period)
   ├─ WalkForwardTool.execute   (Python Docker)      ┐
   ├─ MonteCarloTool.execute    (TS 自前, 1000 sim)  ├─ Promise.allSettled で並列
   └─ BuyAndHoldTool.execute    (TS 自前)            ┘
   → ConsolidatedValidationReport
   (例外時は markNotTestable → 'not_testable' を返して終了)
5. StatusManager.canPromoteToConfirmedFull(hyp, report) → 決定論的判定
6. LLM 解釈 (任意 / 失敗しても判定は継続)
   → prompts/strategist.md + Gemini (config.ai.model)
7. EdgeLedger 更新: markConfirmedFull or markRejectedFull
8. PromotionVerdict を返す
```

### 4.4 ステータス遷移

```
 unverified
   │ Phase 4b 事前スクリーニング通過
   ▼
 screening_passed
   │ Phase 4c 検証開始
   ▼
 testing ──┬──────────┬──────────────┐
           ▼          ▼              ▼
       confirmed   rejected      not_testable
```

`'insufficient_data'` は型定義上存在するが、現状 StrategistAgent からは発行されない (EdgeLedger 側には該当 marker がある — 将来データ不足で保留する経路を足す余地)。

---

## 5. 各ツールの役割と期待出力

### 5.1 所要時間の目安

各ツールは `Promise.allSettled` で並列実行される。1 ツール失敗時も他ツールの結果は保持される (部分成功は `allPassed=false`)。

| ツール | 実装 | 概算所要 | 備考 |
|--------|------|---------|------|
| screening | (Phase 4b 流用) | - | `hypothesis.screeningResult` を参照するだけ |
| walkForward | Python Docker | 1〜3 秒 | `docker exec` 起動 + stdlib 計算。I/O 律速 |
| monteCarlo | TS native | 50〜200 ms | 既定 1000 リサンプリング |
| buyAndHold | TS native | <50 ms | 始値・終値比較のみ |
| **LLM 解釈** | Gemini | 2〜5 秒 | 判定後に走る。失敗しても verdict は確定 |

**合計**: 1 仮説あたり約 5〜10 秒 (LLM 込み)。日次 5 件で 30〜50 秒 + クールダウン 40 秒 = 約 90 秒。

### 5.2 判定閾値 (全て env で上書き可)

| ツール | 閾値 | env 名 |
|--------|------|---------|
| walkForward | `overfitScore < 0.3` | `WF_MAX_OVERFIT` |
| monteCarlo | `p5FinalPnl > 0` | `MC_P5_MIN_PNL` |
| buyAndHold | `outperformance > 0.005` (0.5%) | `BH_MIN_OUTPERFORMANCE` |
| 共通 | `tradeCount ≥ 20` | `MIN_TRADE_COUNT` |
| monteCarlo (sim 数) | 1000 回 | `MC_SIM_COUNT` |

`StatusManager.canPromoteToConfirmedFull` は上記**全て**通過 + screening 通過 の時だけ `confirmed` に昇格させる。

### 5.3 `ConsolidatedValidationReport` 出力形状

```jsonc
{
  "hypothesisId": "hyp_abc123",
  "periodUsed": { "start": "2025-04-18", "end": "2026-04-18" },
  "screening":   { "toolName": "screening_bt",  "passed": true,  "metrics": { "tradeCount": 42, "profitFactor": 1.8, ... } },
  "walkForward": { "toolName": "walk_forward",  "passed": true,  "metrics": { "overfitScore": 0.12, "avgInSampleWinRate": 0.58, "avgOutOfSamplePF": 1.52, ... } },
  "monteCarlo":  { "toolName": "monte_carlo",   "passed": true,  "metrics": { "p5FinalPnl": 120, "medianMaxDrawdown": -340, "simulationCount": 1000, ... } },
  "buyAndHold":  { "toolName": "buy_and_hold",  "passed": false, "metrics": { "outperformance": -0.003, "strategyReturn": 0.021, "buyAndHoldReturn": 0.024 } },
  "allPassed": false,
  "passedCount": 3,
  "totalCount": 4,
  "startedAt":   "2026-04-18T12:00:00.000Z",
  "completedAt": "2026-04-18T12:00:06.482Z",
  "totalDurationMs": 6482,
  "errors": []
}
```

### 5.4 昇格 / 棄却の典型パターン

実データでのE2Eは `screening_passed` な仮説を Phase 4b で育ててから実施する前提 (Phase 4d or 運用開始後)。コード経路としての典型パターン:

**昇格例 (`verdict='confirmed'`)**

- 4 ツール全 passed、`baseCriteriaReasons=[]`、`confirmationInterpretation` に LLM 生成の要約が入る

**棄却パターン別分類** (`baseCriteriaReasons` の文字列で識別可能、詳細は `src/side-b/ledger/statusManager.ts:199`)

- 過学習: `"過学習スコア超過: 0.420"` → walkForward 失敗
- 下側リスク大: `"MonteCarlo 下側5%PnL マイナス: -850.00"` → monteCarlo 失敗
- 市場追随のみ: `"BuyAndHold を上回れず: -0.30%"` → buyAndHold 失敗
- サンプル不足: `"トレード数不足: 12 < 20"` → 統計的有意性不足
- ツール未実行: `"WalkForward 未実施 or 実行失敗"` 等 (並列実行中の部分失敗)
- 検証不能: `verdict='not_testable'`, `baseCriteriaReasons=['TradeNote が未生成']`

---

## 6. テスト状況

```bash
npm test -- --testPathPattern=side-b --silent
```

結果 (本セッション確認時点):

```
Test Suites: 36 passed, 36 total
Tests:       4 skipped, 468 passed, 472 total
```

skip 4 件は `pythonBridge.test.ts` の実 Docker 統合テスト。`RUN_PYTHON_INTEGRATION=1` 付与で有効化 (要 Docker コンテナ稼働)。

---

## 7. LLM コスト概算

- **モデル**: `config.ai.model` = `gemini-3-flash-preview` (既定、env で差し替え可)
- **呼び出し箇所**: StrategistAgent.validate の結果解釈のみ (判定には使わない)
- **1 回の入出力**: 入力 ~2K token (仮説 + レポート + システムプロンプト)、出力 ~500 token
- **Gemini Flash 単価 (2026-04 時点の公称)**: 入力 $0.10/M token, 出力 $0.40/M token
- **1 仮説あたり**: ≒ 2K × $0.10/M + 0.5K × $0.40/M = $0.0002 + $0.0002 = **約 $0.0004**
- **日次 5 件 × 30 日**: 約 **$0.06/月**

スケジューラ上限を上げても LLM コストは誤差の範囲。実運用コストは Python Docker の CPU 時間 (ローカル運用なら無料) と Side-A API 呼び出しで決まる。

---

## 8. Phase 4d (UI) への引き継ぎメモ

### 8.1 UI が叩くべき API

| Method | Path | 用途 |
|--------|------|------|
| GET  | `/api/side-b/hypotheses/pending-validation` | 検証待ち一覧 (`screening_passed` 仮説) |
| POST | `/api/side-b/hypotheses/:id/validate` | 手動で本格検証を即時実行 (10〜30 秒ブロック) |
| GET  | `/api/side-b/hypotheses/:id/validation-status` | 現在のステータス + 既存レポートの取得 |

### 8.2 UI が受け取る型

- `ConsolidatedValidationReport`: `src/side-b/validation/reports.ts`
- `PromotionVerdict`: `src/side-b/agents/StrategistAgent.ts`
- `EdgeStatus`: `src/side-b/models/edgeHypothesis.ts` (8 状態)
- `ValidationToolResult`: `src/side-b/validation/tools/types.ts`

全て export 済み、TS 型を直接 import 可。

### 8.3 検証進行中の判別方法

**推奨: Polling**。`validation-status` エンドポイントを UI 側で 2〜3 秒間隔で叩く。

- `status === 'testing'` → 検証中 (進行バー表示)
- `status === 'confirmed' | 'rejected'` → 完了 (レポート表示)
- `status === 'not_testable' | 'insufficient_data'` → 実行不可 (理由表示)

WebSocket は Phase 4d 以降で必要になったら検討 (現状の検証は長くても 30 秒なので polling で十分)。

### 8.4 エラー表示用の情報

- 部分失敗: `report.errors: string[]` に `"<toolName>: <reason>"` 形式で格納
- 個別ツール失敗: `report.<toolName>` が `undefined` または `success: false`
- 全体失敗: HTTP 500 + `{ success: false, error: string }`

### 8.5 UI で表示すべき主要フィールド

- `verdict` (バッジ): confirmed=緑 / rejected=赤 / not_testable=グレー
- `baseCriteriaReasons` (棄却理由リスト): 棄却時は **必ず** 表示
- `interpretation` (LLM の自然文): あれば本文として、なければ非表示
- `actionableInsights` (改善提案の箇条書き): あれば表示
- 各ツールの `metrics`: 詳細ビューで展開表示 (過学習スコア、p5PnL 等)

### 8.6 UI 側で想定すべき制約

- `POST /validate` は **10〜30 秒かかる**。UI 側はローディング状態の表示必須 (ボタン押し直し防止)。
- 日次自動検証は最大 5 件/日。待ち行列表示 (`pending-validation`) で「検証待ち N 件」を示すと親切。
- 検証中 (`status === 'testing'`) に再度 validate を叩くと二重実行される可能性あり。UI 側でガードするか、バックエンド側で idempotent 化 (Phase 4d で要検討)。

---

## 9. 残作業・既知の未整備

- **E2E 実データ走行**: `screening_passed` 仮説の実生成と `confirmed` 昇格の実例収集は、Phase 4b のスクリーニング運用が回ってから行う (Phase 4d と並行 or 運用開始後)。
- **二重実行ガード**: `testing` 状態中に `/validate` が再度叩かれた場合の idempotent 化は未実装。
- **Python コンテナの本番デプロイ**: ローカル Docker で動作完結 (仕様書 §5.2 の通り)。Fly.io / Railway / GCP Cloud Run Job 等へのデプロイは Phase 4c 対象外。

---

## 10. 自己チェックリスト (CLAUDE.md 完了時チェック対応)

- [x] 指定されたフェーズの完了条件 (仕様書 §2 の 14 項目) を全て満たしている
- [x] 既存テスト全通過 (468 passed / 4 skipped)
- [x] 新規ロジックにユニットテストあり (validation/*, agents/strategistAgent, agents/backtesterAgent, 他)
- [x] 既存データ構造への破壊的変更なし (EdgeHypothesis の新フィールドは全てオプショナル)
- [x] StrategistAgent のシステムプロンプトが外部ファイル化済み (`src/side-b/prompts/strategist.md`)
- [x] 設計書の禁止事項に抵触なし (LLM は判定に関与しない / 決定論的ロジックで昇格判定)
- [x] ログ・ドキュメントを日本語で記述
