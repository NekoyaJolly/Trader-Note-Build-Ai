"""walk_forward.py のユニットテスト"""

import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# /app/walk_forward をインポート可能にする
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from walk_forward.walk_forward import (  # noqa: E402
    compute_metrics,
    run_walk_forward,
)


def make_events(pnls_per_window: list[list[float]], start: datetime, window_sec: int):
    """
    pnls_per_window[i] の損益群を window i の中央に配置した events を作る。
    長さは window_count そのまま。
    """
    events = []
    for i, pnls in enumerate(pnls_per_window):
        center = start + timedelta(seconds=window_sec * i + window_sec // 2)
        for j, p in enumerate(pnls):
            t = center + timedelta(seconds=j)
            events.append({"entryTime": t.isoformat(), "pnl": p})
    return events


def test_compute_metrics_empty():
    m = compute_metrics([])
    assert m["trade_count"] == 0
    assert math.isnan(m["win_rate"])
    assert math.isnan(m["pf"])


def test_compute_metrics_basic():
    m = compute_metrics([10, -5, 8, -3])
    assert m["trade_count"] == 4
    assert m["win_rate"] == pytest.approx(0.5)
    # PF = (10 + 8) / (5 + 3) = 18/8 = 2.25
    assert m["pf"] == pytest.approx(2.25)


def test_compute_metrics_all_wins():
    m = compute_metrics([5, 10, 15])
    assert m["win_rate"] == pytest.approx(1.0)
    # 全勝は PF=999 にクランプ
    assert m["pf"] == 999.0


def test_run_walk_forward_uniform_stable():
    """各窓で同じ勝率・PF → overfitScore が 0 近傍"""
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    end = datetime(2025, 12, 31, tzinfo=timezone.utc)
    # split_count=4 → 8 窓
    window_sec = int((end - start).total_seconds() / 8)
    # 各窓に [10, -5, 8, -3] の4件 → 全窓で win_rate=0.5, PF=2.25
    pnls_per_window = [[10, -5, 8, -3]] * 8
    events = make_events(pnls_per_window, start, window_sec)

    result = run_walk_forward({
        "events": events,
        "period": {"start": "2025-01-01", "end": "2025-12-31"},
        "splitCount": 4,
    })

    assert result["overfitScore"] == pytest.approx(0.0, abs=1e-9)
    assert result["avgInSampleWinRate"] == pytest.approx(0.5)
    assert result["avgOutOfSampleWinRate"] == pytest.approx(0.5)
    assert result["inSamplePF"] == pytest.approx(2.25)
    assert result["outOfSamplePF"] == pytest.approx(2.25)
    assert result["splitCount"] == 4
    assert result["totalTradeCount"] == 32
    assert result["windowsEvaluated"] == 4


def test_run_walk_forward_severe_overfit():
    """IS 全勝 / OOS 全敗 → overfitScore が 1.0"""
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    end = datetime(2025, 12, 31, tzinfo=timezone.utc)
    window_sec = int((end - start).total_seconds() / 8)
    # 偶数 index (IS) 全勝、奇数 index (OOS) 全敗
    pnls_per_window = []
    for i in range(8):
        pnls_per_window.append([10, 10, 10] if i % 2 == 0 else [-5, -5, -5])
    events = make_events(pnls_per_window, start, window_sec)

    result = run_walk_forward({
        "events": events,
        "period": {"start": "2025-01-01", "end": "2025-12-31"},
        "splitCount": 4,
    })

    assert result["avgInSampleWinRate"] == pytest.approx(1.0)
    assert result["avgOutOfSampleWinRate"] == pytest.approx(0.0)
    assert result["overfitScore"] == pytest.approx(1.0)


def test_run_walk_forward_no_events():
    result = run_walk_forward({
        "events": [],
        "period": {"start": "2025-01-01", "end": "2025-12-31"},
        "splitCount": 4,
    })
    # NaN は None に落ちる
    assert result["overfitScore"] is None
    assert result["windowsEvaluated"] == 0
    assert result["totalTradeCount"] == 0


def test_run_walk_forward_invalid_splitcount_raises():
    with pytest.raises(ValueError):
        run_walk_forward({
            "events": [],
            "period": {"start": "2025-01-01", "end": "2025-12-31"},
            "splitCount": 0,
        })


def test_run_walk_forward_invalid_period_raises():
    with pytest.raises(ValueError):
        run_walk_forward({
            "events": [],
            "period": {"start": "2025-12-31", "end": "2025-01-01"},
            "splitCount": 4,
        })


def test_run_walk_forward_ignores_out_of_period_events():
    """period 外のイベントは無視される"""
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    end = datetime(2025, 12, 31, tzinfo=timezone.utc)

    events = [
        # period 内
        {"entryTime": "2025-06-15T12:00:00+00:00", "pnl": 10},
        # period 外（前）
        {"entryTime": "2024-12-31T23:59:59+00:00", "pnl": 100},
        # period 外（後）
        {"entryTime": "2026-01-01T00:00:01+00:00", "pnl": -100},
    ]
    result = run_walk_forward({
        "events": events,
        "period": {"start": "2025-01-01", "end": "2025-12-31"},
        "splitCount": 2,
    })
    assert result["totalTradeCount"] == 1


def test_run_walk_forward_ignores_non_numeric_pnl():
    events = [
        {"entryTime": "2025-06-15T12:00:00+00:00", "pnl": 10},
        {"entryTime": "2025-06-15T12:00:01+00:00", "pnl": None},
        {"entryTime": "2025-06-15T12:00:02+00:00", "pnl": "nope"},
    ]
    result = run_walk_forward({
        "events": events,
        "period": {"start": "2025-01-01", "end": "2025-12-31"},
        "splitCount": 2,
    })
    assert result["totalTradeCount"] == 1
