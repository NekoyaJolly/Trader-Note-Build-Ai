# Side-A ゴールデンパス（正規ルート）

> **責務**: Side-A の最重要フロー「CSV インポート → Draft ノート生成 → 承認(active) → マッチング → Notification 作成」の正規ルートと、その動作確認(smoke)手順を 1 か所に固定する。
> **位置づけ**: 恒久ドキュメント。運用・新規エージェントが「本番でどの経路が動くか」を判断する単一の参照先。
> **作成**: 2026-06-09 (P0 `fix(side-a): normalize golden path and import profile contract`)

---

## 1. ゴールデンパス全体像

```
[ユーザー] CSV アップロード (/import)
      │  POST /api/trades/import/upload-text  (requireAuth)
      ▼
[backend] tradeController.uploadCSVText
      │  CSV 取り込み → トレード保存 → Draft ノート生成 (profileId 適用)
      │  + Note コア行生成 (lensSnapshot をトレード時刻起点で生成。Phase α-2、失敗しても取込継続)
      ▼
[ユーザー] ノート確認 → 承認 (/notes/:id)
      │  POST /api/trades/notes/:id/approve   → status: draft → active
      ▼
[Cloud Scheduler] 15 分間隔 (deploy.yml が作成)
      │  GET /api/cron/matching-pipeline  (Bearer CRON_SECRET)
      ▼
[backend] MatchingService.runMatchingPipeline()
      │  1. 市場開場チェック (休場ならスキップ)
      │  2. checkForAllMatches() … active かつ enabled・停止期間外のノートを現在市場と照合
      │  3. SimultaneousHitControlService … 同時ヒット制御で通知対象を絞る
      │  4. NotificationTriggerService.evaluateWithPersistence()
      │       … スコア閾値 / 冪等性 / 重複抑制 / クールダウン / 24時間上限 / NotificationLog 永続化
      │  5. InAppNotificationSender.sendInApp() … UI 表示用 Notification 行を作成
      │  6. InAppNotificationSender.sendPush() … Web Push (任意、失敗してもパイプライン継続)
      ▼
[ユーザー] 通知フィードに Notification が表示される
```

## 2. 正規経路は 1 本だけ

- **本番マッチング/通知の唯一の推奨経路**: `Cloud Scheduler → GET /api/cron/matching-pipeline → MatchingService.runMatchingPipeline()`
- 認証: `/api/cron/*` は `CRON_SECRET`(Bearer もしくは `?secret=`)。ユーザー向け API は `requireAuth` 配下。
- スケジューラ作成は `.github/workflows/deploy.yml` の Cloud Scheduler ジョブ (`matching-pipeline-15min`, `*/15 * * * *`) が真実のソース。

### レガシー経路（使わない）

- `src/utils/scheduler.ts` の `MatchingScheduler`(in-process `setInterval`)は **開発専用の旧経路**。
- `app.ts` で `CRON_ENABLED=true` のときだけ起動する。**本番では `CRON_ENABLED` を設定していないため起動しない**。
- 旧経路が呼ぶ `NotificationService.trigger()` は、冪等性 / クールダウン / 24時間上限 / 重複抑制 / NotificationLog 永続化 / UI 表示用 Notification 作成 / Web Push を**持たない**(スコア閾値判定のみ)。挙動差があるため**本番で有効化してはならない**。
- 開発時にローカルで通知挙動を試す用途のみ。

## 3. 適用モード(applyMode)について

- `/import` の適用モードは現在 **「一括適用」のみ**。個別選択(individual)は未実装のため UI から外している。
- backend の `upload-text` スキーマは後方互換のため `applyMode` を optional で受け付けるが、**サーバー処理では使用しない**(古いクライアント保護のため 400 にしないだけ)。
- 個別選択を実装する場合は P0 の範囲外として別 PR で扱う。

## 4. import API 契約

`POST /api/trades/import/upload-text` (requireAuth)

| body | 必須 | 内容 |
|---|---|---|
| `filename` | ✓ | 保存ファイル名 |
| `csvText` | ✓ | CSV 本文(形式が不完全でも可、欠損は自動スキップ) |
| `profileId` | - | インジケータープロファイル ID。予約 ID `__AI_AUTO__`(AI に任せる) / `__NONE__`(なし) も可 |
| `userComment` | - | このインポートに付けるメモ |
| `applyMode` | - | 後方互換の受け口。未使用(§3) |

レスポンス(主要): `{ success, tradesImported, noteIds: string[], notesGenerated, ... }`

フロントは共通 API クライアント `src/frontend/lib/api.ts` の `uploadCsvText(filename, csvText, { profileId, userComment })` を使う。

## 5. smoke 手順（手動動作確認）

前提: backend(`npm run dev:backend`) と DB が起動済み、ログイン済みでフロント(`npm run dev:frontend`)から操作できること。

1. **CSV インポート**: `/import` で CSV を 1 件アップロード。プロファイルを選び「アップロード」。成功すると最初の Draft ノート詳細へ自動遷移する。
2. **Draft 確認**: `/notes/:id` で生成された Draft ノートを確認(`status=draft` は監視対象外)。
3. **承認**: ノートを承認し `status=active` にする(これで初めてマッチング対象になる)。
4. **マッチング実行(手動テスト)**: 市場休場中でも実行できる手動テスト経路を使う。
   ```bash
   curl -X POST "http://localhost:3100/api/cron/matching-pipeline/test" \
     -H "Authorization: Bearer $CRON_SECRET" \
     -H "Content-Type: application/json" -d '{}'
   ```
   レスポンスの `runId` と `data`(`totalMatches` / `notified` / `skipped` / `errors` / `skipReasons`)を確認する。
   ※ 本番相当の経路は `GET /api/cron/matching-pipeline`(市場開場チェックあり)。
   ※ Phase α-2 以降、レスポンスにレンズ類似度シャドー評価の `lensShadow`
     (`activeNotes` / `notesWithSnapshot` / `comparable` / `triggered` / `averageScore`)が
     additive に含まれる(観測のみ、通知挙動には影響しない。詳細:
     `docs/architecture/NOTE_SIMILARITY_FOUNDATION.md` §11)。
5. **Notification 確認**: `GET /api/notifications`(requireAuth) または通知フィード UI で、`shouldNotify=true` だったマッチに対し Notification 行が作成されていることを確認する。
6. **run 確認(P1)**: `GET /api/matching/pipeline-runs/latest`(requireAuth) で 4 の実行が run として記録されていることを確認する。

## 6. observability — pipeline run の追跡（P1）

`runMatchingPipeline()` の実行単位（cron サイクル）は `MatchingPipelineRun` テーブルに 1 run = 1 行で永続化される。
マッチ単位の証跡(`MatchResult` / `NotificationLog` / `EvaluationLog`)に対し、本テーブルは **run 単位の集計**を担う。

| 項目 | 内容 |
|---|---|
| 記録タイミング | `runMatchingPipeline()` 完了時 / 市場休場スキップ時(`recordMarketClosedRun`) |
| 主要フィールド | `runId` / `trigger`(cron, manual_test, scheduler, unknown) / `status`(success, skipped, partial_failure, failed) / `startedAt` / `finishedAt` / `durationMs` / `totalMatches` / `notified` / `skipped` / `errorCount` / `errors` / `skipReasons` / `marketStatus` |
| `skipReasons` | reason code → 件数 の集計。code: `side_b_excluded` / `simultaneous_hit` / `missing_market_snapshot_id` / `send_failed` / `notify_error` / `score_below_threshold` / `duplicate` / `recent_duplicate` / `cooldown` / `daily_limit` / `other`（防御的フォールバック。`NotificationTriggerService.evaluateWithPersistence` は全 skip 経路で reason code を返すため通常は出ない） |
| Side-A / Side-B の切り分け | `MatchResult` / `NotificationLog` / `Notification` は `noteId` が `TradeNote`(UUID) への FK で **Side-A 専用**。Side-B のマッチ(`sideb:` 接頭辞・非 UUID)はこの通知経路では `side_b_excluded` として除外される(UUID パースエラー回避)。Side-B 専用の通知経路は未設計(将来課題)。`checkForSideBMatches` 内の Side-A テーブルへの `EvaluationLog`/`MatchResult` 書き込みは現状 try/catch で失敗握り潰し(= 行は作られない)で、Side-B 永続化設計時に整理予定 |
| 永続化失敗時 | パイプライン本体は継続(non-fatal)。`runId` は in-memory で確定済みのため API レスポンスには返る |

### 取得 API（requireAuth 配下）

| API | 内容 |
|---|---|
| `GET /api/matching/pipeline-runs/latest` | 最新 run を 1 件返す(`{ run: PipelineRunDTO \| null }`) |
| `GET /api/matching/pipeline-runs?limit=N` | 最新順に run 一覧を返す(N は 1〜100、既定 20) |

フロントは `src/frontend/lib/api.ts` の `fetchLatestPipelineRun()` / `fetchPipelineRuns(limit)`(返り値 `PipelineRunDTO`)を使う。内部 DB 行はそのまま返さず DTO に整形する。

### 自動テスト

- 通知配線の固定: `src/backend/tests/matchingService.test.ts` の `runMatchingPipeline 通知配線`。
  `shouldNotify=true` のとき `sendInApp` が呼ばれ `notified` にカウントされることを Side-B / **Side-A** 両方の note ID で保証している。
- observability の固定: 同スイートで `runId` 返却・`status` 確定・`MatchingPipelineRun` への永続化・`skipReasons` 集計・`recordMarketClosedRun` の `status=skipped` 記録を保証している。
