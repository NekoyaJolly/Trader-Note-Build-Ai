---
name: ui-api-db-verify
description: |
  UI→API→DB 統合検証をエージェントが自律実行するスキル。
  デプロイ後、機能追加後、またはDB変更後に「本番動作確認」「UI検証」「API疎通確認」と言われたら使用する。
  dev サーバー起動 → 検証スクリプト実行 → 結果判定 → 失敗時は原因調査まで一貫して行う。
---

# UI→API→DB 統合検証

## 概要

`scripts/verify-ui-api-db.ts` を使って、UI が叩く主要 API が DB から正しいレスポンスを返すかを検証する。

## 検証対象（10項目）

| # | エンドポイント | DB テーブル | 認証 |
|---|--------------|------------|------|
| 1 | `GET /health` | なし（起動確認） | 不要 |
| 2 | `GET /api/auth/me` | User, CTraderToken | 必要 |
| 3 | `GET /api/trades/notes` | TradeNote, Trade | 必要 |
| 4 | `GET /api/notifications` | Notification | 必要 |
| 5 | `GET /api/strategies` | Strategy | 不要 |
| 6 | `GET /api/ohlcv/presets` | DataPreset | 不要 |
| 7 | `PUT+GET /api/chart-drawings` | ChartDrawing | 必要 |
| 8 | `GET /api/indicators/settings` | 設定系 | 不要 |
| 9 | `GET /api/watchlist` | Watchlist | 必要 |
| 10 | `GET /api/trading/account` | CTraderToken → cTrader | 必要 |

## 実行手順

### Step 1: dev サーバー起動

```bash
npm run dev:backend
```

ポート 3100 で起動を確認（`http://localhost:3100/health` が `{"status":"ok"}` を返す）。

### Step 2: 認証トークン取得（認証系テスト実行時のみ）

ブラウザで cTrader OAuth ログイン済みの場合、Cookie `auth_token` を取得して使う。

```bash
# ブラウザの DevTools → Application → Cookies → auth_token の値をコピー
COOKIE="auth_token=eyJhbG..."
```

トークンがない場合は認証不要の項目のみ検証される（スキップ扱い）。

### Step 3: 検証実行

```bash
# 認証あり（全項目）
npx tsx scripts/verify-ui-api-db.ts --base-url http://localhost:3100 --cookie "$COOKIE"

# 認証なし（認証不要エンドポイントのみ）
npx tsx scripts/verify-ui-api-db.ts --base-url http://localhost:3100

# 本番環境
npx tsx scripts/verify-ui-api-db.ts --base-url https://trader-note-571157808050.asia-northeast1.run.app --cookie "$COOKIE"
```

### Step 4: 結果判定

- exit code `0` → 全パス（スキップ含む）
- exit code `1` → 1件以上失敗

## 失敗時の対応フロー

```
失敗したテスト名を確認
  ↓
1. ヘルスチェック失敗 → サーバーが起動していない。ポート確認。
2. 認証失敗 → Cookie が無効/期限切れ。再ログイン。
3. ノート/通知/ストラテジー失敗 → DB接続確認（prisma migrate status）。
4. チャート描画失敗 → ChartDrawing テーブル確認（prisma migrate deploy）。
5. インジケーター設定失敗 → 設定ファイル or DB確認。
6. トレーディング口座失敗 → cTrader API接続/トークン確認。
```

## ブラウザ検証（補完テスト）

スクリプトでカバーできない「UI描画」の確認が必要な場合：

1. `http://localhost:3102` にアクセス
2. チャート画面で水平線を1本引く
3. ブラウザをリロード → 同じラインが復元されることを確認
4. サブペイン（RSI/MACD）が分離表示されていることを目視確認

この手順は `browser-use` サブエージェントで自動実行可能。

## 注意事項

- テスト用データ `__VERIFY_TEST__` はスクリプト内でクリーンアップ済み
- 本番環境実行時はレート制限に注意（1回の実行で最大10リクエスト）
- cTrader 接続テスト（#10）は市場閉場時にタイムアウトする場合がある
