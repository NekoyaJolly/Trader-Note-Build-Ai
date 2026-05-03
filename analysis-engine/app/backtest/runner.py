"""ハイレベル BT ランナー: ノート schema を受け取り、engine 抽象を経由して BT を実行する

設計方針 (Critical-4 段階 1.8):
- 本ファイルが「ノート → engine 抽象 → engine 実装 → engine 抽象 → response」の
  司令塔となる。中間に adapter.py / engine_protocol.py / runner_<engine>.py が挟まる
- エンジン交換時は本ファイルで `_default_engine()` の return を差し替えるか、
  config / env で実装選択するだけで完結する
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.schemas import (
    ScreeningBacktestNotePayload,
    ScreeningBacktestRequest,
    ScreeningBacktestResponse,
    ScreeningBacktestSummary,
)

from . import adapter
from .engine_protocol import BTEngine
from .runner_backtesting_py import BacktestingPyEngine


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
    unsupported = adapter.describe_unsupported_conditions(note_payload.conditions)
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

    # (1) `either` direction は段階 1 では未対応として明示的に弾く
    if req.notePayload.direction == "either":
        return _empty_response(
            req.notePayload,
            engine_version=engine.version,
            extra_unsupported=[
                "expectedDirection='either' は段階 1 では未対応 "
                "(long/short 両方向 BT は段階 4 範囲)"
            ],
        )

    # (2) OHLCV 読み込み (engine 非依存形式)
    ohlcv = _load_ohlcv(sql_engine, req.symbol, req.timeframe, req.startDate, req.endDate)
    if ohlcv.empty or len(ohlcv) < 30:
        # ATR(14) が安定するまでに最低でも 30 本必要
        return _empty_response(req.notePayload, engine_version=engine.version)

    # (3) ノート schema → engine 抽象
    spec = adapter.notepayload_to_btspec(req.notePayload)
    config = adapter.config_to_btconfig(req.config)

    # (4) BT 実行 (engine 抽象)
    result = engine.run(spec, ohlcv, config)

    # (5) engine 抽象 → response
    parts = adapter.btresult_to_response_parts(result)
    return ScreeningBacktestResponse(
        summary=parts["summary"],
        trades=parts["trades"],
        equity=parts["equity"],
        engineVersion=parts["engineVersion"],
        unsupportedConditions=adapter.describe_unsupported_conditions(req.notePayload.conditions),
    )
