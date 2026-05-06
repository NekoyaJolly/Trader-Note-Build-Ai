"""OOS Validation v1 (Critical-4 PR #109)

`/v1/oos-validation` のコアロジック。

設計方針:
    - **既存 ScreeningBacktest を再利用**。OOS 期間で BT を実行し、metrics を抽出。
    - verdict (passed / failed / unknown) は analysis-engine 側でのみ判定する
      (= Side-B Evolution layer は受け取って運ぶだけ、再判定しない)。
    - 閾値は保守的:
        * pf < minOosPf → low_oos_pf
        * tradeCount < minOosTrades → insufficient_oos_trades (= 統計的有意性なし)
        * maxDD > maxOosDrawdown (% スケール) → high_oos_drawdown
        * engine 側で trades=0 / unsupported / error 系が出たら → unknown + 失敗理由
    - 既存 endpoint には一切手を入れない (additive only)。
"""

from __future__ import annotations

from typing import List

from sqlalchemy.engine import Engine

from app.backtest import run_screening_backtest
from app.schemas import (
    OosFailureReason,
    OosValidationMetrics,
    OosValidationRequest,
    OosValidationResponse,
    OosValidationThresholds,
    OosVerdict,
    ScreeningBacktestRequest,
)


def _to_screening_backtest_request(req: OosValidationRequest) -> ScreeningBacktestRequest:
    """OosValidationRequest を ScreeningBacktestRequest に変換 (= 単純委譲)。"""
    return ScreeningBacktestRequest(
        hypothesisId=req.hypothesisId,
        symbol=req.symbol,
        timeframe=req.timeframe,
        startDate=req.startDate,
        endDate=req.endDate,
        notePayload=req.notePayload,
        config=req.config,
    )


def _judge_verdict(
    metrics: OosValidationMetrics,
    thresholds: OosValidationThresholds,
    unsupported_conditions: List[str],
) -> tuple[OosVerdict, List[OosFailureReason], List[str]]:
    """metrics と閾値から verdict を保守的に判定する。

    優先順位:
        1. unsupported_conditions あり → unknown (engine 制約で評価不能)
        2. tradeCount=0 → unknown + insufficient_oos_data
        3. tradeCount < minOosTrades → failed + insufficient_oos_trades
        4. pf < minOosPf → failed + low_oos_pf
        5. maxDD > maxOosDrawdown → failed + high_oos_drawdown
        6. 全て満たす → passed
    """
    failure_reasons: List[OosFailureReason] = []
    warnings: List[str] = []

    if unsupported_conditions:
        warnings.append(
            f"engine 制約により評価不能 (unsupported={','.join(unsupported_conditions)})"
        )
        return ("unknown", ["unknown"], warnings)

    if metrics.tradeCount == 0:
        return (
            "unknown",
            ["insufficient_oos_data"],
            ["OOS 期間で trade 0 件 → verdict 判定不能"],
        )

    if metrics.tradeCount < thresholds.minOosTrades:
        failure_reasons.append("insufficient_oos_trades")

    if metrics.pf is None or metrics.pf < thresholds.minOosPf:
        failure_reasons.append("low_oos_pf")

    # maxDD は % スケール (analysis-engine `summary.maxDD` の仕様)。
    # `None` のときは判定スキップ (= warning だけ)。
    if metrics.maxDrawdown is not None and metrics.maxDrawdown > thresholds.maxOosDrawdown:
        failure_reasons.append("high_oos_drawdown")

    if failure_reasons:
        return ("failed", failure_reasons, warnings)
    return ("passed", [], warnings)


def run_oos_validation(
    sql_engine: Engine,
    req: OosValidationRequest,
) -> OosValidationResponse:
    """OOS 期間の ScreeningBacktest を実行し、保守的 verdict を返す。

    既存 `run_screening_backtest` を内部で呼び出すだけで、独自に BT エンジンを
    持たない。failureReason の文字列体系は Side-B `OosFailureReason` と互換。
    """
    bt_req = _to_screening_backtest_request(req)
    bt_resp = run_screening_backtest(sql_engine, bt_req)

    summary = bt_resp.summary
    metrics = OosValidationMetrics(
        pf=summary.pf,
        tradeCount=summary.tradeCount,
        maxDrawdown=summary.maxDD,
        # expectancy / winRate は ScreeningBacktestSummary の既存値をそのまま運ぶ。
        # expectancy は ScreeningBacktest 側で算出していないため None のまま。
        expectancy=None,
        winRate=summary.winRate,
    )

    verdict, failure_reasons, warnings = _judge_verdict(
        metrics, req.thresholds, bt_resp.unsupportedConditions
    )

    return OosValidationResponse(
        metrics=metrics,
        verdict=verdict,
        failureReasons=failure_reasons,
        evaluationKind="oos",
        warnings=warnings,
        engineVersion=bt_resp.engineVersion,
        unsupportedConditions=bt_resp.unsupportedConditions,
    )
