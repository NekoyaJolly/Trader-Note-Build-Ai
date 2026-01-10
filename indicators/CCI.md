# CCI（Commodity Channel Index）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `cci` |
| カテゴリ | momentum |
| 役割 | 平均価格からの乖離度を測定 |
| 出力範囲 | 制限なし（通常-200〜+200） |

## 計算式

### Step 1: Typical Price（TP）

```
TP = (high + low + close) / 3
```

### Step 2: TPの単純移動平均

```
SMA_TP = SMA(TP, period)
```

### Step 3: 平均偏差（Mean Deviation）

```
MD = Σ|TP - SMA_TP| / period
```

### Step 4: CCI計算

```
CCI = (TP - SMA_TP) / (0.015 × MD)
```

※ 0.015は定数（約70-80%の値が-100〜+100に収まるよう調整）

### 実装例

```typescript
interface OHLCData {
  high: number;
  low: number;
  close: number;
}

function calculateCCI(data: OHLCData[], period: number = 20): number[] {
  const cci: number[] = [];

  // Typical Price計算
  const tp: number[] = data.map(d => (d.high + d.low + d.close) / 3);

  for (let i = period - 1; i < tp.length; i++) {
    // Step 2: TPのSMA
    const tpSlice = tp.slice(i - period + 1, i + 1);
    const smaTP = tpSlice.reduce((a, b) => a + b, 0) / period;

    // Step 3: 平均偏差
    const meanDeviation = tpSlice.reduce((sum, t) => sum + Math.abs(t - smaTP), 0) / period;

    // Step 4: CCI
    if (meanDeviation === 0) {
      cci.push(0);
    } else {
      cci.push((tp[i] - smaTP) / (0.015 * meanDeviation));
    }
  }

  return cci;
}
```

### シグナル判定

```typescript
function getCCISignal(
  current: number,
  prev: number,
  overbought: number = 100,
  oversold: number = -100
): string | null {
  // +100を上抜け → 強気トレンド開始
  if (prev <= overbought && current > overbought) {
    return 'bullish_breakout';
  }
  // -100を下抜け → 弱気トレンド開始
  if (prev >= oversold && current < oversold) {
    return 'bearish_breakout';
  }
  // +100を下回る → 強気トレンド終了
  if (prev >= overbought && current < overbought) {
    return 'bullish_end';
  }
  // -100を上回る → 弱気トレンド終了
  if (prev <= oversold && current > oversold) {
    return 'bearish_end';
  }
  return null;
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| period | 20 | 1〜100（整数） | 計算期間 |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| value | number | 現在CCI値 |
| zone | string | `overbought` / `oversold` / `neutral` |
| slope | number | 傾き = CCI[t] - CCI[t-1] |
| zeroLineCross | string \| null | `above` / `below` / null |

### zone判定

```typescript
function getCCIZone(
  value: number,
  overbought: number = 100,
  oversold: number = -100
): string {
  if (value >= overbought) return 'overbought';
  if (value <= oversold) return 'oversold';
  return 'neutral';
}
```

### zeroLineCross判定

```typescript
function getCCIZeroCross(current: number, prev: number): string | null {
  if (prev <= 0 && current > 0) return 'above';
  if (prev >= 0 && current < 0) return 'below';
  return null;
}
```

## 類似度計算

| 項目 | 値 |
|------|-----|
| type | absolute |
| weight | 0.9 |

### 重み配分

| 特徴量 | 重み | 許容範囲 |
|--------|------|---------|
| value | 0.40 | ±30 |
| zone | 0.30 | 完全一致 |
| slope | 0.20 | ±15 |
| zeroLineCross | 0.10 | 完全一致 |

```typescript
function calculateCCISimilarity(
  current: { value: number; zone: string; slope: number; zeroLineCross: string | null },
  saved: { value: number; zone: string; slope: number; zeroLineCross: string | null }
): number {
  let score = 0;

  // value（40%）
  const valueDiff = Math.abs(current.value - saved.value);
  score += Math.max(0, 1 - valueDiff / 60) * 0.40;

  // zone（30%）
  score += (current.zone === saved.zone ? 1 : 0) * 0.30;

  // slope（20%）
  const slopeDiff = Math.abs(current.slope - saved.slope);
  score += Math.max(0, 1 - slopeDiff / 30) * 0.20;

  // zeroLineCross（10%）- ボーナス
  if (current.zeroLineCross && current.zeroLineCross === saved.zeroLineCross) {
    score += 0.10;
  }

  return score;
}
```

## 使い方のポイント

- **+100超え**: 強い上昇トレンド（順張り買い検討）
- **-100未満**: 強い下降トレンド（順張り売り検討）
- **0ラインクロス**: トレンド方向の転換シグナル

## 禁止事項

- CCI単独での売買判断禁止
- ±100は「買われすぎ/売られすぎ」ではなく「トレンドの強さ」を示す
- RSIと異なり、逆張りではなく順張り指標として使用
- SMAトレンド方向と併用して確認すること
