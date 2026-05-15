# Trader-Note-Build-Ai トラブルシューティング

> 認証 / DB 接続 / cTrader ローカル開発で詰まりやすい箇所をまとめた窓口ドキュメント。
> ここに無い問題は `git log` / `gh pr list` / `docs/architecture/side-b-architecture.html` を当たる。

---

## 1. ログイン直後に「認証エラー」になる

### 事象
デプロイ後に cTrader OAuth でログインしようとすると「認証エラー」が出る。

### 主因と対策の流れ
| 主因 | 兆候 | 対策 |
|---|---|---|
| **DB 接続枯渇** (最頻) | Cloud Run ログに `Too many database connections` / コールバック後 `/me` が 401 / コンテナ exit 1 | **§2 (Supabase Transaction モード)** で `DATABASE_URL` をプーラー (port 6543 + `?pgbouncer=true`) に切替済みか確認 |
| **`CTRADER_REDIRECT_URI` 不一致** | cTrader 側が `redirect_uri 不一致` を返す | §3 で connect.spotware.com と Secret Manager の値が完全一致しているか確認 |
| **一時的な負荷** | 散発的な失敗 | 数分待って再試行 |

### 認証フローのおさらい
1. ユーザーが cTrader で認可 → リダイレクト
2. フロント (Vercel) `/auth/ctrader/callback` で `code` 取得
3. バックエンド (GCP) `POST /api/auth/ctrader/callback` に code 送信
4. バックエンド: code → トークン交換 → DB にユーザー保存 → JWT 発行
5. JWT を `token` レスポンス + Cookie の両方で返却
6. フロント: `saveToken(data.token)` で localStorage 保存 → `/` へリダイレクト

**重要**: ステップ 4 で DB 接続を取得できないと 5・6 に到達せず「認証エラー」になる。

### ログ確認コマンド
```bash
# 認証関連
gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=trader-note AND textPayload=~"cTraderAuth"' \
  --limit 30 --project ai-note-486020 --format='table(timestamp,textPayload)'

# DB 接続エラー
gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=trader-note AND textPayload=~"connection"' \
  --limit 20 --project ai-note-486020 --format='table(timestamp,textPayload)'
```

### 関連ファイル
| ファイル | 役割 |
|---|---|
| `src/backend/api/ctraderAuthRoutes.ts` | 認証 API (callback を含む) |
| `src/frontend/app/auth/ctrader/callback/page.tsx` | コールバック用フロント |
| `src/backend/services/auth/sessionService.ts` | JWT / Cookie 設定 |
| `src/frontend/contexts/AuthContext.tsx` | 認証コンテキスト / トークン管理 |
| `src/infrastructure/prismaClient.ts` | Prisma クライアント |

---

## 2. Supabase Transaction モード (プーラー) 設定

### 背景
直接接続 (port 5432) だと Cloud Run + Prisma で DB 接続枯渇 (60 接続上限) が発生する。Transaction モード (port 6543) を使うと接続を効率化できる。

### 過去にプーラーで詰まった原因 (推測)
1. **`pgbouncer=true` の未設定**
   - Transaction モードは prepared statements をサポートしない
   - Prisma はデフォルトで prepared statements を使うため `?pgbouncer=true` 必須
2. **Session モード (5432) と Transaction モード (6543) の混同**
   - Session モードは接続を長時間保持 → サーバーレス不向き
   - Cloud Run では Transaction モードを使う

### 正しい接続文字列
| 用途 | 接続先 | ポート | パラメータ |
|---|---|---|---|
| **アプリ実行** (`DATABASE_URL`) | Transaction モード | 6543 | `?pgbouncer=true` |
| **マイグレーション** (`DIRECT_URL`) | 直接接続 | 5432 | なし |

```
# DATABASE_URL (Transaction モード)
postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:6543/postgres?pgbouncer=true

# DIRECT_URL (直接接続、prisma migrate 用)
postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

### 適用手順
```bash
./scripts/setup-supabase-pooler.sh
gcloud run services update trader-note --region asia-northeast1 --project ai-note-486020 \
  --update-secrets DATABASE_URL=DATABASE_URL:latest
```

### 参考
- [Supabase: Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres) — Transaction mode
- [Supabase: Prisma troubleshooting](https://supabase.com/docs/guides/database/prisma/prisma-troubleshooting) — pgbouncer=true
- [supavisor Prisma](https://supabase.github.io/supavisor/orms/prisma/) — Named Prepared Statements の無効化

---

## 3. cTrader Redirect URI の確認

### connect.spotware.com 側
- cTrader アプリ設定の **Redirect URIs** に本番フロントの URL が含まれているか
  - `https://trader-note-build-ai.vercel.app/auth/ctrader/callback`

### GCP Secret Manager 側
```bash
gcloud secrets versions access latest --secret=CTRADER_REDIRECT_URI --project=ai-note-486020
```

末尾スラッシュ・プロトコル (`http` vs `https`) の違いも不一致原因になる。**完全一致** を確認する。

---

## 4. cTrader ローカル開発 (cheatsheet)

ブラウザで `http://localhost` または `127.0.0.1` を開いているとき、アプリは **今のタブの origin** (ポート含む) を cTrader の `redirect_uri` として自動で使う。
ルート `.env` の `CTRADER_REDIRECT_URI` を毎回ローカル用に書き換える必要はない。

### 一度だけやること (cTrader Open API)
1. [cTrader Open API](https://openapi.ctrader.com/) でアプリの **Redirect URIs** を開く
2. 次をそのまま 1 行追加 (Next のポートが 3102 の場合)
   ```
   http://localhost:3102/auth/ctrader/callback
   ```
3. フロントを別ポートで動かすなら、その **origin 全体** を登録 (例: `http://localhost:3000/auth/ctrader/callback`)

`CTRADER_REDIRECT_URI` と「登録した URL」は完全一致が必要だが、ローカルではコード側が今の origin を組み立てるため、**登録さえポートと揃えれば** `.env` の redirect は本番用のままで OK。

### 毎回の起動
1. ルートで `npm run dev` (API 3100 + Next 3102)
2. `src/frontend/.env.local` に最低限:
   ```
   NEXT_PUBLIC_API_BASE_URL=http://localhost:3100
   ```
3. ブラウザで `http://localhost:3102` からログイン

### ローカルで失敗するときの確認
| 症状 | 確認 |
|---|---|
| `redirect_uri 不一致` | Redirect URIs に **今使っている origin + `/auth/ctrader/callback`** があるか |
| 認証 URL 取得が 404 | バックエンドが起動しているか、`NEXT_PUBLIC_API_BASE_URL` が `http://localhost:3100` か |
| トークン交換エラー | ログイン開始とコールバックが **同じタブ・同じポート** か (途中で URL を手で変えていないか) |

### 本番・Vercel プレビュー
ホストが `localhost` 以外のときは自動解決は使われない。その環境の `CTRADER_REDIRECT_URI` (バックエンド環境変数) と cTrader に登録した URL を一致させる。
