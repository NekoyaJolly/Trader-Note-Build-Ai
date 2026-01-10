# ATR（Average True Range）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `atr` |
| カテゴリ | volatility |
| 役割 | ボラティリティの大きさを測定 |
| 出力範囲 | 0〜（価格スケール） |

## 計算式

### Step 1: True Range（TR）の計算

```
TR = max(
  high - low,                    // 当日の高値 - 安値
  abs(high - previousClose),     // 当日の高値 - 前日終値
  abs(low - previousClose)       // 当日の安値 - 前日終値
)
```

### Step 2: ATR計算（Wilder平滑化）

初回（i = period）:
```
ATR = sum(TR[1..period]) / period
```

2回目以降（i > period）:
```
ATR = (ATR_prev * (period - 1) + TR) / period
```

### 実装例

```typescript
interface OHLCData {
  high: number;
  low: number;
  close: number;
}

function calculateATR(data: OHLCData[], period: number = 14): number[] {
  const tr: number[] = [];
  const atr: number[] = [];

  // Step 1: True Range計算
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      // 初回は高値-安値のみ
      tr.push(data[i].high - data[i].low);
    } else {
      const highLow = data[i].high - data[i].low;
      const highPrevClose = Math.abs(data[i].high - data[i - 1].close);
      const lowPrevClose = Math.abs(data[i].low - data[i - 1].close);
      tr.push(Math.max(highLow, highPrevClose, lowPrevClose));
    }
  }

  // Step 2: ATR計算（Wilder平滑化）
  // 初回: 単純平均
  let atrValue = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  atr.push(atrValue);

  // 以降: Wilder平滑化
  for (let i = period; i < tr.length; i++) {
    atrValue = (atrValue * (period - 1) + tr[i]) / period;
    atr.push(atrValue);
  }

  return atr;
}
```

### ATRの用途

```typescript
// ストップロス計算（ATR × 倍率）
function calculateStopLoss(entryPrice: number, atr: number, multiplier: number = 2): number {
  return entryPrice - atr * multiplier;  // ロングの場合
}

// ポジションサイズ計算
function calculatePositionSize(riskAmount: number, atr: number, multiplier: number = 2): number {
  return riskAmount / (atr * multiplier);
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| period | 14 | 1〜100（整数） | 計算期間 |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| value | number | 現在ATR値 |
| percentOfPrice | number | ATR / 現在価格 × 100（%） |
| trend | string | `expanding` / `contracting` / `stable` |
| level | string | `high` / `normal` / `low` |

### percentOfPrice計算

```typescript
// 価格に対するATRの比率（ボラティリティの相対評価）
const percentOfPrice = (atr / currentPrice) * 100;
```

### trend判定

```typescript
function getATRTrend(current: number, prev: number, threshold: number = 0.05): string {
  const change = (current - prev) / prev;
  if (change > threshold) return 'expanding';
  if (change < -threshold) return 'contracting';
  return 'stable';
}
```

### level判定

```typescript
// 過去N期間との比較でレベル判定
function getATRLevel(current: number, history: number[]): string {
  const avg = history.reduce((a, b) => a + b, 0) / history.length;
  const ratio = current / avg;
  if (ratio > 1.5) return 'high';
  if (ratio < 0.7) return 'low';
  return 'normal';
}
```

## 類似度計算

| 項目 | 値 |
|------|-----|
| type | relative |
| weight | 0.7 |

### 重み配分

| 特徴量 | 重み | 許容範囲 |
|--------|------|---------|
| percentOfPrice | 0.50 | ±0.5% |
| trend | 0.30 | 完全一致 |
| level | 0.20 | 完全一致 |

```typescript
function calculateATRSimilarity(
  current: { percentOfPrice: number; trend: string; level: string },
  saved: { percentOfPrice: number; trend: string; level: string }
): number {
  let score = 0;

  // percentOfPrice（50%）
  const pctDiff = Math.abs(current.percentOfPrice - saved.percentOfPrice);
  score += Math.max(0, 1 - pctDiff / 1.0) * 0.50;

  // trend（30%）
  score += (current.trend === saved.trend ? 1 : 0.3) * 0.30;

  // level（20%）
  score += (current.level === saved.level ? 1 : 0.3) * 0.20;

  return score;
}
```

## 禁止事項

- ATR単独での売買判断禁止（方向性を示さないため）
- ATRは「どれくらい動くか」を示すが「どちらに動くか」は示さない
- ストップロス/ポジションサイズの参考値として使用
