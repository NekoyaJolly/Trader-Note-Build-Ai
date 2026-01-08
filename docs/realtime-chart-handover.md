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
|----------|------|
| `src/backend/services/realtime/realtimeTickService.ts` | Tick 永続化、OHLCV 変換 |
| `src/backend/services/realtime/ctraderRealtimeOrchestrator.ts` | cTrader WebSocket 接続管理 |
| `src/backend/api/realtimeRoutes.ts` | SSE エンドポイント |

### 3. フロントエンド実装
| ファイル | 機能 |
|----------|------|
| `src/frontend/hooks/useRealtimeChart.ts` | SSE 接続、リアルタイムデータ管理 |
| `src/frontend/components/RealtimeChart.tsx` | リアルタイムチャート UI |
| `src/frontend/app/market-analysis/page.tsx` | リアルタイム/分析モード切替 |

### 4. 時間足選択機能
- 5秒 / 10秒 / 30秒 / 1分 / 5分 から選択可能
- 時間足ごとに独立したオーケストレーター/サービスインスタンス

### 5. cTrader 認証
- OAuth 認証フロー完了
- トークンは DB に保存済み

---

## 現在の問題点

### 問題 1: SSE 接続エラー
- **症状**: UI で「SSE 接続エラー」と表示される
- **原因**: EventSource は CORS に制限がある
- **試した対策**: fetch ベースの SSE 実装に変更 → 接続自体ができなくなった → revert 済み
- **現在の状態**: `c5f6e71` の状態に戻した

### 問題 2: チャートにローソク足が表示されない
- **症状**: Tick 数はカウントされるが、チャートにローソク足が1本も表示されない
- **原因**: 
  - 価格データが `O=0.00 H=0.00 L=0.00 C=0.00` になっている
  - cTrader からの価格変換が間違っている可能性

### 問題 3: 価格が異常な値
- **症状**: 価格帯が 0.07〜-0.06 のような意味不明な値
- **原因**: cTrader API の価格形式（pipettes）の変換が不正確
- **試した対策**: 
  - `÷100000` で変換 → 0.00 になる
  - `÷100`（XAUUSD 用）で変換 → 効果なし
  - 変換なしでそのまま使用 → 未確認

### 問題 4: 時間軸が正しくない
- **症状**: チャートの横軸が意図した時間足と異なる
- **原因**: 未調査

---

## データフロー（設計）

```
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
|---------|------|------|
| `GET` | `/api/realtime/status` | 接続状態取得 |
| `POST` | `/api/realtime/connect?timeframe=10` | cTrader 接続 |
| `POST` | `/api/realtime/disconnect` | 切断 |
| `POST` | `/api/realtime/subscribe` | シンボル購読 |
| `GET` | `/api/realtime/bars/:symbol` | 最新バー取得 |
| `GET` | `/api/realtime/stream/:symbol?timeframe=10` | SSE ストリーム |

---

## 次回作業（優先順）

### 1. SSE 接続エラーの解決
EventSource の CORS 問題を解決する。選択肢：
- **A**: バックエンドで CORS ヘッダーを正しく設定
- **B**: `event-source-polyfill` ライブラリを使用
- **C**: WebSocket に変更（Socket.IO など）

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

```
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

```
02f7dcc revert: realtimeRoutes.ts も元に戻す
c5068c0 revert: EventSource ベースの SSE 接続に戻す
d8a202c fix: cTrader の価格をそのまま使用（変換なし）
8ef76ac fix: SSE 接続を fetch ベースに変更 ← 問題のコミット
5e57f3e fix: cTrader Tick 価格変換を修正
c5f6e71 fix: リアルタイムチャートの修正 ← 安定版
0819e47 feat: cTrader リアルタイムチャート機能を実装
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

---

最終更新: 2026/01/09

