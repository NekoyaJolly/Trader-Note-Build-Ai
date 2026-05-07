"""TimeSession lens の計算 (PR ⑤D-1)。

TS 側 `src/side-b/lenses/TimeSessionLens.ts` と **同じ式** で動く Python port。
runner_backtesting_py で各バーの timestamp から time_session features を計算し、
`_build_feature_snapshot` で `time_session.<feature>` snapshot key として詰める。

提供 features (= TS と完全一致):
- utc_hour: int (0-23)
- utc_minute: int (0-59)
- day_of_week: int (0=日曜, 1=月曜, ..., 6=土曜)
- day_of_month: int (1-31)
- tokyo_active / london_active / ny_active: bool
- overlap_london_ny / overlap_tokyo_london: bool
- minutes_since_tokyo_open / minutes_since_london_open / minutes_since_ny_open: int
  (= セッション外なら -1)
- is_weekend: bool (= 簡易版、土日)
- is_monday_open: bool (= 月曜の最初 4 時間)
- is_friday_close: bool (= 金曜 17-21 UTC)
- is_tokyo_lunch: bool (= JST 11:30-12:30 = UTC 02:30-03:30)
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict


TOKYO_OPEN_UTC = 0
TOKYO_CLOSE_UTC = 6
LONDON_OPEN_UTC = 8
LONDON_CLOSE_UTC = 16
NY_OPEN_UTC = 13
NY_CLOSE_UTC = 21


def _minutes_since_open(ts: datetime, open_hour_utc: int) -> int:
    """ts の UTC 時分から open_hour_utc:00 までの経過分。セッション前は -1。"""
    now_minutes = ts.hour * 60 + ts.minute
    open_minutes = open_hour_utc * 60
    if now_minutes < open_minutes:
        return -1
    return now_minutes - open_minutes


def _is_fx_market_open_simple(ts: datetime) -> bool:
    """**簡易判定** (= 固定 21 UTC 切替): 土曜は終日休、金曜 21 UTC 以降と日曜 21
    UTC 前は休。

    PR ⑤D-1 で **TS surrogate (`shared/timeframes/timeSession.ts`) /
    Side-B `TimeSessionLens.compute` / 本関数の 3 経路で同じ式に統一** された。
    旧 `TimeSessionLens` は `marketHours.ts:isFXMarketOpen` の DST 考慮 (= 22 UTC
    切替) を使っていたが、Python に DST 判定をポートするコストが高い + 戦略
    filter 用途では 1 時間ズレは実用上影響軽微なため、本 PR では DST 考慮を
    捨てて simple 統一。将来 DST 考慮を戻す場合は shared 側で DST ロジックを
    実装 + Python に同期する形で別 PR 対応 (= 単一真実は維持)。
    """
    weekday = ts.weekday()  # Python: 0=月曜, 6=日曜
    # 土曜は終日休
    if weekday == 5:
        return False
    # 日曜は 21 UTC 以前は休
    if weekday == 6 and ts.hour < 21:
        return False
    # 金曜 21 UTC 以降は休
    if weekday == 4 and ts.hour >= 21:
        return False
    return True


def compute_time_session_features(ts: datetime) -> Dict[str, Any]:
    """指定 timestamp に対する time_session features を返す。

    戻り値は flat dict (= snapshot key の `<feature>` 部分のみ、`time_session.` prefix
    は呼び出し側で付ける想定)。
    """
    hour = ts.hour
    minute = ts.minute
    # TS 側 ts.getUTCDay() (= 0=日曜, 1=月曜, ..., 6=土曜) と一致させる。
    # Python の datetime.weekday() は 0=月曜 なので変換する。
    day_of_week = (ts.weekday() + 1) % 7
    day_of_month = ts.day

    tokyo_active = TOKYO_OPEN_UTC <= hour < TOKYO_CLOSE_UTC
    london_active = LONDON_OPEN_UTC <= hour < LONDON_CLOSE_UTC
    ny_active = NY_OPEN_UTC <= hour < NY_CLOSE_UTC
    overlap_london_ny = london_active and ny_active
    overlap_tokyo_london = hour == 7 or hour == 8

    is_weekend = not _is_fx_market_open_simple(ts)
    # 月曜の最初の 4 時間 (= 日曜オープン直後〜月曜未明)。day_of_week=1 (= 月曜)
    is_monday_open = day_of_week == 1 and hour < 4
    # 金曜の最後の 4 時間 (= クローズ手前 17-21 UTC)。day_of_week=5 (= 金曜)
    is_friday_close = day_of_week == 5 and 17 <= hour < 22
    # 東京昼休み (JST 11:30-12:30 = UTC 02:30-03:30)
    is_tokyo_lunch = (hour == 2 and minute >= 30) or (hour == 3 and minute < 30)

    return {
        "utc_hour": hour,
        "utc_minute": minute,
        "day_of_week": day_of_week,
        "day_of_month": day_of_month,
        "tokyo_active": tokyo_active,
        "london_active": london_active,
        "ny_active": ny_active,
        "overlap_london_ny": overlap_london_ny,
        "overlap_tokyo_london": overlap_tokyo_london,
        "minutes_since_tokyo_open": (
            _minutes_since_open(ts, TOKYO_OPEN_UTC) if tokyo_active else -1
        ),
        "minutes_since_london_open": (
            _minutes_since_open(ts, LONDON_OPEN_UTC) if london_active else -1
        ),
        "minutes_since_ny_open": (
            _minutes_since_open(ts, NY_OPEN_UTC) if ny_active else -1
        ),
        "is_weekend": is_weekend,
        "is_monday_open": is_monday_open,
        "is_friday_close": is_friday_close,
        "is_tokyo_lunch": is_tokyo_lunch,
    }


# time_session features の全 key (= condition_evaluator の SUPPORTED_LENS_FEATURE_MAP
# に登録するため)
TIME_SESSION_FEATURE_KEYS = [
    "utc_hour",
    "utc_minute",
    "day_of_week",
    "day_of_month",
    "tokyo_active",
    "london_active",
    "ny_active",
    "overlap_london_ny",
    "overlap_tokyo_london",
    "minutes_since_tokyo_open",
    "minutes_since_london_open",
    "minutes_since_ny_open",
    "is_weekend",
    "is_monday_open",
    "is_friday_close",
    "is_tokyo_lunch",
]
