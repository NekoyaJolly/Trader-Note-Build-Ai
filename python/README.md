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

### 現状（Step B）
最小構成。依存は `pytest` のみ。

### Step C で採用予定
**第一候補: vectorbt**（要検証）

選定理由:
- NumPy ベースで高速
- 研究用途での実績
- ウォークフォワード検証の sliding window 処理が書きやすい
- アクティブメンテナンス

リスク / 代替:
- 依存が重い（numba 等）。M1/M2 Mac で numba のビルドに時間がかかるケース報告あり
- 上記で問題が出る場合は **backtesting.py**（軽量・Pure Python・単純 API）に切替える

Step C 着手時に実際にインストール・導入してから最終判断し、この README に
採用ライブラリとバージョン、選定経緯を追記する。

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
