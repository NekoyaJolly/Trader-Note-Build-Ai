# G2 — Side-B validation/confirmation pipeline 詰まり調査 (2026-05-18)

> **位置づけ**: Last-Mile 探索 2026-05-18 セッションで発見した「BT 通過 91% でも confirmed 1 件」現象の **判断材料 audit**。Neko さん判断のための一覧化。修正提案ではない。
> **依頼源**: Neko さん 2026-05-18「関係するプロンプトと各ステータスに通るためのそれぞれの基準を一覧にして、入力と出力が問題ないかも確認必要」
> **対応 PR**: 本ファイルは Wave 1 PR とは別物 (議論材料、Wave 3 着手前の判断 input)
> **関連**: `vendor/last-mile-context/` 配布物 / `.last-mile/runs/03-validation-execution-broken/` / `.last-mile/runs/05-evolution-history-illegible/`

---

## 0. ⚠️ 前提崩れの警告 (2026-05-18 18:00 追記)

Neko さん指摘により本 audit の §1 / §6.1〜§6.3 の数値は **誤解を招く** ことが判明:

- 集計対象は **過去 7-14 日蓄積 (Discovery 自動挿入由来データ込み)** であり、現状の pipeline 流量を反映していない
- Discovery 経路は **2026-05-16 にコード削除済** (`DiscoveryAgent.ts §STEP 5 Phase D`)
- 「BT 通過 91% でも confirmed 1 件」は **「もう作られない戦略の残骸込みの平均値」**
- これに基づく Hypothesis A (確定基準厳しい) / B (screening 緩い) / C (経路バグ) の議論は **前提から組み直し要**

**真の現状は §6.4 (= 2026-05-17 以降の純粋集計) を見るべし**。Hypothesis D (analysis-engine 不通) の重みが大幅に増した。

---

## 1. 出発点 — 数値の矛盾

DB 集計 (2026-05-18 時点):

| メトリクス | 値 |
|---|---|
| `EdgeHypothesis.total` | **735** |
| 直近 7 日生成 | 654 (94%) |
| status=`screening_passed` | **323 (44%)** |
| status=`not_testable` | **288 (39%)** |
| status=`rejected` | 117 (16%) |
| status=`unverified` | 6 (1%) |
| **status=`confirmed`** | **1 (0.1%)** |
| `EvolutionBacktestRun.total` | 886 |
| `EvolutionBacktestRun.formalBtPassed=true` | **807 (91%)** |
| `GenerationLesson.category='breakthrough'` | 115 |
| `GenerationLesson.category='stagnation'` | 112 |

**ミスマッチ**: BT 通過 91% / breakthrough 115 件あるのに `confirmed=1`、`stagnation=112` と整合。**生成・検証は動くが最終確定で 99%+ 弾かれている**。

---

## 2. EdgeStatus ライフサイクル

`src/side-b/models/edgeHypothesis.ts` で定義される 8 値:

| status | 意味 | 入口 (writer) |
|---|---|---|
| `unverified` | 初期登録、未検証 | EdgeLedger.create() (= aiOrchestrator.ts:427) |
| `screening_passed` | 事前スクリーニング通過 | ScreeningOrchestrator.runScreening → markScreeningPassed |
| `testing` | 本格検証中 (Phase 4c) | StrategistAgent.evaluate → markTesting |
| `confirmed` | 本格検証 4ツール通過 (Phase 4c) | StrategistAgent.evaluate → markConfirmedFull (EdgeLedger:584) |
| `not_testable` | データ不足 / engine 通信失敗 | ScreeningOrchestrator (3 経路) + StrategistAgent (2 経路) |
| `insufficient_data` | Phase 4b 検証データ不足保留 | StrategistAgent.buildVerdict |
| `rejected` | 棄却 | StrategistAgent → markRejectedFull (EdgeLedger:608) |
| `stale` | 劣化 | StatusManager.shouldMarkStale → markStale |

### 遷移マップ

```
        ┌─────────────┐
        │ unverified  │ ← EdgeLedger.create() (24h hardlimit guard 後段)
        └──────┬──────┘
               ↓ ScreeningOrchestrator.runScreening
        ┌─────────────────────────────────┐
        │  Side-A BT (analysis-engine)    │
        └──────┬──────────────────────────┘
               ↓ canPromoteToScreeningPassed(metrics)
               ├─────────────→ screening_passed (323件)
               ├─────────────→ not_testable (288件、5経路キャッチオール)
               └─────────────→ rejected (117件)
                        ↓ StrategistAgent.evaluate
                        ↓ BacktesterAgent (4ツール)
                        ↓ canPromoteToConfirmedFull(report)
                        ├─────────────→ confirmed (1件)
                        └─────────────→ rejected
```

---

## 3. 昇格判定基準 — 一覧

### 3.1 SCREENING_THRESHOLDS (`canPromoteToScreeningPassed`)

`src/side-b/ledger/statusManager.ts:49`

| 項目 | 閾値 | 備考 |
|---|---|---|
| PF (Side-A BT) | `> 1.1` | 2026-05-02 PR #76 で 1.3→1.1 暫定緩和、勝率撤廃 |
| トレード数 | `>= 20` | 統計的有意性最低限 |

### 3.2 PROMOTION_THRESHOLDS (`canPromoteToConfirmed` Phase 4a)

`src/side-b/ledger/statusManager.ts:23` — **現在 production では呼ばれていない**可能性 (Phase 4c で `canPromoteToConfirmedFull` に置換済)

| 項目 | 閾値 |
|---|---|
| 学習期間 PF (avgInSamplePF) | `>= 1.5` |
| 検証期間 PF (avgOutOfSamplePF) | `>= 1.3` |
| 過学習スコア | `< 0.3` |
| 総トレード数 | `>= 20` |

### 3.3 `canPromoteToConfirmedFull` (Phase 4c 本格検証)

`src/side-b/ledger/statusManager.ts:195` — **現在実運用されている confirmation logic**

5 条件すべてが true で `ok=true`:

| # | 条件 | 失敗時 reason |
|---|---|---|
| 1 | `report.screening.passed === true` | 事前スクリーニング未通過 |
| 2 | `report.walkForward.passed === true` (overfitScore < 0.3 相当) | 過学習スコア超過 |
| 3 | `report.monteCarlo.passed === true` (下側 5%PnL > 0 相当) | MC 判定失敗 |
| 4 | `report.buyAndHold.passed === true` (BH 比 +0.5% 以上相当) | BH 未超過 |
| 5 | `report.screening.tradeCount >= MIN_TRADE_COUNT` | トレード数不足 |

**各ツールの `passed` 判定は個別ツール内で行う** (= `runScreening` / `walkForwardService` / `monteCarloService` / `buyAndHoldService`)。本メソッドは「走ったか + 通ったか」だけ判定。

### 3.4 not_testable 5 経路 (キャッチオール、現状 288 件)

| 経路 | 場所 | 発火条件 |
|---|---|---|
| ScreeningOrchestrator.A | `bridge/ScreeningOrchestrator.ts:160` | 仮説に `symbols` 未設定 |
| ScreeningOrchestrator.B | `bridge/ScreeningOrchestrator.ts:168` | OHLCV 補完失敗 |
| ScreeningOrchestrator.C | `bridge/ScreeningOrchestrator.ts:195` | analysis-engine 通信エラー |
| StrategistAgent.A | `agents/StrategistAgent.ts:108` | `screeningBacktestRunId` 不在 (= screening 未通過 or BT 失敗) |
| StrategistAgent.B | `agents/StrategistAgent.ts:120` | BacktesterAgent 実行失敗 |

→ **5 経路すべて「データ・通信の失敗」**。ロジックの「弾き」ではなく「動かなかった」のキャッチオール。288 件あるのは **analysis-engine 不通 / OHLCV カバレッジ不足の集積**を示唆。

---

## 4. 関係プロンプト一覧

`src/side-b/prompts/` 内、本フローに関わるもの:

| プロンプト | 役割 | 呼び出し元 |
|---|---|---|
| `hypothesis_generator.md` | **仮説生成 (= EdgeHypothesis 発生源)** | HypothesisGeneratorAgent → aiOrchestrator:425 |
| `strategy_thinker.md` | 戦略選択・シナリオ化 | Strategy Thinker (aiOrchestrator 後半) |
| `bull_bear_debate.md` | 仮説の対立検証 | BullBearDebate (aiOrchestrator:449) |
| `devils_advocate.md` | 仮説への反証 | Devils Advocate |
| `strategist.md` | confirmed/rejected の解釈生成 | StrategistAgent (確定判定は logic 側、LLM は解釈のみ) |
| `discovery.md` | 週次レンズ調査 (hints のみ、仮説生成しない) | DiscoveryAgent (2026-05-16 以降 hints のみ) |
| `generation_reflection.md` | 世代ごとの学び生成 | GenerationReflectionAgent (= GenerationLesson writer) |
| `reflection.md` | PDCA reflection | PDCALoop |
| `mutation.md` / `crossover.md` / `prompt_mutation.md` | Evolution loop の変異/交叉 | EvolutionLoop |
| `meta_evolution.md` | メタレベル進化 | EvolutionLoop |
| `research.md` | 市場リサーチ | aiOrchestrator |
| `agent_loop_default.md` | エージェントループ既定 | 各種 |
| `__global__.md` / `__specialist_common__.md` | 共通文脈 | 全 prompt の前置 |

**G2 議論の中心**:
- `hypothesis_generator.md` → 生成された仮説の品質
- `strategist.md` → 確定判定 LLM 解釈 (logic で弾かれた場合の文脈解説)
- `canPromoteToConfirmedFull` の 4 ツール (screening/WF/MC/BH) → 各 passed 判定がどこで失敗してるかが key

---

## 5. 入出力スキーマ (= 型定義の参照ポイント)

修正方針議論の前に確認すべき型定義:

| 概念 | 型/Zod schema | 場所 |
|---|---|---|
| EdgeHypothesis (DB 行) | `EdgeHypothesis` type | `src/side-b/models/edgeHypothesis.ts` |
| 仮説生成 LLM 入出力 | `HypothesisGeneratorOutput` zod | `src/side-b/agents/HypothesisGeneratorAgent.ts` |
| Screening Metrics | `ScreeningMetrics` | `src/side-b/models/edgeHypothesis.ts` |
| Screening Result | `ScreeningResult` | 同上 |
| 4ツール統合レポート | `ConsolidatedValidationReport` | 同上 |
| WalkForward Summary | `WalkForwardSummary` | 同上 |
| EvolutionBacktestRun | Prisma schema | `prisma/schema.prisma:740` |
| GenerationLesson | Prisma schema | `prisma/schema.prisma:789` |

---

## 6. 現状の DB 実数値 (snapshot, 2026-05-18)

### 6.1 EdgeHypothesis 直近 3 日生成

| 日 | source=ai_generated | source=discovery |
|---|---|---|
| 2026-05-17 | **12** | 0 (= コード削除済) |
| 2026-05-15 | 5 | 217 (= 削除直前バースト) |
| 2026-05-14 | 0 | 22 |

### 6.2 EvolutionBacktestRun

| メトリクス | 値 |
|---|---|
| total | 886 |
| formalBtPassed=true | 807 (91%) |

**矛盾**: 91% が BT 通過してるのに `EdgeHypothesis.confirmed=1`。`EvolutionBacktestRun.formalBtPassed` の判定基準と `canPromoteToConfirmedFull` の関係を要確認 (= 別系統の昇格パイプラインか? それとも EvolutionBacktestRun→EdgeHypothesis への変換段で大量失敗してるか?)

### 6.3 GenerationLesson 分布

| category | n |
|---|---|
| other | 181 |
| breakthrough | 115 |
| stagnation | 112 |
| novelty_emerged | 1 |
| mutation_decay | 1 |

→ breakthrough と stagnation がほぼ均衡。`novelty_emerged` / `mutation_decay` 検出がほぼ機能していない (1 件ずつ)。

### 6.4 ⭐ Discovery 削除後 (2026-05-17 以降) の純粋集計

§0 警告に対応する、現状の pipeline 流量だけを切り出した集計 (`createdAt >= 2026-05-17`):

| メトリクス | 値 | 解釈 |
|---|---|---|
| EdgeHypothesis 総数 | **15** | 24h あたり 12 件で量産問題なし |
| status=`not_testable` | **12 (80%)** | **screening でほぼ全部 not_testable に落ちている** |
| status=`rejected` | 3 (20%) | |
| status=`screening_passed` | **0** | **screening 自体が機能していない兆候** |
| status=`confirmed` | **0** | |
| source=`ai_generated` | 15 | 全件 HG 経由 (discovery は 0) |
| EvolutionBacktestRun 総数 | 17 | |
| EvolutionBacktestRun.formalBtPassed | **14 (82%)** | **Evolution 側は走っており passed もしている** |
| GenerationLesson | other 14 / stagnation 8 / breakthrough 6 | |

**新事実**:
- 過去蓄積データを除外すると、**screening_passed=0 / confirmed=0** = pipeline 詰まりじゃなく **screening 経路で全部 not_testable に落ちている**
- 一方 `EvolutionBacktestRun.formalBtPassed=82%` = **Evolution 側の BT は走っており通る**
- = **`ScreeningOrchestrator` 経路と `EvolutionLoop` 経路で analysis-engine 接続性が違う可能性**、もしくは **`ScreeningOrchestrator` だけが OHLCV カバレッジ不足 / symbols 未設定で全部弾かれている**

**Hypothesis D (analysis-engine 不通) の重みが大幅に増した**。Hypothesis A/B/C は過去データ蓄積の影響で誤解しやすい構造になっていた。

---

## 7. 議論ポイント (Neko 判断材料)

### Hypothesis A: 「最終確定基準 (`canPromoteToConfirmedFull`) が厳しすぎる」

- 5 条件すべて pass が要件 (screening + WF + MC + BH + tradeCount)
- 各ツールの `passed` 閾値が個別に厳しい
- **確認方法**: status=`screening_passed` の 323 件のうち、`fullValidationReport` を持つ仮説でどのツールが最も落としてるかを集計 → 一番落としてるツールを緩和候補にする
- **緩和の方向性**: 暫定的に AND 条件を OR に近づける、または「3/4 通過で confirmed」のような中間判定を追加

### Hypothesis B: 「BT 通過基準 (`canPromoteToScreeningPassed`) が緩すぎて、screening_passed が誇張されている」

- 2026-05-02 PR #76 で minPF: 1.3→1.1 に緩和、勝率撤廃済
- 結果として `screening_passed=323` 件を生成 → 4 ツール検証で 322 件落ちる
- **確認方法**: `screening_passed` の 323 件の PF / tradeCount 分布を出して、minPF=1.3 / 1.5 に戻したら何件残るかをシミュレート
- **戻しの方向性**: PF=1.3 (撤廃前) or 1.5 (本昇格基準) に再強化

### Hypothesis C: 「中間の昇格 logic がバグってる」

- screening_passed → testing → confirmed の遷移経路の途中で skip 漏れ / 状態不整合
- `EvolutionBacktestRun.formalBtPassed=true (807件)` が `EdgeHypothesis.confirmed=1` に反映されていない経路問題
- **確認方法**: `aiOrchestrator.ts` で `EvolutionBacktestRun` (= Evolution パス) と `EdgeHypothesis` (= screening/confirmation パス) がどう連結してるか追跡。`evolutionRunId` ↔ `hypothesisId` の対応を確認
- **修正の方向性**: 経路ごとの責務切り分け or 経路間のデータフロー実装

### Hypothesis D: 「analysis-engine 不通で 4 ツール検証自体が走ってない」

- not_testable=288 件のうち何件が analysis-engine 通信エラー由来か
- 仮に 4 ツール検証の前段で死ぬケースが多ければ、A/B/C の議論より先に **analysis-engine 起動状態** を疑う
- **確認方法**: dev / production で analysis-engine がアクティブかを確認 + `ScreeningOrchestrator.runScreening` の `not_testable` reason を分類集計
- **修正の方向性**: analysis-engine 監視 + retry / circuit-breaker

---

## 8. 推奨次アクション

Neko さん判断のための「優先順序の高い確認」:

1. **Hypothesis D 確認** (= 環境健全性): analysis-engine が動いてるか、`not_testable` reason 分類集計 — **コスト極小**
2. **Hypothesis A 確認** (= 4 ツール内訳): `fullValidationReport` 保持仮説でどのツールが最も落としてるかの集計 — **コスト小**
3. **Hypothesis B 確認** (= screening PF 分布): `screening_passed` 323 件の PF 分布シミュレート — **コスト小**
4. **Hypothesis C 確認** (= 経路追跡): EvolutionBacktestRun ↔ EdgeHypothesis の関連性 — **コスト中**

D/A/B/C の結果を見てから、Wave 3 修正方針を確定する。

---

## 9. 関連 Bundle / コード参照

- Bundle 03: `.last-mile/runs/03-validation-execution-broken/`
- Bundle 05: `.last-mile/runs/05-evolution-history-illegible/`
- statusManager: `src/side-b/ledger/statusManager.ts`
- ScreeningOrchestrator: `src/side-b/bridge/ScreeningOrchestrator.ts`
- StrategistAgent: `src/side-b/agents/StrategistAgent.ts`
- aiOrchestrator (生成→検証パイプライン入口): `src/side-b/orchestrator/aiOrchestrator.ts`
- EdgeLedger CRUD: `src/side-b/ledger/EdgeLedger.ts`
- 規約: `docs/architecture/LAST_MILE_INTEGRATION.md` §5
