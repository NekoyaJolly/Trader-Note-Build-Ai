# Phase A: AIトレードプラン生成

## 概要

Phase Aでは、AIが毎日の市場分析を行い、トレードプランを生成する機能を実装する。

### 目的
- 朝の時点でAIがその日のトレードシナリオを提案
- 人間はプランを参考に、自分の判断でトレード
- AIの判断根拠が明確に記録される

---

## AIアーキテクチャ

### パイプライン構成

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: リサーチ（定期実行 or オンデマンド）                │
│  ────────────────────────────────────────────────────────── │
│  OHLCV + Indicators                                         │
│         ↓                                                   │
│  Research AI (gpt-4o-mini) ← 軽量・低コスト                 │
│         ↓                                                   │
│  💾 market_research テーブルに保存                          │
│     ・12次元特徴量ベクトル（Side-A互換）                    │
│     ・regime, trend, volatility                             │
│     ・key_levels (S/R)                                      │
│     ・summary                                               │
│     ・有効期限: 4時間                                       │
└─────────────────────────────────────────────────────────────┘
                        ↓
                   （時間差OK / キャッシュ活用）
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 2: プラン生成                                         │
│  ────────────────────────────────────────────────────────── │
│  💾 market_research から最新取得                            │
│         ↓                                                   │
│  Plan AI (gpt-4o) ← フラッグシップ・高精度                  │
│         ↓                                                   │
│  💾 ai_trade_plans テーブルに保存                           │
└─────────────────────────────────────────────────────────────┘
```

### AI責務分離

| AI | モデル | 責務 | コスト/回 |
|----|--------|------|-----------|
| **Research AI** | gpt-4o-mini | 市場データ構造化・12次元特徴量生成 | 〜$0.01 |
| **Plan AI** | gpt-4o | トレードシナリオ立案・判断根拠生成 | 〜$0.10 |

### DB経由のメリット

1. **リサーチ結果のキャッシュ** - 同じリサーチで複数プラン生成可能
2. **独立リトライ** - 各ステップ個別に再実行可能
3. **中間検証** - リサーチ結果をユーザーが確認してからプラン生成
4. **Side-A互換** - 12次元特徴量でノートとの比較が可能
5. **コスト削減** - 不要なAI呼び出しを回避（最大70%削減）

### コスト試算

| シナリオ | リサーチ | プラン | 合計/回 | 月30回 |
|----------|----------|--------|---------|--------|
| 毎回フル実行 | $0.01 | $0.10 | $0.11 | $3.30 |
| キャッシュ活用 | $0.01 × 0.3 | $0.10 | $0.103 | $3.09 |
| 検証後プラン | $0.01 | $0.10 × 0.5 | $0.06 | $1.80 |

---

## 機能要件

### 必須機能（MVP）

| ID | 機能 | 説明 |
|----|------|------|
| A-1 | 市場リサーチ | OHLCVデータから12次元特徴量・レジーム判定 |
| A-2 | リサーチ保存 | 分析結果をDBにキャッシュ |
| A-3 | プラン生成 | AIがエントリー条件・価格・SL/TPを提案 |
| A-4 | プラン表示 | 生成されたプランをUIで確認 |
| A-5 | プラン保存 | 生成プランをDBに保存 |

### 追加機能（後続Phase）

| ID | 機能 | 説明 |
|----|------|------|
| A-6 | 複数シナリオ | 強気/弱気/中立の複数パターン |
| A-7 | 信頼度スコア | AIの自信度を数値化 |
| A-8 | 過去プラン参照 | 過去のプラン精度を表示 |
| A-9 | Side-A連携 | 人間ノートとの類似度比較 |

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

### 2. テクニカル指標（計算済み）

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

## 中間データ（MarketResearch）

### 12次元特徴量ベクトル

Side-Aの人間用ノートと同じ基準で市場を評価するため、Research AIが12次元特徴量を生成する。

```typescript
/**
 * 12次元特徴量ベクトル
 * Side-A（人間ノート）と Side-B（AIプラン）で共通使用
 * 各値は 0-100 の正規化スコア
 */
interface FeatureVector12D {
  // トレンド系（4次元）
  trendStrength: number;        // トレンドの強さ (ADX等から)
  trendDirection: number;       // 方向性 (0=強い下降, 50=横ばい, 100=強い上昇)
  maAlignment: number;          // MA配列の整列度 (ゴールデンクロス等)
  pricePosition: number;        // MA群に対する価格位置
  
  // モメンタム系（3次元）
  rsiLevel: number;             // RSI (0-100そのまま)
  macdMomentum: number;         // MACDヒストグラムの強さ
  momentumDivergence: number;   // ダイバージェンス検出 (0=なし, 100=強い)
  
  // ボラティリティ系（3次元）
  volatilityLevel: number;      // ATR正規化
  bbWidth: number;              // ボリンジャーバンド幅
  volatilityTrend: number;      // ボラ拡大/縮小傾向
  
  // 価格構造系（2次元）
  supportProximity: number;     // サポートへの近さ (100=直近)
  resistanceProximity: number;  // レジスタンスへの近さ (100=直近)
}
```

### MarketResearch 構造

```typescript
interface MarketResearch {
  id: string;                    // UUID
  symbol: string;                // 対象銘柄
  timeframe: string;             // "multi" | "15m" | "1h" | "4h"
  createdAt: Date;               // 生成日時
  expiresAt: Date;               // 有効期限（4時間後）
  
  // 12次元特徴量（Side-A互換）
  featureVector: FeatureVector12D;
  
  // レジーム判定
  regime: MarketRegime;
  regimeConfidence: number;      // 0-100
  
  // トレンド分析
  trend: {
    direction: 'up' | 'down' | 'sideways';
    strength: 'weak' | 'moderate' | 'strong';
    mtfAlignment: boolean;       // マルチタイムフレーム一致
  };
  
  // ボラティリティ分析
  volatility: {
    level: 'low' | 'medium' | 'high';
    expanding: boolean;          // 拡大傾向
    atrValue: number;            // 実際のATR値
  };
  
  // 重要価格レベル
  keyLevels: {
    strongResistance: number[];
    resistance: number[];
    support: number[];
    strongSupport: number[];
  };
  
  // AI生成サマリー
  summary: string;
  
  // メタ情報
  aiModel: string;               // "gpt-4o-mini"
  tokenUsage: number;
  rawIndicators?: object;        // デバッグ用元データ
}

type MarketRegime = 
  | 'strong_uptrend'
  | 'uptrend'
  | 'range'
  | 'downtrend'
  | 'strong_downtrend'
  | 'volatile';
```

### Side-A との連携

```typescript
// Side-AのノートとSide-Bのリサーチを12次元で比較
function compareFeatureVectors(
  humanNote: FeatureVector12D,
  aiResearch: FeatureVector12D
): number {
  // コサイン類似度で比較（0-1）
  return cosineSimilarity(
    Object.values(humanNote),
    Object.values(aiResearch)
  );
}

// 使用例: 人間のノートとAIの市場認識がどれだけ一致しているか
const similarity = compareFeatureVectors(
  tradeNote.featureVector,
  marketResearch.featureVector
);
// → 0.85 = 85%一致
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
  
  // リサーチ参照
  researchId: string;            // 元になったMarketResearchのID
  
  // 市場分析（リサーチから継承 + プランAI追加分析）
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

### リサーチ API

#### POST /api/side-b/research/generate

新規リサーチを実行する。

**Request:**
```typescript
{
  symbol: string;          // "XAUUSD"
  timeframe?: string;      // "multi" (default) | "15m" | "1h" | "4h"
  forceRefresh?: boolean;  // true: キャッシュ無視して再生成
}
```

**Response:**
```typescript
{
  success: boolean;
  research: MarketResearch;
  cached: boolean;         // キャッシュから返却されたか
}
```

#### GET /api/side-b/research/latest

最新のリサーチを取得する（有効期限内のみ）。

**Query Parameters:**
- `symbol`: 銘柄（必須）

**Response:**
```typescript
{
  research: MarketResearch | null;
  expired: boolean;
}
```

#### GET /api/side-b/research/:id

特定のリサーチを取得する。

### プラン API

#### POST /api/side-b/plans/generate

新規プランを生成する。

**Request:**
```typescript
{
  symbol: string;          // "XAUUSD"
  targetDate?: string;     // YYYY-MM-DD（省略時は今日）
  researchId?: string;     // 指定時はそのリサーチを使用、省略時は最新 or 新規生成
}
```

**Response:**
```typescript
{
  success: boolean;
  plan: AITradePlan;
  researchUsed: {
    id: string;
    cached: boolean;       // 既存リサーチを使用したか
  };
}
```

#### GET /api/side-b/plans

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

#### GET /api/side-b/plans/:id

特定のプランを取得する。

**Response:**
```typescript
{
  plan: AITradePlan;
  research: MarketResearch;  // 関連リサーチも返却
}
```

---

## AIプロンプト設計

### Research AI プロンプト

#### システムプロンプト

```markdown
あなたは市場データアナリストです。
与えられたOHLCVデータとテクニカル指標を分析し、構造化された市場状況レポートを作成してください。

## あなたの役割
- 生データを構造化された分析結果に変換する
- 12次元特徴量ベクトルを算出する
- 客観的な市場状況を記述する（トレード判断は行わない）

## 12次元特徴量の算出基準
各値は 0-100 の範囲で正規化してください。

1. trendStrength: ADX値をそのまま使用（0-100）
2. trendDirection: 価格とMA200の乖離率を正規化（0=強い下降, 50=横ばい, 100=強い上昇）
3. maAlignment: MA短期>中期>長期なら100、逆なら0、混在なら50
4. pricePosition: 価格がMA群のどこに位置するか
5. rsiLevel: RSI値をそのまま使用（0-100）
6. macdMomentum: MACDヒストグラムを正規化
7. momentumDivergence: 価格とRSI/MACDの乖離を検出
8. volatilityLevel: ATRを過去平均比で正規化
9. bbWidth: ボリンジャーバンド幅を正規化
10. volatilityTrend: 直近ATRの傾き
11. supportProximity: 最寄りサポートへの距離を正規化
12. resistanceProximity: 最寄りレジスタンスへの距離を正規化

## 出力形式
必ず指定されたJSONスキーマに従って出力してください。
```

#### ユーザープロンプト

```markdown
以下の市場データを分析し、構造化されたレポートを作成してください。

## 対象
銘柄: {symbol}
分析時刻: {timestamp}

## 価格データ（OHLCV）
### 15分足（直近100本）
{ohlcv_15m}

### 1時間足（直近100本）
{ohlcv_1h}

### 4時間足（直近50本）
{ohlcv_4h}

## テクニカル指標
{technicalIndicators}

## 出力要件
1. 12次元特徴量ベクトル（各値 0-100）
2. レジーム判定（strong_uptrend/uptrend/range/downtrend/strong_downtrend/volatile）
3. トレンド分析（方向、強さ、MTF一致）
4. ボラティリティ分析
5. 重要価格レベル（サポート/レジスタンス各2-4個）
6. 100文字以内の市場サマリー
```

### Plan AI プロンプト

#### システムプロンプト

```markdown
あなたはプロフェッショナルなトレードストラテジストです。
市場リサーチ結果を基に、具体的なトレードプランを作成してください。

## あなたの役割
- リサーチ結果を基にトレードシナリオを立案する
- エントリー/SL/TPの具体的な価格を提案する
- 判断根拠を明確に説明する

## 分析の原則
1. リスクリワード比は最低1.5以上
2. 複数シナリオ（プライマリ/セカンダリ）を提案
3. 無効化条件を明確にする
4. 過信を避け、適切な信頼度を設定する

## 信頼度の基準
- 90-100: MTF完全一致 + 明確なトレンド + 複数根拠
- 70-89: 主要条件一致 + 一部懸念あり
- 50-69: 条件分岐あり + 慎重な判断が必要
- 50未満: 見送り推奨（プラン作成しない）

## シナリオ優先度
- primary: 最も確度が高いメインシナリオ（必須）
- secondary: 代替シナリオ（任意）
- alternative: 逆張りや特殊条件シナリオ（任意）
```

#### ユーザープロンプト

```markdown
以下のリサーチ結果を基に、{targetDate}のトレードプランを作成してください。

## 銘柄
{symbol}

## 市場リサーチ結果
### 12次元特徴量
{featureVector}

### レジーム
{regime}（信頼度: {regimeConfidence}%）

### トレンド
方向: {trendDirection}
強さ: {trendStrength}
MTF一致: {mtfAlignment}

### ボラティリティ
レベル: {volatilityLevel}
傾向: {expanding ? "拡大中" : "縮小中"}
ATR: {atrValue}

### 重要レベル
強レジスタンス: {strongResistance}
レジスタンス: {resistance}
サポート: {support}
強サポート: {strongSupport}

### サマリー
{summary}

## 出力要件
1. 市場分析の追加考察
2. 1-3個のトレードシナリオ
   - 各シナリオにエントリー条件、SL、TP、RR比、信頼度、根拠
3. 全体の信頼度と注意事項
```

---

## 型定義とバリデーション

Side-AではPrismaの型で型安全性を確保しているため、Side-Bも同様にZodを使わずシンプルなTypeScript型＋バリデーション関数で実装。

```typescript
// src/side-b/models/featureVector.ts

/**
 * 12次元特徴量のバリデーション
 */
export function validateFeatureVector(data: unknown): FeatureVector12D {
  const vector = data as Record<string, unknown>;
  const keys: (keyof FeatureVector12D)[] = [
    'trendStrength', 'trendDirection', 'maAlignment', 'pricePosition',
    'rsiLevel', 'macdMomentum', 'momentumDivergence',
    'volatilityLevel', 'bbWidth', 'volatilityTrend',
    'supportProximity', 'resistanceProximity',
  ];

  for (const key of keys) {
    if (!isValidScore(vector[key] as number)) {
      throw new Error(`Invalid ${key}: must be number 0-100`);
    }
  }

  return vector as unknown as FeatureVector12D;
}

// src/side-b/models/marketResearch.ts

/**
 * Research AI出力のバリデーション
 */
export function validateResearchAIOutput(data: unknown): ResearchAIOutput {
  const obj = data as Record<string, unknown>;

  if (!obj.featureVector || !obj.regime || !obj.trend || !obj.volatility || !obj.keyLevels) {
    throw new Error('Required fields missing in Research AI output');
  }

  const featureVector = validateFeatureVector(obj.featureVector);
  // ... 他フィールドのバリデーション
  
  return { featureVector, regime, regimeConfidence, trend, volatility, keyLevels, summary };
}

// src/side-b/models/tradePlan.ts

/**
 * Plan AI出力のバリデーション
 */
export function validatePlanAIOutput(data: unknown): PlanAIOutput {
  const obj = data as Record<string, unknown>;

  if (!obj.marketAnalysis || !obj.scenarios || !Array.isArray(obj.scenarios)) {
    throw new Error('Required fields missing in Plan AI output');
  }

  // シナリオ数のバリデーション (1-3)
  const scenarios = obj.scenarios as unknown[];
  if (scenarios.length < 1 || scenarios.length > 3) {
    throw new Error('scenarios must have 1-3 items');
  }

  return { marketAnalysis, scenarios, overallConfidence, warnings };
}
```

**設計方針:**
- Prismaの型でDBレイヤーは型安全
- AI出力はシンプルなバリデーション関数で検証
- 依存関係を最小限に保つ（Zod不要）

---

## UI設計

### リサーチ確認画面

```
┌─────────────────────────────────────────────────────────┐
│  🔬 市場リサーチ - XAUUSD                               │
│  生成: 2026/01/04 08:00 | 有効期限: 12:00まで           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  【12次元特徴量】                                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │ トレンド強度    ████████░░ 78                    │   │
│  │ トレンド方向    ██████████ 95 (強い上昇)         │   │
│  │ MA配列         █████████░ 85                    │   │
│  │ 価格位置        ███████░░░ 68                    │   │
│  │ RSI            █████░░░░░ 52                    │   │
│  │ MACDモメンタム  ██████░░░░ 62                    │   │
│  │ ダイバージェンス ██░░░░░░░░ 15 (なし)            │   │
│  │ ボラティリティ  ████░░░░░░ 42                    │   │
│  │ BB幅           ███░░░░░░░ 35                    │   │
│  │ ボラ傾向        ████████░░ 75 (拡大中)           │   │
│  │ サポート近接    ██████░░░░ 58                    │   │
│  │ レジスタンス近接 ████░░░░░░ 38                    │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  【レジーム】上昇トレンド（信頼度: 82%）                  │
│  【サマリー】4H足で明確な上昇トレンド継続中。             │
│  RSIは中立圏で過熱感なし。3,240付近がサポート。          │
│                                                         │
│  [🔄 再分析] [📊 このリサーチでプラン生成]               │
└─────────────────────────────────────────────────────────┘
```

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
│   ├── researchController.ts     # リサーチAPI
│   └── planController.ts         # プランAPI
├── services/
│   ├── researchAIService.ts      # Research AI（gpt-4o-mini）
│   ├── planAIService.ts          # Plan AI（gpt-4o）
│   ├── aiOrchestrator.ts         # パイプライン制御
│   └── promptBuilder.ts          # プロンプト構築
├── models/
│   ├── featureVector.ts          # 12次元特徴量型
│   ├── marketResearch.ts         # リサーチ型 + バリデーション
│   └── tradePlan.ts              # プラン型 + バリデーション
├── repositories/
│   ├── researchRepository.ts     # リサーチDB操作
│   └── planRepository.ts         # プランDB操作
└── routes/
    └── sideBRoutes.ts            # /api/side-b/* ルーティング

src/frontend/
└── app/
    └── side-b/
        ├── page.tsx              # Side-Bダッシュボード
        ├── research/
        │   ├── page.tsx          # リサーチ一覧
        │   └── [id]/
        │       └── page.tsx      # リサーチ詳細
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
| 1 | 型定義・バリデーション | 高 | 2h |
| 2 | Research AIプロンプト実装 | 高 | 2h |
| 3 | Plan AIプロンプト実装 | 高 | 2h |
| 4 | リサーチサービス実装 | 高 | 2h |
| 5 | プランサービス実装 | 高 | 2h |
| 6 | オーケストレーター実装 | 中 | 1.5h |
| 7 | リサーチリポジトリ | 中 | 1h |
| 8 | プランリポジトリ | 中 | 1h |
| 9 | コントローラー実装 | 中 | 1.5h |
| 10 | ルーティング設定 | 低 | 0.5h |
| 11 | テスト作成 | 中 | 3h |

### フロントエンド

| # | タスク | 優先度 | 見積 |
|---|--------|--------|------|
| 12 | リサーチ一覧・詳細ページ | 中 | 3h |
| 13 | プラン一覧・詳細ページ | 中 | 3h |
| 14 | 12次元特徴量ビジュアライズ | 中 | 2h |
| 15 | API連携 | 中 | 1.5h |

### インフラ

| # | タスク | 優先度 | 見積 |
|---|--------|--------|------|
| 16 | DBスキーマ設計 | 高 | 1h |
| 17 | マイグレーション作成 | 高 | 0.5h |

**合計見積: 約29時間**

---

## データベーススキーマ

```sql
-- ===========================================
-- 市場リサーチ（中間テーブル）
-- ===========================================
CREATE TABLE market_research (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  timeframe VARCHAR(10) NOT NULL DEFAULT 'multi',
  
  -- 12次元特徴量（Side-A互換）
  feature_vector JSONB NOT NULL,
  
  -- レジーム判定
  regime VARCHAR(30) NOT NULL,
  regime_confidence INTEGER NOT NULL,
  
  -- 分析結果
  trend JSONB NOT NULL,
  volatility JSONB NOT NULL,
  key_levels JSONB NOT NULL,
  summary TEXT NOT NULL,
  
  -- メタ情報
  ai_model VARCHAR(50) NOT NULL,
  token_usage INTEGER,
  raw_indicators JSONB,
  
  -- 有効期限管理
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- インデックス
CREATE INDEX idx_market_research_symbol ON market_research(symbol);
CREATE INDEX idx_market_research_created ON market_research(created_at DESC);
CREATE INDEX idx_market_research_expires ON market_research(expires_at);

-- ===========================================
-- AIトレードプラン
-- ===========================================
CREATE TABLE ai_trade_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 参照
  research_id UUID REFERENCES market_research(id),
  
  -- 基本情報
  target_date DATE NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  
  -- 分析・シナリオ
  market_analysis JSONB NOT NULL,
  scenarios JSONB NOT NULL,
  
  -- メタ情報
  overall_confidence INTEGER,
  warnings TEXT[],
  ai_model VARCHAR(50),
  token_usage INTEGER,
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
| OHLCV取得 | `src/infrastructure/ohlcvRepository.ts` | 価格データ取得 |
| インジケーター計算 | `src/services/indicatorService.ts` | テクニカル指標算出 |
| OpenAI連携 | `src/services/openaiService.ts` | AI API呼び出し |
| 認証 | `src/middleware/authMiddleware.ts` | API認証 |
| 12次元特徴量 | `src/domain/featureVector.ts` | 特徴量計算（要確認） |

### 新規追加が必要なもの

| 項目 | 説明 |
|------|------|
| Research AI プロンプト | 市場データ構造化用 |
| Plan AI プロンプト | シナリオ立案用 |
| キャッシュロジック | リサーチ有効期限管理 |

> **Note**: バリデーションはZodを使わず、Side-Aと同様にPrisma型＋シンプルなバリデーション関数で実現。

---

## 成功基準

### Phase A 完了条件

- [ ] リサーチAPIが動作する（/api/side-b/research/*）
- [ ] プランAPIが動作する（/api/side-b/plans/*）
- [ ] Research AIが12次元特徴量を生成できる
- [ ] Plan AIがシナリオを生成できる
- [ ] リサーチがDBにキャッシュされる
- [ ] キャッシュ有効期限が機能する
- [ ] UIでリサーチ・プランが表示される
- [ ] テストがパスする

### 品質基準

| 指標 | 基準 |
|------|------|
| リサーチ生成時間 | 10秒以内 |
| プラン生成時間 | 20秒以内 |
| AI出力パース成功率 | 95%以上 |
| 12次元特徴量精度 | Side-Aと比較して相関0.7以上 |
| キャッシュヒット率 | 50%以上（同日複数アクセス時） |

---

## リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| AIの出力が不安定 | パースエラー | バリデーション関数 + 最大3回リトライ |
| API料金の増加 | コスト超過 | リサーチキャッシュ + 1日1銘柄1回制限 |
| レスポンス遅延 | UX低下 | ローディング表示 + 進捗インジケーター |
| 12次元特徴量の不整合 | Side-A連携不可 | 算出基準をプロンプトで明確化 |
| キャッシュ過多 | DB肥大化 | 期限切れリサーチの定期削除ジョブ |

---

## 次のステップ

### 実装順序

```
1. 型定義・バリデーション
   ├── featureVector.ts
   ├── marketResearch.ts
   └── tradePlan.ts

2. DBマイグレーション
   └── market_research, ai_trade_plans テーブル

3. Research AI
   ├── promptBuilder.ts（リサーチ用）
   ├── researchAIService.ts
   └── researchRepository.ts

4. Plan AI
   ├── promptBuilder.ts（プラン用）
   ├── planAIService.ts
   └── planRepository.ts

5. オーケストレーター
   └── aiOrchestrator.ts

6. API実装
   ├── researchController.ts
   ├── planController.ts
   └── sideBRoutes.ts

7. フロントエンド
   ├── リサーチ画面
   └── プラン画面

8. テスト・調整
```

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-01-04 | 初版作成 |
| 2026-01-04 | AIアーキテクチャ追加（Research/Plan分離、DB経由パイプライン） |
| 2026-01-04 | 12次元特徴量定義追加（Side-A互換） |
| 2026-01-04 | バリデーション方式変更（Zod → Prisma型＋バリデーション関数） |
| 2026-01-04 | リサーチAPI追加、プロンプト詳細化 |
