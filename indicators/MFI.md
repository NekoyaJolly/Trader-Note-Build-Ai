# MFI（Money Flow Index）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `mfi` |
| カテゴリ | volume |
| 役割 | 出来高加重の買われすぎ・売られすぎを測定（Volume-Weighted RSI） |
| 出力範囲 | 0〜100 |

## 計算式

### Step 1: Typical Price（TP）

```
TP = (high + low + close) / 3
```

### Step 2: Raw Money Flow

```
Raw Money Flow = TP × volume
```

### Step 3: Money Flow分類

```
if TP > TP[prev]:
  Positive Money Flow += Raw Money Flow
else if TP < TP[prev]:
  Negative Money Flow += Raw Money Flow
else:
  無視（前日と同じ）
```

### Step 4: Money Flow Ratio

```
Money Flow Ratio = Positive Money Flow(n期間) / Negative Money Flow(n期間)
```

### Step 5: MFI

```
MFI = 100 - (100 / (1 + Money Flow Ratio))
```

### 実装例

```typescript
interface OHLCVData {
  high: number;
  low: number;
  close: number;
  volume: number;
}

function calculateMFI(data: OHLCVData[], period: number = 14): number[] {
  const mfi: number[] = [];

  // Typical Price計算
  const tp = data.map((d) => (d.high + d.low + d.close) / 3);

  // Raw Money Flow計算
  const rawMF = data.map((d, i) => tp[i] * d.volume);

  for (let i = period; i < data.length; i++) {
    let positiveMF = 0;
    let negativeMF = 0;

    for (let j = i - period + 1; j <= i; j++) {
      if (tp[j] > tp[j - 1]) {
        positiveMF += rawMF[j];
      } else if (tp[j] < tp[j - 1]) {
        negativeMF += rawMF[j];
      }
    }

    // ゼロ除算防止
    if (negativeMF === 0) {
      mfi.push(100);
    } else {
      const mfRatio = positiveMF / negativeMF;
      mfi.push(100 - 100 / (1 + mfRatio));
    }
  }

  return mfi;
}
```

### ダイバージェンス検出

```typescript
function detectMFIDivergence(
  prices: number[],
  mfiValues: number[],
  lookback: number = 5
): string | null {
  const priceSlope = prices[prices.length - 1] - prices[prices.length - lookback];
  const mfiSlope = mfiValues[mfiValues.length - 1] - mfiValues[mfiValues.length - lookback];

  // 価格上昇 + MFI下落 → 弱気ダイバージェンス
  if (priceSlope > 0 && mfiSlope < -5) return 'bearish_divergence';
  // 価格下落 + MFI上昇 → 強気ダイバージェンス
  if (priceSlope < 0 && mfiSlope > 5) return 'bullish_divergence';

  return null;
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| period | 14 | 1〜100（整数） | 計算期間 |
| overbought | 80 | 50〜95 | 買われすぎ閾値 |
| oversold | 20 | 5〜50 | 売られすぎ閾値 |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| value | number | 現在MFI値 |
| zone | string | `overbought` / `oversold` / `neutral` |
| slope | number | 傾き = MFI[t] - MFI[t-1] |
| divergence | string \| null | `bullish_divergence` / `bearish_divergence` / null |

### zone判定

```typescript
function getMFIZone(
  value: number,
  overbought: number = 80,
  oversold: number = 20
): string {
  if (value >= overbought) return 'overbought';
  if (value <= oversold) return 'oversold';
  return 'neutral';
}
```

## 類似度計算

| 項目 | 値 |
|------|-----|
| type | absolute |
| weight | 0.85 |

### 重み配分

| 特徴量 | 重み | 許容範囲 |
|--------|------|---------|
| value | 0.35 | ±10 |
| zone | 0.30 | 完全一致 |
| slope | 0.20 | ±3 |
| divergence | 0.15 | 完全一致 |

```typescript
function calculateMFISimilarity(
  current: { value: number; zone: string; slope: number; divergence: string | null },
  saved: { value: number; zone: string; slope: number; divergence: string | null }
): number {
  let score = 0;

  // value（35%）
  const valueDiff = Math.abs(current.value - saved.value);
  score += Math.max(0, 1 - valueDiff / 20) * 0.35;

  // zone（30%）
  score += (current.zone === saved.zone ? 1 : 0) * 0.30;

  // slope（20%）
  const slopeDiff = Math.abs(current.slope - saved.slope);
  score += Math.max(0, 1 - slopeDiff / 6) * 0.20;

  // divergence（15%）- ボーナス
  if (current.divergence && current.divergence === saved.divergence) {
    score += 0.15;
  } else if (!current.divergence && !saved.divergence) {
    score += 0.10; // 両方なしも部分一致
  }

  return score;
}
```

## RSIとの違い

| 項目 | RSI | MFI |
|------|-----|-----|
| 入力 | 終値のみ | 終値 + 出来高 |
| 計算 | 価格変動 | 資金流入/流出 |
| 特徴 | 純粋な価格モメンタム | 出来高加重モメンタム |
| 用途 | 全般 | 出来高重視の分析 |

## 禁止事項

- MFI単独での売買判断禁止
- 出来高データがない銘柄では使用不可
- RSIと同時に見て「両方買われすぎ」を確認推奨
- FX（為替）はTick Volumeのため精度に注意
