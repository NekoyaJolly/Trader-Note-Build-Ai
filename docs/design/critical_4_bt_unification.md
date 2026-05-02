# Critical-4 設計議論: BT 一本化 + Python BT ライブラリ統合

**作成日時**: 2026-05-02 朝  
**目的**: BT 系統を「ストラテジー側 + Python BT ライブラリ」に一本化する設計議論のたたき台。Nekoさん 判断後に段階 1〜4 の実装着手。

---

## §1 役割の再定義(本設計の出発点)

### ノート = 戦略が書いてある紙(統合概念)

**ノート**は「戦略の永続化された記録」。生成経路は多様:

| 生成経路 | 例 |
|---|---|
| 人間トレード履歴から AI 化 | CSV インポート → AI がノート化 |
| AI 仮想トレードから | aiOrchestrator が生成 → AITradeNote |
| 人間が考案した戦略から | UI で戦略を入力 → ノート化 |
| AI 仮説の昇格から | screening_passed → confirmed → ノート化 |

→ 経路は多様だが、**最終的に全部「ノート」概念に統合**(設計書 `DESIGN_DOC_autonomous_trading_architecture.md` のとおり Side-A / Side-B 横断で扱う)。

### ノートができること(2 つ)

```
ノート(本棚にずっとしまわれる)
  ├── ① マーケット入力との類似性検索 → ユーザー通知
  │   (出発点機能: 「トレードノートを書く習慣の自動化」)
  └── ② 自分自身を BT で検証
        (ノートはストラテジーが書いてある紙なので、BT できて当然・できるべき)
```

### BT エンジンは「アプリ全体で 1 つだけ」

| 概念 | 役割 |
|---|---|
| **ノート** | 戦略が書いてある紙(永続化された戦略記録)。①類似性検索 + ②BT 検証の対象 |
| **BT エンジン** | アプリ全体で **1 つだけ存在**。analysis-engine 内の `backtesting.py` で実装 |
| **仮説**(EdgeHypothesis) | AI が生成する戦略候補(ノートに昇格する手前の中間表現) |

### 「変換」ではなく「ノート schema を BT 入力形式に寄せる」

**従来の発想(誤り)**: ノート(独自形式)→ アダプタで BT 用に変換 → BT エンジン  
→ 変換ロジックがメンテ負担になる

**正しい発想**: ノートの schema 自体を **BT エンジンが直接食える形に寄せる**  
→ ノートの数値をそのまま BT に渡せる(変換不要 or 最小限)

### 指標計算の責務分離

- **アプリ側で独自実装しない**(自前 RSI / MACD / etc. は書かない)
- **計算は Python ライブラリに委ねる**(`pandas` / `pandas_ta` の標準計算が答え)
- **アプリの責務はノートの記録・類似性検索・通知に集中**

これにより:
- ノートに格納される数値は `pandas_ta` 等の **標準的な計算結果**
- BT エンジン (`backtesting.py`) も同じ `pandas` / `numpy` 基盤で動く
- → ノートの数値をそのまま BT に渡せる(互換性が自動的に成立)

### 経路の整理(更新版)

```
人間トレード CSV ┐
AI 仮想トレード ─┼─→ ノート化 ─→ 本棚(統合「ノート」)
人間考案戦略 ────┤              ↓
AI 仮説昇格 ─────┘   ① 類似性検索 → 通知
                     ② BT 検証(数値そのまま analysis-engine に投げる)
                                 ↓
                       analysis-engine(GCP デプロイ済みコンテナ)
                       ├── 指標計算 (pandas/pandas_ta) ← 既存
                       └── BT (backtesting.py) ← 新規
                                 ↓
                       結果をノートに書き戻し(検証履歴の一部)
```

**Critical-4 の本質**: 並列に存在する複数の BT 系統を廃止し、analysis-engine の 1 つに統一する。指標計算と BT を同じコンテナに寄せ、ノート schema を BT 入力形式に整合させる。

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

### 6.1 設計の中核: 「ノート → analysis-engine に直接 POST」

**変換アダプタは作らない**。ノートの数値をそのまま analysis-engine に渡す:

```
ScreeningOrchestrator
  ↓ (仮説から既存パスでノート相当の情報を生成、もしくは直接 BT 入力に整形)
  ↓ ノートの数値(OHLCV インデックス、エントリー条件、SL/TP、etc.)
  ↓
analysis-engine の BT API (HTTP POST /v1/backtest)
  ↓ 内部で pandas DataFrame に変換、backtesting.py で実行
  ↓ 結果を返す
ScreeningOrchestrator
  ↓ 結果をノートに書き戻し(検証履歴として永続化)
```

### 6.2 ノート schema の整合性確認(段階 1 着手前の前提調査)

ノートの数値が analysis-engine の BT 入力にどれだけ整合しているかを調査する。整合していない部分は schema 修正 PR を別途切る:

- `TradeNote` / `AITradeNote` の数値フィールド一覧
- `backtesting.py` の `Backtest` クラスが期待する入力形式(OHLCV DataFrame + Strategy クラス)
- ギャップ: あれば schema 改修 or analysis-engine 側で吸収するアダプタ層

→ §10 残論点 (5) として整理(調査タスク)

### 6.3 改修: `ScreeningOrchestrator`

```ts
// 旧(誤った経路、ノート専用 BT を使っていた)
const materialized = await this.materialization.materializeForValidation(...);
const runId = await this.backtestService.execute({ noteId: materialized.tradeNoteId, ... });
const summary = await this.backtestService.getResult(runId);

// 新(唯一の BT エンジンに統一)
// ノート相当の情報(エントリー条件・SL/TP・OHLCV 範囲・指標)を analysis-engine に POST
const result = await this.analysisEngineClient.runBacktest({
    notePayload: this.buildNotePayloadFromHypothesis(hypothesis),
    period: { start, end },
});
// 結果を screeningResult として書き戻し
await this.edgeLedger.recordScreeningResult(hypothesis.id, {
    backtestRunId: result.runId,
    metrics: result.summary,
    ...
});
```

`analysisEngineClient` は既存の `analysis-engine` HTTP API の薄いラッパー(指標計算と同じパターン)。

### 6.4 既存仮説の screening 結果との互換性

- 旧 `screeningResult.backtestRunId` は `BacktestRun` (Side-A note 経由) を指していた
- 新 `screeningResult.backtestRunId` は analysis-engine 側の BT 結果 ID を指す
- 移行期間中の互換性:
  - 過去の `screeningResult` は段階 3 までは旧 BacktestRun を参照可能
  - 段階 3 で旧 BacktestRun を廃止する際、screeningResult のメタデータに「旧経路」フラグを付与

### 6.5 テスト

- 既存 `screeningOrchestrator.test.ts` を新経路に対応(`analysisEngineClient` のモック化)
- analysis-engine 側の BT API を別途テスト(Python 単体 + 統合)

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

## §8 段階 4 の実装計画(analysis-engine への BT 寄せ込み)

### 8.1 寄せ込み方針(Nekoさん 判断)

GCP に既に **2 つの Python コンテナ**がデプロイされている:
- `analysis-engine`: 指標計算 (`pandas` / `pandas_ta`) ← 既に本番稼働
- `python` コンテナ(`python/walk_forward.py` 等): WF 統計分析

**BT を analysis-engine に寄せる**ことで:
- ✅ GCP デプロイが既に済んでいる → BT も同じコンテナで本番稼働
- ✅ 指標計算と BT は同じ `pandas` / `numpy` 基盤を共有(依存関係自然)
- ✅ HTTP API として既に FastAPI で動いている(`src/services/analysisEngineClient.ts` の同パターンで呼べる)
- ✅ `python/` コンテナは段階的に廃止検討(walk_forward 等を analysis-engine に移管)

### 8.2 analysis-engine 側の追加実装

```
analysis-engine/
├── app/
│   ├── (既存) 指標計算 endpoints (pandas_ta)
│   └── backtest/         ← 新規
│       ├── __init__.py
│       ├── routes.py     # FastAPI router: POST /v1/backtest
│       ├── runner.py     # backtesting.py の Backtest を呼ぶコア
│       ├── note_to_bt.py # ノート schema → backtesting.py 入力のマッピング
│       └── models.py     # Pydantic input/output schemas
└── requirements.txt       # 'backtesting' 追加
```

`runner.py` のスケルトン:
```python
"""
ノートの数値を直接受け取り、backtesting.py で BT を実行する。
変換アダプタは最小限(ノート schema を BT 入力形式に寄せる方針)。
"""
import pandas as pd
from backtesting import Backtest, Strategy

def map_config_to_backtesting_kwargs(config: dict) -> dict:
    """
    アプリ独自の config を backtesting.py の Backtest() 引数にマッピング。
    backtesting.py の Backtest() 引数:
      - cash: 初期資金 (= initialCapital)
      - commission: 片道手数料 (例: 0.001 = 0.1%) (= tradingCost / 100)
      - margin: 1 / leverage (= 1 / leverage)
      - exclusive_orders: 同時 1 ポジ制限
    """
    return {
        'cash': config['initialCapital'],
        'commission': config.get('tradingCost', 0) / 100,
        'margin': 1 / config['leverage'] if config.get('leverage') else 1,
        'exclusive_orders': True,
    }

def build_strategy_from_note(note_payload: dict) -> type[Strategy]:
    """ノートのエントリー条件・SL/TP を Strategy クラスに動的展開"""
    # entry_conditions, stopLoss, takeProfit を読んで Strategy.next() を構築
    ...

def run_backtest(note_payload: dict, ohlcv: list[dict], config: dict) -> dict:
    df = pd.DataFrame(ohlcv).set_index('timestamp')
    StrategyClass = build_strategy_from_note(note_payload)
    bt_kwargs = map_config_to_backtesting_kwargs(config)
    bt = Backtest(df, StrategyClass, **bt_kwargs)
    stats = bt.run()
    return {
        'trades': stats._trades.to_dict('records'),
        'summary': { 'pf': ..., 'winRate': ..., 'tradeCount': ... },
        'equity': stats._equity_curve['Equity'].tolist(),
    }
```

`routes.py`:
```python
from fastapi import APIRouter
from .models import BacktestRequest, BacktestResponse
from .runner import run_backtest

router = APIRouter(prefix='/v1/backtest')

@router.post('', response_model=BacktestResponse)
async def post_backtest(req: BacktestRequest):
    return run_backtest(req.notePayload, req.ohlcv, req.config)
```

### 8.3 TS 側のクライアント(既存 analysisEngineClient と同パターン)

```ts
// src/services/analysisEngineClient.ts に追加
export async function fetchBacktestFromAnalysisEngine(input: {
    notePayload: NotePayload;
    ohlcv: OHLCVBar[];
    config: BacktestConfig;
}): Promise<BacktestResult> {
    const url = `${ANALYSIS_ENGINE_URL}/v1/backtest`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`analysis-engine BT failed: ${res.status}`);
    return await res.json();
}
```

### 8.4 既存 TS 自前 BT の縮小

- `src/side-b/strategy_dsl/dslBacktestSimulation.ts` (21KB): **削除**(機能を analysis-engine に移行)
- `src/side-b/strategy_dsl/DSLBacktestAdapter.ts`: 内部実装を `analysisEngineClient.fetchBacktestFromAnalysisEngine` に切り替え、もしくは廃止
- `src/backend/services/strategyBacktestService.ts:runBacktest`: WalkForward の IS/OOS 呼び出し用ラッパーに縮小、もしくは廃止

### 8.5 `python/` コンテナの今後

- `walk_forward.py` 等の補助分析を analysis-engine に移管(別 PR)
- 移管完了後、`python/` コンテナと `PythonBridge` (docker_exec モード) は廃止検討
- `PythonBridge` の HTTP モードは analysis-engine 呼び出しに使えるので、ラッパーとしては残せる

### 8.6 検証手順

1. 既存 TS 自前 BT (`dslBacktestSimulation.ts`) で算出した PF / 勝率と、analysis-engine の `backtesting.py` で同じ条件・期間で算出した値を比較
2. 差分が大きい場合、約定モデルの違いを調査(スリッページ、約定タイミング等)
3. 単体テスト + 結合テスト + analysis-engine 側のエンドポイントテスト

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

---

## §12 概念修正(2026-05-03 朝): ノートとアーキテクチャ全体の再整理

PR #77 提出後、Nekoさん との対話で **ノート概念の理解と BT インフラの方針が大きく整理された**。本セクションは経緯の記録 + 設計の確定方針として残す。
本文(§1, §6, §8)はこの方針に合わせて既に書き換え済み。§11 の Copilot 指摘は引き続き有効だが、§6.1 の `DSLConverter` は本概念修正で「変換アダプタを作らない」方針に変わったため、§11.3 の指摘は実装方針の変更で **解消**。

### 12.1 ノートに関する僕の誤解と訂正

**僕(Claude)が誤解していた点**:
- §1 で「ノートは振り返り専用、BT と無関係」と書いた
- §6.1 で `DSLConverter`(ノート/仮説 → DSL 変換アダプタ)を新設する設計にした

**Nekoさん の正しい設計方針**:
- ノート = **戦略が書いてある紙**(永続化された戦略記録)
- 生成経路は多様(人間トレード履歴、AI 仮想トレード、人間考案戦略、AI 仮説昇格)だが、**最終的に全部「ノート」概念に統合**(設計書 `DESIGN_DOC_autonomous_trading_architecture.md` 通り、Side-A / Side-B 横断)
- ノートができることは 2 つ:
  1. マーケット入力との類似性検索 → 通知(出発点機能)
  2. 自分自身を BT で検証(ストラテジー記録なので **BT できて当然・できるべき**)

→ 「ノートで BT できない」は誤り。ノートは BT できる。ただし「ノート専用 BT」は不要(`services/backtestService.ts` のような並列実装は廃止対象)。

### 12.2 BT エンジンの数(1 つに集約)

**正しい姿**:
- BT エンジンは **アプリ全体で 1 つだけ存在**
- 各経路(ノート / 仮説 / 戦略)から、その 1 つを「入力 → 実行 → 結果書き戻し」で使う

**実装場所**: `analysis-engine` (GCP デプロイ済みコンテナ) に集約する(§8 寄せ込み案、§12.4 参照)。

### 12.3 「変換」ではなく「ノート schema を BT 入力形式に寄せる」

**僕が PR #77 で書いた誤った発想**: 変換アダプタ (`DSLConverter`) を作る  
**Nekoさん の正しい発想**: ノートの schema を **BT エンジンが直接食える形に寄せる**

→ 変換ロジックがメンテ負担になるので作らない。ノートの数値をそのまま `analysis-engine` に POST する。

### 12.4 `analysis-engine` 寄せ込み(BT インフラ統合)

GCP に既に 2 つの Python コンテナがデプロイされているが、**BT は `analysis-engine` に寄せる**:

| 旧方針(PR #77 §8) | 新方針(本セクション + §8 書き換え後) |
|---|---|
| `python/backtest/backtest.py` を新規 + `PythonBridge` (docker_exec) | `analysis-engine/app/backtest/` に追加 + HTTP API |
| Python コンテナを 2 つ運用 | `analysis-engine` 1 つに集約、`python/` は段階廃止検討 |
| `PythonBridge` で呼び出し | `analysisEngineClient` で HTTP 経由(既存パターン) |

**メリット**:
- GCP デプロイが既に済んでいる → BT も即本番稼働
- 指標計算と BT が同じ `pandas` / `numpy` 基盤を共有(依存関係自然、Versioning 楽)
- HTTP API として既に FastAPI が動いている

### 12.5 指標計算の責務分離(設計原則)

- **アプリ側で独自の数値計算は実装しない**(自前 RSI / MACD / ATR 等を書かない)
- **計算は `pandas` / `pandas_ta` 等の標準ライブラリに委ねる**
- ノートに格納される数値は `pandas_ta` 等の標準計算結果
- BT エンジン (`backtesting.py`) も同じ基盤で動く
- → ノートの数値をそのまま BT に渡せる(互換性が自動成立)

これは Critical-4 だけでなく、アプリ全体の設計原則として明記する価値あり。

### 12.6 §3 移行戦略(意味の更新)

各段階の意味を概念修正後の方針に合わせて再解釈:

| 段階 | PR #77 当初の表現 | §12 修正後の表現 |
|---|---|---|
| 段階 1 | screening 経路を DSL → 戦略 BT に切り替え | screening 経路を **唯一の BT エンジン** (analysis-engine) に切り替え |
| 段階 2 | StrategyBacktesterAgent per-plan 結果永続化 | (同左) plan 経路でも analysis-engine を使う |
| 段階 3 | ノート側 BT 廃止 | **「ノート専用 BT」`services/backtestService.ts` の廃止**(ノート概念自体は維持、BT 自体は analysis-engine 経由で残る) |
| 段階 4 | Python BT ライブラリに切り替え | **analysis-engine への BT 機能追加**(`python/` コンテナではなく `analysis-engine`) |

### 12.7 §11 との関係

- §11.1(Critical-4 番号衝突): 引き続き有効
- §11.2(`runBacktest` 前提): §6 を `analysis-engine` 経由に書き換えたため、`runBacktest` を直接呼ぶ問題は **解消**(段階 1 では `analysisEngineClient` を使う)
- §11.3(`DSLConverter` の表現): 概念修正で **`DSLConverter` 自体が削除**されたため、§11.3 の指摘は失効
- §11.4(`backtestRunId` 型変更): 引き続き有効、`screeningBacktestRunId` 案を採用予定
- §11.5(Python config マッピング): §8 書き換え後にもマッピング層は必要、引き続き有効

### 12.8 §10 残論点に追加

- **(7)** ノート schema の現状調査: `TradeNote` / `AITradeNote` の数値フィールドが `analysis-engine` の BT 入力 (`backtesting.py`) にどれだけ整合するか。ギャップがあれば schema 改修 PR を別途切る
- **(8)** `analysis-engine` の BT API 設計: ノート schema をそのまま受ける形にするか、若干の wrapper を置くか
- **(9)** `python/` コンテナの段階的廃止計画: `walk_forward.py` 等を `analysis-engine` に移管する別 PR の段取り

---

*追記日時: 2026-05-03 朝 / Nekoさん との対話によるノート概念修正と BT インフラ方針確定。本文 §1 / §6 / §8 はこの方針に合わせて書き換え済み。*
