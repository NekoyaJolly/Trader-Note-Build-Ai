# Phase5 UI 実装完了 - クイックスタート

## 実装完了内容

Phase5 UI（通知・判定可視化システム）の実装が完了しました。

---

## 起動方法

### 1. バックエンド起動

ターミナル 1:

```bash
cd /Users/jolly_app/projects/Trader-Note-Build-Ai
npm run dev:backend
```

バックエンドが http://localhost:3000 で起動します。

### 2. フロントエンド起動

ターミナル 2:

```bash
cd /Users/jolly_app/projects/Trader-Note-Build-Ai/src/frontend
npm run dev
```

フロントエンドが http://localhost:3001 で起動します。

### 3. ブラウザでアクセス

```
http://localhost:3001
```

---

## 実装した画面

### ホーム画面 (`/`)

* システム概要
* 通知一覧へのリンク

### 通知一覧 (`/notifications`)

* 未読 / 既読の視覚区別
* スコアゲージ表示
* 判定理由要約
* 一括既読 / 個別既読
* 詳細画面への遷移

### 通知詳細 (`/notifications/:id`)

* 通知サマリー（スコア、通貨ペア、判定時刻）
* 判定理由テーブル（特徴量比較）
* 日本語理由リスト
* MarketSnapshot 表示（15m / 60m）
* Order Preset へのリンク（参照のみ）

---

## 実装したコンポーネント

* **ScoreGauge**: スコアゲージ（0.0〜1.0 の視覚化）
* **MatchReasonVisualizer**: 判定理由の詳細表形式表示
* **MarketSnapshotView**: 市場スナップショットの数値表示

---

## API 連携

Phase4 で実装された以下の API と連携:

* `GET /api/notifications` - 通知一覧取得
* `GET /api/notifications/:id` - 通知詳細取得
* `POST /api/notifications/:id/read` - 通知既読化
* `POST /api/notifications/read-all` - 全通知既読化

---

## 確認ポイント

### ✅ 実装済み

- [x] Next.js プロジェクト作成
- [x] 通知一覧画面
- [x] 通知詳細画面
- [x] 共通コンポーネント（ScoreGauge, MatchReasonVisualizer, MarketSnapshotView）
- [x] API クライアント
- [x] 型定義
- [x] 日本語コメント完全準拠

### 🔍 人間確認が必要

- [ ] バックエンド API が正常動作しているか
- [ ] データベースに通知ログが存在するか
- [ ] 実データでの表示確認
- [ ] 一覧 → 詳細の遷移確認
- [ ] 未読 → 既読の切り替え確認

---

## トラブルシューティング

### 通知が表示されない場合

1. バックエンドが起動しているか確認
2. データベースに通知ログが存在するか確認:

```bash
# Prisma Studio でデータ確認
npx prisma studio
```

3. ブラウザのコンソールでエラーを確認

### API 接続エラーの場合

1. `.env.local` の設定確認:

```bash
cd src/frontend
cat .env.local
```

`NEXT_PUBLIC_API_BASE_URL=http://localhost:3000` が設定されているか確認。

2. CORS 設定確認（バックエンドの `src/app.ts` で CORS が有効か）

---

## ファイル一覧

### フロントエンド主要ファイル

```
src/frontend/
├── app/
│   ├── page.tsx                          # ホーム画面
│   └── notifications/
│       ├── page.tsx                      # 通知一覧
│       └── [id]/page.tsx                 # 通知詳細
├── components/
│   ├── ScoreGauge.tsx                    # スコアゲージ
│   ├── MatchReasonVisualizer.tsx         # 判定理由可視化
│   └── MarketSnapshotView.tsx            # 市場スナップショット
├── lib/
│   └── api.ts                            # API クライアント
├── types/
│   └── notification.ts                   # 型定義
├── .env.example                          # 環境変数例
└── README.md                             # フロントエンド README
```

### ドキュメント

```
docs/phase5/
├── phase5-ui-specification              # UI 仕様書
└── completion-report.md                 # 完了レポート
```

---

## 設計原則（再確認）

* **判断はユーザーが行う**: 自動売買は一切行いません
* **UI は説明責任を果たす**: 判定理由を完全可視化
* **「当たる」より「納得できる」**: 理解可能な通知を優先

---

## 次のステップ

1. **動作確認**: バックエンド + フロントエンドを起動して実データで確認
2. **データ準備**: Phase4 の通知ログが存在しない場合はテストデータ作成
3. **Phase6 準備**: トレードノート一覧画面の仕様策定

---

## 参考ドキュメント

* [README.md](../../README.md) - プロジェクト全体概要
* [src/frontend/README.md](../../src/frontend/README.md) - フロントエンド詳細
* [docs/phase5/phase5-ui-specification](phase5-ui-specification) - UI 仕様書
* [docs/phase5/completion-report.md](completion-report.md) - 完了レポート
* [AGENTS.md](../../AGENTS.md) - AI エージェント向け指示書
