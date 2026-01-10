# ROC（Rate of Change）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `roc` |
| カテゴリ | momentum |
| 役割 | 指定期間前との価格変化率を測定 |
| 出力範囲 | 制限なし（%） |

## 計算式

### ROC

```
ROC = ((close - close[n]) / close[n]) × 100

where:
  close = 現在の終値
  close[n] = n期間前の終値
```

### 実装例

```typescript
function calculateROC(closes: number[], period: number = 10): number[] {
  const roc: number[] = [];

  for (let i = period; i < closes.length; i++) {
    const current = closes[i];
    const past = closes[i - period];

    if (past === 0) {
      roc.push(0);
    } else {
      roc.push(((current - past) / past) * 100);
    }
  }

  return roc;
}
```

### ROCの移動平均（シグナルライン）

```typescript
function calculateROCWithSignal(
  closes: number[],
  period: number = 10,
  signalPeriod: number = 9
): { roc: number[]; signal: number[] } {
  const roc = calculateROC(closes, period);

  // シグナルライン（ROCのSMA）
  const signal: number[] = [];
  for (let i = signalPeriod - 1; i < roc.length; i++) {
    const sum = roc.slice(i - signalPeriod + 1, i + 1).reduce((a, b) => a + b, 0);
    signal.push(sum / signalPeriod);
  }

  return {
    roc: roc.slice(signalPeriod - 1),
    signal,
  };
}
```

### ゼロラインクロス検出

```typescript
function detectROCZeroCross(current: number, prev: number): string | null {
  // ゼロを上抜け → 強気シグナル
  if (prev <= 0 && current > 0) return 'bullish';
  // ゼロを下抜け → 弱気シグナル
  if (prev >= 0 && current < 0) return 'bearish';
  return null;
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| period | 10 | 1〜100（整数） | 計算期間 |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| value | number | 現在ROC値（%） |
| zone | string | `positive` / `negative` |
| slope | number | 傾き = ROC[t] - ROC[t-1] |
| zeroCross | string \| null | `bullish` / `bearish` / null |
| momentum | string | `accelerating` / `decelerating` / `stable` |

### zone判定

```typescript
function getROCZone(value: number): string {
  return value >= 0 ? 'positive' : 'negative';
}
```

### momentum判定

```typescript
function getROCMomentum(current: number, prev: number, prevPrev: number): string {
  const slope1 = current - prev;
  const slope2 = prev - prevPrev;

  // 傾きが増加 → 加速
  if (slope1 > slope2 + 0.5) return 'accelerating';
  // 傾きが減少 → 減速
  if (slope1 < slope2 - 0.5) return 'decelerating';
  return 'stable';
}
```

## 類似度計算

| 項目 | 値 |
|------|-----|
| type | absolute |
| weight | 0.9 |

### 重み配分

| 特徴量 | 重み | 許容範囲 |
|--------|------|---------|
| value | 0.40 | ±3% |
| zone | 0.25 | 完全一致 |
| momentum | 0.25 | 完全一致 |
| zeroCross | 0.10 | 完全一致 |

```typescript
function calculateROCSimilarity(
  current: { value: number; zone: string; momentum: string; zeroCross: string | null },
  saved: { value: number; zone: string; momentum: string; zeroCross: string | null }
): number {
  let score = 0;

  // value（40%）
  const valueDiff = Math.abs(current.value - saved.value);
  score += Math.max(0, 1 - valueDiff / 6) * 0.40;

  // zone（25%）
  score += (current.zone === saved.zone ? 1 : 0) * 0.25;

  // momentum（25%）
  score += (current.momentum === saved.momentum ? 1 : 0.3) * 0.25;

  // zeroCross（10%）- ボーナス
  if (current.zeroCross && current.zeroCross === saved.zeroCross) {
    score += 0.10;
  }

  return score;
}
```

## 使い方のポイント

- **ROC > 0**: 価格は期間前より上昇
- **ROC < 0**: 価格は期間前より下落
- **ROCの傾き**: モメンタムの加速/減速を示す
- **ゼロラインクロス**: トレンド転換の可能性

## 禁止事項

- ROC単独での売買判断禁止
- 値が大きい＝買われすぎ、ではない（単純な変化率）
- SMAトレンド方向と併用して確認すること
- 急激な価格変動時は値が極端になるため注意
