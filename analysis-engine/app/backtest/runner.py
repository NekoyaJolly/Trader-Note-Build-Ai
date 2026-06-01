"""ハイレベル BT ランナー: ノート schema を受け取り、engine 抽象を経由して BT を実行する

設計方針 (Critical-4 段階 1.8):
- 本ファイルが「ノート → engine 抽象 → engine 実装 → engine 抽象 → response」の
  司令塔となる。中間に adapter.py / engine_protocol.py / runner_<engine>.py が挟まる
- エンジン交換時は本ファイルで `_default_engine()` の return を差し替えるか、
  config / env で実装選択するだけで完結する
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from typing import Dict, List, Optional

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.schemas import (
    OptimizeRequest,
    OptimizeResponse,
    ScreeningBacktestNotePayload,
    ScreeningBacktestRequest,
    ScreeningBacktestResponse,
    ScreeningBacktestSummary,
)

from . import adapter
from .engine_protocol import BTEngine, BTResult
from .runner_backtesting_py import BacktestingPyEngine

# OptimizeRequest.maximize → backtesting.py の stat キーへの対応。
_MAXIMIZE_KEY = {
    "sharpe": "Sharpe Ratio",
    "profit_factor": "Profit Factor",
    "return": "Return [%]",
}


def _default_engine() -> BTEngine:
    """既定の BT エンジン実装を返す。

    将来複数エンジンを切替えるときは env 等で分岐する:
        if os.environ.get("BT_ENGINE") == "vectorbt":
            return VectorbtEngine()
        return BacktestingPyEngine()
    """
    return BacktestingPyEngine()


# ---------------------------------------------------------------
# OHLCV 読み込み (engine 非依存形式 = lowercase columns で返す)
# ---------------------------------------------------------------


def _load_ohlcv(
    engine: Engine,
    symbol: str,
    timeframe: str,
    start: datetime,
    end: datetime,
) -> pd.DataFrame:
    """DB から OHLCV を読み込み、engine 非依存形式 (lowercase columns) で返す。

    エンジン側 (BacktestingPyEngine 等) が必要に応じて自身のフレームワークが要求する
    形に変換する。
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

    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.set_index("timestamp")
    return df


# ---------------------------------------------------------------
# 0 トレード response 生成 (early return 用)
# ---------------------------------------------------------------


def _empty_response(
    note_payload: ScreeningBacktestNotePayload,
    engine_version: str,
    extra_unsupported: Optional[List[str]] = None,
) -> ScreeningBacktestResponse:
    # PR #112: triggerGroup も walk して未対応 leaf を漏れなく集める。
    unsupported = adapter.describe_unsupported_conditions(
        note_payload.conditions, trigger_group=note_payload.triggerGroup
    )
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
        engineVersion=engine_version,
        unsupportedConditions=unsupported,
    )


# ---------------------------------------------------------------
# エンドポイントから呼ぶ本体
# ---------------------------------------------------------------


def run_screening_backtest(
    sql_engine: Engine,
    req: ScreeningBacktestRequest,
    bt_engine: Optional[BTEngine] = None,
) -> ScreeningBacktestResponse:
    """`/v1/screening-backtest` のコア処理 (Critical-4 段階 1.8 リファクタ後)。

    司令塔として:
        1. either ガード (engine 非依存)
        2. OHLCV 読み込み (engine 非依存形式で取得)
        3. ノート schema → BTSpec / BTConfig (adapter)
        4. BTEngine.run(spec, ohlcv, config) (engine 抽象)
        5. BTResult → response schema (adapter)

    将来エンジン交換時は `_default_engine()` の差し替えだけで完結する。
    """
    engine = bt_engine or _default_engine()

    # (1) ノート schema 内に engine 未対応の spec があれば明示的に弾く。
    #     (direction='either' / SL=fixed_pips/swing_point / TP=fixed_pips など)
    #     早期 return で 0 trades + unsupportedConditions に理由を返し、
    #     API 利用者が原因を即把握できるようにする。
    unsupported_specs = adapter.detect_unsupported_specs(req.notePayload)
    if unsupported_specs:
        return _empty_response(
            req.notePayload,
            engine_version=engine.version,
            extra_unsupported=unsupported_specs,
        )

    # (2) OHLCV 読み込み (engine 非依存形式)
    ohlcv = _load_ohlcv(sql_engine, req.symbol, req.timeframe, req.startDate, req.endDate)
    if ohlcv.empty or len(ohlcv) < 30:
        # ATR(14) が安定するまでに最低でも 30 本必要
        return _empty_response(req.notePayload, engine_version=engine.version)

    # (3) ノート schema → engine 抽象
    spec = adapter.notepayload_to_btspec(req.notePayload)
    config = adapter.config_to_btconfig(req.config)

    # PR ⑤B (MTF): trigger_group を walk して必要な上位足 timeframe を集め、
    # それぞれ OHLCV を別 SQL で読んで spec.upper_timeframe_ohlcv に詰める。
    # 上位足が指定されていなければ何もしない (= 後方互換)。
    upper_tf_ohlcv: Dict[str, pd.DataFrame] = {}
    if spec.trigger_group is not None:
        from .condition_evaluator import collect_required_timeframes
        required_tfs = collect_required_timeframes(spec.trigger_group)
        for tf in required_tfs:
            if tf == req.timeframe:
                continue  # 主 timeframe は既に ohlcv に読み込み済
            upper_df = _load_ohlcv(sql_engine, req.symbol, tf, req.startDate, req.endDate)
            if not upper_df.empty:
                upper_tf_ohlcv[tf] = upper_df
    if upper_tf_ohlcv:
        spec = replace(
            spec,
            upper_timeframe_ohlcv=upper_tf_ohlcv,
            primary_timeframe=req.timeframe,
        )
    elif req.timeframe and spec.primary_timeframe is None:
        # MTF を使わなくても primary_timeframe を入れておく (= 観測情報として)
        spec = replace(spec, primary_timeframe=req.timeframe)

    # (4) BT 実行 (engine 抽象)
    result = engine.run(spec, ohlcv, config)

    # (5) engine 抽象 → response
    parts = adapter.btresult_to_response_parts(result)
    return ScreeningBacktestResponse(
        summary=parts["summary"],
        trades=parts["trades"],
        equity=parts["equity"],
        engineVersion=parts["engineVersion"],
        # PR #112: triggerGroup も walk (= flatten conditions[] が空のケースでも漏れない)
        unsupportedConditions=adapter.describe_unsupported_conditions(
            req.notePayload.conditions, trigger_group=req.notePayload.triggerGroup
        ),
    )


def run_optimize(
    sql_engine: Engine,
    req: OptimizeRequest,
    bt_engine: Optional[BTEngine] = None,
) -> OptimizeResponse:
    """`/v1/optimize` のコア処理（進化ループ再設計 Phase 1）。

    SL/TP 値を backtesting.py の Backtest.optimize() で決定論探索し、最良パラメータと
    その BT 結果（コスト込み）を返す。探索空間（候補値リスト）は呼び出し側が渡す。

    司令塔の流れは run_screening_backtest と同じ:
        1. unsupported ガード → 2. OHLCV 読込 → 3. adapter で engine 抽象へ
        4. engine.optimize(...) → 5. BTOptimizeResult → response
    """
    engine = bt_engine or _default_engine()

    def _empty() -> OptimizeResponse:
        base = _empty_response(req.notePayload, engine_version=engine.version)
        return OptimizeResponse(
            bestParams={},
            summary=base.summary,
            trades=base.trades,
            equity=base.equity,
            engineVersion=base.engineVersion,
        )

    # (1) SL/TP の kind 等が engine 未対応なら早期 return（値は振れても kind は固定）。
    if adapter.detect_unsupported_specs(req.notePayload):
        return _empty()

    # (2) OHLCV 読込
    ohlcv = _load_ohlcv(sql_engine, req.symbol, req.timeframe, req.startDate, req.endDate)
    if ohlcv.empty or len(ohlcv) < 30:
        return _empty()

    # (3) adapter で engine 抽象へ（MTF 上位足も run_screening_backtest と同様に解決）
    spec = adapter.notepayload_to_btspec(req.notePayload)
    config = adapter.config_to_btconfig(req.config)
    upper_tf_ohlcv: Dict[str, pd.DataFrame] = {}
    if spec.trigger_group is not None:
        from .condition_evaluator import collect_required_timeframes

        for tf in collect_required_timeframes(spec.trigger_group):
            if tf == req.timeframe:
                continue
            upper_df = _load_ohlcv(sql_engine, req.symbol, tf, req.startDate, req.endDate)
            if not upper_df.empty:
                upper_tf_ohlcv[tf] = upper_df
    if upper_tf_ohlcv:
        spec = replace(spec, upper_timeframe_ohlcv=upper_tf_ohlcv, primary_timeframe=req.timeframe)
    elif req.timeframe and spec.primary_timeframe is None:
        spec = replace(spec, primary_timeframe=req.timeframe)

    # (4) optimize（BacktestingPyEngine のみ対応。他 engine は単発 run に縮退）。
    maximize_key = _MAXIMIZE_KEY.get(req.maximize, "Sharpe Ratio")
    if not isinstance(engine, BacktestingPyEngine):
        result = engine.run(spec, ohlcv, config)
        parts = adapter.btresult_to_response_parts(result)
        return OptimizeResponse(
            bestParams={},
            summary=parts["summary"],
            trades=parts["trades"],
            equity=parts["equity"],
            engineVersion=parts["engineVersion"],
        )

    opt = engine.optimize(
        spec,
        ohlcv,
        config,
        req.slValues or None,
        req.tpValues or None,
        maximize_key,
        req.method,
        req.maxTries,
    )

    # (5) BTOptimizeResult → response（summary/trades/equity は BTResult と同型なので再利用）
    bt_like = BTResult(
        summary=opt.summary,
        trades=opt.trades,
        equity=opt.equity,
        engine_version=opt.engine_version,
    )
    parts = adapter.btresult_to_response_parts(bt_like)
    return OptimizeResponse(
        bestParams=opt.best_params,
        summary=parts["summary"],
        trades=parts["trades"],
        equity=parts["equity"],
        engineVersion=parts["engineVersion"],
    )
