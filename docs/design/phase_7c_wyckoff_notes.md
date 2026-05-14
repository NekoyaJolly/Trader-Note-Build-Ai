# Phase 7c Wyckoff Lens 実装ノート

> **作成日**: 2026-05-14
> **対象**: Phase 7c (Wyckoff Lens 新規追加) の実装結果
> **設計書**: [`phase_7_specification.md`](./phase_7_specification.md) §5.4 / §6.3
> **次フェーズ**: Phase 7 完了処理 (phase_7_summary.md + spec 整合 + ADK_ADOPTION 更新)
> **ステータス**: ✅ 実装完了 (PR レビュー中)

---

## 1. 結論サマリー (先出し)

| 項目 | 採用結果 |
|------|---------|
| Lens 配置 | side-b TypeScript (`WyckoffLens`)、analysis-engine Python (`compute_wyckoff_phases`) の 2 層 (Phase 7a / 7b と同パターン) |
| **SMC context 連携** | `compute_wyckoff_phases(df, smc_context: Optional[SmcStructuresPayload])` — SMC BOS / CHOCH 情報で phase 判定精度向上 |
| API 配置 | `/v1/indicator-series` 拡張で `includeWyckoff: bool` フラグ (Phase 7a/7b と同方針) |
| Node 側 Zod 拡張 | **本 PR で同時実施** (Phase 7a critical 知見継承を継続) |
| Wyckoff features 数 | **6 個** (`WYCKOFF_LENS_FEATURE_KEYS`) |
| Phase 値 | 7 種 (ACCUMULATION / MARKUP / DISTRIBUTION / MARKDOWN / RE_ACCUMULATION / RE_DISTRIBUTION / UNKNOWN) |
| シグナル | Spring / Upthrust (bool) + SOS / SOW (経過バー数、sentinel -1) |
| `LensFeature.features` 型遵守 | 全 features が `number / string / boolean` のみ |
| テスト結果 | adk + lenses 領域 **295 cases 全 pass** (Step 1-3 adk: 177、lenses 既存: 61、Phase 7a SMC: 19、Phase 7b ChartPattern: 18、Phase 7c Wyckoff: 20) |

---

## 2. 採用構成

```
EvolutionLoop (将来) / Lens 評価経路
   ↓ /v1/indicator-series { includeWyckoff: true, includeSmc: true (推奨) }
analysis-engine
   ├─→ compute_smc_structures(df) → SmcStructuresPayload     (Phase 7a)
   ↓
   ├─→ compute_wyckoff_phases(df, smc_context=smc_payload)  ★ SMC context 連携
   │   → WyckoffPhasesPayload (phase 判定精度が向上)
   ↓ IndicatorSeriesResponse.wyckoff
side-b LensInput.precomputedWyckoffPhases = payload
   ↓ WyckoffLens.compute(input)
LensFeature.features = {
  wyckoff_phase: enum (7 values),
  wyckoff_phase_confidence: number (0-1),
  spring_detected_in_last_20_bars: boolean,
  upthrust_detected_in_last_20_bars: boolean,
  last_sos_bars_ago: number (sentinel -1),
  last_sow_bars_ago: number (sentinel -1),
}
```

---

## 3. Wyckoff Phase 判定アルゴリズム (Phase 7c 簡素化版)

`compute_wyckoff_phases` の phase 判定は **trend slope + SMC structure event** の組合せで決定:

### 3.1 Trend slope の分類

直近 30 本の close 系列の相対傾き (= slope / avg) で:

| slope 値 | 状態 |
|---|---|
| `> 0.5%` | strong_up |
| `0.05% 〜 0.5%` | weak_up |
| `\|slope\| < 0.05%` | flat |
| `-0.05% 〜 -0.5%` | weak_down |
| `< -0.5%` | strong_down |

### 3.2 SMC context (Phase 7a) との組合せ

| trend | SMC event | 判定 phase | confidence |
|---|---|---|---|
| strong_up | BOS_BULL | MARKUP | 0.85 |
| strong_down | BOS_BEAR | MARKDOWN | 0.85 |
| flat | CHOCH_BULL | RE_ACCUMULATION | 0.65 |
| flat | CHOCH_BEAR | RE_DISTRIBUTION | 0.65 |
| flat (CHOCH なし) + DISCOUNT zone | (any) | ACCUMULATION | 0.55 |
| flat (CHOCH なし) + PREMIUM zone | (any) | DISTRIBUTION | 0.55 |
| strong_up + 不整合 SMC event | — | MARKUP | 0.55 (低 confidence) |
| strong_down + 不整合 | — | MARKDOWN | 0.55 |
| weak_up | — | ACCUMULATION | 0.45 |
| weak_down | — | DISTRIBUTION | 0.45 |
| その他 | — | UNKNOWN | 0.3 |

### 3.3 SMC context なしの動作

`smc_context: None` でも基本判定は動く。SMC structure event を `'NONE'` として扱い、trend slope + (SMC zone が無いため) UNKNOWN への落ち込みが多くなる。Phase 7a / 7c 両方有効化すると精度が上がる設計。

### 3.4 シグナル検出

- **Spring** (直近 20 bars): swing low を一時的に割って戻る candle 検出
- **Upthrust** (直近 20 bars): swing high を一時的に超えて戻る candle 検出
- **SOS / SOW**: 直近 30 bars 内で 5-bar 上昇 / 下降 impulse + 高 volume (volume 列があれば)
- volume 列なしでも基本判定は動く (= impulse 強度のみで判定、簡素化)

---

## 4. Phase 7a + 7b 知見の継続適用

Phase 7c では、Phase 7a (Copilot review #186) と Phase 7b (Copilot review #189) で学んだ self-review checklist を **最初から適用**:

| 項目 | Phase 7c 実装での適用 |
|---|---|
| Node 側 Zod スキーマ同時拡張 | ✅ `AnalysisEngineWyckoffPhasesPayloadSchema` を本 PR で追加 (silently strip 防止) |
| `dependencies` は実際に使う field のみ | ✅ `['symbol', 'precomputedWyckoffPhases']` のみ (ohlcvBars 不要) |
| import path は `'../../lenses/...'` convention | ✅ |
| sentinel と実データの区別を明記 | ✅ `last_sos_bars_ago` / `last_sow_bars_ago` は `-1` sentinel、enum / boolean 系は `confidence === 0` で判定推奨を docstring 明記 |
| pandas idxmax の位置混在を避ける | ✅ `compute_wyckoff_phases` は idxmax を使わない実装 (numpy / list comprehension) |
| magic number はモジュール定数で表現 | ✅ `IMPULSE_STRENGTH_MULTIPLIER = 2.0` 等、Phase 7c 固有の定数を冒頭でまとめて定義 |
| pivot 系列を扱う検出関数にはリセンシー制約 | ✅ Spring / Upthrust は `SPRING_UPTHRUST_LOOKBACK = 20` で末尾近傍に限定、SOS / SOW は `SOS_SOW_LOOKBACK = 30` |
| dead parameter / dead code 整理 | ✅ 本実装では発生せず (Phase 7b で学んだ予防策により) |
| docstring と実装の同期 | ✅ phase 判定アルゴリズムを §3 で明文化、コードコメントと一致 |

Phase 7a → 7b → 7c で **Copilot 指摘件数を段階的に減らす** ことを目指している。

---

## 5. KICKOFF §6.3 Phase 7c DoD 対応

| # | DoD | 対応 |
|---|---|---|
| 1 | `compute_wyckoff_phases` が analysis-engine に追加 (SMC 結果を optional input) | ✅ `analysis-engine/app/wyckoff.py`、`smc_context: Optional[SmcStructuresPayload]` を受け取る |
| 2 | `WyckoffLens` が `Lens` interface を実装 | ✅ |
| 3 | `defaultLensAggregator` 登録 | ✅ `registerDefaultLenses` に追加 |
| 4 | §5.4 features (phase / Spring / Upthrust / SOS / SOW) が出力される | ✅ 全 6 features |
| 5 | 単体テスト 7+ cases pass | ✅ **20 cases** pass (DoD 最低 7 を大幅超過) |
| 6 | 既存 Lens テスト + Phase 7a + 7b テスト全 pass | ✅ 295/295 PASS |
| 7 | `npm run build` green、`npx jest` green | ✅ |
| 8 | `phase_7c_wyckoff_notes.md` 作成 | ✅ 本書 |
| 9 | 既存不可侵領域 (pdcaLoop / agentMemory / skills / 他 Lens 本体 / prisma) git diff ゼロ | ✅ |

---

## 6. 変更ファイル一覧

| ファイル | 内容 | 行数 |
|---|---|---|
| `analysis-engine/app/wyckoff.py` | 新規。`compute_wyckoff_phases(df, smc_context)` 等 SMC 連携 phase 判定 + シグナル検出 | ~280 |
| `analysis-engine/app/schemas.py` | 追記。`WyckoffPhasesPayload` クラス、`IndicatorSeriesRequest.includeWyckoff`、`IndicatorSeriesResponse.wyckoff` | +60 |
| `analysis-engine/app/main.py` | 追記。`from app.wyckoff import compute_wyckoff_phases` + `/v1/indicator-series` で `req.includeWyckoff` 時の処理 (smc_payload を引数で渡す) | +7 |
| `src/schemas/external/analysisEngine.ts` | 追記。`AnalysisEngineWyckoffPhasesPayloadSchema` 新規、Request `includeWyckoff` / Response `wyckoff` | +35 |
| `src/side-b/lenses/types.ts` | 追記。`WyckoffPhasesPayload` interface、`LensInput.precomputedWyckoffPhases` | +50 |
| `src/side-b/lenses/WyckoffLens.ts` | 新規。`WyckoffLens` クラス、`WYCKOFF_LENS_FEATURE_KEYS`、内部 helper | ~115 |
| `src/side-b/lenses/index.ts` | 追記。WyckoffLens の export + registerDefaultLenses への登録 | +7 |
| `src/side-b/tests/lenses/WyckoffLens.test.ts` | 新規。WyckoffLens 単体テスト 20 cases | ~250 |
| `docs/design/phase_7c_wyckoff_notes.md` | 新規。本書 | (本書) |

既存実装の改変は **ゼロ** (Phase 7a / 7b と同じく不可侵領域厳守)。

---

## 7. Phase 7 完了処理への引き継ぎ事項 (= 次の作業)

Phase 7 全 3 サブフェーズ (7a / 7b / 7c) が完了。次は Phase 7 完了処理:

### 7.1 作成する文書

- `docs/design/phase_7_summary.md` (新規) — Phase 7 全体総括
  - 3 Lens 追加 (SMC / ChartPattern / Wyckoff) + PatternLens 無改変の最終状況
  - 主要方針 (analysis-engine + side-b 2 層、Node Zod 同時拡張、sentinel 設計、SMC 連携)
  - 各 Phase の数値スナップショット (テスト数、features 数)
  - Step 4 (ADK ParallelAgent dry-run) への引き継ぎ事項

### 7.2 更新する文書

- `docs/design/phase_7_specification.md` (既存)
  - **§5.3 / §12.1** — PatternLens rename を実施しなかった旨を反映 (user 判断 2026-05-14)
  - 各 Phase 完了マーク
- `docs/design/phase_6_specification.md` §9.1 (既存) — Phase 7 完了反映
- `docs/architecture/ADK_ADOPTION.md` (既存) — §3 ロードマップで Phase 7 完了、Step 4 着手前提として記載

### 7.3 Step 4 (ADK ParallelAgent dry-run) との関係

Phase 7 完了で Lens カバレッジは:

| Lens | lensName | dependencies | 由来 |
|---|---|---|---|
| CurrentAnalysisLens | current_analysis | ohlcv | Phase 1 |
| TimeSessionLens | time_session | symbol | Phase 1 + PR ⑤D-1 |
| DowTheoryLens | dow_theory | ohlcvBars | Phase 3 |
| VolatilityRegimeLens | volatility_regime | ohlcvBars | Phase 3 |
| PatternLens | pattern (基本=ローソク足) | precomputedPatternFlags | PR ②-1 / PR ④F |
| **SMCLens** | smc | precomputedSmcStructures | **Phase 7a** |
| **ChartPatternLens** | chart_pattern (応用=N-bar) | precomputedChartPatterns | **Phase 7b** |
| **WyckoffLens** | wyckoff | precomputedWyckoffPhases | **Phase 7c** |

**全 8 Lens** が `defaultLensAggregator` に登録。Step 4 では ADK `ParallelAgent` で 8 Lens を並列観測する dry-run wrapper を構築する。

### 7.4 Phase 7 完了前にまとめて検証する項目 (Step 4 着手前)

Phase 7a NOTES §6.3 / Phase 7b NOTES §8.4 で挙げた未実施項目:
- analysis-engine の E2E 動作確認 (Docker 起動 + curl で SMC / ChartPattern / Wyckoff endpoint)
- Python 単体テスト infra の整備
- `IndicatorSeriesByVersionRequest` への `includeSmc` / `includeChartPatterns` / `includeWyckoff` 拡張
- DSL Evaluator での Phase 7 features 参照互換性確認

これらは Phase 7 完了処理 PR で **「Step 4 着手前 TODO」** として `phase_7_summary.md` に明記する。

---

## 8. Phase 7a → 7b → 7c のメトリクス比較

知見継承サイクルの効果測定:

| Phase | 新規実装 | テスト数 | Copilot 指摘 | 主要修正テーマ |
|---|---|---|---|---|
| Phase 7a SMC | 6 files / +1112 行 | 19 cases | **7 件** | Node Zod 拡張漏れ (critical) / sentinel 設計 / dependencies / OB 方向制約 / zone docstring 整合 |
| Phase 7b ChartPattern | 8 files / +1232 行 (PatternLens 無改変分含む) | 18 cases | **4 件** | pandas idxmax 位置混在 / magic number / リセンシー制約 / dead parameter |
| Phase 7c Wyckoff | 8 files / +~810 行 | 20 cases | **(PR レビュー前)** | (本書時点で未確定、checklist 全項目を予防的に適用) |

Phase 7c は Phase 7a / 7b の知見をすべて最初から適用しているため、Copilot 指摘ゼロを目指している (PR レビュー結果で実測)。

---

## 9. 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| [`phase_7_specification.md`](./phase_7_specification.md) | Phase 7 KICKOFF (本書は §6.3 の成果物) |
| [`phase_7a_smc_notes.md`](./phase_7a_smc_notes.md) | Phase 7a SMC 実装ノート |
| [`phase_7b_chart_pattern_notes.md`](./phase_7b_chart_pattern_notes.md) | Phase 7b ChartPattern 実装ノート |
| [`lens_elliott_wave_future_design.md`](./lens_elliott_wave_future_design.md) | Phase 8 Elliott Wave 構想 |
| [`phase_6_specification.md`](./phase_6_specification.md) §9.1 | Phase 7 / 8 / 9 スコープ整合 |
| [`/AGENTS.md`](../../AGENTS.md) | ドメイン原則 §4 (Lens 独立・純粋・決定性) |
| [`/src/side-b/lenses/WyckoffLens.ts`](../../src/side-b/lenses/WyckoffLens.ts) | Phase 7c 実装本体 |
| [`/analysis-engine/app/wyckoff.py`](../../analysis-engine/app/wyckoff.py) | Python 側 Wyckoff phase / signal 検出 |
