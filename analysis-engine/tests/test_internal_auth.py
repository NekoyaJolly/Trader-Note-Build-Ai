"""analysis-engine 内部認証ガードのユニットテスト。

検証対象:
- /health だけ public として残し、それ以外は内部 secret 対象にする
- shared secret が設定された環境では完全一致のみ許可する
- shared secret / request size / rate limit の env は壊れた値を拒否する

実行: analysis-engine/ で `python3 -m pytest tests/test_internal_auth.py`
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import (  # noqa: E402
    ANALYSIS_ENGINE_SHARED_SECRET_ENV,
    _is_authorized_internal_request,
    _load_shared_secret,
    _parse_positive_int_env,
    _requires_internal_secret,
)


def test_health_is_public_but_other_paths_are_protected():
    assert _requires_internal_secret("/health") is False
    assert _requires_internal_secret("/v1/indicator-series") is True
    assert _requires_internal_secret("/docs") is True


def test_secret_authorization_allows_dev_without_configured_secret():
    assert _is_authorized_internal_request(None, None) is True
    assert _is_authorized_internal_request(None, "client-secret") is True


def test_secret_authorization_requires_exact_match_when_configured():
    configured = "server-secret"
    assert _is_authorized_internal_request(configured, None) is False
    assert _is_authorized_internal_request(configured, "wrong-secret") is False
    assert _is_authorized_internal_request(configured, configured) is True


def test_shared_secret_env_rejects_short_value(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(ANALYSIS_ENGINE_SHARED_SECRET_ENV, "short-secret")

    with pytest.raises(RuntimeError, match=ANALYSIS_ENGINE_SHARED_SECRET_ENV):
        _load_shared_secret()


def test_positive_int_env_rejects_negative_value(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ANALYSIS_ENGINE_RATE_LIMIT_PER_MINUTE", "-1")

    with pytest.raises(RuntimeError, match="must be >= 0"):
        _parse_positive_int_env("ANALYSIS_ENGINE_RATE_LIMIT_PER_MINUTE", 0)


def test_positive_int_env_rejects_non_numeric_value(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ANALYSIS_ENGINE_RATE_LIMIT_PER_MINUTE", "not-a-number")

    with pytest.raises(
        RuntimeError,
        match="ANALYSIS_ENGINE_RATE_LIMIT_PER_MINUTE must be an integer",
    ):
        _parse_positive_int_env("ANALYSIS_ENGINE_RATE_LIMIT_PER_MINUTE", 0)
