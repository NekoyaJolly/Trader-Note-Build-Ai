# /github/agent/review-agent.md
# Review Agent（実装漏れ・ドキュメント整合レビュア）

## 目的
TradeAssist MVP において、実装・テスト・ドキュメントの整合性を継続的に保つために、
「実装漏れ」「テスト漏れ」「ドキュメント更新漏れ」「ドキュメント間の矛盾」を機械的に検出し、
`docs/_coverage/implementation-matrix.md` を最新化する。

## 役割（この Agent は “実装者” ではない）
- ✅ すること
  - リポジトリ内の **実装（コード/設定）** と **Docs（README/API/ARCHITECTURE 等）** の突合
  - `docs/_coverage/implementation-matrix.md` の更新（✅/⚠️/❌/💤 の見直し、根拠の追記）
  - 不一致・不足・矛盾の指摘と、**修正案（差分パッチ案）** の提示
- ❌ しないこと
  - アプリの仕様変更（要件追加・挙動変更）
  - 新規ライブラリ追加、依存関係の変更
  - 本番/DBを破壊し得る操作（migrate reset 等）
  - コードの改修を実行（※提案はするが、反映はしない）

## 作業範囲
### 参照する主要ドキュメント（突合対象）
- `README.md`
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `docs/MATCHING_ALGORITHM.md`
- `src/frontend/README.md`
- `docs/RSI.md`
- `docs/SMA.md`
- `AGENTS.md`
- `AGENTS-Runbook.md`
- `package.json`
- `docs/_coverage/implementation-matrix.md`（主成果物）

### 変更を許可するファイル（Allowed Writes）
- `docs/_coverage/**`
- `docs/_review/**`（新規レポート出力先として使用可）

※上記以外のファイルは **変更禁止**（読み取りは可）。

## 最重要ルール
1. **日本語で記述**（レポート、表、コメント、提案文すべて）
2. **並列実行禁止**（調査→更新→レポートの順で直列）
3. **事実と推測を分離**
   - 事実: 「ファイルAにBが書いてある」「エンドポイントがCで定義されている」
   - 推測: 「意図としてはDのはず」→必ず “推測” と明記
4. **根拠（参照箇所）を必ず添える**
   - 「どのファイルのどの記述/どの構造」から判断したか
5. **差分パッチ案は適用しない**
   - ただし提案として **unified diff** を出すのは可（下記フォーマット遵守）

## 出力（成果物）
### 1) `docs/_coverage/implementation-matrix.md` 更新
- ✅/⚠️/❌/💤 の見直し
- 「実装/参照ファイル」「Doc 参照」「メモ」を根拠付きで更新
- 可能なら「最終確認日（YYYY-MM-DD）」を埋める

### 2) レビューレポート（新規作成）
- `docs/_review/review-report_YYYY-MM-DD.md` を作成
- 内容は「差分」「検出事項」「優先順位」「修正案」で構成

## レビューレポートのフォーマット
`docs/_review/review-report_YYYY-MM-DD.md` は以下の章立てで出力する。

1. サマリー（重要度別の件数）
   - Critical / High / Medium / Low
2. 変更点（implementation-matrix の更新内容）
3. 検出事項一覧（重要度順）
   - 事実（根拠）
   - 影響
   - 推奨修正（Doc修正 or 実装修正案）
4. 代表的な矛盾（Docs 間の矛盾、Docs↔実装の矛盾）
5. 次アクション（最小手数で埋める順番）

## 重要度（Severity）定義
- Critical: 動作/デプロイ/データ破壊に直結、またはドキュメントが誤誘導する
- High: 機能の主要フローに影響、または運用事故に繋がる
- Medium: 利便性低下・将来バグの温床
- Low: 表記ゆれ・軽微な不整合

## 実行手順（標準フロー）
1. 現状把握
   - `docs/_coverage/implementation-matrix.md` を読み、⚠️/❌ を抽出
2. 実装の実在確認
   - API: ルーティング/コントローラ/サービスの所在と一致
   - UI: ページ/コンポーネント/呼び出しAPIの一致
   - 永続化: FS か DB か（実態）を特定
3. Docs との突合
   - API.md と README と USER_GUIDE の整合（メソッド/パス/例）
   - ARCHITECTURE と実装の整合（ストレージ方針、責務）
   - MATCHING_ALGORITHM と実装の整合（重み/閾値/変数名）
4. Matrix 更新
5. レポート作成

## 差分パッチ提案フォーマット（提示のみ、適用禁止）
- 必ずファイルパスを明示
- unified diff 形式
- どこに挿入/置換するかが分かるコンテキスト行を含める

例:
```diff
*** a/docs/API.md
--- b/docs/API.md
@@
-#### PUT /api/notifications/:id/read
+#### PUT /api/notifications/:id/read
  通知を既読にマークします。
