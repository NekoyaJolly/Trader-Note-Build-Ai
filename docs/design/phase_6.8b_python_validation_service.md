# Phase 6.8b — Python 検証サービス本番化（WalkForward HTTP Service）

> 親: `phase_6.8_execution_simulation_specification.md`  
> 範囲: ローカル Docker exec 前提の `PythonBridge` を、本番 Cloud Run でも使える HTTP 検証サービスへ移行する。  
> 目的: 商用レベルのバックテスト/エッジ検証に必要な **WalkForward 検証** を本番相当環境で安定稼働させる。  
> 前提: Phase 6.7 の即時BT層、Phase 6.8 の執行シミュ基盤が main に反映済み。  

---

## 0. なぜ必要か

現状の Side-B ダッシュボード `/side-b/dashboard` の「Python 検証」は、以下の経路を見ている。

```text
Frontend
  sideBApi.getSystemHealth()
    ↓
GET /api/side-b/system/health
    ↓
ledgerDashboardController.systemHealth()
    ↓
pythonBridge.healthCheck()
    ↓
docker exec side_b_python_validator python /app/ping.py
```

ローカルでは `python/docker-compose.yml` の `side_b_python_validator` コンテナが起動していれば `ok` になる。  
しかし本番 Cloud Run では、API コンテナ内から別 Docker コンテナへ `docker exec` する構成は成立しない。  

そのため、本番のダッシュボードでは Python 検証が `error` になり得る。これはアプリ本体のDBや通常BTの故障ではなく、**PythonBridge がローカル Docker 前提のまま本番ヘルスに使われている**ことが原因。

---

## 1. このフェーズのゴール

Phase 6.8b のゴールは、`WalkForwardTool` が使う Python 検証を **本番でも呼べるサービス** にすること。

第1段階の最終形:

```text
Node / Cloud Run API
  WalkForwardTool
    ↓
PythonValidationClient
    ↓ HTTP
analysis-engine (Cloud Run)
  /health
  /v1/walk-forward
```

これにより:

- 本番ダッシュボードの `Python 検証` が実態に即した状態になる
- `confirmed` 昇格条件の WalkForward 過学習スコアを本番相当で計算できる
- ローカルでは既存 Docker exec を維持しつつ、本番では HTTP service を使える

---

## 2. 非目標

このフェーズでは以下をやらない。

- vectorbt / backtesting.py の新規導入
- 真のローリング最適化 WalkForward
- Python 側で StrategyDSL を再評価してトレード生成すること
- 発注・本番トレード実行

既存 `python/walk_forward/walk_forward.py` は「イベント列の時間的安定性検証」のまま使う。

---

## 3. 現状資産

### 3.1 Python 側

- `python/walk_forward/walk_forward.py`
  - 入力: `events[]`, `period`, `splitCount`
  - 出力: `overfitScore`, IS/OOS 勝率, PF, `windowsEvaluated`
  - 依存: Python 標準ライブラリのみ

- `python/ping.py`
  - ローカル `docker exec` healthCheck 用

- `python/Dockerfile`
  - `python:3.11-slim`
  - 起動コマンドは sleep
  - ローカル `docker exec` 前提

### 3.2 TypeScript 側

- `src/side-b/validation/python_bridge/PythonBridge.ts`
  - `docker exec` で Python script を実行
  - JSON file を shared volume 経由で受け渡す

- `src/side-b/validation/tools/WalkForwardTool.ts`
  - `PythonBridge.execute()` を呼ぶ
  - `isAvailable()` は `pythonBridge.healthCheck()`

- `src/side-b/controllers/ledgerDashboardController.ts`
  - `systemHealth()` が `pythonBridge.healthCheck()` を呼ぶ

---

## 4. 推奨アーキテクチャ

### 4.1 Python Validation Service

第1段階では、既存の `analysis-engine` に `/v1/walk-forward` を追加する。

理由:
- 既に Cloud Run 化済み
- 既に FastAPI / Dockerfile / deploy pipeline がある
- WalkForward は「検証/分析」なので analysis-engine の責務と矛盾しない
- 新しい Cloud Run サービスを増やさずに本番 Python 検証を `ok` にできる

将来、負荷・依存・責務が大きくなった場合のみ `trader-note-python-validator` へ分離する。

追加予定:

```text
analysis-engine/app/main.py
analysis-engine/app/schemas.py
analysis-engine/app/walk_forward.py
```

エンドポイント:

| Method | Path | 目的 |
|---|---|---|
| GET | `/health` | サービス疎通 |
| POST | `/v1/walk-forward` | WalkForward 検証 |

### 4.2 `/health`

レスポンス:

```json
{
  "ok": true,
  "service": "side-b-python-validator",
  "version": "phase-6.8b"
}
```

### 4.3 `/walk-forward`

リクエスト:

```json
{
  "events": [
    { "entryTime": "2026-04-01T00:00:00.000Z", "pnl": 12.3 }
  ],
  "period": { "start": "2026-01-01", "end": "2026-12-31" },
  "splitCount": 4
}
```

レスポンス:

```json
{
  "overfitScore": 0.21,
  "avgInSampleWinRate": 0.58,
  "avgOutOfSampleWinRate": 0.51,
  "inSamplePF": 1.8,
  "outOfSamplePF": 1.4,
  "splitCount": 4,
  "totalTradeCount": 42,
  "windowsEvaluated": 4
}
```

内部実装は既存 `run_walk_forward(payload)` を直接呼ぶ。

---

## 5. TypeScript 側の移行方針

### 5.1 Bridge を2系統に分ける

現状:

```text
PythonBridge = docker exec 専用
```

移行後:

```text
PythonValidationClient
  ├─ DockerPythonBridge（ローカル互換）
  └─ HttpPythonValidationClient（本番）
```

または最小実装として、既存 `PythonBridge` に `mode` を足す。

推奨:

```ts
type PythonValidationMode = 'docker_exec' | 'http';
```

環境変数:

```env
PYTHON_VALIDATION_MODE=http
PYTHON_VALIDATION_URL=https://side-b-python-validator-xxxxx.a.run.app
PYTHON_VALIDATION_TIMEOUT_MS=300000
```

ローカル既定:

```env
PYTHON_VALIDATION_MODE=docker_exec
```

本番既定:

```env
PYTHON_VALIDATION_MODE=http
```

### 5.2 WalkForwardTool の変更

`WalkForwardTool` は `PythonBridge` 具象ではなく、以下のインターフェースに依存する。

```ts
interface PythonValidationClient {
  healthCheck(): Promise<boolean>;
  runWalkForward(input: WalkForwardInput): Promise<WalkForwardOutput>;
}
```

これにより、本番/ローカルの切り替えが `WalkForwardTool` から隠蔽される。

---

## 6. Cloud Run デプロイ方針

既存 `analysis-engine` とは別サービスにする。

理由:

- `analysis-engine` は指標計算用 FastAPI + pandas/pandas-ta 系
- `python/walk_forward` は stdlib 完結で軽量
- ライフサイクル・責務が異なる

推奨サービス:

```text
trader-note-python-validator
```

イメージ:

```text
gcr.io/ai-note-486020/trader-note-python-validator:latest
```

GitHub Actions:

```text
deploy-python-validator
  ↓
deploy-gcp API に PYTHON_VALIDATION_URL を注入
```

---

## 7. ダッシュボード表示

`Python 検証` は `ok/error` だけでなく、状態を分ける。

```ts
pythonValidator: 'ok' | 'error' | 'not_configured' | 'local_only'
```

本番で `PYTHON_VALIDATION_MODE` が未設定なら:

```json
{
  "pythonValidator": "not_configured"
}
```

ローカル Docker exec で OK なら:

```json
{
  "pythonValidator": "ok"
}
```

HTTP service に接続して `/health` が OK なら:

```json
{
  "pythonValidator": "ok"
}
```

---

## 8. 完了条件

- [ ] Python Validation Service が `/health` を返す
- [ ] Python Validation Service が `/walk-forward` を返す
- [ ] `WalkForwardTool` が `docker_exec` / `http` の両方で同じ結果を返す
- [ ] 本番 Cloud Run API の `/api/side-b/system/health` で `pythonValidator: "ok"` になる
- [ ] Python service が未設定の場合は `error` ではなく `not_configured` を返す
- [ ] confirmed 昇格の WalkForward 判定が本番 validator 経由で実行できる
- [ ] CI は Python service の unit/mock テストのみ、実Cloud Run疎通は deploy後 smoke に分ける

---

## 9. 実装順序

1. `python/app/main.py` を追加し `/health` `/walk-forward` を実装
2. Python Dockerfile を HTTP 起動に対応
3. `HttpPythonValidationClient` を追加
4. `WalkForwardTool` を `PythonValidationClient` 依存に変更
5. `systemHealth` を `ok/error/not_configured/local_only` に拡張
6. GitHub Actions に `deploy-python-validator` を追加
7. Cloud Run の URL を API service に env 注入
8. 本番 `/api/side-b/system/health` で確認

---

## 10. 履歴

| 日付 | 内容 |
|------|------|
| 2026-04-25 | 初版作成。ローカル Docker exec 前提の PythonBridge を本番 HTTP service 化する方針を定義 |
