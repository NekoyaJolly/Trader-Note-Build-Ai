from __future__ import annotations

import math
from datetime import datetime
from typing import Any

from app.schemas import WalkForwardRequest, WalkForwardResponse


def _compute_metrics(pnls: list[float]) -> dict[str, float]:
    if not pnls:
        return {"win_rate": float("nan"), "pf": float("nan"), "trade_count": 0}

    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    win_rate = len(wins) / len(pnls)
    total_profit = sum(wins)
    total_loss = abs(sum(losses))
    if total_loss > 0:
        pf = total_profit / total_loss
    elif total_profit > 0:
        pf = 999.0
    else:
        pf = 0.0
    return {"win_rate": win_rate, "pf": pf, "trade_count": len(pnls)}


def _avg(values: list[float]) -> float | None:
    clean = [v for v in values if not math.isnan(v)]
    if not clean:
        return None
    return sum(clean) / len(clean)


def run_walk_forward(req: WalkForwardRequest) -> WalkForwardResponse:
    start = req.period.start
    end = req.period.end
    total_sec = (end - start).total_seconds()
    if total_sec <= 0:
        raise ValueError("period.end must be after period.start")

    window_count = req.splitCount * 2
    window_sec = total_sec / window_count
    buckets: list[list[float]] = [[] for _ in range(window_count)]

    for event in req.events:
        t: datetime = event.entryTime
        if t < start or t >= end:
            continue
        idx = int((t - start).total_seconds() // window_sec)
        if 0 <= idx < window_count:
            buckets[idx].append(event.pnl)

    is_win_rates: list[float] = []
    oos_win_rates: list[float] = []
    is_pfs: list[float] = []
    oos_pfs: list[float] = []
    windows_evaluated = 0

    for i in range(req.splitCount):
        is_metrics = _compute_metrics(buckets[i * 2])
        oos_metrics = _compute_metrics(buckets[i * 2 + 1])
        if is_metrics["trade_count"] == 0 or oos_metrics["trade_count"] == 0:
            continue
        is_win_rates.append(is_metrics["win_rate"])
        oos_win_rates.append(oos_metrics["win_rate"])
        is_pfs.append(is_metrics["pf"])
        oos_pfs.append(oos_metrics["pf"])
        windows_evaluated += 1

    avg_is_wr = _avg(is_win_rates)
    avg_oos_wr = _avg(oos_win_rates)
    overfit_score = None
    if avg_is_wr is not None and avg_oos_wr is not None:
        overfit_score = abs(avg_is_wr - avg_oos_wr)

    return WalkForwardResponse(
        overfitScore=overfit_score,
        avgInSampleWinRate=avg_is_wr,
        avgOutOfSampleWinRate=avg_oos_wr,
        inSamplePF=_avg(is_pfs),
        outOfSamplePF=_avg(oos_pfs),
        splitCount=req.splitCount,
        totalTradeCount=len(req.events),
        windowsEvaluated=windows_evaluated,
    )
