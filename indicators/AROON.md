# Aroon（アルーン）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `aroon` |
| カテゴリ | trend |
| 役割 | トレンドの強さと方向を判断 |
| 出力範囲 | 0〜100（Aroon Up, Aroon Down） |

## 計算式

### Aroon Up

```
Aroon Up = ((period - 最高値からの経過期間) / period) × 100
```

### Aroon Down

```
Aroon Down = ((period - 最安値からの経過期間) / period) × 100
```

### Aroon Oscillator（オプション）

```
Aroon Oscillator = Aroon Up - Aroon Down
// 範囲: -100〜+100
```

### 実装例

```typescript
interface OHLCData {
  high: number;
  low: number;
}

interface AroonResult {
  up: number[];
  down: number[];
  oscillator: number[];
}

function calculateAroon(data: OHLCData[], period: number = 25): AroonResult {
  const up: number[] = [];
  const down: number[] = [];
  const oscillator: number[] = [];

  for (let i = period; i < data.length; i++) {
    const slice = data.slice(i - period, i + 1);

    // 最高値のインデックスを探す（最新が0）
    let highestIdx = 0;
    let highestValue = slice[0].high;
    for (let j = 1; j < slice.length; j++) {
      if (slice[j].high >= highestValue) {
        highestValue = slice[j].high;
        highestIdx = j;
      }
    }

    // 最安値のインデックスを探す（最新が0）
    let lowestIdx = 0;
    let lowestValue = slice[0].low;
    for (let j = 1; j < slice.length; j++) {
      if (slice[j].low <= lowestValue) {
        lowestValue = slice[j].low;
        lowestIdx = j;
      }
    }

    // 経過期間（最新からの距離）
    const daysSinceHigh = period - highestIdx;
    const daysSinceLow = period - lowestIdx;

    const aroonUp = ((period - daysSinceHigh) / period) * 100;
    const aroonDown = ((period - daysSinceLow) / period) * 100;

    up.push(aroonUp);
    down.push(aroonDown);
    oscillator.push(aroonUp - aroonDown);
  }

  return { up, down, oscillator };
}
```

### シンプルな実装

```typescript
function calculateAroonSimple(data: OHLCData[], period: number = 25): AroonResult {
  const up: number[] = [];
  const down: number[] = [];
  const oscillator: number[] = [];

  for (let i = period; i < data.length; i++) {
    const slice = data.slice(i - period, i + 1);
    const highs = slice.map(d => d.high);
    const lows = slice.map(d => d.low);

    // 最高値・最安値の位置（末尾が最新 = period）
    const highestIdx = highs.lastIndexOf(Math.max(...highs));
    const lowestIdx = lows.lastIndexOf(Math.min(...lows));

    const aroonUp = (highestIdx / period) * 100;
    const aroonDown = (lowestIdx / period) * 100;

    up.push(aroonUp);
    down.push(aroonDown);
    oscillator.push(aroonUp - aroonDown);
  }

  return { up, down, oscillator };
}
```

### トレンド判定

```typescript
function getAroonTrend(aroonUp: number, aroonDown: number): string {
  // 強い上昇トレンド: Up > 70 かつ Down < 30
  if (aroonUp > 70 && aroonDown < 30) return 'strong_uptrend';

  // 強い下降トレンド: Down > 70 かつ Up < 30
  if (aroonDown > 70 && aroonUp < 30) return 'strong_downtrend';

  // 弱い上昇: Up > Down
  if (aroonUp > aroonDown) return 'weak_uptrend';

  // 弱い下降: Down > Up
  if (aroonDown > aroonUp) return 'weak_downtrend';

  return 'consolidation';
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| period | 25 | 1〜100（整数） | 計算期間 |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| up | number | Aroon Up値（0〜100） |
| down | number | Aroon Down値（0〜100） |
| oscillator | number | Up - Down（-100〜+100） |
| trend | string | `strong_uptrend` / `strong_downtrend` / `weak_uptrend` / `weak_downtrend` / `consolidation` |
| cross | string \| null | `bullish` / `bearish` / null |

### cross判定

```typescript
function getAroonCross(
  upCurr: number, upPrev: number,
  downCurr: number, downPrev: number
): string | null {
  // ゴールデンクロス: UpがDownを下から上に抜ける
  if (upPrev <= downPrev && upCurr > downCurr) return 'bullish';
  // デッドクロス: DownがUpを下から上に抜ける
  if (downPrev <= upPrev && downCurr > upCurr) return 'bearish';
  return null;
}
```

## 類似度計算

| 項目 | 値 |
|------|-----|
| type | directional |
| weight | 0.9 |

### 重み配分

| 特徴量 | 重み | 許容範囲 |
|--------|------|---------|
| oscillator | 0.35 | ±20 |
| trend | 0.35 | 完全一致 |
| up | 0.15 | ±15 |
| down | 0.15 | ±15 |

```typescript
function calculateAroonSimilarity(
  current: { up: number; down: number; oscillator: number; trend: string },
  saved: { up: number; down: number; oscillator: number; trend: string }
): number {
  let score = 0;

  // oscillator（35%）
  const oscDiff = Math.abs(current.oscillator - saved.oscillator);
  score += Math.max(0, 1 - oscDiff / 40) * 0.35;

  // trend（35%）
  if (current.trend === saved.trend) {
    score += 0.35;
  } else if (
    (current.trend.includes('uptrend') && saved.trend.includes('uptrend')) ||
    (current.trend.includes('downtrend') && saved.trend.includes('downtrend'))
  ) {
    score += 0.175; // 方向は同じだが強さが違う
  }

  // up（15%）
  const upDiff = Math.abs(current.up - saved.up);
  score += Math.max(0, 1 - upDiff / 30) * 0.15;

  // down（15%）
  const downDiff = Math.abs(current.down - saved.down);
  score += Math.max(0, 1 - downDiff / 30) * 0.15;

  return score;
}
```

## 読み方のポイント

- **Aroon Up = 100**: 期間中の最高値が直近で発生
- **Aroon Down = 100**: 期間中の最安値が直近で発生
- **両方が高い**: 激しいレンジ相場
- **両方が低い**: 方向感のないレンジ相場

## 禁止事項

- Aroon単独での売買判断禁止
- クロスだけでなく、両線の絶対値レベルも確認すること
- SMAトレンド方向と併用して確認すること
