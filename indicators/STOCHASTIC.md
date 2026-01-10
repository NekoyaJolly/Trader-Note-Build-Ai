# Stochastic（ストキャスティクス）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `stochastic` |
| カテゴリ | momentum |
| 役割 | 買われすぎ/売られすぎの判定 |
| 出力範囲 | 0〜100（%K, %D両方） |

## 計算式

### Step 1: %K（Fast Stochastic）

```
%K = (close - lowestLow) / (highestHigh - lowestLow) × 100

where:
  lowestLow = 過去kPeriod期間の最安値
  highestHigh = 過去kPeriod期間の最高値
```

### Step 2: %D（Slow Stochastic）

```
%D = SMA(%K, dPeriod)
```

### 実装例

```typescript
interface OHLCData {
  high: number;
  low: number;
  close: number;
}

interface StochasticResult {
  k: number[];  // %K
  d: number[];  // %D
}

function calculateStochastic(
  data: OHLCData[],
  kPeriod: number = 14,
  dPeriod: number = 3
): StochasticResult {
  const k: number[] = [];
  const d: number[] = [];

  // Step 1: %K計算
  for (let i = kPeriod - 1; i < data.length; i++) {
    const slice = data.slice(i - kPeriod + 1, i + 1);
    const highestHigh = Math.max(...slice.map(d => d.high));
    const lowestLow = Math.min(...slice.map(d => d.low));

    const range = highestHigh - lowestLow;
    if (range === 0) {
      k.push(50); // レンジがない場合は中立
    } else {
      k.push(((data[i].close - lowestLow) / range) * 100);
    }
  }

  // Step 2: %D計算（%KのSMA）
  for (let i = dPeriod - 1; i < k.length; i++) {
    const sum = k.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0);
    d.push(sum / dPeriod);
  }

  return {
    k: k.slice(dPeriod - 1), // %Dと長さを揃える
    d,
  };
}
```

### クロス検出

```typescript
function detectStochasticCross(
  kPrev: number, kCurr: number,
  dPrev: number, dCurr: number
): 'golden' | 'dead' | null {
  // ゴールデンクロス: %Kが%Dを下から上に抜ける
  if (kPrev <= dPrev && kCurr > dCurr) return 'golden';
  // デッドクロス: %Kが%Dを上から下に抜ける
  if (kPrev >= dPrev && kCurr < dCurr) return 'dead';
  return null;
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| kPeriod | 14 | 1〜100（整数） | %K計算期間 |
| dPeriod | 3 | 1〜100（整数） | %D平滑化期間 |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| k | number | %K値（0〜100） |
| d | number | %D値（0〜100） |
| zone | string | `overbought` / `oversold` / `neutral` |
| cross | string \| null | `golden` / `dead` / null |
| kSlope | number | %Kの傾き |

### zone判定

```typescript
function getStochasticZone(k: number, d: number): string {
  const avg = (k + d) / 2;
  if (avg >= 80) return 'overbought';
  if (avg <= 20) return 'oversold';
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
| k | 0.35 | ±10 |
| d | 0.35 | ±10 |
| zone | 0.20 | 完全一致 |
| cross | 0.10 | 完全一致 |

```typescript
function calculateStochasticSimilarity(
  current: { k: number; d: number; zone: string; cross: string | null },
  saved: { k: number; d: number; zone: string; cross: string | null }
): number {
  let score = 0;

  // %K（35%）
  const kDiff = Math.abs(current.k - saved.k);
  score += Math.max(0, 1 - kDiff / 20) * 0.35;

  // %D（35%）
  const dDiff = Math.abs(current.d - saved.d);
  score += Math.max(0, 1 - dDiff / 20) * 0.35;

  // zone（20%）
  score += (current.zone === saved.zone ? 1 : 0) * 0.20;

  // cross（10%）- ボーナス的扱い
  if (current.cross && current.cross === saved.cross) {
    score += 0.10;
  }

  return score;
}
```

## 禁止事項

- Stochastic単独での売買判断禁止
- 強トレンド中は80/20に張り付くため、逆張りシグナルとして機能しにくい
- SMAトレンド方向と矛盾時は見送り推奨
