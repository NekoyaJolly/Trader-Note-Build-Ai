FROM python:3.12-slim

WORKDIR /app

# pandas / psycopg2 のビルド依存が必要になるケースを避けるため、最低限の依存を入れる
RUN apt-get update \
  && apt-get install -y --no-install-recommends gcc build-essential libpq-dev \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV PYTHONUNBUFFERED=1

# Cloud Run は PORT 環境変数で待受ポートを渡す（デフォルト: 8080）
# ローカル/Docker Compose では明示しなくても動くようにフォールバックを持たせる
EXPOSE 8080

CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
