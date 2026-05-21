---
document: eodhd-integration
phase: A
created: 2026-05-21
status: PR #2 完了時点
---

# EODHD 統合仕様 (Phase A PR #2)

## 概要

EODHD All-In-One プラン ($99.99/月) を採用し、ResearchAgent (researchAIService) に
外部要因データ (News / Sentiment / Economic Events / Macro / Fundamentals) を配線した。

## API トークン

- **環境変数**: `EODHD_API_KEY` (= EODHD ダッシュボードで取得)
- **共通**: 1 トークンで全 API + WebSocket にアクセス可能
- **`.env.example`**: L113-115 に空欄テンプレートあり

```env
EODHD_API_KEY=<取得したトークン>
EODHD_BASE_URL=https://eodhd.com/api
```

## All-In-One プランの API カバレッジ

| カテゴリ | API | All-In-One 対応 | Phase A での利用 |
|---|---|:-:|---|
| ヒストリカル | EOD Historical (日足) | ◎ | 利用なし (Phase B で OHLCV 切替時に検討) |
| ヒストリカル | Intraday Historical (分足) | **✗** (別プラン) | — |
| リアルタイム | WebSocket (forex/us/crypto) | ◎ (call cost 0) | PR #3 で Side-A RealtimeChart 切替 |
| ファンダ | Fundamentals | ◎ | A-6 で配線 (US/ETF/INDX のみ) |
| マクロ | MacroIndicator | ◎ | A-6 で配線 |
| マクロ | EconomicEvents | ◎ | A-6 で配線 |
| ニュース | News | ◎ | A-6 で配線 |
| ニュース | Sentiment | ◎ | A-6 で配線 |
| カレンダー | Calendar (earnings/ipos/splits/dividends) | ◎ | 配線済 (現状未使用、将来拡張点) |
| その他 | Technical Indicators | ✗ | — |
| その他 | US Tick Data | ✗ | — |

## API Call Cost (Phase A 観測値)

| API | Cost / request |
|---|:-:|
| News | 5 + 5/ticker |
| Sentiment | 1 |
| EconomicEvents | 1 |
| MacroIndicator | 1 |
| Fundamentals | 10 |
| WebSocket (real-time) | 0 (call consumption なし) |

**1 Research 生成あたり最大 = 18 calls** (FX シンボル時は Fundamentals スキップで 8 calls)

**プラン上限**:
- 100,000 calls / 日
- 1,000 calls / 分

**現状想定負荷**: 18 calls × 100 シンボル × 6 回/日 = 約 10,800 calls/日 (= 上限の 11%)

## アーキテクチャ

```
aiOrchestrator.generateResearch()
  ├─ researchOutputRepo.findValidBySymbol(symbol)  // キャッシュ確認 (TTL = 4h)
  ├─ ※ キャッシュミス時のみ以下を実行:
  ├─ fetchEodhdContextsForResearch(symbol)  // 5 種を並列取得
  │   ├─ fetchNews              → toNewsContext
  │   ├─ fetchSentiments        → toSentimentContext
  │   ├─ fetchEconomicEvents    → toEconomicEventsContext
  │   ├─ fetchMacroIndicator    → toMacroContext  (国を symbol から推定)
  │   └─ fetchFundamentals      → toFundamentalsContext  (株式系のみ、FX はスキップ)
  ├─ researchAI.generateResearch({ ohlcv + indicators + 5 context })
  └─ researchOutputRepo.create({ marketAnalysis + 5 context を snapshot 保存 })
```

### ファイル構成

| 層 | ファイル | 役割 |
|---|---|---|
| SDK ラッパー | `src/side-b/research/eodhdResearchClient.ts` | 6 メソッドの薄いラッパー (News / Sentiment / Events / Macro / Calendar / Fundamentals) |
| Orchestration | `src/side-b/research/eodhdContextFetcher.ts` | 5 種を並列取得 + 国推定 + graceful degradation |
| Zod schema | `src/schemas/external/eodhd.ts` | SDK 型 → AI 用ドメイン型変換 + Zod 検証 |
| 入力型拡張 | `src/side-b/services/researchAIService.ts` | `ResearchAIInput` に 5 optional フィールド + プロンプト埋め込み |
| 配線 | `src/side-b/orchestrator/aiOrchestrator.ts` | EODHD 取得 → AI 入力に詰める |
| 永続化 | `src/side-b/repositories/researchOutputRepository.ts` | `ResearchOutput.{news,sentiment,...}Context` JSON 列 |
| 正規化 | `src/utils/symbolNormalization.ts` | EODHD 形式 (XAUUSD.FOREX 等) + Fundamentals 対応判定 |

## エラーハンドリング方針

- **EODHD 取得失敗**: graceful degradation (各 context = undefined)
- **API キー未設定**: 全 context をスキップ (1 API call も発生させない)
- **Fundamentals 非対応シンボル** (FX/Crypto/Commodity): API call せず内部 skip
- **Research 生成自体**: EODHD 失敗時も OHLCV ベース分析は劣化動作で生存

## キャッシュ戦略

ResearchOutput の `expiresAt` (= デフォルト 4h) を流用。各 context の細粒度 TTL
(News=1h / Macro=24h 等) は将来の Redis 層追加時に再検討 (Phase E 相当)。

## 観測性 (A-9)

`fetchEodhdContextsForResearch` 内で API call cost を集計してログ出力:

```
[EODHD] Research context 取得: total=18 calls (news=5, sentiment=1, events=1, macro=1, fundamentals=10)
```

Rate limit warn / cache hit rate は Phase E (運用フェーズ) で本格化。

## Phase A PR #3 完了内容 (2026-05-21)

### A-12 EodhdProvider 新設

`src/infrastructure/market/EodhdProvider.ts`:
- `IMarketDataProvider` を実装、`name: 'eodhd'`
- EODHD SDK の `client.websocket('forex', symbols)` をラップ
- forex feed: `WebSocketTick.p` (last price) を `bid/ask/mid` 同値で正規化、`spread=0`
- 状態遷移は `BaseMarketDataProvider.setConnectionState()` 経由

### A-13 Side-A RealtimeChart の data source 切替

`src/backend/services/realtime/eodhdRealtimeOrchestrator.ts` 新設、
旧 `CTraderRealtimeOrchestrator` と同一 API surface (events: `tick`/`bar`/`pendingBar`/`statusChange`)。
`realtimeRoutes.ts` の `getOrchestrator()` を新 orchestrator に差し替え。
**フロントエンド側 (`RealtimeChart.tsx`) の変更不要** — 同じ `/api/realtime/*` エンドポイントを叩くため。

### A-14 cTrader Tick 系削除 + Provider 縮小

- `ctraderRealtimeOrchestrator.ts` 削除 (872 行)
- `CTraderProvider.subscribeToTicks()` を deprecate + 例外化
- `CTraderProvider.unsubscribeFromTicks()` を no-op 化
- → `CTraderProvider` は **発注/決済 + 過去 OHLCV/Spread 取得** に縮小 (Phase B でさらに OHLCV/Spread も EODHD 化予定)

## A-15 E2E 動作確認手順 (Nekoさん 実行)

EODHD_API_KEY を `.env` に設定後、以下を実行:

```bash
# 1. dev サーバ起動
npm run dev

# 2. ブラウザで Side-A RealtimeChart を開く
open http://localhost:3000/  # ログイン後 RealtimeChart にアクセス

# 3. 確認ポイント
# (a) XAU/USD など FX シンボルでローソク足が更新される
# (b) 接続状態インジケーターが "connected"
# (c) サーバログに以下が出る (cTrader → EODHD に切替済を確認)
#     [EodhdProvider] connecting
#     [EodhdRealtimeOrchestrator] subscribed: XAU/USD
# (d) cTrader 関連ログが出ない (cTraderRealtimeOrchestrator の起動ログがない)
```

## 範囲外 (後続フェーズ)

- **Phase B**: OHLCV 履歴を Twelve Data → EODHD 切替 (= **Intraday は別プラン契約が必要**、All-In-One では取得不可)
- **Phase C**: US 株 / Crypto WebSocket 拡張、cTrader 完全撤去判断 (Order 系統も最終的に FIX API 等に移行検討)
- **Phase D**: Twelve Data 完全撤去 (Phase B 完了後)

## A-8 手動スモークテスト (Nekoさん 実行)

API キー設定後に 1 度だけ実行:

```bash
# 1. .env に EODHD_API_KEY を設定
# 2. dev サーバ起動
npm run dev

# 3. Research 生成 API を叩く (XAUUSD で 1 件)
curl -X POST http://localhost:3100/api/side-b/research \
  -H "Content-Type: application/json" \
  -d '{"symbol":"XAUUSD","timeframe":"15m","ohlcvData":[...]}'

# 4. ログで以下を確認
# - [EODHD] Research context 取得: total=8 calls (FX なので Fundamentals スキップ)
# - ResearchOutput の newsContext / sentimentContext / economicEvents / macroContext が埋まる
# - fundamentalsContext は undefined または available=false
```

## 関連ドキュメント

- `docs/architecture/EODHD_PHASE_A_WBS.md` (上位 WBS)
- `.env.example` L106-128 (環境変数)
- 公式: https://eodhd.com/financial-apis/
- 公式 Claude Skill: https://github.com/EodHistoricalData/eodhd-claude-skills
