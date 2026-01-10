# PSAR（Parabolic SAR）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `psar` |
| カテゴリ | trend |
| 役割 | トレンド方向とストップロスレベルを提示 |
| 出力範囲 | 価格と同じ（ドット表示） |

## 計算式

### Parabolic SAR

```
上昇トレンド時:
  SAR(t) = SAR(t-1) + AF × (EP - SAR(t-1))

下落トレンド時:
  SAR(t) = SAR(t-1) - AF × (SAR(t-1) - EP)

where:
  AF = Acceleration Factor（加速因子）
  EP = Extreme Point（極値）
```

### パラメータ

```
AF_START = 0.02  # 初期AF
AF_STEP = 0.02   # AF増加量
AF_MAX = 0.20    # 最大AF
```

### AF更新ルール

```
上昇トレンド:
  if high > EP:
    EP = high
    AF = min(AF + AF_STEP, AF_MAX)

下落トレンド:
  if low < EP:
    EP = low
    AF = min(AF + AF_STEP, AF_MAX)
```

### トレンド反転条件

```
上昇トレンド中:
  if low < SAR → 下落トレンドに反転

下落トレンド中:
  if high > SAR → 上昇トレンドに反転
```

### 実装例

```typescript
interface OHLCData {
  high: number;
  low: number;
  close: number;
}

interface PSARResult {
  value: number;
  trend: 'bullish' | 'bearish';
  af: number;
  ep: number;
}

function calculatePSAR(
  data: OHLCData[],
  afStart: number = 0.02,
  afStep: number = 0.02,
  afMax: number = 0.20
): PSARResult[] {
  if (data.length < 2) return [];

  const result: PSARResult[] = [];

  // 初期トレンド判定（最初の2本で決定）
  let trend: 'bullish' | 'bearish' = data[1].close > data[0].close ? 'bullish' : 'bearish';
  let af = afStart;
  let ep = trend === 'bullish' ? data[0].high : data[0].low;
  let sar = trend === 'bullish' ? data[0].low : data[0].high;

  result.push({ value: sar, trend, af, ep });

  for (let i = 1; i < data.length; i++) {
    const prevSAR = sar;
    const high = data[i].high;
    const low = data[i].low;

    if (trend === 'bullish') {
      // SAR計算
      sar = prevSAR + af * (ep - prevSAR);

      // SARは前2本のlowを超えない
      if (i >= 2) {
        sar = Math.min(sar, data[i - 1].low, data[i - 2].low);
      }

      // 反転チェック
      if (low < sar) {
        // 下落トレンドに反転
        trend = 'bearish';
        sar = ep; // 直近高値からスタート
        ep = low;
        af = afStart;
      } else {
        // EPとAF更新
        if (high > ep) {
          ep = high;
          af = Math.min(af + afStep, afMax);
        }
      }
    } else {
      // 下落トレンド
      sar = prevSAR - af * (prevSAR - ep);

      // SARは前2本のhighを下回らない
      if (i >= 2) {
        sar = Math.max(sar, data[i - 1].high, data[i - 2].high);
      }

      // 反転チェック
      if (high > sar) {
        // 上昇トレンドに反転
        trend = 'bullish';
        sar = ep; // 直近安値からスタート
        ep = high;
        af = afStart;
      } else {
        // EPとAF更新
        if (low < ep) {
          ep = low;
          af = Math.min(af + afStep, afMax);
        }
      }
    }

    result.push({ value: sar, trend, af, ep });
  }

  return result;
}
```

### 反転検出

```typescript
function detectPSARReversal(
  current: PSARResult,
  prev: PSARResult
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
function calculatePSARDistance(
  price: number,
  psar: number
): { distance: number; distancePercent: number } {
  const distance = Math.abs(price - psar);
  const distancePercent = (distance / price) * 100;
  return { distance, distancePercent };
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| afStart | 0.02 | 0.01〜0.10 | 初期加速因子 |
| afStep | 0.02 | 0.01〜0.10 | AF増加量 |
| afMax | 0.20 | 0.10〜0.50 | 最大AF |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| trend | string | `bullish` / `bearish` |
| distancePercent | number | 価格とSARの乖離率（%） |
| af | number | 現在のAF値（トレンド成熟度を示す） |
| reversal | string \| null | `bullish_reversal` / `bearish_reversal` / null |
| trendAge | number | 現トレンドの継続期間（バー数） |

### トレンド成熟度判定

```typescript
function getTrendMaturity(af: number, afStart: number, afMax: number): string {
  const progress = (af - afStart) / (afMax - afStart);
  if (progress >= 0.7) return 'mature';
  if (progress >= 0.3) return 'developing';
  return 'early';
}
```

## 類似度計算

| 項目 | 値 |
|------|-----|
| type | relative（価格基準） |
| weight | 0.90 |

### 重み配分

| 特徴量 | 重み | 許容範囲 |
|--------|------|---------|
| trend | 0.35 | 完全一致 |
| distancePercent | 0.25 | ±0.5% |
| trendMaturity | 0.20 | 完全一致 |
| reversal | 0.20 | 完全一致 |

```typescript
function calculatePSARSimilarity(
  current: {
    trend: string;
    distancePercent: number;
    trendMaturity: string;
    reversal: string | null;
  },
  saved: {
    trend: string;
    distancePercent: number;
    trendMaturity: string;
    reversal: string | null;
  }
): number {
  let score = 0;

  // trend（35%）- 最重要
  score += (current.trend === saved.trend ? 1 : 0) * 0.35;

  // distancePercent（25%）
  const distDiff = Math.abs(current.distancePercent - saved.distancePercent);
  score += Math.max(0, 1 - distDiff / 1.0) * 0.25;

  // trendMaturity（20%）
  score += (current.trendMaturity === saved.trendMaturity ? 1 : 0.4) * 0.20;

  // reversal（20%）- ボーナス
  if (current.reversal && current.reversal === saved.reversal) {
    score += 0.20;
  } else if (!current.reversal && !saved.reversal) {
    score += 0.15;
  }

  return score;
}
```

## 使い方のポイント

- **SAR < 価格**: 上昇トレンド（ロングポジション）
- **SAR > 価格**: 下落トレンド（ショートポジション）
- **SAR反転**: トレンド転換シグナル + ストップロス設定点
- **AFが高い**: トレンドが成熟（反転リスク増）
- **AFが低い**: トレンド初期（追随チャンス）

## ストップロスとしての活用

```typescript
function getSuggestedStopLoss(
  position: 'long' | 'short',
  psar: PSARResult
): number | null {
  // PSARはトレーリングストップとして機能
  if (position === 'long' && psar.trend === 'bullish') {
    return psar.value; // SARをストップロスに設定
  }
  if (position === 'short' && psar.trend === 'bearish') {
    return psar.value;
  }
  // ポジションとトレンドが逆 → 警告
  return null;
}
```

## 禁止事項

- PSAR単独での売買判断禁止
- レンジ相場では頻繁に反転するためダマシが多い
- **必ずADXなどのトレンドフィルターと併用**
- AF設定を大きくしすぎるとノイズ増加
- 反転シグナル＝即エントリーではない（確認必須）
