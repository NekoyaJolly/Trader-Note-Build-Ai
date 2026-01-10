# VWAP（Volume Weighted Average Price）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `vwap` |
| カテゴリ | volume |
| 役割 | 出来高加重平均価格（機関投資家の基準） |
| 出力範囲 | 価格スケール |

## 計算式

### 基本VWAP

```
TP (Typical Price) = (high + low + close) / 3

VWAP = Σ(TP × volume) / Σ(volume)
     = 累積(価格 × 出来高) / 累積出来高
```

### 実装例

```typescript
interface OHLCVData {
  high: number;
  low: number;
  close: number;
  volume: number;
}

function calculateVWAP(data: OHLCVData[]): number[] {
  const vwap: number[] = [];
  let cumulativeTPV = 0;  // 累積(TP × Volume)
  let cumulativeVolume = 0;

  for (let i = 0; i < data.length; i++) {
    const tp = (data[i].high + data[i].low + data[i].close) / 3;
    cumulativeTPV += tp * data[i].volume;
    cumulativeVolume += data[i].volume;

    if (cumulativeVolume === 0) {
      vwap.push(tp); // 出来高0の場合はTPをそのまま使用
    } else {
      vwap.push(cumulativeTPV / cumulativeVolume);
    }
  }

  return vwap;
}
```

### 日次リセット付きVWAP

```typescript
interface OHLCVDataWithDate extends OHLCVData {
  date: Date;
}

function calculateDailyVWAP(data: OHLCVDataWithDate[]): number[] {
  const vwap: number[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  let currentDate: string | null = null;

  for (let i = 0; i < data.length; i++) {
    const dateStr = data[i].date.toISOString().split('T')[0];

    // 日付が変わったらリセット
    if (currentDate !== dateStr) {
      cumulativeTPV = 0;
      cumulativeVolume = 0;
      currentDate = dateStr;
    }

    const tp = (data[i].high + data[i].low + data[i].close) / 3;
    cumulativeTPV += tp * data[i].volume;
    cumulativeVolume += data[i].volume;

    vwap.push(cumulativeVolume === 0 ? tp : cumulativeTPV / cumulativeVolume);
  }

  return vwap;
}
```

### VWAP標準偏差バンド

```typescript
interface VWAPBands {
  vwap: number[];
  upperBand1: number[];  // +1σ
  lowerBand1: number[];  // -1σ
  upperBand2: number[];  // +2σ
  lowerBand2: number[];  // -2σ
}

function calculateVWAPBands(data: OHLCVData[]): VWAPBands {
  const vwap: number[] = [];
  const upperBand1: number[] = [];
  const lowerBand1: number[] = [];
  const upperBand2: number[] = [];
  const lowerBand2: number[] = [];

  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  let cumulativeTPV2 = 0; // TP^2 × Volume の累積

  for (let i = 0; i < data.length; i++) {
    const tp = (data[i].high + data[i].low + data[i].close) / 3;
    cumulativeTPV += tp * data[i].volume;
    cumulativeTPV2 += tp * tp * data[i].volume;
    cumulativeVolume += data[i].volume;

    const vwapValue = cumulativeTPV / cumulativeVolume;
    vwap.push(vwapValue);

    // 標準偏差 = sqrt(E[X^2] - E[X]^2)
    const variance = cumulativeTPV2 / cumulativeVolume - vwapValue * vwapValue;
    const stdDev = Math.sqrt(Math.max(0, variance));

    upperBand1.push(vwapValue + stdDev);
    lowerBand1.push(vwapValue - stdDev);
    upperBand2.push(vwapValue + stdDev * 2);
    lowerBand2.push(vwapValue - stdDev * 2);
  }

  return { vwap, upperBand1, lowerBand1, upperBand2, lowerBand2 };
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| （なし） | - | - | パラメータ不要 |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| pricePosition | string | `above` / `below` / `at`（価格 vs VWAP） |
| deviationPercent | number | 価格とVWAPの乖離率（%） |
| trend | string | `rising` / `falling` / `flat` |

### pricePosition判定

```typescript
function getVWAPPosition(price: number, vwap: number, tolerance: number = 0.001): string {
  const deviation = (price - vwap) / vwap;
  if (deviation > tolerance) return 'above';
  if (deviation < -tolerance) return 'below';
  return 'at';
}
```

### deviationPercent計算

```typescript
function getVWAPDeviation(price: number, vwap: number): number {
  return ((price - vwap) / vwap) * 100;
}
```

### trend判定

```typescript
function getVWAPTrend(vwapValues: number[], lookback: number = 5): string {
  if (vwapValues.length < lookback) return 'flat';

  const start = vwapValues[vwapValues.length - lookback];
  const end = vwapValues[vwapValues.length - 1];
  const change = (end - start) / start;

  if (change > 0.001) return 'rising';
  if (change < -0.001) return 'falling';
  return 'flat';
}
```

## 類似度計算

| 項目 | 値 |
|------|-----|
| type | relative |
| weight | 0.8 |

### 重み配分

| 特徴量 | 重み | 許容範囲 |
|--------|------|---------|
| pricePosition | 0.40 | 完全一致 |
| deviationPercent | 0.40 | ±0.5% |
| trend | 0.20 | 完全一致 |

```typescript
function calculateVWAPSimilarity(
  current: { pricePosition: string; deviationPercent: number; trend: string },
  saved: { pricePosition: string; deviationPercent: number; trend: string }
): number {
  let score = 0;

  // pricePosition（40%）
  score += (current.pricePosition === saved.pricePosition ? 1 : 0) * 0.40;

  // deviationPercent（40%）
  const devDiff = Math.abs(current.deviationPercent - saved.deviationPercent);
  score += Math.max(0, 1 - devDiff / 1.0) * 0.40;

  // trend（20%）
  score += (current.trend === saved.trend ? 1 : 0.3) * 0.20;

  return score;
}
```

## 禁止事項

- VWAP単独での売買判断禁止
- 日中取引の基準として使用（日をまたぐと意味が薄れる）
- 出来高データがない/信頼性が低い市場では使用しない
- 機関投資家の売買基準として参考にする（上なら買い優勢、下なら売り優勢）
