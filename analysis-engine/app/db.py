from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine


@dataclass(frozen=True)
class DbConfig:
    database_url: str


def _sanitize_database_url(database_url: str) -> str:
        """psycopg2 が受け付けないクエリパラメータを除去する。

        背景:
        - Supabase/Prisma 由来の接続URLには `pgbouncer=true` や `connection_limit=3` 等が
            付いていることがある
        - SQLAlchemy がクエリパラメータを psycopg2 に kwargs で渡すと、
            psycopg2 側で「不明な接続オプション」として例外になる

        方針:
        - DB接続自体に不要なパラメータは analysis-engine 側で除去して安全に接続する
        """

        parsed = urlparse(database_url)
        if not parsed.query:
                return database_url

        blocked_keys = {
                # Prisma/Supabase の都合で付くことがあるが、psycopg2 は受け付けない
                "pgbouncer",
                "connection_limit",
        }

        kept = [(k, v) for (k, v) in parse_qsl(parsed.query, keep_blank_values=True) if k not in blocked_keys]
        new_query = urlencode(kept)
        sanitized = urlunparse(parsed._replace(query=new_query))
        return sanitized


def load_db_config() -> DbConfig:
    """DB 接続設定を環境変数から読み込む。"""

    database_url = os.environ.get("ANALYSIS_DATABASE_URL")
    if not database_url:
        raise RuntimeError("環境変数 ANALYSIS_DATABASE_URL が未設定です")

    return DbConfig(database_url=_sanitize_database_url(database_url))


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
