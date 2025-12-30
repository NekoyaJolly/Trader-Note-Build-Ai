# カバレッジ・整合性レビュー（2025-12-30）

## 1. サマリー（重要度別件数）
- Critical: 0
- High: 2
- Medium: 2
- Low: 1

## 2. 変更点（implementation-matrix 更新概要）
- 環境変数行を ✅（DATABASE_URL/NOTIFY_THRESHOLD へ統一済み）に更新。
- トレード取込行を ⚠️/❌/⚠️ に変更（import/csv はノート未生成、upload-text に依存）。
- UI 行の Doc を ⚠️ に変更（README の API メソッド誤記を明示）。
- インジケーター行を ❌/❌ に変更（RSI/SMA 計算未実装）。

## 3. 検出事項一覧（重要度順）

### High-1: CSV 取込 API が仕様より縮退（ノート未生成）
- 事実: import/csv エンドポイントは DB 取込のみで `notesGenerated: 0` を固定返却し、ノート生成は upload-text 経由のみ ([src/controllers/tradeController.ts#L20-L47](src/controllers/tradeController.ts#L20-L47))。API.md/README は import/csv でノート生成まで行う例を掲載。
- 影響: ドキュメント通りに import/csv を叩くとノートができず、後続マッチング・通知に進めない。E2E 想定が破綻。
- 推奨修正: 1) import/csv でもノート生成を行う、または 2) ドキュメントを「ノート生成は /import/upload-text を使用」と明記し、返却値を合わせる。後者の場合でも失敗系テストを追加。

### High-2: 通知トリガ API がログ/クールダウンを実装していない
- 事実: `/api/notifications/check` は MatchingService で生成したマッチを即座にファイル通知へ書き出すだけで、NotificationLog 永続化やクールダウン判定を実行していない ([src/controllers/notificationController.ts#L159-L176](src/controllers/notificationController.ts#L159-L176), [src/services/notification/notificationTriggerService.ts#L14-L33](src/services/notification/notificationTriggerService.ts#L14-L33)). NOTIFY_THRESHOLD 判定のみで skipReason 以外の Runbook 要件を満たさない。
- 影響: 冪等性・再通知防止・履歴参照が不可能。Phase4 要件（ログ取得・重複抑制）が未達で、本番通知設計と乖離。
- 推奨修正: MatchResult/NotificationLog を Prisma 保存し、クールダウン・重複チェックを実装。Doc も実装に合わせて skipReason/ログ構造を更新。

### Medium-1: マッチ履歴 API が通知ファイルを代用
- 事実: `/api/matching/history` は DB の MatchResult ではなくファイル通知から type=match を抽出して返すのみ ([src/controllers/matchingController.ts#L59-L67](src/controllers/matchingController.ts#L59-L67))。
- 影響: 過去マッチが通知されていない場合は履歴が空になる。履歴粒度（閾値・理由・スナップショットID）も欠落し、Doc の想定と異なる。
- 推奨修正: MatchResult 永続化を前提に履歴を提供するか、現状の挙動を API ドキュメントに明記し「通知済みのみを返す暫定仕様」とする。

### Medium-2: RSI/SMA 定義と実装が乖離（定数埋め込みのみ）
- 事実: MarketDataService の calculateIndicators は RSI=50, MACD=0 を固定設定し、SMA/傾き等は未計算 ([src/services/marketDataService.ts#L171-L186](src/services/marketDataService.ts#L171-L186)). RSI/SMA 定義書の Layer2/3 特徴量は生成されていない。
- 影響: インジケーター依存のマッチング理由が常に中立扱いとなり、定義書にある過熱判定や乖離判定が利用できない。マッチング精度低下。
- 推奨修正: RSI/SMA の計算実装（期間・閾値バリデーションを含む）を追加し、TradeNote/MarketSnapshot に特徴量を保存。少なくともテスト用スタブ値で Layer2/3 を生成する。

### Low-1: フロント README の API メソッド誤記
- 事実: フロント README は 通知既読/全既読を POST と記載しているが、実装は PUT ([src/frontend/README.md#L84-L88](src/frontend/README.md#L84-L88), [src/routes/notificationRoutes.ts#L16-L44](src/routes/notificationRoutes.ts#L16-L44))。
- 影響: 手動操作や新規開発者の理解を誤らせ、API コール実装ミスを誘発。
- 推奨修正: README のメソッドを PUT に修正し、ヘルスチェックのベースパスなど最新の API 一覧を再確認して追記。

## 4. 代表的な矛盾
- import/csv はノートを返さない一方で Docs はノート生成を約束。
- 通知トリガはログ/クールダウンなしの簡易実装だが Runbook は詳細条件を要求。
- マッチ履歴は通知ファイル依存で、Doc 想定の MatchResult 履歴と整合しない。
- フロント README の API メソッドとバックエンド実装が食い違う。

## 5. 次アクション
1. 通知トリガの保存戦略（MatchResult/NotificationLog）を決め、API 実装と Doc を同期。
2. import/csv の挙動を仕様と揃えるか仕様を修正し、E2E テストを追加。
3. RSI/SMA の簡易実装またはスタブ生成を追加し、Layer2/3 特徴量をマッチングで利用可能にする。
4. フロント README の API メソッドを更新し、UI/API 整合チェック用のスモークテストを追加。
