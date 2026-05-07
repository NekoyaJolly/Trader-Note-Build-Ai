"""MTF (マルチタイムフレーム) 用の helper (PR ⑤B)。

TS 側 `src/shared/marketdata/barAlignment.ts` の Python 版。
look-ahead bias を防いだバーアライメントと forward fill を提供する。
"""

from __future__ import annotations

from datetime import datetime
from typing import Iterable, List, Optional, TypeVar

import pandas as pd


# canonical timeframe → 1 バー秒数 (= TS shared/timeframes と同期)
TIMEFRAME_SECONDS = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
}


def timeframe_seconds(tf: str) -> int:
    """canonical timeframe の 1 バー秒数。未知なら例外。"""
    if tf not in TIMEFRAME_SECONDS:
        raise ValueError(f"未知の canonical timeframe: {tf!r}")
    return TIMEFRAME_SECONDS[tf]


def build_bar_alignment(
    primary_timestamps: Iterable[datetime],
    upper_timestamps: Iterable[datetime],
    primary_tf: str,
    upper_tf: str,
) -> List[int]:
    """主バー i に対して、look-ahead bias を防いだ上位足の最新確定 j を返す。

    j=-1 は「主バー i 時点では確定上位足なし」(= 上位足が始まる前)。

    上位足 j の参照可能性:
    - close 時刻 = `t_j + interval(upper_tf)`
    - 主バー i の close 時刻 = `t_i + interval(primary_tf)`
    - j が参照可能 ⇔ `(t_j + interval(upper_tf)) <= (t_i + interval(primary_tf))`

    入力 timestamps は時刻昇順前提。計算量 O(N + M)。
    """
    primary_ts_list = list(primary_timestamps)
    upper_ts_list = list(upper_timestamps)
    primary_sec = timeframe_seconds(primary_tf)
    upper_sec = timeframe_seconds(upper_tf)
    upper_close_ms = [
        int(_to_utc_ms(t)) + upper_sec * 1000 for t in upper_ts_list
    ]
    result: List[int] = [-1] * len(primary_ts_list)
    j = -1
    for i, t in enumerate(primary_ts_list):
        primary_close_ms = int(_to_utc_ms(t)) + primary_sec * 1000
        while j + 1 < len(upper_close_ms) and upper_close_ms[j + 1] <= primary_close_ms:
            j += 1
        result[i] = j
    return result


T = TypeVar("T")


def forward_fill_to_primary(
    upper_series: List[T],
    alignment: List[int],
    fallback: T,
) -> List[T]:
    """alignment に従って upper_series を主バー長に展開する。

    - `alignment[i] = j >= 0` の場合: `out[i] = upper_series[j]` (= forward fill)
    - `alignment[i] = -1` または `j` が範囲外: `out[i] = fallback`
    - `upper_series[j]` が `None` (= warm-up) なら `out[i] = fallback`
    """
    out: List[T] = [fallback] * len(alignment)
    for i, j in enumerate(alignment):
        if j < 0 or j >= len(upper_series):
            continue
        v = upper_series[j]
        out[i] = fallback if v is None else v
    return out


def _to_utc_ms(t: datetime) -> int:
    """datetime を **UTC ms** に変換。tz 未設定 → UTC とみなす。"""
    if isinstance(t, pd.Timestamp):
        # pandas.Timestamp は datetime subclass。ts.timestamp() が UTC ms に近いが
        # tz_naive の場合 local timezone と解釈されるため明示的に UTC 扱いする。
        if t.tzinfo is None:
            t_utc = t.tz_localize("UTC")
        else:
            t_utc = t.tz_convert("UTC")
        return int(t_utc.timestamp() * 1000)
    if t.tzinfo is None:
        # naive datetime は UTC とみなす
        from datetime import timezone
        t = t.replace(tzinfo=timezone.utc)
    return int(t.timestamp() * 1000)


def split_lens_with_timeframe(snapshot_key: str) -> tuple[Optional[str], Optional[str], str]:
    """snapshot key から `(base_lens, timeframe, feature_key)` を取り出す。

    例:
    - `'ohlcv.rsi'` → `('ohlcv', None, 'rsi')`
    - `'ohlcv@1h.ema(period=20)'` → `('ohlcv', '1h', 'ema(period=20)')`
    - `'pattern@1h.engulfing_bull'` → `('pattern', '1h', 'engulfing_bull')`

    `.` が含まれない場合は `(None, None, snapshot_key)` を返す (= 静的 alias 経路用)。
    """
    if "." not in snapshot_key:
        return None, None, snapshot_key
    lens_part, feature_part = snapshot_key.split(".", 1)
    if "@" in lens_part:
        base, tf = lens_part.split("@", 1)
        return base, tf, feature_part
    return lens_part, None, feature_part
