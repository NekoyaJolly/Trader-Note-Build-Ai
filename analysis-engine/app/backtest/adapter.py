"""ノート schema (リクエスト / レスポンス) と engine 抽象 (BTSpec / BTConfig / BTResult) の相互変換層

設計方針 (Critical-4 段階 1.8):
- クライアント側のノート schema (`ScreeningBacktestNotePayload` 等) は engine の存在を知らない
- エンジン実装 (`BacktestingPyEngine` 等) はノート schema の存在を知らない
- 本ファイルが両者を仲介する
- 将来 BT エンジンが交換されても、入力ノート schema が同じなら本ファイルは無修正で済む
"""

from __future__ import annotations

from typing import List, Optional

from app.schemas import (
    ScreeningBacktestCondition,
    ScreeningBacktestConfig,
    ScreeningBacktestNotePayload,
    ScreeningBacktestStopLoss,
    ScreeningBacktestSummary,
    ScreeningBacktestTakeProfit,
    ScreeningBacktestTrade,
)

from .engine_protocol import (
    BTConfig,
    BTResult,
    BTSpec,
    BTStopLoss,
    BTStopLossAtrMultiple,
    BTStopLossFixedPips,
    BTStopLossSwingPoint,
    BTTakeProfit,
    BTTakeProfitAtrMultiple,
    BTTakeProfitFixedPips,
    BTTakeProfitRrRatio,
)


# ---------------------------------------------------------------
# Note → BTSpec / BTConfig
# ---------------------------------------------------------------


def _stoploss_to_bt(spec: ScreeningBacktestStopLoss) -> BTStopLoss:
    if spec.type == "atr_multiple":
        return BTStopLossAtrMultiple(value=float(spec.value or 0.0))
    if spec.type == "fixed_pips":
        return BTStopLossFixedPips(value=float(spec.value or 0.0))
    # swing_point
    return BTStopLossSwingPoint(lookback_bars=int(spec.lookbackBars or 20))


def _takeprofit_to_bt(spec: ScreeningBacktestTakeProfit) -> BTTakeProfit:
    if spec.type == "rr_ratio":
        return BTTakeProfitRrRatio(value=float(spec.value))
    if spec.type == "atr_multiple":
        return BTTakeProfitAtrMultiple(value=float(spec.value))
    return BTTakeProfitFixedPips(value=float(spec.value))


def notepayload_to_btspec(payload: ScreeningBacktestNotePayload) -> BTSpec:
    """ScreeningBacktestNotePayload (ノート) → BTSpec (engine 抽象)"""
    return BTSpec(
        direction=payload.direction,
        stop_loss=_stoploss_to_bt(payload.stopLoss),
        take_profit=_takeprofit_to_bt(payload.takeProfit),
        max_holding_bars=payload.maxHoldingBars,
        indicators=[ind.model_dump() for ind in payload.indicators],
    )


def config_to_btconfig(config: ScreeningBacktestConfig) -> BTConfig:
    """ScreeningBacktestConfig (リクエスト) → BTConfig (engine 抽象)"""
    return BTConfig(
        initial_capital=float(config.initialCapital),
        leverage=float(config.leverage),
        trading_cost_percent=float(config.tradingCost),
    )


# ---------------------------------------------------------------
# BTResult → ScreeningBacktestSummary / ScreeningBacktestTrade
# ---------------------------------------------------------------


def btsummary_to_response(summary) -> ScreeningBacktestSummary:
    """BTSummary (engine 抽象) → ScreeningBacktestSummary (response)"""
    return ScreeningBacktestSummary(
        pf=summary.pf,
        winRate=summary.win_rate,
        tradeCount=summary.trade_count,
        maxDD=summary.max_dd,
        sharpe=summary.sharpe,
        returnPct=summary.return_pct,
    )


def bttrade_to_response(trade) -> ScreeningBacktestTrade:
    """BTTrade (engine 抽象) → ScreeningBacktestTrade (response)"""
    return ScreeningBacktestTrade(
        entryTime=trade.entry_time,
        entryPrice=trade.entry_price,
        exitTime=trade.exit_time,
        exitPrice=trade.exit_price,
        side=trade.side,
        pnl=trade.pnl,
        outcome=trade.outcome,
    )


def btresult_to_response_parts(result: BTResult):
    """BTResult を response 用パーツ (summary, trades, equity, engineVersion) に分解。"""
    return {
        "summary": btsummary_to_response(result.summary),
        "trades": [bttrade_to_response(t) for t in result.trades],
        "equity": result.equity,
        "engineVersion": result.engine_version,
    }


# ---------------------------------------------------------------
# unsupported conditions の記述化 (engine 非依存)
# ---------------------------------------------------------------


def describe_unsupported_conditions(conditions: List[ScreeningBacktestCondition]) -> List[str]:
    """段階 1 ではすべての MachineReadableCondition を未対応として返す。

    将来エンジン側で条件評価を実装する時、本関数は「engine が解釈できなかった条件」
    だけを返す形に拡張する。
    """
    return [f"{c.lensName}.{c.featureKey} {c.op} {c.value!r}" for c in conditions]
