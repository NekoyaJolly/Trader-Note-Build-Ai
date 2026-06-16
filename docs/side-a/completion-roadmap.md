# Side-A 完成形ロードマップ（ギャップ分析）

> **ステータス**: 確定計画（2026-06-09）— Side-A 最終完成形のスコープと Phase 構成は確定（§7）。MVP ではなく**最終完成形**までの全体像と不足の洗い出し。実装進捗に応じて更新する。
> **目的**: 「Side-A を完成させたい」と思ったとき、現状何が出来ていて何が足りないか、完成までに必要な事を一望する。
> **読み方**: 「UI がある」と「機能が end-to-end で実際に効く」は別物として区別している（特に柱1）。
> **関連**: `docs/architecture/NOTE_SIMILARITY_FOUNDATION.md`（類似度基盤の正本設計）、`docs/side-a/golden-path.md`、`docs/side-a/backtest-flow.md`、memory `project_note_unification_side_ab` / `project_side_a_strategy_builder_vision`。

---

## 0. Side-A 最終完成形とは（北極星）

Side-A は「人間トレーダーのノーコード相棒」。完成形は **2 本の柱 + 支える基盤**で構成される。

- **柱1: ノート類似マッチング** — 自分のトレード(CSV)をノート化し、「その瞬間の市場がどう見えたか」を特徴として保存。見ていないときに、ライブ市場が過去ノートに似たら通知する。
- **柱2: ストラテジー/条件ビルダー** — MT5/cBot/Pine 級の柔軟さで条件をノーコードで組み、バックテストし、条件成立をライブで監視・通知する（北極星「条件ツリーに全機能を合流」）。
- **支える基盤** — インポート / ノート運用 UX / 通知(アプリ内・Push・リアルタイム、**粒度をユーザーが選択可**) / 市場データ / **認証+マルチユーザー** / 観測性 / **発注支援(実発注、安全ガード付き)**。

> **完成形スコープ確定(2026-06-09)**: マルチユーザー化する / 実発注を追加する(安全ガード必須) / 柱1・柱2 をレンズ基盤で合流 / 着手順は「似たら通知(柱1)→条件で通知(柱2)」+ 通知粒度をユーザー選択可。詳細は §7。

**最重要の気づき**: 柱1 と柱2 は今**別々の特徴表現・別々の評価経路**で動いている。完成形では両者が**レンズという共通言語に合流**する（条件も、ノート特徴も、レンズで表す）。これが「全機能を合流」の技術的な核。

---

## 1. 現状サマリー（完成度の正直な評価）

| 領域 | UI/形 | 機能が実際に効くか | 完成度 |
|---|---|---|---|
| インポート(CSV→Draft) | ✅ 充実 | ✅ 動く(市場データ取得が前提) | 高 |
| ノート運用 UX(承認/有効/停止/優先度) | ✅ 充実(P2) | ✅ 動く | 高 |
| **柱1: 類似マッチング** | ✅ 画面は充実 | ✅ レンズ基盤は稼働。旧12次元ロールバック経路は廃止済み。本番既存ノート LensSnapshot バックフィルも完了 | 高 |
| 通知(アプリ内・中核) | ✅ | ✅ 動く(マッチが出れば) | 中〜高 |
| 通知(Web Push) | ✅ `/settings` で購読状態UIあり | ✅ per-user 配信・購読/解除/テスト通知が動く | 高 |
| 通知(リアルタイム) | ✅ SSE 自動更新あり | ✅ `GET /api/notifications/stream` + REST フォールバック | 高 |
| **柱2: 条件ビルダー(作成+BT)** | ✅ 充実 | ✅ バックテスト評価は動く | 中〜高 |
| **柱2: ライブ条件評価/アラート** | ✅ 設定UI + cron 評価経路あり | ✅ `strategy-alerts-15min` で条件成立通知が動く | 高 |
| バックテスト | ✅ WF/モンテカルロ実装 | ✅ 動く | 中〜高 |
| 発注支援 | ✅ 参考表示 | ⚠️ 参考のみ → **完成形では実発注追加(確定)** | 要実装(安全ガード必須) |
| 認証(cTrader OAuth) | ✅ | ✅ 本番稼働 | 高 |
| マルチユーザー | ✅ User表 + Side-A 中核テーブル userId | ✅ HTTP/cron のユーザー分離済み。Phase 6 で Trade/TradeNote/MatchResult/Notification/Strategy/Note の userId 必須化 + FK 付与 | 高 |
| 市場データ供給 | — | ⚠️ EODHD+fallback+cache、失敗時のユーザー通知なし | 中 |
| 観測性(MatchingPipelineRun) | ✅(P1) | ✅ 動く | 高 |

> **総括**: 「画面と CRUD は概ね出来ている」が、**Side-A の核心価値(似たら通知 / 条件成立で通知)が、特徴量基盤の破綻とライブ評価の不在で実際には成立していない**。完成形への最短距離は“見た目”でなく“この2つの実体”を作ること。

---

## 2. 柱1: ノート類似マッチング — 完成までに必要なこと

### 現状の致命点
- ノート作成側と市場照合側で**別実装の特徴量**を比較しており、`__AI_AUTO__` 以外は次元不一致で cosine 0(=永遠に不一致)、`__AI_AUTO__` でも別実装比較で不正確（詳細: NOTE_SIMILARITY_FOUNDATION.md §1）。
- トレーダー可変の `IndicatorProfile` が**マッチングに配線されていない**。
- インジケーターのパラメータを編集する **UI が無い**(プロファイル選択のみ)。

### 必要なこと（= 類似度基盤の実装。設計は NOTE_SIMILARITY_FOUNDATION.md）
1. **LensSnapshot を正準特徴に**（状態レンズ8 + インジケーターレンズ新設）。作成時=照合時で同一生成。〔規模: L〕
2. **インジケーターレンズ新設**: `IndicatorProfile` 駆動、値は analysis-engine、zone/cross/position/slope/divergence を正規化特徴に。〔L〕
3. **類似度エンジン**: 共通 lensId のみ比較・confidence 連動の重み付き平均・欠損に強い(全体0にしない)・閾値発火。〔M〕
4. **IndicatorProfile をマッチングに接続**（宙ぶらりん解消）+ **パラメータ編集 UI**。〔M〕
5. **移行**: 旧 12次元/可変経路の廃止、既存ノートの LensSnapshot 再生成(バックフィル)。〔M〕
6. **ノート統一(UnifiedNote)**: Side-B materialize の placeholder featureVector を実値化、`tradeNoteId` ブリッジで双方向昇格(「Side-Bの本番ノートを Side-Aでも通知」)。〔M〕

### 完成判定
承認済みノートに対し、ライブ市場が似たときに**意味のある類似度**で通知が出る。トレーダーが選んだインジケーターが効く。Side-A/Side-B のノートを相互に監視に乗せられる。

---

## 3. 柱2: ストラテジー/条件ビルダー — 完成までに必要なこと

### 出来ていること（強い）
- 条件ビルダー UI + バックテスト評価が ~80%: 比較/範囲(between)/クロス/タッチ、19 インジケーター、ローソク足12パターン、直近ルックバック、時間条件、AND/OR/NOT、IF-THEN、SEQUENCE まで実装済み。バックテストは Stage1/2・WF・モンテカルロまで。

### 致命的ギャップ（北極星まで）
1. **ライブ条件評価エンジンが存在しない**〔L、最重要〕: `StrategyAlert` は設定できるが、**条件をライブで評価して発火する実体がない**(今のアラートは TradeNote のマッチスコア依存で、条件評価ではない)。完成形には「定期/リアルタイムに条件ツリーを評価 → 成立で通知」の経路が必須。バックテスト評価器(`strategyConditionEvaluator`)をライブにも使う「評価1経路化」が筋。
2. **レンズベース条件が Side-A 条件ツリーに無い**〔L〕: SMC/Wyckoff/ChartPattern レンズは Side-B 専用。北極星「条件ツリーに全機能を合流」には、**条件タイプに `lens` を追加**し、analysis-engine のレンズ計算を Side-A 条件ビルダー/評価器から使えるようにする必要がある。→ **柱1のレンズ基盤と同じ資産で実現できる(合流点)**。
3. **マルチタイムフレーム条件が無い**〔M〕: 「1h の RSI<30 AND 15m の MACD クロス」が作れない。条件に `timeframeOverride` を追加し、評価器が複数足を参照。
4. ~~ルックバックの **UI パネル**~~ (PR #374 の `LookbackControl` で実装済み、2026-06-08。本ドキュメント作成時の調査漏れ)、複数シンボル/ローリングWF バックテスト〔M〕、バックテスト結果の可視化強化〔M〕。

### 完成判定
ノーコードで組んだ条件(インジケーター + パターン + 時間 + **レンズ** + MTF)が、バックテストでもライブでも**同じ評価器**で判定され、成立したら通知される。

---

## 4. 支える基盤 — 完成までに必要なこと

| 領域 | 現状 | 完成形に必要なこと | 規模 |
|---|---|---|---|
| **リアルタイム類似度** | Phase2(in-memory)完。`RealtimeSimilarityService`/`RollingWindow`/`CTraderProvider` 実装済みだが callback 止まり | Phase3: callback→DB永続化→Push→UI 自動更新。常駐ワーカーを本番常駐化(Cloud Run sidecar/別サービス) | L |
| **リアルタイム UI** | 通知一覧はポーリング/手動更新 | WebSocket/SSE で通知・スコアをライブ更新 | M |
| **Web Push** | VAPID/購読/per-user 配信、`/settings` の購読状態 UI(購読/未購読/拒否)、テスト通知まで実装済み | 残: 実機・本番での購読/解除/テスト通知 smoke を継続 | S |
| **市場データ** | EODHD主+fallback+OHLCVキャッシュ | データ取得失敗時のユーザー通知/フォールバック表示、カバレッジ可視化、ノート生成の堅牢化(取得失敗で生成スキップを減らす) | M |
| **発注支援(実発注)** 〔確定: 追加〕 | 参考プリセットのみ | cTrader Open API で**実発注**を追加。**安全ガード必須**(都度の明示確認なしに発注しない / サイレント自動売買禁止 / 数量・価格の最終確認 UI / 失敗時の明確な状態)。信頼度の動的算出 | L(高リスク) |
| **マルチユーザー** 〔確定: 化する〕 | OAuth稼働。User表 + Side-A 中核テーブル userId | Trade/TradeNote(及び派生: MatchResult/Notification/Strategy/Note 等)の userId 必須化 + FK 付与、全 query のユーザー分離、per-user 通知/Push、Web Push 購読状態 UI は実装済み | L |
| **観測性** | MatchingPipelineRun(P1)で run 追跡可 | 柱2ライブ評価・リアルタイムも同様に run/alert 追跡。既知の Side-B UUID バグ(PR #378)解消 | S |

---

## 5. 横断テーマ: 2本の柱の「合流」（完成形の核）

完成形の本質は、**柱1(ノート類似)と柱2(条件)が同じ“レンズ言語”に合流**すること:

- レンズ(状態+インジケーター)が、**ノート特徴**にも**条件ツリーの条件タイプ**にもなる。
- 評価器は **1 経路**(バックテストもライブも同じ)。
- これにより「過去の勝ちトレードに似たら通知」も「自分のルール条件が成立したら通知」も、同じ基盤の上で統一的に扱える。

この合流を意識せず別々に作り込むと二重実装が増える(現に featureVector で起きた)。**レンズ基盤(NOTE_SIMILARITY_FOUNDATION.md)を“共通土台”として先に据える**のが完成形への最短かつ後戻り最小の道。

---

## 6. 完成までに必要なこと（優先順・チェックリスト）

> 規模目安: S(小) / M(中) / L(大)。順序は「後戻り最小・価値最大」を意図。

> **着手順の確定(決定4)**: 「**似たら通知(柱1)→ 条件で通知(柱2)**」の順。マルチユーザー化は特徴量基盤に触れる Phase α と同時期に migration(二重移行回避)。実発注は柱1/柱2 完成後(通知 → 実行の自然な流れ)。

### Phase α — 基盤（最優先・他が乗る土台）+ マルチユーザー化
- [x] **レンズ類似度基盤の実装**（NOTE_SIMILARITY_FOUNDATION.md を確定 → 実装）〔L〕 ← 柱1と柱2の合流土台 — 2026-06-10 実装 (PR α-1 基盤コア / PR α-2 Note コア+生成配線+シャドー評価。切替 §9-3 と旧経路廃止は α-3 で)
- [x] インジケーターレンズ新設 + IndicatorProfile 接続〔M〕 — 2026-06-10 実装 (PR α-1/α-2)。**パラメータ編集 UI は α-4b (PR #387、2026-06-11) で実装済み** (ProfileEditModal にインジケーター別パラメータ入力、定義は `lib/indicatorParamFields.ts` に集約)
- [x] 旧特徴量経路の廃止 + 既存ノート LensSnapshot バックフィル〔M〕（バックフィルスクリプトは α-2 で実装済み、実行とレガシー廃止は α-3）— **α-3 第1弾 2026-06-11 実装**: マッチングをレンズ類似度に切替。**2026-06-15 追記**: 本番誤実行防止として backfill は `--confirm-write` 必須化、read-only 状態確認 `scripts/check/lens-snapshot-backfill-status.ts` を追加。**2026-06-16 追記**: `MATCHING_ENGINE=legacy` ロールバック経路と `LENS_SHADOW_EVALUATION` シャドー評価レスポンスを廃止し、Side-A 本番マッチングは LensSnapshot 類似度へ一本化。**2026-06-16 本番運用追記**: 本番 DB の active/draft は事前確認で pending=0、archived 13 件を `--include-archived --confirm-write` でバックフィルし、全 status 合計 14 件で `missingCore=0` / `nullSnapshot=0` / `pending=0` を確認済み。
- [x] **マルチユーザー化**: Trade/TradeNote/派生に userId 追加 migration + 全 query のユーザー分離〔L〕— migration + バックフィルは α-2、**全 query のユーザー分離は α-4a (PR #386、2026-06-11) で実装済み**: HTTP 経路は `req.user.userId` で分離 + mutation 所有権チェック、cron はソースエンティティ (note/strategy) の userId を MatchResult/Notification へ伝播。**Phase 6 (2026-06-15) で Trade/TradeNote/MatchResult/Notification/Strategy/Note の userId 必須化 + FK 付与を実装**し、新規作成経路も userId 必須に統一。

### Phase β — 柱1 を“似たら通知”として完成 + 通知粒度
- [ ] 類似度→通知が意味を持って出る（柱1の完成判定）+ per-user 通知/Push — **per-user Web Push は β-1 (PR #388、2026-06-11) で実装済み** (MatchResult/Strategy の userId から sendToUser、レガシー NULL 行は broadcast フォールバック)。「意味のある通知が出る」判定は lens エンジン (α-3) の本番運用観察で確認する
- [ ] **通知粒度をユーザーが選べる(決定4)**〔M〕 — **MVP (しきい値 / 一致レベル / クールダウン / maxPerDay) は β-2 (PR #389 基盤 + PR #390 UI、2026-06-11) と Phase 5 で実装済み**。`NotificationPreference` テーブル (Neko 決定: 案2、scope=user/profile/note/strategy 階層) + 解決サービス + `/settings/notifications` UI + ノート詳細の per-note 上書き。2026-06-16 追記: 旧 `/api/settings` の `scoreThreshold` / `maxPerDay` も user scope の NotificationPreference に同一 transaction で同期し、scoreThreshold は通知粒度基盤の weak 下限に合わせて 70% 未満を実効値 70% へ正規化。残: 重視するレンズ/層重みプリセット (指標重視/バランス/状態重視)、シンボル単位の集約、profile スコープ配線 (ノート→プロファイル紐付けが前提)、per-strategy 上書き UI

### Phase γ — 柱2 をライブに（条件で通知）
- [x] **ライブ条件評価エンジン**（バックテスト評価器をライブ共用、定期/リアルタイム評価→発火）〔L〕 — 2026-06-10 実装 (PR γ-1): `strategyLiveEvaluationService` が `evaluateConditionGroup` + `buildEvaluationCaches` をライブ共用(評価1経路化)。Cloud Scheduler `strategy-alerts-15min`(7分オフセット) → `GET /api/cron/strategy-alerts`。アラート通知は Notification テーブル(type=strategy_alert)に統合し UI 到達を修正(旧実装は揮発FSで本番不達)、Web Push スタブも実配信化
- [x] 条件ツリーに **レンズ条件タイプ**追加（柱1基盤を流用）〔L、**設計確定**〕 — 設計は `NOTE_SIMILARITY_FOUNDATION.md §12`。**フルスコープ確定 (2026-06-12 Neko): 状態系レンズ含む** → **2026-06-13 フルスコープ完了**: 第1弾=インジケーター系 rsi/macd/ma/ma_cross/bb（§12 追補3）、フォローアップ=順序範囲演算子+プレビュー対応（追補4）、第2弾=状態系 8 種（TS 計算 3 種は追補5、smc/chart_pattern/wyckoff は analysis-engine per-bar 系列 API `stateLensSeries` で追補6）。全経路 backtest/live/プレビュー共用・lookahead 禁止不変条件・テストで固定
- [x] ~~マルチタイムフレーム条件〔M〕~~ (PR #391、2026-06-11 実装・本番実機検証済: `timeframeOverride`、確定バーのみ参照で lookahead 防止、1w 対応。条件ビルダー/評価器/backtest/live 共用) / ~~ルックバック UI〔S〕~~ (PR #374)
- [x] ~~条件アラートにも通知粒度設定を適用（柱1と共通の通知設定層）~~ (PR #397、2026-06-12): NotificationPreference の strategy スコープを `triggerAlert` の cooldown に配線 (`strategy pref > user pref > StrategyAlert 固有値`)。柱2 は二値判定 (matchScore=1.0) のため threshold/minMatchLevel は no-op、cooldown のみ層化。`resolveForStrategy` + scope=strategy upsert/schema 配線。DB 基盤は β-2a 完備済で migration 不要。**残=per-strategy 上書き UI (follow-up)**

> **Phase γ 完了 (2026-06-13)**: レンズ条件タイプ (柱1/柱2 合流の核) のフルスコープ完了をもって Phase γ の全項目が完了。MTF (#391) / ライブ条件評価 (γ-1) / 通知粒度 (#397) / レンズ条件タイプ (#399-#401 + 第2段) 。次は Phase δ (δ-5 常駐ワーカーは 15 分 cron 維持で当面見送り、δ-3 は per-user SSE 新設。§13)。

> **支える基盤メモ**:
> - **(2026-06-11, PR #392-394)**: バックテスト履歴 OHLCV 取得を **cTrader 優先 → EODHD 優先**に切替 (Phase A All-In-One 統一。§4 市場データ参照)。本番実機検証済。EODHD intraday は週末/休場で OHLC=null のギャップ足を返すため `Number.isFinite` で除外 (チャート保存経路の同型 DecimalError も PR #395 で除外)。詳細 memory `project_eodhd_backtest_primary`。
> - **(2026-06-12, PR #396)**: OHLCV 取得 SSE の一過性切断で誤「失敗」表示していた UX を修正 (ジョブ決着まで再接続。バックエンドは 30 分ジョブ保持で再接続時に最終状態を再送)。

### Phase δ — リアルタイム & 通知の完成
> 設計は `NOTE_SIMILARITY_FOUNDATION.md §13`（δ-1〜δ-5 配線 + 常駐ワーカー選択肢）。**重要**: 現状リアルタイムは簡易12次元ベクトルでレンズ基盤と別経路 → δ-1 でレンズエンジンに統一する（#3 §12 のレンズ系列化資産を共有）。
- [x] リアルタイム類似度 Phase3（レンズ統一→DB/Push/UI 配線）〔L〕 — **2026-06-13 実装完了**: δ-1（`realtimeSimilarityService` の簡易12次元を廃し正規パイプラインのシンボルスコープ起動に統一、§13 追補8）/ δ-2（正規経路共用で通知粒度も自動適用）/ δ-3・δ-4（per-user 通知 SSE + フロント購読、追補7）。**常駐ワーカー本番化(δ-5)は当面見送り、15 分 cron 維持（2026-06-13 Neko 決定、§13.4）**。15m 以上の時間足は実質バー単位評価のため、リアルタイム化は 5m 以下が必要になった時点で再判断（その際は worker のデータ源を cTrader→EODHD に差し替え）
- [x] 通知のリアルタイム UI〔M〕 — **2026-06-13 実装（§13 追補7）**: 認証付き per-user 通知 SSE `GET /api/notifications/stream`（サーバ側 DB ポーリング 10 秒 = マルチインスタンス安全）+ `useNotificationStream`（未読バッジ・通知一覧の自動更新、SSE 断時は REST フォールバック）。**Web Push 購読状態 UI は `/settings` に実装済み** (購読/解除/テスト通知/状態更新)

### Phase ε — 実発注 & 仕上げ
- [ ] **実発注(決定2)**: cTrader Open API 発注。**安全ガード必須**（都度の明示確認なしに発注しない / サイレント自動売買禁止 / 数量・価格の最終確認 / 失敗時状態の明確化）〔L・高リスク〕
  - **Phase 0 完了 (2026-06-13, PR #405 + #406)**: 実発注系 API と UI を feature flag で既定停止、production `JWT_SECRET` fail-fast を導入。
  - **Phase 1 仕様**: 実発注再開条件、confirmation token、idempotency、demo/live 表示、risk limit、symbol/volume 検証、失敗時ステータス、E2E シナリオは `docs/side-a/order-execution-safety.md` を正本とする。
  - **残**: Phase 2 の実発注再実装は今回のロードマップ実行範囲外。Phase 3/4/5 完了後に別途着手判断する。
- [ ] OrderPreset 信頼度の動的算出〔M〕
- [ ] 市場データ失敗時のユーザー通知・カバレッジ可視化〔M〕
- [ ] バックテスト可視化強化 / 複数シンボル / ローリングWF〔M〕
- [ ] ノート統一(双方向昇格、Side-B materialize 実値化)〔M〕

---

## 7. 確定事項（2026-06-09、Neko 決定）

1. **マルチユーザー化する**: 完成形は複数ユーザー対応。Trade/TradeNote 及び派生に userId 追加 + データ分離 + per-user 通知。Phase α と同時に migration。
2. **実発注を追加する**: cTrader Open API で実発注まで実装(Phase ε)。**安全ガード必須**(都度の明示確認なしに発注しない・サイレント自動売買禁止・最終確認 UI)。「自動売買しない」原則は「ユーザーの明示操作なしに発注しない」に置き換える。
3. **柱1/柱2 をレンズ基盤で合流させる**: OK。レンズ(状態+インジケーター)を共通土台にし、ノート特徴も条件ツリーの条件タイプも同じレンズ言語・同じ評価器に寄せる。
4. **着手順: 似たら通知(柱1)→ 条件で通知(柱2)**。さらに **通知粒度をユーザーが選べる**ようにする(一致レベル/しきい値/重視レンズ/頻度等を設定可能。柱1・柱2 共通の通知設定層)。

> これらの確定により、本ドキュメントと `NOTE_SIMILARITY_FOUNDATION.md` は「判断待ち」から「確定計画」へ。残る詳細決定は基盤設計内の項目(テーブル戦略 A/B/C、コア指標レンズ集合、既定重み等。NOTE_SIMILARITY_FOUNDATION.md §10)。

---

## 付録: 調査根拠

- フロント全25画面の完成度マトリクス、運用機能(発注/Push/リアルタイム/認証/データ)、条件ビルダー機能マトリクスは 2026-06-09 のコード調査に基づく(各 §の評価)。
- 柱1の特徴量破綻の詳細・設計は `NOTE_SIMILARITY_FOUNDATION.md`。
