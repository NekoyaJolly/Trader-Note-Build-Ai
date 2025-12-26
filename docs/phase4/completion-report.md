## Phase4 完了レポート：通知ロジック実装

**日時**: 2025-12-27  
**ステータス**: ✅ COMPLETED  

---

## 1. 目的達成度

### 設定目標
Phase3 で確定した判定結果を、ユーザー体験を壊さずに通知へ変換する

### 達成状況
✅ **完全達成**

---

## 2. 成果物

### 2.1 スキーマ変更（Prisma）

#### 新しい列挙型
```prisma
enum NotificationLogStatus {
  sent      // 通知を配信した
  skipped   // 再通知防止またはその他理由でスキップ
  failed    // 配信に失敗した
}
```

#### 新しいテーブル
```prisma
model NotificationLog {
  id               UUID
  noteId           UUID     // トレードノート ID
  marketSnapshotId UUID     // マーケットスナップショット ID
  symbol           String   // シンボル（検索用インデックス）
  score            Float    // MatchResult スコア
  channel          String   // in_app | push | webhook
  status           Enum     // sent | skipped | failed
  reasonSummary    String   // 通知理由の要約（短文）
  sentAt           DateTime // 配信時刻（UTC）
  createdAt        DateTime // 作成時刻（UTC）
  
  // リレーション
  note             TradeNote
  marketSnapshot   MarketSnapshot
  
  // ユニーク制約: 冪等性保証
  @@unique([noteId, marketSnapshotId, channel])
}
```

### 2.2 Repository 実装

#### NotificationLogRepository
**ファイル**: [src/backend/repositories/notificationLogRepository.ts](../src/backend/repositories/notificationLogRepository.ts)

**主要メソッド**:
- `upsertLog()`: 通知ログを記録
- `isDuplicate()`: 冪等性チェック
- `checkCooldown()`: クールダウンチェック
- `hasRecentDuplicate()`: 重複抑制チェック
- `getLogsByNoteId()`: ノート別ログ取得
- `getLogsBySymbol()`: シンボル別ログ取得
- `getLogsByStatus()`: ステータス別ログ取得

### 2.3 通知インターフェース・実装

#### NotificationSender インターフェース
**ファイル**: [src/services/notification/notificationSender.ts](../src/services/notification/notificationSender.ts)

```typescript
interface NotificationSender {
  sendInApp(payload: NotificationPayload): Promise<{ success: boolean; id?: string }>;
  sendPush(payload: NotificationPayload): Promise<{ success: boolean; id?: string }>;
  sendWebhook(payload: NotificationPayload): Promise<{ success: boolean; id?: string }>;
}
```

#### InAppNotificationSender 実装
**ファイル**: [src/services/notification/inAppNotificationSender.ts](../src/services/notification/inAppNotificationSender.ts)

- Notification テーブルへの記録実装
- Push・Webhook はスタブ（Phase5 以降で統合）

### 2.4 通知トリガロジック

#### NotificationTriggerService
**ファイル**: [src/services/notification/notificationTriggerService.ts](../src/services/notification/notificationTriggerService.ts)

**責務**: Phase3 の MatchResult を受け取り、以下を順序で判定

1. **スコア閾値チェック**
   - 閾値: 0.75（環境変数 `NOTIFY_THRESHOLD`）
   - スコア >= 閾値 → 次へ
   - スコア < 閾値 → スキップ

2. **理由数チェック**
   - 最小理由数: 1
   - 理由あり → 次へ
   - 理由なし → スキップ

3. **冪等性チェック**
   - noteId × marketSnapshotId × channel の組み合わせが一意か確認
   - 初回 → 次へ
   - 既に通知済み → スキップ

4. **クールダウンチェック**
   - クールダウン期間: 1 時間（環境変数 `NOTIFY_COOLDOWN_MS`）
   - クールダウン満了 → 次へ
   - クールダウン中 → スキップ

5. **重複抑制チェック**
   - 直近 5 秒以内の同一条件通知を検査
   - 重複なし → 配信へ
   - 重複あり → スキップ

6. **配信・ログ記録**
   - In-App 通知を送信
   - NotificationLog に記録
   - 結果を返却

### 2.5 コントローラー統合

#### NotificationController 更新
**ファイル**: [src/controllers/notificationController.ts](../src/controllers/notificationController.ts)

**既存エンドポイント（Phase0-Phase3）**:
- GET /api/notifications
- PUT /api/notifications/:id/read
- PUT /api/notifications/read-all
- DELETE /api/notifications/:id
- DELETE /api/notifications

**新規エンドポイント（Phase4）**:
- POST /api/notifications/check
- GET /api/notifications/logs
- GET /api/notifications/logs/:id
- DELETE /api/notifications/logs/:id

#### NotificationRoutes 更新
**ファイル**: [src/routes/notificationRoutes.ts](../src/routes/notificationRoutes.ts)

新規 route を追加

---

## 3. テスト実装

### 3.1 NotificationTriggerService テスト
**ファイル**: [src/backend/tests/notificationTriggerService.test.ts](../src/backend/tests/notificationTriggerService.test.ts)

**テストケース** (13 個、すべてパス ✅):

1. ✅ スコア未満 → 通知されない
2. ✅ スコアが 0 → 通知されない
3. ✅ 初回一致 → 通知される（スコア >= 閾値）
4. ✅ 高スコア → 通知される
5. ✅ 同一条件再評価 → 通知されない（冪等性）
6. ✅ クールダウン中 → 通知されない
7. ✅ 通知が配信された場合 → ログが記録される
8. ✅ 理由がない → 通知されない
9. ✅ 理由がある → 通知される
10. ✅ 異なるチャネルでは冪等性が独立
11. ✅ 短い時間差での重複を抑制
12. ✅ スコアが閾値と等しい場合 → 通知される
13. ✅ 複数理由の場合、最初の 3 つを要約に含める

### 3.2 NotificationLogRepository テスト
**ファイル**: [src/backend/tests/notificationLogRepository.test.ts](../src/backend/tests/notificationLogRepository.test.ts)

テストの枠組みを実装（実装詳細は Integration Test として実施予定）

---

## 4. ドキュメント更新

### 4.1 API ドキュメント
[docs/API.md](../docs/API.md) に以下を追加:
- POST /api/notifications/check
- GET /api/notifications/logs
- GET /api/notifications/logs/:id
- DELETE /api/notifications/logs/:id

### 4.2 マッチングアルゴリズムドキュメント
[docs/MATCHING_ALGORITHM.md](../docs/MATCHING_ALGORITHM.md) に Phase4 セクションを追加:
- 通知トリガ条件の詳細
- NotificationLog テーブル設計
- 通知配信実装方針
- 設計原則（「うるさくない通知」）

---

## 5. 設計の特徴

### 5.1 冪等性の保証
```
noteId × marketSnapshotId × channel
```
この組み合わせで UNIQUE 制約を設定し、同じ条件の再通知を完全に防止

### 5.2 クールダウン機構
- 同一 noteId について一定時間内の再通知を防止
- デフォルト: 1 時間（環境変数で変更可）
- クールダウン履歴から最後の sent を取得して判定

### 5.3 重複抑制
- evaluatedAt が近い（5 秒以内）ログを検査
- 判定ロジックの再実行による重複を防止

### 5.4 スキップ理由の記録
- 各判定段階でスキップ理由を記録
- ユーザーが通知の判定プロセスを理解可能に

### 5.5 チャネルの抽象化
- NotificationSender インターフェースで複数チャネルに対応
- Phase4: In-App のみ実装
- Phase5: Push・Webhook を追加予定

---

## 6. 環境変数

`.env` に以下を設定可能:

```dotenv
# 通知トリガの閾値
NOTIFY_THRESHOLD=0.75

# クールダウン期間（ミリ秒）
NOTIFY_COOLDOWN_MS=3600000
```

---

## 7. 完了条件の確認

| 条件 | 状態 | 備考 |
|------|------|------|
| 通知トリガが正しく動作 | ✅ | テスト 13 個パス |
| 再通知事故が起きない | ✅ | 冪等性・クールダウン・重複抑制 |
| ログが DB に保存される | ✅ | NotificationLog 実装 |
| テスト PASS | ✅ | 全 13 テストケース成功 |

---

## 8. 次フェーズへの引き継ぎ（Phase5）

### 推奨される作業
1. **Push 通知の統合**
   - Firebase Cloud Messaging（FCM）または APNs
   - InAppNotificationSender.sendPush() を実装

2. **Webhook 統合**
   - Slack / Teams / Discord ボット連携
   - InAppNotificationSender.sendWebhook() を実装

3. **UI 実装**
   - 通知表示画面（In-App）
   - 通知ログ閲覧画面
   - ユーザーの通知設定画面

4. **Integration Tests**
   - データベースを使用した e2e テスト
   - 複数チャネルの並行テスト

---

## 9. 設計原則（重要）

> **当たる通知より、うるさくない通知。**

Phase4 の成功は「**通知しない判断が正しい**」ことを最優先とする。ユーザーが重複や過度な通知で煩わされることを完全に防ぐことが重要。

---

## まとめ

Phase4 は、Phase3 の判定結果を安全に通知へ変換するロジックを実装した。再通知防止（冪等性・クールダウン・重複抑制）と配信ログの永続化により、運用可能で再現可能な通知システムを実現した。

すべての完了条件を達成し、テストも全数成功。Phase5 での UI・外部統合に向けて準備完了。
