"""BT エンジンの抽象インターフェイス (engine 非依存)

設計方針 (Critical-4 段階 1.8):
- ノート schema / リクエスト schema には依存しない。adapter.py で互換変換する
- 具体 engine (backtesting.py / vectorbt / 他) は本ファイルの Protocol を実装する
- 将来 engine 交換時は本ファイルと adapter.py は無修正、runner_<engine>.py を追加するだけ
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Dict, List, Literal, Optional, Protocol, Union

import pandas as pd

if TYPE_CHECKING:
    # 型のみの参照 (= ランタイム循環 import を防ぐ。BTSpec.trigger_group の型注釈用)
    from app.schemas import ScreeningBacktestConditionGroup


# ---------------------------------------------------------------
# 入力型 (engine 非依存)
# ---------------------------------------------------------------


@dataclass(frozen=True)
class BTStopLossAtrMultiple:
    """ATR 倍率で SL 距離を決定する仕様。"""

    kind: Literal["atr_multiple"] = "atr_multiple"
    value: float = 1.5


@dataclass(frozen=True)
class BTStopLossFixedPips:
    """固定 pips で SL 距離を決定する仕様 (段階 1 では未対応)。"""

    kind: Literal["fixed_pips"] = "fixed_pips"
    value: float = 0.0


@dataclass(frozen=True)
class BTStopLossSwingPoint:
    """直近スイング点に SL を置く仕様 (段階 1 では未対応)。"""

    kind: Literal["swing_point"] = "swing_point"
    lookback_bars: int = 20


BTStopLoss = Union[BTStopLossAtrMultiple, BTStopLossFixedPips, BTStopLossSwingPoint]


@dataclass(frozen=True)
class BTTakeProfitRrRatio:
    """SL 距離 × 比率で TP 距離を決定する仕様。"""

    kind: Literal["rr_ratio"] = "rr_ratio"
    value: float = 2.0


@dataclass(frozen=True)
class BTTakeProfitAtrMultiple:
    """ATR 倍率で TP 距離を決定する仕様。"""

    kind: Literal["atr_multiple"] = "atr_multiple"
    value: float = 2.0


@dataclass(frozen=True)
class BTTakeProfitFixedPips:
    """固定 pips で TP 距離を決定する仕様 (段階 1 では未対応)。"""

    kind: Literal["fixed_pips"] = "fixed_pips"
    value: float = 0.0


BTTakeProfit = Union[BTTakeProfitRrRatio, BTTakeProfitAtrMultiple, BTTakeProfitFixedPips]


@dataclass(frozen=True)
class BTSpec:
    """BT 戦略の engine 非依存仕様。

    ノート (defaultRiskManagement / direction) を adapter で変換した結果がこの形になる。
    エンジン実装 (BacktestingPyEngine 等) はこの spec を読み取って自身のフレームワーク
    に合わせて Strategy / setup を構築する。

    PR #112:
        `trigger_group` で AND/OR 構造を保った条件グループを運ぶ。指定時、Strategy.next()
        は `condition_evaluator.evaluate_condition_group` で評価して entry 判定する。
        None なら従来挙動 (= 条件無視で毎バー entry、SL/TP のみ)。
    """

    direction: Literal["long", "short", "either"]
    stop_loss: BTStopLoss
    take_profit: BTTakeProfit
    max_holding_bars: Optional[int] = None
    # 将来 engine 側で評価したい指標仕様 (現段階では未使用)
    indicators: List[dict] = field(default_factory=list)
    # PR #112: ConditionGroup (再帰構造)。BTSpec を engine 非依存に保つため、
    # ランタイム import は避け TYPE_CHECKING ブロックで型のみ参照する。
    # 具体実装 (BacktestingPyEngine) は condition_evaluator.evaluate_condition_group に
    # 直接渡して評価する。
    trigger_group: Optional["ScreeningBacktestConditionGroup"] = None
    # PR ⑤B (MTF): 上位足 timeframe ごとの OHLCV (= timestamp 列を index に持つ
    # DataFrame)。空 dict / None なら主 timeframe のみで評価 (= 後方互換)。
    # runner.py が collect_required_timeframes で必要 timeframe を集めて _load_ohlcv
    # で読んだ結果を詰める。BacktestingPyEngine は init() で alignment 計算 +
    # 上位足 indicator/pattern pre-compute + forward fill を行い、_build_feature_snapshot
    # で `<lens>@<tf>.<feature>` キーで snapshot に詰める。
    upper_timeframe_ohlcv: Optional[Dict[str, pd.DataFrame]] = None
    # PR ⑤B (MTF): 主 timeframe (canonical 表記、例: "15m")。MTF alignment 計算で
    # 「主バーの close 時刻」を求めるために必要。runner.py が `req.timeframe` を
    # canonical 化して詰める。未設定なら BacktestingPyEngine 側で OHLCV index 間隔
    # から推定する。
    primary_timeframe: Optional[str] = None


@dataclass(frozen=True)
class BTConfig:
    """BT 実行設定 (engine 非依存)。"""

    initial_capital: float = 10_000.0
    leverage: float = 1.0
    # 片道手数料 (%, 例: 0.05 = 0.05%)
    trading_cost_percent: float = 0.0
    # 往復スプレッド (pips)。pip_size と期間平均価格で backtesting.py の spread (価格に対する率) に換算。
    spread_pips: float = 0.0
    # 1 pip の価格幅。0 の場合は spread を適用しない。
    pip_size: float = 0.0


# ---------------------------------------------------------------
# 出力型 (engine 非依存)
# ---------------------------------------------------------------


@dataclass(frozen=True)
class BTSummary:
    """BT 実行のサマリーメトリクス (engine 非依存)。"""

    pf: float
    win_rate: float  # 0.0〜1.0
    trade_count: int
    max_dd: Optional[float]  # %
    sharpe: Optional[float]
    return_pct: Optional[float]
    recovery_factor: Optional[float]
    risk_reward: Optional[float]


@dataclass(frozen=True)
class BTTrade:
    """個別トレード (engine 非依存)。"""

    entry_time: datetime
    entry_price: float
    exit_time: Optional[datetime]
    exit_price: Optional[float]
    side: Literal["long", "short"]
    pnl: float
    outcome: Literal["win", "loss", "timeout"]


@dataclass(frozen=True)
class BTResult:
    """BT 実行結果 (engine 非依存)。"""

    summary: BTSummary
    trades: List[BTTrade]
    equity: Optional[List[float]]
    engine_version: str


@dataclass(frozen=True)
class BTOptimizeResult:
    """最適化 (/v1/optimize) 結果 (engine 非依存)。

    best_params: 最適化されたパラメータ（slValue / tpValue 等、探索対象のみ）。
    summary/trades/equity: 最適パラメータでの BT 結果。
    """

    best_params: Dict[str, float]
    summary: BTSummary
    trades: List[BTTrade]
    equity: Optional[List[float]]
    engine_version: str


@dataclass(frozen=True)
class DsrMetrics:
    """Deflated Sharpe Ratio の観測値 (進化ループ再設計 Phase 1b)。

    dsr.py の DsrResult をエンジン非依存型として運ぶ。`not_computable` が None
    でなければ計算不能 (= サンプル不足 / flat returns 等) で dsr は 0。
    """

    dsr: float
    sharpe_ratio: float
    expected_max_sr: float
    sample_size: int
    not_computable: Optional[str]


@dataclass(frozen=True)
class BTWalkForwardFold:
    """ウォークフォワード 1 窓の結果 (Phase 1b)。

    各窓は train 期間で SL/TP を最適化し、その best params を **次の OOS 期間**で
    評価する。`evaluated=False` は OOS トレード数がフロア未満 / バー不足で
    過学習判定に使えない窓 (= not_evaluated)。
    """

    fold_index: int
    train_start_index: int
    train_end_index: int
    oos_start_index: int
    oos_end_index: int
    best_params: Dict[str, float]
    oos_summary: BTSummary
    oos_trade_count: int
    evaluated: bool
    skip_reason: Optional[str]


@dataclass(frozen=True)
class BTWalkForwardResult:
    """ウォークフォワード最適化 + 過学習ガードの結果 (Phase 1b)。

    full_best: 全期間で最適化した推奨パラメータ (デプロイ用)。
    folds: アンカード WF 各窓の OOS 結果。
    aggregate_oos: 評価対象窓の OOS トレードを連結した集計サマリ。
    dsr: 連結 OOS のトレード別リターンに対する Deflated Sharpe (trial_count 補正)。
    trial_count: 最適化試行数 (= grid の組合せ数)。DSR の N に使う。
    evaluated_fold_count: フロアを満たした OOS 窓数。
    verdict: 'robust' / 'overfit_suspected' / 'not_evaluated' (観測用・助言。
             実際の合否ゲートは Side-B 確証ゲート (Phase 4) で強制)。
    """

    full_best: BTOptimizeResult
    folds: List["BTWalkForwardFold"]
    aggregate_oos: BTSummary
    dsr: Optional[DsrMetrics]
    trial_count: int
    evaluated_fold_count: int
    windows: int
    min_trades_per_window: int
    verdict: Literal["robust", "overfit_suspected", "not_evaluated"]


# ---------------------------------------------------------------
# エンジンの抽象インターフェイス
# ---------------------------------------------------------------


class BTEngine(Protocol):
    """BT エンジンの抽象。具体実装 (backtesting.py / vectorbt / 他) はこれを満たす。

    クライアントもサービスも本 Protocol に向かってだけ依存し、実装の差し替えは
    `runner.py` で `BacktestingPyEngine()` → `VectorbtEngine()` の入れ替えだけで完結する。
    """

    @property
    def version(self) -> str:
        """エンジン名+バージョン (例: 'analysis-engine/backtesting.py@0.6.5')"""
        ...

    def run(self, spec: BTSpec, ohlcv: pd.DataFrame, config: BTConfig) -> BTResult:
        """BT を実行する。

        Args:
            spec: 戦略仕様 (engine 非依存、adapter で変換済み)
            ohlcv: OHLCV DataFrame (timestamp index, columns: open/high/low/close/volume)
            config: 実行設定 (engine 非依存)

        Returns:
            BTResult: engine 非依存の結果。adapter で response schema に再変換される。
        """
        ...
