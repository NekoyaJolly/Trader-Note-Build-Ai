# API ドキュメント

## ベース URL
```
http://localhost:3100
```

> **注意**: デフォルトポートは `3100` です。`BACKEND_PORT` または `PORT` 環境変数で変更可能です。

## 認証

**cTrader OAuth 2.0 認証** を使用します。

### 認証フロー

1. `GET /api/auth/ctrader/url` で認証URLを取得
2. ユーザーを cTrader OAuth ページにリダイレクト
3. cTrader で認可後、`POST /api/auth/ctrader/callback` でトークン交換
4. JWT Cookie が発行され、認証完了

### JWT 認証

認証後の API リクエストでは、以下のいずれかで JWT を送信：

- **Cookie**: `auth_token`（推奨）
- **Authorization ヘッダー**: `Bearer <token>`

## 共通リクエストID

全 HTTP API はレスポンスヘッダー `X-Correlation-Id` を返します。

- クライアントが `X-Correlation-Id` または `X-Request-Id` を送った場合、安全な形式（英数字、`.`、`_`、`:`、`-`、8〜128文字）の値だけを引き継ぎます。
- 未指定または不正な値の場合はサーバー側で UUID を生成します。
- CORS では `X-Correlation-Id` / `X-Request-Id` の送信と、`X-Correlation-Id` の読み取りを許可します。
- Side-B TopLevelOrchestrator 経由の cron 実行では、DB schema 変更なしで `AgentRun.summary` とレスポンス `data.correlationId` / `data.runId` にも引き継ぎます。
- Side-B ADK Orchestrator / JobPort / PythonBridge HTTP mode / analysis-engine client では、DB schema 変更なしで `correlationId` を context・RunLedger summary/reason・`X-Correlation-Id` ヘッダーへ引き継ぎます。
- Side-B Evolution generation は、DB schema 変更なしで `GenerationReport.correlationId` / 観測ログ / analysis-engine `X-Correlation-Id` ヘッダーへ `correlationId` を引き継ぎます。EvolutionBacktestRun などの行単位 correlationId 専用列は今後のDB schema変更PRで検討します。

### API 認証分類

| 分類 | 意味 |
|------|------|
| `public` | 未ログインでもアクセス可能 |
| `auth` | ログイン必須 |
| `admin` | 管理者権限必須 |
| `cron` | `CRON_SECRET` 必須 |
| `webhook` | webhook token 必須 |
| `internal` | 内部通信専用 |

### API 認証マトリクス

> P0-1 方針: Side-A 系 API は原則 `auth`、Side-B の read 系は `auth`、Side-B の状態変更・実行系は `admin`。ID 指定 API の完全な multi-tenant owner check は DB schema 変更を伴う箇所があるため、今回の実装では schema 変更なしで可能な範囲に限定し、未完了箇所は `TODO: confirm` として残す。

| endpoint | method | classification | required auth | required role | required secret | rate limit required | audit log required | owner check required | notes |
|----------|--------|----------------|---------------|---------------|-----------------|---------------------|--------------------|----------------------|-------|
| `/health` | GET | public | none | none | none | no | no | no | liveness。プロセスがHTTP応答可能かのみ確認し、依存先状態は含めない。 |
| `/ready` | GET | public | none | none | none | no | no | no | readiness。DB疎通成功時は 200、失敗時は 503。秘密値や接続詳細は返さない。 |
| `/api/auth/ctrader/url` | GET | public | none | none | none | yes | no | no | OAuth 開始 URL。auth rate limit 対象。 |
| `/api/auth/ctrader/callback` | POST | public | none | none | none | yes | yes | no | OAuth callback。JWT Cookie と token を返す。 |
| `/api/auth/ctrader/status` | GET | auth | JWT | user/admin | none | no | no | yes | 認証ユーザーの cTrader token のみ返す。 |
| `/api/auth/ctrader` | DELETE | auth | JWT | user/admin | none | no | yes | yes | 認証ユーザー所有 token のみ削除。 |
| `/api/auth/ctrader/primary` | PUT | auth | JWT | user/admin | none | no | yes | yes | 認証ユーザー所有 accountId のみ設定可能。 |
| `/api/auth/ctrader/refresh` | POST | auth | JWT | user/admin | none | no | yes | yes | 認証ユーザー所有 accountId のみ更新可能。 |
| `/api/auth/me` | GET | auth | JWT | user/admin | none | no | no | self | ログインユーザー情報。 |
| `/api/auth/logout` | POST | auth | JWT | user/admin | none | no | no | self | Cookie を削除する。 |
| `/api/push/vapid-public-key` | GET | public | none | none | none | no | no | no | Push 購読に必要な公開鍵のみ返す。 |
| `/api/push/status` | GET | auth | JWT | user/admin | none | no | no | no | Push service 状態。 |
| `/api/push/subscribe` | POST | auth | JWT | user/admin | none | no | yes | self | 購読をログインユーザーに紐付ける。 |
| `/api/push/unsubscribe` | POST | auth | JWT | user/admin | none | no | yes | self | endpoint 単位の解除。owner check は TODO: confirm。 |
| `/api/push/test` | POST | auth | JWT | user/admin | none | no | yes | self | 自分宛テスト通知。 |
| `/api/mail/receive` | POST | webhook | none | none | `MAIL_SECURITY_TOKEN` | yes | yes | no | 外部 mail webhook の正規パス。`Authorization: Bearer`, `x-mail-security-token`, `?token=` のいずれかで検証。 |
| `/api/side-b/mail/receive` | POST | webhook | none | none | `MAIL_SECURITY_TOKEN` | yes | yes | no | 既存互換パス。新規連携は `/api/mail/receive` 推奨。 |
| `/api/trades/import/csv` | POST | auth | JWT | user/admin | none | no | yes | TODO: confirm | CSV import。userId 付与を伴う完全分離は残課題。 |
| `/api/trades/import/upload-text` | POST | auth | JWT | user/admin | none | no | yes | TODO: confirm | frontend import 主要導線。 |
| `/api/trades/notes` | GET | auth | JWT | user/admin | none | no | no | TODO: confirm | ノート一覧。 |
| `/api/trades/notes/status-counts` | GET | auth | JWT | user/admin | none | no | no | TODO: confirm | ノート集計。 |
| `/api/trades/notes/:id` | GET/PUT | auth | JWT | user/admin | none | no | PUT yes | yes | ID 指定 owner check は TODO: confirm。 |
| `/api/trades/notes/:id/approve` | POST | auth | JWT | user/admin | none | no | yes | yes | 状態変更。owner check は TODO: confirm。 |
| `/api/trades/notes/:id/reject` | POST | auth | JWT | user/admin | none | no | yes | yes | 状態変更。owner check は TODO: confirm。 |
| `/api/trades/notes/:id/revert-to-draft` | POST | auth | JWT | user/admin | none | no | yes | yes | 状態変更。owner check は TODO: confirm。 |
| `/api/trades/notes/:id/priority` | PATCH | auth | JWT | user/admin | none | no | yes | yes | 優先度更新。owner check は TODO: confirm。 |
| `/api/trades/notes/:id/enabled` | PATCH | auth | JWT | user/admin | none | no | yes | yes | 有効/無効更新。owner check は TODO: confirm。 |
| `/api/trades/notes/:id/pause` | PATCH | auth | JWT | user/admin | none | no | yes | yes | pause 更新。owner check は TODO: confirm。 |
| `/api/trades/notes/performance/ranking` | GET | auth | JWT | user/admin | none | no | no | TODO: confirm | performance read。 |
| `/api/trades/notes/performance/bulk` | POST | auth | JWT | user/admin | none | no | yes | TODO: confirm | bulk performance。 |
| `/api/trades/notes/:id/performance` | GET | auth | JWT | user/admin | none | no | no | yes | owner check は TODO: confirm。 |
| `/api/matching/check` | POST | auth | JWT | user/admin | none | no | yes | TODO: confirm | 一致判定の手動実行。 |
| `/api/matching/history` | GET | auth | JWT | user/admin | none | no | no | TODO: confirm | 履歴 read。 |
| `/api/notifications` | GET/DELETE | auth | JWT | user/admin | none | no | DELETE yes | self | 通知一覧/全削除。 |
| `/api/notifications/unread-count` | GET | auth | JWT | user/admin | none | no | no | self | 未読数。 |
| `/api/notifications/read-all` | PUT | auth | JWT | user/admin | none | no | yes | self | 全既読。 |
| `/api/notifications/:id` | GET/DELETE | auth | JWT | user/admin | none | no | DELETE yes | yes | owner check は TODO: confirm。 |
| `/api/notifications/:id/read` | PUT | auth | JWT | user/admin | none | no | yes | yes | owner check は TODO: confirm。 |
| `/api/notifications/check` | POST | auth | JWT | user/admin | none | no | yes | TODO: confirm | 通知チェック実行。 |
| `/api/notifications/logs` | GET | auth | JWT | user/admin | none | no | no | TODO: confirm | 通知ログ read。 |
| `/api/notifications/logs/:id` | GET/DELETE | auth | JWT | user/admin | none | no | DELETE yes | yes | owner check は TODO: confirm。 |
| `/api/orders/preset/:noteId` | GET | auth | JWT | user/admin | none | no | no | yes | note owner check は TODO: confirm。 |
| `/api/orders/confirmation` | POST | auth | JWT | user/admin | none | no | yes | yes | 発注支援の確認記録。 |
| `/api/indicators/settings` | GET/POST | auth | JWT | user/admin | none | no | POST yes | TODO: confirm | indicator settings。 |
| `/api/indicators/settings/:indicatorId` | DELETE | auth | JWT | user/admin | none | no | yes | TODO: confirm | 設定削除。 |
| `/api/indicators/settings/:indicatorId/toggle` | PATCH | auth | JWT | user/admin | none | no | yes | TODO: confirm | 有効/無効切替。 |
| `/api/indicators/metadata` | GET | auth | JWT | user/admin | none | no | no | no | metadata read。 |
| `/api/indicators/settings/reset` | POST | auth | JWT | user/admin | none | no | yes | TODO: confirm | settings reset。 |
| `/api/indicators/settings/setup-status` | GET | auth | JWT | user/admin | none | no | no | TODO: confirm | setup 状態。 |
| `/api/profiles` | GET/POST | auth | JWT | user/admin | none | no | POST yes | TODO: confirm | profile list/create。 |
| `/api/profiles/options` | GET | auth | JWT | user/admin | none | no | no | TODO: confirm | selector options。 |
| `/api/profiles/:id` | GET/PUT/DELETE | auth | JWT | user/admin | none | no | PUT/DELETE yes | yes | owner check は TODO: confirm。 |
| `/api/profiles/:id/default` | PUT | auth | JWT | user/admin | none | no | yes | yes | default profile 更新。 |
| `/api/backtest/check-coverage` | POST | auth | JWT | user/admin | none | no | no | TODO: confirm | データカバレッジ確認。 |
| `/api/settings` | GET/PUT | auth | JWT | user/admin | none | no | PUT yes | self | アプリ設定。 |
| `/api/settings/reset` | POST | auth | JWT | user/admin | none | no | yes | self | 設定 reset。 |
| `/api/bars/locate` | POST | auth | JWT | user/admin | none | no | no | TODO: confirm | bar locate。 |
| `/api/bars/locate/:symbol/:timestamp/:timeframe` | GET | auth | JWT | user/admin | none | no | no | TODO: confirm | bar locate read。 |
| `/api/strategies` | GET/POST | auth | JWT | user/admin | none | no | POST yes | TODO: confirm | strategy list/create。 |
| `/api/strategies/filters/indicators` | GET | auth | JWT | user/admin | none | no | no | no | filter metadata。 |
| `/api/strategies/symbols` | GET | auth | JWT | user/admin | none | no | no | TODO: confirm | symbol list。 |
| `/api/strategies/ohlcv/fetch-and-cache` | POST | auth | JWT | user/admin | none | no | yes | TODO: confirm | data fetch job 起動。 |
| `/api/strategies/ohlcv/fetch-progress/:jobId` | GET | auth | JWT | user/admin | none | no | no | TODO: confirm | job status。 |
| `/api/strategies/:id` | GET/PUT/DELETE | auth | JWT | user/admin | none | no | PUT/DELETE yes | yes | owner check は TODO: confirm。 |
| `/api/strategies/:id/versions/:versionNumber` | GET | auth | JWT | user/admin | none | no | no | yes | owner check は TODO: confirm。 |
| `/api/strategies/:id/rollback/:versionNumber` | PUT | auth | JWT | user/admin | none | no | yes | yes | rollback。 |
| `/api/strategies/:id/status` | PUT | auth | JWT | user/admin | none | no | yes | yes | status 更新。 |
| `/api/strategies/:id/duplicate` | POST | auth | JWT | user/admin | none | no | yes | yes | duplicate。 |
| `/api/strategies/:id/backtest` | POST | auth | JWT | user/admin | none | no | yes | yes | backtest 実行。 |
| `/api/strategies/:id/backtest/history` | GET | auth | JWT | user/admin | none | no | no | yes | history read。 |
| `/api/strategies/:id/backtest/:runId` | GET | auth | JWT | user/admin | none | no | no | yes | run read。 |
| `/api/strategies/:id/backtest/:runId/filter-analysis` | GET | auth | JWT | user/admin | none | no | no | yes | filter analysis。 |
| `/api/strategies/:id/backtest/:runId/filter-verify` | POST | auth | JWT | user/admin | none | no | yes | yes | filter verify 実行。 |
| `/api/strategies/:id/notes` | GET/POST | auth | JWT | user/admin | none | no | POST yes | yes | strategy note。 |
| `/api/strategies/:id/notes/stats` | GET | auth | JWT | user/admin | none | no | no | yes | note stats。 |
| `/api/strategies/:id/notes/from-backtest/:runId` | POST | auth | JWT | user/admin | none | no | yes | yes | backtest から note 作成。 |
| `/api/strategies/:id/notes/:noteId` | GET/PUT/DELETE | auth | JWT | user/admin | none | no | PUT/DELETE yes | yes | owner check は TODO: confirm。 |
| `/api/strategies/:id/notes/:noteId/status` | PUT | auth | JWT | user/admin | none | no | yes | yes | note status。 |
| `/api/strategies/:id/alerts` | GET/POST/PUT/DELETE | auth | JWT | user/admin | none | no | mutation yes | yes | alert settings。 |
| `/api/strategies/:id/alerts/trigger` | POST | auth | JWT | user/admin | none | no | yes | yes | manual trigger。 |
| `/api/strategies/:id/alerts/pause` | PUT | auth | JWT | user/admin | none | no | yes | yes | pause。 |
| `/api/strategies/:id/alerts/resume` | PUT | auth | JWT | user/admin | none | no | yes | yes | resume。 |
| `/api/strategies/:id/alerts/logs` | GET | auth | JWT | user/admin | none | no | no | yes | alert logs。 |
| `/api/strategies/:id/alerts/stream` | GET | auth | JWT | user/admin | none | no | no | yes | SSE。Cookie 認証前提。 |
| `/api/strategies/:id/walkforward` | POST | auth | JWT | user/admin | none | no | yes | yes | walkforward 実行。 |
| `/api/strategies/:id/walkforward/history` | GET | auth | JWT | user/admin | none | no | no | yes | history。 |
| `/api/strategies/:id/walkforward/:runId` | GET | auth | JWT | user/admin | none | no | no | yes | run read。 |
| `/api/strategies/:id/montecarlo` | POST | auth | JWT | user/admin | none | no | yes | yes | Monte Carlo 実行。 |
| `/api/strategies/:id/montecarlo/history` | GET | auth | JWT | user/admin | none | no | no | yes | history。 |
| `/api/strategies/:id/versions/compare` | GET | auth | JWT | user/admin | none | no | no | yes | version compare。 |
| `/api/strategy-comparison` | GET/POST | auth | JWT | user/admin | none | no | POST yes | TODO: confirm | comparison list/create。 |
| `/api/strategy-comparison/:id` | GET/DELETE | auth | JWT | user/admin | none | no | DELETE yes | yes | owner check は TODO: confirm。 |
| `/api/strategy-comparison/:id/optimize` | POST | auth | JWT | user/admin | none | no | yes | yes | optimize 実行。 |
| `/api/pattern-analysis/analyze` | POST | auth | JWT | user/admin | none | no | yes | TODO: confirm | pattern analyze。 |
| `/api/pattern-analysis/anomaly` | POST | auth | JWT | user/admin | none | no | yes | TODO: confirm | anomaly analyze。 |
| `/api/pattern-analysis/patterns/:strategyId` | GET | auth | JWT | user/admin | none | no | no | yes | strategy owner check は TODO: confirm。 |
| `/api/pattern-analysis/analyze-strategy` | POST | auth | JWT | user/admin | none | no | yes | yes | strategy analyze。 |
| `/api/ohlcv/import` | POST | auth | JWT | user/admin | none | no | yes | TODO: confirm | CSV OHLCV import。 |
| `/api/ohlcv/presets` | GET | auth | JWT | user/admin | none | no | no | TODO: confirm | preset list。 |
| `/api/ohlcv/presets/:id` | DELETE | auth | JWT | user/admin | none | no | yes | yes | owner check は TODO: confirm。 |
| `/api/ohlcv/coverage` | GET | auth | JWT | user/admin | none | no | no | TODO: confirm | coverage read。 |
| `/api/ohlcv/candles` | GET | auth | JWT | user/admin | none | no | no | TODO: confirm | candle read。 |
| `/api/watchlist` | GET/POST | auth | JWT | user/admin | none | no | POST yes | self | watchlist list/create。 |
| `/api/watchlist/:id` | PUT/DELETE | auth | JWT | user/admin | none | no | yes | yes | owner check は route 内で userId を使用。 |
| `/api/watchlist/active` | GET | auth | JWT | user/admin | none | no | no | self | scheduler 参照用にも使われるため owner 境界は TODO: confirm。 |
| `/api/trading/account` | GET | auth | JWT | user/admin | none | no | no | self | cTrader account read。 |
| `/api/trading/positions` | GET | auth | JWT | user/admin | none | no | no | self | cTrader positions read。 |
| `/api/trading/stream` | GET | auth | JWT | user/admin | none | no | no | self | SSE。Cookie 認証前提。 |
| `/api/trading/orders` | POST | auth | JWT | user/admin | none | no | yes | self | Phase 0 の実発注ゲートで既定停止。再開条件は `docs/side-a/order-execution-safety.md`。 |
| `/api/trading/orders/:id` | PUT/DELETE | auth | JWT | user/admin | none | no | yes | yes | Phase 0 の実発注ゲートで既定停止。再開時は action 別確認トークンと owner/account check 必須。 |
| `/api/trading/positions/:id/close` | POST | auth | JWT | user/admin | none | no | yes | yes | Phase 0 の実発注ゲートで既定停止。再開時は action 別確認トークンと owner/account check 必須。 |
| `/api/chart-drawings` | GET | auth | JWT | user/admin | none | no | no | self | chart drawing read。 |
| `/api/chart-drawings/sync` | PUT | auth | JWT | user/admin | none | no | yes | self | chart drawing sync。 |
| `/api/market-analysis/:symbol` | GET | auth | JWT | user/admin | none | no | no | TODO: confirm | market data read。外部 API key はサーバー内のみ。 |
| `/api/realtime/status` | GET | auth | JWT | user/admin | none | no | no | self | realtime 状態。 |
| `/api/realtime/connect` | POST | auth | JWT | user/admin | none | no | yes | self | cTrader 接続開始。 |
| `/api/realtime/disconnect` | POST | auth | JWT | user/admin | none | no | yes | self | cTrader 切断。 |
| `/api/realtime/subscribe` | POST | auth | JWT | user/admin | none | no | yes | self | symbol subscribe。 |
| `/api/realtime/unsubscribe` | POST | auth | JWT | user/admin | none | no | yes | self | symbol unsubscribe。 |
| `/api/realtime/clear-bars/:symbol` | POST | auth | JWT | user/admin | none | no | yes | TODO: confirm | cached bar clear。 |
| `/api/realtime/clear-all-bars` | POST | auth | JWT | user/admin | none | no | yes | TODO: confirm | cached bar all clear。 |
| `/api/realtime/bars/:symbol` | GET | auth | JWT | user/admin | none | no | no | TODO: confirm | bar read。 |
| `/api/realtime/stream/:symbol` | GET | auth | JWT | user/admin | none | no | no | self | SSE。Cookie 認証前提。 |
| `/api/similarity/search-cross` | POST | auth | JWT | user/admin | none | no | no | TODO: confirm | Side-A/Side-B 横断検索。 |
| `/api/similarity/health` | GET | auth | JWT | user/admin | none | no | no | no | 類似度 service health。 |
| `/api/side-b/stats/overview` | GET | auth | JWT | user/admin | none | no | no | no | Side-B dashboard read。 |
| `/api/side-b/stats/time-series` | GET | auth | JWT | user/admin | none | no | no | no | Side-B dashboard read。 |
| `/api/side-b/stats/by-category` | GET | auth | JWT | user/admin | none | no | no | no | Side-B dashboard read。 |
| `/api/side-b/stats/validation-activity` | GET | auth | JWT | user/admin | none | no | no | no | Side-B dashboard read。 |
| `/api/side-b/discovery/latest` | GET | auth | JWT | user/admin | none | no | no | no | Discovery read。 |
| `/api/side-b/discovery/funnel` | GET | auth | JWT | user/admin | none | no | no | no | Discovery funnel read。 |
| `/api/side-b/system/health` | GET | auth | JWT | user/admin | none | no | no | no | Side-B system read。 |
| `/api/side-b/evolution/lessons` | GET | auth | JWT | user/admin | none | no | no | no | Evolution read。 |
| `/api/side-b/evolution/runs` | GET | auth | JWT | user/admin | none | no | no | no | Evolution run list。 |
| `/api/side-b/evolution/runs/:runId/summary` | GET | auth | JWT | user/admin | none | no | no | no | Evolution summary。 |
| `/api/side-b/evolution/runs/:runId/candidates` | GET | auth | JWT | user/admin | none | no | no | no | Evolution candidates。 |
| `/api/side-b/hypotheses` | GET | auth | JWT | user/admin | none | no | no | no | 仮説 read。 |
| `/api/side-b/hypotheses/pending-validation` | GET | auth | JWT | user/admin | none | no | no | no | 検証待ち read。 |
| `/api/side-b/hypotheses/testing` | GET | auth | JWT | user/admin | none | no | no | no | testing read。 |
| `/api/side-b/hypotheses/recently-validated` | GET | auth | JWT | user/admin | none | no | no | no | recently validated read。 |
| `/api/side-b/hypotheses/recent-confirmed` | GET | auth | JWT | user/admin | none | no | no | no | confirmed read。 |
| `/api/side-b/hypotheses/recent-rejected` | GET | auth | JWT | user/admin | none | no | no | no | rejected read。 |
| `/api/side-b/hypotheses/batch-validate` | POST | admin | JWT | admin | none | no | yes | no | バッチ検証実行。 |
| `/api/side-b/hypotheses/:id/validate` | POST | admin | JWT | admin | none | no | yes | no | 検証実行。 |
| `/api/side-b/hypotheses/:id` | GET | auth | JWT | user/admin | none | no | no | no | 仮説詳細 read。 |
| `/api/side-b/hypotheses/:id/validation-status` | GET | auth | JWT | user/admin | none | no | no | no | status read。 |
| `/api/side-b/hypotheses/:id/validation-history` | GET | auth | JWT | user/admin | none | no | no | no | history read。 |
| `/api/side-b/orchestrator/runs` | GET | auth | JWT | user/admin | none | no | no | no | RunLedger read。 |
| `/api/side-b/orchestrator/runs/:id` | GET | auth | JWT | user/admin | none | no | no | no | RunLedger detail。 |
| `/api/side-b/orchestrator/drafts` | GET | auth | JWT | user/admin | none | no | no | no | StrategyDraft read。 |
| `/api/side-b/orchestrator/drafts/:id` | GET | auth | JWT | user/admin | none | no | no | no | StrategyDraft detail。 |
| `/api/side-b/orchestrator/drafts/:id/approve` | POST | admin | JWT | admin | none | no | yes | no | draft 承認。 |
| `/api/side-b/orchestrator/drafts/:id/reject` | POST | admin | JWT | admin | none | no | yes | no | draft 却下。 |
| `/api/side-b/orchestrator/drafts/:id/queue` | POST | admin | JWT | admin | none | no | yes | no | validation queue 投入。 |
| `/api/side-b/orchestrator/drafts/:id/archive` | POST | admin | JWT | admin | none | no | yes | no | draft archive。 |
| `/api/side-b/emergency/status` | GET | admin | JWT | admin | none | no | yes | no | emergency 状態。user read 化は TODO: confirm。 |
| `/api/side-b/emergency/stop` | POST | admin | JWT | admin | none | no | yes | no | 緊急停止。 |
| `/api/side-b/emergency/resume` | POST | admin | JWT | admin | none | no | yes | no | 緊急停止解除。 |
| `/api/side-b/research` | GET | auth | JWT | user/admin | none | no | no | no | research list。 |
| `/api/side-b/research` | POST | admin | JWT | admin | none | no | yes | no | research 生成。 |
| `/api/side-b/research/valid/:symbol` | GET | auth | JWT | user/admin | none | no | no | no | valid research。 |
| `/api/side-b/research/:id` | GET | auth | JWT | user/admin | none | no | no | no | research detail。 |
| `/api/side-b/plans` | GET | auth | JWT | user/admin | none | no | no | no | plan list。 |
| `/api/side-b/plans` | POST | admin | JWT | admin | none | no | yes | no | plan 生成。 |
| `/api/side-b/plans/today/:symbol` | GET | auth | JWT | user/admin | none | no | no | no | today plan。 |
| `/api/side-b/plans/:id` | GET | auth | JWT | user/admin | none | no | no | no | plan detail。 |
| `/api/side-b/pipeline` | POST | admin | JWT | admin | none | no | yes | no | full pipeline 実行。 |
| `/api/side-b/cleanup` | POST | admin | JWT | admin | none | no | yes | no | cleanup 実行。 |
| `/api/side-b/trades` | GET | auth | JWT | user/admin | none | no | no | no | virtual trade list。 |
| `/api/side-b/trades` | POST | admin | JWT | admin | none | no | yes | no | virtual trade 作成。 |
| `/api/side-b/trades/:id` | GET | auth | JWT | user/admin | none | no | no | no | virtual trade detail。 |
| `/api/side-b/trades/:id/close` | POST | admin | JWT | admin | none | no | yes | no | virtual trade close。 |
| `/api/side-b/trades/:id/cancel` | POST | admin | JWT | admin | none | no | yes | no | virtual trade cancel。 |
| `/api/side-b/portfolio` | GET | auth | JWT | user/admin | none | no | no | no | portfolio read。 |
| `/api/side-b/portfolio/settings` | PUT | admin | JWT | admin | none | no | yes | no | portfolio 設定更新。 |
| `/api/side-b/ai-notes` | GET | auth | JWT | user/admin | none | no | no | no | AI note list。 |
| `/api/side-b/ai-notes/summaries` | GET | auth | JWT | user/admin | none | no | no | no | AI note summary read。 |
| `/api/side-b/ai-notes/summaries/generate` | POST | admin | JWT | admin | none | no | yes | no | AI note summary 生成。 |
| `/api/side-b/ai-notes/:id/matching` | PATCH | admin | JWT | admin | none | no | yes | no | matching 対象 toggle。 |
| `/api/side-b/ai-notes/:id` | GET | auth | JWT | user/admin | none | no | no | no | AI note detail。 |
| `/api/side-b/scheduler/status` | GET | auth | JWT | user/admin | none | no | no | no | scheduler status read。 |
| `/api/side-b/scheduler/start` | POST | admin | JWT | admin | none | no | yes | no | scheduler start。 |
| `/api/side-b/scheduler/stop` | POST | admin | JWT | admin | none | no | yes | no | scheduler stop。 |
| `/api/side-b/scheduler/config` | PUT | admin | JWT | admin | none | no | yes | no | scheduler config 更新。 |
| `/api/side-b/scheduler/run-daily-plan` | POST | admin | JWT | admin | none | no | yes | no | manual job 実行。 |
| `/api/side-b/scheduler/run-monitor` | POST | admin | JWT | admin | none | no | yes | no | manual monitor 実行。 |
| `/api/side-b/agent/status` | GET | auth | JWT | user/admin | none | no | no | no | agent status read。 |
| `/api/side-b/agent/start` | POST | admin | JWT | admin | none | no | yes | no | agent start。 |
| `/api/side-b/agent/stop` | POST | admin | JWT | admin | none | no | yes | no | agent stop。 |
| `/api/side-b/agent/thinking-log` | GET | auth | JWT | user/admin | none | no | no | no | thinking log read。 |
| `/api/side-b/agent/reflections` | GET | auth | JWT | user/admin | none | no | no | no | reflection read。 |
| `/api/side-b/agent/lessons` | GET | auth | JWT | user/admin | none | no | no | no | lesson read。 |
| `/api/side-b/comparison` | GET | auth | JWT | user/admin | none | no | no | no | comparison read。 |
| `/api/side-b/comparison/dashboard` | GET | auth | JWT | user/admin | none | no | no | no | dashboard read。 |
| `/api/side-b/summaries` | GET | auth | JWT | user/admin | none | no | no | no | summary read。 |
| `/api/side-b/summaries/generate` | POST | admin | JWT | admin | none | no | yes | no | summary 生成。 |
| `/api/side-b/summaries/scheduler` | GET | auth | JWT | user/admin | none | no | no | no | summary scheduler read。 |
| `/api/side-b/summaries/scheduler` | PUT | admin | JWT | admin | none | no | yes | no | summary scheduler 更新。 |
| `/api/side-b/summaries/scheduler/start` | POST | admin | JWT | admin | none | no | yes | no | summary scheduler start。 |
| `/api/side-b/summaries/scheduler/stop` | POST | admin | JWT | admin | none | no | yes | no | summary scheduler stop。 |
| `/api/cron/health` | GET | cron | none | none | `CRON_SECRET` | no | yes | no | cronAuth 必須。 |
| `/api/cron/side-b/daily-plan` | GET | cron | none | none | `CRON_SECRET` | no | yes | no | cron daily plan。 |
| `/api/cron/side-b/monitor` | GET | cron | none | none | `CRON_SECRET` | no | yes | no | cron monitor。 |
| `/api/cron/side-b/run-screening` | GET | cron | none | none | `CRON_SECRET` | no | yes | no | cron screening。 |
| `/api/cron/side-b/run-full-validation` | GET | cron | none | none | `CRON_SECRET` | no | yes | no | full validation。 |
| `/api/cron/side-b/run-evolution` | POST | cron | none | none | `CRON_SECRET` | no | yes | no | evolution 実行。 |
| `/api/cron/side-b/reset-not-testable` | POST | cron | none | none | `CRON_SECRET` | no | yes | no | reset job。 |
| `/api/cron/matching-pipeline` | GET | cron | none | none | `CRON_SECRET` | no | yes | no | matching pipeline。 |
| `/api/cron/matching-pipeline/test` | POST | cron | none | none | `CRON_SECRET` | no | yes | no | matching pipeline test。 |
| `/api/cron/strategy-alerts` | GET | cron | none | none | `CRON_SECRET` | no | yes | no | ストラテジー条件ライブ評価+アラート発火 (Phase γ-1)。市場休場時スキップ。 |
| `/api/cron/strategy-alerts/test` | POST | cron | none | none | `CRON_SECRET` | no | yes | no | ストラテジーライブ評価の手動テスト (市場チェックなし)。 |
| `analysis-engine` 連携 | internal | internal | service-to-service | `X-Analysis-Engine-Secret` | shared secret | no | yes | no | `src/backend/services/analysisEngineClient` / PythonBridge HTTP mode からのみ呼び出す。`/health` 以外は secret なしで `401`。 |
| `/api/daily-status` | GET | TODO: confirm | TODO | TODO | TODO | TODO | TODO | TODO | frontend 参照あり。backend route は未確認。 |
| `/api/auth/ctrader/exchange` | POST | TODO: confirm | TODO | TODO | TODO | TODO | TODO | TODO | docs 旧記載。現行 route は `/api/auth/ctrader/callback`。 |

### 認証エンドポイント

---

## 環境変数

| 変数名 | 説明 | デフォルト値 |
|--------|------|--------------|
| `BACKEND_PORT` / `PORT` | バックエンドサーバーのポート | `3100` |
| `DATABASE_URL` | PostgreSQL 接続文字列 | （必須） |
| `AI_API_KEY` | AI サービス API キー | （空文字） |
| `AI_MODEL` | AI モデル名 | `gpt-4o-mini` |
| `AI_BASE_URL` | AI API ベース URL | `https://api.openai.com/v1` |
| `MARKET_API_URL` | 市場データ API URL（Twelve Data） | （空文字） |
| `MARKET_API_KEY` | 市場データ API キー（Twelve Data） | （空文字） |
| `CTRADER_CLIENT_ID` | cTrader Open API クライアント ID | （空文字） |
| `CTRADER_CLIENT_SECRET` | cTrader Open API シークレット | （空文字） |
| `CTRADER_REDIRECT_URI` | OAuth コールバック URL | Vercel 本番 URL |
| `MATCH_THRESHOLD` | 一致判定しきい値 | `0.75` |
| `CHECK_INTERVAL_MINUTES` | 定期マッチング間隔（分） | `15` |
| `DAILY_NOTIFICATION_LIMIT` | 24時間あたりの通知上限 | `30` |
| `CRON_ENABLED` | スケジューラ有効化フラグ | `true` |
| `PUSH_NOTIFICATION_KEY` | プッシュ通知サービスキー | （空文字） |
| `ANALYSIS_ENGINE_URL` | backend から analysis-engine を呼ぶ base URL | `http://analysis-engine:8000` |
| `ANALYSIS_ENGINE_SHARED_SECRET` | backend/PythonBridge → analysis-engine の内部認証 secret。production 必須 | （必須） |
| `ANALYSIS_ENGINE_MAX_REQUEST_BYTES` | analysis-engine `/v1/*` の Content-Length 上限 | `2097152` |
| `ANALYSIS_ENGINE_RATE_LIMIT_PER_MINUTE` | analysis-engine `/v1/*` の per-minute 上限。`0` で無効 | `300` |

> Phase 3 以降の production deploy 前提: GCP Secret Manager に
> `ANALYSIS_ENGINE_SHARED_SECRET` を作成し、backend と analysis-engine の両 Cloud Run
> service に同じ値を注入する。未作成の場合、deploy は安全側に失敗する。

---

## エンドポイント

### ヘルスチェック

#### GET /health
サーバープロセスが HTTP 応答できることだけを確認します。
DB などの依存先確認は `/ready` に分離します。

**応答:**
```json
{
  "status": "ok",
  "check": "liveness",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### GET /ready
サーバーがトラフィックを受けられる状態か、DB 疎通を含めて確認します。
失敗時も接続先やエラー詳細は返しません。

**成功応答:**
```json
{
  "status": "ready",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "dependencies": {
    "database": "ok"
  }
}
```

**失敗応答 (503):**
```json
{
  "status": "not_ready",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "dependencies": {
    "database": "error"
  }
}
```

---

### cTrader OAuth 認証

#### GET /api/auth/ctrader/url
cTrader OAuth 認証 URL を取得します。

**応答:**
```json
{
  "url": "string"
}
```

---

#### POST /api/auth/ctrader/exchange
認可コードをアクセストークンに交換します。

**リクエストボディ:**
```json
{
  "code": "string"
}
```

**応答:**
```json
{
  "success": true,
  "expiresAt": "2024-01-01T00:00:00.000Z"
}
```

---

#### GET /api/auth/ctrader/status
cTrader 接続状態を確認します。

**応答:**
```json
{
  "connected": true,
  "expiresAt": "2024-01-01T00:00:00.000Z"
}
```

---

#### POST /api/auth/ctrader/refresh
アクセストークンをリフレッシュします。

**応答:**
```json
{
  "success": true,
  "expiresAt": "<expiration_timestamp>"
}
```

---

#### DELETE /api/auth/ctrader
cTrader 接続を解除します（トークン削除）。

**応答:**
```json
{
  "success": true
}
```

---

#### PUT /api/auth/ctrader/primary
プライマリアカウントを変更します。

**リクエストボディ:**
```json
{
  "accountId": "string"
}
```

**応答:**
```json
{
  "success": true,
  "message": "アカウント XXX をプライマリアカウントに設定しました"
}
```

---

#### GET /api/auth/me
現在のユーザー情報を取得します。

**応答:**
```json
{
  "success": true,
  "user": {
    "id": "string",
    "primaryAccountId": "string",
    "displayName": "string",
    "email": "string",
    "role": "user|admin",
    "active": true,
    "lastLoginAt": "2024-01-01T00:00:00.000Z",
    "ctraderAccounts": [
      {
        "accountId": "string",
        "expiresAt": "2024-01-01T00:00:00.000Z",
        "lastConnectedAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

---

#### POST /api/auth/logout
ログアウトします（Cookie削除）。

**応答:**
```json
{
  "success": true,
  "message": "ログアウトしました"
}
```

---

### トレードインポートとノート

#### POST /api/trades/import/csv
`data/trades/` ディレクトリ内の CSV ファイルからトレードをインポートし、ノートを自動生成します。

**リクエストボディ:**
```json
{
  "filename": "string"
}
```

**応答:**
```json
{
  "success": true,
  "tradesImported": 5,
  "tradesSkipped": 0,
  "importErrors": [],
  "insertedIds": ["uuid", "uuid"],
  "notesGenerated": 5,
  "noteIds": ["uuid", "uuid"]
}
```

---

#### POST /api/trades/import/upload-text
クライアントから CSV テキストを受け取り、サーバー側でファイル保存→取り込み→Draft ノート生成まで一気通貫で実行します。

**リクエストボディ:**
```json
{
  "filename": "string",
  "csvText": "timestamp,symbol,side,price,quantity,fee,exchange\n2024-01-01T00:00:00Z,string,string,number,number,number,string"
}
```

**応答:**
```json
{
  "success": true,
  "tradesImported": 1,
  "tradesSkipped": 0,
  "importErrors": [],
  "insertedIds": ["uuid"],
  "notesGenerated": 1,
  "noteIds": ["uuid"]
}
```

---

#### GET /api/trades/notes
保存されているすべてのトレードノートを取得します。

**クエリパラメータ:**
- `status`: ステータスでフィルタ（`draft` / `approved` / `rejected`）

**応答:**
```json
{
  "notes": [
    {
      "id": "uuid",
      "tradeId": "uuid",
      "symbol": "string",
      "side": "string",
      "timestamp": "2024-01-01T00:00:00.000Z",
      "aiSummary": "string",
      "status": "draft",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

#### GET /api/trades/notes/status-counts
ステータス別のノート件数を取得します。ダッシュボード表示用。

**応答:**
```json
{
  "draft": 5,
  "approved": 10,
  "rejected": 2,
  "total": 17
}
```

---

#### GET /api/trades/notes/:id
ID で特定のトレードノートを取得します。

**応答:**
```json
{
  "id": "uuid",
  "tradeId": "uuid",
  "symbol": "string",
  "side": "string",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "entryConditions": "...",
  "exitConditions": "...",
  "aiSummary": "string",
  "status": "draft",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "userNotes": "string",
  "tags": ["string"]
}
```

---

#### PUT /api/trades/notes/:id
ノートの内容を更新します（AI 要約、ユーザーメモ、タグ）。

**リクエストボディ:**
```json
{
  "aiSummary": "string",
  "userNotes": "string",
  "tags": ["string"]
}
```

**応答:**
```json
{
  "success": true,
  "note": {
    "id": "uuid",
    "aiSummary": "string",
    "userNotes": "string",
    "tags": ["string"],
    "lastEditedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### POST /api/trades/notes/:id/approve
ノートを承認状態に変更します。承認済みノートのみがマッチング対象となります。

**応答:**
```json
{
  "success": true,
  "status": "approved",
  "note": {
    "id": "uuid",
    "status": "approved",
    "approvedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**エラー応答（404）:**
```json
{
  "error": "ノートが見つかりませんでした"
}
```

---

#### POST /api/trades/notes/:id/reject
ノートを非承認（rejected）にします。非承認のノートはマッチング対象外となります。

**応答:**
```json
{
  "success": true,
  "status": "rejected",
  "note": {
    "id": "uuid",
    "status": "rejected",
    "rejectedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### POST /api/trades/notes/:id/revert-to-draft
ノートを下書き状態に戻します。承認済み/非承認から編集モードに戻す際に使用。

**応答:**
```json
{
  "success": true,
  "status": "draft",
  "note": {
    "id": "uuid",
    "status": "draft"
  }
}
```

---

### マッチング

#### POST /api/matching/check
現在の市場条件に対してマッチングチェックを手動でトリガーします。

**応答:**
```json
{
  "success": true,
  "matchCount": 2,
  "notificationsGenerated": 2
}
```

---

#### GET /api/matching/history
検出されたすべてのマッチの履歴を取得します。

**クエリパラメータ:**
- `symbol`: シンボルでフィルタ
- `limit`: 取得件数（デフォルト: 50）
- `offset`: オフセット（ページング用）
- `minScore`: 最小スコアでフィルタ

**応答:**
```json
{
  "success": true,
  "count": 2,
  "matches": [
    {
      "id": "uuid",
      "noteId": "uuid",
      "symbol": "string",
      "matchScore": 0.85,
      "threshold": 0.75,
      "trendMatched": true,
      "priceRangeMatched": true,
      "reasons": ["string"],
      "evaluatedAt": "2024-01-01T00:00:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "marketSnapshotId": "uuid"
    }
  ]
}
```

---

### 通知

#### GET /api/notifications
すべての通知を取得します。

**クエリパラメータ:**
- `unreadOnly`: `true` の場合、未読通知のみ取得

**応答:**
```json
{
  "notifications": [...]
}
```

---

#### GET /api/notifications/:id
特定の通知を取得します。

**応答:**
```json
{
  "id": "uuid",
  "matchResultId": "uuid",
  "sentAt": "2024-01-01T00:00:00.000Z",
  "channel": "in_app",
  "isRead": false,
  "matchResult": { "score": 0.82, "evaluatedAt": "2024-01-01T00:00:00.000Z" },
  "tradeNote": { "id": "uuid", "symbol": "string", "side": "string", "timeframe": "string" },
  "reasonSummary": "string"
}
```

---

#### PUT /api/notifications/:id/read
通知を既読にマークします。

---

#### PUT /api/notifications/read-all
すべての通知を既読にマークします。

---

#### DELETE /api/notifications/:id
特定の通知を削除します。

---

#### DELETE /api/notifications
すべての通知をクリアします。

---

### Phase4: 通知トリガ・ログ

#### POST /api/notifications/check
通知を評価し、配信・記録します（再通知防止ロジック適用）。

> **重要**: 現在の実装ではリクエストボディの `matchResultId` / `channel` は参照されません。
> サーバー側で最新のマッチングを再実行し、`channel` は `in_app` 固定です。

**再通知防止ルール:**
- **冪等性**: 同一 noteId × snapshotId × channel の組み合わせは再送しない
- **クールダウン**: 同一 noteId への通知は 1 時間のクールダウン
- **重複抑制**: 同一スナップショットへの通知は 5 秒のデバウンス

**リクエストボディ:**
```json
{}
```
> 注: 現在の実装ではリクエストボディは無視されます。

**応答:**
```json
{
  "processed": 5,
  "notified": 2,
  "skipped": 3,
  "shouldNotify": true,
  "results": [
    {
      "noteId": "uuid",
      "shouldNotify": true,
      "status": "sent",
      "notificationLogId": "uuid"
    },
    {
      "noteId": "uuid",
      "shouldNotify": false,
      "status": "skipped",
      "skipReason": "string"
    }
  ]
}
```

---

#### GET /api/notifications/logs
通知ログを取得します。

**クエリパラメータ:**
- `symbol`: シンボルでフィルタ
- `noteId`: ノート ID でフィルタ
- `status`: `sent` | `skipped` | `failed` でフィルタ
- `limit`: 最大件数（デフォルト: 50）

> **注意**: フィルタを指定しない場合は失敗ログ（`status=failed`）のみを返します。
> 全件取得する場合は `status=sent` または `status=skipped` を明示的に指定してください。

**応答:**
```json
{
  "logs": [
    {
      "id": "uuid",
      "noteId": "uuid",
      "marketSnapshotId": "uuid",
      "symbol": "string",
      "score": 0.85,
      "channel": "in_app",
      "status": "sent",
      "reasonSummary": "string",
      "sentAt": "2024-01-01T00:00:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

#### GET /api/notifications/logs/:id
指定 ID の通知ログを取得します。

---

#### DELETE /api/notifications/logs/:id
指定 ID の通知ログを削除します。

---

### 注文

#### GET /api/orders/preset/:noteId
マッチしたトレードノートに基づいて注文プリセットを生成します。

> **重要**: 本システムは自動売買を行いません。参考情報のみを提供します。

**応答:**
```json
{
  "preset": {
    "symbol": "string",
    "side": "string",
    "suggestedPrice": 42500.00,
    "suggestedQuantity": 0.1,
    "basedOnNoteId": "uuid",
    "confidence": 0.8
  }
}
```

---

#### POST /api/orders/confirmation
注文確認情報を取得します（参考値）。

> **重要**: このエンドポイントは参考値の確認用です。実発注を許可する confirmation token は発行しません。Phase 2 以降の実発注用確認契約は `docs/side-a/order-execution-safety.md` の `POST /api/trading/order-confirmations` に分離します。

**リクエストボディ:**
```json
{
  "symbol": "string",
  "side": "string",
  "price": 42500,
  "quantity": 0.1
}
```

**応答:**
```json
{
  "confirmation": {
    "symbol": "string",
    "side": "string",
    "price": 42500,
    "quantity": 0.1,
    "estimatedCost": 4250,
    "estimatedFee": 4.25,
    "total": 4254.25,
    "warning": "これは参考情報です。本システムは自動売買を行いません。実際の注文は取引所で行ってください。"
  }
}
```

---

#### 実発注 API の安全契約 (Phase 1)

Phase 0 以降、`POST /api/trading/orders`、`PUT /api/trading/orders/:id`、`DELETE /api/trading/orders/:id`、`POST /api/trading/positions/:id/close` は `TRADING_ORDER_EXECUTION_ENABLED=true` でない限り `403 TRADING_ORDER_EXECUTION_DISABLED` を返します。production でこの gate を解除する前に、`docs/side-a/order-execution-safety.md` の安全契約を実装する必要があります。

Phase 2 で新設する実発注用確認エンドポイントは以下です。

| Endpoint | Method | 状態 | 責務 |
|---|---|---|---|
| `/api/trading/order-confirmations` | POST | Phase 2 予定 | 最終確認モーダルで表示する検証済みサマリーと短時間 confirmation token を発行する。実発注はしない。 |
| `/api/trading/orders` | POST | 現在は gate 停止 | confirmation token、`Idempotency-Key`、symbol/volume/risk 検証、監査ログを通過した場合だけ成行注文を送信する。 |
| `/api/trading/orders/:id` | PUT/DELETE | 現在は gate 停止 | action 別 confirmation token と owner/account check を必須にして注文変更またはキャンセルを行う。 |
| `/api/trading/positions/:id/close` | POST | 現在は gate 停止 | action 別 confirmation token と owner/account check を必須にしてポジション決済を行う。 |

実発注系 mutation はすべて以下を必須にします。

- `X-Order-Confirmation-Token`
- `Idempotency-Key`
- accountId と口座種別のサーバー側解決
- cTrader symbolId と volume min/max/step のサーバー側検証
- live 口座での SL 必須化
- 注文監査ログ

失敗時の status code とユーザー表示文言は `docs/side-a/order-execution-safety.md` の失敗時ステータス表を正本とします。

---

### チャート・ブローカー

チャートのローソク足 (OHLCV) は **EODHD を主データソース**とし、cTrader 障害時もチャートを表示できる設計。cTrader は bid/ask・スプレッド等の broker overlay に分離する。分析結果 (12次元特徴量) は従来通り `/api/market-analysis/:symbol` が担い、本セクションのチャート API とは責務を分ける。

#### GET /api/chart/candles
チャート用ローソ足を取得します。EODHD を主データソースとし、障害時はローカルキャッシュ (OHLCVCandle) にフォールバックします。**cTrader には依存しません。**

**クエリパラメータ:**
- `symbol` (必須): 銘柄シンボル (例: `XAUUSD`)
- `timeframe` (必須): 時間足 (`1m`/`5m`/`15m`/`30m`/`1h`/`4h`/`1d`/`1w`)
- `from` (任意): 開始日時 (ISO 8601)
- `to` (任意): 終了日時 (ISO 8601)
- `limit` (任意): 取得本数 (最大 5000)

**HTTP ステータス方針 (404 を乱用しない):**
- symbol 不正/未対応 → `404`
- timeframe 不正/必須パラメータ不足 → `400`
- 外部プロバイダー障害かつキャッシュ無し → `503`
- symbol は有効だがデータ無し → `200` (`candles: []` + `warning`)

**応答 (200):**
```json
{
  "candles": [
    { "time": 1717239600, "open": 2345.12, "high": 2347.22, "low": 2344.80, "close": 2346.31, "volume": null }
  ],
  "meta": {
    "source": "EODHD",
    "provider": "EODHD",
    "priceBasis": "unknown",
    "symbol": "XAUUSD",
    "timeframe": "1m",
    "isRealtime": false,
    "delayMs": 60000,
    "generatedAt": "2026-06-03T00:00:00.000Z"
  },
  "warning": "EODHDのOHLCVはリアルタイムではない可能性があります。"
}
```
`time` は Unix 秒 (UTC)。`source` は `"EODHD"` | `"local"` | `"cTrader"`。フォールバック時は `source: "local"`。

---

#### GET /api/broker/quote
チャート上に重ねるブローカー (cTrader) の現在 bid/ask・スプレッドを取得します。ローソ足とは別レイヤーで、cTrader 障害時もチャート API には影響しません。

**クエリパラメータ:**
- `symbol` (必須): 銘柄シンボル

**HTTP ステータス方針:**
- 正常取得 → `200` (`status: "connected"`)
- 設定済だが取得失敗 → `200` (`status: "degraded"`, `quote: null`)
- 未接続 → `503` (`status: "disconnected"`, `quote: null`)
- symbol 不足 → `400`

**応答 (200):**
```json
{
  "quote": {
    "symbol": "EURUSD",
    "broker": "cTrader",
    "bid": 1.23450,
    "ask": 1.23470,
    "spread": 0.00020,
    "timestamp": "2026-06-03T00:00:00.000Z",
    "isRealtime": true
  },
  "status": "connected"
}
```

> 注: 約定履歴 (deal) マーカー用の `/api/broker/executions` は後続対応 (cTrader 側 deal 取得が未実装のため)。

---

## CORS 設定

デフォルトで以下のオリジンからのリクエストを許可しています:
- `http://localhost:3001`
- `http://localhost:3102`

---

## スケジューラ

マッチングスケジューラは `CRON_ENABLED=true`（デフォルト）の場合、設定された間隔（デフォルト: 15分）で自動実行されます。

- 全ノートを現在の市場状況と照合
- しきい値を超えた一致に対して通知を生成
- 再通知防止ルールを適用

---

## 横断類似ノート検索

### POST /api/similarity/search-cross

Side-A（TradeNote）と Side-B（AITradeNote）を横断して類似ノートを検索します。

**リクエストボディ:**

```json
{
  // OHLCV データ（特徴量自動抽出） または featureVector のいずれかが必須
  "ohlcvData": [
    {
      "timestamp": "2024-01-01T00:00:00Z",
      "open": 100.5,
      "high": 101.2,
      "low": 100.1,
      "close": 100.8,
      "volume": 1500
    }
  ],
  
  // または 12次元特徴ベクトルを直接指定
  "featureVector": [0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
  
  // オプション
  "symbol": "EURUSD",              // シンボルフィルタ（省略可）
  "topK": 10,                      // 取得件数（デフォルト: 10）
  "minSimilarity": 0.5,            // 最小類似度 0-1（デフォルト: 0.5）
  "searchTradeNotes": true,        // TradeNote を検索（デフォルト: true）
  "searchAITradeNotes": true       // AITradeNote を検索（デフォルト: true）
}
```

**応答:**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "noteId": "uuid",
        "noteType": "tradeNote",        // "tradeNote" または "aiTradeNote"
        "similarity": 0.85,              // コサイン類似度（0-1）
        "distance": 0.42,                // ユークリッド距離
        "symbol": "EURUSD",
        "date": "2024-01-01",
        "direction": "long",             // "long" または "short"
        "outcome": "win",                // 成績（省略可）
        "pnl": 50.5,                     // 損益（省略可）
        "metadata": {                    // 追加メタデータ
          "tradeId": "uuid",
          "timeframe": "1h"
        }
      }
    ],
    "totalCount": 5,
    "searchStats": {
      "tradeNotesSearched": 100,
      "aiTradeNotesSearched": 50,
      "tradeNotesMatched": 3,
      "aiTradeNotesMatched": 2
    }
  }
}
```

**エラーレスポンス:**

```json
{
  "success": false,
  "error": "エラーメッセージ",
  "details": {}
}
```

---

### GET /api/similarity/health

類似検索サービスのヘルスチェック。

**応答:**

```json
{
  "status": "ok",
  "service": "cross-similarity-search",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

**備考:**
- このAPIは手動呼び出し用
- **Cron監視では自動実行**: `CronSimilarityService` が `CrossSimilarityService` を内部的に利用
- 類似度閾値はデフォルト85%（Cron監視）、手動では50%
- 詳細は `docs/ARCHITECTURE.md` の「Cron監視の類似度チェック」を参照

---
