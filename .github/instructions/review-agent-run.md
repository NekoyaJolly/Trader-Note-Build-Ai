
```md
# /github/instructions/review-agent-run.md
# Review Agent 実行指示（Run Instruction）

## 実行目的
リポジトリの拡大に伴い、実装・テスト・ドキュメントの整合を定期点検し、
`docs/_coverage/implementation-matrix.md` を最新化する。
同時に、矛盾/不足を `docs/_review/` にレポートとして残す。

## 対象 Agent
- `/github/agent/review-agent.md` を Review Agent の公式仕様として使用すること。

## 実行前提
- 作業ブランチで実行する（例: `chore/review-coverage-YYYYMMDD`）
- 変更は **docs 配下の許可領域のみ**
  - `docs/_coverage/**`
  - `docs/_review/**`
- 実装（コード）や設定（package.json、prisma、src/** 等）は **変更禁止**

## 入力（参照対象）
最低限、次のファイルを読み取って突合すること:
- `docs/_coverage/implementation-matrix.md`
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

## タスク（この順で直列に実行）
1. **coverage 現状把握**
   - `implementation-matrix.md` から ⚠️/❌ 行を抽出し、優先度順の作業計画を立てる
2. **実装の実在確認（読み取りのみ）**
   - API: ルーティング/コントローラ/サービスの所在確認
   - UI: 画面/コンポーネント/API 呼び出し導線確認
   - 永続化: FS か DB か “実態” の確認（矛盾があれば列挙）
3. **Docs 整合チェック**
   - API.md と README と USER_GUIDE の整合（パス/メソッド/例/パラメータ）
   - ARCHITECTURE と実装の整合（ストレージ、責務、データフロー）
   - MATCHING_ALGORITHM と実装の整合（特徴量、重み、閾値、変数名）
   - RSI/SMA 定義書と実装の整合（Layer1/2/3 の一致）
4. **implementation-matrix 更新**
   - ✅/⚠️/❌/💤 を現状の真実に合わせる
   - 根拠（参照ファイル）を「実装/参照ファイル」「Doc参照」「メモ」に追記
   - 最終確認日（YYYY-MM-DD）を可能な限り埋める
5. **レビューレポート作成**
   - `docs/_review/review-report_YYYY-MM-DD.md` を新規作成
   - 重要度順に「事実（根拠）/影響/推奨修正」を列挙
   - 修正案が必要な場合は “パッチ案” として提示する（適用はしない）

## 出力物（必須）
- 更新: `docs/_coverage/implementation-matrix.md`
- 新規: `docs/_review/review-report_YYYY-MM-DD.md`

## 禁止事項（厳守）
- コード変更（src/**、backend/**、frontend/**、prisma/** 等）
- 依存追加・削除（package.json 変更）
- 仕様変更、振る舞い変更
- 本番/DB 破壊の可能性がある操作の提案（migrate reset 等を推奨しない）
- 推測を事実として断定すること

## レポートの書き方（必須）
- すべて日本語
- 「事実」と「推測」を明確に分ける
- 事実には必ず根拠（ファイル名）を添える
- 重要度は Critical / High / Medium / Low

## 期待する最小成果（合格ライン）
- implementation-matrix の ⚠️/❌ が “なぜそう判定したか” まで含めて更新されている
- Docs↔実装の矛盾が **少なくとも 5 件以上**（または存在しない旨）明確化されている
- 永続化（FS/DB）と env 変数名の揺れが明確に指摘されている（該当する場合）

## 提案パッチの扱い
- パッチは **提案としてレポートに添付**するのみ
- unified diff 形式で、ファイルパスとコンテキストを含める
- 実際の適用は別の Implement Agent に差し戻す

---
## 実行結果の提出形式（この順）
1. `docs/_coverage/implementation-matrix.md` の更新概要（何行をどう変えたか）
2. `docs/_review/review-report_YYYY-MM-DD.md` の要点（Critical/High のみ抜粋）
3. 未解決事項（追加調査が必要な点があれば列挙）
