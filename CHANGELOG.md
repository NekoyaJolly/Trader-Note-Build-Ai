# 変更ログ

All notable changes to TradeAssist MVP will be documented in this file.

## [1.0.0-phase14-ui] - 2025-01-XX

### 変更 - レイアウト大改修（サイドバー・ヘッダー統合）

#### 目的
> **サイドバーの区切り線とヘッダーのY軸ズレを解消し、よりクリーンで統一されたUIを実現**

#### ヘッダー改修 (Header.tsx)
- ハンバーガーメニュー（≡）ボタンを左端に追加
- アプリタイトル「TradeAssist」をハンバーガーの隣に配置
- 通知ベル（+バッジ）を右端に固定
- レイアウト: `[≡] [TradeAssist] ... [🔔]`

#### サイドバー改修 (Sidebar.tsx)
- **オーバーレイ式に変更**: 常時表示 → 必要時のみ展開
- サイドバーの border-r を削除（区切り線問題解消）
- `isOpen` / `onClose` プロップスに変更
- オーバーレイ背景（`bg-black/50`）でクリック時に閉じる
- ナビゲーション選択時に自動で閉じる機能
- 閉じる×ボタンをサイドバー内に追加

#### AppShell改修 (AppShell.tsx)
- サイドバー状態管理を `isSidebarOpen` に統一
- Header コンポーネントを内部で呼び出し
- メインコンテンツの左マージン（`ml-16`/`ml-64`）を削除
- ハイドレーションエラー対策のプレースホルダー追加

#### レイアウト改修 (layout.tsx)
- Header の直接呼び出しを削除（AppShell経由に統一）
- メインコンテンツのパディング調整

#### UI改善効果
- ✅ ヘッダーとコンテンツの区切り線が一直線に
- ✅ サイドバーの枠線が消え、すっきりしたデザイン
- ✅ モバイル・デスクトップで統一された操作性
- ✅ 通知ベルが常にアクセス可能

---

## [1.0.0-phase2] - 2025-12-31

### 追加 - Phase2: ノート承認フロー

#### 目的
> **AI生成は必ず揺れる。ユーザーが承認・編集・非承認を行える「後戻りできる」導線を確実にする。**

#### データモデル拡張
- **NoteStatus 型定義**: draft / approved / rejected の3ステータス
- **TradeNote 拡張**:
  - `rejectedAt`: 非承認日時
  - `lastEditedAt`: 最終編集日時
  - `userNotes`: ユーザーによる追記メモ
  - `tags`: タグ配列

#### 新規 API エンドポイント
- `GET /api/trades/notes?status=`: ステータスでフィルタ可能なノート一覧
- `GET /api/trades/notes/status-counts`: ステータス別件数（ダッシュボード用）
- `PUT /api/trades/notes/:id`: ノート内容の更新（AI要約/ユーザーメモ/タグ）
- `POST /api/trades/notes/:id/reject`: ノートを非承認にする
- `POST /api/trades/notes/:id/revert-to-draft`: 下書きに戻す

#### サービス拡張
- **TradeNoteService**:
  - `approveNote()`: ノート承認
  - `rejectNote()`: ノート非承認
  - `revertToDraft()`: 下書きに戻す
  - `updateNote()`: 内容更新
  - `loadApprovedNotes()`: 承認済みノートのみ取得
  - `loadNotesByStatus()`: ステータス別取得
  - `getStatusCounts()`: ステータス集計

#### マッチング制御
- **MatchingService**: `checkForMatches()` が承認済み（approved）ノートのみを照合対象に
- draft / rejected ノートはマッチング対象外

#### UI 実装
- **ノート詳細ページ**:
  - ステータスバッジ表示（draft: 黄色, approved: 緑, rejected: 赤）
  - 承認/非承認/下書きに戻すボタン（ステータスに応じて動的表示）
  - 編集モード（AI要約/ユーザーメモ/タグ編集）
  - 状態遷移のタイムスタンプ表示
- **ノート一覧ページ**:
  - ステータスフィルタタブ（全件/下書き/承認済み/非承認）
  - 各タブに件数表示
  - 方向（買い/売り）列追加

#### テスト
- **noteApprovalFlow.test.ts**: 16 個のテストケース（全成功）
  - 承認フロー（draft→approved, rejected→approved）
  - 非承認フロー（draft→rejected, approved→rejected）
  - 下書き戻し（approved→draft, rejected→draft）
  - 内容更新（AI要約/ユーザーメモ/タグ）
  - ステータス別取得
  - ステータス集計
  - 承認済みフィルタリング

#### ドキュメント
- API.md に Phase2 エンドポイント追加
- implementation-matrix.md にセクション 7 追加

### Done 条件
✅ **承認済みノートのみがマッチング照合に使われる**

---

## [1.0.0-phase4] - 2025-12-27

### 追加 - Phase4: 通知ロジック実装

#### 通知トリガロジック
- **NotificationTriggerService**: MatchResult を評価し、通知を配信するサービス
- **スコア閾値チェック**: 最小スコア 0.75 以上のみ通知
- **再通知防止機構**:
  - **冪等性保証**: noteId × marketSnapshotId × channel で一意性
  - **クールダウン**: 同一 noteId について 1 時間内の再通知を防止
  - **重複抑制**: 直近 5 秒以内の同一条件通知を検査

#### 通知配信抽象化
- **NotificationSender インターフェース**: 複数チャネル対応
- **InAppNotificationSender**: In-App 通知実装（Notification テーブルに記録）
- **Push・Webhook**: スタブ実装（Phase5 で統合予定）

#### データベース変更
- **新規テーブル: NotificationLog**
  - 通知配信ログの永続化
  - スキップ理由の記録
  - channel 別の冪等性管理
  - インデックス: symbol, noteId ごとの高速検索

#### 新規 API エンドポイント
- `POST /api/notifications/check`: 通知を評価・配信
- `GET /api/notifications/logs`: 通知ログを取得
- `GET /api/notifications/logs/:id`: 通知ログを ID で取得
- `DELETE /api/notifications/logs/:id`: 通知ログを削除

#### テスト
- **NotificationTriggerService**: 13 個のテストケース（全成功）
  - スコア未満でスキップ
  - 初回一致で通知
  - 冪等性による再通知防止
  - クールダウン中でスキップ
  - ログ記録確認
  - エッジケース検証

#### ドキュメント
- API.md に Phase4 エンドポイント記載
- MATCHING_ALGORITHM.md に通知ロジック説明を追加
- Phase4 completion-report.md を新規作成

### 設計原則
> **当たる通知より、うるさくない通知。**

ユーザーが重複通知で煩わされることを完全に防ぐ。再通知防止を最優先。

---

## [1.0.0] - 2025-12-21

### 追加 - 初期 MVP リリース

#### コア機能
- **トレード インポート システム**
  - CSV ファイル インポート機能
  - トレード データ検証とパース
  - 取引所 API 統合のプレースホルダー

- **Trade Note Generation**
  - Automatic structured note creation from trades
  - Market context capture (timeframe, trend, indicators)
  - Feature vector extraction for matching
  - Persistent JSON storage

- **AI Summary Service**
  - Token-efficient AI summary generation
  - Fallback to basic summaries when AI unavailable
  - Configurable AI model support

- **Market Data Service**
  - Real-time market data fetching (simulated)
  - Support for 15m and 1h timeframes
  - Technical indicator calculation (RSI, MACD)
  - Trend determination

- **Matching System**
  - Cosine similarity-based feature matching
  - Rule-based trend and price range checks
  - Configurable match threshold
  - Weighted scoring algorithm

- **Notification System**
  - In-app notification storage
  - Push notification framework (ready for integration)
  - Notification read/unread status
  - Notification history management

- **Order Support UI**
  - Order preset generation from matched notes
  - Order confirmation with cost estimates
  - Safety warnings and user confirmation workflow
  - No automatic trade execution

- **Scheduler**
  - Periodic matching checks (configurable interval)
  - Automatic notification on matches
  - Graceful start/stop

#### API Endpoints
- `GET /health` - Health check
- `POST /api/trades/import/csv` - Import trades from CSV
- `POST /api/trades/import/api` - Import from API (placeholder)
- `GET /api/trades/notes` - Get all notes
- `GET /api/trades/notes/:id` - Get specific note
- `POST /api/matching/check` - Manual match check
- `GET /api/matching/history` - Match history
- `GET /api/notifications` - Get notifications
- `PUT /api/notifications/:id/read` - Mark as read
- `PUT /api/notifications/read-all` - Mark all as read
- `DELETE /api/notifications/:id` - Delete notification
- `DELETE /api/notifications` - Clear all
- `GET /api/orders/preset/:noteId` - Generate order preset
- `POST /api/orders/confirmation` - Get order confirmation

#### Documentation
- Comprehensive README with feature overview
- API documentation (docs/API.md)
- User guide (docs/USER_GUIDE.md)
- Sample trade CSV data
- Environment configuration examples

#### Infrastructure
- TypeScript implementation
- Express.js REST API
- File-based data storage (JSON)
- Environment-based configuration
- Development and production build scripts

### Design Decisions
- **No Auto-Trading**: System provides judgment support only
- **Low Frequency Focus**: 15m/1h timeframes for stability
- **Threshold-Based**: Only high-confidence matches notify users
- **Token Efficiency**: Minimal AI API usage to reduce costs
- **Accountability**: All notes include context and reasoning

### Known Limitations
- Market data is currently simulated (requires real API integration)
- AI summaries use placeholder implementation (requires OpenAI key)
- Push notifications framework ready but not connected to service
- Exchange API import is placeholder only
- No database (uses file storage)
- No authentication/authorization
- No rate limiting

### Future Roadmap
- Real market data API integration
- Full OpenAI integration for summaries
- Push notification service integration (FCM, APNs)
- Exchange API connections (Binance, Coinbase, etc.)
- Database backend (PostgreSQL, MongoDB)
- User authentication and authorization
- WebSocket support for real-time updates
- Advanced technical analysis indicators
- Backtesting capabilities
- Portfolio management
- Risk management tools
