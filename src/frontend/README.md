# TradeAssist - フロントエンド

ノート主体のインテリジェント取引支援システム Web UI

## 技術スタック

* **フレームワーク**: Next.js 16 (App Router)
* **言語**: TypeScript
* **スタイリング**: Tailwind CSS
* **状態管理**: React 標準（useState, useEffect）

## ディレクトリ構造

```
/app                    # Next.js App Router ページ
  /backtest             # バックテスト実行・結果表示
  /import               # CSV インポート画面
  /notes                # ノート一覧
    /[id]               # ノート詳細（特徴量・サマリー）
  /notifications        # 通知一覧
    /[id]               # 通知詳細（判定理由可視化）
  /onboarding           # 初回セットアップウィザード
  /orders               # 注文プリセット・確認
  /settings             # ユーザー設定（閾値・インジケーター）
  /strategies           # 戦略管理
  page.tsx              # トップページ
  layout.tsx            # 共通レイアウト

/components             # 再利用可能コンポーネント
  BacktestPanel.tsx           # バックテストパネル
  FeatureVectorViz.tsx        # 12次元特徴量可視化
  IndicatorChart.tsx          # インジケーターチャート
  IndicatorConfigModal.tsx    # インジケーター設定モーダル
  MarketSnapshotView.tsx      # 市場スナップショット表示
  MatchReasonVisualizer.tsx   # 判定理由可視化
  ScoreGauge.tsx              # スコアゲージ
  SimilarNoteCard.tsx         # 類似ノートカード
  NotificationBell.tsx        # 通知ベル
  TrendBadge.tsx              # トレンドバッジ
  DecisionModeBadge.tsx       # 判断モードバッジ
  /layout                     # レイアウトコンポーネント
  /strategy                   # 戦略関連コンポーネント
  /ui                         # 汎用UIコンポーネント

/lib                    # ユーティリティ・API クライアント
  api.ts                # バックエンド API 連携

/types                  # TypeScript 型定義
  notification.ts       # 通知関連の型
```

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.example` をコピーして `.env.local` を作成:

```bash
cp .env.example .env.local
```

`.env.local` を編集してバックエンド API の URL を設定:

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:3100
```

### 3. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで http://localhost:3001 を開く。

## 実装画面

### 1. ホーム画面 (`/`)

* システム概要と統計
* クイックナビゲーション

### 2. オンボーディング (`/onboarding`)

* 初回セットアップウィザード
* 基本設定の案内

### 3. CSV インポート (`/import`)

* CSV ファイル選択・アップロード
* インポート結果表示
* 生成されたノートへのリンク

### 4. ノート一覧 (`/notes`)

* 全トレードノートの一覧表示
* シンボル・日付によるフィルタリング
* ノート詳細への遷移

### 5. ノート詳細 (`/notes/:id`)

* トレードサマリー（AI 生成）
* 12次元特徴量ベクトル可視化
* 市場コンテキスト表示
* バックテスト実行ボタン

### 6. 通知一覧 (`/notifications`)

* 未読 / 既読の視覚区別
* スコアゲージ表示
* 判定理由の要約
* 一括既読 / 個別既読機能
* 詳細画面への遷移

### 7. 通知詳細 (`/notifications/:id`)

* 通知サマリー
* 判定理由テーブル（特徴量比較）
* 日本語理由リスト
* MarketSnapshot 表示（15m / 60m）
* Order Preset へのリンク

### 8. バックテスト (`/backtest`)

* ノート選択
* 期間設定
* 評価結果一覧
* パフォーマンスサマリー

### 9. 注文支援 (`/orders`)

* マッチしたノートからのプリセット生成
* 価格・数量のサジェスト
* **発注は手動確認必須**

### 10. 設定 (`/settings`)

* マッチング閾値設定
* インジケーターパラメータ設定
* 通知設定

### 11. 戦略管理 (`/strategies`)

* 戦略の作成・編集
* 戦略とノートの紐付け

## API 連携

バックエンド API との連携:

### トレードノート
* `GET /api/trades/notes` - ノート一覧取得
* `GET /api/trades/notes/:id` - ノート詳細取得
* `POST /api/trades/notes/:id/approve` - ノート承認
* `POST /api/trades/import/upload-text` - CSV テキストアップロード

### 通知
* `GET /api/notifications` - 通知一覧取得
* `GET /api/notifications/:id` - 通知詳細取得
* `PUT /api/notifications/:id/read` - 通知既読化
* `PUT /api/notifications/read-all` - 全通知既読化

### バックテスト
* `POST /api/backtest` - バックテスト実行
* `GET /api/backtest/results` - バックテスト結果取得

### 注文
* `GET /api/orders/preset/:noteId` - 注文プリセット取得

### 設定
* `GET /api/settings/indicators` - インジケーター設定取得
* `PUT /api/settings/indicators` - インジケーター設定更新

## 設計原則

* **判断はユーザーが行う**
* **UI は説明責任を果たす**
* **「当たる」より「納得できる」**

自動売買・自動実行は一切行いません。

## ビルド

本番用ビルド:

```bash
npm run build
```

ビルド後の起動:

```bash
npm start
```

## コーディング規約

* すべてのコメントは日本語
* 関数・変数名は意味が明確な名称を使用
* 1ファイル1責務を意識
* マジックナンバー禁止（定数化）

## トラブルシューティング

### API 接続エラー

* バックエンドサーバーが起動しているか確認
* `.env.local` の `NEXT_PUBLIC_API_BASE_URL` が正しいか確認
* CORS 設定を確認

### 通知が表示されない

* データベースに通知ログが存在するか確認
* ブラウザのコンソールでエラーを確認

## 主要コンポーネント

### FeatureVectorViz

12次元特徴量ベクトルをレーダーチャートで可視化するコンポーネント。
ノートと現在市場のベクトルを重ねて表示し、類似度を視覚的に確認可能。

### MatchReasonVisualizer

マッチング判定の理由を詳細表示。各インジケーターの貢献度、
閾値との比較、ルールベースチェックの結果を表形式で表示。

### ScoreGauge

類似度スコアをゲージ形式で表示。閾値ラインも表示し、
マッチの強度を直感的に把握可能。
