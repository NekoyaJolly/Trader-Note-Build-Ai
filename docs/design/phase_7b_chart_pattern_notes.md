# Phase 7b ChartPattern Lens 実装ノート

> **作成日**: 2026-05-14
> **対象**: Phase 7b (Chart Pattern Lens 新規追加) の実装結果
> **設計書**: [`phase_7_specification.md`](./phase_7_specification.md) §5.2 / §6.2
> **次フェーズ**: Phase 7c (Wyckoff Lens)
> **ステータス**: ✅ 実装完了 (PR レビュー中)

---

## 1. 結論サマリー (先出し)

| 項目 | 採用結果 |
|------|---------|
| Lens 配置 | side-b TypeScript (`ChartPatternLens`)、analysis-engine Python (`compute_chart_patterns`) の 2 層 (Phase 7a SMC と同パターン) |
| **PatternLens rename**: | **不要** (user 判断 2026-05-14)。既存 `lensName: 'pattern'` (ローソク足) はそのまま、本 Phase で `lensName: 'chart_pattern'` を新規追加 |
| 命名階層 | `pattern` (基本 = ローソク足) / `chart_pattern` (応用 = N-bar 構造) — user 哲学を直接反映 |
| API 配置 | `/v1/indicator-series` 拡張で `includeChartPatterns: bool` フラグ (Phase 7a と同方針) |
| Node 側 Zod 拡張 | **本 PR で同時実施** (Phase 7a Copilot review #186 critical 指摘を踏襲) |
| Chart Pattern features 数 | **5 個** (`CHART_PATTERN_LENS_FEATURE_KEYS`) |
| 検出パターン数 | 11 種 + NONE (FLAG / PENNANT / TRIANGLE × 3 / HEAD_SHOULDER × 2 / DOUBLE × 2 / WEDGE × 2) |
| `LensFeature.features` 型遵守 | 全 features が `number / string / boolean` のみ |
| テスト結果 | adk + lenses 領域 **275 cases 全 pass** (Step 1-3 adk: 177、lenses 既存: 61、Phase 7a SMCLens: 19、Phase 7b ChartPatternLens: 18) |

---

## 2. 採用構成

```
EvolutionLoop (将来) / Lens 評価経路
   ↓ /v1/indicator-series { includeChartPatterns: true }
analysis-engine
   ├─→ compute_chart_patterns(df) → ChartPatternsPayload
   ↓ IndicatorSeriesResponse.chartPatterns
side-b LensInput.precomputedChartPatterns = payload
   ↓ ChartPatternLens.compute(input)
LensFeature.features = {
  pattern_detected: enum (11 + NONE),
  pattern_confidence: number (0-1),
  pattern_break_imminent: boolean,
  pattern_bars_count: number,
  pattern_direction_bias: 'BULL' | 'BEAR' | 'NEUTRAL',
}
```

---

## 3. 「Pattern」と「Chart Pattern」の階層命名 (user 哲学反映)

Phase 7b 着手前の user 判断 (2026-05-14):

> なんでパターンっていうのを基本って考えれば、ローソク足の基本のパターンがあって、そっから応用であったりとか組み合わせてチャートパターンが作られるわけだから、整合性は取れるよね、それで。
> ローソク足は今まで通りパターンを使って、チャートパターンに関してはチャートパターンでいいわね。

これを `lensName` にそのまま反映:

| Lens | lensName | 意味 | 由来 |
|---|---|---|---|
| `PatternLens` (既存、PR ②-1 / ④F) | `'pattern'` | ローソク足 12 種 (= 基本) | PR ②-1 で命名 |
| `ChartPatternLens` (Phase 7b 新規) | `'chart_pattern'` | N-bar 構造 11 種 (= 応用) | 本 Phase で追加 |

**利点**:
- migration / alias 不要 (既存 `'pattern'` lensName をそのまま継続)
- 既存進化的探索の歴史データ (`AITradeNote.lensSnapshot` 等の `'pattern'` キー) が完全互換
- 命名階層が `lensName` に直接表れるため意図が明確
- KICKOFF §12.1「既存データ放置」(案 C) を採用しつつ、命名衝突も回避

これにより KICKOFF §5.3 で記載していた **PatternLens → CandlePatternLens rename は実施しない**。spec の §5.3 / §12.1 記述は Phase 7 完了処理 (`phase_7_summary.md` 作成と同時) でまとめて更新する (user 判断 2026-05-14)。

---

## 4. 検出する 11 種パターン

| カテゴリ | パターン | 検出条件 (簡素化版) | direction_bias |
|---|---|---|---|
| Continuation | FLAG | 大きな impulse 後の 3-15 本並行 channel (高安傾き同方向、傾き差 < 0.15%) | impulse 方向 (BULL/BEAR) |
| Continuation | PENNANT | 大きな impulse 後の 3-15 本収束 (高値下降 + 安値上昇) | impulse 方向 |
| Triangle | TRIANGLE_ASC | 高値水平 + 安値上昇 | BULL |
| Triangle | TRIANGLE_DESC | 高値下降 + 安値水平 | BEAR |
| Triangle | TRIANGLE_SYM | 高値下降 + 安値上昇 (両者中央収束) | NEUTRAL |
| Reversal | HEAD_SHOULDER | 直近 3 高値 swing で中央が最高、両肩価格差 ≤ 0.3% | BEAR |
| Reversal | INV_HEAD_SHOULDER | 直近 3 安値 swing で中央が最低、両肩価格差 ≤ 0.3% | BULL |
| Reversal | DOUBLE_TOP | 直近 2 高値 swing で価格差 ≤ 0.3% | BEAR |
| Reversal | DOUBLE_BOTTOM | 直近 2 安値 swing で価格差 ≤ 0.3% | BULL |
| Wedge | WEDGE_RISE | 高値上昇 + 安値上昇 (収束、高値傾き < 安値傾き) | BEAR |
| Wedge | WEDGE_FALL | 高値下降 + 安値下降 (収束、\|安値傾き\| < \|高値傾き\|) | BULL |

**同時複数検出時のルール**: `confidence` が最も高い 1 つを採用。詳細は `analysis-engine/app/chart_patterns.py` `compute_chart_patterns` 参照。

**Pattern break imminent**: 直近 10 本の高値 / 安値の境界線まで 5% 以内なら true (Phase 7b 簡素化版)。

---

## 5. 実装上の発見事項

### 5.1 Phase 7a SMC との実装パターン共通化

Phase 7a SMC でファイル構成・サイドカー方式・sentinel 設計・Zod 拡張を確立した。Phase 7b はそれを **完全踏襲**:

| 項目 | Phase 7a SMC | Phase 7b ChartPattern |
|---|---|---|
| analysis-engine ファイル | `smc.py` | `chart_patterns.py` |
| compute 関数 | `compute_smc_structures(df)` | `compute_chart_patterns(df)` |
| Pydantic Payload | `SmcStructuresPayload` | `ChartPatternsPayload` |
| Request flag | `includeSmc: bool = False` | `includeChartPatterns: bool = False` |
| Response field | `smc: Optional[...]` | `chartPatterns: Optional[...]` |
| Node Zod schema | `AnalysisEngineSmcStructuresPayloadSchema` | `AnalysisEngineChartPatternsPayloadSchema` |
| TS Payload interface | `SmcStructuresPayload` | `ChartPatternsPayload` |
| LensInput field | `precomputedSmcStructures` | `precomputedChartPatterns` |
| Lens class | `SMCLens` | `ChartPatternLens` |
| feature keys 定数 | `SMC_LENS_FEATURE_KEYS` (10) | `CHART_PATTERN_LENS_FEATURE_KEYS` (5) |
| dependencies | `['symbol', 'precomputedSmcStructures']` | `['symbol', 'precomputedChartPatterns']` |
| registerDefaultLenses 追加 | ✅ Phase 7a | ✅ Phase 7b |

このパターン化により Phase 7c (Wyckoff) も同じテンプレートで実装できる見込み。

### 5.2 Phase 7a Copilot review #186 の知見を最初から適用

Phase 7a で指摘された 7 件のうち、本 Phase で**最初から適用**したもの:

- ✅ Node 側 Zod スキーマも同時に拡張 (`AnalysisEngineChartPatternsPayloadSchema` + request/response 拡張)
- ✅ `dependencies` に `ohlcvBars` を含めない (本 lens は `precomputedChartPatterns` のみ参照)
- ✅ Lens 内部の sentinel 設計を最初から考慮 (本 lens は `confidence` 経由判定推奨を明記)
- ✅ test の import path は `'../../lenses/ChartPatternLens'` 等の convention に揃える
- ✅ docstring の Zone 閾値のような実装-spec 乖離が起きないよう、コード - schema doc を同期記述

→ Phase 7a 時間 (Copilot 指摘 → 修正の往復) を Phase 7b では削減できた。

### 5.3 sentinel 設計の Phase 7b 固有の制約

Phase 7a SMC では:
- count 系 → -1 sentinel
- zone_position_pct → -1.0 sentinel (range 0.0-1.0 外)

で実データと sentinel を区別した。

Phase 7b ChartPattern では:
- `patternDetected: 'NONE'` は **実データの「パターンなし」と sentinel の「payload 未指定」が共通**
- `patternBarsCount: 0` も同様 (実データの 0 と sentinel が共通)
- 完全な区別は不可能 → **`confidence === 0` で判定推奨** (`ChartPatternLens.ts` の docstring に明記)

「Chart Pattern が検出されない」と「payload を渡していない」は意味的に近いため、共通 sentinel で許容。DSL Evaluator は `confidence` で区別する。

### 5.4 計算ロジックの簡素化方針 (Phase 7b)

`analysis-engine/app/chart_patterns.py` の各パターン検出は **ヒューリスティック簡素化** (Phase 7a 同方針)。詳細チューニングは Phase 7 完了後の運用観察で:

| 簡素化項目 | 後送り |
|---|---|
| HEAD_SHOULDER の neckline 傾き許容 | 厳密な 0.0 traceback 計算は将来 |
| FLAG / PENNANT の impulse 強さ閾値 | 「直前 20 本の平均 (high-low) の 2 倍以上」固定、symbol 別チューニングは将来 |
| confidence のスコアリング | 基本 0.55 / 価格一致度ベース 0-1、より厳密なベイズ系統計は将来 |
| WEDGE と TRIANGLE_SYM の境界判定 | 傾き比較ベース、許容誤差は将来チューニング |
| break_imminent の閾値 5% | symbol 別 (XAUUSD / FX / 株式) で異なるべきだが、Phase 7b 固定 |

これらは Phase 7c Wyckoff 実装後、Phase 7 完了処理時に `phase_7_summary.md` 内でまとめて Step 4 引き継ぎ事項に整理する。

---

## 6. KICKOFF §6.2 Phase 7b DoD 対応

| # | DoD | 対応 |
|---|---|---|
| PR 0 (rename) | PatternLens → CandlePatternLens rename | ❌ **user 判断により実施しない** (NOTES §3、KICKOFF §5.3 / §12.1 は Phase 7 完了処理で更新) |
| 1 | `compute_chart_patterns` が analysis-engine に追加 | ✅ `analysis-engine/app/chart_patterns.py` |
| 2 | Lens 用 API endpoint が動作 (curl で実機確認) | ⚠️ Python テスト infra 未整備、Phase 7c までに E2E でまとめる |
| 3 | `ChartPatternLens` が `Lens` interface を実装 | ✅ |
| 4 | `defaultLensAggregator` 登録 | ✅ `registerDefaultLenses` に追加 |
| 5 | §5.2 features (5 個) が出力される | ✅ |
| 6 | 単体テスト 11+ cases pass | ✅ **18 cases** pass |
| 7 | 既存 Lens テスト + Phase 7a SMC テスト全 pass | ✅ adk + lenses 275/275 PASS |
| 8 | `npm run build` green、`npx jest` green | ✅ |
| 9 | `phase_7b_chart_pattern_notes.md` 作成 | ✅ 本書 |
| 10 | 既存不可侵領域 (pdcaLoop / agentMemory / skills / 他 Lens 本体 / prisma) git diff ゼロ | ✅ |

---

## 7. 変更ファイル一覧

| ファイル | 内容 | 行数 |
|---|---|---|
| `analysis-engine/app/chart_patterns.py` | 新規。`compute_chart_patterns` 等 11 種パターン検出 | ~340 |
| `analysis-engine/app/schemas.py` | 追記。`ChartPatternsPayload` クラス、`IndicatorSeriesRequest.includeChartPatterns`、`IndicatorSeriesResponse.chartPatterns` | +40 |
| `analysis-engine/app/main.py` | 追記。`from app.chart_patterns import compute_chart_patterns` + `/v1/indicator-series` で `req.includeChartPatterns` 時の処理 | +6 |
| `src/schemas/external/analysisEngine.ts` | 追記。`AnalysisEngineChartPatternsPayloadSchema`、Request `includeChartPatterns`、Response `chartPatterns` | +35 |
| `src/side-b/lenses/types.ts` | 追記。`ChartPatternsPayload` interface、`LensInput.precomputedChartPatterns` | +45 |
| `src/side-b/lenses/ChartPatternLens.ts` | 新規。`ChartPatternLens` クラス、`CHART_PATTERN_LENS_FEATURE_KEYS`、内部 helper | ~110 |
| `src/side-b/lenses/index.ts` | 追記。ChartPatternLens の export + registerDefaultLenses への登録 | +6 |
| `src/side-b/tests/lenses/ChartPatternLens.test.ts` | 新規。ChartPatternLens 単体テスト 18 cases | ~230 |
| `docs/design/phase_7b_chart_pattern_notes.md` | 新規。本書 | (本書) |

既存実装の改変は **ゼロ**:
- 既存 PatternLens は無改変 (user 判断、rename しない)
- pdcaLoop / agentMemory / skills / 他 Lens 本体 / prisma すべて無改変

---

## 8. Phase 7c (Wyckoff Lens) への引き継ぎ事項

### 8.1 確定済みパターン (Phase 7c でも踏襲)

Phase 7a SMC + 7b ChartPattern で確立した 2 層パターン (analysis-engine + side-b):

- analysis-engine `wyckoff.py` に `compute_wyckoff_phases(df, smc_context)` を実装 (Phase 7a SMC 結果を input として活用)
- `schemas.py` に `WyckoffPhasesPayload` + `IndicatorSeriesRequest.includeWyckoff` + `IndicatorSeriesResponse.wyckoff`
- `analysisEngine.ts` (Node Zod) に `AnalysisEngineWyckoffPhasesPayloadSchema` + Request/Response 拡張 (本 Phase で最初から実施)
- `types.ts` に `WyckoffPhasesPayload` interface + `LensInput.precomputedWyckoffPhases`
- `WyckoffLens.ts` (`lensName: 'wyckoff'`)
- `registerDefaultLenses` に追加
- テスト + NOTES

### 8.2 Phase 7c で SMC 結果を活用する設計

Phase 7c Wyckoff Lens は **SMC 結果 (Phase 7a) を入力に取れる**設計 (KICKOFF §5.4):

> `compute_wyckoff_phases(bars, smc_context: SmcStructuresPayload | None)`

これにより SMC の BOS / CHOCH 情報を Wyckoff phase 判定 (Accumulation / Markup 等) の精度向上に使える。Phase 7c の重要設計判断。

### 8.3 Phase 7 完了処理で更新する spec 記述

`phase_7_specification.md` の以下の箇所は **Phase 7 完了処理時に Phase 7 summary PR で一括更新**:

- §5.3 PatternLens → CandlePatternLens rename → **実施しない** (user 判断、本 Phase 着手前)
- §12.1 互換性方針 → **案 C 採用 + rename 不要** (PatternLens は `lensName: 'pattern'` のまま)

### 8.4 Phase 7 完了前にやり残し検証 (Step 4 着手前にまとめる、Phase 7a 同様)

- analysis-engine の E2E 動作確認 (Docker 起動 + curl)
- Python 単体テスト infra の整備
- `IndicatorSeriesByVersionRequest` への `includeChartPatterns` / `includeSmc` 拡張
- DSL Evaluator での chart pattern features 参照互換性

---

## 9. 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| [`phase_7_specification.md`](./phase_7_specification.md) | Phase 7 KICKOFF (本書は §6.2 Phase 7b の成果物) |
| [`phase_7a_smc_notes.md`](./phase_7a_smc_notes.md) | Phase 7a SMC 実装ノート (本書の前提) |
| [`lens_elliott_wave_future_design.md`](./lens_elliott_wave_future_design.md) | Phase 8 Elliott Wave 構想 |
| [`phase_6_specification.md`](./phase_6_specification.md) §9.1 | Phase 7 / 8 / 9 スコープ整合 |
| [`/AGENTS.md`](../../AGENTS.md) | ドメイン原則 §4 (Lens 独立・純粋・決定性) |
| [`/src/side-b/lenses/ChartPatternLens.ts`](../../src/side-b/lenses/ChartPatternLens.ts) | Phase 7b 実装本体 |
| [`/analysis-engine/app/chart_patterns.py`](../../analysis-engine/app/chart_patterns.py) | Python 側 chart pattern 検出 |
