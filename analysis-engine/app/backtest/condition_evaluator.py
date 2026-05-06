"""Critical-4 PR #112: DSL conditions 評価器

Python 側 BT が DSL.entry.trigger (= ConditionGroup) を **構造を保ったまま** 評価する
ためのモジュール。TS surrogate と Python 正式 BT で **同じ仮説を同じ意味で評価する**
ための要。

設計方針:
    - 評価本体は本ファイル (純粋関数)。Strategy.next() からは「現バーの feature 値辞書」
      と「ConditionGroup」を渡して true/false を受け取るだけ。
    - 対応 lens は **`ohlcv` のみ** (= 現 DSL の表現範囲、TS surrogate と同等)。
      features: `open / high / low / close / volume / rsi / atr` の 7 種。
    - 未対応 lens / feature は **leaf 単位で false を返す**。verdict は OOS validation 側で
      analysis-engine が判定する (= leaf が常に false でも tradeCount=0 → unknown 経路で
      正しく観測される)。
    - `params` / `compareTarget` は v1 では未対応 (DSL 側にも無いため)。
"""

from __future__ import annotations

from typing import Any, Mapping, Optional, Sequence, Union

from app.schemas import ScreeningBacktestCondition, ScreeningBacktestConditionGroup


# =================================================================
# feature 名の対応表 (lensName.featureKey → 評価可能か)
# =================================================================

# 現 DSL が表現できる範囲。TS surrogate と完全に同じセット。
SUPPORTED_OHLCV_FEATURES = frozenset(
    ["open", "high", "low", "close", "volume", "rsi", "atr"]
)


def is_supported_leaf(condition: ScreeningBacktestCondition) -> bool:
    """leaf 条件が Python 評価器でサポートされているか。"""
    if condition.lensName != "ohlcv":
        return False
    return condition.featureKey in SUPPORTED_OHLCV_FEATURES


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
    """単一 leaf を評価する。サポート外 lens / feature は False を返す。"""
    if not is_supported_leaf(condition):
        return False
    value = feature_snapshot.get(condition.featureKey)
    if value is None:
        return False
    # 数値である NaN は比較不能なので False に倒す
    try:
        if value != value:  # NaN
            return False
    except TypeError:
        pass
    return _compare(value, condition.op, condition.value)


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
    """ConditionGroup を再帰走査し、必要な ohlcv featureKey 集合を返す。

    Strategy.init() で「どの指標を pandas_ta で計算するか」を決めるために使う。
    - 戻り値は `{'rsi', 'atr', 'close', ...}` のセット
    - サポート外 lens の leaf は無視する (= 評価で false に倒れるため計算不要)
    """
    out: set = set()
    if group is None:
        return out
    for child in group.conditions:
        if _is_group(child):
            out |= collect_required_ohlcv_features(child)  # type: ignore[arg-type]
        else:
            cond: ScreeningBacktestCondition = child  # type: ignore[assignment]
            if is_supported_leaf(cond):
                out.add(cond.featureKey)
    return out
