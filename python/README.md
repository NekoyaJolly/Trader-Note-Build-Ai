# Side-B Python 検証コンテナ（Phase 4c）

Side-B の本格検証パイプライン（WalkForward / MonteCarlo の一部）が使う
Python 環境。TypeScript 側からは `PythonBridge` 経由で呼び出される。

## 使い方

プロジェクトルートから:

```bash
# 起動
docker compose -f python/docker-compose.yml up -d

# 状態確認
docker compose -f python/docker-compose.yml ps

# 疎通確認
docker exec side_b_python_validator python /app/ping.py

# 停止
docker compose -f python/docker-compose.yml down
```

## ディレクトリ構成

```
python/
├── Dockerfile            # python:3.11-slim ベース
├── docker-compose.yml    # side_b_python_validator コンテナ定義
├── requirements.txt      # pip 依存（Step B は最小、Step C で追加予定）
├── ping.py               # healthCheck 用
├── echo.py               # PythonBridge round-trip 疎通確認用
├── shared/               # TS ↔ Python の JSON 受け渡しディレクトリ
│   └── .gitkeep          # 中身の *.json は .gitignore 対象
└── README.md
```

## TS との連携

TS から `docker exec side_b_python_validator python <script> <input.json> <output.json>`
の形で呼び出す。入出力は `./shared` を通じて JSON で受け渡す（共有ボリューム経由）。

設計判断の根拠は `docs/design/phase_4c_specification.md` §4.3 参照。

## ライブラリ選定（Phase 4c での意思決定）

### 採用: **Python 標準ライブラリのみ（stdlib 完結）**

Step C 着手時に `walk_forward.py` の要件を精査した結果、本プロジェクトの
Walk-Forward は「Side-A が確定させたトレードイベント列を時間軸で分割して
IS/OOS 勝率・PF を比較する」だけで足り、vectorbt / backtrader / backtesting.py
が提供する OHLCV → シグナル → トレード生成のパイプライン機能は不要と判断した。

依存は `pytest` のみ（テスト用途）。本番パスは stdlib 完結。

選定理由:
- 真の Walk-Forward（各窓で最適化パラメーター再学習）は不要。
  Side-B の仮説には再学習対象のパラメーターが無いため。
- stdlib 完結にすることで Docker イメージが軽量、起動も高速（numba JIT 待ち無し）
- numba / llvmlite 等の M1/M2 Mac でのビルド問題を回避
- メンテナンス対象コードが最小（`walk_forward.py` は 200 行弱）

将来拡張時の候補:
- モンテカルロを TS から Python へ移したい場合: `numpy` 追加で対応可能
- 条件再評価を Python 側でしたい場合: `backtesting.py`（軽量 Pure Python）を検討

### 実装の前提（重要）

本実装は Side-A のバックテスト結果（固定条件・固定 SL/TP）を時間窓で
パーティショニングする「**時間的安定性テスト**」に相当する。詳細は
`walk_forward/walk_forward.py` の docstring および
`docs/design/phase_4c_specification.md` §4.5 参照。

## 本番デプロイについて

このフェーズではローカル Docker 動作で完結させる（仕様書 §5.2）。
GCP / Fly.io / Railway 等へのデプロイは Phase 4c の対象外。

## トラブルシュート

### コンテナが起動しない
```bash
docker compose -f python/docker-compose.yml logs python_validator
```

### shared ディレクトリが読み書きできない
- macOS: Docker Desktop の「File sharing」設定でプロジェクトディレクトリが
  許可されているか確認
- Linux: SELinux が有効な場合 `:Z` オプションが必要なことがある
