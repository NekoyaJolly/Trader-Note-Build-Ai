"""
Walk-Forward Analysis（Phase 4c Step C）

Phase 4b の Side-A BacktestRun が生成したトレードイベント列を時間軸で
分割し、In-Sample / Out-of-Sample 窓間で性能の安定性を測る。

重要な設計上の前提:
    本実装は Side-A のバックテスト結果（固定条件・固定 SL/TP）を
    時間窓でパーティショニングする「時間的安定性テスト」に相当する。
    各窓で最適化パラメーターを再学習する真の Walk-Forward とは異なる
    （Side-B の仮説には再学習パラメーターが無いため不要）。
    -- 実装詳細は docs/design/phase_4c_specification.md §4.5 を参照。

依存: Python 標準ライブラリのみ（vectorbt 不要、stdlib 完結）。

実行:
    python /app/walk_forward/walk_forward.py <input.json> <output.json>

入力ペイロード:
    {
        "events": [{"entryTime": "ISO8601", "pnl": number}, ...],
        "period": {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"},
        "splitCount": 4
    }

出力:
    {
        "overfitScore": float,        # |avg(IS win rate) - avg(OOS win rate)|
        "avgInSampleWinRate": float,
        "avgOutOfSampleWinRate": float,
        "inSamplePF": float,
        "outOfSamplePF": float,
        "splitCount": int,
        "totalTradeCount": int,
        "windowsEvaluated": int       # 実際に有効メトリクスを出せた窓数
    }
"""

import json
import math
import sys
from datetime import datetime, timezone
from typing import Any


# ===========================================
# パース / 日時
# ===========================================


def parse_iso(s: str) -> datetime:
    """ISO8601 を aware datetime に。'Z' suffix も受け付ける。"""
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


# ===========================================
# メトリクス計算
# ===========================================


def compute_metrics(pnls: list[float]) -> dict[str, float]:
    """
    トレード損益列から勝率と Profit Factor を出す。
    空配列の場合は None（呼び出し側で該当窓をスキップさせる）。
    """
    if not pnls:
        return {"win_rate": float("nan"), "pf": float("nan"), "trade_count": 0}

    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    win_rate = len(wins) / len(pnls)
    total_profit = sum(wins)
    total_loss = abs(sum(losses))

    if total_loss > 0:
        pf = total_profit / total_loss
    elif total_profit > 0:
        # 全勝で割る相手なし → 大きい値だが Infinity は後段の平均で扱いづらいので 999 にクランプ
        pf = 999.0
    else:
        pf = 0.0

    return {"win_rate": win_rate, "pf": pf, "trade_count": len(pnls)}


# ===========================================
# 本体
# ===========================================


def run_walk_forward(payload: dict[str, Any]) -> dict[str, Any]:
    events = payload.get("events") or []
    period = payload.get("period") or {}
    split_count = int(payload.get("splitCount", 4))

    if split_count < 1:
        raise ValueError(f"splitCount must be >= 1, got {split_count}")

    start = parse_iso(period["start"])
    end = parse_iso(period["end"])
    total_sec = (end - start).total_seconds()
    if total_sec <= 0:
        raise ValueError(f"invalid period: {period['start']} ~ {period['end']}")

    # 各分割は IS 半分 + OOS 半分の2窓。よって細分化は split_count * 2 個。
    window_count = split_count * 2
    window_sec = total_sec / window_count

    # バケット分け
    buckets: list[list[float]] = [[] for _ in range(window_count)]
    for e in events:
        try:
            t = parse_iso(e["entryTime"])
        except (KeyError, ValueError):
            continue
        pnl = e.get("pnl")
        if not isinstance(pnl, (int, float)) or not math.isfinite(pnl):
            continue
        offset = (t - start).total_seconds()
        if offset < 0 or offset >= total_sec:
            continue
        idx = min(window_count - 1, int(offset / window_sec))
        buckets[idx].append(float(pnl))

    # IS / OOS ペアで評価
    is_metrics: list[dict[str, float]] = []
    oos_metrics: list[dict[str, float]] = []
    windows_evaluated = 0
    for i in range(split_count):
        is_pnls = buckets[2 * i]
        oos_pnls = buckets[2 * i + 1]
        is_m = compute_metrics(is_pnls)
        oos_m = compute_metrics(oos_pnls)
        # 両窓ともトレード 0 の分割はメトリクス算出不能なのでスキップ
        if is_m["trade_count"] == 0 and oos_m["trade_count"] == 0:
            continue
        is_metrics.append(is_m)
        oos_metrics.append(oos_m)
        windows_evaluated += 1

    total_trade_count = sum(len(b) for b in buckets)

    if windows_evaluated == 0:
        # 全窓でトレード 0 → 統計不能。NaN は JSON 化できないので None に。
        return {
            "overfitScore": None,
            "avgInSampleWinRate": None,
            "avgOutOfSampleWinRate": None,
            "inSamplePF": None,
            "outOfSamplePF": None,
            "splitCount": split_count,
            "totalTradeCount": total_trade_count,
            "windowsEvaluated": 0,
        }

    avg_is_wr = _nanmean([m["win_rate"] for m in is_metrics])
    avg_oos_wr = _nanmean([m["win_rate"] for m in oos_metrics])
    avg_is_pf = _nanmean([m["pf"] for m in is_metrics])
    avg_oos_pf = _nanmean([m["pf"] for m in oos_metrics])

    # 過学習指標: IS と OOS の勝率乖離（|IS - OOS|）。
    # IS のほうが高い（= OOS で性能劣化）＝過学習サインなので
    # 方向は問わず絶対値を採用する。
    if math.isnan(avg_is_wr) or math.isnan(avg_oos_wr):
        overfit_score = float("nan")
    else:
        overfit_score = abs(avg_is_wr - avg_oos_wr)

    return {
        "overfitScore": _none_if_nan(overfit_score),
        "avgInSampleWinRate": _none_if_nan(avg_is_wr),
        "avgOutOfSampleWinRate": _none_if_nan(avg_oos_wr),
        "inSamplePF": _none_if_nan(avg_is_pf),
        "outOfSamplePF": _none_if_nan(avg_oos_pf),
        "splitCount": split_count,
        "totalTradeCount": total_trade_count,
        "windowsEvaluated": windows_evaluated,
    }


def _nanmean(values: list[float]) -> float:
    finite = [v for v in values if not math.isnan(v)]
    if not finite:
        return float("nan")
    return sum(finite) / len(finite)


def _none_if_nan(value: float):
    """NaN は JSON にシリアライズできない（json.dumps は NaN を吐くが、
    JS 側で JSON.parse できない）ので null に落とす。"""
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


# ===========================================
# エントリポイント
# ===========================================


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print("usage: walk_forward.py <input.json> <output.json>", file=sys.stderr)
        return 2

    input_path, output_path = argv[1], argv[2]

    try:
        with open(input_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"failed to read input: {exc}", file=sys.stderr)
        return 1

    try:
        result = run_walk_forward(payload)
    except Exception as exc:  # noqa: BLE001
        print(f"walk_forward failed: {exc}", file=sys.stderr)
        return 1

    try:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)
    except OSError as exc:
        print(f"failed to write output: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
