# リアルタイムチャート機能 - 引き継ぎドキュメント

## 作業概要

cTrader WebSocket から Tick データを受信し、リアルタイムでローソク足チャートを表示する機能の実装。

---

## 完了した作業

### 1. DB モデル追加

- `TickData` テーブル: Tick データ永続化用
- `RealtimeOHLCV` テーブル: 確定バー永続化用
- マイグレーション適用済み

### 2. バックエンドサービス実装

| ファイル | 機能 |
| -------- | ---- |
| `src/backend/services/realtime/realtimeTickService.ts` | Tick 永続化、OHLCV 変換 |
| `src/backend/services/realtime/ctraderRealtimeOrchestrator.ts` | cTrader WebSocket 接続管理 |
| `src/backend/api/realtimeRoutes.ts` | SSE エンドポイント |

### 3. フロントエンド実装

| ファイル | 機能 |
| -------- | ---- |
| `src/frontend/hooks/useRealtimeChart.ts` | SSE 接続、リアルタイムデータ管理 |
| `src/frontend/components/RealtimeChart.tsx` | リアルタイムチャート UI |
| `src/frontend/app/market-analysis/page.tsx` | リアルタイム/分析モード切替 |

### 4. 時間足選択機能

- 5秒 / 10秒 / 30秒 / 1分 / 5分 から選択可能
- 時間足ごとに独立したオーケストレーター/サービスインスタンス

### 5. cTrader 認証

- OAuth 認証フロー完了
- トークンは DB に保存済み

### 6. SSE CORS 問題の修正（2026/01/09）

- **修正内容**:
  - バックエンド: `realtimeRoutes.ts` の SSE エンドポイントに CORS ヘッダーを明示的に追加
  - フロントエンド: `event-source-polyfill` を導入し、`withCredentials` 対応
- **修正ファイル**:
  - `src/backend/api/realtimeRoutes.ts`
  - `src/frontend/hooks/useRealtimeChart.ts`
  - `src/frontend/package.json`（`event-source-polyfill` 追加）

---

## 解決済みの問題

### ~~問題 1: SSE 接続エラー~~（解決済み）

- **症状**: UI で「SSE 接続エラー」と表示される
- **原因**: EventSource は CORS に制限がある
- **解決策**: 
  - `event-source-polyfill` を使用して `withCredentials` 対応
  - SSE エンドポイントに CORS ヘッダーを明示的に追加

### ~~問題 2: チャートにローソク足が表示されない~~（解決済み）

- **症状**: Tick 数はカウントされるが、チャートにローソク足が1本も表示されない
- **原因**: cTrader API が返す価格が pipettes（整数）形式で、変換されていなかった
- **解決策**: シンボルの `digits` 情報を取得し、`price / 10^digits` で正しく変換

### ~~問題 3: 価格が異常な値~~（解決済み）

- **症状**: 価格帯が 0.07〜-0.06 のような意味不明な値
- **原因**: cTrader API は価格を pipettes（整数）で返す。例: XAUUSD (digits=2) では 262350 → 2623.50
- **解決策**: 
  - `subscribe()` 時にシンボルの `digits` 情報をキャッシュ
  - Tick 受信時に `symbolId` からシンボル情報を取得し、`10^digits` で除算

### ~~問題 4: 時間軸が正しくない~~（解決済み）

- **症状**: チャートの横軸が意図した時間足と異なる
- **原因**: lightweight-charts の `secondsVisible: false` 設定
- **解決策**: `secondsVisible: true` に変更（秒足チャートのため）

---

## 修正内容（2026/01/09）

### 価格変換の修正

`ctraderRealtimeOrchestrator.ts`:

- シンボル情報のキャッシュ機能を追加（`symbolInfoCache`, `symbolNameToId`）
- `subscribe()` でシンボルの `digits` と `pipPosition` を取得・保存
- Tick 受信時に `symbolId` からシンボル情報を逆引きし、正しく価格変換

```typescript
// pipettes から実際の価格に変換
const divisor = Math.pow(10, digits);
const bid = rawBid / divisor;
```

### チャート表示の修正

`CandlestickChart.tsx`:

- `secondsVisible: true` に変更（秒足表示対応）

---

## データフロー（設計）

```text
cTrader WebSocket (live.ctraderapi.com:5035)
       ↓
ProtoOASpotEvent で Tick 受信
       ↓
ctraderRealtimeOrchestrator.ts で変換
       ↓
realtimeTickService.ts で処理
  - TickData テーブルに永続化（バッチ）
  - RollingWindow で OHLCV 集約
  - RealtimeOHLCV テーブルに永続化
  - EventEmitter で 'bar' イベント発火
       ↓
realtimeRoutes.ts の SSE エンドポイント
       ↓
useRealtimeChart.ts で受信
       ↓
RealtimeChart.tsx → CandlestickChart.tsx で表示
```

---

## API エンドポイント

| メソッド | パス | 機能 |
| ------- | ---- | ---- |
| `GET` | `/api/realtime/status` | 接続状態取得 |
| `POST` | `/api/realtime/connect?timeframe=10` | cTrader 接続 |
| `POST` | `/api/realtime/disconnect` | 切断 |
| `POST` | `/api/realtime/subscribe` | シンボル購読 |
| `GET` | `/api/realtime/bars/:symbol` | 最新バー取得 |
| `GET` | `/api/realtime/stream/:symbol?timeframe=10` | SSE ストリーム |

---

## 次回作業（優先順）

### ~~1. SSE 接続エラーの解決~~（完了）

`event-source-polyfill` ライブラリを使用し、バックエンドで CORS ヘッダーを正しく設定することで解決。

### 2. cTrader 価格データの確認

Railway のログで実際の Tick データを確認：

```bash
railway logs --tail 100 | grep "Tick:"
```

- `event.bid` / `event.ask` の実際の値を確認
- cTrader Layer ライブラリが変換済みかどうか確認

### 3. 価格変換の修正

`src/backend/services/realtime/ctraderRealtimeOrchestrator.ts` の `setupEventHandlers` 関数：

- 現在は変換なしでそのまま使用
- 必要に応じてシンボルごとの変換係数を適用

### 4. チャート表示の確認

- `CandlestickChart.tsx` は lightweight-charts（TradingView 製）を使用
- データ形式: `{ timestamp: number, open, high, low, close, volume }`
- `timestamp` は Unix timestamp（ミリ秒）

---

## 関連ファイル一覧

```text
prisma/schema.prisma                    # TickData, RealtimeOHLCV モデル
src/backend/api/realtimeRoutes.ts       # SSE エンドポイント
src/backend/services/realtime/
  ├── realtimeTickService.ts            # Tick 処理、OHLCV 変換
  └── ctraderRealtimeOrchestrator.ts    # cTrader WebSocket 接続
src/frontend/
  ├── hooks/useRealtimeChart.ts         # SSE 接続フック
  ├── components/RealtimeChart.tsx      # リアルタイムチャート UI
  ├── components/CandlestickChart.tsx   # ローソク足チャート（lightweight-charts）
  └── app/market-analysis/page.tsx      # マーケット分析ページ
```

---

## コミット履歴（関連）

```text
02f7dcc revert: realtimeRoutes.ts も元に戻す
c5068c0 revert: EventSource ベースの SSE 接続に戻す
d8a202c fix: cTrader の価格をそのまま使用（変換なし）
8ef76ac fix: SSE 接続を fetch ベースに変更 ← 問題のコミット
5e57f3e fix: cTrader Tick 価格変換を修正
c5f6e71 fix: リアルタイムチャートの修正 ← 安定版
0819e47 feat: cTrader リアルタイムチャート機能を実装
XXXXXX  fix: SSE CORS 問題を event-source-polyfill で解決 ← 最新
```

---

## 確認コマンド

```bash
# Railway ログ確認
railway logs --tail 100 | grep -iE "Tick|バー|SSE|cTrader"

# TypeScript コンパイル確認
npx tsc --noEmit

# ローカル開発サーバー起動
npm run dev
```

---

## 備考

- cTrader 認証は完了済み（アカウント: `ctrader_1767880886914`）
- チャートライブラリは `lightweight-charts`（TradingView 製、~45KB）
- 現在のデフォルト時間足は 10 秒
- SSE 接続には `event-source-polyfill` を使用（CORS 対応）

---

最終更新: 2026/01/09

