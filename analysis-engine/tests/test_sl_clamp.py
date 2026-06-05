"""SL 最小フロア / 最大キャップ clamp のユニットテスト。

検証対象:
- adapter.attach_sl_clamp: minStopLossPips/maxStopLossPips を pip_size で価格距離に
  換算して BTSpec に付与する (pipSize<=0 や未指定時は無効)。
- GeneratedStrategy: spec の clamp 境界がクラス属性に伝播し、_compute_sl_distance が
  生 SL 距離をフロア/キャップで挟んだ実効距離を返す。

実行: analysis-engine/ で `python3 -m pytest tests/test_sl_clamp.py`
"""

import sys
import types
from pathlib import Path

import pytest

# analysis-engine/ を import path に追加 (test_walk_forward.py と同じ流儀)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.backtest.adapter import attach_sl_clamp  # noqa: E402
from app.backtest.engine_protocol import (  # noqa: E402
    BTSpec,
    BTStopLossAtrMultiple,
    BTStopLossFixedPips,
    BTTakeProfitRrRatio,
)
from app.backtest.runner_backtesting_py import BacktestingPyEngine  # noqa: E402
from app.schemas import ScreeningBacktestConfig  # noqa: E402


def _spec() -> BTSpec:
    return BTSpec(
        direction="long",
        stop_loss=BTStopLossAtrMultiple(value=1.5),
        take_profit=BTTakeProfitRrRatio(value=2.0),
    )


def _config(**overrides) -> ScreeningBacktestConfig:
    base = dict(pipSize=0.01, minStopLossPips=2.0, maxStopLossPips=80.0)
    base.update(overrides)
    return ScreeningBacktestConfig(**base)


class TestAttachSlClamp:
    def test_pips_to_price_distance_conversion(self):
        # pipSize=0.01, floor=2pips → 0.02 価格距離, cap=80pips → 0.80 価格距離
        out = attach_sl_clamp(_spec(), _config())
        assert out.min_stop_loss_price == 2.0 * 0.01
        assert out.max_stop_loss_price == 80.0 * 0.01

    def test_disabled_when_pip_size_zero(self):
        # pipSize<=0 は換算不能なので clamp を付与しない (後方互換)
        out = attach_sl_clamp(_spec(), _config(pipSize=0.0))
        assert out.min_stop_loss_price == 0.0
        assert out.max_stop_loss_price is None

    def test_disabled_when_no_floor_and_no_cap(self):
        # floor=0 かつ cap=None なら spec を変更しない
        out = attach_sl_clamp(_spec(), _config(minStopLossPips=0.0, maxStopLossPips=None))
        assert out.min_stop_loss_price == 0.0
        assert out.max_stop_loss_price is None

    def test_floor_only(self):
        out = attach_sl_clamp(_spec(), _config(maxStopLossPips=None))
        assert out.min_stop_loss_price == 2.0 * 0.01
        assert out.max_stop_loss_price is None

    def test_sets_effective_pip_size(self):
        # pipSize が与えられたら clamp の有無に関わらず effective_pip_size を spec に乗せる
        out = attach_sl_clamp(_spec(), _config(pipSize=0.1, minStopLossPips=0.0, maxStopLossPips=None))
        assert out.effective_pip_size == 0.1

    def test_effective_pip_size_zero_when_disabled(self):
        out = attach_sl_clamp(_spec(), _config(pipSize=0.0))
        assert out.effective_pip_size == 0.0


def _bind_compute(spec: BTSpec):
    """GeneratedStrategy の _compute_sl_distance / _raw_sl_distance を、Strategy を
    インスタンス化せずに呼べるよう最小のダミー self にバインドして返す。"""
    gs = BacktestingPyEngine._build_strategy_class(spec)
    dummy = types.SimpleNamespace(
        _spec_sl=spec.stop_loss,
        opt_sl_value=spec.stop_loss.value,
        _sl_floor_price=gs._sl_floor_price,
        _sl_cap_price=gs._sl_cap_price,
    )
    dummy._raw_sl_distance = types.MethodType(gs._raw_sl_distance, dummy)
    return gs, types.MethodType(gs._compute_sl_distance, dummy)


class TestStrategyClampWiring:
    def test_spec_clamp_propagates_to_class_attrs(self):
        spec = attach_sl_clamp(_spec(), _config())  # floor=0.02, cap=0.80
        gs = BacktestingPyEngine._build_strategy_class(spec)
        assert gs._sl_floor_price == 0.02
        assert gs._sl_cap_price == 0.80

    def test_floor_raises_small_sl(self):
        # 低ボラ: atr=0.005 × 1.5 = 0.0075 (生) → フロア 0.02 に底上げ
        spec = attach_sl_clamp(_spec(), _config())
        _, compute = _bind_compute(spec)
        assert compute(atr_val=0.005, entry_price=150.0) == 0.02

    def test_cap_limits_large_sl(self):
        # 高ボラ: atr=1.0 × 1.5 = 1.5 (生) → キャップ 0.80 に頭打ち
        spec = attach_sl_clamp(_spec(), _config())
        _, compute = _bind_compute(spec)
        assert compute(atr_val=1.0, entry_price=150.0) == 0.80

    def test_within_bounds_passthrough(self):
        # 通常ボラ: atr=0.2 × 1.5 = 0.30 (生) → フロア/キャップ内なのでそのまま
        spec = attach_sl_clamp(_spec(), _config())
        _, compute = _bind_compute(spec)
        assert compute(atr_val=0.2, entry_price=150.0) == pytest.approx(0.30)

    def test_no_clamp_when_disabled(self):
        # clamp 無効 (pipSize=0) のときは生 SL 距離をそのまま返す
        spec = attach_sl_clamp(_spec(), _config(pipSize=0.0))
        _, compute = _bind_compute(spec)
        assert compute(atr_val=0.005, entry_price=150.0) == 0.005 * 1.5


class TestFixedPipsPipSize:
    """fixed_pips の SL 距離が config.pipSize (effective_pip_size) で換算され、
    価格レンジ推定 (_pip_size) の単位ズレを起こさないことを固定する。"""

    def _fixed_pips_spec(self) -> BTSpec:
        return BTSpec(
            direction="long",
            stop_loss=BTStopLossFixedPips(value=10.0),
            take_profit=BTTakeProfitRrRatio(value=2.0),
        )

    def _bind_raw(self, spec: BTSpec):
        gs = BacktestingPyEngine._build_strategy_class(spec)
        dummy = types.SimpleNamespace(
            _spec_sl=spec.stop_loss,
            opt_sl_value=spec.stop_loss.value,
            _effective_pip_size=gs._effective_pip_size,
        )
        # _resolved_pip_size / _pip_size / _raw_sl_distance を dummy にバインド
        dummy._pip_size = types.MethodType(gs._pip_size, dummy)
        dummy._resolved_pip_size = types.MethodType(gs._resolved_pip_size, dummy)
        return types.MethodType(gs._raw_sl_distance, dummy)

    def test_uses_config_pip_size(self):
        # XAUUSD: pipSize=0.1。fixed_pips 10pips → 10 × 0.1 = 1.0 価格距離。
        # 価格レンジ推定 (entry_price=2000 → 0.01) のままだと 0.1 になり 10 倍ズレる。
        spec = attach_sl_clamp(self._fixed_pips_spec(), _config(pipSize=0.1))
        raw = self._bind_raw(spec)
        assert raw(atr_val=1.0, entry_price=2000.0) == pytest.approx(10.0 * 0.1)

    def test_falls_back_to_heuristic_when_pip_size_unset(self):
        # pipSize 未指定 (effective_pip_size=0) → 従来の _pip_size 推定 (entry=2000→0.01)
        spec = self._fixed_pips_spec()  # clamp 未付与 = effective_pip_size 0.0
        raw = self._bind_raw(spec)
        assert raw(atr_val=1.0, entry_price=2000.0) == pytest.approx(10.0 * 0.01)
