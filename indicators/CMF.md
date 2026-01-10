# CMF（Chaikin Money Flow）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `cmf` |
| カテゴリ | volume |
| 役割 | 一定期間の資金流入・流出を測定 |
| 出力範囲 | -1〜+1 |

## 計算式

### Step 1: Money Flow Multiplier（MFM）

```
MFM = ((close - low) - (high - close)) / (high - low)
    = (2 × close - low - high) / (high - low)

※ high = low の場合は 0
```

### Step 2: Money Flow Volume（MFV）

```
MFV = MFM × volume
```

### Step 3: CMF

```
CMF = Σ MFV(n期間) / Σ volume(n期間)
```

### 実装例

```typescript
interface OHLCVData {
  high: number;
  low: number;
  close: number;
  volume: number;
}

function calculateCMF(data: OHLCVData[], period: number = 20): number[] {
  const cmf: number[] = [];

  // Money Flow Multiplier計算
  const mfm = data.map((d) => {
    const range = d.high - d.low;
    if (range === 0) return 0;
    return (2 * d.close - d.low - d.high) / range;
  });

  // Money Flow Volume計算
  const mfv = data.map((d, i) => mfm[i] * d.volume);

  for (let i = period - 1; i < data.length; i++) {
    let sumMFV = 0;
    let sumVolume = 0;

    for (let j = i - period + 1; j <= i; j++) {
      sumMFV += mfv[j];
      sumVolume += data[j].volume;
    }

    // ゼロ除算防止
    if (sumVolume === 0) {
      cmf.push(0);
    } else {
      cmf.push(sumMFV / sumVolume);
    }
  }

  return cmf;
}
```

### CMFシグナル検出

```typescript
function detectCMFSignal(current: number, prev: number): string | null {
  // ゼロを上抜け → 買い圧力優勢
  if (prev <= 0 && current > 0) return 'bullish_cross';
  // ゼロを下抜け → 売り圧力優勢
  if (prev >= 0 && current < 0) return 'bearish_cross';
  return null;
}
```

### 強度判定

```typescript
function getCMFStrength(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 0.25) return 'strong';
  if (abs >= 0.10) return 'moderate';
  return 'weak';
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| period | 20 | 1〜50（整数） | 計算期間 |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| value | number | 現在CMF値（-1〜+1） |
| zone | string | `accumulation`（>0） / `distribution`（<0） |
| strength | string | `strong` / `moderate` / `weak` |
| slope | number | 傾き = CMF[t] - CMF[t-1] |
| zeroCross | string \| null | `bullish_cross` / `bearish_cross` / null |

### zone判定

```typescript
function getCMFZone(value: number): string {
  return value > 0 ? 'accumulation' : 'distribution';
}
```

## 類似度計算

| 項目 | 値 |
|------|-----|
| type | absolute |
| weight | 0.80 |

### 重み配分

| 特徴量 | 重み | 許容範囲 |
|--------|------|---------|
| value | 0.35 | ±0.1 |
| zone | 0.25 | 完全一致 |
| strength | 0.20 | 完全一致 |
| slope | 0.15 | ±0.05 |
| zeroCross | 0.05 | 完全一致 |

```typescript
function calculateCMFSimilarity(
  current: {
    value: number;
    zone: string;
    strength: string;
    slope: number;
    zeroCross: string | null;
  },
  saved: {
    value: number;
    zone: string;
    strength: string;
    slope: number;
    zeroCross: string | null;
  }
): number {
  let score = 0;

  // value（35%）
  const valueDiff = Math.abs(current.value - saved.value);
  score += Math.max(0, 1 - valueDiff / 0.2) * 0.35;

  // zone（25%）
  score += (current.zone === saved.zone ? 1 : 0) * 0.25;

  // strength（20%）
  score += (current.strength === saved.strength ? 1 : 0.4) * 0.20;

  // slope（15%）
  const slopeDiff = Math.abs(current.slope - saved.slope);
  score += Math.max(0, 1 - slopeDiff / 0.1) * 0.15;

  // zeroCross（5%）- ボーナス
  if (current.zeroCross && current.zeroCross === saved.zeroCross) {
    score += 0.05;
  }

  return score;
}
```

## MFIとの違い

| 項目 | MFI | CMF |
|------|-----|-----|
| 範囲 | 0〜100 | -1〜+1 |
| 基準線 | 50 | 0 |
| 計算 | RSI式 | 平均式 |
| 解釈 | 買われすぎ/売られすぎ | 資金流入/流出の強さ |
| 特徴 | 極端値検出 | 継続的なフロー測定 |

## 使い方のポイント

- **CMF > 0**: 買い圧力優勢（Accumulation）
- **CMF < 0**: 売り圧力優勢（Distribution）
- **CMF > 0.25**: 強い買い圧力
- **CMF < -0.25**: 強い売り圧力
- **ゼロラインクロス**: トレンド転換の可能性

## 禁止事項

- CMF単独での売買判断禁止
- 出来高データがない銘柄では使用不可
- 値が小さい（±0.05未満）時は信頼性低い
- トレンド方向と組み合わせて使用すること
