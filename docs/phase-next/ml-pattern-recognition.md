# 機械学習パターン認識機能 設計書

> **Phase**: Next  
> **優先度**: 高  
> **作成日**: 2026-01-08

---

## 1. 概要

### 1.1 目的

TensorFlow.js を活用した高度なパターン認識機能を実装し、以下を実現する：

- パターン分類（チャートパターンの自動識別）
- 自動特徴量エンジニアリング（最適な特徴量の発見）
- 異常検知アラート（通常と異なる市場状態の検出）

### 1.2 アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────────┐
│                    ML パイプライン                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐ │
│  │ データ   │ → │ 前処理   │ → │ モデル   │ → │ 予測     │ │
│  │ 取得     │    │ 正規化   │    │ 推論     │    │ 後処理   │ │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘ │
│       ↑                              ↓                         │
│  ┌──────────┐                   ┌──────────┐                   │
│  │ OHLCV    │                   │ 結果保存 │                   │
│  │ データ   │                   │ DB永続化 │                   │
│  └──────────┘                   └──────────┘                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 機能詳細

### 2.1 パターン分類

#### 対象パターン

| カテゴリ | パターン名 | 説明 |
|---------|-----------|------|
| **反転** | ダブルトップ | 高値2回で反転 |
| | ダブルボトム | 安値2回で反転 |
| | ヘッドアンドショルダー | 3つの山で反転 |
| | 逆ヘッドアンドショルダー | 3つの谷で反転 |
| **継続** | フラッグ | 急騰/急落後の調整 |
| | ペナント | 三角持ち合い |
| | ウェッジ | 収束する高値安値 |
| **その他** | トライアングル | 対称/上昇/下降 |
| | レクタングル | 横ばいボックス |

#### モデルアーキテクチャ

```typescript
/**
 * CNN-LSTM ハイブリッドモデル
 * 
 * CNN: ローカルパターン抽出
 * LSTM: 時系列依存性学習
 */
function createPatternClassifier(): tf.LayersModel {
  const model = tf.sequential();
  
  // 入力: [バッチ, 時系列長, 特徴量数]
  // 例: [32, 50, 5] = 32サンプル x 50本 x OHLCV
  
  // 1D CNN レイヤー（パターン抽出）
  model.add(tf.layers.conv1d({
    inputShape: [50, 5],
    filters: 64,
    kernelSize: 3,
    activation: 'relu',
  }));
  model.add(tf.layers.maxPooling1d({ poolSize: 2 }));
  
  model.add(tf.layers.conv1d({
    filters: 128,
    kernelSize: 3,
    activation: 'relu',
  }));
  model.add(tf.layers.maxPooling1d({ poolSize: 2 }));
  
  // LSTM レイヤー（時系列学習）
  model.add(tf.layers.lstm({
    units: 64,
    returnSequences: false,
  }));
  
  model.add(tf.layers.dropout({ rate: 0.3 }));
  
  // 出力: パターン分類（10クラス）
  model.add(tf.layers.dense({
    units: 10,
    activation: 'softmax',
  }));
  
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });
  
  return model;
}
```

### 2.2 自動特徴量エンジニアリング

#### 特徴量候補プール

```typescript
/**
 * 自動生成される特徴量候補
 */
const FEATURE_CANDIDATES = {
  // 価格ベース
  price: [
    'close',
    'high_low_range',      // (high - low) / close
    'close_open_ratio',    // (close - open) / open
    'upper_shadow',        // (high - max(open, close)) / (high - low)
    'lower_shadow',        // (min(open, close) - low) / (high - low)
  ],
  
  // 移動平均
  ma: [
    'sma_5', 'sma_10', 'sma_20', 'sma_50',
    'ema_5', 'ema_10', 'ema_20', 'ema_50',
    'sma_cross_5_20',      // SMA5 > SMA20 ? 1 : 0
    'price_to_sma_20',     // close / sma_20
  ],
  
  // モメンタム
  momentum: [
    'rsi_14',
    'macd_histogram',
    'stoch_k', 'stoch_d',
    'williams_r',
    'cci_20',
  ],
  
  // ボラティリティ
  volatility: [
    'atr_14',
    'bb_width',            // (upper - lower) / middle
    'bb_position',         // (close - lower) / (upper - lower)
    'keltner_position',
  ],
  
  // ボリューム
  volume: [
    'volume_sma_ratio',    // volume / sma_volume_20
    'obv_trend',           // OBV の傾き
    'mfi_14',
    'cmf_20',
  ],
  
  // パターン
  pattern: [
    'higher_high',         // 前日比高値更新
    'lower_low',           // 前日比安値更新
    'inside_bar',          // 前日の範囲内
    'outside_bar',         // 前日の範囲外
  ],
};

/**
 * 特徴量重要度計算（Permutation Importance）
 */
async function calculateFeatureImportance(
  model: tf.LayersModel,
  X: tf.Tensor,
  y: tf.Tensor,
  featureNames: string[]
): Promise<Map<string, number>> {
  const baseAccuracy = await evaluateModel(model, X, y);
  const importances = new Map<string, number>();
  
  for (let i = 0; i < featureNames.length; i++) {
    // 特徴量をシャッフル
    const shuffledX = shuffleFeature(X, i);
    const shuffledAccuracy = await evaluateModel(model, shuffledX, y);
    
    // 精度低下 = 重要度
    const importance = baseAccuracy - shuffledAccuracy;
    importances.set(featureNames[i], importance);
    
    shuffledX.dispose();
  }
  
  return importances;
}
```

#### 特徴量選択アルゴリズム

```typescript
/**
 * Recursive Feature Elimination (RFE)
 * 
 * 重要度の低い特徴量を順次削除
 */
async function recursiveFeatureElimination(
  X: tf.Tensor,
  y: tf.Tensor,
  featureNames: string[],
  targetFeatureCount: number
): Promise<string[]> {
  let currentFeatures = [...featureNames];
  let currentX = X;
  
  while (currentFeatures.length > targetFeatureCount) {
    // モデル訓練
    const model = createLightweightModel(currentFeatures.length);
    await model.fit(currentX, y, { epochs: 10, verbose: 0 });
    
    // 重要度計算
    const importances = await calculateFeatureImportance(
      model, currentX, y, currentFeatures
    );
    
    // 最も重要度の低い特徴量を削除
    const leastImportant = [...importances.entries()]
      .sort((a, b) => a[1] - b[1])[0][0];
    
    const removeIndex = currentFeatures.indexOf(leastImportant);
    currentFeatures.splice(removeIndex, 1);
    currentX = removeFeatureColumn(currentX, removeIndex);
    
    model.dispose();
  }
  
  return currentFeatures;
}
```

### 2.3 異常検知アラート

#### Autoencoder ベースの異常検知

```typescript
/**
 * Autoencoder モデル
 * 
 * 正常データで学習し、再構成誤差が大きいデータを異常として検出
 */
function createAnomalyDetector(inputDim: number): tf.LayersModel {
  const encoder = tf.sequential();
  encoder.add(tf.layers.dense({
    inputShape: [inputDim],
    units: 32,
    activation: 'relu',
  }));
  encoder.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  encoder.add(tf.layers.dense({ units: 8, activation: 'relu' }));  // Latent
  
  const decoder = tf.sequential();
  decoder.add(tf.layers.dense({
    inputShape: [8],
    units: 16,
    activation: 'relu',
  }));
  decoder.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  decoder.add(tf.layers.dense({ units: inputDim, activation: 'linear' }));
  
  // 結合
  const input = tf.input({ shape: [inputDim] });
  const encoded = encoder.apply(input) as tf.SymbolicTensor;
  const decoded = decoder.apply(encoded) as tf.SymbolicTensor;
  
  const autoencoder = tf.model({ inputs: input, outputs: decoded });
  
  autoencoder.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'meanSquaredError',
  });
  
  return autoencoder;
}

/**
 * 異常スコア計算
 */
async function calculateAnomalyScore(
  model: tf.LayersModel,
  data: tf.Tensor
): Promise<number[]> {
  const reconstructed = model.predict(data) as tf.Tensor;
  const mse = tf.losses.meanSquaredError(data, reconstructed);
  const scores = await mse.data();
  
  reconstructed.dispose();
  mse.dispose();
  
  return Array.from(scores);
}
```

#### 異常タイプの分類

```typescript
/**
 * 異常の種類を判定
 */
interface AnomalyResult {
  timestamp: Date;
  score: number;
  type: AnomalyType;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

type AnomalyType =
  | 'volatility_spike'      // ボラティリティ急上昇
  | 'volume_anomaly'        // 出来高異常
  | 'price_gap'             // 価格ギャップ
  | 'pattern_break'         // パターン崩壊
  | 'correlation_break'     // 相関崩壊
  | 'unknown';              // 未分類

function classifyAnomaly(
  features: number[],
  normalRanges: Map<string, [number, number]>
): AnomalyType {
  // 各特徴量の正常範囲からの逸脱を確認
  const deviations: { feature: string; deviation: number }[] = [];
  
  for (const [feature, [min, max]] of normalRanges) {
    const idx = FEATURE_INDEX[feature];
    const value = features[idx];
    
    if (value < min) {
      deviations.push({ feature, deviation: (min - value) / (max - min) });
    } else if (value > max) {
      deviations.push({ feature, deviation: (value - max) / (max - min) });
    }
  }
  
  // 最大逸脱の特徴量で分類
  if (deviations.length === 0) return 'unknown';
  
  const maxDeviation = deviations.sort((a, b) => b.deviation - a.deviation)[0];
  
  if (maxDeviation.feature.includes('volatility')) return 'volatility_spike';
  if (maxDeviation.feature.includes('volume')) return 'volume_anomaly';
  if (maxDeviation.feature.includes('gap')) return 'price_gap';
  
  return 'unknown';
}
```

---

## 3. データモデル

### 3.1 新規テーブル

```prisma
/// MLモデル管理
model MLModel {
  id              String   @id @default(uuid()) @db.Uuid
  /// モデル名（例: "pattern_classifier_v1"）
  name            String   @unique
  /// モデルタイプ
  type            MLModelType
  /// モデルファイルパス（S3 or ローカル）
  modelPath       String
  /// 入力特徴量名リスト
  inputFeatures   String[]
  /// 出力クラス名リスト（分類の場合）
  outputClasses   String[]
  /// 訓練時のメトリクス（JSONB）
  trainingMetrics Json?
  /// バージョン
  version         Int      @default(1)
  /// 有効フラグ
  active          Boolean  @default(true)
  /// 作成日時
  createdAt       DateTime @default(now()) @db.Timestamptz(6)
  /// 更新日時
  updatedAt       DateTime @updatedAt @db.Timestamptz(6)
  
  predictions     MLPrediction[]
  
  @@index([type, active], map: "idx_mlmodel_type_active")
}

/// ML予測結果
model MLPrediction {
  id              String   @id @default(uuid()) @db.Uuid
  /// 使用モデルID
  modelId         String   @db.Uuid
  /// 対象シンボル
  symbol          String
  /// 予測時刻
  timestamp       DateTime @db.Timestamptz(6)
  
  // 予測結果
  /// 予測クラス（分類の場合）
  predictedClass  String?
  /// 予測確率（JSONB: {class: probability}）
  probabilities   Json?
  /// 異常スコア（異常検知の場合）
  anomalyScore    Float?
  /// 予測値（回帰の場合）
  predictedValue  Float?
  
  /// 作成日時
  createdAt       DateTime @default(now()) @db.Timestamptz(6)
  
  model           MLModel  @relation(fields: [modelId], references: [id], onDelete: Cascade)
  
  @@index([modelId, timestamp], map: "idx_mlprediction_model_time")
  @@index([symbol, timestamp], map: "idx_mlprediction_symbol_time")
}

/// 異常検知アラート
model AnomalyAlert {
  id              String   @id @default(uuid()) @db.Uuid
  /// 対象シンボル
  symbol          String
  /// 検知時刻
  detectedAt      DateTime @db.Timestamptz(6)
  /// 異常タイプ
  type            AnomalyType
  /// 異常スコア（0-1）
  score           Float
  /// 重要度
  severity        AlertSeverity
  /// 説明
  description     String
  /// 関連特徴量（JSONB）
  relatedFeatures Json?
  /// 既読フラグ
  acknowledged    Boolean  @default(false)
  /// 作成日時
  createdAt       DateTime @default(now()) @db.Timestamptz(6)
  
  @@index([symbol, detectedAt], map: "idx_anomaly_symbol_detected")
  @@index([acknowledged, severity], map: "idx_anomaly_ack_severity")
}

/// MLモデルタイプ
enum MLModelType {
  /// パターン分類
  pattern_classifier
  /// 異常検知
  anomaly_detector
  /// 価格予測
  price_predictor
  /// 特徴量選択
  feature_selector
}

/// 異常タイプ
enum AnomalyType {
  volatility_spike
  volume_anomaly
  price_gap
  pattern_break
  correlation_break
  unknown
}

/// アラート重要度
enum AlertSeverity {
  low
  medium
  high
  critical
}
```

---

## 4. API設計

### 4.1 エンドポイント一覧

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/ml/patterns/detect` | パターン検出実行 |
| GET | `/api/ml/patterns/history` | パターン検出履歴 |
| POST | `/api/ml/features/analyze` | 特徴量重要度分析 |
| GET | `/api/ml/features/recommended` | 推奨特徴量取得 |
| POST | `/api/ml/anomalies/scan` | 異常スキャン実行 |
| GET | `/api/ml/anomalies` | 異常アラート一覧 |
| PUT | `/api/ml/anomalies/:id/acknowledge` | アラート確認 |
| GET | `/api/ml/models` | モデル一覧 |
| POST | `/api/ml/models/:id/retrain` | モデル再訓練 |

### 4.2 リクエスト/レスポンス

#### POST /api/ml/patterns/detect

```typescript
// リクエスト
interface PatternDetectRequest {
  symbol: string;
  timeframe: string;
  lookbackBars?: number;  // デフォルト: 50
}

// レスポンス
interface PatternDetectResponse {
  symbol: string;
  timestamp: string;
  patterns: DetectedPattern[];
}

interface DetectedPattern {
  name: string;           // 例: "double_top"
  confidence: number;     // 0-1
  startBar: number;       // パターン開始位置
  endBar: number;         // パターン終了位置
  implications: {
    direction: 'bullish' | 'bearish' | 'neutral';
    targetPrice?: number;
    stopLoss?: number;
  };
}
```

#### POST /api/ml/anomalies/scan

```typescript
// リクエスト
interface AnomalyScanRequest {
  symbols: string[];
  timeframe: string;
  threshold?: number;     // デフォルト: 0.95（95パーセンタイル以上を異常とする）
}

// レスポンス
interface AnomalyScanResponse {
  scannedAt: string;
  results: AnomalyResult[];
}

interface AnomalyResult {
  symbol: string;
  timestamp: string;
  score: number;
  type: AnomalyType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  relatedFeatures: { name: string; value: number; normalRange: [number, number] }[];
}
```

---

## 5. モデル管理

### 5.1 モデルライフサイクル

```
┌─────────────────────────────────────────────────────────────────┐
│                    モデルライフサイクル                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐ │
│  │ 訓練     │ → │ 検証     │ → │ デプロイ │ → │ 監視     │ │
│  │ Training │    │ Validation│   │ Deploy   │    │ Monitor  │ │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘ │
│       ↑                                              ↓         │
│       └──────────────────────────────────────────────┘         │
│                         再訓練トリガー                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 モデル保存・読み込み

```typescript
/**
 * モデルの保存
 */
async function saveModel(
  model: tf.LayersModel,
  name: string,
  metadata: ModelMetadata
): Promise<string> {
  const modelPath = `models/${name}/model.json`;
  
  // TensorFlow.js 形式で保存
  await model.save(`file://${modelPath}`);
  
  // メタデータをDBに保存
  await prisma.mLModel.create({
    data: {
      name,
      type: metadata.type,
      modelPath,
      inputFeatures: metadata.inputFeatures,
      outputClasses: metadata.outputClasses,
      trainingMetrics: metadata.metrics,
      version: 1,
      active: true,
    },
  });
  
  return modelPath;
}

/**
 * モデルの読み込み
 */
async function loadModel(name: string): Promise<tf.LayersModel> {
  const record = await prisma.mLModel.findUnique({
    where: { name },
  });
  
  if (!record || !record.active) {
    throw new Error(`モデル ${name} が見つかりません`);
  }
  
  return tf.loadLayersModel(`file://${record.modelPath}`);
}
```

---

## 6. 実装ステップ

### Phase 1: 基盤構築（3日）
1. TensorFlow.js セットアップ
2. Prisma スキーマ追加
3. 基本API実装

### Phase 2: パターン分類（5日）
1. データ前処理パイプライン
2. CNN-LSTM モデル実装
3. パターンラベリングツール
4. 訓練・評価スクリプト

### Phase 3: 特徴量エンジニアリング（3日）
1. 特徴量候補生成
2. 重要度計算（Permutation Importance）
3. RFE 実装
4. 推奨特徴量 API

### Phase 4: 異常検知（4日）
1. Autoencoder モデル実装
2. 異常スコア計算
3. 異常タイプ分類
4. アラート生成・通知

### Phase 5: UI実装（3日）
1. パターン検出結果表示
2. 異常アラートダッシュボード
3. モデル管理画面

---

## 7. 依存ライブラリ

```json
{
  "dependencies": {
    "@tensorflow/tfjs": "^4.15.0",
    "@tensorflow/tfjs-node": "^4.15.0"
  }
}
```

---

## 8. パフォーマンス考慮

### 8.1 推論速度

| モデル | 入力サイズ | 推論時間（目標） |
|--------|-----------|------------------|
| パターン分類 | [50, 5] | < 50ms |
| 異常検知 | [1, 20] | < 10ms |

### 8.2 メモリ管理

```typescript
/**
 * テンソルのメモリ管理
 */
async function runInference(model: tf.LayersModel, data: number[][]): Promise<number[]> {
  // tf.tidy でメモリリークを防止
  return tf.tidy(() => {
    const input = tf.tensor2d(data);
    const output = model.predict(input) as tf.Tensor;
    return Array.from(output.dataSync());
  });
}
```

---

## 9. テスト計画

- [ ] モデル精度テスト（Accuracy > 80%）
- [ ] 推論速度テスト（< 50ms）
- [ ] メモリリークテスト
- [ ] 異常検知の再現率テスト
- [ ] API エンドポイントの統合テスト

