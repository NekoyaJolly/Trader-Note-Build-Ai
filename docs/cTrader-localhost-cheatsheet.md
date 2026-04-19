# cTrader ローカル開発チートシート

ブラウザで `http://localhost` または `127.0.0.1` を開いているとき、アプリは **今のタブのオリジン**（ポート含む）を cTrader の `redirect_uri` として自動で使います。  
ルート `.env` の `CTRADER_REDIRECT_URI` を毎回ローカル用に書き換えなくても動かせます。

## 一度だけやること（cTrader Open API）

1. [cTrader Open API](https://openapi.ctrader.com/) でアプリの **Redirect URIs** を開く。
2. 次を **そのまま** 1 行追加する（Next のポートが 3102 の場合）。

   `http://localhost:3102/auth/ctrader/callback`

3. フロントを別ポートで動かすなら、その **origin 全体** を登録する。  
   例: `http://localhost:3000/auth/ctrader/callback`

`CTRADER_REDIRECT_URI` と「登録した URL」は **完全一致**が必要ですが、ローカルではコード側が **今の origin** を組み立てるため、**登録さえポートと揃えれば** `.env` の redirect は本番用のままで問題ありません。

## 毎回の起動

1. ルートで `npm run dev`（API 3100 + Next 3102）。
2. `src/frontend/.env.local` に少なくとも次があること。

   `NEXT_PUBLIC_API_BASE_URL=http://localhost:3100`

3. ブラウザで `http://localhost:3102` からログイン。

## それでも失敗するとき

| 症状 | 確認 |
|------|------|
| ログイン直後に cTrader が「redirect_uri 不一致」 | Redirect URIs に **今使っている origin + `/auth/ctrader/callback`** があるか |
| 認証 URL 取得が 404 | バックエンドが起動しているか、`NEXT_PUBLIC_API_BASE_URL` が `http://localhost:3100` か |
| トークン交換でエラー | ログイン開始とコールバックが **同じタブ・同じポート**か（途中で URL を手で変えていないか） |

## 本番・Vercel プレビュー

ホストが `localhost` 以外のときは **自動解決は使われません**。  
その環境の `CTRADER_REDIRECT_URI`（バックエンドの環境変数）と、cTrader に登録した URL を一致させてください。
