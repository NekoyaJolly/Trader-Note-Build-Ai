"""BT エンジンの抽象インターフェイス (engine 非依存)

設計方針 (Critical-4 段階 1.8):
- ノート schema / リクエスト schema には依存しない。adapter.py で互換変換する
- 具体 engine (backtesting.py / vectorbt / 他) は本ファイルの Protocol を実装する
- 将来 engine 交換時は本ファイルと adapter.py は無修正、runner_<engine>.py を追加するだけ
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, List, Literal, Optional, Protocol, Union

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


@dataclass(frozen=True)
class BTConfig:
    """BT 実行設定 (engine 非依存)。"""

    initial_capital: float = 10_000.0
    leverage: float = 1.0
    # 片道手数料 (%, 例: 0.05 = 0.05%)
    trading_cost_percent: float = 0.0


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
