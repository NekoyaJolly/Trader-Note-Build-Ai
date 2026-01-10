# Williams %R

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `williamsR` |
| カテゴリ | momentum |
| 役割 | 買われすぎ/売られすぎの判定 |
| 出力範囲 | -100〜0 |

## 計算式

### Williams %R

```
%R = (highestHigh - close) / (highestHigh - lowestLow) × (-100)

where:
  highestHigh = 過去period期間の最高値
  lowestLow = 過去period期間の最安値
```

### Stochasticとの関係

```
Williams %R = %K - 100
// または
%K = %R + 100
```

### 実装例

```typescript
interface OHLCData {
  high: number;
  low: number;
  close: number;
}

function calculateWilliamsR(data: OHLCData[], period: number = 14): number[] {
  const williamsR: number[] = [];

  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const highestHigh = Math.max(...slice.map(d => d.high));
    const lowestLow = Math.min(...slice.map(d => d.low));

    const range = highestHigh - lowestLow;
    if (range === 0) {
      williamsR.push(-50); // レンジがない場合は中立
    } else {
      const r = ((highestHigh - data[i].close) / range) * -100;
      williamsR.push(r);
    }
  }

  return williamsR;
}
```

### シグナル判定

```typescript
function getWilliamsRSignal(
  current: number,
  prev: number,
  overbought: number = -20,
  oversold: number = -80
): string | null {
  // 売られすぎ圏から上昇 → 買いシグナル
  if (prev <= oversold && current > oversold) {
    return 'buy';
  }
  // 買われすぎ圏から下落 → 売りシグナル
  if (prev >= overbought && current < overbought) {
    return 'sell';
  }
  return null;
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| period | 14 | 1〜100（整数） | 計算期間 |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| value | number | 現在%R値（-100〜0） |
| zone | string | `overbought` / `oversold` / `neutral` |
| slope | number | 傾き = %R[t] - %R[t-1] |
| signal | string \| null | `buy` / `sell` / null |

### zone判定

```typescript
function getWilliamsRZone(
  value: number,
  overbought: number = -20,
  oversold: number = -80
): string {
  if (value >= overbought) return 'overbought';  // -20以上
  if (value <= oversold) return 'oversold';       // -80以下
  return 'neutral';
}
```

## 類似度計算

| 項目 | 値 |
|------|-----|
| type | absolute |
| weight | 1.0 |

### 重み配分

| 特徴量 | 重み | 許容範囲 |
|--------|------|---------|
| value | 0.50 | ±10 |
| zone | 0.30 | 完全一致 |
| slope | 0.20 | ±5 |

```typescript
function calculateWilliamsRSimilarity(
  current: { value: number; zone: string; slope: number },
  saved: { value: number; zone: string; slope: number }
): number {
  let score = 0;

  // value（50%）
  const valueDiff = Math.abs(current.value - saved.value);
  score += Math.max(0, 1 - valueDiff / 20) * 0.50;

  // zone（30%）
  score += (current.zone === saved.zone ? 1 : 0) * 0.30;

  // slope（20%）- 方向性の一致
  const slopeDiff = Math.abs(current.slope - saved.slope);
  score += Math.max(0, 1 - slopeDiff / 10) * 0.20;

  return score;
}
```

## Stochasticとの違い

| 項目 | Williams %R | Stochastic %K |
|------|-------------|---------------|
| 範囲 | -100〜0 | 0〜100 |
| 買われすぎ | -20以上 | 80以上 |
| 売られすぎ | -80以下 | 20以下 |
| 平滑化 | なし（生値） | あり（%D） |

## 禁止事項

- Williams %R単独での売買判断禁止
- 強トレンド中は-20や-80に張り付くため逆張りシグナルとして機能しにくい
- SMAトレンド方向と矛盾時は見送り推奨
- Stochasticと実質同じなので両方同時に使う意味は薄い
