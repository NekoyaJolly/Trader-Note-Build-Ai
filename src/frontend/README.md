# TradeAssist MVP - フロントエンド

Phase5 通知・判定可視化 UI

## 技術スタック

* **フレームワーク**: Next.js 16 (App Router)
* **言語**: TypeScript
* **スタイリング**: Tailwind CSS
* **状態管理**: React 標準（useState, useEffect）

## ディレクトリ構造

```
/app                  # Next.js App Router ページ
  /notifications      # 通知一覧・詳細画面
  page.tsx            # トップページ
  layout.tsx          # 共通レイアウト

/components           # 再利用可能コンポーネント
  ScoreGauge.tsx              # スコアゲージ
  MatchReasonVisualizer.tsx   # 判定理由可視化
  MarketSnapshotView.tsx      # 市場スナップショット表示

/lib                  # ユーティリティ・API クライアント
  api.ts              # バックエンド API 連携

/types                # TypeScript 型定義
  notification.ts     # 通知関連の型
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
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
```

### 3. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで http://localhost:3001 を開く。

## 実装画面

### 1. 通知一覧画面 (`/notifications`)

* 未読 / 既読の視覚区別
* スコアゲージ表示
* 判定理由の要約
* 一括既読 / 個別既読機能
* 詳細画面への遷移

### 2. 通知詳細画面 (`/notifications/:id`)

* 通知サマリー
* 判定理由テーブル（特徴量比較）
* 日本語理由リスト
* MarketSnapshot 表示（15m / 60m）
* Order Preset へのリンク（参照のみ）

## API 連携

Phase4 で実装されたバックエンド API と連携:

* `GET /api/notifications` - 通知一覧取得
* `GET /api/notifications/:id` - 通知詳細取得
* `POST /api/notifications/:id/read` - 通知既読化
* `POST /api/notifications/read-all` - 全通知既読化

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

## Phase6 以降の拡張

* トレードノート一覧画面
* フィルタリング・ソート機能
* 通知設定 UI
* グラフ表示


This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
