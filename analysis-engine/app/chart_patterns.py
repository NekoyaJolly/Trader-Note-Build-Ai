"""Chart Pattern (N-bar structural) detection (Phase 7b).

設計書: `docs/design/phase_7_specification.md` §5.2

本モジュールは末尾バー時点での chart pattern (N-bar 構造) 検出結果を
**ChartPatternsPayload** として返す。Phase 7a `smc.py` と同パターン。

実装方針:
- Phase 7a SMC と同じく決定論的ヒューリスティック
- pivot 検出は `smc.py` の `_detect_pivots` と同等 (本モジュール内に閉じる)
- 11 種のパターン + NONE を検出、同時複数検出時は confidence が高い 1 つを返す
- 「パターン」(ローソク足) と区別するため、本書では **chart pattern** = N-bar 構造を指す

検出パターン (KICKOFF §5.2):
1. FLAG — 大きな impulse 後の 3-10 本の並行 channel (consolidation)
2. PENNANT — 大きな impulse 後の 3-10 本の収束 (small triangle)
3. TRIANGLE_ASC — 高値水平 (flat resistance) + 安値上昇 (rising support)
4. TRIANGLE_DESC — 高値下降 + 安値水平
5. TRIANGLE_SYM — 高値下降 + 安値上昇 (両者中央収束)
6. HEAD_SHOULDER — 3 高値 (中央が最高)
7. INV_HEAD_SHOULDER — 3 安値 (中央が最低)
8. DOUBLE_TOP — 2 高値 (価格距離 ≤ 0.3%)
9. DOUBLE_BOTTOM — 2 安値
10. WEDGE_RISE — 高値・安値とも上昇、ただし収束
11. WEDGE_FALL — 高値・安値とも下降、ただし収束

数式 / 閾値はチューニング余地あり (Phase 7 完了後の運用観察で再評価)。
"""

from __future__ import annotations

from typing import List, Literal, Tuple

import pandas as pd

from .schemas import ChartPatternsPayload


# ----------------------------------------------------------------------------
# 共通パラメータ (Phase 7b 仕様)
# ----------------------------------------------------------------------------

# Phase 7a (smc.py) と同値の pivot 検出パラメータ
DEFAULT_LEFT_BARS = 5
DEFAULT_RIGHT_BARS = 5

# パターン形成バー数の許容範囲
MIN_PATTERN_BARS = 5
MAX_PATTERN_BARS = 30

# 価格一致判定の許容誤差 (DOUBLE_TOP / DOUBLE_BOTTOM など、相対誤差)
PRICE_MATCH_TOLERANCE = 0.003  # 0.3%

# 「水平」判定の許容傾き (相対変化率、TRIANGLE_ASC / DESC の flat side)
HORIZONTAL_SLOPE_TOLERANCE = 0.0015  # 0.15%

# Pattern break imminent 判定: 最終バーから N 本以内に break すれば imminent
BREAK_IMMINENT_THRESHOLD = 3


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
# 個別パターン検出ヘルパー
# ----------------------------------------------------------------------------

ChartPatternLabel = Literal[
    "FLAG",
    "PENNANT",
    "TRIANGLE_ASC",
    "TRIANGLE_DESC",
    "TRIANGLE_SYM",
    "HEAD_SHOULDER",
    "INV_HEAD_SHOULDER",
    "DOUBLE_TOP",
    "DOUBLE_BOTTOM",
    "WEDGE_RISE",
    "WEDGE_FALL",
    "NONE",
]

DirectionBias = Literal["BULL", "BEAR", "NEUTRAL"]


def _slope(values: List[float], indices: List[int]) -> float:
    """単純線形回帰の slope (= 回帰直線の傾き / 平均値) を返す。

    相対傾き (= price 変化率) で返すことで、symbol 価格規模に依らず使える。
    `values` と `indices` の長さは一致前提。
    """
    if len(values) < 2:
        return 0.0
    avg = sum(values) / len(values)
    if avg == 0.0:
        return 0.0
    # 単純 least squares: slope = sum((x-x̄)(y-ȳ)) / sum((x-x̄)²)
    n = len(indices)
    x_mean = sum(indices) / n
    y_mean = avg
    num = sum((indices[i] - x_mean) * (values[i] - y_mean) for i in range(n))
    den = sum((indices[i] - x_mean) ** 2 for i in range(n))
    if den == 0.0:
        return 0.0
    return (num / den) / avg  # 相対傾き


def _detect_double_pattern(
    pivots: List[int],
    prices: List[float],
    is_top: bool,
) -> Tuple[float, int]:
    """DOUBLE_TOP / DOUBLE_BOTTOM の confidence + パターン形成バー数を返す。

    最新 2 つの同方向 pivot の価格が一致 (相対距離 ≤ PRICE_MATCH_TOLERANCE) すれば検出。
    confidence は「価格差が許容範囲内のどれだけ中央に近いか」(0-1)。
    """
    if len(pivots) < 2:
        return 0.0, 0
    last = pivots[-1]
    prev = pivots[-2]
    p_last = prices[-1]
    p_prev = prices[-2]
    if max(p_last, p_prev) == 0:
        return 0.0, 0
    rel_diff = abs(p_last - p_prev) / max(p_last, p_prev)
    if rel_diff > PRICE_MATCH_TOLERANCE:
        return 0.0, 0
    confidence = 1.0 - (rel_diff / PRICE_MATCH_TOLERANCE)
    bars = last - prev
    return confidence, bars


def _detect_head_shoulder(
    pivots: List[int],
    prices: List[float],
    is_inverted: bool,
) -> Tuple[float, int]:
    """HEAD_SHOULDER / INV_HEAD_SHOULDER の confidence + 形成バー数を返す。

    最新 3 つの同方向 pivot で:
    - HEAD_SHOULDER: 中央が最高 (left_shoulder < head > right_shoulder)
    - INV_HEAD_SHOULDER: 中央が最低
    かつ 両肩の価格が一致に近い (相対距離 ≤ PRICE_MATCH_TOLERANCE)。
    """
    if len(pivots) < 3:
        return 0.0, 0
    left = prices[-3]
    head = prices[-2]
    right = prices[-1]

    if is_inverted:
        if not (head < left and head < right):
            return 0.0, 0
    else:
        if not (head > left and head > right):
            return 0.0, 0

    if max(left, right) == 0:
        return 0.0, 0
    shoulder_diff = abs(left - right) / max(left, right)
    if shoulder_diff > PRICE_MATCH_TOLERANCE:
        return 0.0, 0
    confidence = 1.0 - (shoulder_diff / PRICE_MATCH_TOLERANCE)
    bars = pivots[-1] - pivots[-3]
    return confidence, bars


def _detect_triangle_or_wedge(
    high_indices: List[int],
    low_indices: List[int],
    df: pd.DataFrame,
) -> Tuple[ChartPatternLabel, float, int, DirectionBias]:
    """TRIANGLE_ASC / DESC / SYM / WEDGE_RISE / FALL を判定。

    直近 N 本 (= MIN/MAX_PATTERN_BARS 内) の swing high/low 系列を線形回帰し、
    高値線と安値線の傾きから:
    - 両方水平に近い → not detected (range は本パターン群の対象外)
    - 高値水平 + 安値上昇 → TRIANGLE_ASC (BULL bias)
    - 高値下降 + 安値水平 → TRIANGLE_DESC (BEAR bias)
    - 高値下降 + 安値上昇 → TRIANGLE_SYM (NEUTRAL)
    - 高値上昇 + 安値上昇 (= 上昇収束、高値傾き > 安値傾き) → WEDGE_RISE (BEAR bias)
    - 高値下降 + 安値下降 (= 下降収束、|安値傾き| > |高値傾き|) → WEDGE_FALL (BULL bias)
    """
    n = len(df)
    if n == 0:
        return ("NONE", 0.0, 0, "NEUTRAL")

    # 直近 MAX_PATTERN_BARS 本以内の pivot を取得
    cutoff = max(0, n - MAX_PATTERN_BARS)
    highs_recent = [(i, df["high"].iloc[i]) for i in high_indices if i >= cutoff]
    lows_recent = [(i, df["low"].iloc[i]) for i in low_indices if i >= cutoff]

    if len(highs_recent) < 2 or len(lows_recent) < 2:
        return ("NONE", 0.0, 0, "NEUTRAL")

    high_slope = _slope([p for _, p in highs_recent], [i for i, _ in highs_recent])
    low_slope = _slope([p for _, p in lows_recent], [i for i, _ in lows_recent])

    high_flat = abs(high_slope) < HORIZONTAL_SLOPE_TOLERANCE
    low_flat = abs(low_slope) < HORIZONTAL_SLOPE_TOLERANCE

    bars = max(highs_recent[-1][0], lows_recent[-1][0]) - min(
        highs_recent[0][0], lows_recent[0][0]
    )
    confidence = 0.5  # base confidence、簡素化

    if high_flat and low_flat:
        return ("NONE", 0.0, 0, "NEUTRAL")

    if high_flat and low_slope > 0:
        return ("TRIANGLE_ASC", confidence, bars, "BULL")
    if low_flat and high_slope < 0:
        return ("TRIANGLE_DESC", confidence, bars, "BEAR")
    if high_slope < 0 and low_slope > 0:
        return ("TRIANGLE_SYM", confidence, bars, "NEUTRAL")
    if high_slope > 0 and low_slope > 0:
        # 上昇収束 (= 高値傾きが安値傾きより小さい)
        if abs(high_slope) < abs(low_slope):
            return ("WEDGE_RISE", confidence, bars, "BEAR")
    if high_slope < 0 and low_slope < 0:
        # 下降収束 (= |安値傾き| が |高値傾き| より小さい)
        if abs(low_slope) < abs(high_slope):
            return ("WEDGE_FALL", confidence, bars, "BULL")

    return ("NONE", 0.0, 0, "NEUTRAL")


def _detect_flag_pennant(
    df: pd.DataFrame,
    high_indices: List[int],
    low_indices: List[int],
) -> Tuple[ChartPatternLabel, float, int, DirectionBias]:
    """FLAG / PENNANT の判定。

    簡易定義 (Phase 7b):
    - 直近 MAX_PATTERN_BARS 本以内に大きな impulse (= 直前 20 本の平均レンジの 2 倍以上)
    - その後 3-10 本の consolidation
    - consolidation 内で 高値 / 安値 が並行 (= FLAG) または収束 (= PENNANT)

    Phase 7b 簡素化版: impulse の検出を簡略化、consolidation を 5-10 本固定で判定。
    """
    n = len(df)
    if n < 20:
        return ("NONE", 0.0, 0, "NEUTRAL")

    # 直前 20 本の平均 (high-low) レンジ
    avg_range = (df["high"].iloc[-20:] - df["low"].iloc[-20:]).mean()
    if avg_range == 0:
        return ("NONE", 0.0, 0, "NEUTRAL")

    # 直近 10 本のうち最大 (high - low) を持つバーが impulse の起点 (簡素化)
    last10_range = df["high"].iloc[-10:] - df["low"].iloc[-10:]
    impulse_bar = last10_range.idxmax() if not last10_range.empty else None
    if impulse_bar is None:
        return ("NONE", 0.0, 0, "NEUTRAL")

    impulse_range = df["high"].iloc[impulse_bar] - df["low"].iloc[impulse_bar]
    if impulse_range < 2.0 * avg_range:
        return ("NONE", 0.0, 0, "NEUTRAL")

    # impulse 起点 → 末尾までを consolidation とみなす (5-10 本)
    consolidation_bars = (n - 1) - impulse_bar
    if consolidation_bars < 3 or consolidation_bars > 15:
        return ("NONE", 0.0, 0, "NEUTRAL")

    # consolidation 内 (impulse 起点+1 以降) の 高値 / 安値 を線形回帰
    cons_slice = df.iloc[impulse_bar + 1 :]
    if len(cons_slice) < 3:
        return ("NONE", 0.0, 0, "NEUTRAL")

    highs = cons_slice["high"].tolist()
    lows = cons_slice["low"].tolist()
    indices = list(range(len(cons_slice)))

    high_slope = _slope(highs, indices)
    low_slope = _slope(lows, indices)

    # impulse の方向 (close 比較)
    impulse_open = df["open"].iloc[impulse_bar]
    impulse_close = df["close"].iloc[impulse_bar]
    bias: DirectionBias = "BULL" if impulse_close > impulse_open else "BEAR"

    # FLAG: 高値 / 安値の傾きがほぼ同じ (並行)
    if abs(high_slope - low_slope) < HORIZONTAL_SLOPE_TOLERANCE:
        return ("FLAG", 0.55, consolidation_bars, bias)

    # PENNANT: 収束 (高値下降 + 安値上昇、もしくは逆)
    if high_slope < 0 and low_slope > 0:
        return ("PENNANT", 0.55, consolidation_bars, bias)

    return ("NONE", 0.0, 0, "NEUTRAL")


def _compute_break_imminent(
    df: pd.DataFrame,
    pattern: ChartPatternLabel,
) -> bool:
    """Pattern の breakout / breakdown が直近 BREAK_IMMINENT_THRESHOLD 本以内に
    起きそうかの簡易判定。

    Phase 7b 簡素化版: 直近 3 本の close が、直近 10 本の高値 / 安値の境界線に
    対して BREAK_IMMINENT_THRESHOLD 本以内に到達していれば true。
    """
    if pattern == "NONE":
        return False
    n = len(df)
    if n < 10:
        return False

    recent_high = df["high"].iloc[-10:].max()
    recent_low = df["low"].iloc[-10:].min()
    last_close = df["close"].iloc[-1]
    band = recent_high - recent_low
    if band == 0:
        return False

    distance_to_high = (recent_high - last_close) / band
    distance_to_low = (last_close - recent_low) / band

    # 境界線まで 5% 以内なら imminent
    return distance_to_high < 0.05 or distance_to_low < 0.05


# ----------------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------------


def compute_chart_patterns(df: pd.DataFrame) -> ChartPatternsPayload:
    """OHLCV DataFrame を受け取り、末尾バー時点の chart pattern 観測結果を返す。

    同時複数パターンが検出される場合、**confidence が最も高い 1 つ**を採用する。
    どれも検出されなければ `pattern_detected: 'NONE'`、`pattern_confidence: 0.0`。
    """
    if df is None or len(df) == 0:
        return ChartPatternsPayload()

    high_indices, low_indices = _detect_pivots(df)

    candidates: List[Tuple[ChartPatternLabel, float, int, DirectionBias]] = []

    # DOUBLE_TOP
    if high_indices:
        conf, bars = _detect_double_pattern(
            high_indices,
            [df["high"].iloc[i] for i in high_indices],
            is_top=True,
        )
        if conf > 0.0:
            candidates.append(("DOUBLE_TOP", conf, bars, "BEAR"))

    # DOUBLE_BOTTOM
    if low_indices:
        conf, bars = _detect_double_pattern(
            low_indices,
            [df["low"].iloc[i] for i in low_indices],
            is_top=False,
        )
        if conf > 0.0:
            candidates.append(("DOUBLE_BOTTOM", conf, bars, "BULL"))

    # HEAD_SHOULDER (高値 3 つ)
    if len(high_indices) >= 3:
        conf, bars = _detect_head_shoulder(
            high_indices,
            [df["high"].iloc[i] for i in high_indices],
            is_inverted=False,
        )
        if conf > 0.0:
            candidates.append(("HEAD_SHOULDER", conf, bars, "BEAR"))

    # INV_HEAD_SHOULDER (安値 3 つ)
    if len(low_indices) >= 3:
        conf, bars = _detect_head_shoulder(
            low_indices,
            [df["low"].iloc[i] for i in low_indices],
            is_inverted=True,
        )
        if conf > 0.0:
            candidates.append(("INV_HEAD_SHOULDER", conf, bars, "BULL"))

    # TRIANGLE / WEDGE
    tw_label, tw_conf, tw_bars, tw_bias = _detect_triangle_or_wedge(
        high_indices, low_indices, df
    )
    if tw_label != "NONE" and tw_conf > 0.0:
        candidates.append((tw_label, tw_conf, tw_bars, tw_bias))

    # FLAG / PENNANT
    fp_label, fp_conf, fp_bars, fp_bias = _detect_flag_pennant(
        df, high_indices, low_indices
    )
    if fp_label != "NONE" and fp_conf > 0.0:
        candidates.append((fp_label, fp_conf, fp_bars, fp_bias))

    if not candidates:
        return ChartPatternsPayload(
            patternDetected="NONE",
            patternConfidence=0.0,
            patternBreakImminent=False,
            patternBarsCount=0,
            patternDirectionBias="NEUTRAL",
        )

    # confidence が最大のパターンを採用
    best = max(candidates, key=lambda c: c[1])
    label, confidence, bars, bias = best
    break_imminent = _compute_break_imminent(df, label)

    return ChartPatternsPayload(
        patternDetected=label,
        patternConfidence=float(confidence),
        patternBreakImminent=bool(break_imminent),
        patternBarsCount=int(bars),
        patternDirectionBias=bias,
    )
