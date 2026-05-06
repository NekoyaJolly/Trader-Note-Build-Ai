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
    - 既存 endpoint には一切手を入れない (additive only)。

PR #109 Copilot review 対応:
    - run_screening_backtest の `unsupportedConditions` は通常リクエストでも
      「評価していない entry conditions (lens feature)」として常時積まれる仕様のため、
      これを致命扱いするとほぼ全 OOS 検証が `unknown` になり verdict が機能しない。
      → unsupported は **verdict 判定から除外**、レスポンスにはそのまま返す + warning に
      情報として積むだけにする。「engine 制約で BT できない」ケース
      (direction='either' / SL=swing_point など) は既に screening-backtest 側で
      `_empty_response` (trades=[]) を返すため、tradeCount=0 → unknown +
      insufficient_oos_data の経路で十分カバーされる。
    - maxDrawdown が None のときに warning を実際に積む (旧コメントとの不一致解消)。
    - run_screening_backtest 例外を try/except で捕捉して `unknown` + `oos_engine_error` に
      倒し、`OosFailureReason` に定義した `oos_engine_error` を実際に使う契約にする。
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

    優先順位 (PR #109 Copilot review #1 対応で unsupported 即 unknown を撤廃):
        1. tradeCount=0 → unknown + insufficient_oos_data
           (engine 制約で BT できないケース (= direction='either', SL=swing_point 等) は
            screening-backtest 側で _empty_response を返すため tradeCount=0 になる、
            ここで unknown に倒れて verdict 機能を保つ)
        2. tradeCount < minOosTrades → failed + insufficient_oos_trades
        3. pf < minOosPf → failed + low_oos_pf
        4. maxDD > maxOosDrawdown → failed + high_oos_drawdown
        5. maxDrawdown is None → warning は積むが verdict 判定はスキップ
        6. 全て満たす → passed

    `unsupported_conditions` は **verdict 判定から除外**。レスポンスには引き続き含めるが、
    通常リクエストでも常時積まれる「評価していない conditions[]」を致命扱いしないため。
    情報としては warning に積む。
    """
    failure_reasons: List[OosFailureReason] = []
    warnings: List[str] = []

    # 情報レベル warning として unsupported を積む (= verdict は判定する)
    if unsupported_conditions:
        warnings.append(
            f"unsupportedConditions={','.join(unsupported_conditions)} (verdict 判定からは除外)"
        )

    if metrics.tradeCount == 0:
        return (
            "unknown",
            ["insufficient_oos_data"],
            warnings + ["OOS 期間で trade 0 件 → verdict 判定不能"],
        )

    if metrics.tradeCount < thresholds.minOosTrades:
        failure_reasons.append("insufficient_oos_trades")

    if metrics.pf is None or metrics.pf < thresholds.minOosPf:
        failure_reasons.append("low_oos_pf")

    # maxDD は % スケール (analysis-engine `summary.maxDD` の仕様)。
    # `None` のときは判定スキップ + warning に明示。
    if metrics.maxDrawdown is None:
        warnings.append("maxDrawdown=None のため high_oos_drawdown 判定をスキップ")
    elif metrics.maxDrawdown > thresholds.maxOosDrawdown:
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

    PR #109 Copilot review #3 対応:
        run_screening_backtest 例外は try/except で捕捉し `unknown` + `oos_engine_error` で
        返す (= 500 で落ちず、レスポンススキーマ通りに返す)。これにより `OosFailureReason` の
        `oos_engine_error` 定義が実際に使われ、Side-B `oosBacktestRunner` 側でも例外経路と
        サービス内部エラー経路を観測できる。
    """
    bt_req = _to_screening_backtest_request(req)

    try:
        bt_resp = run_screening_backtest(sql_engine, bt_req)
    except Exception as exc:  # noqa: BLE001 — adapter 境界では広く捕捉して契約通りに返す
        empty_metrics = OosValidationMetrics(
            pf=None,
            tradeCount=0,
            maxDrawdown=None,
            expectancy=None,
            winRate=None,
        )
        return OosValidationResponse(
            metrics=empty_metrics,
            verdict="unknown",
            failureReasons=["oos_engine_error"],
            evaluationKind="oos",
            warnings=[f"run_screening_backtest 例外: {type(exc).__name__}: {exc}"],
            engineVersion="unknown",
            unsupportedConditions=[],
        )

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
