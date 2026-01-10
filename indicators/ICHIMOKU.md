# Ichimoku（一目均衡表）

## 基本情報

| 項目 | 値 |
|------|-----|
| ID | `ichimoku` |
| カテゴリ | trend |
| 役割 | トレンド・支持抵抗・モメンタムを一目で把握 |
| 出力範囲 | 価格と同じ（5本のライン + 雲） |

## 構成要素

| 日本語名 | 英語名 | 説明 |
|----------|--------|------|
| 転換線 | Tenkan-sen | 短期トレンド |
| 基準線 | Kijun-sen | 中期トレンド |
| 先行スパン1 | Senkou Span A | 雲の上辺/下辺 |
| 先行スパン2 | Senkou Span B | 雲の上辺/下辺 |
| 遅行スパン | Chikou Span | モメンタム確認 |

## 計算式

### 転換線（Tenkan-sen）

```
Tenkan = (highest_high(9) + lowest_low(9)) / 2
```

### 基準線（Kijun-sen）

```
Kijun = (highest_high(26) + lowest_low(26)) / 2
```

### 先行スパン1（Senkou Span A）

```
Senkou_A = (Tenkan + Kijun) / 2
※ 26期間先にプロット
```

### 先行スパン2（Senkou Span B）

```
Senkou_B = (highest_high(52) + lowest_low(52)) / 2
※ 26期間先にプロット
```

### 遅行スパン（Chikou Span）

```
Chikou = 現在の終値
※ 26期間前にプロット
```

### 雲（Kumo）

```
雲 = Senkou_A と Senkou_B の間の領域
陽雲: Senkou_A > Senkou_B（上昇トレンド示唆）
陰雲: Senkou_A < Senkou_B（下落トレンド示唆）
```

### 実装例

```typescript
interface OHLCData {
  high: number;
  low: number;
  close: number;
}

interface IchimokuResult {
  tenkan: number;       // 転換線
  kijun: number;        // 基準線
  senkouA: number;      // 先行スパン1（26期間先の値）
  senkouB: number;      // 先行スパン2（26期間先の値）
  chikou: number;       // 遅行スパン（現在終値、26期間前にプロット）
  cloudTop: number;     // 雲の上辺
  cloudBottom: number;  // 雲の下辺
  cloudType: 'bullish' | 'bearish';
}

function highestHigh(data: OHLCData[], period: number, endIndex: number): number {
  let max = -Infinity;
  const start = Math.max(0, endIndex - period + 1);
  for (let i = start; i <= endIndex; i++) {
    if (data[i].high > max) max = data[i].high;
  }
  return max;
}

function lowestLow(data: OHLCData[], period: number, endIndex: number): number {
  let min = Infinity;
  const start = Math.max(0, endIndex - period + 1);
  for (let i = start; i <= endIndex; i++) {
    if (data[i].low < min) min = data[i].low;
  }
  return min;
}

function calculateIchimoku(
  data: OHLCData[],
  tenkanPeriod: number = 9,
  kijunPeriod: number = 26,
  senkouBPeriod: number = 52,
  displacement: number = 26
): IchimokuResult[] {
  const result: IchimokuResult[] = [];

  // 最低限必要なデータ数
  const minRequired = Math.max(senkouBPeriod, kijunPeriod);
  if (data.length < minRequired) return result;

  for (let i = minRequired - 1; i < data.length; i++) {
    // 転換線
    const tenkanHigh = highestHigh(data, tenkanPeriod, i);
    const tenkanLow = lowestLow(data, tenkanPeriod, i);
    const tenkan = (tenkanHigh + tenkanLow) / 2;

    // 基準線
    const kijunHigh = highestHigh(data, kijunPeriod, i);
    const kijunLow = lowestLow(data, kijunPeriod, i);
    const kijun = (kijunHigh + kijunLow) / 2;

    // 先行スパン1（現在計算、表示は26期間先）
    const senkouA = (tenkan + kijun) / 2;

    // 先行スパン2（現在計算、表示は26期間先）
    const senkouBHigh = highestHigh(data, senkouBPeriod, i);
    const senkouBLow = lowestLow(data, senkouBPeriod, i);
    const senkouB = (senkouBHigh + senkouBLow) / 2;

    // 遅行スパン（現在の終値）
    const chikou = data[i].close;

    // 雲の判定
    const cloudTop = Math.max(senkouA, senkouB);
    const cloudBottom = Math.min(senkouA, senkouB);
    const cloudType = senkouA > senkouB ? 'bullish' : 'bearish';

    result.push({
      tenkan,
      kijun,
      senkouA,
      senkouB,
      chikou,
      cloudTop,
      cloudBottom,
      cloudType,
    });
  }

  return result;
}
```

### 価格と雲の位置関係

```typescript
function getPriceCloudPosition(
  price: number,
  cloudTop: number,
  cloudBottom: number
): string {
  if (price > cloudTop) return 'above_cloud';
  if (price < cloudBottom) return 'below_cloud';
  return 'inside_cloud';
}
```

### TK クロス（転換線と基準線のクロス）

```typescript
function detectTKCross(
  currentTenkan: number,
  prevTenkan: number,
  currentKijun: number,
  prevKijun: number
): string | null {
  // 転換線が基準線を上抜け（強気）
  if (prevTenkan <= prevKijun && currentTenkan > currentKijun) {
    return 'bullish_tk_cross';
  }
  // 転換線が基準線を下抜け（弱気）
  if (prevTenkan >= prevKijun && currentTenkan < currentKijun) {
    return 'bearish_tk_cross';
  }
  return null;
}
```

### 雲ブレイク検出

```typescript
function detectCloudBreak(
  currentPrice: number,
  prevPrice: number,
  cloudTop: number,
  cloudBottom: number,
  prevCloudTop: number,
  prevCloudBottom: number
): string | null {
  // 雲を上抜け
  if (prevPrice <= prevCloudTop && currentPrice > cloudTop) {
    return 'bullish_cloud_break';
  }
  // 雲を下抜け
  if (prevPrice >= prevCloudBottom && currentPrice < cloudBottom) {
    return 'bearish_cloud_break';
  }
  return null;
}
```

### 三役好転・三役逆転

```typescript
interface IchimokuSignal {
  priceAboveCloud: boolean;
  tenkanAboveKijun: boolean;
  chikouAbovePrice: boolean;  // 26期間前の価格と比較
}

function checkSanYaku(signal: IchimokuSignal): string | null {
  // 三役好転（強い買いシグナル）
  if (signal.priceAboveCloud && signal.tenkanAboveKijun && signal.chikouAbovePrice) {
    return 'sanYaku_bullish';
  }
  // 三役逆転（強い売りシグナル）
  if (!signal.priceAboveCloud && !signal.tenkanAboveKijun && !signal.chikouAbovePrice) {
    return 'sanYaku_bearish';
  }
  return null;
}
```

## ユーザー設定

| パラメータ | デフォルト | 範囲 | 説明 |
|-----------|-----------|------|------|
| tenkanPeriod | 9 | 5〜30（整数） | 転換線期間 |
| kijunPeriod | 26 | 10〜60（整数） | 基準線期間 |
| senkouBPeriod | 52 | 20〜120（整数） | 先行スパンB期間 |
| displacement | 26 | 10〜60（整数） | 先行スパン表示位置 |

> **注意**: デフォルト値(9,26,52)は日足用。他の時間軸では調整が必要。

## マッチング特徴量

| 特徴量 | 型 | 説明 |
|--------|-----|------|
| pricePosition | string | `above_cloud` / `inside_cloud` / `below_cloud` |
| cloudType | string | `bullish` / `bearish` |
| tkPosition | string | `tenkan_above` / `tenkan_below` |
| tkCross | string \| null | `bullish_tk_cross` / `bearish_tk_cross` / null |
| cloudBreak | string \| null | `bullish_cloud_break` / `bearish_cloud_break` / null |
| sanYaku | string \| null | `sanYaku_bullish` / `sanYaku_bearish` / null |
| cloudThickness | number | 雲の厚さ（%） |

### 雲の厚さ計算

```typescript
function calculateCloudThickness(
  cloudTop: number,
  cloudBottom: number,
  price: number
): number {
  return ((cloudTop - cloudBottom) / price) * 100;
}
```

## 類似度計算

| 項目 | 値 |
|------|-----|
| type | relative（価格基準） |
| weight | 0.95（高優先度） |

### 重み配分

| 特徴量 | 重み | 許容範囲 |
|--------|------|---------|
| pricePosition | 0.25 | 完全一致 |
| cloudType | 0.20 | 完全一致 |
| tkPosition | 0.20 | 完全一致 |
| cloudThickness | 0.15 | ±30%相対 |
| tkCross | 0.10 | 完全一致 |
| sanYaku | 0.10 | 完全一致 |

```typescript
function calculateIchimokuSimilarity(
  current: {
    pricePosition: string;
    cloudType: string;
    tkPosition: string;
    cloudThickness: number;
    tkCross: string | null;
    sanYaku: string | null;
  },
  saved: {
    pricePosition: string;
    cloudType: string;
    tkPosition: string;
    cloudThickness: number;
    tkCross: string | null;
    sanYaku: string | null;
  }
): number {
  let score = 0;

  // pricePosition（25%）- 最重要
  score += (current.pricePosition === saved.pricePosition ? 1 : 0) * 0.25;

  // cloudType（20%）
  score += (current.cloudType === saved.cloudType ? 1 : 0) * 0.20;

  // tkPosition（20%）
  score += (current.tkPosition === saved.tkPosition ? 1 : 0) * 0.20;

  // cloudThickness（15%）
  const thickRatio = Math.min(current.cloudThickness, saved.cloudThickness) /
                     Math.max(current.cloudThickness, saved.cloudThickness);
  score += thickRatio * 0.15;

  // tkCross（10%）- ボーナス
  if (current.tkCross && current.tkCross === saved.tkCross) {
    score += 0.10;
  }

  // sanYaku（10%）- ボーナス
  if (current.sanYaku && current.sanYaku === saved.sanYaku) {
    score += 0.10;
  } else if (!current.sanYaku && !saved.sanYaku) {
    score += 0.05;
  }

  return Math.min(score, 1.0);
}
```

## シグナル強度

| シグナル | 強度 | 条件 |
|----------|------|------|
| 三役好転 | 最強 | 価格>雲 + 転換>基準 + 遅行>26期間前価格 |
| 三役逆転 | 最強 | 価格<雲 + 転換<基準 + 遅行<26期間前価格 |
| 雲上ブレイク | 強 | 価格が陽雲を上抜け |
| 雲下ブレイク | 強 | 価格が陰雲を下抜け |
| TKクロス（雲上） | 中 | 雲の上で転換線が基準線を上抜け |
| TKクロス（雲中） | 弱 | 雲の中でのクロス |

## 使い方のポイント

- **価格 > 雲**: 上昇トレンド
- **価格 < 雲**: 下落トレンド
- **価格が雲の中**: レンジ/方向感なし
- **雲が厚い**: 強いサポート/レジスタンス
- **雲が薄い**: ブレイクしやすい
- **雲のねじれ**: トレンド転換の可能性

## 禁止事項

- 一目均衡表単独でも情報量は多いが、他指標との併用推奨
- **デフォルト設定(9,26,52)は日足用** → 時間軸に合わせて調整
- 雲の中での売買は方向感がないため避ける
- 三役好転/逆転は強いシグナルだが、遅延があるため注意
- 遅行スパンの解釈は26期間前のデータを参照するため、リアルタイムでは確認が遅れる
