# OBV（On Balance Volume）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `obv` |
| カテゴリ | volume |
| 役割 | 出来高の累積で需給を判断 |
| 出力範囲 | 負〜正（累積値） |

## 計算式

### OBV計算

```
if (close > previousClose):
    OBV = previousOBV + volume
elif (close < previousClose):
    OBV = previousOBV - volume
else:
    OBV = previousOBV  // 変化なし
```

### 実装例

```typescript
interface OHLCVData {
  close: number;
  volume: number;
}

function calculateOBV(data: OHLCVData[]): number[] {
  const obv: number[] = [];

  // 初回
  obv.push(data[0].volume);

  // 2回目以降
  for (let i = 1; i < data.length; i++) {
    const prevOBV = obv[obv.length - 1];
    const prevClose = data[i - 1].close;
    const currClose = data[i].close;
    const currVolume = data[i].volume;

    if (currClose > prevClose) {
      obv.push(prevOBV + currVolume);
    } else if (currClose < prevClose) {
      obv.push(prevOBV - currVolume);
    } else {
      obv.push(prevOBV);
    }
  }

  return obv;
}
```

### OBVのトレンド判定

```typescript
// OBVの移動平均との比較
function getOBVTrend(obv: number[], period: number = 20): string {
  if (obv.length < period) return 'unknown';

  const recent = obv.slice(-period);
  const sma = recent.reduce((a, b) => a + b, 0) / period;
  const current = obv[obv.length - 1];

  if (current > sma * 1.05) return 'bullish';
  if (current < sma * 0.95) return 'bearish';
  return 'neutral';
}

// OBVの傾き（方向性）
function getOBVSlope(obv: number[], lookback: number = 5): number {
  if (obv.length < lookback) return 0;
  const start = obv[obv.length - lookback];
  const end = obv[obv.length - 1];
  return (end - start) / lookback;
}
```

### ダイバージェンス検出

```typescript
interface DivergenceResult {
  type: 'bullish' | 'bearish' | null;
  description: string;
}

function detectOBVDivergence(
  prices: number[],
  obvValues: number[],
  lookback: number = 10
): DivergenceResult {
  if (prices.length < lookback) return { type: null, description: '' };

  const priceStart = prices[prices.length - lookback];
  const priceEnd = prices[prices.length - 1];
  const obvStart = obvValues[obvValues.length - lookback];
  const obvEnd = obvValues[obvValues.length - 1];

  const priceTrend = priceEnd > priceStart ? 'up' : 'down';
  const obvTrend = obvEnd > obvStart ? 'up' : 'down';

  // 強気ダイバージェンス: 価格下落 + OBV上昇
  if (priceTrend === 'down' && obvTrend === 'up') {
    return { type: 'bullish', description: '価格下落中にOBV上昇 → 反転上昇の兆候' };
  }

  // 弱気ダイバージェンス: 価格上昇 + OBV下落
  if (priceTrend === 'up' && obvTrend === 'down') {
    return { type: 'bearish', description: '価格上昇中にOBV下落 → 反転下落の兆候' };
  }

  return { type: null, description: '' };
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| （なし） | - | - | パラメータ不要 |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| trend | string | `bullish` / `bearish` / `neutral` |
| slope | number | OBVの傾き（正規化） |
| divergence | string \| null | `bullish` / `bearish` / null |
| smaRelation | string | `above` / `below`（OBV vs SMA） |

### slope正規化

```typescript
// 出来高スケールに依存しないよう正規化
function normalizeOBVSlope(slope: number, avgVolume: number): number {
  return slope / avgVolume;
}
```

## 類似度計算

| 項目 | 値 |
|------|-----|
| type | directional |
| weight | 0.7 |

### 重み配分

| 特徴量 | 重み |
|--------|------|
| trend | 0.40 |
| smaRelation | 0.30 |
| divergence | 0.30 |

```typescript
function calculateOBVSimilarity(
  current: { trend: string; smaRelation: string; divergence: string | null },
  saved: { trend: string; smaRelation: string; divergence: string | null }
): number {
  let score = 0;

  // trend（40%）
  score += (current.trend === saved.trend ? 1 : 0.3) * 0.40;

  // smaRelation（30%）
  score += (current.smaRelation === saved.smaRelation ? 1 : 0) * 0.30;

  // divergence（30%）- ボーナス
  if (current.divergence && current.divergence === saved.divergence) {
    score += 0.30;
  } else if (!current.divergence && !saved.divergence) {
    score += 0.15; // どちらもダイバージェンスなしなら半分
  }

  return score;
}
```

## 禁止事項

- OBV単独での売買判断禁止
- 絶対値ではなく「方向性」と「ダイバージェンス」を重視
- 出来高データがない/信頼性が低い市場では使用しない
- SMAトレンドと併用して確認すること
