# ADX（Average Directional Index）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `adx` |
| カテゴリ | trend |
| 役割 | トレンドの**強さ**を測定（方向ではない） |
| 出力範囲 | 0〜100 |

## 構成要素

| 名称 | 説明 |
|------|------|
| +DI | Positive Directional Indicator（上昇圧力） |
| -DI | Negative Directional Indicator（下落圧力） |
| ADX | +DIと-DIの差の平滑化（トレンド強度） |

## 計算式

### Step 1: True Range（TR）

```
TR = max(
  high - low,
  |high - close[prev]|,
  |low - close[prev]|
)
```

### Step 2: Directional Movement（DM）

```
+DM = high - high[prev]  (if > 0 and > -(low - low[prev]))
      else 0

-DM = low[prev] - low    (if > 0 and > +(high - high[prev]))
      else 0
```

### Step 3: Smoothed TR, +DM, -DM

```
Smoothed TR = prev_TR - (prev_TR / period) + current_TR
Smoothed +DM = prev_+DM - (prev_+DM / period) + current_+DM
Smoothed -DM = prev_-DM - (prev_-DM / period) + current_-DM
```

### Step 4: +DI, -DI

```
+DI = (Smoothed +DM / Smoothed TR) × 100
-DI = (Smoothed -DM / Smoothed TR) × 100
```

### Step 5: DX

```
DX = |+DI - -DI| / (+DI + -DI) × 100
```

### Step 6: ADX

```
ADX = EMA(DX, period) または Wilder's Smoothing
```

### 実装例

```typescript
interface OHLCData {
  high: number;
  low: number;
  close: number;
}

interface ADXResult {
  adx: number;
  plusDI: number;
  minusDI: number;
  dx: number;
}

function calculateADX(data: OHLCData[], period: number = 14): ADXResult[] {
  if (data.length < period + 1) return [];

  const result: ADXResult[] = [];

  // Step 1-2: TR, +DM, -DM 計算
  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevHigh = data[i - 1].high;
    const prevLow = data[i - 1].low;
    const prevClose = data[i - 1].close;

    // True Range
    tr.push(Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    ));

    // Directional Movement
    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
    } else {
      plusDM.push(0);
    }

    if (downMove > upMove && downMove > 0) {
      minusDM.push(downMove);
    } else {
      minusDM.push(0);
    }
  }

  // Step 3: Wilder's Smoothing（初期値はSMA）
  let smoothedTR = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];
  let smoothedDX: number | null = null; // ADX用Wilder's Smoothing

  for (let i = period; i < tr.length; i++) {
    // Wilder's Smoothing
    smoothedTR = smoothedTR - (smoothedTR / period) + tr[i];
    smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + plusDM[i];
    smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + minusDM[i];

    // Step 4: +DI, -DI
    const plusDI = (smoothedPlusDM / smoothedTR) * 100;
    const minusDI = (smoothedMinusDM / smoothedTR) * 100;

    // Step 5: DX
    const diSum = plusDI + minusDI;
    const dx = diSum === 0 ? 0 : (Math.abs(plusDI - minusDI) / diSum) * 100;
    dxValues.push(dx);

    // Step 6: ADX（DXのWilder's Smoothing）
    if (dxValues.length === period) {
      // 初回: DX値のSMA
      smoothedDX = dxValues.reduce((a, b) => a + b, 0) / period;
    } else if (dxValues.length > period) {
      // 2回目以降: Wilder's Smoothing
      smoothedDX = smoothedDX! - (smoothedDX! / period) + dx;
    }

    if (smoothedDX !== null) {
      result.push({
        adx: smoothedDX,
        plusDI,
        minusDI,
        dx,
      });
    }
  }

  return result;
}
```

### トレンド強度判定

```typescript
function getTrendStrength(adx: number): string {
  if (adx >= 50) return 'very_strong';
  if (adx >= 25) return 'strong';
  if (adx >= 20) return 'weak';
  return 'absent'; // トレンドなし（レンジ）
}
```

### トレンド方向判定

```typescript
function getTrendDirection(plusDI: number, minusDI: number): string {
  if (plusDI > minusDI) return 'bullish';
  if (minusDI > plusDI) return 'bearish';
  return 'neutral';
}
```

### DIクロス検出

```typescript
function detectDICross(
  currentPlusDI: number,
  prevPlusDI: number,
  currentMinusDI: number,
  prevMinusDI: number
): string | null {
  // +DIが-DIを上抜け（強気シグナル）
  if (prevPlusDI <= prevMinusDI && currentPlusDI > currentMinusDI) {
    return 'bullish_cross';
  }
  // -DIが+DIを上抜け（弱気シグナル）
  if (prevPlusDI >= prevMinusDI && currentPlusDI < currentMinusDI) {
    return 'bearish_cross';
  }
  return null;
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| period | 14 | 5〜50（整数） | 計算期間 |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| adx | number | ADX値（トレンド強度） |
| strength | string | `very_strong` / `strong` / `weak` / `absent` |
| direction | string | `bullish` / `bearish` / `neutral` |
| plusDI | number | +DI値 |
| minusDI | number | -DI値 |
| diCross | string \| null | `bullish_cross` / `bearish_cross` / null |

## 類似度計算

| 項目 | 値 |
|------|-----|
| type | absolute |
| weight | 0.90（高優先度） |

### 重み配分

| 特徴量 | 重み | 許容範囲 |
|--------|------|---------|
| strength | 0.35 | 完全一致 |
| direction | 0.30 | 完全一致 |
| adx | 0.20 | ±10 |
| diCross | 0.15 | 完全一致 |

```typescript
function calculateADXSimilarity(
  current: {
    adx: number;
    strength: string;
    direction: string;
    diCross: string | null;
  },
  saved: {
    adx: number;
    strength: string;
    direction: string;
    diCross: string | null;
  }
): number {
  let score = 0;

  // strength（35%）- 最重要
  score += (current.strength === saved.strength ? 1 : 0) * 0.35;

  // direction（30%）
  score += (current.direction === saved.direction ? 1 : 0) * 0.30;

  // adx値（20%）
  const adxDiff = Math.abs(current.adx - saved.adx);
  score += Math.max(0, 1 - adxDiff / 20) * 0.20;

  // diCross（15%）- ボーナス
  if (current.diCross && current.diCross === saved.diCross) {
    score += 0.15;
  } else if (!current.diCross && !saved.diCross) {
    score += 0.10;
  }

  return score;
}
```

## ADX解釈ガイド

| ADX値 | 解釈 | 推奨アクション |
|-------|------|---------------|
| 0-20 | トレンドなし（レンジ） | トレンドフォロー系は使わない |
| 20-25 | 弱いトレンド | 慎重にエントリー |
| 25-50 | 強いトレンド | トレンドフォロー有効 |
| 50-75 | 非常に強いトレンド | 追随継続 or 利確検討 |
| 75-100 | 極端に強い | 反転リスク注意 |

## 使い方のポイント

- **ADXはトレンドの強さのみ** - 方向は+DI/-DIで判断
- **ADX > 25**: トレンドあり → MACD/PSARが有効
- **ADX < 20**: レンジ → RSI/Stochasticが有効
- **ADX上昇**: トレンド強化中
- **ADX下落**: トレンド弱化中（方向転換ではない）

## 他指標との組み合わせ

| 組み合わせ | 用途 |
|-----------|------|
| ADX + PSAR | ADX>25でPSARシグナル有効化 |
| ADX + MACD | トレンド確認後のエントリー |
| ADX + RSI | ADX<20でRSI逆張り有効化 |
| ADX + BB | レンジ/トレンド判定でBB戦略切替 |

## 禁止事項

- ADX単独での売買判断禁止
- **ADXは方向を示さない** - +DI/-DIを見ること
- ADX下落＝トレンド反転ではない（弱化のみ）
- ADXのクロスオーバー（25上抜け等）は遅延あり
