"""Critical-4 PR #112: DSL conditions 評価器

Python 側 BT が DSL.entry.trigger (= ConditionGroup) を **構造を保ったまま** 評価する
ためのモジュール。TS surrogate と Python 正式 BT で **同じ仮説を同じ意味で評価する**
ための要。

設計方針:
    - 評価本体は本ファイル (純粋関数)。Strategy.next() からは「現バーの feature 値辞書」
      と「ConditionGroup」を渡して true/false を受け取るだけ。
    - 対応 lens は **`ohlcv` のみ** (= 現 DSL の表現範囲、TS surrogate と同等)。
      static features: `open / high / low / close / volume / rsi / atr` の 7 種。
    - 未対応 lens / feature は **leaf 単位で false を返す**。verdict は OOS validation 側で
      analysis-engine が判定する (= leaf が常に false でも tradeCount=0 → unknown 経路で
      正しく観測される)。
    - PR #116c: `params` (動的 indicator パラメータ) と `compareTarget` (indicator
      operand 比較) に対応。snapshot key は `${lens}.${feature}(stable_params)`
      形式 (TS の `buildSnapshotKey` と同形)、`runner_backtesting_py.py` の
      `_build_feature_snapshot` がこの key で series を提供する。
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Mapping, Optional, Sequence, Tuple, Union

from app.schemas import (
    ScreeningBacktestCondition,
    ScreeningBacktestConditionGroup,
    ScreeningBacktestIndicatorOperand,
)


# =================================================================
# feature 名の対応表 (lensName.featureKey → snapshot key)
# =================================================================

# Side-B DSL は歴史的経緯で **2 系統の表現** を持つ:
#   (A) `lens: 'ohlcv', feature: 'rsi'`    ← TS surrogate (snapshotAt) が期待する形
#   (B) `lens: 'rsi',   feature: 'value'`  ← 過去の DSL fixture / mutation 出力に存在
# 両方を取りこぼさないため、`(lensName, featureKey)` から **snapshot key** に正規化する
# alias マップを単一の真実として持つ。snapshot key は `runner_backtesting_py.py` の
# `_build_feature_snapshot()` が辞書のキーとして使う名前。
SUPPORTED_LENS_FEATURE_MAP: dict = {
    # 標準 ohlcv lens
    ("ohlcv", "open"): "open",
    ("ohlcv", "high"): "high",
    ("ohlcv", "low"): "low",
    ("ohlcv", "close"): "close",
    ("ohlcv", "volume"): "volume",
    ("ohlcv", "rsi"): "rsi",
    ("ohlcv", "atr"): "atr",
    # 別系統表現の alias (= 旧 DSL fixture / mutation 出力での書き方)
    ("rsi", "value"): "rsi",
    ("atr", "value"): "atr",
}


def _format_stable_number(v: Any) -> str:
    """TS `formatStableNumber` と同等の数値正規化。

    - **bool は明示的に弾く** (PR #118 Copilot review #4: Python の bool は int の
      subclass なので `isinstance(v, (int, float))` を素通りしてしまう。TS 側
      `z.number()` と挙動を揃えるため)
    - 非有限値 (NaN / Infinity) は ValueError
    - -0 は 0 に正規化
    - 整数値の float (例: 20.0) は int 表記 (= TS の `String(20)` と一致)
    - その他は `str(v)`
    """
    if isinstance(v, bool):
        # bool は int subclass なので isinstance(v, int) が true になる。先に弾く。
        raise ValueError(f"snapshot key params: bool は使えない (value={v!r})")
    if not isinstance(v, (int, float)):
        raise ValueError(f"snapshot key params: 数値以外は使えない (value={v!r})")
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            raise ValueError(f"snapshot key params: 非有限値は使えない (value={v})")
    if v == 0:
        return "0"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _format_stable_params(params: Optional[Mapping[str, Any]]) -> str:
    """TS `formatStableParams` と同等。キー昇順 + 数値正規化で `key=value,key=value` 形式。"""
    if not params:
        return ""
    parts = []
    for k in sorted(params.keys()):
        parts.append(f"{k}={_format_stable_number(params[k])}")
    return ",".join(parts)


def _build_dynamic_snapshot_key(lens_name: str, feature_key: str, params: Optional[Mapping[str, Any]]) -> str:
    """PR #116c: params 付き indicator の snapshot key を構築 (TS `buildSnapshotKey` 同等)。"""
    if not params:
        return f"{lens_name}.{feature_key}"
    return f"{lens_name}.{feature_key}({_format_stable_params(params)})"


def _resolve_snapshot_key(condition: ScreeningBacktestCondition):
    """leaf 条件を snapshot key に正規化する。サポート外なら None。

    PR #116c: `params` 付き condition は `${lens}.${feature}(stable_params)` 形式の
    snapshot key を返す (= runner_backtesting_py.py が pre-compute した series の key)。
    `params` なしは従来通り `SUPPORTED_LENS_FEATURE_MAP` 経由で簡略 key (例: 'rsi') に。

    PR #118 Copilot review #3: `params` 付きでも **lens は ohlcv のみ許可**
    (= analysis-engine が対応するのは ohlcv lens の indicator のみ)。それ以外は
    None を返して `unsupportedConditions` 観測経路に乗せる。
    """
    params = getattr(condition, "params", None)
    if params:
        if condition.lensName != "ohlcv":
            return None
        return _build_dynamic_snapshot_key(condition.lensName, condition.featureKey, params)
    return SUPPORTED_LENS_FEATURE_MAP.get((condition.lensName, condition.featureKey))


def _resolve_operand_snapshot_key(operand: ScreeningBacktestIndicatorOperand):
    """PR #116c: compareTarget operand から snapshot key を構築する。
    PR #118 Copilot review #3: dynamic key (params 付き) も ohlcv lens のみ許可。
    """
    params = getattr(operand, "params", None)
    if params:
        if operand.lensName != "ohlcv":
            return None
        return _build_dynamic_snapshot_key(operand.lensName, operand.featureKey, params)
    return SUPPORTED_LENS_FEATURE_MAP.get((operand.lensName, operand.featureKey))


def is_supported_leaf(condition: ScreeningBacktestCondition) -> bool:
    """leaf 条件が Python 評価器でサポートされているか。

    PR #116c: params 付き condition は dynamic snapshot key 経由で対応 (= snapshot に
    値があれば true と判定可能)。compareTarget の operand も同様に snapshot から引ける形なら OK。
    """
    if _resolve_snapshot_key(condition) is None:
        return False
    target = getattr(condition, "compareTarget", None)
    if target is not None and _resolve_operand_snapshot_key(target) is None:
        return False
    return True


# =================================================================
# 比較演算 (純粋関数)
# =================================================================


def _compare(left: Union[float, int, str, bool, None], op: str, right: Any) -> bool:
    """単一比較 leaf の真偽を返す。型不整合 / None / 失敗時は False。"""
    if left is None:
        return False

    if op == "==":
        return left == right
    if op == "!=":
        return left != right
    if op == "<":
        try:
            return float(left) < float(right)
        except (TypeError, ValueError):
            return False
    if op == "<=":
        try:
            return float(left) <= float(right)
        except (TypeError, ValueError):
            return False
    if op == ">":
        try:
            return float(left) > float(right)
        except (TypeError, ValueError):
            return False
    if op == ">=":
        try:
            return float(left) >= float(right)
        except (TypeError, ValueError):
            return False
    if op == "between":
        # right は [low, high] tuple/list を想定
        if not isinstance(right, (list, tuple)) or len(right) != 2:
            return False
        try:
            lf = float(left)
            return float(right[0]) <= lf <= float(right[1])
        except (TypeError, ValueError):
            return False
    if op == "in":
        if not isinstance(right, (list, tuple)):
            return False
        # 文字列正規化込みで包含判定
        try:
            return left in right or str(left) in [str(v) for v in right]
        except TypeError:
            return False

    return False


# =================================================================
# leaf 評価
# =================================================================


def _evaluate_leaf(
    condition: ScreeningBacktestCondition,
    feature_snapshot: Mapping[str, Optional[float]],
) -> bool:
    """単一 leaf を評価する。サポート外 lens / feature は False を返す。

    `(lensName, featureKey)` を `SUPPORTED_LENS_FEATURE_MAP` で snapshot key に正規化
    してから snapshot を引く (= `rsi.value` も `ohlcv.rsi` も同じ snapshot key 'rsi'
    を経由するので両方の DSL 表現を受けられる)。

    PR #116c: `params` 付き condition は dynamic snapshot key (`lens.feature(stable_params)`)
    経由で snapshot を引く。`compareTarget` 付きは right operand を別 snapshot key から取る。
    """
    snapshot_key = _resolve_snapshot_key(condition)
    if snapshot_key is None:
        return False
    left = feature_snapshot.get(snapshot_key)
    if left is None:
        return False
    # 数値である NaN は比較不能なので False に倒す
    try:
        if left != left:  # NaN
            return False
    except TypeError:
        pass

    # PR #116c: compareTarget があれば right operand を別 indicator series から取る
    target = getattr(condition, "compareTarget", None)
    if target is not None:
        target_key = _resolve_operand_snapshot_key(target)
        if target_key is None:
            return False
        right = feature_snapshot.get(target_key)
        if right is None:
            return False
        try:
            if right != right:  # NaN
                return False
        except TypeError:
            pass
        return _compare(left, condition.op, right)

    return _compare(left, condition.op, condition.value)


# =================================================================
# group 評価 (再帰)
# =================================================================


def _is_group(item: Any) -> bool:
    return isinstance(item, ScreeningBacktestConditionGroup)


def evaluate_condition_group(
    group: Optional[ScreeningBacktestConditionGroup],
    feature_snapshot: Mapping[str, Optional[float]],
) -> bool:
    """ConditionGroup を再帰的に評価して true/false を返す。

    - `group` が None → True (= 条件指定なし、entry 許可。Strategy 側で別途判断)
    - `group.conditions` が空 → AND なら True、OR なら False (= 数学的な単位元)
    - 各 leaf は `_evaluate_leaf` で評価、子 group は再帰
    - `logic == 'AND'` なら全 child が True、`'OR'` なら少なくとも 1 つ True
    """
    if group is None:
        return True

    children: Sequence[
        Union[ScreeningBacktestCondition, ScreeningBacktestConditionGroup]
    ] = group.conditions
    if len(children) == 0:
        return group.logic == "AND"

    if group.logic == "AND":
        for child in children:
            if _is_group(child):
                if not evaluate_condition_group(child, feature_snapshot):  # type: ignore[arg-type]
                    return False
            else:
                if not _evaluate_leaf(child, feature_snapshot):  # type: ignore[arg-type]
                    return False
        return True

    # OR
    for child in children:
        if _is_group(child):
            if evaluate_condition_group(child, feature_snapshot):  # type: ignore[arg-type]
                return True
        else:
            if _evaluate_leaf(child, feature_snapshot):  # type: ignore[arg-type]
                return True
    return False


# =================================================================
# group 走査ヘルパ (= Strategy.init() で必要 feature を抽出するため)
# =================================================================


def collect_required_ohlcv_features(
    group: Optional[ScreeningBacktestConditionGroup],
) -> set:
    """ConditionGroup を再帰走査し、必要な **snapshot key** 集合を返す。

    Strategy.init() で「どの指標を pandas_ta で計算するか」を決めるために使う。
    - 戻り値は `{'rsi', 'atr', 'close', ...}` のセット (= snapshot key)
    - `(lens, feature)` のゆらぎ (`'ohlcv.rsi'` vs `'rsi.value'`) は alias マップで
      同じ snapshot key (`'rsi'`) に正規化される
    - サポート外 lens の leaf は無視する (= 評価で false に倒れるため計算不要)

    PR #120 Copilot review #8: leaf の `compareTarget` も走査して、operand が
    static feature (params なし、例: `compareTarget=rsi`) を参照する場合に
    snapshot key を集合に含める。これがないと `close > rsi (compareTarget)` が
    rsi 未計算で常に false 評価になる。params 付き compareTarget は
    `collect_required_dynamic_indicator_keys` 経路で別途処理されるため重複しない。
    """
    out: set = set()
    if group is None:
        return out
    for child in group.conditions:
        if _is_group(child):
            out |= collect_required_ohlcv_features(child)  # type: ignore[arg-type]
        else:
            cond: ScreeningBacktestCondition = child  # type: ignore[assignment]
            snapshot_key = _resolve_snapshot_key(cond)
            if snapshot_key is not None:
                out.add(snapshot_key)
            # PR #120 Copilot review #8: compareTarget の static operand も拾う
            target = getattr(cond, "compareTarget", None)
            if target is not None and not getattr(target, "params", None):
                target_key = _resolve_operand_snapshot_key(target)
                if target_key is not None:
                    out.add(target_key)
    return out


def collect_required_dynamic_indicator_keys(
    group: Optional[ScreeningBacktestConditionGroup],
) -> Iterable[Tuple[str, str, str, Tuple[Tuple[str, Any], ...]]]:
    """PR #116c: ConditionGroup を再帰走査し、params 付き indicator (= dynamic snapshot key)
    の (snapshot_key, lens, feature, params_items) を集めて返す。

    `runner_backtesting_py.py` の `_build_strategy_class` がこれを使って必要な
    indicator series を `compute_indicator_series` で pre-compute、`feature_snapshot`
    に詰める (key = snapshot_key)。

    戻り値の `params_items` は `tuple(sorted(params.items()))` で hashable + 比較可能。
    呼び出し側で重複排除に利用する。
    """
    out: list = []
    seen: set = set()
    if group is None:
        return out

    def _visit(lens_name: str, feature_key: str, params: Optional[Mapping[str, Any]]) -> None:
        if not params:
            return  # static feature は別経路 (collect_required_ohlcv_features) で扱う
        snapshot_key = _build_dynamic_snapshot_key(lens_name, feature_key, params)
        if snapshot_key in seen:
            return
        seen.add(snapshot_key)
        params_items = tuple(sorted(params.items()))
        out.append((snapshot_key, lens_name, feature_key, params_items))

    def _walk(g: ScreeningBacktestConditionGroup) -> None:
        for child in g.conditions:
            if _is_group(child):
                _walk(child)  # type: ignore[arg-type]
            else:
                cond: ScreeningBacktestCondition = child  # type: ignore[assignment]
                _visit(cond.lensName, cond.featureKey, getattr(cond, "params", None))
                target = getattr(cond, "compareTarget", None)
                if target is not None:
                    _visit(target.lensName, target.featureKey, getattr(target, "params", None))

    _walk(group)
    return out


def collect_unsupported_leaf_descriptions(
    group: Optional[ScreeningBacktestConditionGroup],
) -> list:
    """PR #112 Copilot review #2: ConditionGroup 内の **未対応 leaf** を文字列化して集める。

    `describe_unsupported_conditions` (flatten 配列向け) と並列で、triggerGroup ベースの
    未対応観測経路を提供する。将来 client が flatten conditions[] を空にして
    triggerGroup だけ送る場合でも、unsupportedConditions が漏れないようにする。
    """
    out: list = []
    if group is None:
        return out
    for child in group.conditions:
        if _is_group(child):
            out.extend(collect_unsupported_leaf_descriptions(child))  # type: ignore[arg-type]
        else:
            cond: ScreeningBacktestCondition = child  # type: ignore[assignment]
            if not is_supported_leaf(cond):
                out.append(f"{cond.lensName}.{cond.featureKey} {cond.op} {cond.value!r}")
    return out
