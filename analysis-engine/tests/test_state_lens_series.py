"""状態レンズ per-bar 系列 (_compute_state_lens_series) のユニットテスト。

検証観点 (NOTE_SIMILARITY_FOUNDATION.md §12.2 / §12.3):
- 先読み (lookahead) 禁止: 未来バーを追加しても過去バーの payload が変わらない
- 系列長が入力バー数と 1:1
- 要求したレンズのみ計算される (未要求は None)
- 末尾要素は「全体を 1 回計算した snapshot」と一致 (窓 150 本以内の入力時)

実行: analysis-engine/ で `python3 -m pytest tests/test_state_lens_series.py`
(pandas / pydantic が必要。CI 未配線のためローカル/コンテナで手動実行)
"""

import math
import sys
from pathlib import Path

import pandas as pd
import pytest

# analysis-engine/ を import path に追加 (test_sl_clamp.py と同じ流儀)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import STATE_LENS_WINDOW_BARS, _compute_state_lens_series  # noqa: E402
from app.smc import compute_smc_structures  # noqa: E402


def _make_uptrend_df(count: int) -> pd.DataFrame:
    """上昇ジグザグの決定論的 OHLCV (TS 側テストの makeUptrendBars と同形)。"""
    rows = []
    for i in range(count):
        close = 100 + i * 0.3 + 3 * math.sin(i * 2 * math.pi / 16)
        rows.append(
            {
                "open": close - 0.1,
                "high": close + 0.5,
                "low": close - 0.5,
                "close": close,
                "volume": 1000.0,
            }
        )
    return pd.DataFrame(rows)


def test_series_length_matches_bars():
    df = _make_uptrend_df(60)
    smc_series, chart_series, wyckoff_series = _compute_state_lens_series(
        df, {"smc", "chart_pattern", "wyckoff"}
    )
    assert smc_series is not None and len(smc_series) == 60
    assert chart_series is not None and len(chart_series) == 60
    assert wyckoff_series is not None and len(wyckoff_series) == 60


def test_only_requested_lenses_are_returned():
    df = _make_uptrend_df(30)
    smc_series, chart_series, wyckoff_series = _compute_state_lens_series(df, {"smc"})
    assert smc_series is not None
    assert chart_series is None
    assert wyckoff_series is None

    none_result = _compute_state_lens_series(df, set())
    assert none_result == (None, None, None)


def test_lookahead_invariance():
    """未来バーを追加しても過去バーの payload が一切変わらない (§12.2 不変条件)。"""
    long_df = _make_uptrend_df(80)
    short_df = long_df.iloc[:50].reset_index(drop=True)

    long_smc, _, long_wyckoff = _compute_state_lens_series(long_df, {"smc", "wyckoff"})
    short_smc, _, short_wyckoff = _compute_state_lens_series(short_df, {"smc", "wyckoff"})

    for i in range(50):
        assert long_smc[i] == short_smc[i], f"smc payload が bar {i} で変化 (lookahead 漏れ)"
        assert long_wyckoff[i] == short_wyckoff[i], f"wyckoff payload が bar {i} で変化"


def test_tail_matches_single_snapshot_within_window():
    """入力が窓幅以内なら、末尾要素は全体 1 回計算の snapshot と一致する。"""
    df = _make_uptrend_df(min(120, STATE_LENS_WINDOW_BARS))
    smc_series, _, _ = _compute_state_lens_series(df, {"smc"})
    assert smc_series[-1] == compute_smc_structures(df)


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
