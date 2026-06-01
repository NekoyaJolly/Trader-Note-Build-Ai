# scripts/ ディレクトリ運用ルール

> **位置づけ**: [`AGENTS.md`](../AGENTS.md) §5.4 から参照される、`scripts/` 配下の運用詳細の正本。
> **制定日**: 2026-05-17

このディレクトリには、開発・検証・運用に使う **恒久スクリプトのみ** を配置する。一時的な調査・デバッグ用スクリプトはここに置かない (`AGENTS.md` §5.3 参照)。

---

## 1. スクリプト追加の前提

`scripts/` にファイルを追加してよいのは、以下のいずれかを満たす場合のみ。

- `package.json` の scripts から呼び出される
- CI/CD から呼び出される
- 本 README または運用ドキュメントに実行方法が記載される
- 他の恒久コードから明示的に参照される

呼び出し元が存在しないスクリプトを追加してはならない。新規追加時は **下表に必ず追記する**。追記しないスクリプトは追加禁止。

## 2. 用途分類 (ディレクトリ構造)

| ディレクトリ | 用途 |
|---|---|
| `scripts/dev/` | 開発補助 (ローカル便利スクリプト等) |
| `scripts/check/` | 検証・診断 (整合性チェック、smoke、rehearsal) |
| `scripts/migrate/` | データ移行・補正 (1 回限り 〜 数回) |
| `scripts/ci/` | CI 専用 (GitHub Actions などから呼ばれる) |
| `scripts/maintenance/` | 運用保守 (定期実行 / 障害対応) |
| `scripts/one-shot/` | 一度限りの作業 (削除予定日コメント必須、§4 参照) |

サブディレクトリは必要になった時点で作る。既存ファイルは段階的に分類していく (`AGENTS.md` §5.3「既存ファイル統合優先」の原則と整合)。

## 3. 登録表

新規スクリプト追加時はここに追記する。「種別」は §2 のディレクトリ名のいずれか。「削除条件」は将来このスクリプトが不要になる条件。

| ファイル | 用途 | 実行コマンド | 種別 | 削除条件 |
|---|---|---|---|---|
| `check/golden-path-smoke.ts` | bridge を `forceEnabled` で叩き、AgentRun が 1 周回るか実 DB で確認 (jobs={} 全 step skip) | `npx tsx scripts/check/golden-path-smoke.ts` | check | `sideB_runtime_observability_smoke.ts` に `--rehearsal` フラグで統合された場合、または Job adapter wire-up 完了で別の検証経路に移行した場合 |
| `check/edge-hypothesis-not-testable-reasons.ts` | `EdgeHypothesis.statusNote` を 5 経路 (SO.A/B/C + SA.A/B) に分類集計、Screening 全 not_testable バグの真因特定 (P0) | `npx tsx scripts/check/edge-hypothesis-not-testable-reasons.ts [--since=YYYY-MM-DD] [--sample=N]` | check | Observer MVP (P1a) 内に同等の集計機能が統合された場合、または Screening 全 not_testable バグ再発監視が運用に乗った場合 |
| `check/analysis-engine-health.ts` | analysis-engine `/health` を 1 回 GET し、Screening 失敗が接続性そのものかを切り分ける (P0 サポート) | `ANALYSIS_ENGINE_URL=https://... npx tsx scripts/check/analysis-engine-health.ts` | check | Observer MVP (P1a) または専用 SRE ダッシュボードに analysis-engine 監視が統合された場合 |
| `one-shot/reeval-evolution-cost.ts` | コスト0で合格した既存進化候補をシンボル別コスト込みで再評価し、新 evolutionRunId の新規行として追加 (#303/#304 反映後の遡及評価) | `npx tsx scripts/one-shot/reeval-evolution-cost.ts [--limit N] [--dry-run]` | one-shot | 再評価を1回実施し結果確認後 (削除予定 2026-07-31) |
| (既存 40+ scripts) | ルール制定以前の資産、§7 に従い段階的に整理 | — | — | — |

## 4. one-shot スクリプトの制限

`scripts/one-shot/` 配下に置くスクリプトは原則として恒久化しない。作成時に冒頭へ以下を必ず記載する。

```ts
/**
 * 目的:
 * 実行条件:
 * 実行コマンド:
 * 作成日:
 * 削除予定:
 * 削除条件:
 */
```

実行後、削除条件を満たしたら **そのスクリプトと本 README §3 表の行を同時に削除する**。

## 5. テストファイルは scripts/ に置かない

テストは `src/**/*.test.ts` または `src/**/tests/` の既存テストファイルにケース追加するのが原則 (`AGENTS.md` §5.3)。`scripts/` にテストを置いてはならない。

## 6. 禁止例

- `scripts/foo-debug.ts` / `scripts/temp-*.ts` のような一時調査スクリプトを `scripts/` 直下に作る (→ `.tmp/` / `scratch/` を使い `.gitignore`)
- 同じ責務のスクリプトを微妙に名前を変えて複数置く (= 既存スクリプトへの統合検討漏れ)
- `scripts/README.md` 登録表に追記しないままファイル追加
- one-shot 用途のスクリプトを通常分類に置く (= 削除条件を曖昧にする)

---

## 7. 既存スクリプトの段階的整理 (進行中)

2026-05-17 時点で `scripts/` 配下に 40+ ファイルが存在する。**ルール制定以前の資産** で、まだ分類・登録が完了していない。新規 PR で `scripts/` に触れる際、当該スクリプトについて以下を判定して整理する。

1. 恒久 → §3 表に登録 + 必要なら §2 サブディレクトリへ移動
2. 削除予定 → 即削除 or one-shot に移動 (削除予定日コメント追加)
3. 重複 → 既存スクリプトに統合

一括整理 PR を別途立てる場合は、本 §7 を削除して通常運用に移行する。
