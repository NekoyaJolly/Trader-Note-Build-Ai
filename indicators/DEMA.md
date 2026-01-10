# DEMA（Double Exponential Moving Average）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `dema` |
| カテゴリ | trend |
| 役割 | EMAのラグを軽減した高速移動平均 |
| 出力範囲 | 価格と同じ |

## 計算式

### DEMA

```
DEMA = 2 × EMA(price, n) - EMA(EMA(price, n), n)

where:
  EMA(price, n) = 価格のn期間EMA
  EMA(EMA, n) = EMAのn期間EMA（二重EMA）
```

### 解説

DEMAは単純にEMAを2回適用するのではなく、EMAとEMAのEMAの差分を使ってラグを補正する。

```
EMA1 = EMA(price, n)
EMA2 = EMA(EMA1, n)
DEMA = 2 × EMA1 - EMA2
```

### 実装例

```typescript
function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  // 最初の値はSMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  ema.push(sum / period);

  // EMA計算
  for (let i = period; i < data.length; i++) {
    const value = (data[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
    ema.push(value);
  }

  return ema;
}

function calculateDEMA(closes: number[], period: number = 20): number[] {
  // Step 1: EMA1（価格のEMA）
  const ema1 = calculateEMA(closes, period);

  // Step 2: EMA2（EMA1のEMA）
  const ema2 = calculateEMA(ema1, period);

  // Step 3: DEMA = 2 × EMA1 - EMA2
  // ※ EMA2はEMA1より(period-1)個少ないので調整
  const dema: number[] = [];
  const offset = period - 1;

  for (let i = 0; i < ema2.length; i++) {
    const ema1Value = ema1[i + offset];
    const ema2Value = ema2[i];
    dema.push(2 * ema1Value - ema2Value);
  }

  return dema;
}
```

### クロス検出

```typescript
function detectDEMACross(
  currentPrice: number,
  prevPrice: number,
  currentDEMA: number,
  prevDEMA: number
): string | null {
  // 価格がDEMAを上抜け
  if (prevPrice <= prevDEMA && currentPrice > currentDEMA) {
    return 'bullish_cross';
  }
  // 価格がDEMAを下抜け
  if (prevPrice >= prevDEMA && currentPrice < currentDEMA) {
    return 'bearish_cross';
  }
  return null;
}
```

### トレンド判定

```typescript
function getDEMATrend(
  price: number,
  dema: number,
  prevDema: number
): { position: string; direction: string } {
  return {
    position: price > dema ? 'above' : 'below',
    direction: dema > prevDema ? 'rising' : 'falling',
  };
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| period | 20 | 1〜200（整数） | 計算期間 |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| value | number | 現在DEMA値 |
| pricePosition | string | `above` / `below`（価格との位置関係） |
| direction | string | `rising` / `falling`（DEMA自体の傾き） |
| distance | number | 価格とDEMAの乖離率（%） |
| cross | string \| null | `bullish_cross` / `bearish_cross` / null |

### 乖離率計算

```typescript
function calculateDistance(price: number, dema: number): number {
  return ((price - dema) / dema) * 100;
}
```

## 類似度計算

| 項目 | 値 |
|------|-----|
| type | relative（価格基準） |
| weight | 0.85 |

### 重み配分

| 特徴量 | 重み | 許容範囲 |
|--------|------|---------|
| pricePosition | 0.30 | 完全一致 |
| direction | 0.25 | 完全一致 |
| distance | 0.30 | ±1% |
| cross | 0.15 | 完全一致 |

```typescript
function calculateDEMASimilarity(
  current: {
    pricePosition: string;
    direction: string;
    distance: number;
    cross: string | null;
  },
  saved: {
    pricePosition: string;
    direction: string;
    distance: number;
    cross: string | null;
  }
): number {
  let score = 0;

  // pricePosition（30%）
  score += (current.pricePosition === saved.pricePosition ? 1 : 0) * 0.30;

  // direction（25%）
  score += (current.direction === saved.direction ? 1 : 0) * 0.25;

  // distance（30%）
  const distDiff = Math.abs(current.distance - saved.distance);
  score += Math.max(0, 1 - distDiff / 2) * 0.30;

  // cross（15%）- ボーナス
  if (current.cross && current.cross === saved.cross) {
    score += 0.15;
  } else if (!current.cross && !saved.cross) {
    score += 0.10;
  }

  return score;
}
```

## EMA/SMAとの比較

| 項目 | SMA | EMA | DEMA |
|------|-----|-----|------|
| ラグ | 大 | 中 | 小 |
| 反応速度 | 遅い | 普通 | 速い |
| ノイズ | 少ない | 普通 | やや多い |
| 計算複雑度 | 低 | 中 | 高 |
| 用途 | 長期トレンド | 中期トレンド | 短期シグナル |

## 使い方のポイント

- **DEMA上向き + 価格がDEMA上**: 強い上昇トレンド
- **DEMA下向き + 価格がDEMA下**: 強い下落トレンド
- **EMAより早くシグナルが出る**: ただしダマシも増える
- **複数期間のDEMAで確認**: 短期(10) + 中期(20) + 長期(50)

## 禁止事項

- DEMA単独での売買判断禁止
- 短期間設定（5未満）はノイズが多くなる
- レンジ相場では頻繁にクロスが発生するため注意
- トレンド系指標と組み合わせて使用すること
