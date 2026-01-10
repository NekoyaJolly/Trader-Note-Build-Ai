# TEMA（Triple Exponential Moving Average）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `tema` |
| カテゴリ | trend |
| 役割 | DEMAをさらに改良した超高速移動平均 |
| 出力範囲 | 価格と同じ |

## 計算式

### TEMA

```
TEMA = 3 × EMA1 - 3 × EMA2 + EMA3

where:
  EMA1 = EMA(price, n)
  EMA2 = EMA(EMA1, n)
  EMA3 = EMA(EMA2, n)
```

### 解説

TEMAはDEMAの発展形で、三重のEMAを組み合わせてラグをさらに削減する。

```
EMA1 = 価格のEMA
EMA2 = EMA1のEMA
EMA3 = EMA2のEMA
TEMA = 3×EMA1 - 3×EMA2 + EMA3
```

### 実装例

```typescript
function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  // 最初の値はSMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  ema.push(sum / period);

  // EMA計算
  for (let i = period; i < data.length; i++) {
    const value = (data[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
    ema.push(value);
  }

  return ema;
}

function calculateTEMA(closes: number[], period: number = 20): number[] {
  // Step 1: EMA1（価格のEMA）
  const ema1 = calculateEMA(closes, period);

  // Step 2: EMA2（EMA1のEMA）
  const ema2 = calculateEMA(ema1, period);

  // Step 3: EMA3（EMA2のEMA）
  const ema3 = calculateEMA(ema2, period);

  // Step 4: TEMA = 3×EMA1 - 3×EMA2 + EMA3
  // ※ 各EMAの長さが異なるため、インデックス調整が必要
  const tema: number[] = [];
  const offset1 = period - 1;        // EMA2のオフセット
  const offset2 = 2 * (period - 1);  // EMA3のオフセット

  for (let i = 0; i < ema3.length; i++) {
    const e1 = ema1[i + offset2];
    const e2 = ema2[i + offset1];
    const e3 = ema3[i];
    tema.push(3 * e1 - 3 * e2 + e3);
  }

  return tema;
}
```

### クロス検出

```typescript
function detectTEMACross(
  currentPrice: number,
  prevPrice: number,
  currentTEMA: number,
  prevTEMA: number
): string | null {
  // 価格がTEMAを上抜け
  if (prevPrice <= prevTEMA && currentPrice > currentTEMA) {
    return 'bullish_cross';
  }
  // 価格がTEMAを下抜け
  if (prevPrice >= prevTEMA && currentPrice < currentTEMA) {
    return 'bearish_cross';
  }
  return null;
}
```

### TEMA同士のクロス

```typescript
function detectTEMATEMACross(
  shortTEMA: number,
  prevShortTEMA: number,
  longTEMA: number,
  prevLongTEMA: number
): string | null {
  // 短期TEMAが長期TEMAを上抜け（ゴールデンクロス）
  if (prevShortTEMA <= prevLongTEMA && shortTEMA > longTEMA) {
    return 'golden_cross';
  }
  // 短期TEMAが長期TEMAを下抜け（デッドクロス）
  if (prevShortTEMA >= prevLongTEMA && shortTEMA < longTEMA) {
    return 'death_cross';
  }
  return null;
}
```

### トレンド判定

```typescript
function getTEMATrend(
  price: number,
  tema: number,
  prevTema: number
): { position: string; direction: string; strength: string } {
  const direction = tema > prevTema ? 'rising' : 'falling';
  const position = price > tema ? 'above' : 'below';

  // トレンド強度（価格とTEMAの乖離率）
  const distance = Math.abs((price - tema) / tema) * 100;
  let strength: string;
  if (distance >= 2) strength = 'strong';
  else if (distance >= 0.5) strength = 'moderate';
  else strength = 'weak';

  return { position, direction, strength };
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| period | 20 | 1〜200（整数） | 計算期間 |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| value | number | 現在TEMA値 |
| pricePosition | string | `above` / `below`（価格との位置関係） |
| direction | string | `rising` / `falling`（TEMA自体の傾き） |
| distance | number | 価格とTEMAの乖離率（%） |
| strength | string | `strong` / `moderate` / `weak` |
| cross | string \| null | `bullish_cross` / `bearish_cross` / null |

### 乖離率計算

```typescript
function calculateDistance(price: number, tema: number): number {
  return ((price - tema) / tema) * 100;
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
| pricePosition | 0.25 | 完全一致 |
| direction | 0.25 | 完全一致 |
| distance | 0.25 | ±1% |
| strength | 0.15 | 完全一致 |
| cross | 0.10 | 完全一致 |

```typescript
function calculateTEMASimilarity(
  current: {
    pricePosition: string;
    direction: string;
    distance: number;
    strength: string;
    cross: string | null;
  },
  saved: {
    pricePosition: string;
    direction: string;
    distance: number;
    strength: string;
    cross: string | null;
  }
): number {
  let score = 0;

  // pricePosition（25%）
  score += (current.pricePosition === saved.pricePosition ? 1 : 0) * 0.25;

  // direction（25%）
  score += (current.direction === saved.direction ? 1 : 0) * 0.25;

  // distance（25%）
  const distDiff = Math.abs(current.distance - saved.distance);
  score += Math.max(0, 1 - distDiff / 2) * 0.25;

  // strength（15%）
  score += (current.strength === saved.strength ? 1 : 0.4) * 0.15;

  // cross（10%）- ボーナス
  if (current.cross && current.cross === saved.cross) {
    score += 0.10;
  }

  return score;
}
```

## 移動平均の比較

| 項目 | SMA | EMA | DEMA | TEMA |
|------|-----|-----|------|------|
| ラグ | 大 | 中 | 小 | 最小 |
| 反応速度 | 遅い | 普通 | 速い | 最速 |
| ノイズ | 少ない | 普通 | やや多い | 多い |
| 計算複雑度 | 低 | 中 | 高 | 最高 |
| ダマシ | 少ない | 普通 | やや多い | 多い |

## 使い方のポイント

- **TEMA上向き + 価格がTEMA上**: 強い上昇トレンド
- **TEMA下向き + 価格がTEMA下**: 強い下落トレンド
- **短期TEMA(10) × 長期TEMA(30)クロス**: トレンド転換シグナル
- **DEMAより更に早いがダマシも増加**: フィルター必須

## DEMA/TEMAの使い分け

| 状況 | 推奨 |
|------|------|
| トレンド明確 | TEMA（早期エントリー） |
| レンジ相場 | DEMA以下（ダマシ軽減） |
| スキャルピング | TEMA |
| スイング | DEMA or EMA |

## 禁止事項

- TEMA単独での売買判断禁止
- レンジ相場では頻繁にクロスが発生するため注意
- 短期間設定（10未満）はノイズが非常に多い
- 必ずトレンドフィルター（ADX等）と組み合わせること
- 「最速」≠「最良」であることを理解すること
