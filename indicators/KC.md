# KC（Keltner Channel）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `kc` |
| カテゴリ | volatility |
| 役割 | ATRベースのボラティリティバンド |
| 出力範囲 | 価格と同じ（3本のライン） |

## 計算式

### Keltner Channel

```
Middle = EMA(close, period)
Upper = Middle + (ATR × multiplier)
Lower = Middle - (ATR × multiplier)

where:
  EMA = 指数移動平均
  ATR = Average True Range（通常20期間）
  multiplier = 乗数（通常2.0）
```

### ATR計算（復習）

```
True Range = max(
  high - low,
  |high - close[prev]|,
  |low - close[prev]|
)

ATR = EMA(TR, period) または SMA(TR, period)
```

### 実装例

```typescript
interface OHLCData {
  high: number;
  low: number;
  close: number;
}

interface KeltnerResult {
  middle: number;
  upper: number;
  lower: number;
  bandwidth: number;
}

function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  ema.push(sum / period);

  for (let i = period; i < data.length; i++) {
    const value = (data[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
    ema.push(value);
  }

  return ema;
}

function calculateATR(data: OHLCData[], period: number): number[] {
  const tr: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;

    const trValue = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    tr.push(trValue);
  }

  return calculateEMA(tr, period);
}

function calculateKeltnerChannel(
  data: OHLCData[],
  period: number = 20,
  multiplier: number = 2.0
): KeltnerResult[] {
  const closes = data.map((d) => d.close);
  const ema = calculateEMA(closes, period);
  const atr = calculateATR(data, period);

  const result: KeltnerResult[] = [];

  // EMAとATRの長さを揃える
  const startIndex = Math.max(0, ema.length - atr.length);

  for (let i = 0; i < atr.length; i++) {
    const middle = ema[startIndex + i];
    const atrValue = atr[i];
    const upper = middle + atrValue * multiplier;
    const lower = middle - atrValue * multiplier;

    result.push({
      middle,
      upper,
      lower,
      bandwidth: ((upper - lower) / middle) * 100,
    });
  }

  return result;
}
```

### 価格位置判定

```typescript
function getKCPosition(
  price: number,
  kc: KeltnerResult
): { zone: string; percentB: number } {
  // %B（価格のバンド内位置、0〜1が通常範囲）
  const percentB = (price - kc.lower) / (kc.upper - kc.lower);

  let zone: string;
  if (price > kc.upper) {
    zone = 'above_upper';
  } else if (price < kc.lower) {
    zone = 'below_lower';
  } else if (price > kc.middle) {
    zone = 'upper_half';
  } else {
    zone = 'lower_half';
  }

  return { zone, percentB };
}
```

### ブレイクアウト検出

```typescript
function detectKCBreakout(
  currentPrice: number,
  prevPrice: number,
  currentKC: KeltnerResult,
  prevKC: KeltnerResult
): string | null {
  // 上バンドブレイクアウト
  if (prevPrice <= prevKC.upper && currentPrice > currentKC.upper) {
    return 'upper_breakout';
  }
  // 下バンドブレイクアウト
  if (prevPrice >= prevKC.lower && currentPrice < currentKC.lower) {
    return 'lower_breakout';
  }
  return null;
}
```

### スクイーズ検出（BB連携）

```typescript
function detectSqueeze(
  bbUpper: number,
  bbLower: number,
  kcUpper: number,
  kcLower: number
): boolean {
  // BBがKCの内側にある = スクイーズ状態
  return bbUpper < kcUpper && bbLower > kcLower;
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| period | 20 | 1〜100（整数） | EMA/ATR計算期間 |
| multiplier | 2.0 | 0.5〜5.0 | ATR乗数 |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| zone | string | `above_upper` / `upper_half` / `lower_half` / `below_lower` |
| percentB | number | バンド内位置（0〜1が通常、超過あり） |
| bandwidth | number | バンド幅（%） |
| trend | string | `expanding` / `contracting` / `stable` |
| breakout | string \| null | `upper_breakout` / `lower_breakout` / null |

### trend判定

```typescript
function getKCTrend(
  currentBandwidth: number,
  prevBandwidth: number
): string {
  const change = currentBandwidth - prevBandwidth;
  if (change > 0.1) return 'expanding';
  if (change < -0.1) return 'contracting';
  return 'stable';
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
| zone | 0.30 | 完全一致 |
| percentB | 0.25 | ±0.15 |
| bandwidth | 0.20 | ±20%相対 |
| trend | 0.15 | 完全一致 |
| breakout | 0.10 | 完全一致 |

```typescript
function calculateKCSimilarity(
  current: {
    zone: string;
    percentB: number;
    bandwidth: number;
    trend: string;
    breakout: string | null;
  },
  saved: {
    zone: string;
    percentB: number;
    bandwidth: number;
    trend: string;
    breakout: string | null;
  }
): number {
  let score = 0;

  // zone（30%）
  score += (current.zone === saved.zone ? 1 : 0) * 0.30;

  // percentB（25%）
  const percentBDiff = Math.abs(current.percentB - saved.percentB);
  score += Math.max(0, 1 - percentBDiff / 0.3) * 0.25;

  // bandwidth（20%）
  const bwRatio = Math.min(current.bandwidth, saved.bandwidth) /
                  Math.max(current.bandwidth, saved.bandwidth);
  score += bwRatio * 0.20;

  // trend（15%）
  score += (current.trend === saved.trend ? 1 : 0.3) * 0.15;

  // breakout（10%）- ボーナス
  if (current.breakout && current.breakout === saved.breakout) {
    score += 0.10;
  }

  return score;
}
```

## Bollinger Bandsとの比較

| 項目 | Bollinger Bands | Keltner Channel |
|------|-----------------|-----------------|
| バンド幅基準 | 標準偏差 | ATR |
| 反応 | 価格変動に敏感 | より滑らか |
| スクイーズ検出 | 単独では困難 | BB併用で検出 |
| 特徴 | ボラティリティ急変に反応 | トレンド追従向き |
| 用途 | 逆張り | 順張り |

## 使い方のポイント

- **価格が上バンド上**: 強い上昇トレンド
- **価格が下バンド下**: 強い下落トレンド
- **バンド内回帰**: 平均回帰の可能性
- **BB+KC併用**: スクイーズ→ブレイクアウト検出

## 禁止事項

- KC単独での売買判断禁止
- バンドタッチ＝即反転ではない（トレンド中は走り続ける）
- BBとの併用でスクイーズ検出が効果的
- トレンド方向を確認してから使用すること
