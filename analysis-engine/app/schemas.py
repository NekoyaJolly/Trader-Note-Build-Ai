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


class WalkForwardEvent(BaseModel):
    entryTime: datetime
    pnl: float


class WalkForwardPeriod(BaseModel):
    start: datetime
    end: datetime


class WalkForwardRequest(BaseModel):
    events: List[WalkForwardEvent] = Field(default_factory=list)
    period: WalkForwardPeriod
    splitCount: int = Field(4, ge=1, le=50)


class WalkForwardResponse(BaseModel):
    overfitScore: float | None
    avgInSampleWinRate: float | None
    avgOutOfSampleWinRate: float | None
    inSamplePF: float | None
    outOfSamplePF: float | None
    splitCount: int
    totalTradeCount: int
    windowsEvaluated: int


# ============================================
# Critical-4 段階 1: スクリーニング BT
# ============================================


class ScreeningBacktestCondition(BaseModel):
    """仮説の MachineReadableCondition (Node 側と同形)。

    段階 1 では Python 側でレンズ feature の評価機構を持たないため、
    実際にはエントリー条件として使われず unsupportedConditions に積まれる。
    """

    lensName: str
    featureKey: str
    op: Literal["<", "<=", ">", ">=", "==", "!=", "between", "in"]
    value: Any


class ScreeningBacktestStopLoss(BaseModel):
    type: Literal["atr_multiple", "fixed_pips", "swing_point"]
    value: Optional[float] = None
    lookbackBars: Optional[int] = None


class ScreeningBacktestTakeProfit(BaseModel):
    type: Literal["rr_ratio", "atr_multiple", "fixed_pips"]
    value: float


class ScreeningBacktestNotePayload(BaseModel):
    direction: Literal["long", "short", "either"]
    conditions: List[ScreeningBacktestCondition] = Field(default_factory=list)
    stopLoss: ScreeningBacktestStopLoss
    takeProfit: ScreeningBacktestTakeProfit
    indicators: List[IndicatorSpec] = Field(default_factory=list)
    maxHoldingBars: Optional[int] = None


class ScreeningBacktestConfig(BaseModel):
    initialCapital: float = Field(default=10_000.0, gt=0)
    leverage: float = Field(default=1.0, gt=0)
    tradingCost: float = Field(default=0.0, ge=0)


class ScreeningBacktestRequest(BaseModel):
    hypothesisId: str
    symbol: str
    timeframe: str
    startDate: datetime
    endDate: datetime
    notePayload: ScreeningBacktestNotePayload
    config: ScreeningBacktestConfig = Field(default_factory=ScreeningBacktestConfig)


class ScreeningBacktestSummary(BaseModel):
    pf: float
    winRate: float
    tradeCount: int
    maxDD: Optional[float] = None
    sharpe: Optional[float] = None
    returnPct: Optional[float] = None


class ScreeningBacktestTrade(BaseModel):
    entryTime: datetime
    entryPrice: float
    exitTime: Optional[datetime] = None
    exitPrice: Optional[float] = None
    side: Literal["long", "short"]
    pnl: float
    outcome: Literal["win", "loss", "timeout"]


class ScreeningBacktestResponse(BaseModel):
    summary: ScreeningBacktestSummary
    trades: List[ScreeningBacktestTrade] = Field(default_factory=list)
    equity: Optional[List[float]] = None
    engineVersion: str
    unsupportedConditions: List[str] = Field(default_factory=list)


# ============================================
# Critical-4 PR #109: OOS Validation
# ============================================
#
# 設計方針 (docs/design/pr_105_analysis_engine_authority_addendum.md):
#   - 評価の正本は analysis-engine 側。Side-B (Evolution layer) では再判定しない。
#   - 本 endpoint は ScreeningBacktest を OOS 期間で実行し、保守的 verdict (passed/failed/unknown)
#     を **analysis-engine 側で決定** して返す。
#   - 既存 endpoint には一切手を入れない (= 完全 additive)。

OosVerdict = Literal["passed", "failed", "unknown"]
OosFailureReason = Literal[
    "low_oos_pf",
    "insufficient_oos_trades",
    "high_oos_drawdown",
    "oos_engine_error",
    "insufficient_oos_data",
    "unknown",
]


class OosValidationThresholds(BaseModel):
    """OOS verdict 判定の保守的閾値。Side-B からも override 可能。"""

    minOosPf: float = Field(default=1.0, gt=0, description="OOS 期間の PF 下限")
    minOosTrades: int = Field(default=20, ge=0, description="OOS 期間の最低 trade 数")
    maxOosDrawdown: float = Field(
        default=30.0,
        gt=0,
        description="OOS 期間の最大 maxDD (% スケール)。これを超えると failed",
    )


class OosValidationRequest(BaseModel):
    """`/v1/oos-validation` のリクエスト。

    `ScreeningBacktestRequest` と同じ DSL/期間情報を受け取り、analysis-engine 側で
    OOS 期間の BT を実行 + verdict 判定する。`startDate` / `endDate` は **既に
    OOS 期間に切り出された範囲** を渡す前提 (= split 計算は Side-B 側 adapter で実施済み)。
    """

    hypothesisId: str
    symbol: str
    timeframe: str
    startDate: datetime
    endDate: datetime
    notePayload: ScreeningBacktestNotePayload
    config: ScreeningBacktestConfig = Field(default_factory=ScreeningBacktestConfig)
    thresholds: OosValidationThresholds = Field(default_factory=OosValidationThresholds)


class OosValidationMetrics(BaseModel):
    """OOS 期間の metrics。Side-B `OosMetrics` (TS) と互換な命名で運ぶ。"""

    pf: Optional[float] = None
    tradeCount: int = 0
    maxDrawdown: Optional[float] = None
    expectancy: Optional[float] = None
    winRate: Optional[float] = None


class OosValidationResponse(BaseModel):
    """`/v1/oos-validation` のレスポンス。Side-B `OosBacktestRunnerResult` (TS) と互換。"""

    metrics: OosValidationMetrics
    verdict: OosVerdict
    failureReasons: List[OosFailureReason] = Field(default_factory=list)
    evaluationKind: Literal["oos"] = "oos"
    warnings: List[str] = Field(default_factory=list)
    engineVersion: str
    unsupportedConditions: List[str] = Field(default_factory=list)
