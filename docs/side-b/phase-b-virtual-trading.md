# Phase B: 仮想トレード執行

## 概要

Phase Bでは、Phase Aで生成されたトレードプランに基づき、AIが仮想的にトレードを執行・管理する機能を実装する。

### 目的
- AIプランの実効性をリアルタイムで検証
- 実資金を使わずにAIの判断を評価
- 人間が参考にできる「生きた実績」を蓄積

---

## 機能要件

### 必須機能（MVP）

| ID | 機能 | 説明 |
|----|------|------|
| B-1 | 仮想エントリー | プランの条件達成時に仮想ポジションを建てる |
| B-2 | ポジション管理 | 建玉の状態を追跡・更新 |
| B-3 | 仮想決済 | SL/TP到達または手動で仮想決済 |
| B-4 | PnL計算 | 仮想損益をリアルタイム計算 |
| B-5 | ポジション表示 | 現在の仮想ポジションをUIで確認 |

### 追加機能（後続改善）

| ID | 機能 | 説明 |
|----|------|------|
| B-6 | トレーリングストップ | 利益確保のための動的SL |
| B-7 | 部分決済 | 分割利確のシミュレーション |
| B-8 | スリッページ考慮 | より現実的な約定価格 |
| B-9 | スプレッド考慮 | Bid/Askスプレッドの反映 |

---

## 仮想トレードのライフサイクル

```
┌─────────────────────────────────────────────────────────────┐
│                    仮想トレードの状態遷移                    │
└─────────────────────────────────────────────────────────────┘

  ┌──────────┐
  │ PENDING  │  プランは生成されたが、エントリー条件未達
  └────┬─────┘
       │ エントリー条件達成
       ▼
  ┌──────────┐
  │  OPEN    │  仮想ポジション保有中
  └────┬─────┘
       │ SL/TP到達 or 手動決済 or 無効化条件
       ▼
  ┌──────────┐
  │ CLOSED   │  決済完了、PnL確定
  └──────────┘

  別ルート:
  PENDING → EXPIRED（当日中にエントリー条件未達で終了）
  PENDING → CANCELLED（手動キャンセル）
  OPEN → INVALIDATED（無効化条件に該当）
```

---

## データモデル

### VirtualTrade（仮想トレード）

```typescript
interface VirtualTrade {
  id: string;                      // UUID
  
  // 関連
  planId: string;                  // AITradePlanのID
  scenarioId: string;              // AITradeScenarioのID
  
  // 基本情報
  symbol: string;
  direction: 'long' | 'short';
  
  // 状態
  status: VirtualTradeStatus;
  
  // エントリー情報
  entry: {
    plannedPrice: number;          // プランで指定した価格
    actualPrice?: number;          // 実際の約定価格
    time?: Date;                   // 約定時刻
    condition: string;             // エントリー条件
  };
  
  // 決済情報
  exit?: {
    price: number;
    time: Date;
    reason: ExitReason;
  };
  
  // リスク管理
  stopLoss: number;
  takeProfit: number;
  
  // 損益
  pnl?: {
    pips: number;
    percentage: number;
    amount?: number;               // 仮想資金ベース
  };
  
  // メタ
  createdAt: Date;
  updatedAt: Date;
}

type VirtualTradeStatus = 
  | 'pending'      // エントリー待ち
  | 'open'         // ポジション保有中
  | 'closed'       // 正常決済
  | 'expired'      // 期限切れ（未エントリー）
  | 'cancelled'    // 手動キャンセル
  | 'invalidated'; // 無効化条件該当

type ExitReason =
  | 'take_profit'  // TP到達
  | 'stop_loss'    // SL到達
  | 'manual'       // 手動決済
  | 'invalidation' // 無効化条件
  | 'end_of_day';  // 日終わり強制決済
```

### VirtualPortfolio（仮想ポートフォリオ）

```typescript
interface VirtualPortfolio {
  id: string;
  
  // 仮想資金（オプション）
  initialBalance: number;
  currentBalance: number;
  
  // 統計
  stats: {
    totalTrades: number;
    openTrades: number;
    winRate: number;
    profitFactor: number;
    totalPnlPips: number;
    maxDrawdownPips: number;
  };
  
  // 設定
  settings: {
    maxOpenPositions: number;      // 同時保有上限
    defaultRiskPercent: number;    // リスク率
    enableSpread: boolean;         // スプレッド考慮
    spreadPips: number;            // 想定スプレッド
  };
}
```

---

## 処理フロー

### 1. エントリー監視フロー

```
┌─────────────────────────────────────────────────────────────┐
│                    エントリー監視（定期実行）                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. PENDING状態の仮想トレードを取得                          │
│                                                             │
│  2. 各トレードについて:                                      │
│     ┌─────────────────────────────────────────────────┐     │
│     │ a. 現在の市場価格を取得                          │     │
│     │ b. エントリー条件をチェック                      │     │
│     │    - 指値: 価格 <= entry.plannedPrice (Long)    │     │
│     │    - 逆指値: 価格 >= entry.plannedPrice (Long)  │     │
│     │ c. 条件達成 → ステータスを OPEN に変更           │     │
│     │ d. entry.actualPrice, entry.time を記録        │     │
│     └─────────────────────────────────────────────────┘     │
│                                                             │
│  3. 期限切れチェック（当日終了で未エントリー → EXPIRED）      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2. ポジション監視フロー

```
┌─────────────────────────────────────────────────────────────┐
│                    ポジション監視（定期実行）                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. OPEN状態の仮想トレードを取得                             │
│                                                             │
│  2. 各トレードについて:                                      │
│     ┌─────────────────────────────────────────────────┐     │
│     │ a. 現在の市場価格を取得                          │     │
│     │ b. SL/TPチェック                                │     │
│     │    - Long: price <= SL → 損切り決済             │     │
│     │    - Long: price >= TP → 利確決済               │     │
│     │ c. 無効化条件チェック                            │     │
│     │ d. 条件該当 → 決済処理                          │     │
│     └─────────────────────────────────────────────────┘     │
│                                                             │
│  3. PnL更新（含み損益の計算）                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3. 決済処理フロー

```
┌─────────────────────────────────────────────────────────────┐
│                       決済処理                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. exit情報を記録                                          │
│     - price: 決済価格                                       │
│     - time: 決済時刻                                        │
│     - reason: 決済理由                                      │
│                                                             │
│  2. PnL計算                                                 │
│     Long:  pnl = exit.price - entry.actualPrice            │
│     Short: pnl = entry.actualPrice - exit.price            │
│                                                             │
│  3. ステータス更新 → CLOSED                                 │
│                                                             │
│  4. ポートフォリオ統計更新                                   │
│                                                             │
│  5. Phase Cへの連携（トレードノート生成トリガー）            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## APIエンドポイント設計

### GET /api/side-b/virtual-trades

仮想トレード一覧を取得。

**Query Parameters:**
- `status`: ステータスフィルター（pending, open, closed）
- `planId`: プランIDでフィルター
- `from`, `to`: 期間フィルター

**Response:**
```typescript
{
  trades: VirtualTrade[];
  summary: {
    pending: number;
    open: number;
    closedToday: number;
  };
}
```

### GET /api/side-b/virtual-trades/:id

特定の仮想トレード詳細を取得。

### POST /api/side-b/virtual-trades/:id/close

手動で仮想トレードを決済。

**Request:**
```typescript
{
  reason: 'manual' | 'invalidation';
  note?: string;
}
```

### POST /api/side-b/virtual-trades/:id/cancel

PENDING状態のトレードをキャンセル。

### GET /api/side-b/portfolio

仮想ポートフォリオの状態を取得。

**Response:**
```typescript
{
  portfolio: VirtualPortfolio;
  openPositions: VirtualTrade[];
}
```

### PUT /api/side-b/portfolio/settings

ポートフォリオ設定を更新。

---

## 監視ジョブ設計

### 定期実行タスク

```typescript
// ジョブスケジュール
const MONITORING_JOBS = {
  // エントリー監視: 1分ごと（市場時間中）
  entryMonitor: {
    schedule: '*/1 * * * *',
    enabled: true,
    marketHoursOnly: true,
  },
  
  // ポジション監視: 1分ごと（市場時間中）
  positionMonitor: {
    schedule: '*/1 * * * *',
    enabled: true,
    marketHoursOnly: true,
  },
  
  // 日次クリーンアップ: 毎日23:59
  dailyCleanup: {
    schedule: '59 23 * * *',
    enabled: true,
    tasks: [
      'expirePendingTrades',
      'forceCloseOpenTrades', // オプション
    ],
  },
};
```

### 市場時間判定

```typescript
interface MarketHours {
  symbol: string;
  sessions: {
    name: string;           // 'Tokyo', 'London', 'NewYork'
    open: string;           // 'HH:mm' (UTC)
    close: string;
  }[];
}

// XAU/USDの場合（ほぼ24時間）
const XAUUSD_MARKET_HOURS: MarketHours = {
  symbol: 'XAUUSD',
  sessions: [
    { name: 'Sydney', open: '22:00', close: '07:00' },
    { name: 'Tokyo', open: '00:00', close: '09:00' },
    { name: 'London', open: '08:00', close: '17:00' },
    { name: 'NewYork', open: '13:00', close: '22:00' },
  ],
};
```

---

## UI設計

### 仮想ポジション一覧

```
┌─────────────────────────────────────────────────────────────┐
│  🤖 仮想トレード状況                                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  【オープンポジション】 2件                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ #1 XAUUSD Long                                      │   │
│  │ エントリー: 3,242 @ 09:15                            │   │
│  │ 現在値: 3,258 │ SL: 3,227 │ TP: 3,272              │   │
│  │ 含み益: +16 pips (+0.49%)  🟢                       │   │
│  │ [📊 詳細] [❌ 手動決済]                              │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ #2 XAUUSD Short                                     │   │
│  │ エントリー: 3,265 @ 14:30                            │   │
│  │ 現在値: 3,258 │ SL: 3,280 │ TP: 3,235              │   │
│  │ 含み益: +7 pips (+0.21%)  🟢                        │   │
│  │ [📊 詳細] [❌ 手動決済]                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  【待機中】 1件                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ #3 XAUUSD Long (指値待ち)                           │   │
│  │ エントリー予定: 3,235                               │   │
│  │ 現在値: 3,258 │ 距離: -23 pips                      │   │
│  │ [📊 詳細] [🚫 キャンセル]                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  【本日の結果】                                              │
│  決済: 3件 │ 勝率: 66% │ 合計: +28 pips                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### ポートフォリオサマリー

```
┌─────────────────────────────────────────────────────────────┐
│  📈 仮想ポートフォリオ                                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  累計成績（過去30日）                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 総トレード数    │  87                               │   │
│  │ 勝率           │  58.6%                            │   │
│  │ プロフィットF  │  1.42                             │   │
│  │ 累計損益       │  +342 pips                        │   │
│  │ 最大DD        │  -89 pips                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  日次推移グラフ                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │     ╱╲    ╱╲                                       │   │
│  │ ╱╲╱  ╲╱╱  ╲  ╱╲                                   │   │
│  │╱           ╲╱  ╲╱                                  │   │
│  │ 12/05 ─────────────────────────── 01/04           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## ディレクトリ構造

```
src/side-b/
├── services/
│   ├── virtualTradeService.ts      # 仮想トレード管理
│   ├── positionMonitorService.ts   # ポジション監視
│   └── portfolioService.ts         # ポートフォリオ管理
├── jobs/
│   ├── entryMonitorJob.ts          # エントリー監視ジョブ
│   ├── positionMonitorJob.ts       # ポジション監視ジョブ
│   └── dailyCleanupJob.ts          # 日次クリーンアップ
├── repositories/
│   ├── virtualTradeRepository.ts
│   └── portfolioRepository.ts
├── controllers/
│   ├── virtualTradeController.ts
│   └── portfolioController.ts
└── routes/
    └── virtualTradeRoutes.ts

src/frontend/app/side-b/
├── virtual-trades/
│   ├── page.tsx                    # 一覧
│   └── [id]/page.tsx               # 詳細
└── portfolio/
    └── page.tsx                    # ポートフォリオ
```

---

## データベーススキーマ

```sql
-- 仮想トレード
CREATE TABLE virtual_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES ai_trade_plans(id),
  scenario_id VARCHAR(100) NOT NULL,
  
  symbol VARCHAR(20) NOT NULL,
  direction VARCHAR(10) NOT NULL,  -- 'long' | 'short'
  status VARCHAR(20) NOT NULL,     -- 'pending' | 'open' | 'closed' | ...
  
  -- エントリー
  entry_planned_price DECIMAL(20, 5) NOT NULL,
  entry_actual_price DECIMAL(20, 5),
  entry_time TIMESTAMP,
  entry_condition TEXT,
  
  -- 決済
  exit_price DECIMAL(20, 5),
  exit_time TIMESTAMP,
  exit_reason VARCHAR(20),
  
  -- リスク管理
  stop_loss DECIMAL(20, 5) NOT NULL,
  take_profit DECIMAL(20, 5) NOT NULL,
  
  -- 損益
  pnl_pips DECIMAL(10, 2),
  pnl_percentage DECIMAL(10, 4),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 仮想ポートフォリオ
CREATE TABLE virtual_portfolio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initial_balance DECIMAL(20, 2) DEFAULT 100000,
  current_balance DECIMAL(20, 2) DEFAULT 100000,
  
  -- 統計（定期更新）
  total_trades INTEGER DEFAULT 0,
  win_count INTEGER DEFAULT 0,
  loss_count INTEGER DEFAULT 0,
  total_pnl_pips DECIMAL(10, 2) DEFAULT 0,
  max_drawdown_pips DECIMAL(10, 2) DEFAULT 0,
  
  -- 設定
  max_open_positions INTEGER DEFAULT 3,
  enable_spread BOOLEAN DEFAULT false,
  spread_pips DECIMAL(5, 2) DEFAULT 0.3,
  
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- インデックス
CREATE INDEX idx_virtual_trades_status ON virtual_trades(status);
CREATE INDEX idx_virtual_trades_plan ON virtual_trades(plan_id);
CREATE INDEX idx_virtual_trades_created ON virtual_trades(created_at);
```

---

## 実装タスク

### バックエンド

| # | タスク | 優先度 | 見積 |
|---|--------|--------|------|
| 1 | 型定義（VirtualTrade, Portfolio） | 高 | 1h |
| 2 | VirtualTradeRepository実装 | 高 | 2h |
| 3 | VirtualTradeService実装 | 高 | 3h |
| 4 | EntryMonitorJob実装 | 高 | 2h |
| 5 | PositionMonitorJob実装 | 高 | 2h |
| 6 | PortfolioService実装 | 中 | 2h |
| 7 | コントローラー実装 | 中 | 2h |
| 8 | ルーティング設定 | 中 | 0.5h |
| 9 | テスト作成 | 中 | 3h |

### フロントエンド

| # | タスク | 優先度 | 見積 |
|---|--------|--------|------|
| 10 | 仮想トレード一覧 | 中 | 2h |
| 11 | 仮想トレード詳細 | 中 | 2h |
| 12 | ポートフォリオ画面 | 中 | 2h |
| 13 | リアルタイム更新（WebSocket/Polling） | 中 | 2h |

---

## Phase A との連携

```typescript
// Phase A でプラン生成後、自動的に仮想トレードを作成
async function onPlanGenerated(plan: AITradePlan): Promise<void> {
  for (const scenario of plan.scenarios) {
    await virtualTradeService.createFromScenario(plan.id, scenario);
  }
}
```

---

## 成功基準

### Phase B 完了条件

- [ ] プランから仮想トレードが自動生成される
- [ ] エントリー条件達成で自動エントリー
- [ ] SL/TP到達で自動決済
- [ ] ポジション状況がUIで確認できる
- [ ] ポートフォリオ統計が計算される

### 品質基準

- 監視ジョブの遅延: 1分以内
- PnL計算の正確性: 100%
- 状態遷移の整合性: 100%

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-01-04 | 初版作成 |
