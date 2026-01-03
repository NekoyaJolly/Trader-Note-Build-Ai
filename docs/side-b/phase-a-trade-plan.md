# Phase A: AIトレードプラン生成

## 概要

Phase Aでは、AIが毎日の市場分析を行い、トレードプランを生成する機能を実装する。

### 目的
- 朝の時点でAIがその日のトレードシナリオを提案
- 人間はプランを参考に、自分の判断でトレード
- AIの判断根拠が明確に記録される

---

## 機能要件

### 必須機能（MVP）

| ID | 機能 | 説明 |
|----|------|------|
| A-1 | 市場データ分析 | OHLCVデータからレジーム・トレンド判定 |
| A-2 | プラン生成 | AIがエントリー条件・価格・SL/TPを提案 |
| A-3 | プラン表示 | 生成されたプランをUIで確認 |
| A-4 | プラン保存 | 生成プランをDBに保存 |

### 追加機能（後続Phase）

| ID | 機能 | 説明 |
|----|------|------|
| A-5 | 複数シナリオ | 強気/弱気/中立の複数パターン |
| A-6 | 信頼度スコア | AIの自信度を数値化 |
| A-7 | 過去プラン参照 | 過去のプラン精度を表示 |

---

## 入力データ（AIに渡す情報）

### 1. 価格データ（OHLCV）

```typescript
interface OHLCVInput {
  symbol: string;           // 例: "XAUUSD"
  timeframe: string;        // 例: "15m", "1h", "4h", "1d"
  candles: {
    timestamp: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];
}
```

**取得範囲**: 
- 15分足: 直近100本（約25時間）
- 1時間足: 直近100本（約4日）
- 4時間足: 直近50本（約8日）
- 日足: 直近30本（約1ヶ月）

### 2. テクニカル指標

```typescript
interface TechnicalIndicators {
  // トレンド系
  sma: { period: number; value: number }[];    // SMA 20, 50, 200
  ema: { period: number; value: number }[];    // EMA 9, 21
  
  // モメンタム系
  rsi: { period: number; value: number };      // RSI 14
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  
  // ボラティリティ系
  bb: {
    upper: number;
    middle: number;
    lower: number;
    width: number;
  };
  atr: { period: number; value: number };      // ATR 14
}
```

### 3. 市場コンテキスト（オプション）

```typescript
interface MarketContext {
  // クロスアセット相関（将来実装）
  correlations?: {
    symbol: string;
    correlation: number;
  }[];
  
  // 重要イベント（将来実装）
  upcomingEvents?: {
    name: string;
    datetime: Date;
    impact: 'high' | 'medium' | 'low';
  }[];
}
```

---

## 出力データ（AIが生成するプラン）

### AITradePlan 構造

```typescript
interface AITradePlan {
  id: string;                    // UUID
  createdAt: Date;               // 生成日時
  targetDate: string;            // 対象日 (YYYY-MM-DD)
  symbol: string;                // 対象銘柄
  
  // 市場分析
  marketAnalysis: {
    regime: MarketRegime;
    trendDirection: 'up' | 'down' | 'sideways';
    volatility: 'low' | 'medium' | 'high';
    keyLevels: {
      strongResistance: number[];
      resistance: number[];
      support: number[];
      strongSupport: number[];
    };
    summary: string;             // AI による市場概況
  };
  
  // トレードシナリオ（複数可）
  scenarios: AITradeScenario[];
  
  // メタ情報
  overallConfidence: number;     // 0-100
  warnings: string[];            // 注意事項
  aiModel: string;               // 使用したAIモデル
}

type MarketRegime = 
  | 'strong_uptrend'
  | 'uptrend'
  | 'range'
  | 'downtrend'
  | 'strong_downtrend'
  | 'volatile';
```

### AITradeScenario 構造

```typescript
interface AITradeScenario {
  id: string;                    // UUID
  name: string;                  // シナリオ名（例: "押し目買いシナリオ"）
  direction: 'long' | 'short';
  priority: 'primary' | 'secondary' | 'alternative';
  
  // エントリー条件
  entry: {
    type: 'limit' | 'market' | 'stop';
    price: number;
    condition: string;           // 自然言語での条件説明
    triggerIndicators: string[]; // トリガーとなる指標
  };
  
  // リスク管理
  stopLoss: {
    price: number;
    pips: number;
    reason: string;              // SL設定の根拠
  };
  
  takeProfit: {
    price: number;
    pips: number;
    reason: string;              // TP設定の根拠
  };
  
  // 分析
  riskReward: number;            // リスクリワード比
  confidence: number;            // 0-100
  rationale: string;             // AIの判断根拠（詳細）
  
  // 無効化条件
  invalidationConditions: string[];
}
```

---

## APIエンドポイント設計

### POST /api/side-b/plans/generate

新規プランを生成する。

**Request:**
```typescript
{
  symbol: string;          // "XAUUSD"
  targetDate?: string;     // YYYY-MM-DD（省略時は今日）
}
```

**Response:**
```typescript
{
  success: boolean;
  plan: AITradePlan;
}
```

### GET /api/side-b/plans

プラン一覧を取得する。

**Query Parameters:**
- `symbol`: 銘柄フィルター
- `from`: 開始日
- `to`: 終了日
- `limit`: 取得件数

**Response:**
```typescript
{
  plans: AITradePlan[];
  total: number;
}
```

### GET /api/side-b/plans/:id

特定のプランを取得する。

**Response:**
```typescript
{
  plan: AITradePlan;
}
```

---

## AIプロンプト設計

### システムプロンプト（案）

```
あなたはプロフェッショナルなテクニカルアナリストです。
与えられた市場データを分析し、トレードプランを作成してください。

## 分析の原則
1. 複数の時間軸を考慮する（マルチタイムフレーム分析）
2. トレンドの方向と強さを判定する
3. 重要なサポート/レジスタンスレベルを特定する
4. リスクリワード比が1.5以上のシナリオのみ提案する
5. 判断根拠を明確に説明する

## 出力形式
指定されたJSON形式で出力してください。
```

### ユーザープロンプト（案）

```
以下の市場データを分析し、{targetDate}のトレードプランを作成してください。

## 対象銘柄
{symbol}

## 価格データ
{ohlcvData}

## テクニカル指標
{technicalIndicators}

## 出力要件
- 市場分析（レジーム判定、トレンド方向、ボラティリティ）
- 重要な価格レベル（サポート/レジスタンス）
- 1〜3個のトレードシナリオ
- 各シナリオの判断根拠
```

---

## UI設計

### プラン表示画面

```
┌─────────────────────────────────────────────────────────┐
│  📊 AIトレードプラン - 2026/01/04                        │
│  XAUUSD | 生成時刻: 08:00                               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  【市場分析】                                            │
│  ┌─────────────────────────────────────────────────┐   │
│  │ レジーム: 上昇トレンド 📈                         │   │
│  │ ボラティリティ: 中程度                           │   │
│  │ 信頼度: 72%                                      │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  【重要レベル】                                          │
│  強レジスタンス: 3,280                                  │
│  レジスタンス: 3,265                                    │
│  ───────── 現在値: 3,248 ─────────                     │
│  サポート: 3,235                                        │
│  強サポート: 3,220                                      │
│                                                         │
│  【シナリオ】                                            │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 🎯 プライマリ: 押し目買いシナリオ                 │   │
│  │ 方向: ロング                                     │   │
│  │ エントリー: 3,240 (指値)                         │   │
│  │ SL: 3,225 (-15pips)                             │   │
│  │ TP: 3,270 (+30pips)                             │   │
│  │ RR比: 2.0                                       │   │
│  │                                                  │   │
│  │ 【根拠】                                         │   │
│  │ ・4H足で上昇トレンド継続中                       │   │
│  │ ・RSI(14)が50付近まで調整、過熱感なし            │   │
│  │ ・3,235-3,240は過去のレジサポ転換ゾーン          │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 📌 セカンダリ: ブレイクアウトシナリオ             │   │
│  │ 方向: ロング                                     │   │
│  │ エントリー: 3,268 (逆指値)                       │   │
│  │ ...                                             │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [🔄 再生成] [📋 コピー] [💾 保存済み]                  │
└─────────────────────────────────────────────────────────┘
```

---

## ディレクトリ構造

```
src/side-b/
├── controllers/
│   └── aiPlanController.ts
├── services/
│   ├── aiPlanService.ts          # プラン生成ロジック
│   ├── marketAnalysisService.ts  # 市場分析
│   └── promptBuilder.ts          # プロンプト構築
├── models/
│   └── aiPlanTypes.ts            # 型定義
├── repositories/
│   └── aiPlanRepository.ts       # DB操作
└── routes/
    └── aiPlanRoutes.ts           # ルーティング

src/frontend/
└── app/
    └── side-b/
        └── plans/
            ├── page.tsx          # プラン一覧
            └── [id]/
                └── page.tsx      # プラン詳細
```

---

## 実装タスク

### バックエンド

| # | タスク | 優先度 | 見積 |
|---|--------|--------|------|
| 1 | 型定義ファイル作成 | 高 | 1h |
| 2 | プロンプトビルダー実装 | 高 | 2h |
| 3 | AIプランサービス実装 | 高 | 3h |
| 4 | プランリポジトリ実装 | 中 | 2h |
| 5 | コントローラー実装 | 中 | 1h |
| 6 | ルーティング設定 | 中 | 0.5h |
| 7 | テスト作成 | 中 | 2h |

### フロントエンド

| # | タスク | 優先度 | 見積 |
|---|--------|--------|------|
| 8 | プラン一覧ページ | 中 | 2h |
| 9 | プラン詳細ページ | 中 | 3h |
| 10 | プラン生成ボタン | 中 | 1h |
| 11 | API連携 | 中 | 1h |

### インフラ

| # | タスク | 優先度 | 見積 |
|---|--------|--------|------|
| 12 | DBスキーマ設計 | 高 | 1h |
| 13 | マイグレーション作成 | 高 | 0.5h |

---

## データベーススキーマ

```sql
-- AIトレードプラン
CREATE TABLE ai_trade_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_date DATE NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  market_analysis JSONB NOT NULL,
  scenarios JSONB NOT NULL,
  overall_confidence INTEGER,
  warnings TEXT[],
  ai_model VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(target_date, symbol)
);

-- インデックス
CREATE INDEX idx_ai_trade_plans_date ON ai_trade_plans(target_date);
CREATE INDEX idx_ai_trade_plans_symbol ON ai_trade_plans(symbol);
```

---

## 依存関係

### Side-A から利用する既存機能

| 機能 | ファイル | 用途 |
|------|---------|------|
| OHLCV取得 | `ohlcvRepository.ts` | 価格データ取得 |
| インジケーター計算 | `indicatorService.ts` | テクニカル指標算出 |
| OpenAI連携 | `openaiService.ts` | AI API呼び出し |
| 認証 | `authMiddleware.ts` | API認証 |

### 新規追加が必要なもの

| 項目 | 説明 |
|------|------|
| プロンプトテンプレート | AIへの指示文 |
| JSONパーサー | AI出力のバリデーション |

---

## 成功基準

### Phase A 完了条件

- [ ] APIエンドポイントが動作する
- [ ] AIがプランを生成できる
- [ ] プランがDBに保存される
- [ ] UIでプランが表示される
- [ ] テストがパスする

### 品質基準

- プラン生成時間: 30秒以内
- AI出力のパース成功率: 95%以上
- エラー時のフォールバック処理あり

---

## リスクと対策

| リスク | 対策 |
|--------|------|
| AIの出力が不安定 | JSON Schemaでバリデーション、リトライ機能 |
| API料金の増加 | 1日1回の生成制限、キャッシュ活用 |
| レスポンス遅延 | 非同期生成、ローディング表示 |

---

## 次のステップ

1. **型定義** から着手（実装の土台）
2. **プロンプト設計** の詳細化
3. **バックエンドAPI** 実装
4. **フロントエンドUI** 実装
5. **テスト・調整**

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-01-04 | 初版作成 |
