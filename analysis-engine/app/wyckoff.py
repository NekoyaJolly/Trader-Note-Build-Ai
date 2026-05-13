"""Wyckoff phase / signal detection (Phase 7c).

設計書: `docs/design/phase_7_specification.md` §5.4

本モジュールは末尾バー時点での Wyckoff phase 判定 + 主要シグナル (Spring / Upthrust /
SOS / SOW) の検出結果を **WyckoffPhasesPayload** として返す。Phase 7a SMC / 7b ChartPattern
と同じ 2 層パターン (analysis-engine 計算 + side-b 薄い wrapper)。

実装方針:
- 決定論的ヒューリスティック (LLM や乱数なし)
- pivot 検出は smc.py / chart_patterns.py と同等ロジック (本モジュール内に閉じる)
- **SMC 結果 (Phase 7a) を input として活用可能**: SMC BOS / CHOCH 情報を phase 判定の補助に使う
- volume があれば利用、無くても基本判定は動く

検出項目 (KICKOFF §5.4):
1. wyckoff_phase: ACCUMULATION / MARKUP / DISTRIBUTION / MARKDOWN / RE_ACCUMULATION / RE_DISTRIBUTION / UNKNOWN
2. wyckoff_phase_confidence: 0-1
3. spring_detected_in_last_20_bars: bool
4. upthrust_detected_in_last_20_bars: bool
5. last_sos_bars_ago: number (sentinel -1 = なし)
6. last_sow_bars_ago: number (sentinel -1 = なし)

数式 / 閾値はチューニング余地あり (Phase 7 完了後の運用観察で再評価)。
"""

from __future__ import annotations

from typing import List, Literal, Optional, Tuple

import pandas as pd

from .schemas import SmcStructuresPayload, WyckoffPhasesPayload


# ----------------------------------------------------------------------------
# 共通パラメータ (Phase 7c 仕様)
# ----------------------------------------------------------------------------

# pivot 検出 (smc.py / chart_patterns.py と同値)
DEFAULT_LEFT_BARS = 5
DEFAULT_RIGHT_BARS = 5

# Spring / Upthrust 検出の lookback
SPRING_UPTHRUST_LOOKBACK = 20

# SOS / SOW 検出の lookback (= 直近何本まで遡って探すか)
SOS_SOW_LOOKBACK = 30

# 「strong impulse」の閾値 (= 直前 20 本平均レンジの何倍以上で SOS / SOW とみなすか)
IMPULSE_STRENGTH_MULTIPLIER = 2.0

# 「high volume」の閾値 (= 直前 20 本平均 volume の何倍以上で「強い」と判定)
HIGH_VOLUME_MULTIPLIER = 1.5

# Phase 判定: 直近 N 本の close 系列の傾きで trend 方向を判定
PHASE_TREND_LOOKBACK = 30

# Trend 強度の閾値 (相対変化率)
TREND_STRONG_THRESHOLD = 0.005  # 0.5% per bar (相対傾き)
TREND_FLAT_THRESHOLD = 0.0005   # 0.05% per bar


# ----------------------------------------------------------------------------
# Pivot 検出 (smc.py と同じロジック、本モジュール内コピー)
# ----------------------------------------------------------------------------


def _detect_pivots(
    df: pd.DataFrame,
    left_bars: int = DEFAULT_LEFT_BARS,
    right_bars: int = DEFAULT_RIGHT_BARS,
) -> Tuple[List[int], List[int]]:
    """Return (high_indices, low_indices) - bar indices of swing highs/lows."""
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
# 個別シグナル検出
# ----------------------------------------------------------------------------


def _detect_spring(
    df: pd.DataFrame,
    low_indices: List[int],
) -> bool:
    """Spring 検出: 直近 SPRING_UPTHRUST_LOOKBACK 本以内に swing low を一時的に
    割って戻った candle があれば True。

    Spring の定義 (簡素化):
    - swing low の low を bar[i] の low が下回る (= 一時的に割る)
    - bar[i] の close が swing low の low より上 (= すぐ戻る)
    - bar[i] が末尾から SPRING_UPTHRUST_LOOKBACK 本以内
    """
    n = len(df)
    if n == 0 or not low_indices:
        return False

    cutoff = n - SPRING_UPTHRUST_LOOKBACK
    lows = df["low"].to_numpy()
    closes = df["close"].to_numpy()

    for swing_idx in low_indices:
        swing_low_price = lows[swing_idx]
        # 直近 lookback 内に swing low より下にいったが close で戻った bar
        for i in range(max(swing_idx + 1, cutoff), n):
            if lows[i] < swing_low_price and closes[i] > swing_low_price:
                return True

    return False


def _detect_upthrust(
    df: pd.DataFrame,
    high_indices: List[int],
) -> bool:
    """Upthrust 検出: 直近 SPRING_UPTHRUST_LOOKBACK 本以内に swing high を一時的に
    超えて戻った candle があれば True。

    Upthrust の定義 (簡素化):
    - swing high の high を bar[i] の high が上回る (= 一時的に超える)
    - bar[i] の close が swing high の high より下 (= すぐ戻る)
    - bar[i] が末尾から SPRING_UPTHRUST_LOOKBACK 本以内
    """
    n = len(df)
    if n == 0 or not high_indices:
        return False

    cutoff = n - SPRING_UPTHRUST_LOOKBACK
    highs = df["high"].to_numpy()
    closes = df["close"].to_numpy()

    for swing_idx in high_indices:
        swing_high_price = highs[swing_idx]
        for i in range(max(swing_idx + 1, cutoff), n):
            if highs[i] > swing_high_price and closes[i] < swing_high_price:
                return True

    return False


def _detect_sos_sow(df: pd.DataFrame) -> Tuple[int, int]:
    """SOS (Sign of Strength) / SOW (Sign of Weakness) 検出。

    SOS 定義: 上昇 impulse (= 5 本以内の close 差が直前 20 本平均レンジの 2 倍以上)
              + volume が直前 20 本平均の 1.5 倍以上 (volume column があれば)
    SOW 定義: 下降 impulse + 高 volume

    Returns:
        (last_sos_bars_ago, last_sow_bars_ago) — なし時 (-1, -1)
    """
    n = len(df)
    if n < 25:  # 20 (avg) + 5 (impulse)
        return -1, -1

    cutoff = max(20, n - SOS_SOW_LOOKBACK)
    closes = df["close"].to_numpy()
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    avg_range_20 = (highs[-20:] - lows[-20:]).mean()
    if avg_range_20 == 0:
        return -1, -1

    has_volume = "volume" in df.columns
    volumes = df["volume"].to_numpy() if has_volume else None
    avg_volume_20 = None
    if has_volume and volumes is not None:
        avg_volume_20 = volumes[-20:].mean()

    last_sos_bar = -1
    last_sow_bar = -1

    # 5-bar lookback で impulse 検出
    for i in range(cutoff, n):
        if i - 5 < 0:
            continue
        close_diff = closes[i] - closes[i - 5]
        # SOS 候補: 5 本で大きく上昇
        if close_diff >= IMPULSE_STRENGTH_MULTIPLIER * avg_range_20:
            if has_volume and volumes is not None and avg_volume_20 is not None and avg_volume_20 > 0:
                if volumes[i] >= HIGH_VOLUME_MULTIPLIER * avg_volume_20:
                    last_sos_bar = i
            else:
                # volume なしでも上昇 impulse のみで SOS とみなす (簡素化)
                last_sos_bar = i
        # SOW 候補: 5 本で大きく下降
        elif -close_diff >= IMPULSE_STRENGTH_MULTIPLIER * avg_range_20:
            if has_volume and volumes is not None and avg_volume_20 is not None and avg_volume_20 > 0:
                if volumes[i] >= HIGH_VOLUME_MULTIPLIER * avg_volume_20:
                    last_sow_bar = i
            else:
                last_sow_bar = i

    last_sos_bars_ago = (n - 1 - last_sos_bar) if last_sos_bar >= 0 else -1
    last_sow_bars_ago = (n - 1 - last_sow_bar) if last_sow_bar >= 0 else -1
    return last_sos_bars_ago, last_sow_bars_ago


# ----------------------------------------------------------------------------
# Phase 判定 (SMC 結果を活用)
# ----------------------------------------------------------------------------


def _classify_phase(
    df: pd.DataFrame,
    smc_context: Optional[SmcStructuresPayload],
) -> Tuple[
    Literal[
        "ACCUMULATION",
        "MARKUP",
        "DISTRIBUTION",
        "MARKDOWN",
        "RE_ACCUMULATION",
        "RE_DISTRIBUTION",
        "UNKNOWN",
    ],
    float,
]:
    """Wyckoff phase を判定する。

    判定アルゴリズム (Phase 7c 簡素化版):
    1. 直近 PHASE_TREND_LOOKBACK 本の close 系列の相対傾きを計算
    2. trend 状態を分類: strong_up / weak_up / flat / weak_down / strong_down
    3. SMC context があれば BOS / CHOCH 情報で補強:
       - SMC.lastStructureEvent == 'BOS_BULL' → MARKUP 寄り
       - SMC.lastStructureEvent == 'BOS_BEAR' → MARKDOWN 寄り
       - SMC.lastStructureEvent == 'CHOCH_BULL' → ACCUMULATION 終端 / MARKUP 開始 (RE_ACCUMULATION 候補)
       - SMC.lastStructureEvent == 'CHOCH_BEAR' → DISTRIBUTION 終端 / MARKDOWN 開始 (RE_DISTRIBUTION 候補)
    4. trend と SMC を組み合わせて最終 phase を決定:
       - strong_up + BOS_BULL → MARKUP (confidence 高)
       - strong_down + BOS_BEAR → MARKDOWN
       - flat + CHOCH_BULL → ACCUMULATION 終盤
       - flat + CHOCH_BEAR → DISTRIBUTION 終盤
       - flat (CHOCH なし) → ACCUMULATION or DISTRIBUTION (zone position で決定)
    5. それ以外は UNKNOWN
    """
    n = len(df)
    if n < PHASE_TREND_LOOKBACK:
        return "UNKNOWN", 0.0

    # Trend slope (相対変化率)
    closes_recent = df["close"].iloc[-PHASE_TREND_LOOKBACK:].to_numpy()
    indices = list(range(len(closes_recent)))
    avg_close = closes_recent.mean()
    if avg_close == 0:
        return "UNKNOWN", 0.0

    n_seq = len(closes_recent)
    x_mean = sum(indices) / n_seq
    y_mean = avg_close
    num = sum((indices[i] - x_mean) * (closes_recent[i] - y_mean) for i in range(n_seq))
    den = sum((indices[i] - x_mean) ** 2 for i in range(n_seq))
    if den == 0:
        return "UNKNOWN", 0.0
    relative_slope = (num / den) / avg_close

    is_strong_up = relative_slope > TREND_STRONG_THRESHOLD
    is_strong_down = relative_slope < -TREND_STRONG_THRESHOLD
    is_flat = abs(relative_slope) < TREND_FLAT_THRESHOLD

    smc_event = smc_context.lastStructureEvent if smc_context is not None else "NONE"

    # Strong trend + SMC BOS 一致 → 高 confidence
    if is_strong_up and smc_event == "BOS_BULL":
        return "MARKUP", 0.85
    if is_strong_down and smc_event == "BOS_BEAR":
        return "MARKDOWN", 0.85

    # CHOCH + flat → 転換点 (RE_ACCUMULATION / RE_DISTRIBUTION 候補)
    if is_flat and smc_event == "CHOCH_BULL":
        return "RE_ACCUMULATION", 0.65
    if is_flat and smc_event == "CHOCH_BEAR":
        return "RE_DISTRIBUTION", 0.65

    # Flat (SMC イベントなし or BOS なし) → zone で判定
    if is_flat:
        if smc_context is not None:
            if smc_context.currentZone == "DISCOUNT":
                return "ACCUMULATION", 0.55
            if smc_context.currentZone == "PREMIUM":
                return "DISTRIBUTION", 0.55
        # SMC context なし or EQUILIBRIUM → 不明
        return "UNKNOWN", 0.3

    # Strong trend but SMC 不整合 (BOS 方向が trend と逆 or NONE) → 低 confidence
    if is_strong_up:
        return "MARKUP", 0.55
    if is_strong_down:
        return "MARKDOWN", 0.55

    # weak_up / weak_down (= flat と strong の間)
    if relative_slope > 0:
        # weak up: ACCUMULATION 後の MARKUP 初期 or RE_ACCUMULATION
        return "ACCUMULATION", 0.45
    if relative_slope < 0:
        # weak down: DISTRIBUTION 後の MARKDOWN 初期 or RE_DISTRIBUTION
        return "DISTRIBUTION", 0.45

    return "UNKNOWN", 0.3


# ----------------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------------


def compute_wyckoff_phases(
    df: pd.DataFrame,
    smc_context: Optional[SmcStructuresPayload] = None,
) -> WyckoffPhasesPayload:
    """OHLCV DataFrame と (optional) SMC context を受け取り、末尾バー時点の Wyckoff
    phase 判定 + シグナル検出結果を返す。

    `smc_context` が None でも基本判定は動く (= zone / structure 補強なしの mode)。
    Phase 判定の precision は SMC context 提供時に向上する。
    """
    if df is None or len(df) == 0:
        return WyckoffPhasesPayload()

    high_indices, low_indices = _detect_pivots(df)

    spring = _detect_spring(df, low_indices)
    upthrust = _detect_upthrust(df, high_indices)
    last_sos_bars_ago, last_sow_bars_ago = _detect_sos_sow(df)
    phase, confidence = _classify_phase(df, smc_context)

    return WyckoffPhasesPayload(
        wyckoffPhase=phase,
        wyckoffPhaseConfidence=float(confidence),
        springDetectedInLast20Bars=bool(spring),
        upthrustDetectedInLast20Bars=bool(upthrust),
        lastSosBarsAgo=int(last_sos_bars_ago),
        lastSowBarsAgo=int(last_sow_bars_ago),
    )
