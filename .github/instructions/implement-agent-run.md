# /github/instructions/implement-agent-run.md
# Implement Agent 実行指示（Run Instruction）

## 実行目的
Review Agent のレビュー結果（`docs/_review/review-report_YYYY-MM-DD.md`）に基づき、
不整合・実装漏れを **最小変更で修正**し、整合した状態へ戻す。

---

## 対象 Agent
- `/github/agent/implement-agent.md` を公式仕様として使用すること。

---

## 入力（必読）
- `docs/_review/review-report_YYYY-MM-DD.md`
- `docs/_coverage/implementation-matrix.md`
- `docs/API.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/MATCHING_ALGORITHM.md`
- `src/frontend/README.md`
- `AGENTS.md`
- `AGENTS-Runbook.md`

---

- `/health` の呼び出しパス
- 通知既読化のメソッド（PUT/POST 等）
- read-all のメソッド/パス
- 必ず **Backend / Frontend / API.md** を一致させる

**完了条件**
- 主要画面（通知一覧/詳細）で API エラーが出ない（少なくとも該当箇所が 200/期待形式）
- API.md が最新化されている

---

### Task 2：通知の永続化ストア矛盾（FS/DB 混在）を解消
- 「読むのはDB、書くのはFS」などの分断がある場合は統一
- まず “現状の真実” を確認し、短期で事故が少ない方へ寄せる

**完了条件**
- GET/PUT/DELETE で同じストアに対して整合した結果になる
- 既読/削除が UI 上で一貫した挙動になる

---

### Task 3：Docs/設定の揺れを統一（env 変数・ストレージ方針）
- `DB_URL` / `DATABASE_URL` の統一
- `MATCH_THRESHOLD` / `NOTIFY_THRESHOLD` などの命名揺れがあれば統一
- `.env.example` と Docs を同時更新（値はダミー）

**完了条件**
- README / API / ARCHITECTURE の説明が同じ前提になっている
- 起動手順が誤誘導しない

---

## 実行手順（必ず直列）
1. read-only で現状確認（該当ファイルを列挙）
2. 修正方針を短く提示（最小変更・互換性の扱い）
3. 実装（差分パッチ提示）
4. テスト実行（コマンドは実行場所を明示）
5. Docs 更新（差分パッチ提示）
6. `docs/_coverage/implementation-matrix.md` 更新（該当行・日付）
7. 最終報告（下記フォーマット）

---

## 実行コマンド（例：実行場所を必ず書く）
- （repo ルート）
  - `npm test`
  - `npm run build`
- （frontend ディレクトリが別なら）
  - `cd src/frontend && npm test` のように明記

※ 実際の構成に合わせて正しい場所を記載すること。

---

## 変更制約
- 依存追加が必要なら **理由と代替案を提示して停止**（Ask First）
- 仕様追加は禁止
- 本番DB破壊に繋がる提案は禁止（migrate reset 等）

---

## 最終報告フォーマット（必須）
1. **変更概要**
   - 何を一致させたか（UI/API/Docs/Storage）
2. **差分パッチ**
   - 変更ファイルごとに unified diff
3. **実行したコマンド（実行場所つき）**
4. **確認結果**
   - どの画面/エンドポイントで確認したか
5. **Docs 更新点**
6. **implementation-matrix 更新点**
7. **残課題（あれば）**
