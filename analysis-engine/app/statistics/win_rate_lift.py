"""Win Rate Lift — TS 版 `src/shared/statistics/winRateLift.ts` と同期実装
(Filter Evolution M2)。

設計書: `docs/design/phase_filter_evolution_specification.md`

進化ループの crossover/mutation を「新戦略生成」ではなく「既存戦略の騙し
(false signal) 回避フィルタ追加」に再定義する設計の根幹評価指標。
親 A (= base setup) と子 A+F (= setup + filter) の trade list を比較して、
filter F の質を Lift = winRate(A+F) / winRate(A) で測る。

業界用語注記: アルゴリズム取引業界には「フィルタ追加で勝ち維持しつつ負けを
除去できたか」を測る統一指標が存在しない (2026-05-08 調査時点)。本実装は
ML/マーケティング分野で確立済の Lift (= Provost & Fawcett 2013 / scikit-learn)
を流用する。

TS と Python で **同じ式** を実装し、両側で同じ結果を返すよう保証する
(= drift 防止)。analysis-engine HTTP 経路で将来使う場合に備えて先行実装。
本 PR (M2) では TS 側 (= EvolutionLoop 観測ログ) のみが現行利用箇所。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional, Sequence


@dataclass(frozen=True)
class WinRateLiftTrade:
    """Trade のうち winRateLift 計算に必要な最小フィールドだけを切り出した型。"""

    entry_time: str
    """ISO 8601 datetime、trade 識別キー (= subset 判定に使う)"""

    outcome: Literal["win", "loss", "timeout"]
    """trade の結末"""


@dataclass(frozen=True)
class SafetyGuards:
    """Safety guard 設定 (= filter が壊滅的に取引数を減らした / 勝ちトレードを
    多く捨てた場合に Lift = 1.0 を返す閾値)。"""

    min_win_preservation_ratio: float = 0.7
    """子の勝ちトレード数 W_AF が親の W_A の何割以上を保つ必要があるか"""

    min_trade_count_ratio: float = 0.3
    """子の総取引数 T_AF が親の T_A の何割以上を保つ必要があるか"""

    min_absolute_trade_count: int = 20
    """子の総取引数の絶対最低値"""


@dataclass(frozen=True)
class WinRateLiftResult:
    """compute_win_rate_lift の戻り値。"""

    lift: float
    parent_win_rate: float
    child_win_rate: float
    parent_win_count: int
    parent_loss_count: int
    parent_trade_count: int
    child_win_count: int
    child_loss_count: int
    child_trade_count: int
    filter_precision: float
    specificity: float
    preserve_win: float
    not_computable: Optional[str]


def _count_outcomes(
    trades: Sequence[WinRateLiftTrade],
) -> tuple[int, int, int]:
    """trade list から (win件数, loss件数, total件数) を集計。timeout は total
    に含めるが win/loss には含めない (= 勝率計算では除外、保守的)。"""
    win_count = 0
    loss_count = 0
    for t in trades:
        if t.outcome == "win":
            win_count += 1
        elif t.outcome == "loss":
            loss_count += 1
    return win_count, loss_count, len(trades)


def _is_strict_subset(
    parent_trades: Sequence[WinRateLiftTrade],
    child_trades: Sequence[WinRateLiftTrade],
) -> bool:
    """子の trade list が親の trade list の strict subset かを entry_time で確認。"""
    parent_entry_times = {t.entry_time for t in parent_trades}
    return all(c.entry_time in parent_entry_times for c in child_trades)


def compute_win_rate_lift(
    parent_trades: Sequence[WinRateLiftTrade],
    child_trades: Sequence[WinRateLiftTrade],
    safety_guards: Optional[SafetyGuards] = None,
) -> WinRateLiftResult:
    """Win Rate Lift を計算する。

    式 (設計書 §2.1):
      lift = winRate(A+F) / winRate(A)
        if W_AF >= min_win_preservation_ratio * W_A
        and T_AF >= max(min_absolute_trade_count, min_trade_count_ratio * T_A)
        else 1.0  # safety guard で弾く

    計算不能ケース (= parent に trade なし、parent winRate 0、child not subset 等)
    では lift=1.0 + not_computable に理由を入れて返す。
    """
    sg = safety_guards or SafetyGuards()
    p_win, p_loss, p_total = _count_outcomes(parent_trades)
    c_win, c_loss, c_total = _count_outcomes(child_trades)

    delta_win = p_win - c_win
    delta_loss = p_loss - c_loss
    delta_total = delta_win + delta_loss
    filter_precision = (delta_loss / delta_total) if delta_total > 0 else 0.0
    specificity = (delta_loss / p_loss) if p_loss > 0 else 0.0
    preserve_win = (c_win / p_win) if p_win > 0 else 0.0
    parent_win_rate = (p_win / p_total) if p_total > 0 else 0.0
    child_win_rate = (c_win / c_total) if c_total > 0 else 0.0

    def _result(lift: float, not_computable: Optional[str]) -> WinRateLiftResult:
        return WinRateLiftResult(
            lift=lift,
            parent_win_rate=parent_win_rate,
            child_win_rate=child_win_rate,
            parent_win_count=p_win,
            parent_loss_count=p_loss,
            parent_trade_count=p_total,
            child_win_count=c_win,
            child_loss_count=c_loss,
            child_trade_count=c_total,
            filter_precision=filter_precision,
            specificity=specificity,
            preserve_win=preserve_win,
            not_computable=not_computable,
        )

    if p_total == 0:
        return _result(1.0, "parent has no trades")
    if p_win == 0:
        return _result(1.0, "parent has zero win rate")
    if c_total == 0:
        return _result(1.0, "child has no trades (= filter rejected all)")
    if not _is_strict_subset(parent_trades, child_trades):
        return _result(
            1.0,
            "child is not a strict subset of parent (= filter changed entry timing)",
        )

    min_required_win = sg.min_win_preservation_ratio * p_win
    min_required_trade_count = max(
        sg.min_absolute_trade_count, sg.min_trade_count_ratio * p_total
    )
    if c_win < min_required_win:
        return _result(
            1.0,
            (
                f"safety guard: child wins {c_win} < {min_required_win:.1f} "
                f"({sg.min_win_preservation_ratio * 100:.0f}% of parent wins {p_win})"
            ),
        )
    if c_total < min_required_trade_count:
        return _result(
            1.0,
            (
                f"safety guard: child trades {c_total} < {min_required_trade_count:.1f} "
                f"(= max({sg.min_absolute_trade_count}, "
                f"{sg.min_trade_count_ratio * 100:.0f}% of parent {p_total}))"
            ),
        )

    lift = child_win_rate / parent_win_rate
    return _result(lift, None)
