# Phase X (即時BT層) 設計のための実態調査

> 調査日: 2026-04-24
> 目的: Phase 4c 既存 4 ツールの実装実態把握、即時 BT 層新設の方針判断材料
> 調査範囲: `src/` 配下 + `python/` + `analysis-engine/`(テスト系は除外)

---

## TL;DR

1. **Phase 4c の 4 ツールは 3 ツールのみ実装され、そのうち WalkForward だけが Python(stdlib 完結、vectorbt **不使用**)、MonteCarlo / BuyAndHold は TypeScript 自前実装**。Screening は別層(`ScreeningOrchestrator`、Side-A `BacktestService` ラッパー)
2. **全ツールは `EdgeHypothesis` + `backtestRunId` 前提**。Side-A `BacktestService.execute()` が返す **runId + 記録済みイベント列** を再利用する構造で、**戦略 DSL をそのまま受け付ける口はない**
3. **OHLCV は単一モデル `OHLCVCandle`**(Prisma:324)に保存。**休場日判定は保存側に存在せず、`isFXMarketOpen` は *スケジューラとジョブ起動のガード* にのみ使われている**。つまり「土日を含む時間帯に API が 0 本や 59 本を返したらそのまま DB に入る」構造
4. **Python は 2 系統ある**: `python/walk_forward/`(WalkForwardTool からのワンショット実行、stdlib のみ)と `analysis-engine/app/`(常駐 FastAPI、pandas/pandas-ta 使用、Node から `OHLCVCandle` を通しで指標計算)。後者は **WalkForward 系とは独立** で、インジケーター計算専用
5. **戦略 DSL 用の BT は `DSLBacktestAdapter`(Phase 5A、`src/side-b/strategy_dsl/`)がすでに存在**。ただしこれは進化ループ内の TS シミュレーション(vectorbt 無し、軽量)であり、**Phase 4c の精密検証とは別経路**。**即時 BT 層を作るならこの DSLBacktestAdapter を骨格にするのが筋**

---

## Phase 4c 4ツールの実装実態

| ツール | 実装言語 | ファイル | 入力型 | 出力型 | 依存ライブラリ | 仮説評価用/戦略BT用 |
|---|---|---|---|---|---|---|
| **Screening** | TypeScript | `src/side-b/bridge/ScreeningOrchestrator.ts` (216 行) | `ScreeningOrchestratorOptions`(`lensSnapshot?` / `period?` / `matchThreshold?` / `force?`)+ Side-A `BacktestService` 経由 | `ScreeningRunResult`(union: `screening_passed` / `rejected` / `not_testable`) | Side-A `BacktestService`, `MaterializationService`, `StatusManager` | **仮説評価用のみ**(Side-A Note ベース) |
| **WalkForward** | **Python (stdlib only)** + TS ラッパー | TS: `src/side-b/validation/tools/WalkForwardTool.ts` (213 行)、Py: `python/walk_forward/walk_forward.py` (237 行) | `ValidationToolInput`(hypothesis / backtestRunId / period / additionalParams) | `ValidationToolResult`(`metrics: { overfitScore, avgInSample/OOS WinRate, inSample/OOS PF, splitCount, tradeCount, windowsEvaluated }`) | Python: stdlib のみ(**vectorbt 不使用**) / TS: `PythonBridge`, Side-A `BacktestService` | **仮説評価用のみ** |
| **MonteCarlo** | **TypeScript (native)** | `src/side-b/validation/tools/MonteCarloTool.ts` (200 行) | `ValidationToolInput` | `ValidationToolResult`(`metrics: { p5/median/p95 FinalPnl, median/p95 MaxDrawdown, simulationCount, tradeCount }`) | Side-A `BacktestService`(PnL 列取得のみ) | **仮説評価用のみ** |
| **BuyAndHold** | **TypeScript (native)** | `src/side-b/validation/tools/BuyAndHoldTool.ts` (174 行) | `ValidationToolInput` | `ValidationToolResult`(`metrics: { buyAndHoldReturn, strategyReturn, outperformance, startClose, endClose, tradeCount, periodDays, comparisonDirection }`) | `OHLCVRepository`(`OHLCVCandle` 読み)、Side-A `BacktestService` | **仮説評価用のみ** |

### 共通入出力型(`src/side-b/validation/tools/types.ts`)

```typescript
export interface ValidationToolInput {
    hypothesis: EdgeHypothesis;       // 検証対象の仮説
    tradeNoteId: string;              // Phase 4b で materialize された Side-A TradeNote ID
    period: { start: string; end: string };
    backtestRunId?: string;           // Phase 4b で走った Side-A BacktestRun ID(必須に近い)
    additionalParams?: Record<string, unknown>;
}

export interface ValidationToolResult {
    toolName: string;
    success: boolean;                 // ツール自体が最後まで動いたか
    passed: boolean;                  // このツール単独の判定
    metrics: Record<string, number | string | boolean>;
    interpretation?: string;
    error?: string;
    durationMs: number;
}

export type ValidationToolImplementation = 'native_ts' | 'python_bridge';

export interface ValidationTool {
    readonly name: string;
    readonly implementation: ValidationToolImplementation;
    readonly requiredInputs: (keyof ValidationToolInput)[];
    execute(input: ValidationToolInput): Promise<ValidationToolResult>;
    isAvailable(): Promise<boolean>;
}
```

### 各ツールの仮説評価における呼び出し経路

```
StrategistAgent.validate(hypothesis)                          ← 上位 LLM(解釈のみ)
        │
        ▼
BacktesterAgent.run(hypothesis, screeningResult)              ← 並列オーケストレーター(TS, LLM不使用)
        │ Promise.allSettled
        ├──► WalkForwardTool.execute({ hypothesis, backtestRunId, period })
        │       └──► backtestService.getResult(runId) → events[] → Python bridge
        ├──► MonteCarloTool.execute({ hypothesis, backtestRunId })
        │       └──► backtestService.getResult(runId) → pnls[] → TS ランダムリサンプル
        └──► BuyAndHoldTool.execute({ hypothesis, backtestRunId, period })
                └──► backtestService.getResult(runId) + ohlcvRepository.findMany(...)
```

**重要**: 3 ツールとも `backtestRunId` を入り口としており、**Phase 4b Screening で走らせた Side-A BT の結果を流用**。新規に BT を回しなおす設計ではない。

### 戦略単位 BT への転用時のボトルネック

| 観点 | 現状の縛り | 戦略 BT 流用時の問題 |
|---|---|---|
| 入力スキーマ | `hypothesis: EdgeHypothesis`(人間可読 statement + MachineReadableCondition[] + symbols / timeframes) | **戦略 DSL(`StrategyDSL`、Phase 5A)は全く別の型**。EdgeHypothesis に押し込むと DSL の豊富な表現(entry/exit ConditionGroup、parameters スイープ)が落ちる |
| BT 実行主体 | Side-A `BacktestService.execute()` + `TradeNote` / `NoteEvaluator` 経由 | **Side-A は Note に紐付く設計**、戦略 DSL を `createNoteEvaluator` で受けるには DSL → Note 変換が必要(Phase 5B 用に `dslEdgeMapper.ts` が残置されているが活用停止中) |
| runId の必要性 | 3 ツールとも `backtestRunId` 必須、そこから `backtestService.getResult(runId)` で events/pnls を取る | **戦略の BT を Side-A 経由で走らせる前提**。戦略 DSL を TS の `DSLBacktestAdapter` で高速シミュレーションしても runId が発行されないため、現行 3 ツールには食わせられない |
| OHLCV 依存 | BuyAndHoldTool のみ `OHLCVRepository` 直接参照、他は events/pnls 経由で OHLCV を触らない | **戦略 BT で価格ベースの検証をやるなら OHLCV をツール側が直接読む必要がある**(現状その設計は BuyAndHold 相当のみ) |

結論: **4 ツールは「仮説の単発検証」専用、戦略単位 BT には内部改修なしでは転用不能**。改修するなら `ValidationToolInput` の union 化(`{ kind: 'hypothesis', ... } | { kind: 'strategy_dsl', ... }`)と各ツール内部の分岐追加、もしくは新規 `StrategyBacktesterAgent` の構築が必要。

---

## OHLCV データの現状

### 保存場所

- **メイン**: `prisma.OHLCVCandle`(`prisma/schema.prisma:324-350`)
- **補助**:
  - `prisma.TickData`(`:1429-1452`) — Tick レベル、cTrader/シミュレーション
  - `prisma.RealtimeOHLCV`(`:1456-1481`) — Tick から集約した短期足(1s〜1m 等)、**RollingWindowService** で生成

### `OHLCVCandle` スキーマ(抜粋)

```prisma
model OHLCVCandle {
  id        String   @id @default(uuid()) @db.Uuid
  /// 銘柄シンボル（例: BTCUSD, EURUSD）
  symbol    String
  /// 時間足（例: 1m, 5m, 15m, 1h, 4h, 1d）
  timeframe String
  /// ローソク足開始時刻（UTC）
  timestamp DateTime @db.Timestamptz(6)
  /// 始値
  open      Decimal  @db.Decimal(18, 8)
  high      Decimal  @db.Decimal(18, 8)
  low       Decimal  @db.Decimal(18, 8)
  close     Decimal  @db.Decimal(18, 8)
  volume    Decimal  @db.Decimal(18, 8)
  /// データソース（例: twelvedata, binance）
  source    String?
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  @@unique([symbol, timeframe, timestamp], map: "uq_ohlcv_symbol_timeframe_timestamp")
  @@index([symbol, timeframe, timestamp], map: "idx_ohlcv_symbol_timeframe_timestamp")
  @@index([symbol, timestamp], map: "idx_ohlcv_symbol_timestamp")
}
```

### 取得経路

- **主経路**: `src/services/marketDataService.ts::MarketDataService.getHistoricalData(symbol, timeframe, limit)`
  - cTrader 優先(認証済みなら) → Twelve Data フォールバック
  - Node 側実装、Prisma `OHLCVCandle` への書き込みは `ohlcvRepository.bulkInsert` 経由
- **常駐 Python 経路(別件)**: `analysis-engine/app/main.py::/v1/indicator-series`
  - `OHLCVCandle` テーブルを **読み取り専用** で直接 SQL 参照し、**指標系列(SMA/RSI/MACD/BB/candle pattern)のみ返す**
  - pandas + pandas-ta 使用、BT には関与しない
- **書き込みタイミング**:
  - `sideBScheduler.executePlanJob` 内で毎時 OHLCV 取得後に `ohlcvRepository.bulkInsert`(`src/side-b/jobs/sideBScheduler.ts:1243, 1290`)
  - `skipDuplicates: true` で重複排除

### 銘柄・時間足の選択方式

- `SideBSchedulerConfig.symbols`(既定 `['XAU/USD']`)+ `timeframe`(既定 `15m`)+ `higherTimeframe`(既定 `4h`)
- 本番の実際の設定も同じ `["XAU/USD"]`(調査済み、2026-04-23 の UI レスポンスより)

### 休場日バグの具体的場所

- **保存側には休場日フィルタが存在しない**
  - `ohlcvRepository.bulkInsert`(`src/backend/repositories/ohlcvRepository.ts:93-143`)には曜日や市場開場チェックが一切ない
  - `sideBScheduler.executePlanJob` で OHLCV を DB に入れる箇所(`:1243`)も、日時フィルタや `isFXMarketOpen` ガードなし
  - `MarketDataService.getHistoricalData`(`src/services/marketDataService.ts`、冒頭は既読)も内部で休場日を弾いていない
- **`isFXMarketOpen` は *ジョブ起動ガード* のみで使用**
  - `jobs/sideBScheduler.ts:915`(executePlanJob 冒頭の条件分岐)
  - `jobs/sideBScheduler.ts:950`(executeMonitorJob 冒頭の条件分岐)
  - `agent/pdcaLoop.ts:168`
  - **書き込み経路自体には無い**
- **現状の挙動**(推定、コード上の根拠):
  - 市場閉場中にジョブが起動すれば、起動直後の `isFXMarketOpen` で早期 return するため書き込まれない
  - しかし **一度ジョブが起動した後に API が 59 本返した** ような場合、その 59 本の中に土日時刻のバーが混ざっていても `bulkInsert` で無条件に保存される(cTrader/Twelve Data 側が休場バーを返すかどうかに依存)
  - 実際に Cloud Run ログで `cTraderData 59本のOHLCVを取得: XAU/USD 1m` が繰り返し見えており、**API 返却の信頼性に完全依存している状態**
- **期待される挙動**(既存設計を壊さない最小修正):
  - `ohlcvRepository.bulkInsert` 内で `isFXMarketOpen(data.timestamp)` 等を使って休場日バーをフィルタ
  - もしくは取得直後(scheduler の `bulkInsert` 呼び出し前)でフィルタ

### 休場日の「flag で区別」案は未実装

- スキーマに `isMarketOpen` / `isTradingDay` 相当のカラムは **存在しない**
- 保存時点で弾くか、クエリ時に timestamp 条件でフィルタするかのいずれかを新設する必要

---

## Prisma スキーマ(OHLCV 関連、そのまま引用)

```prisma
model OHLCVCandle {
  id        String   @id @default(uuid()) @db.Uuid
  /// 銘柄シンボル（例: BTCUSD, EURUSD）
  symbol    String
  /// 時間足（例: 1m, 5m, 15m, 1h, 4h, 1d）
  timeframe String
  /// ローソク足開始時刻（UTC）
  timestamp DateTime @db.Timestamptz(6)
  /// 始値
  open      Decimal  @db.Decimal(18, 8)
  /// 高値
  high      Decimal  @db.Decimal(18, 8)
  /// 安値
  low       Decimal  @db.Decimal(18, 8)
  /// 終値
  close     Decimal  @db.Decimal(18, 8)
  /// 出来高
  volume    Decimal  @db.Decimal(18, 8)
  /// データソース（例: twelvedata, binance）
  source    String?
  /// 作成日時
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  @@unique([symbol, timeframe, timestamp], map: "uq_ohlcv_symbol_timeframe_timestamp")
  @@index([symbol, timeframe, timestamp], map: "idx_ohlcv_symbol_timeframe_timestamp")
  @@index([symbol, timestamp], map: "idx_ohlcv_symbol_timestamp")
}

model TickData {
  id        String   @id @default(uuid()) @db.Uuid
  symbol    String
  timestamp DateTime @db.Timestamptz(6)
  bid       Decimal  @db.Decimal(18, 8)
  ask       Decimal  @db.Decimal(18, 8)
  mid       Decimal  @db.Decimal(18, 8)
  spread    Decimal  @db.Decimal(18, 8)
  volume    Decimal? @db.Decimal(18, 8)
  source    String   @default("ctrader")
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  @@index([symbol, timestamp], map: "idx_tick_symbol_timestamp")
  @@index([timestamp], map: "idx_tick_timestamp")
}

model RealtimeOHLCV {
  id        String   @id @default(uuid()) @db.Uuid
  symbol    String
  timeframe String    // (1s, 5s, 10s, 30s, 1m 等)
  timestamp DateTime @db.Timestamptz(6)
  open      Decimal  @db.Decimal(18, 8)
  high      Decimal  @db.Decimal(18, 8)
  low       Decimal  @db.Decimal(18, 8)
  close     Decimal  @db.Decimal(18, 8)
  volume    Decimal  @db.Decimal(18, 8)
  tickCount Int      @default(0)
  createdAt DateTime @default(now()) @db.Timestamptz(6)

  @@unique([symbol, timeframe, timestamp], map: "uq_realtime_ohlcv")
  @@index([symbol, timeframe, timestamp], map: "idx_realtime_ohlcv_symbol_tf_ts")
}
```

---

## 調査中に見つかった気になる点

### 1. 戦略 DSL 用の BT は既に存在する(`DSLBacktestAdapter`)

- `src/side-b/strategy_dsl/DSLBacktestAdapter.ts`(Phase 5A 成果物、進化ループ内部で使用)
- OHLCV を直接受け取って DSL を評価 → 学習 70% / 検証 30% 分割 + パラメータスイープまで内蔵
- **軽量 TS シミュレーション**、vectorbt 相当は使っていない
- これは Phase 4c の 3 ツールとは **独立した BT 経路**
- Phase X(即時 BT 層)を新設する場合、DSLBacktestAdapter を **再利用しつつ ValidationTool インターフェースにラップする** のが最小工数

### 2. Python は 2 系統ある、混同しないこと

- **系統 A**: `python/walk_forward/walk_forward.py` — WalkForwardTool 専用のワンショット CLI、**stdlib のみ**、docker でスクリプト実行
- **系統 B**: `analysis-engine/app/main.py` — 常駐 FastAPI、pandas + pandas-ta、`OHLCVCandle` を読み取って **指標系列のみ** 返す(`/v1/indicator-series`)、BT には関与しない
- `Dockerfile` が 2 つ、`docker-compose.yml` が 2 つ存在(`python/` と `analysis-engine/`)。運用上は別コンテナ

### 3. 別の MonteCarlo 実装が存在する

- `src/services/backtest/monteCarloService.ts` が **Side-A 寄り**で別に存在(OHLCVRepository + backtestCalculations + 全く別の入出力)
- Phase 4c の `validation/tools/MonteCarloTool.ts` とは別物
- 仮説評価用 = Phase 4c 版、Side-A ユーザー向けバックテスト UI 用 = services 版、という **2 系統の並存**
- 将来「戦略 BT」を作るとき、どちらにも寄せず新規実装するか、どちらかを拡張するかの判断が必要

### 4. `services/backtestService.ts` は重厚、責務広すぎ

- `BacktestService.execute()` は 127 行目、`getResult()` は 517 行目 → クラス全体でおよそ 580 行
- **ノート取得 → evaluator 生成 → OHLCV 取得 → エントリー/エグジット判定 → 結果集計 → 永続化** を全部抱えている
- Phase 4c 3 ツールが全部これに依存している = **ここを触るのは高リスク**。Phase X 新規実装で逃げる設計の方が安全

### 5. 経済指標カレンダー / スプレッド情報は未実装

- DB にそれらしいテーブルなし(TickData から spread は取れるが、ヒストリカルなカレンダーイベント・指標発表時刻はない)
- FX 精密 BT には本来必要な情報群が揃っていない
- Phase X で「精密 BT」を目指すならここが別途ブロッカー

### 6. 休場日バグは書き込み側 + クエリ側の両方に影響する

- 書き込み: 土日バーがそのまま混入し得る(§ OHLCV データの現状 参照)
- クエリ: `ohlcvRepository.findMany` は単純な `timestamp >= startTime` 条件で拾うだけなので、混入した休場日バーは BT で使われる

### 7. `BuyAndHoldTool` は OHLCV を直接読むが、他ツールは読まない

- WalkForward / MonteCarlo は `backtestService.getResult(runId)` の events/pnls で完結
- 戦略 BT で OHLCV ベースの検証をやるなら、**ツール側が OHLCV を読む設計** を拡張する必要(現状は BuyAndHold だけがその前例)

---

## Phase X 設計への示唆

### 選択肢 A: Python FastAPI で完全新規(vectorbt 等を使って精密 BT)

**実装量**:
- FastAPI サービスを 1 個新設(`backtest-engine/` など)
- OHLCVCandle を読んで戦略 DSL を評価する Python 実装(vectorbt or 自前 pandas)
- TS 側ブリッジ(既存 `python_bridge` は WalkForward 専用、汎用化が必要)

**保守コスト**:
- **Python コード資産が増える**(現 `walk_forward/` は stdlib のみ、`analysis-engine/` は pandas-ta のみ、**vectorbt 新規導入は別リポジトリ/コンテナ扱い**)
- Node ↔ Python 型整合性が 3 経路になる(既存 2 + 新規)

**整合性**:
- 既存 4 ツールが TS/Python 混在なので、「仮説評価は既存経路、戦略 BT は新規 Python」で並存可能
- ただし **既存 `validation/tools` の type 統一が取れなくなる**(implementation が 3 種に)

### 選択肢 B: 既存実装を戦略 BT にも流用(TS のまま)

**実装量**:
- `ValidationToolInput` を union 化: `{ kind: 'hypothesis', hypothesis: EdgeHypothesis, ... } | { kind: 'strategy', strategy: StrategyDSL, ... }`
- 各ツール内部の分岐追加(WalkForward: Python 入力の events 生成を DSL 経由で作る、MonteCarlo: 同じく、BuyAndHold: strategyReturn の計算方法を変える)
- もしくは `DSLBacktestAdapter` を `ValidationTool` でラップする層を新設

**制約と改修範囲**:
- EdgeHypothesis と StrategyDSL で **表現力の差** がある(DSL は parameters スイープや ConditionGroup AND/OR ネスト、EdgeHypothesis は MachineReadableCondition[] のフラット)
- Side-A `BacktestService` の `noteId` 依存が残る → **Note を経由しない戦略 BT** にするには `createNoteEvaluator` 同等の別 evaluator が必要
- WalkForward Python 側の入力契約(`events`, `period`, `splitCount`)は変更なしで行けそう(戦略 BT 結果の events に変換できれば)
- **最小工数は `DSLBacktestAdapter` の結果を Phase 4c 3 ツール向けに変換するアダプタ**(中間表現を挟んで Side-A を経由させない)

**二重実装コスト**:
- 戦略用 vs 仮説用で内部分岐が増える → テスト対象も倍になる
- ただし **表面 API は `ValidationTool` 互換のまま** なので呼び出し側は変わらない

### 選択肢 C: 折衷(既存は仮説評価に維持、Python 新規は戦略 BT 専用)

**実装量**:
- 既存 `validation/tools` は現状維持
- 新設: `src/side-b/validation/strategy_tools/`(仮想名)に戦略専用の実装群
- Python も新規に `python/strategy_backtest/`(仮想名)を立てる(vectorbt を使いたいなら)

**二重実装コスト(具体)**:
- MonteCarlo 的な再現可能性検定は **2 実装**(仮説用 MonteCarloTool + 戦略用 MonteCarloStrategyTool)
- BuyAndHold も同様
- WalkForward は戦略なら真の WF(パラメータ再学習)も視野、つまり **Python 側のロジックはむしろ独立させたほうが綺麗**(既存 `walk_forward.py` は「固定条件の時間的安定性」専用と明言している)
- 総工数: 3 ツール × 2 ~ 2.5 倍(WalkForward は独立した方が楽なので 2.5 倍)

**保守性**:
- 系統が明確に分かれる("仮説の統計検定" vs "戦略の BT")
- 名称空間が分離 → 将来エンジニアの混乱を減らす
- ただし **共通インターフェース `ValidationTool` の意味が曖昧化**、同じ名前の抽象が 2 種類ある状態になる

### 私の定性評価(判断材料のみ、決定はユーザーに委ねる)

| 選択肢 | 実装工数 | 短期リスク | 長期保守性 | Phase 5A 資産(DSLBacktestAdapter)の活用 | 推奨度 |
|---|---|---|---|---|---|
| A | 大(Python 新規 + ブリッジ) | 低(既存に触らない) | 中(Python 系統増で運用が重くなる) | × 活用せず | 🟡 |
| B | 中(既存ツール union 化) | **中〜高**(`validation/tools` 改修 + Side-A 依存の扱い) | 中(表面は綺麗だが内部分岐多い) | ○ `DSLBacktestAdapter` を直接埋め込み可 | 🟢 |
| C | 大(ほぼ新規実装、コード重複) | 低(既存に触らない) | **低〜中**(概念的重複でエンジニア混乱) | △ 戦略側で部分利用 | 🟠 |

**個人推奨: B** — `DSLBacktestAdapter` が既にあるので、これを **Phase 4c の ValidationTool 互換で包むアダプタ**を作るのが最も整合性が高い。ただし Side-A `BacktestService` 依存を切り離す部分が要設計。

---

## Blocker

以下は Phase X の設計を進める前に **判断が必要** な事項:

1. **`isFXMarketOpen` 相当を OHLCV 書き込み層に入れるか、クエリ層に入れるか、スキーマにフラグを足すか** — Phase X BT の正確性に直接影響。既存データの汚染範囲も要確認(土日バーが実際にどれだけ DB に入っているか別途 SQL 調査が必要)
2. **戦略 DSL の BT を Side-A `BacktestService` 経由にするか / 独立経路にするか** — これにより選択肢 B の改修範囲が大きく変わる。Side-A 協業パートナー原則を守るなら **独立経路が正解**
3. **経済指標カレンダー / スプレッド情報の導入は Phase X のスコープか否か** — 「精密 BT」の定義に依存、FTMO レベルの BT を狙うなら必須、仮説検証相当なら不要
4. **既存 `MonteCarloTool` と `services/backtest/monteCarloService.ts` の棲み分け** — Phase X で 3 系統目を作るのか、どちらかを拡張するのか。長期的には統合の圧力がかかる

以上の 4 項目を確定させないと、選択肢 A / B / C のどれを選んでも「作った後に仕様が揺れる」状態になります。Phase 6 プロンプトレビューが現在進行中なので、**それが落ち着いてからこちらを議論する** のが現実的です。
