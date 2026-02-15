from __future__ import annotations

import json
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import pandas_ta as ta


def stable_params_key(params: Dict[str, float]) -> str:
    """Node 側と一致させるための安定 JSON 文字列。

    - キー順を固定
    - float/int は JSON として表現
    """

    return json.dumps(params, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def make_cache_key(indicator_id: str, params: Dict[str, float], field: str) -> str:
    return f"{indicator_id.lower()}_{stable_params_key(params)}_{field}"


def compute_indicator_series(df: pd.DataFrame, indicator_id: str, params: Dict[str, float], field: str) -> Tuple[str, List[Optional[float]]]:
    """pandas-ta でインジケーター系列を計算して返す。"""

    ind = indicator_id.lower()

    close = df["close"]

    series: pd.Series

    if ind == "sma":
        length = int(params.get("period", params.get("length", 20)))
        series = ta.sma(close=close, length=length)
        out = series
    elif ind == "ema":
        length = int(params.get("period", params.get("length", 20)))
        series = ta.ema(close=close, length=length)
        out = series
    elif ind == "rsi":
        length = int(params.get("period", params.get("length", 14)))
        series = ta.rsi(close=close, length=length)
        out = series
    elif ind == "macd":
        fast = int(params.get("fastPeriod", params.get("fast", 12)))
        slow = int(params.get("slowPeriod", params.get("slow", 26)))
        signal = int(params.get("signalPeriod", params.get("signal", 9)))
        macd_df = ta.macd(close=close, fast=fast, slow=slow, signal=signal)
        if macd_df is None or macd_df.empty:
            out = pd.Series([np.nan] * len(df))
        else:
            # カラム名は MACD_{fast}_{slow}_{signal} / MACDh... / MACDs...
            cols = list(macd_df.columns)
            macd_col = next((c for c in cols if c.startswith("MACD_")), None)
            signal_col = next((c for c in cols if c.startswith("MACDs_")), None)
            hist_col = next((c for c in cols if c.startswith("MACDh_")), None)

            if field == "signal" and signal_col:
                out = macd_df[signal_col]
            elif field == "histogram" and hist_col:
                out = macd_df[hist_col]
            else:
                out = macd_df[macd_col] if macd_col else pd.Series([np.nan] * len(df))
    elif ind in ("bb", "bollinger", "bbands"):
        length = int(params.get("period", params.get("length", 20)))
        std = float(params.get("std", params.get("stdev", 2)))
        bb_df = ta.bbands(close=close, length=length, std=std)
        if bb_df is None or bb_df.empty:
            out = pd.Series([np.nan] * len(df))
        else:
            cols = list(bb_df.columns)
            lower_col = next((c for c in cols if c.startswith("BBL_")), None)
            mid_col = next((c for c in cols if c.startswith("BBM_")), None)
            upper_col = next((c for c in cols if c.startswith("BBU_")), None)
            bandw_col = next((c for c in cols if c.startswith("BBB_")), None)

            if field == "upper" and upper_col:
                out = bb_df[upper_col]
            elif field == "lower" and lower_col:
                out = bb_df[lower_col]
            elif field == "bandwidth":
                # pandas-ta の BBB は percent band width (0-100)
                if bandw_col:
                    out = bb_df[bandw_col]
                else:
                    # 念のため自前計算
                    if upper_col and lower_col and mid_col:
                        out = (bb_df[upper_col] - bb_df[lower_col]) / bb_df[mid_col]
                    else:
                        out = pd.Series([np.nan] * len(df))
            else:
                out = bb_df[mid_col] if mid_col else pd.Series([np.nan] * len(df))
    else:
        raise ValueError(f"未対応のインジケーターです: {indicator_id}")

    # Python の nan を JSON に乗せるため None に変換
    values = [None if pd.isna(v) else float(v) for v in out.to_list()]

    key = make_cache_key(indicator_id, params, field)
    return key, values


def compute_pinbar_flags(df: pd.DataFrame) -> Dict[str, List[bool]]:
    """ピンバー判定。

    定義:
    - 実体 = |close - open|
    - 下ヒゲ = min(open, close) - low
    - 上ヒゲ = high - max(open, close)

    条件:
    - (下ヒゲ >= 3 * 実体 かつ 上ヒゲ <= 0.5 * 実体) または
    - (上ヒゲ >= 3 * 実体 かつ 下ヒゲ <= 0.5 * 実体)

    注意: 実体が 0 の場合は除外（ノイズ）
    """

    o = df["open"].to_numpy(dtype=float)
    h = df["high"].to_numpy(dtype=float)
    l = df["low"].to_numpy(dtype=float)
    c = df["close"].to_numpy(dtype=float)

    body = np.abs(c - o)
    upper = h - np.maximum(o, c)
    lower = np.minimum(o, c) - l

    # 実体ゼロは除外（割り算回避）
    body_ok = body > 0

    bull = body_ok & (lower >= 3.0 * body) & (upper <= 0.5 * body)
    bear = body_ok & (upper >= 3.0 * body) & (lower <= 0.5 * body)
    pin = bull | bear

    return {
        "pinbar": pin.tolist(),
        "pinbar_bull": bull.tolist(),
        "pinbar_bear": bear.tolist(),
    }


def compute_bb_bandwidth_flags(
    df: pd.DataFrame,
    window: int,
    threshold: float,
    bb_length: int = 20,
    bb_std: float = 2.0,
) -> Dict[str, List[bool]]:
    """ボリンジャーバンドの Bandwidth 変化率による拡大/収縮判定。

    Bandwidth = (Upper - Lower) / Middle

    判定:
    - 直近 window 本の平均 bandwidth を基準
    - current > avg * (1 + threshold) → expansion
    - current < avg * (1 - threshold) → squeeze

    注意:
    - 中央線 0 付近は除外（分母が極小）
    """

    close = df["close"]
    bb_df = ta.bbands(close=close, length=bb_length, std=bb_std)
    if bb_df is None or bb_df.empty:
        false_list = [False] * len(df)
        return {"bb_expansion": false_list, "bb_squeeze": false_list}

    cols = list(bb_df.columns)
    lower_col = next((c for c in cols if c.startswith("BBL_")), None)
    mid_col = next((c for c in cols if c.startswith("BBM_")), None)
    upper_col = next((c for c in cols if c.startswith("BBU_")), None)

    if not lower_col or not mid_col or not upper_col:
        false_list = [False] * len(df)
        return {"bb_expansion": false_list, "bb_squeeze": false_list}

    mid = bb_df[mid_col]
    bw = (bb_df[upper_col] - bb_df[lower_col]) / mid.replace(0, np.nan)

    avg = bw.rolling(window=window, min_periods=window).mean()

    exp = bw > (avg * (1.0 + threshold))
    sqz = bw < (avg * (1.0 - threshold))

    exp = exp.fillna(False)
    sqz = sqz.fillna(False)

    return {"bb_expansion": exp.astype(bool).to_list(), "bb_squeeze": sqz.astype(bool).to_list()}
