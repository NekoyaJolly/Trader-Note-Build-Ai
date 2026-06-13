# Side-A 実発注安全仕様

> **ステータス**: Phase 1 仕様確定 (2026-06-13)
> **対象**: Side-A の cTrader 実発注、注文変更、注文キャンセル、ポジション決済
> **非対象**: Phase 2 の実発注再実装、DB migration、cTrader 実発注の通電

この文書は Phase 0 で停止した実発注系 API を、将来 Phase 2 で本番品質として戻すための安全契約である。本 PR のマージをもって、Phase 1 の設計承認とする。

## 1. 現在の安全境界

- `TRADING_ORDER_EXECUTION_ENABLED` が `true` でない限り、以下の実発注系 API は `403` で停止する。
  - `POST /api/trading/orders`
  - `PUT /api/trading/orders/:id`
  - `DELETE /api/trading/orders/:id`
  - `POST /api/trading/positions/:id/close`
- フロントエンドのワンクリック注文 UI は `NEXT_PUBLIC_TRADING_ORDER_EXECUTION_ENABLED` が `true` でない限り disabled 表示にする。
- `POST /api/orders/confirmation` は参考値の確認用であり、実発注を許可する確認トークンではない。
- Phase 2 が完了するまで、production で実発注が通る状態にしてはならない。

## 2. 設計判断

### 2.1 確認方式

実発注、注文変更、注文キャンセル、ポジション決済は、すべて「最終確認モーダル」と「短時間だけ有効な確認トークン」の両方を必須にする。

- UI は必ず数量、価格、SL、TP、口座種別、想定損失、symbol 仕様を最終確認モーダルに表示する。
- API は確認トークンなしの実行を拒否する。
- 確認トークンは確認済み payload の hash、userId、accountId、対象 action、expiresAt を持つ。
- 確認トークンは短時間で失効し、1 回使用したら再利用できない。
- token 発行後に payload が変わった場合、API は payload mismatch として拒否する。

理由: モーダルだけでは API 直叩きを防げず、トークンだけではユーザーが何を承認したか UI 上で確認しづらい。両方を必須にして、UI 操作とサーバー契約の両面で誤発注を止める。

### 2.2 demo/live 口座の扱い

demo と live は UI 表示、制限、監査ログ上で明確に分ける。

- 口座種別は注文フォーム、確認モーダル、結果表示、監査ログに必ず表示する。
- live 口座では高リスク表示を行い、確認モーダルの省略を許可しない。
- demo 口座でも確認トークンは必須にする。ただし上限値は live より緩い設定を許容できる。
- accountId と口座種別はサーバー側の cTrader token/account 情報から解決し、クライアント入力を信用しない。

### 2.3 リスク制限

live 口座の実発注は、最低限以下をすべて満たす場合だけ許可する。

- SL は必須。
- TP は任意。
- 最大ロット、最大想定損失、1 日あたりの最大想定損失をサーバー側設定で検証する。
- 想定損失を計算できない場合は fail closed として拒否する。
- volume は symbol ごとの min、max、step に一致する必要がある。
- symbol が取引不可、休場、または仕様未取得の場合は拒否する。

### 2.4 注文種別

Phase 2 の初期復旧では成行注文だけを対象にする。

- 指値、逆指値、OCO、部分約定前提の高度な注文は Phase 2 の初期範囲外にする。
- 注文変更、キャンセル、ポジション決済は action ごとの確認トークンを必須にする。
- 注文変更で volume を変更する場合も、再度 symbol 仕様とリスク制限を検証する。

### 2.5 cTrader symbol/volume 仕様

symbolId と volume 仕様は backend が解決し、クライアント指定の symbolId を信用しない。

- cache key は `accountId + environment + symbol` とする。
- cache には symbolId、表示名、取引可否、volume min/max/step、lot/units 換算、pip value、tick size、最終取得時刻を持たせる。
- token 発行時と注文実行時の両方で仕様を検証する。
- cache が古い、または取得に失敗した場合は broker へ再取得を試みる。
- 再取得できない場合は fail closed として拒否する。

## 3. API contract

### 3.1 共通ヘッダー

実発注系 mutation は以下を必須にする。

| ヘッダー | 必須 | 用途 |
|---|---:|---|
| `Authorization` または認証 Cookie | yes | 認証ユーザー特定 |
| `X-Order-Confirmation-Token` | yes | ユーザーが最終確認した payload の証明 |
| `Idempotency-Key` | yes | 二重送信による二重発注防止 |

`Idempotency-Key` は userId、accountId、action、payload hash に scope する。同じ key と同じ payload の再送は前回結果を返し、異なる payload で同じ key が来た場合は拒否する。

### 3.2 確認トークン発行

Phase 2 で新設する実発注用エンドポイント:

`POST /api/trading/order-confirmations`

このエンドポイントは実発注を行わず、確認トークンと検証済み注文サマリーだけを返す。

**リクエスト**

```json
{
  "action": "CREATE",
  "order": {
    "symbol": "XAUUSD",
    "side": "BUY",
    "orderType": "MARKET",
    "volume": 0.01,
    "stopLoss": 2320.75,
    "takeProfit": 2350.25,
    "comment": "任意"
  }
}
```

**レスポンス**

```json
{
  "success": true,
  "data": {
    "confirmationToken": "opaque-token",
    "expiresAt": "2026-06-13T10:00:00.000Z",
    "payloadHash": "sha256:...",
    "account": {
      "environment": "live",
      "displayName": "cTrader Live"
    },
    "brokerSpec": {
      "symbol": "XAUUSD",
      "symbolId": 12345,
      "volumeMin": 0.01,
      "volumeMax": 1,
      "volumeStep": 0.01
    },
    "risk": {
      "estimatedLoss": 25.5,
      "currency": "USD",
      "maxAllowedLoss": 50
    },
    "warnings": [
      "live口座への実発注です"
    ]
  }
}
```

### 3.3 注文作成

`POST /api/trading/orders`

Phase 0 の停止ゲートを維持した上で、Phase 2 では以下をすべて満たす場合だけ実行する。

- `TRADING_ORDER_EXECUTION_ENABLED=true`
- 認証済みユーザーの cTrader token が有効
- `X-Order-Confirmation-Token` が未失効、未使用、対象 action と payload hash に一致
- `Idempotency-Key` が有効
- symbol/volume/risk/scope 検証が通過
- 監査ログの開始記録が成功

注文実行後は、成功、broker reject、timeout のいずれでも監査ログに最終状態を保存する。

### 3.4 注文変更、キャンセル、ポジション決済

以下も注文作成と同じ確認トークン、冪等性、監査ログを必須にする。

- `PUT /api/trading/orders/:id`
- `DELETE /api/trading/orders/:id`
- `POST /api/trading/positions/:id/close`

orderId/positionId は userId と accountId に紐づく broker 状態から確認する。クライアントが指定した ID が他ユーザー、別口座、別環境のものなら拒否する。

## 4. 失敗時ステータス

Phase 2 ではユーザー向けエラーと監査ログの `statusCode` を以下に揃える。

| code | HTTP | 意味 | ユーザー向け表示 |
|---|---:|---|---|
| `TRADING_ORDER_EXECUTION_DISABLED` | 403 | 実発注ゲートが OFF | 現在、実発注は無効です |
| `CONFIRMATION_REQUIRED` | 403 | 確認トークンなし | 最終確認をやり直してください |
| `CONFIRMATION_EXPIRED` | 409 | 確認トークン期限切れ | 確認の有効期限が切れました |
| `CONFIRMATION_PAYLOAD_MISMATCH` | 409 | 確認後に payload が変化 | 入力内容が変わったため再確認してください |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | 冪等性キーなし | 注文を再試行してください |
| `IDEMPOTENCY_PAYLOAD_MISMATCH` | 409 | 同じ key で別 payload | 注文内容が一致しません |
| `ACCOUNT_ENVIRONMENT_MISMATCH` | 409 | token と口座環境が不一致 | 口座状態を再読み込みしてください |
| `SYMBOL_SPEC_UNAVAILABLE` | 503 | symbol 仕様を取得できない | ブローカー仕様を確認できません |
| `SYMBOL_NOT_TRADABLE` | 422 | symbol が取引不可 | この銘柄は現在取引できません |
| `VOLUME_OUT_OF_RANGE` | 422 | volume が min/max 外 | ロット数が許容範囲外です |
| `VOLUME_STEP_MISMATCH` | 422 | volume step 不一致 | ロット数の刻みが不正です |
| `STOP_LOSS_REQUIRED` | 422 | live 発注で SL なし | live 発注には SL が必須です |
| `RISK_LIMIT_EXCEEDED` | 422 | 損失上限超過 | 設定された損失上限を超えています |
| `BROKER_PERMISSION_DENIED` | 403 | cTrader scope/権限不足 | ブローカー権限が不足しています |
| `BROKER_REJECTED` | 502 | broker が拒否 | ブローカーに拒否されました |
| `BROKER_TIMEOUT` | 504 | broker 応答 timeout | ブローカー応答がタイムアウトしました |
| `AUDIT_LOG_WRITE_FAILED` | 500 | 監査ログ保存不可 | 安全記録に失敗したため中止しました |

## 5. 監査ログ

Phase 2 では実発注系 mutation ごとに監査ログを残す。DB model の追加は Phase 2 または Phase 6 の migration で行う。

最低限必要な項目:

- `userId`
- `accountId`
- `environment`
- `action`
- `requestPayloadHash`
- `idempotencyKey`
- `confirmationTokenId`
- `symbol`
- `symbolId`
- `volume`
- `stopLoss`
- `takeProfit`
- `riskEstimate`
- `statusCode`
- `brokerRequestId`
- `brokerOrderId`
- `errorCode`
- `createdAt`
- `completedAt`

監査ログの開始記録に失敗した場合は、実発注を送信しない。

## 6. E2E シナリオ

Phase 2 実装時は Playwright で実クリック確認を行う。broker 実発注は mock または demo 専用環境で検証し、production live への本物の注文は E2E で実行しない。

| scenario | 期待結果 |
|---|---|
| feature flag OFF で注文パネルを開く | BUY/SELL が disabled、理由が表示される |
| feature flag OFF で `POST /api/trading/orders` を直叩き | `403 TRADING_ORDER_EXECUTION_DISABLED` |
| 最終確認なしで注文 API を送信 | `403 CONFIRMATION_REQUIRED` |
| 確認トークン期限切れ後に送信 | `409 CONFIRMATION_EXPIRED` |
| 確認後に volume を変更して送信 | `409 CONFIRMATION_PAYLOAD_MISMATCH` |
| 同じ `Idempotency-Key` を同じ payload で二重送信 | broker 送信は 1 回、2 回目は前回結果 |
| 同じ `Idempotency-Key` を別 payload で送信 | `409 IDEMPOTENCY_PAYLOAD_MISMATCH` |
| live 口座で SL なし | `422 STOP_LOSS_REQUIRED` |
| volume が symbol step と不一致 | `422 VOLUME_STEP_MISMATCH` |
| symbol 仕様取得失敗 | `503 SYMBOL_SPEC_UNAVAILABLE` |
| cTrader scope 不足 | `403 BROKER_PERMISSION_DENIED` |
| broker timeout | `504 BROKER_TIMEOUT` と再試行案内 |
| 注文成功 | 確認モーダル、結果表示、監査ログが一致 |

## 7. Phase 2 着手条件

Phase 2 を開始する前に、以下を満たす必要がある。

- この仕様が main にマージ済み。
- Phase 0 の停止ゲートが main にマージ済み。
- 実発注用 DB model と migration 方針をユーザーが承認済み。
- cTrader 実発注 scope と broker 側 permission の確認方法が確定済み。
- demo での broker smoke 手順が確定済み。
