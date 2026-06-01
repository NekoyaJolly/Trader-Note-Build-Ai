from __future__ import annotations

from datetime import timezone
from typing import Dict, List

import pandas as pd
from fastapi import FastAPI
from sqlalchemy import text

from app.db import create_db_engine, load_db_config
from app.indicators import (
    compute_bb_bandwidth_flags,
    compute_candlestick_pattern_flags,
    compute_indicator_series,
    compute_pinbar_flags,
)
from app.schemas import (
    IndicatorSeriesByVersionRequest,
    IndicatorSeriesRequest,
    IndicatorSeriesResponse,
    OosValidationRequest,
    OosValidationResponse,
    OptimizeRequest,
    OptimizeResponse,
    ScreeningBacktestRequest,
    ScreeningBacktestResponse,
    WalkForwardRequest,
    WalkForwardResponse,
)
from app.chart_patterns import compute_chart_patterns
from app.smc import compute_smc_structures
from app.walk_forward import run_walk_forward
from app.wyckoff import compute_wyckoff_phases
from app.backtest import run_screening_backtest, run_optimize
from app.oos_validation import run_oos_validation

app = FastAPI(title="TradeAssist Analysis Engine", version="0.1.0")

cfg = load_db_config()
engine = create_db_engine(cfg)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/walk-forward", response_model=WalkForwardResponse)
def walk_forward(req: WalkForwardRequest) -> WalkForwardResponse:
    """Side-B WalkForward 検証。

    Node 側からトレードイベント列を受け取り、時間軸で IS/OOS に分割して
    過学習スコアと安定性指標を返す。
    """
    return run_walk_forward(req)


@app.post("/v1/oos-validation", response_model=OosValidationResponse)
def oos_validation(req: OosValidationRequest) -> OosValidationResponse:
    """Critical-4 PR #109: OOS Validation v1。

    既存 ScreeningBacktest を OOS 期間で実行し、metrics と保守的な verdict
    (passed / failed / unknown) を返す。Side-B Evolution layer から本 endpoint を
    叩いて `oosBacktestRunner` の戻り値として運ぶ想定。

    設計書 (docs/design/pr_105_analysis_engine_authority_addendum.md):
        - 評価の正本は analysis-engine 側。Side-B では再判定しない
        - 既存 endpoint には触らず additive に追加する
    """
    return run_oos_validation(engine, req)


@app.post("/v1/screening-backtest", response_model=ScreeningBacktestResponse)
def screening_backtest(req: ScreeningBacktestRequest) -> ScreeningBacktestResponse:
    """Critical-4 段階 1: 仮説スクリーニング BT。

    OHLCV を DB から直読みし、notePayload (direction / SL/TP 仕様) で動的に
    Strategy クラスを生成して backtesting.py で BT を走らせる。

    段階 1 では仮説の `conditions[]` (MachineReadableCondition) は評価しない。
    レンズ feature 評価機構を Python 側に持たないため、すべて
    `unsupportedConditions` に積んで「常時エントリー × SL/TP 約定」で BT する。
    """
    return run_screening_backtest(engine, req)


@app.post("/v1/optimize", response_model=OptimizeResponse)
def optimize(req: OptimizeRequest) -> OptimizeResponse:
    """進化ループ再設計 Phase 1: パラメータ最適化（決定論）。

    SL/TP 値の候補リスト（呼び出し側が現在値±N%・型刻みで生成）を受け取り、
    backtesting.py の Backtest.optimize() で最良値を決定論探索する。
    AGENTS.md ドメイン原則#3（数値最適化は決定論コードで）に沿い、LLM ではなく
    ライブラリに最適化させる経路。インジ期間最適化・train/OOS 過学習ガードは Phase 1b。
    """
    return run_optimize(engine, req)


@app.post("/v1/indicator-series", response_model=IndicatorSeriesResponse)
def indicator_series(req: IndicatorSeriesRequest) -> IndicatorSeriesResponse:
    """OHLCV を DB から直接読み込み、指標系列とパターン判定を返す。

    設計:
    - DB は Read-Only を前提
    - 返却する series は Node 側の cacheKey と互換
    """

    # Timescale/Prisma のモデル名に合わせて "OHLCVCandle" を参照
    sql = text(
        """
        SELECT timestamp, open, high, low, close, volume
        FROM \"OHLCVCandle\"
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
                "symbol": req.symbol,
                "timeframe": req.timeframe,
                "start_ts": req.startDate,
                "end_ts": req.endDate,
            },
        ).mappings().all()

    if not rows:
        return IndicatorSeriesResponse(
            symbol=req.symbol,
            timeframe=req.timeframe,
            timestamps=[],
            series={},
            patterns={},
        )

    df = pd.DataFrame(rows)

    # Decimal が混ざる場合に備え、float 化
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = df[col].astype(float)

    # Node 側 Zod（.datetime()）が末尾 Z を想定しているため、UTC の RFC3339（...Z）で統一する
    timestamps: List[str] = []
    for t in df["timestamp"].to_list():
        ts = pd.Timestamp(t)
        if ts.tzinfo is None:
            ts = ts.tz_localize(timezone.utc)
        else:
            ts = ts.tz_convert(timezone.utc)
        timestamps.append(ts.to_pydatetime().isoformat().replace("+00:00", "Z"))

    series: Dict[str, List[float | None]] = {}
    for spec in req.indicators:
        key, values = compute_indicator_series(df, spec.indicatorId, spec.params, spec.field)
        series[key] = values

    patterns: Dict[str, List[bool]] = {}
    if any(
        p in req.patterns
        for p in [
            "pinbar",
            "pinbar_bull",
            "pinbar_bear",
            "hammer",
            "hammer_bull",
            "hammer_bear",
            "shooting_star",
            "engulfing_bull",
            "engulfing_bear",
            "doji",
            "thrust_bull",
            "thrust_bear",
        ]
    ):
        # pinbar は bull/bear を含めて返す（互換: pinbar も同時に返る）
        if any(p in req.patterns for p in ["pinbar", "pinbar_bull", "pinbar_bear"]):
            patterns.update(compute_pinbar_flags(df))
        patterns.update(compute_candlestick_pattern_flags(df))
    if "bb_bandwidth" in req.patterns:
        patterns.update(
            compute_bb_bandwidth_flags(
                df,
                window=req.bbBandwidthWindow,
                threshold=req.bbBandwidthThreshold,
            )
        )

    # SMC structures (Phase 7a 追加、req.includeSmc=True 時のみ計算)
    smc_payload = None
    if req.includeSmc:
        smc_payload = compute_smc_structures(df)

    # Chart Patterns (Phase 7b 追加、req.includeChartPatterns=True 時のみ計算)
    chart_patterns_payload = None
    if req.includeChartPatterns:
        chart_patterns_payload = compute_chart_patterns(df)

    # Wyckoff phases (Phase 7c 追加、req.includeWyckoff=True 時のみ計算)
    # SMC context (Phase 7a) があれば phase 判定の精度が上がる、なくても動く
    wyckoff_payload = None
    if req.includeWyckoff:
        wyckoff_payload = compute_wyckoff_phases(df, smc_context=smc_payload)

    return IndicatorSeriesResponse(
        symbol=req.symbol,
        timeframe=req.timeframe,
        timestamps=timestamps,
        series=series,
        patterns=patterns,
        smc=smc_payload,
        chartPatterns=chart_patterns_payload,
        wyckoff=wyckoff_payload,
    )


def _collect_indicator_specs_from_condition_group(group: object) -> tuple[list[dict], list[str]]:
    """StrategyVersion.entryConditions（JSON）から必要指標を抽出。

    期待フォーマット:
    - ConditionGroup / IndicatorCondition（Node 側と同形）
    """

    specs_by_key: dict[str, dict] = {}
    patterns: set[str] = set()

    import json
    from collections.abc import Mapping

    # psycopg2 の設定やカラム型によっては JSON が文字列で返ることがあるため、ここで吸収する。
    if isinstance(group, str):
        try:
            group = json.loads(group)
        except Exception:
            return [], []

    # それ以外（psycopg2 の JSON ラッパー等）も文字列化して救済する
    if not isinstance(group, Mapping):
        try:
            group = json.loads(str(group))
        except Exception:
            return [], []

    def visit(node: object) -> None:
        if not isinstance(node, Mapping):
            return

        # パターン条件
        if node.get("type") == "pattern":
            pid = node.get("patternId")
            if isinstance(pid, str):
                patterns.add(pid)
            return

        # グループ
        if "conditions" in node:
            for child in node.get("conditions", []) or []:
                visit(child)

            if node.get("operator") == "IF_THEN":
                visit(node.get("ifCondition"))
                visit(node.get("thenCondition"))

            if node.get("operator") == "SEQUENCE":
                for step in node.get("sequence", []) or []:
                    visit(step)

            return

        # 単一条件（左辺）
        indicator_id = node.get("indicatorId")
        params = node.get("params") or {}
        field = node.get("field")
        if isinstance(indicator_id, str) and isinstance(field, str) and isinstance(params, Mapping):
            key = f"{indicator_id.lower()}_{json.dumps(params, sort_keys=True, separators=(',', ':'), ensure_ascii=False)}_{field}"
            specs_by_key[key] = {"indicatorId": indicator_id, "params": params, "field": field}

        # 右辺（インジケーター比較の場合）
        compare_target = node.get("compareTarget")
        if isinstance(compare_target, Mapping) and compare_target.get("type") == "indicator":
            rid = compare_target.get("indicatorId")
            rparams = compare_target.get("params") or {}
            rfield = compare_target.get("field")
            if isinstance(rid, str) and isinstance(rfield, str) and isinstance(rparams, Mapping):
                rkey = f"{rid.lower()}_{json.dumps(rparams, sort_keys=True, separators=(',', ':'), ensure_ascii=False)}_{rfield}"
                specs_by_key[rkey] = {"indicatorId": rid, "params": rparams, "field": rfield}

    visit(group)
    return list(specs_by_key.values()), sorted(patterns)


@app.post("/v1/indicator-series/by-version", response_model=IndicatorSeriesResponse)
def indicator_series_by_version(req: IndicatorSeriesByVersionRequest) -> IndicatorSeriesResponse:
    """IDベースで指標系列を返す（Node → Python は最小情報のみ）。"""

    # 1) StrategyVersion から entryConditions を取得
    version_sql = text(
        """
        SELECT \"entryConditions\" AS \"entryConditions\"
        FROM \"StrategyVersion\"
        WHERE id = :version_id
                    AND \"strategyId\" = :strategy_id
        """
    )

    with engine.connect() as conn:
        row = conn.execute(
            version_sql,
            {"version_id": req.versionId, "strategy_id": req.strategyId},
        ).mappings().first()

    if not row:
        return IndicatorSeriesResponse(
            symbol=req.symbol,
            timeframe=req.timeframe,
            timestamps=[],
            series={},
            patterns={},
        )

    entry_conditions = row.get("entryConditions")
    specs, patterns_from_conditions = _collect_indicator_specs_from_condition_group(entry_conditions)
    merged_patterns = list(dict.fromkeys([*req.patterns, *patterns_from_conditions]))

    # 2) 通常の計算処理へ合流
    series_req = IndicatorSeriesRequest(
        symbol=req.symbol,
        timeframe=req.timeframe,
        startDate=req.startDate,
        endDate=req.endDate,
        indicators=specs,
        patterns=merged_patterns,
        bbBandwidthWindow=req.bbBandwidthWindow,
        bbBandwidthThreshold=req.bbBandwidthThreshold,
    )

    return indicator_series(series_req)
