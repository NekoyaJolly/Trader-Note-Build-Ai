# IndicatorSpecialist 統合設計書

> **Status**: Draft (2026-05-27, Nekoさん 議論ベース)
> **対象**: Side-B Phase 6 専門家エージェント 3 体 (Trend / Oscillator / VolatilityVolume) を `IndicatorSpecialist` 1 体に統合する設計。analysis-engine 側の 17+ indicator を計算ソースとして活用、LLM は **計算ではなく解釈**に専念する。

---

## 1. 背景

### 1.1 現状の構成

`src/side-b/agents/specialists/` に 3 体の Specialist が独立して存在:

| Specialist | 出力 | 役割 |
|---|---|---|
| `TrendSpecialist` | `trendState` / `trendStrength` / `trendMaturity` / `keyLevels` | トレンド方向 + 強度 + S/R 抽出 |
| `OscillatorSpecialist` | `momentum` / `divergence` | オシレーター解釈 + ダイバージェンス |
| `VolatilityVolumeSpecialist` | `volatilityRegime` / `breakoutRisk` / `volumeSignal` | ボラ + 出来高 → ブレイクアウト判定 |

`runAllSpecialists` で `Promise.allSettled` 並列実行、出力は `SpecialistBundle { trend, oscillator, volatilityVolume }` として後段 (HypothesisGenerator / StrategyThinker) に渡される。

### 1.2 課題

#### (a) 429 / コスト / レイテンシ問題 (2026-05-26 観察)

- **同一 LLM プロバイダー (OpenAI) を 3 並列で叩く** ため、同モデルプール (gpt-5.4-mini の RPM/TPM 上限) に当たって 429 insufficient_quota / Rate limit が頻発
- 3 並列 = LLM call コストが 3 倍、レイテンシも 3 並列の最遅で律速
- 同じ `lensSnapshot` (= 100% 共通入力) を 3 回 LLM に解釈させているのは情報冗長

#### (b) 情報源の限定性

- 現状 Specialist は `lensSnapshot` (= 限定的なテクニカル特徴) しか見ていない
- 一方、`analysis-engine/app/indicators.py` には **17+ のインジケーター** (sma / ema / rsi / macd / atr / obv / vwap / cci / aroon / roc / mfi / cmf / dema / tema / kc / psar / ichimoku など) が **計算済**
- これらが Specialist から活用されていない = 情報源が痩せている

#### (c) 役割分離の不徹底

- 3 体並列だと「**各 LLM が独立判断 → bundle で集約 → 後段が再解釈**」と多段化、矛盾の可能性
- LLM に「数値計算 (= 決定論的)」と「解釈 (= 推論)」が混在する設計はクリーンではない
- ファンダ系は別途 `MarketResearch` (= EODHD 経由) に分離する方針 ([[project_fundamentals_researcher]] memory)

---

## 2. 統合の目的

1. **LLM call 数 1/3** → 429 解決、コスト 1/3、レイテンシ低減
2. **analysis-engine の 17+ indicator を活用** → 情報源拡張
3. **役割分離の徹底**:
   - 計算 = analysis-engine の責任 (= 決定論的、Python 側で全 indicator 計算)
   - 解釈 = `IndicatorSpecialist` (LLM) の責任 (= 計算済み値を見て「現在のマーケット状態」を推論)
4. **全分野の一貫性ある判断** = 単一 LLM call の self-consistency で trend / oscillator / vol 視点の矛盾を解消
5. **設計シンプル化** = 個別 env による per-agent モデル分散管理から脱却

---

## 3. 入出力設計

### 3.1 MTF (Multi-Timeframe) 観点 (Nekoさん 2026-05-27 追加指示)

> IndicatorSpecialist は **現在の時間足 + 上位の時間足** 両方の indicator 値を取って推論する。

理由:
- 現在 TF (= 15m) だけでは短期ノイズと中期トレンドの区別がつかない
- 上位 TF (= 1h / 4h) と組み合わせて「上位は下降基調、現 TF は短期反発」「両 TF とも上抜け」等の **MTF 整合性判断** ができる
- 既存実装 PR #246 で `deriveHigherTimeframe()` (= entry TF から上位 TF を導出) が seedDescriptor に入っているため、その仕組みを Specialist 入力にも流用

### 3.2 入力 `IndicatorSpecialistInput`

```ts
interface IndicatorSpecialistInput {
  symbol: string;
  /** 現在の時間足 (= entry / execution TF) */
  currentTimeframe: string;
  /** 上位の時間足 (= MTF 整合性確認用、deriveHigherTimeframe() で導出) */
  higherTimeframe: string;

  /** 現在 TF の indicator + price context */
  current: TimeframeData;
  /** 上位 TF の indicator + price context */
  higher: TimeframeData;
}

/**
 * 1 つの時間足分の indicator + price データ。
 * analysis-engine で計算済の値を受け取る (= Specialist は計算しない)。
 */
interface TimeframeData {
  /**
   * 各 indicator は直近 N 期間の数値配列 or 統計サマリ。
   * 必須 indicator と任意 indicator を分けて、足りないものは undefined。
   */
  indicators: {
    // トレンド系
    sma?: IndicatorSeries;
    ema?: IndicatorSeries;
    dema?: IndicatorSeries;
    tema?: IndicatorSeries;
    macd?: IndicatorSeries;
    ichimoku?: IndicatorSeries;
    psar?: IndicatorSeries;
    aroon?: IndicatorSeries;
    // オシレーター系
    rsi?: IndicatorSeries;
    cci?: IndicatorSeries;
    roc?: IndicatorSeries;
    mfi?: IndicatorSeries;
    // ボラ/出来高系
    atr?: IndicatorSeries;
    kc?: IndicatorSeries;
    obv?: IndicatorSeries;
    vwap?: IndicatorSeries;
    cmf?: IndicatorSeries;
  };
  /** OHLCV 直近サマリ (= 価格・出来高の絶対値情報、indicator では表現できない) */
  priceContext: {
    latestClose: number;
    latestVolume: number;
    sessionHigh: number;
    sessionLow: number;
  };
}
```

`IndicatorSeries` は **analysis-engine 生レスポンスを TS 側で整形した形**:

```ts
interface IndicatorSeries {
  latest: number | null;
  previous: number | null;
  // 直近 N 期間の値 (Specialist が傾きや変化を判断する材料)
  recentValues: Array<number | null>;
  // 統計サマリ (= 生配列が冗長な時に置換)
  summary?: { mean: number; std: number; min: number; max: number };
}
```

**変換ステップ** (Phase 1 実装で TS 側に追加):

analysis-engine の `/v1/indicator-series` (POST) レスポンスは現状:
```ts
// src/schemas/external/analysisEngine.ts L198 (= AnalysisEngineIndicatorSeriesResponse)
series: Record<string, Array<number | null>>
// 例: { "rsi": [50.1, 51.2, null, 52.3, ...], "macd_signal": [...], ... }
```

つまり生レスポンスは **キー=indicator id × 値=単一の数値時系列配列**。`IndicatorSeries` (= `latest/previous/recentValues/summary`) への変換は IndicatorSpecialist の入力構築層で行う:

```ts
function toIndicatorSeries(values: Array<number | null>, recentN = 20): IndicatorSeries {
  const latest = values.length > 0 ? values[values.length - 1] : null;
  const previous = values.length > 1 ? values[values.length - 2] : null;
  const recentValues = values.slice(-recentN);
  // summary は recentValues の非 null 値から計算 (= mean/std/min/max)
  const nonNull = recentValues.filter((v): v is number => v !== null);
  const summary = nonNull.length > 0 ? {
    mean: nonNull.reduce((a, b) => a + b, 0) / nonNull.length,
    std: /* ... */,
    min: Math.min(...nonNull),
    max: Math.max(...nonNull),
  } : undefined;
  return { latest, previous, recentValues, summary };
}
```

この変換層により、analysis-engine の単純な配列レスポンスと、LLM 解釈に適した `IndicatorSeries` 型の責任を明確に分離する。

### 3.3 出力 `IndicatorAnalysis`

旧 3 体出力の **和集合 + 統合的なテクニカル判断 + MTF 整合性** を 1 つの型に集約:

```ts
interface IndicatorAnalysis {
  /** 自然言語の総合解釈 (= 「テクニカル的にチャートは今こう動いてる」レベル、MTF 観点込み) */
  interpretation: string;
  /** 確信度 0-1 (= 全体的な signal の強さ / MTF 整合性) */
  confidence: number;

  // === 現在 TF (= currentTimeframe) のテクニカル判断 ===
  current: {
    trendState: 'strong_up' | 'weak_up' | 'ranging' | 'weak_down' | 'strong_down';
    trendStrength: number; // 0-1
    trendMaturity: 'early' | 'middle' | 'late';
    keyLevels: { support: number[]; resistance: number[] };
    momentum: 'overbought' | 'bullish' | 'neutral' | 'bearish' | 'oversold';
    divergence: 'bullish_divergence' | 'bearish_divergence' | 'none';
    volatilityRegime: 'expansion' | 'normal' | 'contraction';
    breakoutRisk: 'high' | 'medium' | 'low';
    volumeSignal: 'unusual_high' | 'normal' | 'unusual_low' | 'no_data';
  };

  // === 上位 TF (= higherTimeframe) のテクニカル判断 ===
  higher: {
    trendState: 'strong_up' | 'weak_up' | 'ranging' | 'weak_down' | 'strong_down';
    trendStrength: number;
    keyLevels: { support: number[]; resistance: number[] };
    momentum: 'overbought' | 'bullish' | 'neutral' | 'bearish' | 'oversold';
    // 上位 TF では maturity / divergence / volumeSignal は粒度の問題で省略 (= 必要なら拡張)
  };

  // === MTF 整合性判断 ===
  mtfAlignment: {
    /** 現 TF と上位 TF のトレンドが揃っているか */
    trendAlignment: 'aligned_bullish' | 'aligned_bearish' | 'mixed' | 'aligned_neutral';
    /** 「上位 TF がトレンド、現 TF が押し目」のような順張り pullback の好機か */
    pullbackOpportunity: boolean;
    /** 「上位 TF と現 TF で逆方向」の早期反転シグナルか */
    counterTrendSignal: boolean;
  };

  /** どの indicator が判断の主根拠になったか (= 後段 debug / Reflection 用、TF 別) */
  primaryIndicators: {
    current: string[];
    higher: string[];
  };
}
```

### 3.4 下流接続方針

**adapter は使わない** (Nekoさん 2026-05-27 指示):
- 「3 体に戻すことは考えていない」「テクニカルは 1 体を専門的にしていく方が間違いなく良い」
- 旧 `SpecialistBundle` 型は **削除**、下流 (`HypothesisGenerator` / `StrategyThinker` 等) は新型 `IndicatorAnalysis` を **直接受け取る形に修正**
- MTF 情報 (`higher` / `mtfAlignment`) も最初から下流に伝える

これにより:
- adapter という中間層を持たない (= コードが減る、メンテ単純)
- MTF 情報を Phase 1 から下流が活用できる
- 旧 3 体の Specialist 型 / `runAllSpecialists` も Phase 1 で削除可能

---

## 4. analysis-engine 連携

### 4.1 既存資産の活用

- `analysis-engine/app/indicators.py:compute_indicator_series` が既に 17+ indicator を計算可能
- `src/backend/services/analysisEngineClient.ts:fetchIndicatorSeriesByStrategyVersion` 等の TS 側 HTTP クライアントが存在
- 上記を **IndicatorSpecialist の入力収集に流用**

### 4.2 取得対象 indicator のセット

優先度別に分類:

| 優先度 | indicator | 用途 |
|---|---|---|
| 必須 (P0) | sma, ema, rsi, macd, atr | トレンド + モメンタム + ボラの基礎 |
| 高 (P1) | obv, vwap, ichimoku, cci, aroon | トレンド/オシレーター強化 |
| 中 (P2) | dema, tema, kc, psar, mfi, roc, cmf | 補助シグナル |

P0/P1 (= 10 種類) を最初は固定取得。P2 は後段の必要性に応じて段階的に追加。

### 4.3 取得方法 (= MTF 対応)

- analysis-engine の **`POST /v1/indicator-series`** (= `AnalysisEngineIndicatorSeriesRequest` → `AnalysisEngineIndicatorSeriesResponse`) を使用
  - 既存 TS クライアント: `src/backend/services/analysisEngineClient.ts` を流用
  - 関連エンドポイント: `POST /v1/indicator-series/by-version` (= 戦略 version 由来の indicator spec で取得、使い分けは Phase 1 実装時に判断)
- **現在 TF + 上位 TF を 2 並列 request** で取得 (= 単一 request では複数 TF を扱えないため)
- 各 indicator のパラメータは標準値 (= RSI=14, MACD=12-26-9 等) を構成定数として `src/side-b/agents/specialists/indicatorCatalog.ts` (新規) に集約
- 上位 TF の導出は既存 `deriveHigherTimeframe(currentTimeframe)` (PR #246) を流用

### 4.4 失敗耐性

- **現在 TF の P0 (必須)** のいずれかが取得失敗 → IndicatorSpecialist は **null** を返す (= 旧 Specialist 失敗時と同じ挙動)
- **上位 TF の P0** が取得失敗 → `higher` フィールドを部分的 null、`mtfAlignment` は `confidence` を下げて `'mixed'` 扱いに fallback (= 現 TF 単体判断にデグレード)
- P1/P2 の一部失敗 → 取得できたものだけで LLM 解釈、prompt 内で「不在 indicator」を明示

---

## 5. prompt 設計

### 5.1 設計方針 (Nekoさん 2026-05-27 指示)

> インジケーターの**計算は analysis-engine 側 (= 決定論的)**。
> LLM に推論させるべきは「現在のマーケット状態の解釈」。
> 各 indicator が何を表すかは prompt に **カタログとして組み込む**。

### 5.2 prompt 構造 (= MTF 対応)

```
[システムプロンプト]
あなたはテクニカル分析の専門家です。analysis-engine が計算した複数の indicator 値を
**現在の時間足 + 上位の時間足** の両方で見て、現在のマーケット状態を統合的に解釈してください。
あなたは indicator を計算しません。すでに計算済みの値を解釈するだけです。

判断の重点:
1. 現在 TF 単体のテクニカル状態 (= trend / oscillator / volatility / volume)
2. 上位 TF 単体のテクニカル状態
3. **MTF 整合性** (= 両 TF のトレンドが揃っているか、押し目買いの好機か、逆張りシグナルか)

[Indicator カタログ (= 各 indicator の意味)]
- SMA (Simple Moving Average): 期間内の平均価格。トレンドの平準化を表す
- EMA (Exponential Moving Average): 直近を重視した移動平均。トレンド転換に SMA より敏感
- DEMA / TEMA: EMA を多重に重ねた smoother、ラグ削減
- MACD: 短期/長期 EMA の差。トレンドの強さと転換点を示す
- RSI: 0-100 で相対的な買われ過ぎ/売られ過ぎ。70 以上 = overbought、30 以下 = oversold
- CCI: 標準偏差ベースの逸脱度。±100 で過熱判断
- ROC: モメンタムの変化率
- MFI: RSI に出来高を加味
- ATR (Average True Range): ボラティリティの絶対量
- KC (Keltner Channel): EMA + ATR の bands。価格の正常範囲
- OBV: 累積出来高。価格と乖離するとダイバージェンス
- VWAP: 出来高加重平均価格。institutional 価格水準
- CMF (Chaikin Money Flow): 出来高ベースの買い圧/売り圧
- Ichimoku: 雲 / 転換線 / 基準線 / 遅行線でトレンド転換点と支持/抵抗を一目で
- PSAR: パラボリック SAR。トレンドフォロー / 反転 stop の目安
- Aroon: トレンドの強さと age を表す

[MTF 解釈の典型パターン]
- aligned_bullish: 上位 TF も現 TF も上昇 → 順張り買いの整合
- aligned_bearish: 上位 TF も現 TF も下降 → 順張り売りの整合
- mixed (pullback): 上位 TF が上昇、現 TF が短期反落 → 押し目買い好機
- mixed (counter): 上位 TF が下降、現 TF が短期反発 → 逆張り反転シグナル (慎重に)
- aligned_neutral: 両 TF ともレンジ → ブレイクアウト待ち

[入力データ (= analysis-engine 計算結果、値は実行時に注入)]
symbol: {{symbol}}
current_timeframe: {{currentTimeframe}}
higher_timeframe: {{higherTimeframe}}
latest_close: {{latestClose}}

current ({{currentTimeframe}}):
  rsi: {{currentRsi}}
  macd: {{currentMacd}}
  atr: {{currentAtr}}
  ... (要は P0/P1 で取得した indicator 一覧)

higher ({{higherTimeframe}}):
  rsi: {{higherRsi}}
  macd: {{higherMacd}}
  ichimoku: {{higherIchimoku}}
  ... (同上)

[出力 (= structured JSON)]
{
  "interpretation": "現 TF と上位 TF の状態を踏まえたテクニカル解釈の自然文",
  "confidence": <0-1>,
  "current": { "trendState": "...", "trendStrength": <0-1>, ... },
  "higher": { "trendState": "...", "trendStrength": <0-1>, ... },
  "mtfAlignment": {
    "trendAlignment": "aligned_bullish|aligned_bearish|mixed|aligned_neutral",
    "pullbackOpportunity": <bool>,
    "counterTrendSignal": <bool>
  },
  "primaryIndicators": { "current": [...], "higher": [...] }
}
```

**注 1 (Nekoさん 2026-05-27 指示)**: prompt 内に **symbol / timeframe / 価格レベル等の具体値をハードコードしてはいけない**。実行時に `IndicatorSpecialistInput` から動的に展開する。

**注 2 (placeholder 形式)**: 既存 `expandMacros` (`src/side-b/prompts/loader.ts:74`) は `{{KEY}}` の **flat な単純置換**でドット記法 (= `{{current.indicators.rsi}}`) は解決しない。本設計ではドット記法を使わず、**flat な macros キー** (`{{currentRsi}}`, `{{higherRsi}}` 等) を用いる。IndicatorSpecialist の prompt 構築層で `IndicatorSpecialistInput` をフラットな `PromptMacros` 辞書に展開する変換ステップを Phase 1 実装に含める:

```ts
function buildMacros(input: IndicatorSpecialistInput): PromptMacros {
  return {
    symbol: input.symbol,
    currentTimeframe: input.currentTimeframe,
    higherTimeframe: input.higherTimeframe,
    latestClose: String(input.current.priceContext.latestClose),
    currentRsi: formatIndicator(input.current.indicators.rsi),
    currentMacd: formatIndicator(input.current.indicators.macd),
    // ... 各 indicator を fmt して flat キーに展開
    higherRsi: formatIndicator(input.higher.indicators.rsi),
    higherMacd: formatIndicator(input.higher.indicators.macd),
    // ...
  };
}
```

### 5.3 出力検証

Zod schema (`IndicatorAnalysisSchema`) で structured JSON を厳密検証。失敗時は **1 回リトライ + exponential backoff** → 失敗時は null。

---

## 6. 移行プラン

adapter なし方針 (= 3.4) に従い、3 Phase で完結:

### Phase 1: 実装 + 切り替え (= 1 PR)
- `IndicatorSpecialist` クラス + types (`IndicatorAnalysis` / `IndicatorSpecialistInput` / `TimeframeData` / `IndicatorSeries`)
- analysis-engine 連携 (= 2 TF batch 取得、`deriveHigherTimeframe()` 流用)
- prompt + catalog (`indicatorCatalog.ts`)
- 下流 (`HypothesisGenerator` / `StrategyThinker` / `aiOrchestrator.generatePlan`) を **`IndicatorAnalysis` 直接受け取り**に修正
- 旧 `TrendSpecialist` / `OscillatorSpecialist` / `VolatilityVolumeSpecialist` / `runAllSpecialists` / `SpecialistBundle` を **削除**
- config の `trend_specialist` / `oscillator_specialist` / `volatility_volume_specialist` key を `indicator_specialist` 1 つに統合
- 単体テスト (mock LLM / mock analysis-engine)

### Phase 2: 観察 (= dev 1 週間)
- 判断品質評価: コミット前データ vs 新 IndicatorSpecialist の出力比較 (= EdgeHypothesis 生成率 / screening 通過率 / 仮説の質)
- メトリクス: 429 件数、コスト、レイテンシ、リトライ / failure 率
- prompt 改善ループ (= 出力品質が低い側面 = trend / oscillator / volatility / MTF の判断精度) があれば prompt 強化

### Phase 3: 本番反映
- dev 観察で問題なければ本番 deploy
- 次フェーズ (= debate / 上位エージェントの改善) に進む

---

## 7. リスク

| リスク | 対策 |
|---|---|
| 単一 LLM call で 3 分野 × 2 TF カバー → 各分野の精度低下 | Phase 2 観察で実データの出力品質を評価、prompt 改善ループ |
| analysis-engine 連携 latency 増 (= MTF で 2 TF 分 batch 取得) | 1 batch リクエストで 2 TF 同時取得 (API 側対応) または 2 並列、cache 活用 |
| 上位 TF 取得失敗時の挙動 | `higher` 部分 null + `mtfAlignment='mixed'` + confidence 下げで現 TF 単体判断にデグレード (= 4.4) |
| LLM の self-consistency バイアス (= 1 LLM だと独立視点が消える) | StrategyThinker / DevilsAdvocate 等の後段で独立視点を確保。Specialist 層は「事実解釈」レイヤーに専念 |

**ロールバックリスクは「考慮しない」方針** (Nekoさん 2026-05-27): 旧 3 体に戻すことは将来想定しない。テクニカル領域は本 1 体専門化で進化させる前提。

---

## 8. 関連

- [[project_fundamentals_researcher]]: ファンダ系は別途 MarketResearch に役割分離
- [[project_per_agent_model_config]]: per-agent モデル設定、統合後は `indicator_specialist` 1 key に
- `docs/architecture/EODHD_PHASE_A_WBS.md` L87: IndicatorSpecialist 統合は memory `project_agent_consolidation_plan` の残課題として参照
- `analysis-engine/app/indicators.py`: 17+ indicator の計算実装 (= 本設計の前提)
- 2026-05-26 観察: 429 insufficient_quota / Specialist 3 並列 / モデル分散検討 (= [[project_security_remaining]] と関連)
