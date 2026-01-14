# TradeAssist

**TradeAssist** は、トレード履歴を自動的に構造化したノートに変換し、リアルタイム市場データとマッチングさせて通知する **取引支援システム** です。

- **自動売買なし** - 人間の判断支援に徹する
- **2つのサブシステム** - Side-A（人間用）と Side-B（AI用）で運用

---

## 🧩 機能概要

### Side-A: TradeAssist（人間主体）

**トレード履歴をノート化→リアルタイムマッチング→通知**

- 📥 CSV/cTrader API からトレード履歴をインポート
- 📝 自動でトレードノート化（12次元特徴量 + AI要約）
- 🔔 市場がノートの条件に合致したら通知
- 📊 バックテスト（Walk-Forward分析対応）
- 🎯 戦略管理（複数ストラテジーの作成・検証）

### Side-B: TradeAssistant-AI（AI主体）

**AI が毎日のトレードプランを生成→仮想実行→自己分析**

- 🤖 毎朝 AI がその日のトレードプラン生成
- 💭 仮想的にトレード実行・監視
- 📚 結果を自動分析してノート化
- 🔄 Side-A ノートとの比較分析
- 🔔 **AIノート類似度チェックと自動通知** ★NEW
  - Cron監視で市場データとAIノートの類似度を自動チェック
  - 閾値（デフォルト85%）以上で自動通知
  - 人間ノート/AIノート横断検索対応

---

## 🚀 クイックスタート

### 前提条件

- Node.js 22+
- PostgreSQL 14+
- npm または yarn

### 1. インストール

```bash
# リポジトリをクローン
git clone https://github.com/NekoyaJolly/Trader-Note-Build-Ai.git
cd Trader-Note-Build-Ai

# Backend 依存関係インストール
npm install

# Frontend 依存関係インストール
cd src/frontend
npm install
cd ../..
```

### 2. 環境変数設定

```bash
# .env.example をコピー
cp .env.example .env
```

**.env の設定項目**:

```env
DATABASE_URL=
BACKEND_PORT=
NODE_ENV=

AI_API_KEY=
AI_MODEL=
AI_BASE_URL=

MARKET_API_URL=
MARKET_API_KEY=

CTRADER_CLIENT_ID=
CTRADER_CLIENT_SECRET=
CTRADER_REDIRECT_URI=

MATCH_THRESHOLD=
CHECK_INTERVAL_MINUTES=
DAILY_NOTIFICATION_LIMIT=

CRON_ENABLED=
SAVE_EVALUATION_DIAGNOSTICS=

VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
```

詳細は `.env.example` を参照。

### 3. データベースセットアップ

```bash
# Prisma クライアント生成
npm run prisma:generate

# マイグレーション実行
npm run prisma:migrate
```

### 4. 開発サーバー起動

```bash
# Backend + Frontend 同時起動
npm run dev
```

- Backend: http://localhost:3100
- Frontend: http://localhost:3102

**個別起動**:
```bash
# Backend のみ
npm run dev:backend

# Frontend のみ
npm run dev:frontend
```

### 5. cTrader 認証（リアルタイム通知を使う場合）

1. cTrader Open API で OAuth アプリケーションを登録
2. `CTRADER_CLIENT_ID` / `CTRADER_CLIENT_SECRET` を設定
3. ブラウザで http://localhost:3102/onboarding にアクセス
4. cTrader 認証フローを完了

---

## 📖 主要コマンド

### 開発

| コマンド | 説明 |
|----------|------|
| `npm run dev` | Backend + Frontend 同時起動 |
| `npm run dev:backend` | Backend のみ起動 (port 3100) |
| `npm run dev:frontend` | Frontend のみ起動 (port 3102) |
| `npm run kill:ports` | 3100/3102 ポートをクリーンアップ |

### ビルド

| コマンド | 説明 |
|----------|------|
| `npm run build` | Backend + Frontend ビルド |
| `npm run build:backend` | Backend のみビルド |
| `npm run build:frontend` | Frontend のみビルド |
| `npm start` | 本番サーバー起動 |

### Prisma

| コマンド | 説明 |
|----------|------|
| `npm run prisma:generate` | Prisma クライアント生成 |
| `npm run prisma:migrate` | マイグレーション実行 |
| `npm run prisma:format` | schema.prisma フォーマット |

### テスト

| コマンド | 説明 |
|----------|------|
| `npm test` | 全テスト実行 |
| `npm test -- --coverage` | カバレッジ付きテスト |

---

## 📡 API ドキュメント

詳細な API 仕様は [docs/API.md](docs/API.md) を参照してください。

主な機能:
- トレード履歴のインポート・ノート自動生成
- リアルタイムマッチング判定
- 通知管理
- バックテスト実行

---

## 📂 プロジェクト構造

```
/
├── AGENTS.md              # AI エージェント向け開発ガイド（最優先）
├── README.md              # 本ファイル
├── NOTE.md                # ノート定義の正規リファレンス
├── package.json           # npm スクリプト・依存関係
├── tsconfig.json          # TypeScript 設定
├── prisma/
│   └── schema.prisma      # DB スキーマ定義
├── src/
│   ├── index.ts           # エントリーポイント
│   ├── app.ts             # Express アプリ設定
│   ├── backend/           # Side-A バックエンド
│   │   ├── api/           # cTrader / OHLCV / Pattern 等
│   │   ├── services/      # ビジネスロジック
│   │   └── tests/         # テストファイル
│   ├── controllers/       # リクエストハンドラ
│   ├── services/          # 共通サービス
│   ├── models/            # 型定義・スキーマ
│   ├── domain/            # ドメインロジック（NoteEvaluator等）
│   ├── infrastructure/    # 外部接続（DB, API）
│   ├── routes/            # Express ルート定義
│   ├── middleware/        # Express ミドルウェア
│   ├── schemas/           # Zod バリデーションスキーマ
│   ├── utils/             # ユーティリティ
│   ├── config/            # 設定ファイル
│   ├── frontend/          # Next.js フロントエンド
│   │   ├── app/           # App Router ページ
│   │   ├── components/    # React コンポーネント
│   │   └── lib/           # フロント共通ロジック
│   └── side-b/            # Side-B 実装
│       ├── controllers/   # Side-B API コントローラー
│       ├── services/      # Research AI / Plan AI / VirtualTrading
│       ├── repositories/  # DB アクセス層
│       ├── orchestrator/  # 日次バッチオーケストレーター
│       ├── models/        # Side-B 型定義
│       ├── routes/        # Side-B ルート
│       └── tests/         # Side-B テスト
├── docs/
│   ├── ARCHITECTURE.md    # アーキテクチャ詳細仕様
│   ├── API.md             # API仕様
│   ├── side-b/            # Side-B 設計ドキュメント
│   │   ├── TradeAssistant-AI.md
│   │   ├── phase-a-trade-plan.md
│   │   ├── phase-b-virtual-trading.md
│   │   ├── phase-c-ai-trade-note.md
│   │   └── phase-d-integration.md
│   └── phase{N}/          # 各フェーズの設計資料
├── indicators/            # インジケーター概念定義
├── scripts/               # 運用スクリプト
│   ├── run-daily-batch.ts      # Side-B 日次バッチ
│   ├── run-realtime-worker.ts  # Side-A リアルタイムワーカー
│   ├── run-ohlcv-ingest.ts     # OHLCV データ取込
│   └── test-*.ts               # 各種テストスクリプト
└── data/                  # ローカルデータ（Git管理外推奨）
    ├── trades/            # CSVインポート用
    ├── notes/             # ノートJSON
    └── ohlcv/             # OHLCVデータ
```

---

## 📚 ドキュメント

- [AGENTS.md](AGENTS.md) - 開発者向けガイド
- [NOTE.md](NOTE.md) - ノート定義の仕様
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - アーキテクチャ詳細
- [docs/API.md](docs/API.md) - API仕様

Side-B関連:
- [docs/side-b/TradeAssistant-AI.md](docs/side-b/TradeAssistant-AI.md)
- [docs/side-b/phase-a-trade-plan.md](docs/side-b/phase-a-trade-plan.md)
- [docs/side-b/phase-b-virtual-trading.md](docs/side-b/phase-b-virtual-trading.md)
- [docs/side-b/phase-c-ai-trade-note.md](docs/side-b/phase-c-ai-trade-note.md)

---

## ⚖️ ライセンス

ISC
