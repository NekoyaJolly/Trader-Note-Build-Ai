# Phase 7 仕様書: Lens 拡張 (SMC + ChartPattern + Wyckoff)

> **対象**: Claude Code / 実装エージェント
> **発注者**: Nekoさん
> **作成日**: 2026-05-14
> **位置づけ**: Side-B Lens 基盤の拡張フェーズ。Step 4 (ADK ParallelAgent dry-run) の前提として、マーケット観測 Lens のカバレッジを実用域まで仕上げる
> **完了条件**: 本書 §7 の DoD をすべて満たすこと
> **実行戦略**: Phase 7a → 7b → 7c の順序固定、各 Phase 完了ごとに PR、Copilot レビュー対応、Nekoさんマージ判断後に次 Phase へ進行 (WORKFLOW.md §3 準拠)

---

## 1. このドキュメントの目的

本書は Side-B Lens 基盤の **拡張フェーズ Phase 7** の作業指示書である。

### 1.1 背景 (Nekoさんの観測哲学)

> マーケット (= マーケットの状態) を測りやすい視点として:
> - チャートパターン (N-bar 構造)
> - ローソク足のパターン (= 既存 CandlePatternLens)
> - SMC 観測の状況 (スマートマネーコンセプト)
> - エリオット波動 (= Phase 8、不確実性が高い)
> - ダウ理論 (= 既存 DowTheoryLens)、ワイコフ理論などの説明的な論
> - ポイント&フィギュア (= Phase 9 構想、優先度最後)
>
> 総じての理想:
>
> マーケットを観測 → 情報を統合 → 複数シナリオを構築 → シナリオごとにトレードプランを練る → 実行 → ノートに保存 → 検証を重ねて次に生かす → 優位性 (エッジ) を確保 → マーケットからの入力に対して蓄積されたエッジでトレード判断ができるようになる。人間も AI も。
> — Nekoさん 2026-05-14

Phase 7 では、上記哲学のうち **「観測」段階の充実** を担う。現在 5 Lens (Current / TimeSession / DowTheory / VolatilityRegime / Pattern) が稼働中だが、Nekoさんの「測りやすい」リストに対するカバレッジは:

| カテゴリ | 現状 | Phase 7 で対応 |
|---|---|---|
| チャートパターン (N-bar 構造) | ❌ 未実装 | ✅ Phase 7b で `ChartPatternLens` 新規 |
| ローソク足のパターン | ✅ 既存 `PatternLens` (12 種) | ✅ Phase 7b で `CandlePatternLens` に rename (混乱回避) |
| SMC | ❌ 未実装 | ✅ Phase 7a で `SMCLens` 新規 |
| エリオット波動 | ❌ 未実装 | ⬜ Phase 8 (本書 §3.2 で不採用、`lens_elliott_wave_future_design.md` 参照) |
| ダウ理論 | ✅ 既存 `DowTheoryLens` | (Phase 7 では touch しない、再利用のみ) |
| ワイコフ | ❌ 未実装 | ✅ Phase 7c で `WyckoffLens` 新規 |
| ポイント&フィギュア | ❌ 未実装 | ⬜ Phase 9 構想 (本書 §3.2 で不採用) |

### 1.2 Phase 7 の主目的

1. 既存 `Lens` interface を実装する形で **SMCLens / ChartPatternLens / WyckoffLens の 3 Lens を新規追加** する
2. 既存 `PatternLens` を `CandlePatternLens` に rename し、新規 `ChartPatternLens` との **命名上の混乱を防ぐ**
3. 既存 `DowTheoryLens` の **ピボット検出 utils を新規 Lens から再利用** することで実装コストを下げる
4. 計算重い処理は **analysis-engine (Python) 側に追加し、side-b (TypeScript) は features 統合に専念** する (= `PatternLens` + PR ⑤D-1 と同じパターン)
5. Phase 7 完了後、Step 4 (ADK ParallelAgent dry-run) で **8 Lens 並列観測の dry-run** に進める状態を作る

### 1.3 重要: 既存 Lens は不可侵領域

`/AGENTS.md` ドメイン原則 §4「レンズは独立・純粋に実装する」より:

- 新規 Lens は **副作用なし・他レンズへの依存なし・決定性あり** を厳守
- レンズ同士の結合を作らない (= 後で進化的探索が回らなくなるため)

CandlePatternLens への rename 以外、既存 Lens のソースは改変しない。

---

## 2. 前提となる確定事項

### 2.1 完了済み Step / Phase

- Step 0: 設計ガード (2026-05-12 完了)
- Step 1: SkillRegistry → ADK FunctionTool adapter (2026-05-13 完了)
- Step 2: Tracing / Telemetry 統合 (2026-05-13 完了)
- Step 3: Runner Smoke + PDCALoop SequentialAgent dry-run wrapper (2026-05-14 完了)
- Phase 1 / Phase 3 / PR ②-1 / PR ⑤D-1: 既存 5 Lens 実装済 (Current / TimeSession / DowTheory / VolatilityRegime / Pattern)

### 2.2 適用される設計原則 (継続)

`/AGENTS.md` 最優先 5 原則 + ドメイン原則:

- 最優先 5 原則 §1: 勝手に決めない (設計判断は Nekoさん確認)
- 最優先 5 原則 §2: `any` / `unknown` を書かない (tests/scripts のみ例外)
- 最優先 5 原則 §3: 指定範囲を超えない (`ついで` 実装禁止)
- 最優先 5 原則 §4: 既存 API を壊さない (CandlePatternLens rename 以外は無改変)
- ドメイン原則 §3: LLM は構造発見/解釈/学習のみ、数値最適化は決定論コード
- ドメイン原則 §4: レンズは独立・純粋・決定性
- ドメイン原則 §6: 人間語ラベル必須 (Lens の features key は意味が分かる命名)

### 2.3 不可侵領域 (本 Phase でも継続)

`ADK_ADOPTION.md` §6 (Step 3 までで確認済み):

- `src/side-b/agent/pdcaLoop.ts` / `agentMemory.ts` / `agentLoop.ts`
- `src/side-b/skills/` 内部
- `src/side-b/lenses/` 既存 Lens の **本体ロジック** (rename を除く)
- `prisma/schema.prisma`
- PromptRegistry / strategy_dsl / EdgeLedger 昇格判定 / Evolution 探索

---

## 3. スコープ

### 3.1 本 Phase でやること

- **Phase 7a (SMCLens 新規追加)** — §6.1 詳細
- **Phase 7b (PatternLens → CandlePatternLens rename + ChartPatternLens 新規追加)** — §6.2 詳細
- **Phase 7c (WyckoffLens 新規追加)** — §6.3 詳細
- analysis-engine (Python) 側に Lens 計算 API を追加 (`/v1/indicator-series` または同等の拡張、既存 `compute_candlestick_pattern_flags` と同じパターン)
- side-b (TypeScript) 側に各 Lens クラスを追加し `defaultLensAggregator` に登録
- 各 Lens の単体テスト追加 (`/src/side-b/tests/lenses/`)
- 各 Phase 完了時に `phase_7_X_notes.md` (実測結果) を作成
- Phase 7 完了時に `phase_7_summary.md` を作成、`phase_6_specification.md` §9.1 と `ADK_ADOPTION.md` を整合

### 3.2 本 Phase でやらないこと

- **エリオット波動 Lens 実装** (Phase 8、`lens_elliott_wave_future_design.md` 参照)
- **ポイント&フィギュア Lens 実装** (Phase 9 構想、SMC / ChartPattern / Wyckoff 実機運用後に必要性を再評価)
- **既存 Lens の本体ロジック改変** (CandlePatternLens rename を除く)
- **DSL Evaluator の改変** (新 Lens features を DSL から参照できるようにするのは KICKOFF §6 各 Phase 内で **API 互換の範囲で** 行う、DSL 文法拡張は別 PR)
- **EvolutionLoop の改変** (新 Lens は `defaultLensAggregator` に登録するだけ、進化対象 Lens 指定の変更等は別 PR)
- **本番 SideBScheduler / Express server の経路変更** (Phase 7 は Lens 追加のみ、起動経路は無改変)
- **Step 4 ADK ParallelAgent 統合** (Phase 7 完了後の別 Step)
- ESLint / tsconfig audit の既存違反の大規模修正 (別 PR)
- unrelated refactor

---

## 4. 推奨ディレクトリ構成

```text
/src/side-b/lenses/
  SMCLens.ts                          # Phase 7a 新規
  ChartPatternLens.ts                 # Phase 7b 新規
  CandlePatternLens.ts                # Phase 7b で PatternLens から rename
  WyckoffLens.ts                      # Phase 7c 新規
  DowTheoryLens.ts                    # 既存 (無改変、utils 再利用元)
  CurrentAnalysisLens.ts              # 既存 (無改変)
  TimeSessionLens.ts                  # 既存 (無改変)
  VolatilityRegimeLens.ts             # 既存 (無改変)
  LensAggregator.ts                   # 既存 (registerDefaultLenses への追加のみ)
  types.ts                            # 既存 (LensInput に追加フィールド可能性あり、§6 詳細)
  index.ts                            # 既存 (新 Lens の export 追加)
  utils/
    pivotDetection.ts                 # 既存 (Phase 7a / 7b で再利用)

/src/side-b/tests/lenses/
  SMCLens.test.ts                     # Phase 7a 新規
  ChartPatternLens.test.ts            # Phase 7b 新規
  CandlePatternLens.test.ts           # Phase 7b で PatternLens.test.ts から rename
  WyckoffLens.test.ts                 # Phase 7c 新規

/analysis-engine/app/
  smc.py                              # Phase 7a 新規 (compute_smc_structures 等)
  chart_patterns.py                   # Phase 7b 新規 (compute_chart_patterns 等)
  wyckoff.py                          # Phase 7c 新規 (compute_wyckoff_phases 等)
  main.py                             # 既存 (新エンドポイント追加または既存拡張)

/docs/design/
  phase_7_specification.md            # 本書
  phase_7a_smc_notes.md               # Phase 7a 完了時
  phase_7b_chart_pattern_notes.md     # Phase 7b 完了時
  phase_7c_wyckoff_notes.md           # Phase 7c 完了時
  phase_7_summary.md                  # Phase 7 全完了時
  lens_elliott_wave_future_design.md  # Phase 8 用 (Phase 7 と同時に作成済、本書と兄弟関係)
  phase_6_specification.md            # 既存、§9.1 を Phase 7 完了時に更新
```

禁止:

- 既存 `pdcaLoop.ts` / `agentMemory.ts` / `agentLoop.ts` への新 Lens import
- 新 Lens から他 Lens への直接呼び出し (= レンズ独立性違反)
- analysis-engine 側で計算可能なロジックを side-b 側に重複実装すること
- DSL 文法の拡張 (Phase 7 範囲外)

---

## 5. 各 Lens の設計方針 (実装着手前の決定事項)

### 5.1 SMC Lens (Phase 7a)

**観測対象** (= Smart Money Concept の標準項目):

| 項目 | 説明 | 決定論性 |
|---|---|---|
| Order Block (OB) | 強い反発の起点 directional candle (Bull OB / Bear OB) | ✅ パラメータで一意 |
| Liquidity zone (BSL / SSL) | 直近高値 (Buy-side liquidity) / 安値 (Sell-side liquidity) クラスター | ✅ |
| Fair Value Gap (FVG) | 3-bar gap、middle bar の wick が前後 bar wick を超えない | ✅ |
| Break of Structure (BOS) | ピボット高値 / 安値の更新 (trend 継続シグナル) | ✅ |
| Change of Character (CHOCH) | ピボット更新の反転 (trend 転換シグナル) | ✅ |
| Premium / Discount zone | 直近 swing high-low の中央 50% 基準で上下分割 | ✅ |

**features (LensFeature.features)**:

```typescript
// 例 (実装時に細部調整)
{
  // OB / Liquidity
  nearest_ob_bull_distance_pips: number;       // 直近 Bull OB との距離
  nearest_ob_bear_distance_pips: number;       // 直近 Bear OB との距離
  liquidity_above_count: number;               // 上方 BSL の数 (lookback 20 bars)
  liquidity_below_count: number;               // 下方 SSL の数

  // FVG
  fvg_bull_count_last_20: number;
  fvg_bear_count_last_20: number;

  // Structure
  last_structure_event: 'BOS_BULL' | 'BOS_BEAR' | 'CHOCH_BULL' | 'CHOCH_BEAR' | 'NONE';
  bars_since_last_structure_event: number;

  // Zone
  current_zone: 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM';
  zone_position_pct: number;                   // 0-1, swing range 内の現在位置
}
```

**LensInput dependencies**: `ohlcvBars` + `precomputedSmcStructures` (analysis-engine から取得)

**analysis-engine 側 API**: `analysis-engine/app/smc.py` で `compute_smc_structures(bars: List[OHLCVBar]) -> SmcStructuresPayload` を実装。`/v1/indicator-series` 拡張または `/v1/lens-features/smc` 等の新規エンドポイントとして公開 (実装時に決定)。

**Lens 実装**: `class SMCLens implements Lens`、`lensName: 'smc'`、`lensVersion: '1.0.0'`、`dependencies: ['ohlcvBars', 'precomputedSmcStructures']`

**実装難度**: 中

### 5.2 ChartPattern Lens (Phase 7b)

**観測対象** (= N-bar 構造):

| パターン | 検出方式 | 注意点 |
|---|---|---|
| フラッグ / ペナント | impulse 後の consolidation (5-15 bars 等) | 許容誤差設定が必要 |
| トライアングル (上昇 / 下降 / 対称) | 高安が同方向 / 異方向に収束 | 最低 5 swing 点必要 |
| ヘッドアンドショルダー / 逆 H&S | 3 山構造 (中央が最高/最低) | ネックラインの傾き許容 |
| ダブルトップ / ダブルボトム | 2 山構造、価格距離 ≤ 0.3% | swing 確定後 |
| ウェッジ (rising / falling) | 高安が同方向に収束 + 傾斜 | トライアングルとの区別 |

**features**:

```typescript
{
  pattern_detected: 'FLAG' | 'PENNANT' | 'TRIANGLE_ASC' | 'TRIANGLE_DESC' | 'TRIANGLE_SYM'
    | 'HEAD_SHOULDER' | 'INV_HEAD_SHOULDER' | 'DOUBLE_TOP' | 'DOUBLE_BOTTOM'
    | 'WEDGE_RISE' | 'WEDGE_FALL' | 'NONE';
  pattern_confidence: number;                  // 0-1
  pattern_break_imminent: boolean;             // breakout 接近フラグ
  pattern_bars_count: number;                  // パターン形成期間
  pattern_direction_bias: 'BULL' | 'BEAR' | 'NEUTRAL';
}
```

**LensInput dependencies**: `ohlcvBars` + `precomputedChartPatterns`

**analysis-engine 側 API**: `analysis-engine/app/chart_patterns.py` で `compute_chart_patterns(bars: List[OHLCVBar]) -> ChartPatternsPayload`

**Lens 実装**: `class ChartPatternLens implements Lens`、`lensName: 'chart_pattern'`、`lensVersion: '1.0.0'`

**実装難度**: 中 (パターン定義の許容誤差設定が肝)

### 5.3 PatternLens → CandlePatternLens rename (Phase 7b 同梱)

既存 `PatternLens` (12 種ローソク足パターン、PR ②-1) を `CandlePatternLens` に rename。Phase 7b の最初の作業として実施。

**影響範囲** (grep 確認必須):

- `src/side-b/lenses/PatternLens.ts` → `CandlePatternLens.ts` (ファイル名 + クラス名)
- `src/side-b/lenses/index.ts` (export 名 + `registerDefaultLenses` 内の `lensName: 'pattern'` → `'candle_pattern'`)
- `src/side-b/tests/lenses/PatternLens.test.ts` → `CandlePatternLens.test.ts` (rename + import 追従)
- DSLEvaluator / EvolutionLoop / 既存テスト / prompts/*.md (mutation/crossover prompt) で `'pattern'` lensName を参照している箇所の **全件追従**

**互換性懸念**: 既存 `AITradeNote.lensSnapshot` 等の **永続化データに `'pattern'` キーが含まれる**可能性。後方互換が必要なら以下を選択:

- 案 A: `lensName` を `'candle_pattern'` だけにして、移行スクリプトで既存データを書き換え
- 案 B: `lensName` に alias 機構を入れて `'pattern'` も `'candle_pattern'` も同じ Lens を指せるようにする
- 案 C: 既存データは触らず、新規データから `'candle_pattern'` を使い、古い `'pattern'` キーは「歴史データ」として残す

→ **着手時の論点として保留**、Phase 7b PR 0 (rename 部分) で Nekoさんに確認。

### 5.4 Wyckoff Lens (Phase 7c)

**観測対象**:

| 項目 | 説明 | 決定論性 |
|---|---|---|
| Phase 判定 | Accumulation / Markup / Distribution / Markdown / Re-accumulation / Re-distribution | △ (文脈依存、ヒューリスティック必要) |
| Spring | 直近 swing low を一時的に割って戻る pattern | ✅ |
| Upthrust | 直近 swing high を一時的に超えて戻る pattern | ✅ |
| Sign of Strength (SOS) | 上昇 impulse + high volume | ✅ (volume があれば) |
| Sign of Weakness (SOW) | 下降 impulse + high volume | ✅ |

**features**:

```typescript
{
  wyckoff_phase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN'
    | 'RE_ACCUMULATION' | 'RE_DISTRIBUTION' | 'UNKNOWN';
  wyckoff_phase_confidence: number;            // 0-1
  spring_detected_in_last_20_bars: boolean;
  upthrust_detected_in_last_20_bars: boolean;
  last_sos_bars_ago: number | null;            // SOS なら 0+、無ければ null
  last_sow_bars_ago: number | null;
}
```

**LensInput dependencies**: `ohlcvBars` + `precomputedWyckoffPhases` (SMC 結果と内部共有可能)

**analysis-engine 側 API**: `analysis-engine/app/wyckoff.py` で `compute_wyckoff_phases(bars: List[OHLCVBar], smc_context: SmcStructuresPayload | None) -> WyckoffPhasesPayload`。SMC 結果をオプション入力にすることで判定材料を増やす。

**Lens 実装**: `class WyckoffLens implements Lens`、`lensName: 'wyckoff'`、`lensVersion: '1.0.0'`

**実装難度**: 中〜高 (phase 判定の文脈依存性、ヒューリスティック設計が肝)

---

## 6. Phase 構成

## Phase 7a: SMC Lens 実装

### 目的

`/AGENTS.md` ドメイン原則 §4 (Lens 独立・純粋・決定性) を厳守しつつ、SMC の標準項目 6 種を観測する Lens を新規追加する。

### 作業内容

1. analysis-engine 側に `compute_smc_structures(bars)` を実装 (Python、`smc.py`)
2. analysis-engine 側に Lens 用 API endpoint 追加 (`/v1/indicator-series` 拡張 or 新規)
3. side-b 側に `SMCLens` クラス実装 (`/src/side-b/lenses/SMCLens.ts`)
4. `defaultLensAggregator` に SMCLens を登録 (`/src/side-b/lenses/index.ts`)
5. 単体テスト追加 (`/src/side-b/tests/lenses/SMCLens.test.ts`、最低 8 cases)
6. 既存 5 Lens のテストが未改変で全 pass を確認
7. 結果を `docs/design/phase_7a_smc_notes.md` に記録

### Phase 7a DoD

- [ ] `compute_smc_structures` が analysis-engine に追加されている
- [ ] Lens 用 API endpoint が動作する (curl 等で実機確認)
- [ ] `SMCLens` が `Lens` interface を実装している
- [ ] `defaultLensAggregator` に登録されている
- [ ] §5.1 の features 全て (OB / Liquidity / FVG / BOS / CHOCH / Zone) が出力される
- [ ] 単体テスト 8 cases pass (= 各 feature ごとに最低 1 ケース + edge case)
- [ ] 既存 Lens テスト全 pass
- [ ] 決定論性検証 (同入力 → 同出力) のテスト含む
- [ ] `npm run build` green、`npx jest` green
- [ ] `phase_7a_smc_notes.md` 作成
- [ ] 既存 `pdcaLoop.ts` / `agentMemory.ts` / `skills/` の git diff ゼロ

---

## Phase 7b: ChartPatternLens 新規 + PatternLens rename

### 目的

N-bar 構造のチャートパターン 11 種を観測する Lens を新規追加。同時に既存 `PatternLens` (ローソク足 12 種) を `CandlePatternLens` に rename して命名の混乱を防ぐ。

### 作業順序 (Phase 7b 内 PR 分割)

**PR 0 (rename)**: `PatternLens` → `CandlePatternLens` 全面 rename。**ChartPatternLens 追加前** に独立 PR として merge する。理由: rename だけで多数の参照追従が発生するため、ChartPattern 追加と混在すると review コストが膨らむ

**PR 1 (新規追加)**: `ChartPatternLens` 本体実装 + analysis-engine API 追加

### 作業内容

#### PR 0 (rename)
1. `PatternLens.ts` → `CandlePatternLens.ts` rename (クラス名・ファイル名)
2. `lensName: 'pattern'` → `'candle_pattern'` (要 Nekoさん確認、§5.3 の互換性案を相談)
3. `index.ts` の export 名 + `registerDefaultLenses` 追従
4. `PatternLens.test.ts` → `CandlePatternLens.test.ts` rename + import 追従
5. 全プロジェクトの `'pattern'` lensName 参照を grep で洗い出し、追従
6. 既存テスト regression 確認

#### PR 1 (ChartPatternLens 新規)
1. analysis-engine 側 `chart_patterns.py` に `compute_chart_patterns(bars)` 実装
2. Lens 用 API endpoint 追加
3. side-b 側 `ChartPatternLens` クラス実装
4. `defaultLensAggregator` に登録
5. 単体テスト 11+ cases (= パターン 11 種 + edge case)
6. `phase_7b_chart_pattern_notes.md` 作成

### Phase 7b DoD

- [ ] PR 0 merge 後: `PatternLens` への参照が全プロジェクトでゼロ (grep で確認)
- [ ] PR 0 merge 後: 既存テスト全 pass (`'pattern'` → `'candle_pattern'` の参照追従完了)
- [ ] `ChartPatternLens` が `Lens` interface を実装している
- [ ] `defaultLensAggregator` に登録されている
- [ ] §5.2 の features (11 パターン + confidence + break_imminent 等) が出力される
- [ ] 単体テスト 11+ cases pass
- [ ] 既存 Lens テスト + Phase 7a SMC テスト全 pass
- [ ] `npm run build` green、`npx jest` green
- [ ] `phase_7b_chart_pattern_notes.md` 作成
- [ ] 既存不可侵領域 (pdcaLoop / agentMemory / skills) の git diff ゼロ

---

## Phase 7c: Wyckoff Lens 実装

### 目的

ワイコフ理論の主要観測項目 (4 phase 判定 + Spring / Upthrust / SOS / SOW) を観測する Lens を新規追加。Phase 7a SMC 結果を判定材料に活用できる構造にする。

### 作業内容

1. analysis-engine 側 `wyckoff.py` に `compute_wyckoff_phases(bars, smc_context)` 実装
   - SMC 結果をオプション入力に取り、SMC BOS / CHOCH 情報を phase 判定に活用
2. Lens 用 API endpoint 追加
3. side-b 側 `WyckoffLens` クラス実装
   - `LensInput.precomputedWyckoffPhases` で受け取る
4. `defaultLensAggregator` に登録
5. 単体テスト 7+ cases pass (4 phase + Spring + Upthrust + SOS/SOW)
6. `phase_7c_wyckoff_notes.md` 作成

### Phase 7c DoD

- [ ] `compute_wyckoff_phases` が analysis-engine に追加されている (SMC 結果を optional input)
- [ ] `WyckoffLens` が `Lens` interface を実装している
- [ ] `defaultLensAggregator` に登録されている
- [ ] §5.4 の features (phase / Spring / Upthrust / SOS / SOW) が出力される
- [ ] 単体テスト 7+ cases pass
- [ ] 既存 Lens テスト + Phase 7a + 7b テスト全 pass
- [ ] `npm run build` green、`npx jest` green
- [ ] `phase_7c_wyckoff_notes.md` 作成
- [ ] 既存不可侵領域の git diff ゼロ

---

## Phase 7 完了処理 (Phase 7c 完了 PR と同梱、または別 PR)

- [ ] `docs/design/phase_7_summary.md` を作成 (Phase 7 全体総括、3 Lens 追加 + rename + analysis-engine 拡張の集約)
- [ ] `docs/design/phase_6_specification.md` §9.1 を更新 (Phase 7 / 8 / 9 のスコープ反映)
- [ ] `docs/architecture/ADK_ADOPTION.md` §3 ロードマップで Step 4 着手前提として Phase 7 完了を記載 (必要なら)
- [ ] `/src/side-b/lenses/` の 全 Lens (8 本: 既存 5 + 新規 3) が `registerDefaultLenses` で登録されている

---

## 7. 全体 DoD

Phase 7 は以下をすべて満たした場合に完了とする。

### 7.1 実装 DoD

- [ ] `SMCLens` (Phase 7a) が動作する
- [ ] `ChartPatternLens` (Phase 7b) が動作する
- [ ] `CandlePatternLens` (Phase 7b、`PatternLens` から rename) が動作する
- [ ] `WyckoffLens` (Phase 7c) が動作する
- [ ] `defaultLensAggregator` に上記 4 Lens (新規 3 + rename 1) が登録されている
- [ ] analysis-engine 側に SMC / ChartPattern / Wyckoff の compute 関数 + API endpoint が追加されている
- [ ] 既存 5 Lens の **本体ロジック** が改変されていない (rename のみ)

### 7.2 テスト DoD

- [ ] 新規 Lens 3 種の単体テスト全 pass (SMC 8+ / ChartPattern 11+ / Wyckoff 7+ cases)
- [ ] CandlePatternLens の既存テストが rename 後も全 pass
- [ ] 既存 Lens (Current / TimeSession / DowTheory / VolatilityRegime) のテスト全 pass
- [ ] `npm run build` green
- [ ] `npx jest` green
- [ ] `'pattern'` lensName を参照する箇所が全件 `'candle_pattern'` に追従済 (= grep でゼロ件、または互換性レイヤー経由)

### 7.3 設計 DoD

- [ ] 既存 `pdcaLoop.ts` / `agentMemory.ts` / `agentLoop.ts` の git diff ゼロ
- [ ] 既存 `src/side-b/skills/` の git diff ゼロ
- [ ] `prisma/schema.prisma` の git diff ゼロ
- [ ] 新 Lens が他 Lens に依存していない (= レンズ独立性、ドメイン原則 §4)
- [ ] 新 Lens に副作用 (DB / 通知 / 外部 IO) がない
- [ ] 新 Lens が決定論的 (同入力 → 同出力)
- [ ] DSL 文法を拡張していない (Phase 7 範囲外)
- [ ] EvolutionLoop の進化対象 Lens 指定を変更していない (Phase 7 範囲外)

### 7.4 ドキュメント DoD

- [ ] `phase_7a_smc_notes.md` がある
- [ ] `phase_7b_chart_pattern_notes.md` がある
- [ ] `phase_7c_wyckoff_notes.md` がある
- [ ] `phase_7_summary.md` がある
- [ ] `phase_6_specification.md` §9.1 が更新されている
- [ ] PR description にテスト結果と実機検証手順がある

---

## 8. 禁止事項

本 Phase では以下を禁止する。

- 既存 Lens (Current / TimeSession / DowTheory / VolatilityRegime) の本体ロジック改変
- 新 Lens から他 Lens への直接呼び出し (= レンズ間結合、ドメイン原則 §4 違反)
- analysis-engine で計算可能なロジックを side-b 側に重複実装
- `pdcaLoop.ts` / `agentMemory.ts` / `agentLoop.ts` の改変
- `src/side-b/skills/` の改変
- DSL 文法の拡張 (新 Lens features の参照は既存 DSL の範囲で)
- EvolutionLoop の進化対象 Lens 指定の変更
- 本番 SideBScheduler の経路変更
- Prisma schema 変更
- raw LLM 出力を Lens features に保存
- `any` / `unknown` の本番コード使用 (tests / scripts のみ例外)
- `@ts-ignore` / `@ts-nocheck` (10 文字以上の description 付き `@ts-expect-error` のみ可)
- エリオット波動 / P&F の Lens 実装 (Phase 8 / 9 範囲)
- ADK ParallelAgent 統合 (Step 4 範囲)
- unrelated refactor
- ESLint / tsconfig audit の既存違反の大規模修正

---

## 9. 推奨 PR 分割

| PR | 内容 | Phase |
|---|---|---|
| PR 1 | analysis-engine SMC API + side-b SMCLens + tests | Phase 7a |
| PR 2 | `PatternLens` → `CandlePatternLens` rename (`lensName` 互換性方針も含む) | Phase 7b PR 0 |
| PR 3 | analysis-engine ChartPattern API + side-b ChartPatternLens + tests | Phase 7b PR 1 |
| PR 4 | analysis-engine Wyckoff API + side-b WyckoffLens + tests | Phase 7c |
| PR 5 | `phase_7_summary.md` + `phase_6_specification.md` §9.1 更新 + 必要なら ADK_ADOPTION.md 整合 | Phase 7 完了 |

PR 番号は実際の進行に合わせて変更してよい。ただし、**Phase 単位で差分を小さく保つ** こと。Phase 7b は rename と新規追加を別 PR に分けることが特に重要 (review コスト削減)。

---

## 10. 既存実装への影響範囲 (改変禁止、再利用 OK)

### 10.1 改変禁止 (= git diff ゼロを維持)

| 対象 | 理由 |
|---|---|
| `src/side-b/agent/pdcaLoop.ts` | 不可侵領域 (`ADK_ADOPTION.md` §6) |
| `src/side-b/agent/agentMemory.ts` | 同上 |
| `src/side-b/agent/agentLoop.ts` | 同上 |
| `src/side-b/skills/*` | 同上 |
| `src/side-b/lenses/CurrentAnalysisLens.ts` | 既存 Lens 不可侵 (ドメイン原則 §4) |
| `src/side-b/lenses/TimeSessionLens.ts` | 同上 |
| `src/side-b/lenses/DowTheoryLens.ts` | 同上 (utils 再利用は OK、ロジック改変不可) |
| `src/side-b/lenses/VolatilityRegimeLens.ts` | 同上 |
| `prisma/schema.prisma` | スキーマ変更禁止 |

### 10.2 再利用 OK

| 対象 | 再利用方法 |
|---|---|
| `src/side-b/lenses/utils/pivotDetection.ts` | SMC / ChartPattern / Wyckoff のピボット系起点として参照 |
| `src/side-b/lenses/types.ts` | `Lens` interface 実装、`LensInput` に新 dependencies フィールド追加可 (additive のみ) |
| `analysis-engine/app/indicators.py` | 既存指標計算結果を SMC / Wyckoff に活用 |
| `analysis-engine/app/main.py` | `/v1/indicator-series` の追加項目として既存パターンを踏襲 |

### 10.3 改変が必要 (= 本 Phase で diff 発生)

| 対象 | 改変内容 |
|---|---|
| `src/side-b/lenses/index.ts` | 新 Lens の export 追加、`registerDefaultLenses` に SMC / ChartPattern / Wyckoff / CandlePattern (旧 Pattern) 登録 |
| `src/side-b/lenses/PatternLens.ts` → `CandlePatternLens.ts` | rename + クラス名変更 (本体ロジック無改変) |
| `src/side-b/lenses/types.ts` | `LensInput` に新 dependencies フィールド追加 (precomputedSmcStructures / precomputedChartPatterns / precomputedWyckoffPhases、すべて optional) |
| `analysis-engine/app/main.py` | 新 endpoint 追加または `/v1/indicator-series` 拡張 |
| `analysis-engine/app/{smc,chart_patterns,wyckoff}.py` | 新規追加 |
| `docs/design/phase_6_specification.md` §9.1 | Phase 7 / 8 / 9 スコープ更新 (Phase 7 完了 PR で実施) |

---

## 11. Step 4 (ADK ParallelAgent dry-run) への引き継ぎ

Phase 7 完了後、Step 4 着手時に Step 3 で確立した 3 つの建材 (`runnerSmoke.ts` / `sequentialSmoke.ts` / `pdcaDryRunWrapper.ts`) を流用しつつ:

1. `defaultLensAggregator` 登録の **8 Lens** (既存 5 + 新規 3 = SMC / ChartPattern (旧 Pattern → CandlePattern も含めて) / Wyckoff) を `ParallelAgent` で並列実行する dry-run wrapper を構築
2. 各 Lens の実行を `adk.subagent.*` event として観測 (Phase 2 で確立した trace 契約を再利用)
3. Lens の決定性 (= 並列実行で同入力同出力) を実機検証
4. 既存 Lens 実装は不可侵 (Phase 7 と同じく合成によるラップのみ)

Step 4 で実装する Lens dry-run wrapper は本 Phase の `LensAggregator` を流用するため、本 Phase で `Lens` interface / `LensInput` / `LensFeature` の契約を変えない (= additive 拡張のみ)。

---

## 12. オープン課題 (Phase 着手前に Nekoさん確認)

本 KICKOFF 起案時点で確定していない判断。Phase 着手前 (または該当 Phase の PR レビュー時) にレビューで確定したい。

### 12.1 `lensName: 'pattern'` → `'candle_pattern'` の互換性方針

§5.3 で 3 案 (A: 全データ書き換え / B: alias 機構 / C: 既存データ放置) を提示。Phase 7b PR 0 着手前に Nekoさん判断が必要。

**現時点の推奨**: 案 C (既存データ放置、新規データから新 lensName を使う)。理由: 進化的探索の歴史データは「学習材料」なので、過去の Lens key も含めてそのまま残すのが安全。新 lensName での再学習は新たに進化サイクルを回せば自然に蓄積される。

### 12.2 analysis-engine 側 API の配置方式

§5.1 / §5.2 / §5.4 で「`/v1/indicator-series` 拡張 or 新規エンドポイント」と保留。

**現時点の推奨**: `/v1/indicator-series` 拡張で SMC / ChartPattern / Wyckoff の features を additive に追加。理由: 既存 `compute_candlestick_pattern_flags` と同じパターンで運用負荷が小さい。

### 12.3 Lens のバージョニング戦略

Phase 7 で新 Lens を `lensVersion: '1.0.0'` で公開するが、将来 features を増やした際の versioning ルール (= major bump / minor bump の境界) が未確定。

**現時点の推奨**: features 追加 = minor bump (`1.0.0` → `1.1.0`)、features 削除 = major bump (`1.0.0` → `2.0.0`)。historical 学習データとの互換性検証は `lensVersion` のチェックで行う。

### 12.4 Wyckoff phase 判定のヒューリスティック設計

§5.4 で「phase 判定は文脈依存、ヒューリスティック必要」と保留。

**現時点の推奨**: Phase 7c 着手時に **analysis-engine 側で複数の判定アルゴリズム候補をベンチマーク** してから採用。実装着手前にアルゴリズム選定を行う。

---

## 13. 実装時のレビュー観点

Copilot / Claude Code 自己レビュー時は、以下を必ず確認する。

### 13.1 不可侵領域の遵守

- 既存 Lens の本体ロジック改変ゼロ (`git diff -- src/side-b/lenses/` で CandlePattern rename 以外の diff なし)
- `pdcaLoop.ts` / `agentMemory.ts` / `agentLoop.ts` の diff ゼロ
- `src/side-b/skills/` の diff ゼロ
- `prisma/schema.prisma` の diff ゼロ
- 新 Lens から他 Lens への import がない

### 13.2 Lens 独立性 (ドメイン原則 §4)

- 副作用なし (DB / 通知 / 外部 IO ゼロ)
- 他レンズ非依存 (= LensInput のみから feature を計算)
- 決定性あり (= 単体テストで同入力同出力を確認)
- ランダム要素ゼロ

### 13.3 型安全

- 本番コードに `any` / `unknown` がない
- 型ガードが過剰に緩くない
- `as` による雑な型逃げがない
- features の型が enum / number / boolean / string のいずれかに収まる (= `LensFeature.features` の制約遵守)

### 13.4 analysis-engine 連携

- Python 側 compute 関数が決定論的 (= 同入力同出力)
- API endpoint が既存パターン (`/v1/indicator-series` 等) を踏襲
- TypeScript 側で API レスポンスを Zod でランタイム検証

### 13.5 テスト

- 新 Lens の単体テストが §6 各 Phase DoD のケース数を満たす
- 決定性検証テストを含む (同入力で 2 回実行して同出力)
- edge case を含む (empty bars / 不正データ / 境界値)
- 既存 Lens / Skill / PDCALoop のテストが未改変で全 pass

---

## 14. 最終メッセージ

Phase 7 は「マーケットを観測する視点を、人間が使っているのと同じ語彙で機械化する」工程である。

Nekoさんが理想として語った:

> マーケットを観測 → 情報を統合 → 複数シナリオを構築 → シナリオごとにトレードプランを練る → 実行 → ノートに保存 → 検証 → エッジ蓄積 → エッジで判断

このプロセスの **「観測」** の章を、5 つの Lens から 8 つに拡張する。8 つあれば「マーケットの今の状態」を測る視点として実用域に届く。エリオット波動 (Phase 8) と P&F (Phase 9 構想) を追加するかは、Phase 7 + Step 4 完了後の運用観察で判断する。

本 Phase の完了条件は **「Lens を追加する」** ではない。**「追加された Lens が、ドメイン原則 §4 (独立・純粋・決定性) を守って動く」** ことを実機検証で確認すること。

次は実装エージェント (Claude Code) が PR 1 (SMC Lens) から着手する。
