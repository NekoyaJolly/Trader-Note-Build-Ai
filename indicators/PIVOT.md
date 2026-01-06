# Pivot Points（ピボットポイント）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `pivot` |
| カテゴリ | support_resistance |
| 役割 | 自動的なサポート/レジスタンスレベル計算 |
| 出力範囲 | 価格と同じ（7本のライン） |

## 構成要素

| 名称 | 説明 |
|------|------|
| PP | Pivot Point（中心線） |
| R1, R2, R3 | Resistance（レジスタンス）レベル |
| S1, S2, S3 | Support（サポート）レベル |

## 計算式（Standard Pivot）

### Pivot Point

```
PP = (High + Low + Close) / 3

※ 前日（または前期間）のHigh, Low, Closeを使用
```

### Resistance Levels

```
R1 = (2 × PP) - Low
R2 = PP + (High - Low)
R3 = High + 2 × (PP - Low)
```

### Support Levels

```
S1 = (2 × PP) - High
S2 = PP - (High - Low)
S3 = Low - 2 × (High - PP)
```

### 実装例

```typescript
interface PivotInput {
  high: number;   // 前期間の高値
  low: number;    // 前期間の安値
  close: number;  // 前期間の終値
}

interface PivotResult {
  pp: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
}

function calculateStandardPivot(input: PivotInput): PivotResult {
  const { high, low, close } = input;

  const pp = (high + low + close) / 3;

  return {
    pp,
    r1: (2 * pp) - low,
    r2: pp + (high - low),
    r3: high + 2 * (pp - low),
    s1: (2 * pp) - high,
    s2: pp - (high - low),
    s3: low - 2 * (high - pp),
  };
}
```

### Fibonacci Pivot（オプション）

```typescript
function calculateFibonacciPivot(input: PivotInput): PivotResult {
  const { high, low, close } = input;
  const range = high - low;

  const pp = (high + low + close) / 3;

  return {
    pp,
    r1: pp + 0.382 * range,
    r2: pp + 0.618 * range,
    r3: pp + 1.000 * range,
    s1: pp - 0.382 * range,
    s2: pp - 0.618 * range,
    s3: pp - 1.000 * range,
  };
}
```

### Camarilla Pivot（オプション）

```typescript
function calculateCamarillaPivot(input: PivotInput): PivotResult {
  const { high, low, close } = input;
  const range = high - low;

  const pp = (high + low + close) / 3;

  return {
    pp,
    r1: close + range * 1.1 / 12,
    r2: close + range * 1.1 / 6,
    r3: close + range * 1.1 / 4,
    s1: close - range * 1.1 / 12,
    s2: close - range * 1.1 / 6,
    s3: close - range * 1.1 / 4,
  };
}
```

### 価格位置判定

```typescript
function getPriceZone(price: number, pivot: PivotResult): string {
  if (price > pivot.r3) return 'above_r3';
  if (price > pivot.r2) return 'r2_r3';
  if (price > pivot.r1) return 'r1_r2';
  if (price > pivot.pp) return 'pp_r1';
  if (price > pivot.s1) return 's1_pp';
  if (price > pivot.s2) return 's2_s1';
  if (price > pivot.s3) return 's3_s2';
  return 'below_s3';
}
```

### 最寄りレベル検出

```typescript
interface NearestLevel {
  level: string;
  price: number;
  distance: number;
  distancePercent: number;
}

function findNearestLevels(
  price: number,
  pivot: PivotResult
): { support: NearestLevel | null; resistance: NearestLevel | null } {
  const levels = [
    { level: 's3', price: pivot.s3 },
    { level: 's2', price: pivot.s2 },
    { level: 's1', price: pivot.s1 },
    { level: 'pp', price: pivot.pp },
    { level: 'r1', price: pivot.r1 },
    { level: 'r2', price: pivot.r2 },
    { level: 'r3', price: pivot.r3 },
  ];

  let nearestSupport: NearestLevel | null = null;
  let nearestResistance: NearestLevel | null = null;

  for (const lvl of levels) {
    const distance = price - lvl.price;
    const distancePercent = (distance / price) * 100;

    if (distance > 0) {
      // 価格より下 = サポート
      if (!nearestSupport || distance < nearestSupport.distance) {
        nearestSupport = { ...lvl, distance, distancePercent };
      }
    } else if (distance < 0) {
      // 価格より上 = レジスタンス
      const absDist = Math.abs(distance);
      if (!nearestResistance || absDist < Math.abs(nearestResistance.distance)) {
        nearestResistance = { ...lvl, distance, distancePercent: Math.abs(distancePercent) };
      }
    }
  }

  return { support: nearestSupport, resistance: nearestResistance };
}
```

### レベルブレイク検出

```typescript
function detectPivotBreak(
  currentPrice: number,
  prevPrice: number,
  pivot: PivotResult
): string | null {
  const levels = [
    { level: 'r3', price: pivot.r3 },
    { level: 'r2', price: pivot.r2 },
    { level: 'r1', price: pivot.r1 },
    { level: 'pp', price: pivot.pp },
    { level: 's1', price: pivot.s1 },
    { level: 's2', price: pivot.s2 },
    { level: 's3', price: pivot.s3 },
  ];

  for (const lvl of levels) {
    // 上抜け
    if (prevPrice <= lvl.price && currentPrice > lvl.price) {
      return `break_above_${lvl.level}`;
    }
    // 下抜け
    if (prevPrice >= lvl.price && currentPrice < lvl.price) {
      return `break_below_${lvl.level}`;
    }
  }

  return null;
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| type | standard | standard/fibonacci/camarilla | 計算方式 |
| timeframe | daily | daily/weekly/monthly | 基準期間 |

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| zone | string | 価格のゾーン位置 |
| nearestSupport | string | 最寄りサポートレベル名 |
| nearestResistance | string | 最寄りレジスタンスレベル名 |
| distanceToSupport | number | サポートまでの距離（%） |
| distanceToResistance | number | レジスタンスまでの距離（%） |
| levelBreak | string \| null | ブレイクしたレベル |

## 類似度計算

| 項目 | 値 |
|------|-----|
| type | relative（価格基準） |
| weight | 0.85 |

### 重み配分

| 特徴量 | 重み | 許容範囲 |
|--------|------|---------|
| zone | 0.30 | 完全一致 |
| nearestSupport | 0.20 | 完全一致 |
| nearestResistance | 0.20 | 完全一致 |
| distanceToSupport | 0.15 | ±0.5% |
| levelBreak | 0.15 | 完全一致 |

```typescript
function calculatePivotSimilarity(
  current: {
    zone: string;
    nearestSupport: string;
    nearestResistance: string;
    distanceToSupport: number;
    levelBreak: string | null;
  },
  saved: {
    zone: string;
    nearestSupport: string;
    nearestResistance: string;
    distanceToSupport: number;
    levelBreak: string | null;
  }
): number {
  let score = 0;

  // zone（30%）
  score += (current.zone === saved.zone ? 1 : 0) * 0.30;

  // nearestSupport（20%）
  score += (current.nearestSupport === saved.nearestSupport ? 1 : 0.3) * 0.20;

  // nearestResistance（20%）
  score += (current.nearestResistance === saved.nearestResistance ? 1 : 0.3) * 0.20;

  // distanceToSupport（15%）
  const distDiff = Math.abs(current.distanceToSupport - saved.distanceToSupport);
  score += Math.max(0, 1 - distDiff / 1.0) * 0.15;

  // levelBreak（15%）- ボーナス
  if (current.levelBreak && current.levelBreak === saved.levelBreak) {
    score += 0.15;
  } else if (!current.levelBreak && !saved.levelBreak) {
    score += 0.10;
  }

  return score;
}
```

## 使い方のポイント

- **PP上で推移**: 強気バイアス
- **PP下で推移**: 弱気バイアス
- **S1/R1**: 日中の主要サポレジ
- **S2/R2**: 強めのサポレジ（ブレイク=トレンド加速）
- **S3/R3**: 極端なレベル（到達は稀）

## トレード戦略例

| 状況 | 戦略 |
|------|------|
| PPで反発 | PPをサポートにロング |
| R1に到達 | 利確検討 or ブレイク待ち |
| S1ブレイク | S2までの下落を想定 |
| PP〜R1レンジ | レンジ内逆張り |

## 禁止事項

- Pivot単独での売買判断禁止
- **前日データが必要** - 当日最初は前日ベースで計算
- 流動性の低い時間帯はダマシが増える
- 重要経済指標発表時はレベルが無視されやすい
- トレンド方向と組み合わせて使用すること
