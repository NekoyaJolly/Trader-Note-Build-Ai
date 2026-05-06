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
    """ScreeningBacktestNotePayload (ノート) → BTSpec (engine 抽象)。

    PR #112: `triggerGroup` (AND/OR 構造を保った条件グループ) を BTSpec.trigger_group に
    そのまま運ぶ。Strategy.next() で評価器が再帰的に解釈する。
    """
    return BTSpec(
        direction=payload.direction,
        stop_loss=_stoploss_to_bt(payload.stopLoss),
        take_profit=_takeprofit_to_bt(payload.takeProfit),
        max_holding_bars=payload.maxHoldingBars,
        indicators=[ind.model_dump() for ind in payload.indicators],
        trigger_group=payload.triggerGroup,
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
    """engine が解釈できなかった条件だけを返す (PR #112 で評価経路を実装)。

    現行対応範囲: `lensName='ohlcv'` の `{open, high, low, close, volume, rsi, atr}`
    feature のみ。それ以外 (例: `lensName='ema'`, `lensName='elliott'`) は
    `unsupportedConditions` に積むが、`triggerGroup` 評価の結果として false に倒れる
    (= verdict 判定からは PR #109 で除外済み)。
    """
    from .condition_evaluator import is_supported_leaf  # 循環 import 回避のため遅延

    out: List[str] = []
    for c in conditions:
        if not is_supported_leaf(c):
            out.append(f"{c.lensName}.{c.featureKey} {c.op} {c.value!r}")
    return out


def detect_unsupported_specs(payload: ScreeningBacktestNotePayload) -> List[str]:
    """ノート schema 内の direction で、現行エンジンが未対応な spec を検出する。

    PR #112 で SL/TP は全 type 対応 (atr_multiple / fixed_pips / swing_point の SL、
    rr_ratio / atr_multiple / fixed_pips の TP)。残るは direction='either' のみ。

    呼び出し側 (runner.py) は本関数の戻り値が空でなければ BT 実行をスキップして
    `unsupportedConditions` に理由を載せる。
    """
    out: List[str] = []
    if payload.direction == "either":
        out.append("direction='either' は未対応 (long/short 両方向 BT は段階 4 範囲)")
    return out
