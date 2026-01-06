# Supertrend（スーパートレンド）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `supertrend` |
| カテゴリ | trend |
| 役割 | トレンド方向とストップレベルを視覚的に表示 |
| 出力範囲 | 価格と同じ（1本のライン + 方向） |

## 計算式

### Step 1: ATR計算

```
TR = max(high - low, |high - close[prev]|, |low - close[prev]|)
ATR = EMA(TR, period) または Wilder's Smoothing
```

### Step 2: Basic Bands

```
Basic Upper Band = (high + low) / 2 + (multiplier × ATR)
Basic Lower Band = (high + low) / 2 - (multiplier × ATR)
```

### Step 3: Final Bands（平滑化）

```
Final Upper Band:
  if Basic Upper Band < prev Final Upper Band OR prev Close > prev Final Upper Band:
    Final Upper Band = Basic Upper Band
  else:
    Final Upper Band = prev Final Upper Band

Final Lower Band:
  if Basic Lower Band > prev Final Lower Band OR prev Close < prev Final Lower Band:
    Final Lower Band = Basic Lower Band
  else:
    Final Lower Band = prev Final Lower Band
```

### Step 4: Supertrend

```
if prev Supertrend == prev Final Upper Band:
  if Close <= Final Upper Band:
    Supertrend = Final Upper Band（下降トレンド継続）
  else:
    Supertrend = Final Lower Band（上昇トレンドに転換）
else:
  if Close >= Final Lower Band:
    Supertrend = Final Lower Band（上昇トレンド継続）
  else:
    Supertrend = Final Upper Band（下降トレンドに転換）
```

### 実装例

```typescript
interface OHLCData {
  high: number;
  low: number;
  close: number;
}

interface SupertrendResult {
  value: number;
  trend: 'bullish' | 'bearish';
  upperBand: number;
  lowerBand: number;
}

function calculateSupertrend(
  data: OHLCData[],
  period: number = 10,
  multiplier: number = 3.0
): SupertrendResult[] {
  if (data.length < period + 1) return [];

  const result: SupertrendResult[] = [];

  // ATR計算
  const tr: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;
    tr.push(Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    ));
  }

  // ATRのEMA
  const atr: number[] = [];
  const multiplierEMA = 2 / (period + 1);
  let atrSum = 0;
  for (let i = 0; i < period; i++) {
    atrSum += tr[i];
  }
  atr.push(atrSum / period);

  for (let i = period; i < tr.length; i++) {
    atr.push((tr[i] - atr[atr.length - 1]) * multiplierEMA + atr[atr.length - 1]);
  }

  // Supertrend計算
  let prevFinalUpperBand = 0;
  let prevFinalLowerBand = 0;
  let prevSupertrend = 0;
  let prevTrend: 'bullish' | 'bearish' = 'bullish';

  for (let i = 0; i < atr.length; i++) {
    const dataIndex = i + period;
    const high = data[dataIndex].high;
    const low = data[dataIndex].low;
    const close = data[dataIndex].close;
    const prevClose = data[dataIndex - 1].close;
    const currentATR = atr[i];

    const hl2 = (high + low) / 2;
    const basicUpperBand = hl2 + (multiplier * currentATR);
    const basicLowerBand = hl2 - (multiplier * currentATR);

    // Final Upper Band
    let finalUpperBand: number;
    if (basicUpperBand < prevFinalUpperBand || prevClose > prevFinalUpperBand) {
      finalUpperBand = basicUpperBand;
    } else {
      finalUpperBand = prevFinalUpperBand;
    }

    // Final Lower Band
    let finalLowerBand: number;
    if (basicLowerBand > prevFinalLowerBand || prevClose < prevFinalLowerBand) {
      finalLowerBand = basicLowerBand;
    } else {
      finalLowerBand = prevFinalLowerBand;
    }

    // Supertrend
    let supertrend: number;
    let trend: 'bullish' | 'bearish';

    if (i === 0) {
      // 初期値
      supertrend = close > hl2 ? finalLowerBand : finalUpperBand;
      trend = close > hl2 ? 'bullish' : 'bearish';
    } else {
      if (prevTrend === 'bearish') {
        // 前回下降トレンド
        if (close <= finalUpperBand) {
          supertrend = finalUpperBand;
          trend = 'bearish';
        } else {
          supertrend = finalLowerBand;
          trend = 'bullish';
        }
      } else {
        // 前回上昇トレンド
        if (close >= finalLowerBand) {
          supertrend = finalLowerBand;
          trend = 'bullish';
        } else {
          supertrend = finalUpperBand;
          trend = 'bearish';
        }
      }
    }

    result.push({
      value: supertrend,
      trend,
      upperBand: finalUpperBand,
      lowerBand: finalLowerBand,
    });

    prevFinalUpperBand = finalUpperBand;
    prevFinalLowerBand = finalLowerBand;
    prevSupertrend = supertrend;
    prevTrend = trend;
  }

  return result;
}
```

### トレンド反転検出

```typescript
function detectSupertrendReversal(
  current: SupertrendResult,
  prev: SupertrendResult
): string | null {
  if (prev.trend === 'bearish' && current.trend === 'bullish') {
    return 'bullish_reversal';
  }
  if (prev.trend === 'bullish' && current.trend === 'bearish') {
    return 'bearish_reversal';
  }
  return null;
}
```

### 距離計算

```typescript
function calculateSupertrendDistance(
  price: number,
  supertrend: number
): { distance: number; distancePercent: number } {
  const distance = price - supertrend;
  const distancePercent = (distance / price) * 100;
  return { distance, distancePercent };
}
```

### トレンド強度判定

```typescript
function getSupertrendStrength(
  distancePercent: number,
  trend: 'bullish' | 'bearish'
): string {
  const absDistance = Math.abs(distancePercent);

  if (absDistance >= 2.0) return 'strong';
  if (absDistance >= 1.0) return 'moderate';
  if (absDistance >= 0.3) return 'weak';
  return 'near_flip'; // 反転間近
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| period | 10 | 5〜50（整数） | ATR計算期間 |
| multiplier | 3.0 | 1.0〜10.0 | ATR乗数 |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| trend | string | `bullish` / `bearish` |
| distancePercent | number | 価格とラインの乖離率（%） |
| strength | string | `strong` / `moderate` / `weak` / `near_flip` |
| reversal | string \| null | `bullish_reversal` / `bearish_reversal` / null |

## 類似度計算

| 項目 | 値 |
|------|-----|
| type | relative（価格基準） |
| weight | 0.90 |

### 重み配分

| 特徴量 | 重み | 許容範囲 |
|--------|------|---------|
| trend | 0.40 | 完全一致 |
| strength | 0.25 | 完全一致 |
| distancePercent | 0.20 | ±0.5% |
| reversal | 0.15 | 完全一致 |

```typescript
function calculateSupertrendSimilarity(
  current: {
    trend: string;
    strength: string;
    distancePercent: number;
    reversal: string | null;
  },
  saved: {
    trend: string;
    strength: string;
    distancePercent: number;
    reversal: string | null;
  }
): number {
  let score = 0;

  // trend（40%）- 最重要
  score += (current.trend === saved.trend ? 1 : 0) * 0.40;

  // strength（25%）
  score += (current.strength === saved.strength ? 1 : 0.4) * 0.25;

  // distancePercent（20%）
  const distDiff = Math.abs(current.distancePercent - saved.distancePercent);
  score += Math.max(0, 1 - distDiff / 1.0) * 0.20;

  // reversal（15%）- ボーナス
  if (current.reversal && current.reversal === saved.reversal) {
    score += 0.15;
  } else if (!current.reversal && !saved.reversal) {
    score += 0.10;
  }

  return score;
}
```

## PSARとの比較

| 項目 | PSAR | Supertrend |
|------|------|------------|
| 計算基準 | 加速因子(AF) | ATR×乗数 |
| 反応速度 | トレンド進行で加速 | 一定 |
| パラメータ | AF_START, AF_STEP, AF_MAX | period, multiplier |
| 特徴 | 放物線的に接近 | 一定幅で追従 |
| ダマシ | レンジで多い | やや少ない |

## 使い方のポイント

- **価格 > Supertrend（緑）**: 上昇トレンド
- **価格 < Supertrend（赤）**: 下降トレンド
- **ライン反転**: トレンド転換シグナル
- **ストップロス**: Supertrendラインを使用

## トレード戦略例

| 状況 | 戦略 |
|------|------|
| 緑から赤に反転 | ショートエントリー |
| 赤から緑に反転 | ロングエントリー |
| 緑で価格がラインに接近 | 押し目買い検討 |
| 強いトレンド | トレーリングストップとして活用 |

## 禁止事項

- Supertrend単独での売買判断禁止
- **レンジ相場ではダマシが発生** - ADXと併用推奨
- 反転シグナル直後のエントリーは確認を待つ
- multiplierを小さくしすぎるとノイズ増加
- 大きすぎるとシグナルが遅れる
