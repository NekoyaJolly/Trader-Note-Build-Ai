# Critical-4 設計議論: BT 一本化 + Python BT ライブラリ統合

**作成日時**: 2026-05-02 朝  
**目的**: BT 系統を「ストラテジー側 + Python BT ライブラリ」に一本化する設計議論のたたき台。Nekoさん 判断後に段階 1〜4 の実装着手。

---

## §1 役割の再定義(本設計の出発点)

| 概念 | 本来の役割 | BT との関係 |
|---|---|---|
| **ノート**(TradeNote / AITradeNote) | 過去トレードの **記録・振り返り** ツール(出発点: 「トレードノートを書く習慣の自動化」) | **無関係**(ノート単体で BT する必要なし) |
| **ストラテジー**(Strategy / StrategyDSL) | **BT 対象**、戦略の検証可能な表現 | **これが BT の唯一の入口** |
| **BT** | MT5 デフォルト相当の品質を目指す **アプリの基盤** | ストラテジー側のみ |
| **仮説**(EdgeHypothesis) | AI が生成する戦略候補 | DSL 化 → 戦略 BT で検証 |

### 経路の整理

```
人間トレード CSV → ノート化(振り返り)→ 類似性チェック → ユーザー通知
                                                     [BT 不要]

仮想トレード生成 → AITradeNote(振り返り)
                       [BT 不要]

仮説生成(HG)→ DSL 化 → 戦略 BT で screening → screening_passed
              ↑
        段階 1 で本来あるべき姿に整える対象
```

---

## §2 現状の 2+1 系統 BT 構造

### 並列に存在する 2 系統

| 系統 | 場所 | テーブル | 現在の使用状況 |
|---|---|---|---|
| **(a) ノート経由 BT** | `src/services/backtestService.ts:execute()` | `BacktestRun` | ❌ screening が誤って使用中 / 動作不安定の疑い |
| **(b) 戦略経由 BT(自前 TS)** | `src/backend/services/strategyBacktestService.ts:runBacktest()` | `StrategyBacktestRun` | ⚠️ `walkForwardService` のみ使用、ほぼ未稼働 |
| **(c) DSL ベース BT(自前 TS)** | `src/side-b/strategy_dsl/dslBacktestSimulation.ts` (21KB) | (DB 永続化なし、メモリ上のみ) | ⚠️ Phase 6.7b で部分実装、`StrategyBacktesterAgent` が呼び出すがメモリ上のみ |

### Python 側の既存基盤(BT 未実装)

| 場所 | 実装内容 |
|---|---|
| `python/walk_forward/walk_forward.py` | WF 統計分析(stdlib のみ、vectorbt 不使用) |
| `python/Dockerfile` | Python 3.11-slim、常駐コンテナ + docker exec |
| `python/docker-compose.yml` | コンテナ運用設定(本番 HTTP モードも対応) |
| `src/side-b/validation/python_bridge/PythonBridge.ts` | TS → Python の薄いブリッジ(docker_exec / HTTP 両対応) |
| `analysis-engine/` | 指標計算サービス(pandas / numpy / pandas_ta、BT は実装していない) |

→ **Python BT ライブラリ(vectorbt / backtesting.py)は未導入**。BT 本体は全て TS 自前実装。

### 24h 観測(PR #74 §7)

- `BacktestRun` テーブル: **0 行**
- `StrategyBacktestRun` テーブル: **0 行**
- screeningResult JSON には `backtestRunId` が記録されているが、対応する `BacktestRun` は存在しない

→ ノート経由 BT (a) で永続化バグがあるが、本設計議論で (a) は段階 3 で廃止予定のため、応急修正は **不要**。

---

## §3 移行戦略 4 段階

### 段階 1: screening 経路を DSL → 戦略 BT に切り替え

**現状**:
```
ScreeningOrchestrator
  → MaterializationService.materializeForValidation()
  → TradeNote 生成
  → backtestService.execute({ noteId, ... })  // ノート経由 BT
  → BacktestRun 保存(空のまま)
```

**目標**:
```
ScreeningOrchestrator
  → DSLConverter.convertHypothesisToDSL()  // 新規(または既存 dslEdgeMapper の拡張)
  → StrategyDSL 生成
  → strategyBacktestService.runBacktest({ strategyId, ... })  // 戦略経由 BT
  → StrategyBacktestRun 保存
```

**触るファイル**:
- 新規: `src/side-b/bridge/DSLConverter.ts`(または既存 `dslEdgeMapper.ts` を拡張)
- 改修: `src/side-b/bridge/ScreeningOrchestrator.ts`(`MaterializationService` → `DSLConverter` に)
- 廃止予告: `src/side-b/bridge/MaterializationService.ts`(段階 3 で完全廃止)

**残すもの**:
- `MaterializationService` の TradeNote 生成パス自体(振り返り用、別経路で生き続ける)
- ノート機能全般

**廃止するもの**:
- screening が `MaterializationService` を呼ぶ依存関係のみ(MaterializationService 自体ではない)

### 段階 2: StrategyBacktesterAgent (Phase 6.7b) DB 永続化追加

**現状**:
- `StrategyBacktesterAgent.run()` が DSL BT を実行
- 結果は `AITradePlanWithOptionalBacktest.strategyBacktest` フィールドにメモリ上で保持
- DB 永続化なし

**目標**:
- `StrategyBacktesterAgent` が `StrategyBacktestRun / Result / Event` テーブルに保存
- AITradePlan からも `backtestRunId` で参照可能に

**触るファイル**:
- `src/side-b/agents/StrategyBacktesterAgent.ts`: DB 永続化呼び出し追加
- 必要なら `strategyBacktestService.ts` のヘルパー利用 or 新規 helper

### 段階 3: ノート側 BT (a) を廃止

**前提**: 段階 1 で screening が依存しなくなっている

**廃止対象**:
- `src/services/backtestService.ts:execute / getResult / etc.`
- `BacktestRun / BacktestResult / BacktestEvent` テーブル(完全廃止 or 履歴保持で deprecate)
- `BacktestRepository`(関連メソッド削除)
- `MaterializationService` の TradeNote 生成パス(他で使われていなければ完全廃止)

**確認事項**:
- `src/services/backtestService.ts` の他の呼び出し元(grep で全部洗い出して影響範囲確認、本 PR §5 参照)
- `BacktestRun` テーブルを参照している UI / API / レポート機能の有無

### 段階 4: 戦略 BT 本体を Python BT ライブラリに切り替え

**現状**: `dslBacktestSimulation.ts`(21KB)+ `strategyBacktestService.ts:runBacktest`(自前 TS)

**目標**: `backtesting.py` ライブラリで実装した BT エンジンに置き換え

**触るファイル**:
- 新規 `python/backtest/backtest.py`(ライブラリ呼び出しと結果整形)
- 新規 `python/backtest/__init__.py`
- 改修 `python/requirements.txt`(`backtesting` 追加)
- 改修 `src/side-b/strategy_dsl/DSLBacktestAdapter.ts`(PythonBridge 経由呼び出しに切り替え、または新規ラッパー)
- 改修(or 廃止) `src/side-b/strategy_dsl/dslBacktestSimulation.ts`
- 改修(or 廃止) `src/backend/services/strategyBacktestService.ts:runBacktest`(WalkForward 用ラッパーに縮小)

**詳細は §7, §8 参照**。

---

## §4 ノート機能の維持(BT と独立)

本設計で **触らない**:
- 人間トレード CSV → `tradeImportService` → `tradeNoteService` の経路
- AI 仮想トレード → `aiNoteService` → `AITradeNote` の経路
- ノート間類似性チェック (`crossSimilarityService`)
- ノート → ユーザー通知 (`notificationService` / `simultaneousHitControlService`)

これらは BT と独立した機能で、本設計対象外。

---

## §5 影響範囲(段階別、限定的)

### 段階 1(screening 経路切り替え)

| カテゴリ | 影響 |
|---|---|
| 新規ファイル | 1〜2(DSLConverter) |
| 改修ファイル | 1(ScreeningOrchestrator) |
| 廃止予告 | 0(MaterializationService は段階 3 で廃止) |
| テスト | 既存の screening test を更新 + DSLConverter test 追加 |
| DB スキーマ | 変更なし(`StrategyBacktestRun` を使うだけ) |

### 段階 2(StrategyBacktesterAgent DB 永続化)

| カテゴリ | 影響 |
|---|---|
| 改修ファイル | 1(StrategyBacktesterAgent) |
| 既存利用箇所 | aiOrchestrator(Plan 生成時) |
| DB スキーマ | 変更なし(`StrategyBacktestRun` 使用) |

### 段階 3(ノート側 BT 廃止)

| カテゴリ | 影響 |
|---|---|
| 廃止ファイル | `src/services/backtestService.ts`(全削除) |
| 改修ファイル | `BacktestRepository`(削除)、`backtestController` 等の API 層 |
| DB スキーマ | `BacktestRun / Result / Event` テーブル廃止(マイグレーション要) |
| UI | 古いノート BT 画面があれば削除(要調査) |

### 段階 4(Python BT 統合)

| カテゴリ | 影響 |
|---|---|
| Python 側新規 | `python/backtest/backtest.py`(数百行)、`requirements.txt` 追加 1 行 |
| TS 側改修 | `DSLBacktestAdapter`(PythonBridge 経由化)、`strategyBacktestService.runBacktest`(WalkForward 用ラッパーに縮小) |
| TS 側廃止 | `dslBacktestSimulation.ts`(21KB、機能を Python に移行) |
| インフラ | 既存 Python コンテナを再利用、設定変更不要 |

→ **新規実装の中核は「Python スクリプト 1 個 + TS 薄ラッパー 1 個」程度**

### 触らないもの(全段階共通)

- HG / Specialists / Discovery / Devils / Mutation / Crossover / Meta / PromptMutation / BullBear エージェント
- ノート機能(振り返り、類似性チェック、通知)
- analysis-engine(指標計算)
- WalkForward / MonteCarlo / BuyAndHold(既に Strategy 経由化されている、入力源を切り替えるだけ)
- HG / Strategist / Discovery のプロンプト

---

## §6 段階 1 の実装計画(具体)

### 6.1 新規: `src/side-b/bridge/DSLConverter.ts`

```ts
export class DSLConverter {
    /**
     * EdgeHypothesis から StrategyDSL を生成する。
     * 既存の dslEdgeMapper.dslToMachineConditions の逆方向。
     *
     * 仮説の conditions[] と defaultRiskManagement から、
     * runBacktest が消費可能な StrategyDSL に変換する。
     */
    convertHypothesisToDSL(
        hypothesis: EdgeHypothesis,
        period: { start: string; end: string },
    ): StrategyDSL { /* ... */ }
}
```

### 6.2 改修: `ScreeningOrchestrator`

```ts
// 旧
const materialized = await this.materialization.materializeForValidation(...);
const runId = await this.backtestService.execute({ noteId: materialized.tradeNoteId, ... });
const summary = await this.backtestService.getResult(runId);

// 新
const dsl = this.dslConverter.convertHypothesisToDSL(hypothesis, period);
const result = await this.strategyBacktestService.runBacktest({
    strategyId: dsl.id,
    startDate, endDate, ...
});
const summary = result.summary;
```

### 6.3 既存仮説の screening 結果との互換性

- `screeningResult.backtestRunId` が指す先が `BacktestRun` から `StrategyBacktestRun` に変わる
- 過去の `screeningResult` は `BacktestRun` の ID(段階 3 で廃止予定)を保持し続ける → **記録としては残るが参照不能**
- 段階 3 完了後、過去の `screeningResult` を再 screening するか、メタデータで「旧経路」マークを付ける

### 6.4 テスト

- 既存 `screeningOrchestrator.test.ts` を新経路に対応
- 新規 `dslConverter.test.ts` を作成

---

## §7 BT ライブラリ選定

### 候補比較

| ライブラリ | 特徴 | 学習コスト | 約定モデル | スリッページ | パラメータスイープ | 推奨度 |
|---|---|---|---|---|---|---|
| **`backtesting` (kernc/backtesting.py)** | シンプル、教育的、ドキュメント充実 | 低 | ✅(成行/指値/逆指値) | ✅ | △(独自実装) | ⭐⭐⭐ |
| `vectorbt` | 高速ベクトル化、パラメータスイープ強力 | 高 | △(配列ベース) | △ | ✅(超強力) | ⭐⭐ |
| `backtrader` | 老舗、機能豊富だがメンテ低調 | 中 | ✅ | ✅ | ✅ | ⭐ |
| `bt`(pmorissette/bt) | ポートフォリオ寄り | 中 | △ | △ | △ | (用途違い) |

### 本命: `backtesting.py`

理由:
1. **MT5 デフォルト相当の機能を網羅**: 成行/指値/逆指値、スリッページ、レバレッジ、ロット計算、トレーリングストップ
2. **学習コスト低**: API がシンプル(`Strategy` クラス継承で `init` / `next` 実装)
3. **ドキュメント充実**: 公式ドキュメント + GitHub examples
4. **依存関係軽量**: pandas / numpy / bokeh のみ
5. **常駐コンテナとの相性**: スクリプト実行時間短い、起動オーバーヘッド少ない

### 予備案: `vectorbt`

`backtesting.py` が機能不足(パラメータスイープが現実的速度で動かない等)なら `vectorbt` に切り替え。学習コストは高いが性能は段違い。

### 候補から外した理由

- `backtrader`: メンテ状況低調(2023 年以降 commit 少なめ)
- `bt`: 単一戦略 BT より複数戦略のポートフォリオ評価向け

---

## §8 段階 4 の実装計画(Python BT 統合)

### 8.1 Python 側新規実装

```
python/
├── backtest/
│   ├── __init__.py
│   └── backtest.py          # backtesting.py を呼ぶスクリプト
└── requirements.txt          # 'backtesting' 追加
```

`backtest.py` のスケルトン:
```python
"""
Strategy DSL を受け取って backtesting.py で BT を実行するスクリプト。

入力ペイロード(共有ボリューム経由 JSON):
{
    "strategyDSL": { ... },     # StrategyDSL の JSON 表現
    "ohlcv": [{ "timestamp": ..., "open": ..., ... }, ...],
    "config": {
        "initialCapital": 1000000,
        "leverage": 25,
        ...
    }
}

出力:
{
    "trades": [...],
    "summary": { "pf": ..., "winRate": ..., "tradeCount": ..., ... },
    "equity": [...]
}
"""

import json, sys
import pandas as pd
from backtesting import Backtest, Strategy

# DSL を Strategy クラスに動的展開する関数
def build_strategy_from_dsl(dsl: dict) -> type[Strategy]: ...

if __name__ == '__main__':
    input_path, output_path = sys.argv[1], sys.argv[2]
    payload = json.load(open(input_path))
    StrategyClass = build_strategy_from_dsl(payload['strategyDSL'])
    df = pd.DataFrame(payload['ohlcv']).set_index('timestamp')
    bt = Backtest(df, StrategyClass, **payload['config'])
    stats = bt.run()
    json.dump({
        'trades': stats._trades.to_dict('records'),
        'summary': { ... },
        'equity': stats._equity_curve['Equity'].tolist()
    }, open(output_path, 'w'))
```

### 8.2 TS 側ラッパー

```ts
// src/side-b/strategy_dsl/PythonBacktestAdapter.ts (新規)
export class PythonBacktestAdapter {
    constructor(private bridge = createDefaultPythonBridge()) {}

    async runBacktest(input: {
        strategyDSL: StrategyDSL;
        ohlcv: OHLCVBar[];
        config: BacktestConfig;
    }): Promise<DSLBacktestResult> {
        const result = await this.bridge.execute({
            scriptPath: 'backtest/backtest.py',
            payload: input,
            timeoutMs: 60_000,
        });
        return this.parseResult(result);
    }
}
```

### 8.3 既存 TS 自前 BT の縮小

- `dslBacktestSimulation.ts`: 削除(機能を Python に移行)
- `DSLBacktestAdapter.ts`: 内部実装を `PythonBacktestAdapter` に切り替え
- `strategyBacktestService.ts:runBacktest`: WalkForward の IS/OOS 呼び出し用ラッパーに縮小

### 8.4 検証手順

1. 既存 TS 自前 BT で算出した PF / 勝率と、Python BT で同じ条件・期間で算出した値を比較
2. 差分が大きい場合、約定モデルの違いを調査(スリッページ、約定タイミング等)
3. 単体テスト + 結合テストで網羅

---

## §9 Critical-4 全体ロードマップ

### 順序

```
段階 1 (経路切り替え)
  ↓ screening が StrategyBacktestRun に保存される状態を作る
段階 2 (Phase 6.7b の永続化)
  ↓ AITradePlan 経路の BT 結果も DB に集積
段階 3 (ノート側 BT 廃止)
  ↓ コード単純化、テーブル整理
段階 4 (Python BT 統合)
  ↓ MT5 レベルの BT 品質、TS 自前実装の重複コード削減
```

### 前提条件

- 段階 2 は段階 1 から独立、並行可能
- 段階 3 は段階 1 完了後(依存関係解消後)
- 段階 4 は段階 1〜3 のどこからでも先行着手可能(BT エンジン置換は経路と独立)

### 推奨着手順

1. **段階 1** (1〜2 日): screening 経路切り替え、最も価値が高い(BT 結果の永続化が即実現)
2. **段階 4** (3〜5 日): Python BT 統合、品質向上が即効
3. **段階 3** (1 日): ノート側 BT 廃止、コードクリーンアップ
4. **段階 2** (0.5 日): 永続化追加、AITradePlan 経路で BT が走るタイミングで効く

→ 段階 1 と 4 を本丸として優先。段階 2 / 3 は本丸完了後の整理。

### Out of scope

- ノート機能の改廃(振り返り・類似性チェック・通知は無関係)
- HG / Specialists 等のエージェント改良(Critical-10 別議論)
- screening 閾値調整(PR #76 で対応済み)

---

## §10 残論点(Nekoさん 判断必要)

1. **段階 1 で `MaterializationService.materializeForValidation` を完全廃止するか、TradeNote 生成は残してリファクタするか**
   - ノート機能のために TradeNote 生成自体は他経路で必要かもしれない(要確認)
2. **BT ライブラリは `backtesting.py` で確定で OK か、`vectorbt` の方を本命にするか**
3. **`BacktestRun / BacktestResult / BacktestEvent` テーブルの完全廃止 vs 履歴保持で deprecate**
   - 過去の screening 結果データを残す価値があるか
4. **段階 4 で Python BT に移行する際の検証方法**
   - 既存 TS BT との数値突き合わせをどこまで厳密にやるか
   - 差異が出た場合の許容範囲

---

*作成: Critical-4 (BT 一本化) 設計議論のたたき台。本 PR マージ後、Nekoさん 判断で段階 1 から実装着手する。*

---

## §11 Copilot レビュー指摘への明確化(後日追記)

PR #77 提出後の Copilot レビュー (7 件) で技術的に重要な指摘があったため、設計の精度を上げる方向で以下に明確化する。

### 11.1 「Critical-4」の番号衝突に関する整理

**指摘**: 既存の診断ドキュメント (`docs/diagnostics/orchestration_health_report.md:339-342` / `docs/diagnostics/post_critical_1567_plan.md:176`) では `Critical-4` は「StrategyBacktesterAgent per-plan 結果永続化」を指す。本 docs もタイトルに `Critical-4` を使っているため番号衝突。

**整理**:

本 docs の **段階 2** が、既存ドキュメントの「Critical-4」と同じ対象(`StrategyBacktesterAgent per-plan 結果永続化`)。本 docs はこれを **包含する形で Critical-4 の範囲を再定義** する。

**新しい構造**(以降の参照は本 docs を正とする):

```
Critical-4 (BT 一本化) — 本 docs で再定義
├── Critical-4 §3-1 (旧称: なし) screening 経路を DSL → 戦略 BT に切り替え
├── Critical-4 §3-2 (旧 Critical-4) StrategyBacktesterAgent per-plan 結果永続化
├── Critical-4 §3-3 (旧称: なし) ノート側 BT 廃止
└── Critical-4 §3-4 (旧称: なし) 戦略 BT 本体を Python BT ライブラリに切り替え
```

旧 Critical-4 (per-plan 永続化のみ) を扱っていたチケット/タスクは、本 docs の **段階 2** として読み替える。

### 11.2 段階 1: `runBacktest` の前提整理

**指摘**: 段階 1 の例で `strategyBacktestService.runBacktest({ strategyId: dsl.id, ... })` と書いたが、実装上 `runBacktest` は DB 上の `Strategy`/`StrategyVersion` が存在する前提で `getStrategy(strategyId)` を呼ぶ。DSL 生成だけで `dsl.id` を渡すと失敗する。

**選択肢の比較**:

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| **(a)** | 仮説 → DSL → 一時的に Strategy/Version を DB 永続化 → `runBacktest` を呼ぶ | 既存 `runBacktest` をそのまま使える、WalkForward 等とも整合 | DB に短命 Strategy が増える、cleanup 必要 |
| **(b)** | `DSLBacktestAdapter` (Phase 6.7b、DB 不要) を直接呼んで結果を **新規テーブル**(例: `ScreeningBacktestRun`)に保存 | DB Strategy を作らない、軽量 | 永続化テーブル新設、`runBacktest` の WF/MC/BH 経路と統合が別途必要 |

**推奨: (b)**

理由:
- `DSLBacktestAdapter` は Phase 6.7b で既に DSL から BT 実行可能(DB Strategy 不要)
- 段階 4 で BT 本体を Python に切り替える際、TS 自前の `runBacktest` は WalkForward 用ラッパーに縮小される予定
- screening は短命処理なので DB に Strategy を作るのは過剰

**§6.2 改修方針(更新版)**:
```ts
// 旧(本 docs §6.2 で示した形、実装不可)
const result = await this.strategyBacktestService.runBacktest({
    strategyId: dsl.id, ... // ← getStrategy で失敗する
});

// 新(現実的な実装)
const ohlcv = await this.ohlcvRepository.findMany({...});
const dslResult = await this.dslBacktestAdapter.runBacktestOnBars(dsl, ohlcv, config);
// dslResult を新規テーブル ScreeningBacktestRun に保存(段階 1 で追加)
await this.screeningBacktestRepo.save({ hypothesisId, dslResult });
```

新規テーブル `ScreeningBacktestRun` は段階 1 のスキーマ追加項目とする(Prisma migration 1 件)。

### 11.3 §6.1 `DSLConverter` の表現修正

**指摘**: 「`dslEdgeMapper.dslToMachineConditions` の逆方向」と書いたが、現状の `dslToMachineConditions` は「代表条件 1 本に落とす」用途で **情報を捨てる実装**なので、厳密な逆変換にはならない。

**修正**:

`DSLConverter.convertHypothesisToDSL()` は `dslEdgeMapper` の **逆変換ではなく、新規マッピング関数** とする:

- 入力: `EdgeHypothesis.conditions[]` (`MachineReadableCondition[]`) + `defaultRiskManagement`
- 出力: `StrategyDSL`(entry / stopLoss / takeProfit / parameters を生成)

`dslEdgeMapper.dslToMachineConditions` は方向が逆 + 情報粒度が違うので参考にしかならない。実装は新規マッピングロジックを起こす。

### 11.4 §6.3 `screeningResult.backtestRunId` 型変更の影響

**指摘**: `screeningResult.backtestRunId` の参照先を `BacktestRun` → `StrategyBacktestRun` に変える際、Side-B の各 validation tool が `backtestService.getResult(backtestRunId)` を呼んでいるため、ID 種別変更の影響あり。

**整理**:

§11.2 の方針 (b) を採用すると、永続化先は **新規テーブル `ScreeningBacktestRun`**(`StrategyBacktestRun` ではない)。これに伴う影響:

- `screeningResult.backtestRunId` のフィールド名/型を整理する必要
  - 案 1: フィールド名を `screeningBacktestRunId` に変更し、参照先を `ScreeningBacktestRun` に
  - 案 2: 既存の `backtestRunId` を `ScreeningBacktestRun.id` の参照に切り替え(後方互換は破壊)
- 下位の validation tools(WalkForward / MonteCarlo / BuyAndHold)が `backtestService.getResult` を呼んでいる箇所も、`ScreeningBacktestRun` の取得経路に切り替える必要あり

**推奨: 案 1**(フィールド名分離)

- `screeningResult.screeningBacktestRunId` (新規) ← 段階 1 で追加
- `screeningResult.backtestRunId` (旧) ← 段階 3 で廃止と同時に削除
- 段階 1〜3 の移行期間中は両方並存で安全

下位ツール側は `StrategyValidationInput` (Phase 6.7b で既に存在) を使うパスに統一する。

### 11.5 §8 Python BT スケルトンのキー名整合

**指摘**: `bt = Backtest(df, StrategyClass, **payload['config'])` の `payload['config']` 例で `initialCapital` / `leverage` 等を使ったが、`backtesting.py` の `Backtest` コンストラクタ引数名(`cash` / `commission` / `margin` ...)と一致しないため、そのままだと `TypeError`。

**整理**:

TS→Python の境界に **マッピング層** を置く:

```python
# python/backtest/backtest.py 内のマッピング関数(例)
def map_config_to_backtesting_kwargs(config: dict) -> dict:
    """
    アプリ独自の config を backtesting.py の Backtest() 引数に変換する。

    config(TS から来る):
        - initialCapital: 初期資金
        - leverage: レバレッジ(例: 25)
        - tradingCost: 片道手数料(%)
        - spread: スプレッド(pips)

    backtesting.py の Backtest() 引数:
        - cash: 初期資金 (= initialCapital)
        - commission: 片道手数料(0.001 = 0.1%) (= tradingCost / 100)
        - margin: 1 / leverage (= 1 / leverage)
        - exclusive_orders: 同時1ポジ制限
    """
    return {
        'cash': config['initialCapital'],
        'commission': config.get('tradingCost', 0) / 100,
        'margin': 1 / config['leverage'] if config.get('leverage') else 1,
        'exclusive_orders': True,
    }

# 呼び出し側
bt_kwargs = map_config_to_backtesting_kwargs(payload['config'])
bt = Backtest(df, StrategyClass, **bt_kwargs)
```

スプレッドは `backtesting.py` 標準引数にないため、`Strategy.next()` 内で約定価格を調整するか、`commission` に組み込む形で対応。

### 11.6 まとめ

§11 で示した明確化により、本 docs §3〜§9 の方針は変わらないが、段階 1 / 段階 4 の **実装ディテールが具体化** された:

- 段階 1: `DSLBacktestAdapter` 経由 + 新規 `ScreeningBacktestRun` テーブル
- 段階 4: TS→Python 境界に config マッピング層を必須化

§10 残論点に追加:
- **(5)** 新規テーブル `ScreeningBacktestRun` の Prisma スキーマ設計(段階 1 着手時に決定)
- **(6)** `screeningResult.backtestRunId` のフィールド名移行手順(段階 1〜3 の移行期間設計)

---

*追記日時: 2026-05-02 朝 / Copilot レビュー指摘 7 件への明確化対応*
