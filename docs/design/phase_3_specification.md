# フェーズ3 発注仕様書: 並列レンズ基盤の拡張

> **期間目安**: 継続的(1-2週間、1レンズずつ)
> **目的**: 客観的に判定可能な相場観レンズを追加し、Strategy Thinker がレンズ出力を活用できるようにする
> **前提**: フェーズ1 完了(レンズ基盤)、フェーズ2 完了(AIロール分化)
> **前提読み物**: `docs/design/DESIGN_DOC_autonomous_trading_architecture.md` のセクション4(並列レンズ仕様)

---

## 1. このフェーズのゴール

フェーズ1で作ったレンズ基盤に、**客観判定可能な2つの重要レンズ** を追加する:
- **DowTheoryLens**: ダウ理論ベースのトレンド状態判定
- **VolatilityRegimeLens**: ボラティリティ状態の統計的判定

同時に、Strategy Thinker がこれらのレンズ出力を **入力として使える** ように配管を繋ぐ。

**このフェーズで意図的にやらないこと**: エリオット波動レンズ、SMCレンズは含めない(フェーズ6で扱う、より複雑)。

---

## 2. 完了条件

以下の全てを満たす:

- [x] `DowTheoryLens` が実装され、ピボット検出・高値安値判定・トレンド状態を出力する
- [x] `VolatilityRegimeLens` が実装され、BB幅パーセンタイル・ATR変化率・状態ラベルを出力する
- [x] 両レンズが `defaultLensAggregator` に登録されている（`registerDefaultLenses()` 内）
- [x] PDCA パイプラインで、Strategy Thinker 呼び出し前に全レンズが計算される（実装場所: `aiOrchestrator.ts`。pdcaLoop.ts は状態機械で実呼び出しを行わないため、Plan AI を実際に呼ぶオーケストレーターに配置）
- [x] Strategy Thinker のユーザープロンプトに、レンズ出力のサマリーが注入される（`planAIService.buildLensContext()`）
- [x] AITradeNote の `lensSnapshot` に両レンズ出力が記録される（orchestrator → agentMemory → scheduler → aiNoteService のパイプ）
- [x] 各レンズに決定性テスト・境界値テストが追加されている
- [x] 既存テストが全て通る（Side-B 全 314 テスト passing）

---

## 3. 触っていいファイル / 触ってはいけないファイル

### 触っていい(新規作成)
- `src/side-b/lenses/DowTheoryLens.ts`
- `src/side-b/lenses/VolatilityRegimeLens.ts`
- `src/side-b/lenses/utils/pivotDetection.ts`
- `src/side-b/tests/lenses/dowTheoryLens.test.ts`
- `src/side-b/tests/lenses/volatilityRegimeLens.test.ts`

### 触っていい(改修)
- `src/side-b/lenses/index.ts` ― 新レンズの登録追加
- `src/side-b/agent/pdcaLoop.ts` ― レンズ計算を PDCA に統合
- `src/side-b/services/planAIService.ts` ― レンズ出力をプロンプトに注入
- `src/side-b/prompts/strategy_thinker.md` ― レンズ出力の解釈ガイド追加
- Reflection AI から lensSnapshot を記録するロジック(軽微)

### 触ってはいけない
- `src/side-b/lenses/types.ts` (フェーズ1の成果物、インターフェース固定)
- `src/side-b/lenses/CurrentAnalysisLens.ts` (フェーズ1成果物)
- `src/side-b/lenses/TimeSessionLens.ts` (フェーズ1成果物)
- `src/side-b/agents/DevilsAdvocateAgent.ts` (フェーズ2成果物)
- UI 関連

---

## 4. 実装仕様

### 4.1 ピボット検出ユーティリティ

`src/side-b/lenses/utils/pivotDetection.ts`

両レンズで使う共通ロジック。価格データからスイングハイ/ローを検出する。

```typescript
export interface Pivot {
  type: 'high' | 'low';
  price: number;
  barIndex: number;
  timestamp: Date;
}

export interface PivotDetectionConfig {
  /** 前後何本を比較するか(デフォルト: 5) */
  leftBars: number;
  rightBars: number;
}

/**
 * 価格データからピボット(スイングハイ/ロー)を検出
 * 
 * leftBars と rightBars の期間内で最高値/最安値となるバーをピボットとする
 * 直近の rightBars 本は確定ピボットではない(候補のみ)
 */
export function detectPivots(
  ohlcv: OHLCVBar[],
  config: PivotDetectionConfig = { leftBars: 5, rightBars: 5 }
): Pivot[] {
  const pivots: Pivot[] = [];
  
  for (let i = config.leftBars; i < ohlcv.length - config.rightBars; i++) {
    const current = ohlcv[i];
    const leftWindow = ohlcv.slice(i - config.leftBars, i);
    const rightWindow = ohlcv.slice(i + 1, i + 1 + config.rightBars);
    
    const isHigh = leftWindow.every(b => b.high <= current.high) 
                && rightWindow.every(b => b.high <= current.high);
    const isLow = leftWindow.every(b => b.low >= current.low) 
                && rightWindow.every(b => b.low >= current.low);
    
    if (isHigh) pivots.push({ type: 'high', price: current.high, barIndex: i, timestamp: current.timestamp });
    if (isLow) pivots.push({ type: 'low', price: current.low, barIndex: i, timestamp: current.timestamp });
  }
  
  return pivots;
}

/**
 * 直近のピボットを返す(confirmed のみ)
 */
export function getRecentPivots(pivots: Pivot[], count: number): Pivot[] {
  return pivots.slice(-count);
}
```

### 4.2 DowTheoryLens

`src/side-b/lenses/DowTheoryLens.ts`

ダウ理論の客観的要素(高値切り上げ、安値切り上げ、トレンド段階)を機械判定する。

出力する features:

| キー | 型 | 説明 |
|------|-----|------|
| `trend_state` | 'uptrend' \| 'downtrend' \| 'range' \| 'unclear' | 現在のトレンド状態 |
| `recent_higher_high` | boolean | 直近のピボット高が前のピボット高を更新したか |
| `recent_higher_low` | boolean | 直近のピボット低が前のピボット低を更新したか |
| `recent_lower_high` | boolean | |
| `recent_lower_low` | boolean | |
| `last_high_price` | number | 直近のスイングハイの価格 |
| `last_low_price` | number | 直近のスイングローの価格 |
| `bars_since_last_high` | number | 直近スイングハイからの経過バー数 |
| `bars_since_last_low` | number | 直近スイングローからの経過バー数 |
| `trend_duration_bars` | number | 現在のトレンドが継続してるバー数 |
| `trend_phase` | 'early' \| 'middle' \| 'late' \| 'unknown' | トレンドの段階(ヒューリスティック判定) |
| `pullback_active` | boolean | 直近で押し目/戻り目が形成中か |
| `pullback_depth_pct` | number | 押し目/戻り目の深さ(直近トレンド幅に対する比率) |

判定ロジック:
- `trend_state`: 直近2つの swing high と swing low を比較
  - 高値も安値も切り上げ → `uptrend`
  - 高値も安値も切り下げ → `downtrend`
  - 両方混在 or 変化なし → `range`
  - データ不足 → `unclear`
- `trend_phase`: 経験的ルール
  - 継続バー数が直近60本の平均トレンド長の1/3未満 → `early`
  - 2/3未満 → `middle`
  - それ以上 → `late`
  - トレンドがない → `unknown`
- `pullback_active`: トレンド方向と逆の短期的な動きが直近N本で発生中か

### 4.3 VolatilityRegimeLens

`src/side-b/lenses/VolatilityRegimeLens.ts`

ボラティリティの統計的状態を判定する。

出力する features:

| キー | 型 | 説明 |
|------|-----|------|
| `bb_width` | number | ボリンジャーバンド幅(絶対値) |
| `bb_width_percentile` | number | 過去N期間中のBB幅パーセンタイル(0-100) |
| `atr` | number | ATR絶対値 |
| `atr_change_rate` | number | 直近のATR変化率 |
| `atr_percentile` | number | 過去N期間中のATRパーセンタイル |
| `regime_label` | 'contracting' \| 'low' \| 'normal' \| 'elevated' \| 'expanding' | 状態ラベル |
| `is_squeeze` | boolean | ボラ収縮状態か(BB幅が過去20%パーセンタイル以下) |
| `is_expanding` | boolean | ボラ拡大中か(ATR変化率が正かつ大きい) |
| `bars_in_current_regime` | number | 現regimeに留まってるバー数 |

判定ロジック:
- パーセンタイルは過去100本(設定可能)で計算
- `regime_label`:
  - bb_width_percentile < 20 → `contracting`
  - < 40 → `low`
  - < 60 → `normal`
  - < 80 → `elevated`
  - >= 80 → `expanding`

### 4.4 既存 PDCA ループへのレンズ統合

`src/side-b/agent/pdcaLoop.ts` の中で、Strategy Thinker 呼び出しの前にレンズ計算を追加:

```typescript
// 新規追加
const lensSnapshot = await defaultLensAggregator.computeAll({
  symbol,
  timeframe,
  timestamp: new Date(),
  ohlcv: currentOhlcv,
  existingAnalysis: marketAnalysis,
});

// Strategy Thinker に渡す
const plan = await planAIService.generatePlan({
  research,
  targetDate,
  userPreferences,
  lensSnapshot,  // 新規追加
  // ... 既存引数
});

// Reflection 用に保存
agentMemory.setCurrentLensSnapshot(symbol, lensSnapshot);
```

### 4.5 planAIService のプロンプト注入

`planAIService.ts` の `buildPrompt()` にレンズ出力のサマリー注入を追加:

```typescript
private buildLensContext(snapshot?: LensFeatureSnapshot): string {
  if (!snapshot) return '';
  
  const sections: string[] = ['## 並列レンズ観測結果'];
  
  for (const [lensName, feature] of snapshot.features) {
    sections.push(`### ${lensName}`);
    for (const [key, value] of Object.entries(feature.features)) {
      sections.push(`- ${key}: ${JSON.stringify(value)}`);
    }
  }
  
  sections.push(`
これらは独立した複数の観測レンズの出力です。どのレンズを重視するかは
あなたが判断してください。ただし、特定のレンズを選んだ理由と、
使わなかったレンズがある場合はその理由も明記してください。
`);
  
  return sections.join('\n');
}
```

### 4.6 Strategy Thinker プロンプトの更新

`src/side-b/prompts/strategy_thinker.md` に以下のセクションを追加:

```markdown
## レンズ出力の解釈ガイド

このシステムでは、複数の独立した「レンズ」から相場を同時観測しています。
各レンズは異なる視点を持ちます:

- `current_analysis`: 伝統的なテクニカル分析(トレンド・モメンタム・ボラ・価格構造)
- `time_session`: 時間帯と市場セッションの状態
- `dow_theory`: ダウ理論ベースのトレンド段階と押し目状態
- `volatility_regime`: ボラティリティの統計的状態

### 使い方の原則
- レンズ同士が同じ方向を示すとき、確信度が高まる
- レンズ同士が矛盾するとき、それを "単純な見送り理由" にせず、
  "この市場状態は何を示唆するか" を解釈する
- どのレンズが今回のエントリー判断に効いているか、を明示する
- どのレンズを意図的に無視したか、その理由を明示する
```

### 4.7 テスト

`src/side-b/tests/lenses/dowTheoryLens.test.ts`

- 単純な上昇トレンドデータに対して `trend_state: 'uptrend'` を返すか
- レンジデータに対して `trend_state: 'range'` を返すか
- データ不足時に `trend_state: 'unclear'` を返すか
- 押し目判定が機能するか
- 同じ入力で同じ出力(決定性)

`src/side-b/tests/lenses/volatilityRegimeLens.test.ts`

- 収縮データに対して `regime_label: 'contracting'` を返すか
- 拡大データに対して `regime_label: 'expanding'` を返すか
- パーセンタイル計算が正しいか
- データ不足時のフォールバック挙動

---

## 5. 設計上の注意

### 5.1 このフェーズでやらないこと

- エリオット波動レンズ(フェーズ6)
- SMC レンズ(フェーズ6)
- レンズ重み付け類似検索(後のフェーズ)
- UI での新レンズ表示
- エッジ台帳の多次元索引化

### 5.2 パフォーマンス配慮

両レンズは毎回 OHLCV を走査する。過去100本程度の計算なら問題ないが、1000本超を何度も走査しないよう注意。必要ならピボット検出結果をキャッシュする仕組みを検討(ただし純関数性を維持)。

### 5.3 パラメーターの外部化

ピボット検出の `leftBars` / `rightBars`、パーセンタイル計算期間などの定数は、設定可能にしておく(環境変数 or コンフィグファイル)。ただしデフォルト値で動くこと。

### 5.4 「不明」状態の誠実な扱い

データ不足時に無理に何か判定するのではなく、`unclear` / `unknown` を返すこと。レンズが「わからない」と言えることは重要。

---

## 6. 完了報告時に含めること

1. 作成/変更したファイルの一覧
2. 各レンズの実行サンプル出力(実データでの)
3. 新旧の Strategy Thinker プロンプト差分
4. 既存テスト全通過の確認
5. 追加テストの実行結果
6. 実トレード1サイクルの実行ログ(レンズが動いている確認)
7. パフォーマンス測定(レンズ計算にかかる合計時間)
8. 次フェーズへの引き継ぎメモ

---

## 7. レビュー観点

- レンズ出力が妥当な範囲に収まっているか(ランダム化してないか)
- Strategy Thinker が実際にレンズ出力を参照した戦略を出しているか
- AITradeNote に lensSnapshot が記録されているか
- パフォーマンスが許容範囲(全レンズ合計 < 500ms)か
