from __future__ import annotations

import os
from dataclasses import dataclass

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine


@dataclass(frozen=True)
class DbConfig:
    database_url: str


def load_db_config() -> DbConfig:
    """DB 接続設定を環境変数から読み込む。"""

    database_url = os.environ.get("ANALYSIS_DATABASE_URL")
    if not database_url:
        raise RuntimeError("環境変数 ANALYSIS_DATABASE_URL が未設定です")

    return DbConfig(database_url=database_url)


def create_db_engine(cfg: DbConfig) -> Engine:
    """SQLAlchemy Engine を生成。

    注意: 書き込みは設計上禁止（Read-Only）。
    Postgres 側のロール/権限でも Read-Only を推奨。
    """

    return create_engine(
        cfg.database_url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
        future=True,
    )
