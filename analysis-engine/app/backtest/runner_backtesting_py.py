"""BTEngine 実装: backtesting.py (kernc/backtesting.py)

設計方針 (Critical-4 段階 1.8):
- 本ファイルは BTSpec / BTConfig / BTResult (engine 抽象) のみを知り、
  ノート schema には依存しない
- 別エンジン (vectorbt 等) を導入する時は同じ Protocol を満たす別ファイルを追加し、
  runner.py で選択するだけで済む
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
import pandas_ta as ta
from backtesting import Backtest, Strategy

logger = logging.getLogger(__name__)

from .engine_protocol import (
    BTConfig,
    BTResult,
    BTSpec,
    BTSummary,
    BTTrade,
)
from .condition_evaluator import (
    collect_required_dynamic_indicator_keys,
    collect_required_ohlcv_features,
    evaluate_condition_group,
)
from app.indicators import (
    compute_candlestick_pattern_flags,
    compute_indicator_series,
    compute_pinbar_flags,
)
from .mtf_helpers import (
    build_bar_alignment,
    forward_fill_to_primary,
    split_lens_with_timeframe,
)


# PR ②-1: pattern.* snapshot key (= SUPPORTED_LENS_FEATURE_MAP の値) と
# `compute_*_flags` の戻り値 dict キーの対応。
#
# Python 実装の責務分離:
# - `compute_pinbar_flags` は厳密な pinbar (3:0.5 比率) を **bull / bear で分割**
#   して返す (`pinbar` / `pinbar_bull` / `pinbar_bear` の 3 種)。
# - `compute_candlestick_pattern_flags` は同じ pinbar_like 式も内部で計算し、
#   **戻り値に `pinbar` キー (bull/bear 分割なし) を含む**。さらに hammer 系 /
#   shooting_star / engulfing / doji / thrust 系の 9 系列を返す。
#
# 本 runner の DSL pattern lens は **pinbar 系を `compute_pinbar_flags` から
# 取得** し (= bull/bear を区別したいため)、`compute_candlestick_pattern_flags`
# 側の `pinbar` キーは **意図的に使わない**。残りの 9 系列は
# `compute_candlestick_pattern_flags` から取得する。
_PATTERN_SNAPSHOT_KEYS: dict = {
    "pattern.pinbar": ("pinbar", "pinbar"),
    "pattern.pinbar_bull": ("pinbar", "pinbar_bull"),
    "pattern.pinbar_bear": ("pinbar", "pinbar_bear"),
    "pattern.hammer": ("candlestick", "hammer"),
    "pattern.hammer_bull": ("candlestick", "hammer_bull"),
    "pattern.hammer_bear": ("candlestick", "hammer_bear"),
    "pattern.shooting_star": ("candlestick", "shooting_star"),
    "pattern.engulfing_bull": ("candlestick", "engulfing_bull"),
    "pattern.engulfing_bear": ("candlestick", "engulfing_bear"),
    "pattern.doji": ("candlestick", "doji"),
    "pattern.thrust_bull": ("candlestick", "thrust_bull"),
    "pattern.thrust_bear": ("candlestick", "thrust_bear"),
}


# 本実装のバージョン (DB の engineVersion カラムに記録される)
# PR #112: DSL conditions 評価対応で minor 更新
# PR #116c: params 付き indicator / compareTarget 評価対応
ENGINE_VERSION = "analysis-engine/backtesting.py@0.6.5+conditions+indicators"


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
        # PR #116c: params 付き indicator / compareTarget の operand を事前抽出。
        # 戻り値は (snapshot_key, lens, feature, params_items) tuple のリスト。
        # snapshot_key は `${lens}.${feature}(stable_params)` 形式で、
        # `_build_feature_snapshot` がこの key で series 値を提供する。
        required_dynamic_indicators = list(
            collect_required_dynamic_indicator_keys(trigger_group)
        )
        # PR ⑤B (MTF): 上位足 timeframe ごとの OHLCV (= runner.py で _load_ohlcv 済)。
        # init() で alignment 計算 + indicator/pattern pre-compute + forward fill する。
        upper_tf_ohlcv = spec.upper_timeframe_ohlcv or {}
        primary_timeframe_for_mtf = spec.primary_timeframe

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
                # PR #116c: params 付き indicator (ema(20) / macd(12,26,9) 等) と
                # compareTarget の operand を pre-compute。snapshot key (lens.feature(params))
                # → 値配列のマップとして保持し、`_build_feature_snapshot` が現バー値を
                # 取り出して feature_snapshot に詰める。
                # `compute_indicator_series` (analysis-engine 既存) を呼んで pandas_ta で
                # 計算、戻り値の `values` は OHLCV 行数と同じ長さ (warm-up は None)。
                self._dynamic_indicator_series: dict = {}
                ohlcv_df = pd.DataFrame(
                    {
                        "open": pd.Series(self.data.Open),
                        "high": pd.Series(self.data.High),
                        "low": pd.Series(self.data.Low),
                        "close": close,
                        "volume": pd.Series(self.data.Volume),
                    }
                )
                # PR #118 Copilot review #6: 未対応 indicator / params で series を計算
                # できなかった事例は snapshot 登録せず leaf 評価で false に倒れる挙動だが、
                # 「常に false」の原因が観測できないため WARN ログを出力する。
                # 戦略 instance に未対応 snapshot key リストを保持して、上位層から取り出す
                # 経路の整備は別 PR で対応 (本 PR では observability のみ最低限担保)。
                self._unsupported_dynamic_indicators: List[str] = []

                # PR ⑤B (MTF): 上位足 OHLCV からの indicator pre-compute + alignment 計算 +
                # forward fill。alignment は timeframe ごとに 1 回だけ計算してキャッシュ。
                # PR #130 Copilot review #7: ohlcv_df は self.data.* から組み立てた
                # DataFrame で index が RangeIndex(0..N) になり alignment 計算で
                # AttributeError になる。主バー側は backtesting.py が保持する元 DataFrame
                # の timestamp index (= self.data.index、_load_ohlcv で datetime にしてある)
                # を使う。
                upper_tf_dfs: Dict[str, pd.DataFrame] = {}
                upper_tf_alignments: Dict[str, List[int]] = {}
                if upper_tf_ohlcv and primary_timeframe_for_mtf:
                    primary_index = list(self.data.index)
                    for tf, upper_df in upper_tf_ohlcv.items():
                        # OHLCV column を小文字に正規化
                        upper_df_norm = upper_df.copy()
                        for c in ("open", "high", "low", "close", "volume"):
                            if c in upper_df_norm.columns:
                                upper_df_norm[c] = upper_df_norm[c].astype(float)
                        upper_tf_dfs[tf] = upper_df_norm
                        try:
                            upper_tf_alignments[tf] = build_bar_alignment(
                                primary_index,
                                list(upper_df_norm.index),
                                primary_timeframe_for_mtf,
                                tf,
                            )
                        except ValueError as exc:
                            # 未知 timeframe など。本 timeframe の MTF 計算は丸ごとスキップ
                            logger.warning(
                                "PR ⑤B: MTF alignment skipped (tf=%s): %s",
                                tf,
                                exc,
                            )

                for snapshot_key, lens_name, feature_key, params_items in required_dynamic_indicators:
                    # PR ⑤B (MTF): lens_name は `ohlcv` または `ohlcv@<tf>` (= 上位足)
                    base_lens, lens_tf, _ = split_lens_with_timeframe(
                        f"{lens_name}.{feature_key}"
                    )
                    if base_lens != "ohlcv":
                        # 別 lens は現状未対応 → snapshot に登録せず、leaf 評価で false に倒れる
                        logger.warning(
                            "PR #116c: dynamic indicator skipped (non-ohlcv lens): %s",
                            snapshot_key,
                        )
                        self._unsupported_dynamic_indicators.append(snapshot_key)
                        continue

                    params_dict = dict(params_items)
                    # PR ⑤B (MTF): timeframe が指定されていて主と異なる場合は上位足経路
                    use_upper_tf = (
                        lens_tf is not None
                        and lens_tf != primary_timeframe_for_mtf
                    )
                    target_df = upper_tf_dfs.get(lens_tf) if use_upper_tf else ohlcv_df
                    if target_df is None:
                        logger.warning(
                            "PR ⑤B: MTF dynamic indicator skipped (tf %s OHLCV not loaded): %s",
                            lens_tf,
                            snapshot_key,
                        )
                        self._unsupported_dynamic_indicators.append(snapshot_key)
                        continue
                    try:
                        _key, values = compute_indicator_series(
                            indicator_id=feature_key,
                            params=params_dict,
                            field="value",
                            df=target_df,
                        )
                    except (ValueError, KeyError) as exc:
                        logger.warning(
                            "PR #116c: dynamic indicator skipped (compute_indicator_series failed): %s — %s: %s",
                            snapshot_key,
                            type(exc).__name__,
                            exc,
                        )
                        self._unsupported_dynamic_indicators.append(snapshot_key)
                        continue
                    if use_upper_tf and lens_tf is not None:
                        # 主バー長に forward fill
                        alignment = upper_tf_alignments.get(lens_tf)
                        if alignment is None:
                            self._unsupported_dynamic_indicators.append(snapshot_key)
                            continue
                        values = forward_fill_to_primary(values, alignment, None)
                    self._dynamic_indicator_series[snapshot_key] = values

                # PR ②-1: pattern lens (12 種ローソク足パターン真偽) を pre-compute。
                # PR ⑤B (MTF): `pattern.<patternId>` (= 主 timeframe) と
                #   `pattern@<tf>.<patternId>` (= 上位足) の両方をサポート。
                #   主 timeframe は既存通り、上位足は upper_tf_dfs から計算 + forward fill。
                self._pattern_flag_series: dict = {}
                primary_pattern_keys: list = []
                upper_pattern_keys_by_tf: Dict[str, list] = {}
                for k in required_features:
                    if not isinstance(k, str) or not k.startswith("pattern"):
                        continue
                    base_lens, lens_tf, feature_part = split_lens_with_timeframe(k)
                    if base_lens != "pattern":
                        continue
                    if lens_tf is None or lens_tf == primary_timeframe_for_mtf:
                        primary_pattern_keys.append(k)
                    else:
                        upper_pattern_keys_by_tf.setdefault(lens_tf, []).append(k)

                if primary_pattern_keys:
                    pin_dict = compute_pinbar_flags(ohlcv_df)
                    cs_dict = compute_candlestick_pattern_flags(ohlcv_df)
                    for sk in primary_pattern_keys:
                        if sk not in _PATTERN_SNAPSHOT_KEYS:
                            continue
                        source, key = _PATTERN_SNAPSHOT_KEYS[sk]
                        src_dict = pin_dict if source == "pinbar" else cs_dict
                        if key in src_dict:
                            self._pattern_flag_series[sk] = src_dict[key]

                # 上位足 pattern: timeframe ごとに 1 度だけ pin/cs を計算 + forward fill
                for upper_tf, sk_list in upper_pattern_keys_by_tf.items():
                    upper_df = upper_tf_dfs.get(upper_tf)
                    alignment = upper_tf_alignments.get(upper_tf)
                    if upper_df is None or alignment is None:
                        continue
                    pin_dict = compute_pinbar_flags(upper_df)
                    cs_dict = compute_candlestick_pattern_flags(upper_df)
                    for sk in sk_list:
                        # sk = `pattern@1h.engulfing_bull` → 主 timeframe key への
                        #   変換: `pattern.engulfing_bull` で _PATTERN_SNAPSHOT_KEYS を
                        #   引いて (source, key) を取得
                        _, _, feat_part = split_lens_with_timeframe(sk)
                        primary_form_sk = f"pattern.{feat_part}"
                        if primary_form_sk not in _PATTERN_SNAPSHOT_KEYS:
                            continue
                        source, key = _PATTERN_SNAPSHOT_KEYS[primary_form_sk]
                        src_dict = pin_dict if source == "pinbar" else cs_dict
                        if key not in src_dict:
                            continue
                        # 上位足 boolean 配列を主バー長に forward fill
                        upper_bools = list(src_dict[key])
                        filled = forward_fill_to_primary(upper_bools, alignment, False)
                        self._pattern_flag_series[sk] = filled

                # PR #130 Copilot review #8: 上位足の OHLCV (open/high/low/close/volume)
                # も `ohlcv@<tf>.<field>` snapshot key で保持する。collect_required_upper_tf_features
                # で「必要な上位足 static feature」が判定されており、それらを alignment +
                # forward fill して詰める。これがないと condition.timeframe='1h' の price 系
                # leaf (例: `ohlcv@1h.close > 1.05`) が snapshot に値なし → 常に false 評価。
                self._upper_tf_static_features: dict = {}
                # `required_features` set に含まれる `ohlcv@<tf>.<field>` を抽出
                upper_tf_static_keys = [
                    k for k in required_features
                    if isinstance(k, str)
                    and k.startswith("ohlcv@")
                    and "." in k
                ]
                for sk in upper_tf_static_keys:
                    base_lens, lens_tf, field = split_lens_with_timeframe(sk)
                    if base_lens != "ohlcv" or lens_tf is None:
                        continue
                    if field not in ("open", "high", "low", "close", "volume"):
                        continue
                    upper_df = upper_tf_dfs.get(lens_tf)
                    alignment = upper_tf_alignments.get(lens_tf)
                    if upper_df is None or alignment is None:
                        continue
                    if field not in upper_df.columns:
                        continue
                    upper_arr = list(upper_df[field].astype(float).values)
                    filled = forward_fill_to_primary(upper_arr, alignment, None)
                    self._upper_tf_static_features[sk] = filled

                self._entry_bar: Optional[int] = None

            def _build_feature_snapshot(self, offset: int = 0) -> dict:
                """`offset` バー前の ohlcv feature 値辞書を作る。条件評価器に渡す入力。

                - `offset=0`: 現バー (= `self.data.Close[-1]`)
                - `offset=1`: 1 バー前 (= cross / Touch 系 op 用の前バー snapshot)

                static feature (open/high/low/close/volume/rsi/atr) に加えて、
                PR #116c で pre-compute した params 付き indicator の値も
                snapshot key (`lens.feature(stable_params)`) で詰める。

                PR ①-B (post-Phase 5A): `offset` パラメータを追加。前バーが存在しない
                場合 (= `len(self.data) <= offset`) は空 dict を返す。
                """
                if len(self.data) <= offset:
                    return {}
                # backtesting.py の self.data はバー進行に応じてスライスされており、
                # 現バー = index -1。`offset=N` で N バー前を取りたい場合は -1-N。
                idx_neg = -1 - offset
                snapshot = {
                    "open": float(self.data.Open[idx_neg]),
                    "high": float(self.data.High[idx_neg]),
                    "low": float(self.data.Low[idx_neg]),
                    "close": float(self.data.Close[idx_neg]),
                    "volume": float(self.data.Volume[idx_neg]),
                    "atr": float(self._atr[idx_neg]) if self._atr is not None else None,
                }
                if self._rsi is not None:
                    snapshot["rsi"] = float(self._rsi[idx_neg])
                # PR #116c: dynamic indicator (params 付き) の N バー前値を追加。
                # `compute_indicator_series` の戻り値 `values` はバー数と同じ長さの
                # `List[Optional[float]]` (warm-up は None)。
                idx = len(self.data) - 1 - offset
                for snapshot_key, values in self._dynamic_indicator_series.items():
                    if 0 <= idx < len(values):
                        snapshot[snapshot_key] = values[idx]
                    else:
                        snapshot[snapshot_key] = None
                # PR ②-1: pattern lens の N バー前値を追加。
                # 戻り値 `series` は List[bool] (バー数と同じ長さ)。
                for snapshot_key, series in self._pattern_flag_series.items():
                    if 0 <= idx < len(series):
                        snapshot[snapshot_key] = bool(series[idx])
                    else:
                        snapshot[snapshot_key] = False
                # PR #130 Copilot review #8: 上位足の static feature
                # (`ohlcv@<tf>.open/high/low/close/volume`) も詰める。
                for snapshot_key, series in self._upper_tf_static_features.items():
                    if 0 <= idx < len(series):
                        snapshot[snapshot_key] = series[idx]
                    else:
                        snapshot[snapshot_key] = None
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
                # PR ①-B: cross / Touch 系 op のため前バー snapshot も併せて渡す。
                if self._trigger_group is not None:
                    snapshot = self._build_feature_snapshot(offset=0)
                    prev_snapshot = self._build_feature_snapshot(offset=1)
                    prev_arg = prev_snapshot if prev_snapshot else None
                    if not evaluate_condition_group(
                        self._trigger_group, snapshot, prev_arg
                    ):
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
                """pip サイズを entry_price レンジから推定する。

                - `entry_price >= 50.0`: JPY ペア相当 (例: USDJPY=150.x) → 0.01
                - それ以外: 標準 forex / 低価格資産 → 0.0001 (保守値)

                v1 はシンボル文字列を見ずに価格レンジだけで判定するため、特殊資産
                (BTC など) では実価格と pip 単位がズレる可能性がある。設計書 §4 で
                許容される簡易推定として扱う。
                """
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
