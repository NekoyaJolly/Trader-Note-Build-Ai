"""Critical-4 段階 1: スクリーニング BT 実装 (analysis-engine)

仮説 (EdgeHypothesis) の defaultRiskManagement / direction を入力に、
backtesting.py で SL/TP ベースの BT を走らせて summary / trades を返す。

設計方針:
- BT エンジンはアプリ全体で 1 つだけ (本ファイル + backtesting.py)
- 「変換アダプタを作らない」(§12.3) — notePayload を素直に解釈する
- OHLCV は本サービスが DB から直読み (Node 側で送らない)
- 段階 1 では仮説の `conditions[]` (MachineReadableCondition) は評価しない。
  レンズ feature 評価機構を Python 側に持たないため、すべて unsupportedConditions に
  積んだ上で「常時エントリー × SL/TP 約定」で BT する。screening の意味は
  「この direction × SL/TP リスク設定での PF/勝率ベースライン」を測ることになる。
- 仮説の真の選別は段階 2 以降 (Phase 6.7b の StrategyBacktesterAgent + DSL 評価) で行う前提。

`backtesting.py` のインターフェイスとの境界 (config マッピング、§11.5):
- initialCapital → cash
- leverage → margin = 1 / leverage
- tradingCost (片道 %) → commission = tradingCost / 100
- exclusive_orders=True (同時 1 ポジ制限)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

import numpy as np
import pandas as pd
import pandas_ta as ta
from backtesting import Backtest, Strategy
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.schemas import (
    ScreeningBacktestCondition,
    ScreeningBacktestNotePayload,
    ScreeningBacktestRequest,
    ScreeningBacktestResponse,
    ScreeningBacktestSummary,
    ScreeningBacktestTrade,
)

# 本ファイルのバージョン (DB の engineVersion カラムに記録される)
ENGINE_VERSION = "analysis-engine/backtesting.py@0.6.5"


# ---------------------------------------------------------------
# OHLCV 読み込み
# ---------------------------------------------------------------


def _load_ohlcv(
    engine: Engine,
    symbol: str,
    timeframe: str,
    start: datetime,
    end: datetime,
) -> pd.DataFrame:
    """DB から OHLCV を読み込み、backtesting.py が期待するカラム名に整形する。

    backtesting.py は capital-case の Open/High/Low/Close/Volume を要求する。
    """
    sql = text(
        """
        SELECT timestamp, open, high, low, close, volume
        FROM "OHLCVCandle"
        WHERE symbol = :symbol
          AND timeframe = :timeframe
          AND timestamp >= :start_ts
          AND timestamp <= :end_ts
        ORDER BY timestamp ASC
        """
    )
    with engine.connect() as conn:
        rows = conn.execute(
            sql,
            {
                "symbol": symbol,
                "timeframe": timeframe,
                "start_ts": start,
                "end_ts": end,
            },
        ).mappings().all()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = df[col].astype(float)

    # backtesting.py 用に capital-case に rename + timestamp index
    df = df.rename(
        columns={
            "open": "Open",
            "high": "High",
            "low": "Low",
            "close": "Close",
            "volume": "Volume",
        }
    )
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.set_index("timestamp")
    return df


# ---------------------------------------------------------------
# config マッピング (§11.5: TS→Python 境界の正規化)
# ---------------------------------------------------------------


def _map_config_to_backtesting_kwargs(config_dict: dict) -> dict:
    """アプリ独自 config を backtesting.py の Backtest() 引数に変換する。

    config (TS から):
        - initialCapital
        - leverage
        - tradingCost  (片道 %, 例: 0.05 = 0.05%)

    backtesting.py の引数:
        - cash
        - commission  (decimal, 例: 0.0005)
        - margin      (1 / leverage)
        - exclusive_orders=True
    """
    return {
        "cash": float(config_dict.get("initialCapital", 10_000)),
        "commission": float(config_dict.get("tradingCost", 0)) / 100.0,
        "margin": 1.0 / float(config_dict.get("leverage") or 1.0),
        "exclusive_orders": True,
    }


# ---------------------------------------------------------------
# 動的 Strategy 生成
# ---------------------------------------------------------------


def _build_strategy_class(payload: ScreeningBacktestNotePayload) -> type[Strategy]:
    """notePayload を閉包して Strategy クラスを生成する。

    SL/TP の決定:
      - SL: atr_multiple → entry ± (ATR × value)
              fixed_pips / swing_point → 段階 1 では未対応 (常時エントリーのみ)
      - TP: rr_ratio → SL 距離 × value
              atr_multiple → entry ± (ATR × value)
              fixed_pips → 段階 1 では未対応

    direction:
      - long  → buy
      - short → sell (sell に SL/TP を渡す)
      - either → 段階 1 では未対応 (run_screening_backtest 側で事前に弾く)。
                  二重ガードとして next() でも何もしない。

    maxHoldingBars: 指定時はバー数で強制決済(outcome='timeout' として記録)。
    """

    sl_spec = payload.stopLoss
    tp_spec = payload.takeProfit
    direction = payload.direction
    max_holding = payload.maxHoldingBars

    # ATR length は固定 14 (Phase 4b の慣行と整合)
    atr_length = 14

    class GeneratedStrategy(Strategy):
        # クラス変数として外部 payload を露出 (テストや内省用)
        _payload_direction = direction
        _payload_sl = sl_spec
        _payload_tp = tp_spec
        _max_holding_bars: Optional[int] = max_holding

        def init(self) -> None:
            high = pd.Series(self.data.High)
            low = pd.Series(self.data.Low)
            close = pd.Series(self.data.Close)
            self._atr = self.I(
                lambda h, l, c: ta.atr(
                    high=pd.Series(h),
                    low=pd.Series(l),
                    close=pd.Series(c),
                    length=atr_length,
                ).to_numpy(),
                high.values,
                low.values,
                close.values,
            )
            # 各ポジションのエントリーバー番号 (maxHoldingBars 監視用)
            self._entry_bar: Optional[int] = None

        def next(self) -> None:
            # `either` は段階 1 では未対応 (Copilot レビュー指摘 (3))。
            # run_screening_backtest 側で事前に弾かれている前提だが、二重ガード。
            if self._payload_direction == "either":
                return

            # maxHoldingBars 監視 — 強制クローズの理由は trades 抽出側で
            # `ExitBar - EntryBar` 差分から判定し outcome='timeout' に分類する。
            if (
                self.position
                and self._max_holding_bars is not None
                and self._entry_bar is not None
            ):
                held_bars = len(self.data) - 1 - self._entry_bar
                if held_bars >= self._max_holding_bars:
                    self.position.close()
                    self._entry_bar = None
                    return

            if self.position:
                return  # 既存ポジが SL/TP で約定するのを待つ

            atr_val = self._atr[-1]
            if atr_val is None or np.isnan(atr_val) or atr_val <= 0:
                return  # ATR 未確定 (ウォームアップ中)

            entry_price = float(self.data.Close[-1])
            sl_distance = self._compute_sl_distance(atr_val, entry_price)
            if sl_distance is None or sl_distance <= 0:
                return

            tp_distance = self._compute_tp_distance(atr_val, entry_price, sl_distance)
            if tp_distance is None or tp_distance <= 0:
                return

            if self._payload_direction == "long":
                sl = entry_price - sl_distance
                tp = entry_price + tp_distance
                if sl < entry_price < tp:
                    self.buy(sl=sl, tp=tp)
                    self._entry_bar = len(self.data) - 1
            elif self._payload_direction == "short":
                sl = entry_price + sl_distance
                tp = entry_price - tp_distance
                if tp < entry_price < sl:
                    self.sell(sl=sl, tp=tp)
                    self._entry_bar = len(self.data) - 1

        def _compute_sl_distance(self, atr_val: float, entry_price: float) -> Optional[float]:
            spec = self._payload_sl
            if spec.type == "atr_multiple":
                if spec.value is None:
                    return None
                return float(atr_val) * float(spec.value)
            # 段階 1 では fixed_pips / swing_point は未対応
            return None

        def _compute_tp_distance(
            self,
            atr_val: float,
            entry_price: float,
            sl_distance: float,
        ) -> Optional[float]:
            spec = self._payload_tp
            if spec.type == "rr_ratio":
                return sl_distance * float(spec.value)
            if spec.type == "atr_multiple":
                return float(atr_val) * float(spec.value)
            # fixed_pips は未対応
            return None

    return GeneratedStrategy


# ---------------------------------------------------------------
# 結果サマリー / トレード変換
# ---------------------------------------------------------------


def _summarize_stats(stats) -> ScreeningBacktestSummary:
    """backtesting.py の stats Series から必要メトリクスを抽出する。"""
    pf_raw = stats.get("Profit Factor")
    if pf_raw is None or (isinstance(pf_raw, float) and (np.isnan(pf_raw) or np.isinf(pf_raw))):
        pf = 0.0
    else:
        pf = float(pf_raw)

    win_rate_pct = stats.get("Win Rate [%]")
    win_rate = 0.0 if win_rate_pct is None or np.isnan(win_rate_pct) else float(win_rate_pct) / 100.0

    trade_count = int(stats.get("# Trades", 0) or 0)

    max_dd_pct = stats.get("Max. Drawdown [%]")
    max_dd = None if max_dd_pct is None or np.isnan(max_dd_pct) else float(max_dd_pct)

    sharpe_raw = stats.get("Sharpe Ratio")
    sharpe = None if sharpe_raw is None or np.isnan(sharpe_raw) else float(sharpe_raw)

    return_pct = stats.get("Return [%]")
    return_pct_val = (
        None if return_pct is None or np.isnan(return_pct) else float(return_pct)
    )

    return ScreeningBacktestSummary(
        pf=pf,
        winRate=win_rate,
        tradeCount=trade_count,
        maxDD=max_dd,
        sharpe=sharpe,
        returnPct=return_pct_val,
    )


def _extract_trades(
    stats,
    max_holding_bars: Optional[int],
) -> List[ScreeningBacktestTrade]:
    """stats._trades (DataFrame) を ScreeningBacktestTrade のリストに変換する。

    outcome の判定 (Copilot 指摘 (4) への対応):
      - SL/TP に到達せず、maxHoldingBars 経過で強制クローズされたものを `timeout` とする。
        判定根拠は `ExitBar - EntryBar >= maxHoldingBars`(EntryBar/ExitBar は backtesting.py
        が trades DataFrame に出力するバーインデックス)。
      - finalize_trades=True で BT 末端の未決済を強制クローズしたケースも `timeout` 扱い。
        backtesting.py は最終バーを ExitBar に入れるので、保有期間が長く maxHoldingBars に
        満たなくても「BT 末まで残ったが未約定」は実質的に時間切れと同義。
      - 上記以外は PnL 符号で win/loss を決める。
    """
    trades_df = getattr(stats, "_trades", None)
    if trades_df is None or trades_df.empty:
        return []

    final_bar_index: Optional[int] = None
    if hasattr(stats, "_equity_curve") and stats._equity_curve is not None:
        # equity_curve の長さ - 1 が最終バーインデックス
        ec_len = len(stats._equity_curve)
        if ec_len > 0:
            final_bar_index = ec_len - 1

    out: List[ScreeningBacktestTrade] = []
    for row in trades_df.to_dict("records"):
        size = float(row.get("Size", 0))
        side = "long" if size > 0 else "short"
        pnl = float(row.get("PnL", 0.0))

        outcome = _classify_outcome(
            pnl=pnl,
            entry_bar=row.get("EntryBar"),
            exit_bar=row.get("ExitBar"),
            max_holding_bars=max_holding_bars,
            final_bar_index=final_bar_index,
        )

        entry_time = row.get("EntryTime")
        exit_time = row.get("ExitTime")

        out.append(
            ScreeningBacktestTrade(
                entryTime=_ensure_utc(entry_time),
                entryPrice=float(row.get("EntryPrice", 0.0)),
                exitTime=_ensure_utc(exit_time) if exit_time is not None else None,
                exitPrice=float(row["ExitPrice"]) if row.get("ExitPrice") is not None else None,
                side=side,
                pnl=pnl,
                outcome=outcome,
            )
        )
    return out


def _classify_outcome(
    pnl: float,
    entry_bar,
    exit_bar,
    max_holding_bars: Optional[int],
    final_bar_index: Optional[int],
) -> str:
    """個別トレードの outcome を判定する (Copilot 指摘 (4))。

    優先順位:
      1. EntryBar/ExitBar から保有バー数を計算できる場合:
         - `held >= max_holding_bars` → timeout
         - `exit_bar == final_bar_index` (BT 末で finalize_trades により強制 close) → timeout
      2. 上記が判定不能なら PnL 符号で win/loss を決定する。
         pnl == 0 のケースは loss 寄りに分類しない (timeout フォールバック)。
    """
    try:
        eb = int(entry_bar) if entry_bar is not None else None
        xb = int(exit_bar) if exit_bar is not None else None
    except (TypeError, ValueError):
        eb = None
        xb = None

    if eb is not None and xb is not None:
        held = xb - eb
        if max_holding_bars is not None and held >= max_holding_bars:
            return "timeout"
        if final_bar_index is not None and xb >= final_bar_index:
            return "timeout"

    if pnl > 0:
        return "win"
    if pnl < 0:
        return "loss"
    return "timeout"


def _ensure_utc(ts) -> datetime:
    """pandas Timestamp / datetime を timezone-aware (UTC) datetime に正規化する。"""
    pts = pd.Timestamp(ts)
    if pts.tzinfo is None:
        pts = pts.tz_localize(timezone.utc)
    else:
        pts = pts.tz_convert(timezone.utc)
    return pts.to_pydatetime()


# ---------------------------------------------------------------
# 未対応条件の記述化
# ---------------------------------------------------------------


def _describe_unsupported_conditions(
    conditions: List[ScreeningBacktestCondition],
) -> List[str]:
    """段階 1 ではすべての MachineReadableCondition を未対応として返す。"""
    out: List[str] = []
    for c in conditions:
        out.append(f"{c.lensName}.{c.featureKey} {c.op} {c.value!r}")
    return out


def _empty_response(
    note_payload: ScreeningBacktestNotePayload,
    extra_unsupported: Optional[List[str]] = None,
) -> ScreeningBacktestResponse:
    """0 トレードの結果を返す共通ヘルパー。"""
    unsupported = _describe_unsupported_conditions(note_payload.conditions)
    if extra_unsupported:
        unsupported.extend(extra_unsupported)
    return ScreeningBacktestResponse(
        summary=ScreeningBacktestSummary(
            pf=0.0,
            winRate=0.0,
            tradeCount=0,
            maxDD=None,
            sharpe=None,
            returnPct=None,
        ),
        trades=[],
        equity=None,
        engineVersion=ENGINE_VERSION,
        unsupportedConditions=unsupported,
    )


# ---------------------------------------------------------------
# エンドポイントから呼ぶ本体
# ---------------------------------------------------------------


def run_screening_backtest(
    engine: Engine,
    req: ScreeningBacktestRequest,
) -> ScreeningBacktestResponse:
    """`/v1/screening-backtest` のコア処理。

    OHLCV を DB から読み、Strategy クラスを動的生成し、backtesting.py で BT を走らせる。
    結果サマリー / トレード一覧 / equity を返す。

    `expectedDirection='either'` は段階 1 では未対応 (Copilot 指摘 (3))。
    long/short 両側を試すと screening の判定基準が体系的にバイアスを受けるため、
    明示的に 0 トレード結果を返し `unsupportedConditions` で理由を伝える。
    両方向 BT は段階 4 範囲。
    """
    # (3) `either` direction は未対応として明示的に弾く
    if req.notePayload.direction == "either":
        return _empty_response(
            req.notePayload,
            extra_unsupported=[
                "expectedDirection='either' は段階 1 では未対応 "
                "(long/short 両方向 BT は段階 4 範囲)"
            ],
        )

    df = _load_ohlcv(engine, req.symbol, req.timeframe, req.startDate, req.endDate)
    if df.empty or len(df) < 30:
        # ATR(14) が安定するまでに最低でも 30 本程度は必要
        return _empty_response(req.notePayload)

    StrategyClass = _build_strategy_class(req.notePayload)
    bt_kwargs = _map_config_to_backtesting_kwargs(req.config.model_dump())

    # finalize_trades=True: BT 期間末で未決済のトレードを強制 close して stats に含める。
    # 含めないと stats._trades に open trades が漏れて summary がずれる。
    bt = Backtest(df, StrategyClass, finalize_trades=True, **bt_kwargs)
    stats = bt.run()

    summary = _summarize_stats(stats)
    trades = _extract_trades(stats, req.notePayload.maxHoldingBars)

    equity_curve = getattr(stats, "_equity_curve", None)
    equity_list: Optional[List[float]] = None
    if equity_curve is not None and "Equity" in equity_curve.columns:
        equity_list = equity_curve["Equity"].astype(float).to_list()

    return ScreeningBacktestResponse(
        summary=summary,
        trades=trades,
        equity=equity_list,
        engineVersion=ENGINE_VERSION,
        unsupportedConditions=_describe_unsupported_conditions(req.notePayload.conditions),
    )
