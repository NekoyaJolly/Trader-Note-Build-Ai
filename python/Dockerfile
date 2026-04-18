# Phase 4c: Side-B 検証ツール用 Python コンテナ
#
# Step B（PythonBridge 基盤）では最小構成で立ち上げる。
# Step C 以降で WalkForwardTool 等が必要とするライブラリ（vectorbt 等）
# は requirements.txt に追記していく。
#
# ベース: python:3.11-slim（LTS、安定）

FROM python:3.11-slim

# バッファなし出力 & pip キャッシュ無効化（ビルドイメージ肥大化防止）
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# 依存関係を先に入れてレイヤーキャッシュを活かす
COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

# スクリプト本体（echo / ping / 今後のツール実装）
COPY . /app

# 共有ボリュームのマウントポイント（JSON 入出力用）
VOLUME ["/app/shared"]

# docker-compose から exec して使う想定。起動コマンドは「寝る」だけ
# （ping.py / echo.py はクライアントから docker exec で呼ばれる）
CMD ["python", "-c", "import time; time.sleep(1e9)"]
