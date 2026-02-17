from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class IndicatorSpec(BaseModel):
    """pandas-ta に計算を委託する指標指定。

    注意:
    - params は指標ごとに異なるが、ここでは柔軟に受ける
    - Node 側で Zod 検証を行い、ここでも Pydantic で型を担保する
    """

    indicatorId: str = Field(..., description="例: sma, ema, rsi, macd, bb")
    params: Dict[str, float] = Field(default_factory=dict)
    field: str = Field(..., description="例: value, signal, histogram, upper, lower, middle, bandwidth")


PatternName = Literal[
    "pinbar",
    "pinbar_bull",
    "pinbar_bear",
    "hammer",
    "hammer_bull",
    "hammer_bear",
    "shooting_star",
    "engulfing_bull",
    "engulfing_bear",
    "doji",
    "thrust_bull",
    "thrust_bear",
    "bb_bandwidth",
]


class IndicatorSeriesRequest(BaseModel):
    symbol: str
    timeframe: str
    startDate: datetime
    endDate: datetime
    indicators: List[IndicatorSpec] = Field(default_factory=list)

    # パターン判定の要求（必要なものだけ計算して返す）
    patterns: List[PatternName] = Field(default_factory=list)

    # BB Bandwidth 判定パラメータ
    bbBandwidthWindow: int = Field(20, ge=2, le=500)
    bbBandwidthThreshold: float = Field(0.2, ge=0.0, le=10.0)


class IndicatorSeriesByVersionRequest(BaseModel):
    """Node 側から最小情報（ID + 期間）だけを受け取り、
    StrategyVersion の entryConditions を DB から取得して必要指標を決定する。
    """

    strategyId: str
    versionId: str

    symbol: str
    timeframe: str
    startDate: datetime
    endDate: datetime

    patterns: List[PatternName] = Field(default_factory=list)
    bbBandwidthWindow: int = Field(20, ge=2, le=500)
    bbBandwidthThreshold: float = Field(0.2, ge=0.0, le=10.0)


class IndicatorSeriesResponse(BaseModel):
    symbol: str
    timeframe: str
    timestamps: List[str]

    # key は Node 側で使用する cacheKey（indicatorId + params + field を安定文字列化）
    series: Dict[str, List[Optional[float]]]

    # パターンは boolean 系
    patterns: Dict[str, List[bool]] = Field(default_factory=dict)
