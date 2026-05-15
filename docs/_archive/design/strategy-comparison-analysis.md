# ストラテジー横断分析機能 設計書

> **Phase**: Next  
> **優先度**: 高  
> **作成日**: 2026-01-08

---

## 1. 概要

### 1.1 目的

複数のストラテジーを横断的に分析し、以下を実現する：

- 同一期間での複数ストラテジー比較
- ストラテジー間の相関分析
- ポートフォリオ最適化シミュレーション

### 1.2 ユースケース

1. **比較分析**: 「RSI逆張り」と「ブレイクアウト」戦略のパフォーマンス比較
2. **相関分析**: 異なる戦略が同時に勝つ/負ける傾向を把握
3. **最適化**: リスク分散のための最適な戦略組み合わせを発見

---

## 2. データモデル

### 2.1 新規テーブル

```prisma
/// ストラテジー比較セッション
/// 複数ストラテジーの比較分析を管理
model StrategyComparisonSession {
  id              String   @id @default(uuid()) @db.Uuid
  /// セッション名（例: "2025年Q4比較"）
  name            String
  /// 比較対象ストラテジーID配列
  strategyIds     String[] @default([])
  /// 分析期間開始日
  startDate       DateTime @db.Date
  /// 分析期間終了日
  endDate         DateTime @db.Date
  /// 時間足
  timeframe       String   @default("1h")
  /// 作成日時
  createdAt       DateTime @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt       DateTime @updatedAt @db.Timestamptz(6)
  
  // リレーション
  results         StrategyComparisonResult[]
  correlations    StrategyCorrelation[]
  optimizations   PortfolioOptimization[]
  
  @@index([createdAt(sort: Desc)], map: "idx_comparison_session_created")
}

/// ストラテジー比較結果
/// 各ストラテジーの期間別パフォーマンス
model StrategyComparisonResult {
  id              String   @id @default(uuid()) @db.Uuid
  /// セッションID
  sessionId       String   @db.Uuid
  /// ストラテジーID
  strategyId      String   @db.Uuid
  
  // パフォーマンス指標
  /// トレード数
  totalTrades     Int
  /// 勝率（0-1）
  winRate         Float
  /// プロフィットファクター
  profitFactor    Float?
  /// 純損益
  netProfit       Decimal  @db.Decimal(18, 8)
  /// 最大ドローダウン
  maxDrawdown     Decimal  @db.Decimal(18, 8)
  /// シャープレシオ
  sharpeRatio     Float?
  /// ソルティノレシオ
  sortinoRatio    Float?
  /// カルマーレシオ（年間リターン/最大DD）
  calmarRatio     Float?
  
  // 時系列データ（JSONB）
  /// 日次リターン配列
  dailyReturns    Json?
  /// エクイティカーブ
  equityCurve     Json?
  
  /// 作成日時
  createdAt       DateTime @default(now()) @db.Timestamptz(6)
  
  // リレーション
  session         StrategyComparisonSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  
  @@unique([sessionId, strategyId], map: "uq_comparison_result_session_strategy")
  @@index([sessionId], map: "idx_comparison_result_session")
}

/// ストラテジー相関
/// ストラテジーペア間の相関係数
model StrategyCorrelation {
  id              String   @id @default(uuid()) @db.Uuid
  /// セッションID
  sessionId       String   @db.Uuid
  /// ストラテジーA ID
  strategyAId     String   @db.Uuid
  /// ストラテジーB ID
  strategyBId     String   @db.Uuid
  
  // 相関指標
  /// ピアソン相関係数（-1〜1）
  pearsonCorr     Float
  /// スピアマン順位相関係数
  spearmanCorr    Float?
  /// 同時勝率（両方勝つ確率）
  coWinRate       Float?
  /// 同時負け率（両方負ける確率）
  coLossRate      Float?
  
  /// 作成日時
  createdAt       DateTime @default(now()) @db.Timestamptz(6)
  
  // リレーション
  session         StrategyComparisonSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  
  @@unique([sessionId, strategyAId, strategyBId], map: "uq_correlation_session_pair")
  @@index([sessionId], map: "idx_correlation_session")
}

/// ポートフォリオ最適化結果
model PortfolioOptimization {
  id              String   @id @default(uuid()) @db.Uuid
  /// セッションID
  sessionId       String   @db.Uuid
  /// 最適化手法（mean_variance, risk_parity, equal_weight）
  method          String
  
  // 最適化結果
  /// 各ストラテジーの配分比率（JSONB: {strategyId: weight}）
  weights         Json
  /// 期待リターン
  expectedReturn  Float
  /// 期待リスク（標準偏差）
  expectedRisk    Float
  /// シャープレシオ
  sharpeRatio     Float?
  
  /// 作成日時
  createdAt       DateTime @default(now()) @db.Timestamptz(6)
  
  // リレーション
  session         StrategyComparisonSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  
  @@index([sessionId], map: "idx_optimization_session")
}
```

---

## 3. API設計

### 3.1 エンドポイント一覧

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/strategies/compare` | 比較セッション作成・分析実行 |
| GET | `/api/strategies/compare/:sessionId` | 比較結果取得 |
| GET | `/api/strategies/compare` | 比較履歴一覧 |
| DELETE | `/api/strategies/compare/:sessionId` | 比較セッション削除 |
| POST | `/api/strategies/compare/:sessionId/optimize` | ポートフォリオ最適化実行 |

### 3.2 リクエスト/レスポンス

#### POST /api/strategies/compare

```typescript
// リクエスト
interface CreateComparisonRequest {
  name: string;
  strategyIds: string[];  // 2〜10個
  startDate: string;      // YYYY-MM-DD
  endDate: string;
  timeframe?: string;     // デフォルト: 1h
}

// レスポンス
interface ComparisonSessionResponse {
  id: string;
  name: string;
  strategyIds: string[];
  startDate: string;
  endDate: string;
  timeframe: string;
  results: StrategyResult[];
  correlations: CorrelationMatrix;
  summary: ComparisonSummary;
}

interface StrategyResult {
  strategyId: string;
  strategyName: string;
  symbol: string;
  side: 'buy' | 'sell';
  totalTrades: number;
  winRate: number;
  profitFactor: number | null;
  netProfit: number;
  maxDrawdown: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  dailyReturns: number[];
  equityCurve: { date: string; equity: number }[];
}

interface CorrelationMatrix {
  strategyIds: string[];
  pearson: number[][];    // NxN行列
  spearman: number[][];
  coWinRate: number[][];
  coLossRate: number[][];
}

interface ComparisonSummary {
  bestWinRate: { strategyId: string; value: number };
  bestProfitFactor: { strategyId: string; value: number };
  lowestDrawdown: { strategyId: string; value: number };
  bestSharpe: { strategyId: string; value: number };
  recommendations: string[];
}
```

#### POST /api/strategies/compare/:sessionId/optimize

```typescript
// リクエスト
interface OptimizeRequest {
  method: 'mean_variance' | 'risk_parity' | 'equal_weight';
  targetReturn?: number;   // mean_variance用
  riskFreeRate?: number;   // シャープレシオ計算用（デフォルト: 0）
}

// レスポンス
interface OptimizationResponse {
  method: string;
  weights: { strategyId: string; weight: number }[];
  expectedReturn: number;
  expectedRisk: number;
  sharpeRatio: number;
  efficientFrontier?: { risk: number; return: number }[];
}
```

---

## 4. 計算ロジック

### 4.1 パフォーマンス指標

```typescript
/**
 * シャープレシオ計算
 * (平均リターン - リスクフリーレート) / 標準偏差
 */
function calculateSharpeRatio(
  dailyReturns: number[],
  riskFreeRate: number = 0
): number {
  const avgReturn = mean(dailyReturns);
  const stdDev = standardDeviation(dailyReturns);
  
  if (stdDev === 0) return 0;
  
  // 年率換算（252取引日）
  const annualizedReturn = avgReturn * 252;
  const annualizedStdDev = stdDev * Math.sqrt(252);
  
  return (annualizedReturn - riskFreeRate) / annualizedStdDev;
}

/**
 * ソルティノレシオ計算
 * 下方リスクのみを考慮
 */
function calculateSortinoRatio(
  dailyReturns: number[],
  riskFreeRate: number = 0
): number {
  const avgReturn = mean(dailyReturns);
  const negativeReturns = dailyReturns.filter(r => r < 0);
  const downsideDeviation = standardDeviation(negativeReturns);
  
  if (downsideDeviation === 0) return Infinity;
  
  const annualizedReturn = avgReturn * 252;
  const annualizedDownside = downsideDeviation * Math.sqrt(252);
  
  return (annualizedReturn - riskFreeRate) / annualizedDownside;
}

/**
 * カルマーレシオ計算
 * 年間リターン / 最大ドローダウン
 */
function calculateCalmarRatio(
  dailyReturns: number[],
  maxDrawdown: number
): number {
  if (maxDrawdown === 0) return Infinity;
  
  const totalReturn = dailyReturns.reduce((a, b) => a + b, 0);
  const annualizedReturn = totalReturn * (252 / dailyReturns.length);
  
  return annualizedReturn / Math.abs(maxDrawdown);
}
```

### 4.2 相関分析

```typescript
/**
 * ピアソン相関係数
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  const meanX = mean(x);
  const meanY = mean(y);
  
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  
  const denominator = Math.sqrt(denomX * denomY);
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * 同時勝敗率
 */
function calculateCoWinLossRate(
  tradesA: { outcome: 'win' | 'loss'; timestamp: Date }[],
  tradesB: { outcome: 'win' | 'loss'; timestamp: Date }[]
): { coWinRate: number; coLossRate: number } {
  // 同一日のトレードをマッチング
  const dailyResultsA = groupByDay(tradesA);
  const dailyResultsB = groupByDay(tradesB);
  
  let coWins = 0;
  let coLosses = 0;
  let totalOverlap = 0;
  
  for (const [day, resultA] of dailyResultsA) {
    const resultB = dailyResultsB.get(day);
    if (!resultB) continue;
    
    totalOverlap++;
    if (resultA === 'win' && resultB === 'win') coWins++;
    if (resultA === 'loss' && resultB === 'loss') coLosses++;
  }
  
  return {
    coWinRate: totalOverlap > 0 ? coWins / totalOverlap : 0,
    coLossRate: totalOverlap > 0 ? coLosses / totalOverlap : 0,
  };
}
```

### 4.3 ポートフォリオ最適化

```typescript
/**
 * 平均分散最適化（マーコビッツ）
 * 
 * 目的: シャープレシオ最大化
 */
function meanVarianceOptimization(
  returns: number[][],        // 各ストラテジーの日次リターン
  covarianceMatrix: number[][], // 共分散行列
  riskFreeRate: number = 0
): number[] {
  const n = returns.length;
  const expectedReturns = returns.map(r => mean(r));
  
  // 制約条件: 
  // - 各ウェイト >= 0
  // - ウェイト合計 = 1
  
  // 二次計画法で解く（簡易版: グリッドサーチ）
  let bestWeights: number[] = new Array(n).fill(1 / n);
  let bestSharpe = -Infinity;
  
  // グリッドサーチ（本番では quadprog ライブラリ使用推奨）
  const step = 0.1;
  const combinations = generateWeightCombinations(n, step);
  
  for (const weights of combinations) {
    const portfolioReturn = dotProduct(weights, expectedReturns);
    const portfolioVariance = quadraticForm(weights, covarianceMatrix);
    const portfolioStdDev = Math.sqrt(portfolioVariance);
    
    const sharpe = (portfolioReturn - riskFreeRate) / portfolioStdDev;
    
    if (sharpe > bestSharpe) {
      bestSharpe = sharpe;
      bestWeights = weights;
    }
  }
  
  return bestWeights;
}

/**
 * リスクパリティ最適化
 * 
 * 各ストラテジーのリスク寄与度を均等化
 */
function riskParityOptimization(
  covarianceMatrix: number[][]
): number[] {
  const n = covarianceMatrix.length;
  
  // 逆分散ウェイト（簡易版）
  const variances = covarianceMatrix.map((row, i) => row[i]);
  const invVar = variances.map(v => 1 / Math.sqrt(v));
  const sum = invVar.reduce((a, b) => a + b, 0);
  
  return invVar.map(w => w / sum);
}
```

---

## 5. UI設計

### 5.1 比較ダッシュボード

```
┌─────────────────────────────────────────────────────────────────┐
│  ストラテジー比較分析                              [新規作成]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  期間: 2025-10-01 〜 2025-12-31  |  時間足: 1h                 │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  パフォーマンス比較                                      │   │
│  │                                                           │   │
│  │  ストラテジー    勝率    PF     DD     シャープ  ランク   │   │
│  │  ─────────────────────────────────────────────────────   │   │
│  │  RSI逆張り      58.3%  1.42   -5.2%    1.23      1位     │   │
│  │  ブレイクアウト  52.1%  1.18   -8.1%    0.87      2位     │   │
│  │  トレンドフォロー 61.2%  1.65   -12.3%   0.95      3位     │   │
│  │                                                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌────────────────────────┐  ┌────────────────────────────┐   │
│  │  相関マトリクス         │  │  エクイティカーブ          │   │
│  │                        │  │                            │   │
│  │      RSI  BRK  TRD     │  │  ▲                         │   │
│  │  RSI  1.0  0.3  -0.2   │  │   ╲__╱╲                    │   │
│  │  BRK  0.3  1.0   0.5   │  │        ╲___╱╲__           │   │
│  │  TRD -0.2  0.5   1.0   │  │                ╲____      │   │
│  │                        │  │                            │   │
│  └────────────────────────┘  └────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ポートフォリオ最適化                    [最適化実行]    │   │
│  │                                                           │   │
│  │  手法: [平均分散 ▼]                                      │   │
│  │                                                           │   │
│  │  推奨配分:                                                │   │
│  │  ├─ RSI逆張り: 45%  ████████████████████░░░░░░░░░░░░░   │   │
│  │  ├─ ブレイクアウト: 35%  ██████████████░░░░░░░░░░░░░░░   │   │
│  │  └─ トレンドフォロー: 20%  ████████░░░░░░░░░░░░░░░░░░░   │   │
│  │                                                           │   │
│  │  期待リターン: +18.5%/年  |  期待リスク: 12.3%           │   │
│  │  シャープレシオ: 1.50                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. 実装ステップ

### Phase 1: 基盤構築（3日）
1. Prisma スキーマ追加
2. 基本API実装（比較セッション CRUD）
3. パフォーマンス指標計算サービス

### Phase 2: 相関分析（2日）
1. 相関係数計算ロジック
2. 同時勝敗率計算
3. 相関マトリクスAPI

### Phase 3: ポートフォリオ最適化（3日）
1. 平均分散最適化
2. リスクパリティ最適化
3. 効率的フロンティア計算

### Phase 4: UI実装（3日）
1. 比較ダッシュボードページ
2. 相関マトリクス可視化
3. エクイティカーブチャート
4. 最適化結果表示

---

## 7. 依存ライブラリ

```json
{
  "dependencies": {
    "ml-matrix": "^6.10.0",     // 行列演算
    "simple-statistics": "^7.8.0" // 統計計算
  }
}
```

---

## 8. テスト計画

- [ ] パフォーマンス指標計算の精度テスト
- [ ] 相関係数計算のエッジケーステスト
- [ ] ポートフォリオ最適化の収束テスト
- [ ] API エンドポイントの統合テスト
- [ ] UI コンポーネントのスナップショットテスト

