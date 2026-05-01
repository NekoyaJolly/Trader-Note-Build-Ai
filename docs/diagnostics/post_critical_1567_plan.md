# 明日以降の作業計画(2026-04-30 確定版)

> 本日 2026-04-30 に Critical-1 / 1.5 / 1.6 / 7 修正シリーズを完了 + PDCA-2 配管疎通を確認した次の段階の計画。
> Nekoさん 確認済み。

---

## 0. 設計上の重要確認(本日判明したこと)

### 3 つの独立した進化サイクル

```
PDCA-1 (Phase 6)    : エージェントのプロンプトを進化     [現状停止]
EvolutionLoop (Phase 5): 戦略 DSL を遺伝的アルゴリズムで進化 [現状死蔵]
PDCA-2 (Phase 4)    : LLM 仮説を BT で検証して台帳に集積  [本日疎通完了]
```

### EvolutionLoop の構造(`mutation.md` / `crossover.md`)

- mutation.md: 親エリート戦略を「強化・破壊・探索」する変異体を 3-5 個生成
  - **変異対象に SL/TP(ATR倍率、固定pips、RR比)が含まれる**
- crossover.md: 2 親戦略の強みを組み合わせて 1 子を生成
  - 「片方のエントリー条件 + もう片方の SL/TP 設定」の組み合わせ可
- → **EvolutionLoop が動けば SLTP / ATR 倍率の動的探索が自動で行われる**

### 今日決定した方針

- 固定 ATR 倍率(現状 HG プロンプトの推奨値 1.0-2.5)は本質的な解ではない
- EvolutionLoop が SLTP 探索を担う設計 → **Critical-10 の真の解は EvolutionLoop 起動**
- 昇格閾値(Phase 4b: PF 1.3 / 勝率 40%)は **据え置き**(Nekoさん 確認済み)

### 統合変更

旧 Critical-8(EvolutionLoop 死蔵)+ 旧 Critical-10(SLTP 動的化)→ **Critical-EvolutionStart** として統合。

---

## 1. 5/1 朝(自動 + Nekoさん レビュー)

### 自動進行

| 時刻(JST) | 内容 | 担当 |
|---|---|---|
| 09:00 | 自然 daily-plan サイクル発火(0:00 UTC)、新規仮説生成 | システム |
| (本番 SIDE_B_SCHEDULER_ENABLED=true 確認済み) | | |
| 03:30(翌朝) | 24h routine 起動 → 観察レポート PR 自動作成 | Remote Agent |

### Nekoさん 起床後

- routine 作成の PR(`docs(diagnostics): Critical-1/1.5/1.6/7 24h 効果検証レポート`) をレビュー
- マージは Nekoさん 手動(自動マージ無効化済み)
- レポート内容次第で Critical-9 着手判断

### 観察ポイント(routine が見る項目)

1. EdgeHypothesis status 推移(新規 not_testable が出ていないか = Critical-1/1.6 の永続効果)
2. timeframes に `'multi'` 混入の有無(Critical-1.5 の永続効果)
3. 自然サイクル後の screening 結果(勝率・PF 中央値の改善有無)
4. AITradePlan の `overallConfidence`(0 連続が解消したか = Critical-6)
5. discoveryHints が HG に届いたか(Critical-7)
6. BacktestEvent の outcome 比率(Critical-9 集計矛盾の再現)

---

## 2. 5/1-2: Critical-9(BT 集計矛盾)

### 症状

| 指標 | 値 | 矛盾点 |
|---|---|---|
| winCount | 0 | totalProfit=162.61 と矛盾 |
| lossCount | 0 | totalLoss=128.92 と矛盾 |
| timeoutCount | 259 | timeout の正 pnl が PF に算入されている |
| profitFactor | 1.26 | 全 timeout なら理論上 0 のはず |

### 原因仮説

- timeout イベントの pnl(正 / 負)が `totalProfit` / `totalLoss` に加算
- ただし `winCount` / `lossCount` は TP/SL ヒットのみカウント
- → メトリクスが整合性を持たない

### 着手箇所

- `src/backend/services/backtestCalculations.ts`(集計ロジック)
- `src/backend/services/strategyBacktestService.ts`(集計を呼ぶ側)
- timeout を winCount/lossCount に含めるか、totalProfit から除外するか、どちらで整合させるかを Nekoさん と相談

### 期待アウトプット

1 PR(中規模)、Nekoさん レビュー → マージ → 再度 reset → screening で集計修正効果確認

---

## 3. 5/1-2: GCP CRON_SECRET CRLF クリーンアップ

### 現状

- GCP Secret Manager の `CRON_SECRET` 末尾に CRLF(`\r\n`)が混入
- Cloud Run は CRLF 込みで認証している
- 現在は `?secret=値%0D%0A` workaround で叩けるが醜い

> ⚠️ **セキュリティ注意**: `?secret=...` をクエリパラメータに載せると、Cloud Run ログ・LB アクセスログ・プロキシログ等に URL が記録されシークレットが露出します。
> この workaround は **CRON_SECRET クリーンアップ完了までの暫定措置** です。  
> 使用する場合は curl ターミナルのみに留め、ログを共有しないこと。  
> **基本は `Authorization: Bearer <secret>` ヘッダ方式** を使用してください。

### Nekoさん の手作業(5 分)

```bash
gcloud secrets versions access latest --secret=CRON_SECRET --project=ai-note-486020 \
  | tr -d '\r\n' \
  | gcloud secrets versions add CRON_SECRET --data-file=- --project=ai-note-486020

gcloud run services update trader-note --region=asia-northeast1 --project=ai-note-486020
```

実行後、playbook の workaround `%0D%0A` を外して再テスト。

---

## 4. 5/3-4: Critical-EvolutionStart(旧 Critical-8 + 10 統合)

### 目的

EvolutionLoop を起動して SLTP / ATR 倍率の動的探索を有効化。

### サブタスク

1. 種 population の設計
   - HG 仮説 → `scenarioToStrategyDSL` 経由で DSL 化したものを種にする経路の確認
   - もしくは手動 seed の DSL を data/evolution/strategy-population.json に書き込む
2. `autoEvolution=true` 切替の判断(LLM コスト試算 + Nekoさん 承認)
3. 1 世代手動実行(`runEvolutionNow`)で動作確認
4. fitness 計算結果の確認(BT 完走 / 高 fitness 戦略の抽出)
5. 高 fitness DSL を edge ledger 候補として記録する経路確認

### 期待効果

- mutation.md / crossover.md が SLTP / ATR 倍率を自動探索
- 固定倍率問題が消える
- screening_passed 到達の現実味が出る

### リスク

- LLM コスト(複数レジーム × 複数世代 × 各個体)が大きい
- 設計判断を要するため Nekoさん と相談しながら進める

---

## 5. 5/5-7: 大規模リファクタ + 残スコープ

### Critical-PrismaClient(段階的集約)

- 27+ 箇所のモジュールトップレベル `new PrismaClient()` を `src/backend/db/client.ts` の singleton import に統一
- 3-4 PR に分割:
  - PR-A: backend/services/(8-10 ファイル)
  - PR-B: backend/repositories/ + backend/api/(5-7 ファイル)
  - PR-C: side-b/(8-10 ファイル)
  - PR-D: services/ + infrastructure/(残り)
- 各 PR 単体で CI 通すこと

### Critical-3 残スコープ

- 死蔵 8 体(strategist / devils_advocate / discovery / mutation / crossover / prompt_mutation / meta_evolution / bull_bear_debate)に scoring 関数追加
- 各エージェントで `recordUsage` を呼び出す経路追加
- 効果: 全 13 エージェントの avgScore / usageCount が記録される
- 1-2 PR(中規模)

---

## 6. 5/8+: 中長期

| Critical | 内容 | 依存 |
|---|---|---|
| Critical-6 | overallConfidence=0 連続(Critical-1 系の効果次第で解消の可能性) | 24h レポート |
| Critical-4 | StrategyBacktester per-plan 結果永続化(DB スキーマ追加) | Nekoさん 設計判断 |
| PDCA-1 起動 | scoring 完備後に `runPromptEvolutionNow` 手動実行 | Critical-3 残完了 |

---

## 7. 残課題まとめ(優先度順)

| # | Critical | 規模 | 開始予定 | 依存 |
|---|---|---|---|---|
| 1 | Critical-9(BT 集計矛盾) | 中 | 5/1-2 | 24h レポート結果 |
| 2 | CRON_SECRET CRLF クリーンアップ | 小 | 5/1-2 | Nekoさん 手作業 |
| 3 | Critical-EvolutionStart(統合) | 中-大 | 5/3-4 | Critical-9, Nekoさん 設計判断 |
| 4 | Critical-PrismaClient 集約 | 大(分割) | 5/5-7 | なし |
| 5 | Critical-3 残スコープ | 中 | 5/5-7 | なし |
| 6 | Critical-6 観察 | 小 | 5/8+ | 上記累積効果 |
| 7 | Critical-4 永続化 | 中 | 5/8+ | Nekoさん 判断 |
| 8 | PDCA-1 起動 | 小 | 5/8+ | Critical-3 完 |

---

## 8. 運用ルール(本日合意済み)

- PR は私が作成、**マージは必ず Nekoさん 手動**(自動マージ無効)
- prod write は要承認(reset-not-testable はその例外として認可済み)
- CLAUDE.md 原則 2「指定フェーズ範囲を超えない / ついで仕事禁止」厳守
- 各 Critical は独立 PR として刻む(複数フェーズ跨ぎ禁止)
- 設計判断が必要な箇所は勝手に決めず Nekoさん 確認

---

> 本計画は Nekoさん 確認後に確定。明日朝の 24h routine 結果を見て Critical-9 から着手予定。
