from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


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


# PR #120 Copilot review #7: 期間系パラメータキー (TS schema.ts INTEGER_PARAM_KEYS と整合)。
# これらは `compute_indicator_series` で `int(...)` 切り捨てが起きるため、
# 非整数を許すと snapshot key (`period=20.5`) と実計算 (`length=20`) が不一致になる。
_INTEGER_PARAM_KEYS = frozenset(
    [
        "period",
        "fastPeriod",
        "slowPeriod",
        "signalPeriod",
        "kPeriod",
        "dPeriod",
        "lookbackBars",
        "displacement",
        "spanBPeriod",
        "basePeriod",
        "conversionPeriod",
    ]
)


def _validate_finite_non_bool_params(params: Optional[Dict[str, float]]) -> Optional[Dict[str, float]]:
    """PR #118 Copilot review #5: params の値検証。

    - bool は弾く (Python の bool は int の subclass で `Dict[str, float]` を素通り
      してしまう。TS 側 `z.number()` と挙動を揃える)
    - NaN / Infinity も弾く (snapshot key 構築で例外になる前に早期検出)

    PR #120 Copilot review #7: 期間系キー (`period` / `*Period` / `lookbackBars` 等)
    は **整数 + 正値** であることを強制する。snapshot key と実計算 (`int(...)` 切り捨て)
    のズレを防ぐ。
    """
    if params is None:
        return None
    for k, v in params.items():
        if isinstance(v, bool):
            raise ValueError(f"params の値に bool は使えない (key={k}, value={v!r})")
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            raise ValueError(f"params の値に非有限値は使えない (key={k}, value={v})")
        if k in _INTEGER_PARAM_KEYS:
            # int 値、または整数値の float (例: 14.0) のみ許可。20.5 等は弾く。
            is_integer_valued = isinstance(v, int) or (isinstance(v, float) and v.is_integer())
            if not is_integer_valued:
                raise ValueError(
                    f"params の {k} は整数である必要がある (got: {v!r})"
                )
            if v <= 0:
                raise ValueError(
                    f"params の {k} は正の値である必要がある (got: {v})"
                )
    return params


class ScreeningBacktestIndicatorOperand(BaseModel):
    """PR #116c: condition の右辺に別 indicator series を置く operand。

    例: `close > ema(20)` を `compareTarget={lensName: 'ohlcv', featureKey: 'ema',
    params: {period: 20}}` で表現する。Python 側 `condition_evaluator` は
    `lensName.featureKey(stable_params)` の snapshot key で series を引いて right
    operand として比較する。
    """

    lensName: str
    featureKey: str
    params: Optional[Dict[str, float]] = None

    @field_validator("params")
    @classmethod
    def _params_finite_non_bool(cls, v):
        return _validate_finite_non_bool_params(v)


class ScreeningBacktestCondition(BaseModel):
    """仮説の MachineReadableCondition (Node 側と同形)。

    PR #112 で Python 側に評価器 (`condition_evaluator.evaluate_condition_group`) を
    実装。`triggerGroup` 経由で受けた条件は `Strategy.next()` で評価され entry 判定に
    使われる。flatten 配列 `conditions[]` (本フィールドのリスト) は後方互換のため残す。
    `condition_evaluator.SUPPORTED_LENS_FEATURE_MAP` に該当しない leaf は
    `unsupportedConditions` に積まれ、verdict 判定からは PR #109 で除外済み。

    PR #116c: `params` (動的 indicator パラメータ) と `compareTarget` (indicator
    operand) を追加。後方互換のため両方 optional、`value` も optional 化
    (compareTarget 指定時は value 不要)。

    PR #118 Copilot review #5: TS 側 schema (analysisEngine.ts ConditionSchema)
    と同じく以下を model 側でも強制する:
    - params の値は bool / 非有限値を弾く
    - value と compareTarget は **ちょうど一方** を指定する (排他)
    """

    lensName: str
    featureKey: str
    op: Literal[
        "<",
        "<=",
        ">",
        ">=",
        "==",
        "!=",
        "between",
        "in",
        # PR ①-B (post-Phase 5A): Side-A 戦略表現力に揃える
        "cross_above",
        "cross_below",
        "touch_close",
        "touch_wick",
        "is_true",
        "is_false",
    ]
    value: Optional[Any] = None
    params: Optional[Dict[str, float]] = None
    compareTarget: Optional[ScreeningBacktestIndicatorOperand] = None

    @field_validator("params")
    @classmethod
    def _params_finite_non_bool(cls, v):
        return _validate_finite_non_bool_params(v)

    @model_validator(mode="after")
    def _exclusive_value_or_compare_target(self):
        has_value = self.value is not None
        has_target = self.compareTarget is not None
        if not has_value and not has_target:
            raise ValueError(
                "condition は value または compareTarget のどちらかを指定する必要がある"
            )
        if has_value and has_target:
            raise ValueError(
                "condition に value と compareTarget を同時指定することはできない (排他)"
            )
        return self


class ScreeningBacktestStopLoss(BaseModel):
    type: Literal["atr_multiple", "fixed_pips", "swing_point"]
    value: Optional[float] = None
    lookbackBars: Optional[int] = None


class ScreeningBacktestTakeProfit(BaseModel):
    type: Literal["rr_ratio", "atr_multiple", "fixed_pips"]
    value: float


class ScreeningBacktestConditionGroup(BaseModel):
    """Critical-4 PR #112: AND/OR 構造を保った条件グループ。

    `triggerGroup` で notePayload に運ばれてくる。Python 評価器
    (`condition_evaluator.evaluate_condition_group`) はこの構造を再帰的に評価する。

    旧 `conditions[]` (flatten 配列) は後方互換のため残すが、`triggerGroup` が
    指定されている場合はそちらを優先する。
    """

    logic: Literal["AND", "OR"]
    conditions: List[
        "ScreeningBacktestConditionGroup | ScreeningBacktestCondition"
    ] = Field(default_factory=list)


class ScreeningBacktestNotePayload(BaseModel):
    direction: Literal["long", "short", "either"]
    conditions: List[ScreeningBacktestCondition] = Field(default_factory=list)
    # PR #112: AND/OR 構造を保った条件グループ。指定時は本グループを優先評価する。
    triggerGroup: Optional[ScreeningBacktestConditionGroup] = None
    stopLoss: ScreeningBacktestStopLoss
    takeProfit: ScreeningBacktestTakeProfit
    indicators: List[IndicatorSpec] = Field(default_factory=list)
    maxHoldingBars: Optional[int] = None


# 自己参照解決 (再帰モデル用)
ScreeningBacktestConditionGroup.model_rebuild()


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
