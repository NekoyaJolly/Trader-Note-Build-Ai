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
ENV ANALYSIS_ENGINE_HOST=0.0.0.0
ENV ANALYSIS_ENGINE_PORT=8000

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
