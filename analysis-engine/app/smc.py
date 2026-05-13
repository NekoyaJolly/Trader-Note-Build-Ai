"""SMC (Smart Money Concept) structures computation (Phase 7a).

設計書: `docs/design/phase_7_specification.md` §5.1

本モジュールは末尾バー時点での SMC 構造観測結果を **SmcStructuresPayload** として返す。
Lens features の型制約 (number / string / boolean、null 不可) に合わせ、すべての
「なし」は sentinel (-1.0 / -1 / 'NONE') で表現する。

実装方針:
- 既存 `analysis-engine/app/indicators.py` と独立。pivot 検出も本モジュール内に閉じる
  (将来 indicators.py に共通化する余地はあるが、Phase 7a では smc.py で完結)
- 決定論的ヒューリスティック (LLM や乱数を使わない)
- pandas DataFrame を入力、すべての構造判定はベクトル演算 or 単純ループ
- side-b 側 SMCLens は本 payload を `LensInput.precomputedSmcStructures` 経由で受け取る

数式 / 閾値はチューニング余地あり (Phase 7 完了後の運用観察で再評価)。
"""

from __future__ import annotations

from typing import List, Literal, Tuple

import pandas as pd

from .schemas import SmcStructuresPayload


# ----------------------------------------------------------------------------
# Pivot 検出 (本モジュール内部に閉じる、DowTheoryLens の TS 実装と等価)
# ----------------------------------------------------------------------------

# left/right 5 本 = TS 側 DEFAULT_PIVOT_CONFIG と同値
DEFAULT_LEFT_BARS = 5
DEFAULT_RIGHT_BARS = 5

# Liquidity / FVG の lookback (Phase 7a 仕様)
LIQUIDITY_LOOKBACK = 20
FVG_LOOKBACK = 20

# Swing range 算出の lookback (Zone 判定用)
SWING_RANGE_LOOKBACK = 50


def _detect_pivots(
    df: pd.DataFrame,
    left_bars: int = DEFAULT_LEFT_BARS,
    right_bars: int = DEFAULT_RIGHT_BARS,
) -> Tuple[List[int], List[int]]:
    """Return (high_indices, low_indices) - bar indices of swing highs/lows.

    末尾 right_bars 本は未確定のため候補にならない。
    """
    high_indices: List[int] = []
    low_indices: List[int] = []

    n = len(df)
    if n < left_bars + right_bars + 1:
        return high_indices, low_indices

    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()

    for i in range(left_bars, n - right_bars):
        window_high = highs[i - left_bars : i + right_bars + 1]
        window_low = lows[i - left_bars : i + right_bars + 1]
        if highs[i] == window_high.max() and not (highs[i] == highs[i - 1] and i > left_bars):
            high_indices.append(i)
        if lows[i] == window_low.min() and not (lows[i] == lows[i - 1] and i > left_bars):
            low_indices.append(i)

    return high_indices, low_indices


# ----------------------------------------------------------------------------
# SMC 個別構造の検出
# ----------------------------------------------------------------------------


def _compute_pip_size(symbol_default_pip: float = 0.1) -> float:
    """SMC features の pip 距離計算で使う pip サイズ。

    本 Phase では symbol 別 pip サイズの解決を省略し、デフォルト 0.1 (XAUUSD pip
    相当) で固定。Phase 7 完了後の運用観察で symbol 別解決を追加する。
    """
    return symbol_default_pip


def _compute_nearest_ob_distance(
    df: pd.DataFrame,
    high_indices: List[int],
    low_indices: List[int],
) -> Tuple[float, float]:
    """直近の Bull OB / Bear OB との距離 (pips) を返す。

    Order Block の簡易定義 (Phase 7a):
    - Bull OB: 直近の swing low から **後続 5 本で当該 swing low の high をブレイク** した起点 candle
    - Bear OB: 直近の swing high から **後続 5 本で当該 swing high の low をブレイク** した起点 candle

    なし時 -1.0 を返す (sentinel)。
    """
    n = len(df)
    if n == 0:
        return -1.0, -1.0

    pip = _compute_pip_size()
    current_close = df["close"].iloc[-1]

    nearest_bull_distance = -1.0
    nearest_bear_distance = -1.0

    # Bull OB candidates: swing lows where price subsequently broke the swing low's high
    for idx in reversed(low_indices):
        if idx + 5 >= n:
            continue
        swing_low_high = df["high"].iloc[idx]
        # Check if subsequent 5 bars break above swing_low_high
        post_window_high = df["high"].iloc[idx + 1 : idx + 6].max()
        if post_window_high > swing_low_high:
            # OB の price level は swing_low_high
            distance_pips = abs(current_close - swing_low_high) / pip
            nearest_bull_distance = distance_pips
            break

    # Bear OB candidates: swing highs where price subsequently broke the swing high's low
    for idx in reversed(high_indices):
        if idx + 5 >= n:
            continue
        swing_high_low = df["low"].iloc[idx]
        post_window_low = df["low"].iloc[idx + 1 : idx + 6].min()
        if post_window_low < swing_high_low:
            distance_pips = abs(current_close - swing_high_low) / pip
            nearest_bear_distance = distance_pips
            break

    return nearest_bull_distance, nearest_bear_distance


def _compute_liquidity_counts(
    df: pd.DataFrame,
    high_indices: List[int],
    low_indices: List[int],
) -> Tuple[int, int]:
    """LIQUIDITY_LOOKBACK 本以内の swing high (BSL) / swing low (SSL) 数を返す。"""
    n = len(df)
    if n == 0:
        return 0, 0

    cutoff_idx = max(0, n - LIQUIDITY_LOOKBACK)
    above_count = sum(1 for idx in high_indices if idx >= cutoff_idx)
    below_count = sum(1 for idx in low_indices if idx >= cutoff_idx)
    return above_count, below_count


def _compute_fvg_counts(df: pd.DataFrame) -> Tuple[int, int]:
    """FVG_LOOKBACK 本以内の Bull FVG / Bear FVG 数を返す。

    FVG 定義 (3-bar gap):
    - Bull FVG: bar[i-1].high < bar[i+1].low  (middle bar の wick が前 bar wick を超えない gap)
    - Bear FVG: bar[i-1].low > bar[i+1].high
    """
    n = len(df)
    if n < 3:
        return 0, 0

    cutoff_start = max(1, n - FVG_LOOKBACK)
    bull_count = 0
    bear_count = 0

    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()

    for i in range(cutoff_start, n - 1):
        if highs[i - 1] < lows[i + 1]:
            bull_count += 1
        elif lows[i - 1] > highs[i + 1]:
            bear_count += 1

    return bull_count, bear_count


def _compute_last_structure_event(
    high_indices: List[int],
    low_indices: List[int],
    n: int,
) -> Tuple[Literal["BOS_BULL", "BOS_BEAR", "CHOCH_BULL", "CHOCH_BEAR", "NONE"], int]:
    """直近の構造イベント (BOS / CHOCH) と経過バー数を返す。

    簡易定義 (Phase 7a):
    - BOS_BULL: 最新 high pivot が 1 つ前の high pivot を上回る (uptrend 継続)
    - BOS_BEAR: 最新 low pivot が 1 つ前の low pivot を下回る (downtrend 継続)
    - CHOCH_BULL: 直前 BOS_BEAR の後で BOS_BULL が発生 (trend 転換)
    - CHOCH_BEAR: 直前 BOS_BULL の後で BOS_BEAR が発生

    Phase 7a 簡素化: trend 履歴を遡らず、直近 pivot 同士の比較のみで BOS のみ判定。
    CHOCH は Phase 7c (Wyckoff phase 判定) で詳細化する余地あり。
    """
    # Need at least 2 high pivots and 2 low pivots for BOS detection
    if len(high_indices) >= 2 and len(low_indices) >= 2:
        last_high_idx = high_indices[-1]
        prev_high_idx = high_indices[-2]
        last_low_idx = low_indices[-1]
        prev_low_idx = low_indices[-2]

        # Determine most recent structure event by bar index
        events: List[Tuple[int, str]] = []
        # We can't compute price comparison without df; do this in caller
        return ("NONE", -1)  # placeholder

    return ("NONE", -1)


def _compute_last_structure_event_with_prices(
    df: pd.DataFrame,
    high_indices: List[int],
    low_indices: List[int],
) -> Tuple[Literal["BOS_BULL", "BOS_BEAR", "CHOCH_BULL", "CHOCH_BEAR", "NONE"], int]:
    """Compute last structure event using price comparisons."""
    n = len(df)
    if n == 0:
        return ("NONE", -1)

    # Need at least 2 highs and 2 lows for BOS judgment
    if len(high_indices) < 2 or len(low_indices) < 2:
        return ("NONE", -1)

    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()

    last_high_idx = high_indices[-1]
    prev_high_idx = high_indices[-2]
    last_low_idx = low_indices[-1]
    prev_low_idx = low_indices[-2]

    # BOS_BULL: 最新 high が 1 つ前の high を上回る (= 最新 high pivot bar index)
    bos_bull_bar_idx = -1
    if highs[last_high_idx] > highs[prev_high_idx]:
        bos_bull_bar_idx = last_high_idx

    # BOS_BEAR: 最新 low が 1 つ前の low を下回る
    bos_bear_bar_idx = -1
    if lows[last_low_idx] < lows[prev_low_idx]:
        bos_bear_bar_idx = last_low_idx

    if bos_bull_bar_idx >= 0 and bos_bear_bar_idx >= 0:
        # 両方発生している場合、より新しい方を採用
        if bos_bull_bar_idx > bos_bear_bar_idx:
            return ("BOS_BULL", n - 1 - bos_bull_bar_idx)
        else:
            return ("BOS_BEAR", n - 1 - bos_bear_bar_idx)
    elif bos_bull_bar_idx >= 0:
        return ("BOS_BULL", n - 1 - bos_bull_bar_idx)
    elif bos_bear_bar_idx >= 0:
        return ("BOS_BEAR", n - 1 - bos_bear_bar_idx)

    return ("NONE", -1)


def _compute_zone(
    df: pd.DataFrame,
) -> Tuple[Literal["PREMIUM", "DISCOUNT", "EQUILIBRIUM"], float]:
    """Premium / Discount / Equilibrium zone を直近 SWING_RANGE_LOOKBACK 本から判定。

    swing range 内の現在位置 (zonePositionPct):
    - 0.0 〜 0.45: DISCOUNT (下半分)
    - 0.45 〜 0.55: EQUILIBRIUM (中央 10%)
    - 0.55 〜 1.0: PREMIUM (上半分)
    """
    n = len(df)
    if n == 0:
        return ("EQUILIBRIUM", 0.5)

    lookback_start = max(0, n - SWING_RANGE_LOOKBACK)
    window = df.iloc[lookback_start:]
    high = window["high"].max()
    low = window["low"].min()
    current_close = df["close"].iloc[-1]

    if high == low:
        return ("EQUILIBRIUM", 0.5)

    position_pct = (current_close - low) / (high - low)
    # 0-1 にクランプ (浮動小数誤差対策)
    position_pct = max(0.0, min(1.0, float(position_pct)))

    if position_pct < 0.45:
        zone: Literal["PREMIUM", "DISCOUNT", "EQUILIBRIUM"] = "DISCOUNT"
    elif position_pct > 0.55:
        zone = "PREMIUM"
    else:
        zone = "EQUILIBRIUM"

    return (zone, position_pct)


# ----------------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------------


def compute_smc_structures(df: pd.DataFrame) -> SmcStructuresPayload:
    """OHLCV DataFrame を受け取り、末尾バー時点の SMC 構造観測結果を返す。

    入力 df は最低限 `['open', 'high', 'low', 'close']` 列を持つ。
    `volume` 列はあれば使う (Phase 7a では使用しない、Wyckoff で利用予定)。

    バー数が不足する場合 (= n < 11、left/right pivot 5+5+1) はデフォルト値
    (すべて sentinel) を返す。
    """
    if df is None or len(df) == 0:
        return SmcStructuresPayload()

    high_indices, low_indices = _detect_pivots(df)

    nearest_ob_bull_distance, nearest_ob_bear_distance = _compute_nearest_ob_distance(
        df, high_indices, low_indices
    )
    liquidity_above_count, liquidity_below_count = _compute_liquidity_counts(
        df, high_indices, low_indices
    )
    fvg_bull_count, fvg_bear_count = _compute_fvg_counts(df)
    last_structure_event, bars_since_last_structure_event = (
        _compute_last_structure_event_with_prices(df, high_indices, low_indices)
    )
    current_zone, zone_position_pct = _compute_zone(df)

    return SmcStructuresPayload(
        nearestObBullDistancePips=nearest_ob_bull_distance,
        nearestObBearDistancePips=nearest_ob_bear_distance,
        liquidityAboveCount=liquidity_above_count,
        liquidityBelowCount=liquidity_below_count,
        fvgBullCountLast20=fvg_bull_count,
        fvgBearCountLast20=fvg_bear_count,
        lastStructureEvent=last_structure_event,
        barsSinceLastStructureEvent=bars_since_last_structure_event,
        currentZone=current_zone,
        zonePositionPct=zone_position_pct,
    )
