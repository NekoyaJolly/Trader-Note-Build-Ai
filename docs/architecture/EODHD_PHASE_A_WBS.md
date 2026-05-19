---
document: phase-a-wbs
phase: A
author: tech-architect
created: 2026-05-19
status: APPROVED
---

# Phase A: EODHD Research APIs 統合 + Side-A RealtimeChart 切替

## 目的

1. `ResearchAIService` に EODHD の外部要因データ (News / Sentiment / Economic Events / Macro / Fundamentals) を配線
2. ResearchAgent の出力を新テーブル `ResearchOutput` に分離 (= LLM 出力永続化方針の最初の 1 agent 実装)
3. Side-A `RealtimeChart` の data source を cTrader → EODHD WebSocket に切替
4. cTrader Tick 系を削除し、`CTraderProvider` を発注/決済 only に縮小

## 前提

- EODHD All-In-One 契約済 ($99.99/月、2026-05-19 確定)
- 公式 npm `eodhd` SDK 採用 (Node.js 20+ 必須、Cloud Run は Node 22 想定 / A-0 で確認)
- `EODHD_API_KEY` / `EODHD_BASE_URL` は `.env.example` L106-115 に設定済 (commit 5669589)
- 既存テーブル: `MarketResearch` (`featureVector` JSON 列に `MarketAnalysis` を embed、Phase A で廃止予定)
- 関連 memory: [[project_llm_output_persistence_principle]] / [[project_agent_consolidation_plan]] / [[workflow_phase_pr]]

## 取得方針 (= 「外部要因ファンダメンタルズ」の定義)

Neko 解釈 (2026-05-19): **ファンダメンタルズは株式固有ではなく、シンボルに影響する外部要因全般を指す**。

- **取得対象シンボル**: そのリクエスト時点で要求されたシンボル**のみ** (ウォッチリスト全件先取りしない)
- **取れるものは全部取りに行く**:
  - Macro Indicators / Economic Events / News / Sentiment: 全シンボルで取得
  - Fundamentals: EODHD API 対応シンボル (`.US` / `.ETF` / `.INDX` 等) のみ実取得、FX / Crypto / Commodity は内部スキップ (= 呼び出しコードは一律、API レベルでスキップ判定)
- **API call コスト管理**: Fundamentals = 10 calls、Intraday / News / Technical = 5 calls、その他 = 1 call。All-In-One 上限は 100,000/日 + 1,000/分

## PR 構造 (3 PR、論理単位で分割)

### PR #1: 永続化リファクタ (schema 先行)

| ID | タスク | 成果物 |
|---|---|---|
| A-0 | 準備 | `npm install eodhd ws`、Cloud Run Node ランタイム確認 (22 想定)、`.env` 確認 |
| A-NEW1 | 新テーブル `ResearchOutput` 設計 | `prisma/schema.prisma` 追加、RLS 有効化 |
| A-NEW2 | マイグレーション作成 + Supabase 適用 | `prisma/migrations/*` |
| A-NEW3 | **既存 `MarketResearch` 実態調査 + 処遇決定** | 下記分岐 |
| A-NEW4 | `researchAIService` の出力先を新テーブルに切替 | service 層更新 |
| A-NEW5 | 既存テスト緑維持 | `researchAIService.test.ts` 等の追従 |

**A-NEW3 分岐ロジック**:
- `SELECT COUNT(*) FROM "MarketResearch"` でデータ件数確認
- 使用箇所を grep (frontend / backend / Side-B / Side-A) で全列挙
- 判定:
  - データ 0 件 + 参照経路撤去可能 → **drop migration で削除**
  - データあり or 参照経路あり → **Deprecated 残置** (読み取り経路撤去、書き込みは新テーブルへ。物理削除は Phase D 相当)
- **並行運用は不可** (Neko 判断、2026-05-19)
- 判定結果は PR #1 description に明記

### PR #2: EODHD Research APIs 配線

| ID | タスク | 成果物 |
|---|---|---|
| A-1 | シンボル正規化拡張 | `symbolNormalization.ts` に EODHD 形式 (`XAU/USD ↔ XAUUSD.FOREX` 等) + テスト |
| A-2 | EODHD Research クライアント新設 | `src/side-b/research/eodhdResearchClient.ts` (6 メソッド: News / Sentiment / EconomicEvents / MacroIndicator / Calendar / Fundamentals) |
| A-3 | Zod スキーマ追加 | `src/schemas/external/eodhd.ts` (boundary validation 用、SDK 型 → ドメイン型変換) |
| A-4 | `ResearchAIInput` 拡張 | optional フィールド 5 種追加 (`newsContext` / `sentimentContext` / `economicEvents` / `macroContext` / `fundamentalsContext`) |
| A-5 | プロンプト更新 | `prompts/researchAI/*.md` に外部要因セクション挿入、Fundamentals は API 対応シンボル時のみ条件付き |
| A-6 | aiOrchestrator 配線 | `runResearch` 経路に EODHD client 呼び出し、Fundamentals は対応シンボル判定で内部スキップ、EODHD 失敗時は OHLCV 経路だけ生存 |
| A-7 | キャッシュ戦略 | 既存 `expiresAt` 流用 (News=1h / Macro=24h / EconomicEvents=6h / Fundamentals=24h)。Redis 層追加は将来 |
| A-8 | テスト | SDK モックでユニット + 実 API 手動スモーク 1 本 |
| A-9 | 観測性 | API call cost (1/5/10 別カウンタ)、rate limit warn、cache hit rate ログ |
| A-10 | ドキュメント | `docs/architecture/EODHD_INTEGRATION.md` 新規、`.env.example` 完了マーカー更新 |

### PR #3: Side-A RealtimeChart 切替 + cTrader Tick 削除

| ID | タスク | 成果物 |
|---|---|---|
| A-12 | EODHD WebSocket Provider 新設 | `src/infrastructure/market/EodhdProvider.ts` (SDK の `client.websocket('forex', symbols)` ラップ、`IMarketDataProvider` 実装) |
| A-13 | Side-A `RealtimeChart` 切替 | `src/frontend/components/RealtimeChart.tsx` の data source を `CTraderProvider` → `EodhdProvider` に変更、**見た目据置** (内部 source のみ変更) |
| A-14 | cTrader Tick 系**削除** | `CTraderProvider` から Tick subscription メソッド + 接続管理を削除、Order 系のみ温存、ドキュメント (`docs/architecture/`) に「cTrader = 発注/決済 only」明記 |
| A-15 | E2E 動作確認 | dev サーバ起動、XAU/USD リアルタイム配信が EODHD 経由で chart に流れること、cTrader 接続が外れていること確認 |

## 範囲外 (別 phase)

- **Phase B**: OHLCV 履歴を Twelve Data → EODHD 切替
- **Phase C 残り**: US 株 / Crypto WebSocket、cTrader 完全撤去判断
- **Phase D**: Twelve Data 完全撤去 (`TwelveDataProvider` / `schemas/external/twelveData.ts` / `TWELVE_DATA_API_KEY` 削除)
- **他 4 agent の LLM 出力テーブル化**: IndicatorSpecialist / DebateApiLink / reflection / Discovery (= memory `project_agent_consolidation_plan` の残り)

## 工数見積

| PR | 見積 |
|---|---|
| PR #1 (永続化リファクタ) | 約 3 時間 |
| PR #2 (Research APIs 配線) | 約 9.5 時間 |
| PR #3 (Side-A 切替 + cTrader Tick 削除) | 約 3.5 時間 |
| **合計** | **約 16 時間 (3 セッション想定)** |

## 完了 DoD

1. `aiOrchestrator.generatePlan()` 実行時、EODHD 外部要因データ (News / Sentiment / EconomicEvents / Macro / Fundamentals) が `ResearchAIService` に渡る
2. EODHD 取得失敗時も既存 OHLCV ベース分析は劣化動作で生存
3. ResearchAgent の LLM 出力が新テーブル `ResearchOutput` に永続化される
4. 既存 `MarketResearch` テーブルは A-NEW3 判定に従い削除 or Deprecated 残置 (並行運用なし)
5. Side-A `RealtimeChart` が EODHD WebSocket 経由で配信される (ユーザ視点見た目据置)
6. `CTraderProvider` に Tick 系メソッドが残っていない (Order 系のみ)
7. API call cost / cache hit rate が log に出る
8. 全 PR merged、Copilot review 0 件残り (memory `workflow_pr_polling` 準拠)

## 着手手順 (次セッション)

1. `/clear` で context リセット
2. このファイル (`docs/architecture/EODHD_PHASE_A_WBS.md`) を読み込み
3. PR #1 (A-0 → A-NEW5) から着手
4. PR #1 merge 後、PR #2 → PR #3 と直列に進行

## 関連ドキュメント

- `.env.example` L106-128 (EODHD / Twelve Data 環境変数)
- `docs/architecture/LAST_MILE_INTEGRATION.md` (= 配置規約)
- `docs/architecture/DEBATE_ARENA_INTEGRATION_BRIEF.md` (= 同種の外部 API 統合ブリーフ、命名規約参考)
