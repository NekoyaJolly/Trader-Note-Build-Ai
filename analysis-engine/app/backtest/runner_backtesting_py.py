"""BTEngine 実装: backtesting.py (kernc/backtesting.py)

設計方針 (Critical-4 段階 1.8):
- 本ファイルは BTSpec / BTConfig / BTResult (engine 抽象) のみを知り、
  ノート schema には依存しない
- 別エンジン (vectorbt 等) を導入する時は同じ Protocol を満たす別ファイルを追加し、
  runner.py で選択するだけで済む
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

import numpy as np
import pandas as pd
import pandas_ta as ta
from backtesting import Backtest, Strategy

from .engine_protocol import (
    BTConfig,
    BTResult,
    BTSpec,
    BTSummary,
    BTTrade,
)
from .condition_evaluator import (
    collect_required_ohlcv_features,
    evaluate_condition_group,
)


# 本実装のバージョン (DB の engineVersion カラムに記録される)
# PR #112: DSL conditions 評価対応で minor 更新
ENGINE_VERSION = "analysis-engine/backtesting.py@0.6.5+conditions"


class BacktestingPyEngine:
    """BTEngine の backtesting.py 実装。"""

    @property
    def version(self) -> str:
        return ENGINE_VERSION

    def run(self, spec: BTSpec, ohlcv: pd.DataFrame, config: BTConfig) -> BTResult:
        """BT を実行して engine 非依存の BTResult を返す。"""
        # 入力 OHLCV (engine 非依存形式: lowercase columns) を backtesting.py が
        # 期待する capital-case にここで変換する。
        df = self._normalize_ohlcv(ohlcv)
        if df.empty or len(df) < 30:
            # ATR(14) が安定するまでに最低でも 30 本必要 → 0 トレードとして返す
            return self._empty_result()

        StrategyClass = self._build_strategy_class(spec)
        bt_kwargs = self._map_config(config)

        # finalize_trades=True: BT 期間末で未決済のトレードを強制 close して stats に含める。
        bt = Backtest(df, StrategyClass, finalize_trades=True, **bt_kwargs)
        stats = bt.run()

        summary = self._summarize_stats(stats)
        trades = self._extract_trades(stats, spec.max_holding_bars)
        equity = self._extract_equity(stats)

        return BTResult(summary=summary, trades=trades, equity=equity, engine_version=self.version)

    # -----------------------------------------
    # OHLCV 整形 (engine 依存)
    # -----------------------------------------

    @staticmethod
    def _normalize_ohlcv(ohlcv: pd.DataFrame) -> pd.DataFrame:
        if ohlcv.empty:
            return ohlcv
        rename_map = {
            "open": "Open",
            "high": "High",
            "low": "Low",
            "close": "Close",
            "volume": "Volume",
        }
        # 既に capital-case ならそのまま、lowercase なら rename
        if any(c in ohlcv.columns for c in rename_map.keys()):
            return ohlcv.rename(columns=rename_map)
        return ohlcv

    # -----------------------------------------
    # config マッピング (§11.5: 抽象 → backtesting.py 引数)
    # -----------------------------------------

    @staticmethod
    def _map_config(config: BTConfig) -> dict:
        """BTConfig (抽象) を backtesting.py の Backtest() 引数に変換する。

        backtesting.py の引数:
          - cash         = initial_capital
          - commission   = trading_cost_percent / 100  (decimal)
          - margin       = 1 / leverage
          - exclusive_orders = True (同時 1 ポジ制限)
        """
        return {
            "cash": float(config.initial_capital),
            "commission": float(config.trading_cost_percent) / 100.0,
            "margin": 1.0 / float(config.leverage or 1.0),
            "exclusive_orders": True,
        }

    # -----------------------------------------
    # Strategy クラス動的生成 (engine 依存)
    # -----------------------------------------

    @staticmethod
    def _build_strategy_class(spec: BTSpec) -> type[Strategy]:
        """BTSpec を閉包して backtesting.py の Strategy クラスを生成する。

        PR #112 改修:
            - `spec.trigger_group` (= ConditionGroup) が指定されていれば、
              `init()` で必要 feature (rsi / atr 等) を pandas_ta で計算 + self.I() 登録、
              `next()` で `evaluate_condition_group` を呼んで条件成立時のみ entry。
            - SL/TP は全 type 対応 (atr_multiple / fixed_pips / swing_point の SL、
              rr_ratio / atr_multiple / fixed_pips の TP)。
            - pip サイズはシンボル別 (現状 forex 4桁=0.0001、JPY ペア=0.01) に推定。
        """

        sl_spec = spec.stop_loss
        tp_spec = spec.take_profit
        direction = spec.direction
        max_holding = spec.max_holding_bars
        trigger_group = spec.trigger_group

        atr_length = 14  # ATR length は固定 14 (Phase 4b の慣行と整合)
        rsi_length = 14  # RSI length は固定 14 (TS surrogate と整合)
        # PR #112: 必要 feature を事前抽出 (trigger_group が None なら空集合)
        required_features = collect_required_ohlcv_features(trigger_group)

        # SL/TP の swing 計算用 lookback bars (BTStopLossSwingPoint)
        swing_lookback_bars = (
            int(getattr(sl_spec, "lookback_bars", 20))
            if getattr(sl_spec, "kind", None) == "swing_point"
            else 20
        )

        class GeneratedStrategy(Strategy):
            _spec_direction = direction
            _spec_sl = sl_spec
            _spec_tp = tp_spec
            _trigger_group = trigger_group
            _max_holding_bars: Optional[int] = max_holding
            _swing_lookback_bars = swing_lookback_bars

            def init(self) -> None:
                high = pd.Series(self.data.High)
                low = pd.Series(self.data.Low)
                close = pd.Series(self.data.Close)
                # ATR は SL/TP 計算と「ohlcv.atr」条件の両方で要る
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
                # PR #112: 必要に応じて RSI を計算
                if "rsi" in required_features:
                    self._rsi = self.I(
                        lambda c: ta.rsi(pd.Series(c), length=rsi_length).to_numpy(),
                        close.values,
                    )
                else:
                    self._rsi = None
                self._entry_bar: Optional[int] = None

            def _build_feature_snapshot(self) -> dict:
                """現バーの ohlcv feature 値辞書を作る。条件評価器に渡す入力。"""
                snapshot = {
                    "open": float(self.data.Open[-1]),
                    "high": float(self.data.High[-1]),
                    "low": float(self.data.Low[-1]),
                    "close": float(self.data.Close[-1]),
                    "volume": float(self.data.Volume[-1]),
                    "atr": float(self._atr[-1]) if self._atr is not None else None,
                }
                if self._rsi is not None:
                    snapshot["rsi"] = float(self._rsi[-1])
                # NaN は None に倒す (= condition_evaluator 側で false 判定)
                for k, v in list(snapshot.items()):
                    if isinstance(v, float) and (v != v):
                        snapshot[k] = None
                return snapshot

            def next(self) -> None:
                # `either` direction は段階 1 では未対応 → runner.py 側で事前に弾く想定。
                # 二重ガードとして next() でも何もしない。
                if self._spec_direction == "either":
                    return

                # maxHoldingBars 監視 — 強制クローズの分類は trades 抽出側で
                # ExitBar - EntryBar 差分から判定し outcome='timeout' に分類。
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
                    return

                # PR #112: trigger_group が指定されていれば DSL conditions を評価。
                # None なら従来挙動 (= 条件無視で毎バー entry)。
                if self._trigger_group is not None:
                    snapshot = self._build_feature_snapshot()
                    if not evaluate_condition_group(self._trigger_group, snapshot):
                        return  # 条件不成立 → entry しない

                entry_price = float(self.data.Close[-1])
                sl_distance = self._compute_sl_distance(atr_val, entry_price)
                if sl_distance is None or sl_distance <= 0:
                    return
                tp_distance = self._compute_tp_distance(atr_val, entry_price, sl_distance)
                if tp_distance is None or tp_distance <= 0:
                    return

                if self._spec_direction == "long":
                    sl = entry_price - sl_distance
                    tp = entry_price + tp_distance
                    if sl < entry_price < tp:
                        self.buy(sl=sl, tp=tp)
                        self._entry_bar = len(self.data) - 1
                elif self._spec_direction == "short":
                    sl = entry_price + sl_distance
                    tp = entry_price - tp_distance
                    if tp < entry_price < sl:
                        self.sell(sl=sl, tp=tp)
                        self._entry_bar = len(self.data) - 1

            def _pip_size(self, entry_price: float) -> float:
                """pip サイズを推定。JPY ペアは 0.01、その他 forex は 0.0001、
                超低価格 (= 0.01 未満) では 0.0001 を返す保守値。
                """
                # 価格レンジから JPY ペア相当か判定 (例: 150.000 のような 3 桁台)
                if entry_price >= 50.0:
                    return 0.01
                return 0.0001

            def _compute_sl_distance(self, atr_val: float, entry_price: float) -> Optional[float]:
                spec = self._spec_sl
                if spec.kind == "atr_multiple":
                    return float(atr_val) * float(spec.value)
                if spec.kind == "fixed_pips":
                    pips = float(spec.value)
                    if pips <= 0:
                        return None
                    return pips * self._pip_size(entry_price)
                if spec.kind == "swing_point":
                    # 直近 lookback_bars の最安値 (long) / 最高値 (short) からの距離
                    lookback = max(2, int(self._swing_lookback_bars))
                    n = min(lookback, len(self.data))
                    if n < 2:
                        return None
                    if self._spec_direction == "long":
                        recent_low = float(min(self.data.Low[-n:]))
                        return entry_price - recent_low
                    # short
                    recent_high = float(max(self.data.High[-n:]))
                    return recent_high - entry_price
                return None

            def _compute_tp_distance(
                self, atr_val: float, entry_price: float, sl_distance: float,
            ) -> Optional[float]:
                spec = self._spec_tp
                if spec.kind == "rr_ratio":
                    return sl_distance * float(spec.value)
                if spec.kind == "atr_multiple":
                    return float(atr_val) * float(spec.value)
                if spec.kind == "fixed_pips":
                    pips = float(spec.value)
                    if pips <= 0:
                        return None
                    return pips * self._pip_size(entry_price)
                return None

        return GeneratedStrategy

    # -----------------------------------------
    # 結果抽出 (engine 依存 → 抽象型)
    # -----------------------------------------

    @staticmethod
    def _summarize_stats(stats) -> BTSummary:
        pf_raw = stats.get("Profit Factor")
        if pf_raw is None or (isinstance(pf_raw, float) and (np.isnan(pf_raw) or np.isinf(pf_raw))):
            pf = 0.0
        else:
            pf = float(pf_raw)

        win_rate_pct = stats.get("Win Rate [%]")
        win_rate = (
            0.0 if win_rate_pct is None or np.isnan(win_rate_pct) else float(win_rate_pct) / 100.0
        )

        trade_count = int(stats.get("# Trades", 0) or 0)

        max_dd_pct = stats.get("Max. Drawdown [%]")
        max_dd = None if max_dd_pct is None or np.isnan(max_dd_pct) else float(max_dd_pct)

        sharpe_raw = stats.get("Sharpe Ratio")
        sharpe = None if sharpe_raw is None or np.isnan(sharpe_raw) else float(sharpe_raw)

        return_pct = stats.get("Return [%]")
        return_pct_val = (
            None if return_pct is None or np.isnan(return_pct) else float(return_pct)
        )

        return BTSummary(
            pf=pf,
            win_rate=win_rate,
            trade_count=trade_count,
            max_dd=max_dd,
            sharpe=sharpe,
            return_pct=return_pct_val,
        )

    @classmethod
    def _extract_trades(cls, stats, max_holding_bars: Optional[int]) -> List[BTTrade]:
        trades_df = getattr(stats, "_trades", None)
        if trades_df is None or trades_df.empty:
            return []

        final_bar_index: Optional[int] = None
        if hasattr(stats, "_equity_curve") and stats._equity_curve is not None:
            ec_len = len(stats._equity_curve)
            if ec_len > 0:
                final_bar_index = ec_len - 1

        out: List[BTTrade] = []
        for row in trades_df.to_dict("records"):
            size = float(row.get("Size", 0))
            side = "long" if size > 0 else "short"
            pnl = float(row.get("PnL", 0.0))
            outcome = cls._classify_outcome(
                pnl=pnl,
                entry_bar=row.get("EntryBar"),
                exit_bar=row.get("ExitBar"),
                max_holding_bars=max_holding_bars,
                final_bar_index=final_bar_index,
            )

            out.append(
                BTTrade(
                    entry_time=cls._ensure_utc(row.get("EntryTime")),
                    entry_price=float(row.get("EntryPrice", 0.0)),
                    exit_time=(
                        cls._ensure_utc(row.get("ExitTime"))
                        if row.get("ExitTime") is not None
                        else None
                    ),
                    exit_price=(
                        float(row["ExitPrice"]) if row.get("ExitPrice") is not None else None
                    ),
                    side=side,
                    pnl=pnl,
                    outcome=outcome,
                )
            )
        return out

    @staticmethod
    def _classify_outcome(
        pnl: float,
        entry_bar,
        exit_bar,
        max_holding_bars: Optional[int],
        final_bar_index: Optional[int],
    ) -> str:
        """Trade の outcome 判定 (時間切れ vs 損益)。"""
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

    @staticmethod
    def _ensure_utc(ts) -> datetime:
        pts = pd.Timestamp(ts)
        if pts.tzinfo is None:
            pts = pts.tz_localize(timezone.utc)
        else:
            pts = pts.tz_convert(timezone.utc)
        return pts.to_pydatetime()

    @staticmethod
    def _extract_equity(stats) -> Optional[List[float]]:
        equity_curve = getattr(stats, "_equity_curve", None)
        if equity_curve is None or "Equity" not in equity_curve.columns:
            return None
        return equity_curve["Equity"].astype(float).to_list()

    # -----------------------------------------
    # 0 トレード結果 (OHLCV 不足等)
    # -----------------------------------------

    def _empty_result(self) -> BTResult:
        return BTResult(
            summary=BTSummary(
                pf=0.0,
                win_rate=0.0,
                trade_count=0,
                max_dd=None,
                sharpe=None,
                return_pct=None,
            ),
            trades=[],
            equity=None,
            engine_version=self.version,
        )
