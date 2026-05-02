# Critical-1/1.5/1.6/7 修正シリーズ 24h 効果検証レポート

**観測日時**: 2026-05-01 21:00 UTC（デプロイから約 27.5h 後）  
**ベースライン**: 2026-04-30 17:30 UTC（PR #60〜#64 最終マージ直後）  
**観測者**: Claude Code (Supabase MCP + GitHub MCP による自動集計)  
**対象 PR**: #60 (Critical-1), #61 (Critical-7), #62 (Critical-1.5), #63 (後追い), #64 (Critical-1.6)

---

## 0. エグゼクティブサマリー

| 評価軸 | 判定 | 備考 |
|-------|------|------|
| Critical-1 (fresh lensSnapshot) | ✅ 効果確認 | `not_testable` 新規ゼロ、全件 screening 完走 |
| Critical-1.5 (timeframe='multi' 三層防御) | ✅ 効果確認 | 2026-05-01 新規 9 件すべて `{15m}` |
| Critical-1.6 (entryPriceHint 配線) | ✅ 効果確認 | timeout 一辺倒が解消、PF/勝率が正常値で集計 |
| Critical-7 (Discovery→HG discoveryHints) | ⚠️ 要継続観察 | HG usageCount 増加を確認。AITradePlan 最新が fallback のため直接検証困難 |
| 仮説品質 (screening_passed 到達) | ❌ 未達成 | 全 9 件 rejected (PF < 1.3, 勝率 < 40%)。Critical-10 着手を推奨 |
| BacktestRun 永続化 | ❌ 未解決 | BacktestRun テーブルが空。Critical-4 が継続中 |

---

## 1. EdgeHypothesis: status 分布

### 1-1. 全件

| status | 件数 | 最古 createdAt | 最新 createdAt |
|--------|------|---------------|---------------|
| rejected | **81** | 2026-04-23 01:32 UTC | 2026-05-01 12:53 UTC |
| (その他) | 0 | — | — |

**ベースライン比較**:

| ステータス | ベースライン (04-30 17:30) | 現在 (05-01 21:00) | 差分 |
|----------|--------------------------|-------------------|----- |
| rejected | 72 | 81 | **+9** |
| unverified | 0 | 0 | 0 |
| not_testable | 0* | 0 | 0 |
| screening_passed | 0 | 0 | 0 |
| confirmed | 0 | 0 | 0 |

*ベースライン時点では「今夜の screening 再実行後に全 rejected に整流」済み

### 1-2. 直近 24h で status が動いた仮説

| status | 件数 | statusUpdatedAt 範囲 |
|--------|------|---------------------|
| rejected | 9 | 2026-05-01 12:59〜14:15 UTC |

→ 05-01 04:37 と 09:37 と 12:53 の 3 バッチ（各 3 件）で HG が仮説生成し、screening が完走して rejected に遷移。  
→ **スクリーニングパイプラインが正常稼働していることを確認。**

---

## 2. timeframes 分布（Critical-1.5 効果確認）

| timeframes | 件数 | 備考 |
|-----------|------|------|
| {15m} | **33** | うち 9 件が 2026-05-01 新規生成 |
| {multi} | 48 | 全件 2026-04-30 以前の旧仮説（自然消滅なし） |

### 重要: 2026-05-01 新規生成 9 件の timeframes

| 仮説 ID (先頭8文字) | createdAt | timeframes |
|-------------------|-----------|----------|
| 87f602f3 | 04:37 | `{15m}` |
| 5b96accb | 04:37 | `{15m}` |
| c02513ae | 04:37 | `{15m}` |
| 73d6ac3d | 09:37 | `{15m}` |
| 6a0dd64b | 09:37 | `{15m}` |
| fb475c47 | 09:37 | `{15m}` |
| 3146108d | 12:53 | `{15m}` |
| 1f611409 | 12:53 | `{15m}` |
| bc47b40f | 12:53 | `{15m}` |

**✅ Critical-1.5 効果確認: 2026-05-01 生成の全 9 件で `{multi}` 混入ゼロ。**  
三層防御（HG プロンプト側・ScreeningOrchestrator 側・DB 書き込み側）が正常に機能している。

旧 `{multi}` 48 件は既存仮説として残存しているが、新規生成には `{multi}` が発生していないため実害なし。  
将来的な旧仮説の整理（deprecated への移行）は別タスクとして検討可。

---

## 3. statusNote 種別（Critical-1/1.6 効果確認）

| 分類 | 件数 | 代表的な statusNote |
|------|------|-------------------|
| PF不足のみ | 5 | `PF不足: 1.105 <= 1.3` |
| PF不足 + 勝率不足 | 76 | `PF不足: 1.087 <= 1.3; 勝率不足: 37.0% <= 40.0%` |
| **not_testable** | **0** | — |
| その他エラー | **0** | — |

**✅ Critical-1/1.6 効果確認: `not_testable` 件数ゼロ。**  
ベースライン以前は `Materialization失敗: atr_multiple SL...` や `not_testable` が全件に発生していた。  
fresh lensSnapshot + entryPriceHint 配線により、全仮説が正常に screening まで到達している。

---

## 4. 直近 24h で screening に到達した仮説（品質指標）

2026-05-01 に rejected に遷移した 9 件の screeningResult 抜粋:

| 仮説 ID (先頭8文字) | PF | 勝率 | tradeCount | 主要リジェクション理由 |
|-------------------|----|------|-----------|---------------------|
| 3146108d | 1.130 | 47.6% | 1000 | PF不足 |
| 1f611409 | 1.180 | 45.0% | 1000 | PF不足 |
| bc47b40f | 1.021 | 39.5% | 1000 | PF不足 + 勝率不足 |
| 87f602f3 | 1.196 | 21.0% | 1000 | PF不足 + 勝率不足 |
| 5b96accb | 1.159 | 30.0% | 1000 | PF不足 + 勝率不足 |
| c02513ae | 1.179 | 26.2% | 1000 | PF不足 + 勝率不足 |
| 73d6ac3d | 1.082 | 21.4% | 1000 | PF不足 + 勝率不足 |
| 6a0dd64b | 0.873 | 20.3% | 1000 | PF不足 + 勝率不足 |
| fb475c47 | 0.901 | 23.2% | 1000 | PF不足 + 勝率不足 |

**仮説品質指標（2026-05-01 新規 9 件）**:

| 指標 | 値 |
|------|---|
| PF 中央値 | **1.130** |
| PF 最大値 | 1.196 |
| PF 最小値 | 0.873 |
| 勝率 中央値 | **26.2%** |
| 勝率 最大値 | 47.6% |
| 勝率 最小値 | 20.3% |
| tradeCount | 全件 1,000 |
| screening_passed 件数 | **0** |

**ベースライン（2026-04-30 以前）との比較**:

| 指標 | ベースライン | 現在 | 変化 |
|------|------------|------|------|
| 勝率範囲 | 20〜33% | 20〜48% | 上限が改善 |
| PF 範囲 | 0.92〜1.13 | 0.87〜1.20 | 分散が広がる |
| timeout 一辺倒 | あり（Critical-1.6 修正前） | なし（正常集計） | ✅ 改善 |
| not_testable | 多数 | **0** | ✅ 解消 |
| screening_passed | 0 | **0** | → 変化なし |

**重要**: PF/勝率の集計値が「正常な現実値」になったことは Critical-1.6 の成果だが、  
閾値（PF > 1.3、勝率 > 40%）への到達はまだゼロ。仮説品質の改善は Critical-10 が担当。

---

## 5. AITradePlan（Critical-7 効果観察）

### 直近 2 件

| createdAt | overallConfidence | scenarios | warnings | aiModel |
|-----------|-------------------|-----------|---------|--------|
| **2026-05-01 18:30 UTC** | 0 | 0 件 | 1 件 | `fallback` |
| 2026-04-30 09:40 UTC | 0 | 1 件 | 5 件 | `anthropic/claude-4.6-sonnet-20260217` |

**05-01 18:30 のプラン（最新）の warnings**:
```
戦略生成に失敗したため、トレードは推奨しません。
```
→ HypothesisGenerator が呼び出される前に `fallback` モードに入った。  
→ discoveryHints 配線（Critical-7）の直接効果は現在の AITradePlan では **確認不能**。

**04-30 09:40 のプラン（前回、Critical-7 修正前）の warnings 抜粋**:
- `上位足4Hトレンド方向スコア=30（下降バイアス）と執行足strong_uptrendが逆方向` → MTF ルール警告
- `BB幅パーセンタイル=100 は過去最大水準のボラティリティ拡大` → フェイクアウトリスク
- `Oscillator Specialist confidence=0.1` → モメンタム系確認不足
- `resistance_proximity=95、4.21pips と極めて近接` → ブレイクアウト失敗リスク
- tokenUsage: 12,555

**PromptVersion による HG 稼働確認**:
- `hypothesis_generator` (active版) lastUsedAt: **2026-05-01 18:29:44 UTC**
- usageCount: 101（2026-04-25 以降の累積）
- 本日（05-01）も HG が動作していることは確認できる。
- discoveryHints が実際に渡されているかは AITradePlan.metadata に記録フィールドがないため、
  ログ監査か次の Discovery→HG 実行時の直接確認が必要。

---

## 6. PromptVersion: エージェント利用統計

### Active バージョン（phase-6.7c-20260425T115258Z-sync）

| agentName | usageCount | successCount | avgScore | lastUsedAt |
|-----------|-----------|-------------|---------|----------|
| hypothesis_generator | **101** | 75 | 0.574 | 2026-05-01 18:29 |
| trend_specialist | **113** | 71 | 0.496 | 2026-05-01 18:29 |
| oscillator_specialist | 82 | 72 | 0.622 | 2026-05-01 18:29 |
| volatility_volume_specialist | 82 | 73 | 0.663 | 2026-05-01 18:29 |
| devils_advocate | 20 | 10 | 0.209 | 2026-05-01 16:23 |
| discovery | 15 | 0 | 0.114 | 2026-05-01 16:23 |
| strategist | 20 | 20 | 0.604 | 2026-05-01 16:22 |
| prompt_mutation | 30 | 25 | 0.600 | 2026-05-01 16:23 |

### 旧バージョン（initial, deprecated）との比較

| agentName | 旧 avgScore | 現 avgScore | 差分 |
|-----------|-----------|-----------|------|
| hypothesis_generator | 0.609 | 0.574 | **-0.035** ⚠️ |
| trend_specialist | 0.521 | 0.496 | **-0.025** ⚠️ |
| oscillator_specialist | 0.679 | 0.622 | **-0.057** ⚠️ |
| volatility_volume_specialist | 0.721 | 0.663 | **-0.058** ⚠️ |

全スペシャリストで旧版より avgScore が低下している。phase-6.7c 移行後のプロンプト内容の変化が影響している可能性がある。  
ただし `discovery` の avgScore=0.114, successCount=0 は特に低く、Critical-8 の優先度根拠になる。

---

## 7. BacktestEvent / BacktestRun（Critical-9 / Critical-4 関連）

| テーブル | 行数 | 備考 |
|---------|------|------|
| BacktestRun | **0** | 空テーブル |
| BacktestEvent | **0** | 空テーブル |

**重要所見**:  
screeningResult の JSON には `backtestRunId` が記録されているが、`BacktestRun` テーブルには対応するレコードが存在しない。  
これは **Critical-4 (StrategyBacktester 結果永続化) が未解決** であることを示す。

```json
// screeningResult の例（EdgeHypothesis 内）
{
  "backtestRunId": "ad3df9b8-8acf-4a71-8be9-e02f875e07b5",
  "tradeNoteId": "5270dbb4-8e2d-4943-a18f-05f8e8e62181",
  "metrics": { "pf": 1.130, "winRate": 0.476, "tradeCount": 1000 }
}
// BacktestRun テーブルに上記 ID のレコードは存在しない
```

ベースラインの「win=1068 / loss=1847 / timeout=144」は Side-A（手動ノートマッチング）の BacktestEvent であり、  
Side-B の screening backtests は別系統で動作している。  
Side-B screening backtests の詳細データ（個別 trade の pnl・entryPrice 等）は現在 DB に保存されていない。

Critical-9（BT 集計矛盾）は Side-A 系の問題であり、PR #66 で `winCount/lossCount を pnl 符号で統一` として修正済み。  
ただし BacktestRun テーブルに行がないため、現時点では直接確認不能。

---

## 8. 次の Critical 着手 優先度判定

### 総合評価

```
現在の状態:
  仮説生成 → screening → rejected（全件）
              ↑
         ここでつまっている → Critical-10 が必要
```

### 優先度マトリクス

| Priority | Critical | 根拠 | 期待効果 |
|----------|---------|------|--------|
| **1位** | **Critical-10** | PF 中央値 1.13 で閾値 1.3 に届かない。全仮説が rejected のため PDCA サイクルが回らない | 初の `screening_passed` 創出。HG プロンプト改良・SL ATR 倍率・RR 比調整 |
| **2位** | **Critical-4** | BacktestRun テーブルが空。screening backtest の個別トレードデータが消失。品質改善のフィードバックループが成立しない | backtest データ蓄積開始、トレード水準での分析が可能に |
| **3位** | **Critical-8** | discovery usageCount=15 で successCount=0, avgScore=0.114 と機能不全。Critical-7 で配線済みだが HG に有効な hints を渡せていない疑い | Discovery エージェント改善 → HG に有用な discovery hints が渡る → 仮説品質向上に貢献 |
| **4位** | **Critical-9** | PR #66 で算出ロジック修正済み。BacktestRun が空のため影響なし。Critical-4 完了後に再確認 | BT 集計の信頼性向上 |
| **5位** | **Critical-PrismaClient** | PR #69/70 で backend/services + backend/repositories は解決済み。残存 10〜15 箇所は実害なし | コード品質・接続安定性 |

### 推奨: Critical-10 の着手内容

以下の 3 軸で仮説品質を改善する:

1. **HG プロンプト改良** (`src/side-b/prompts/hypothesis_generator.md`)
   - 現在の PF 分布（中央値 1.13）を踏まえ、より有望なエントリー条件を生成するよう誘導
   - avgScore が旧版より低下（0.609 → 0.574）している原因を調査

2. **SL ATR 倍率の見直し** (`src/side-b/` の defaultRiskManagement 生成箇所)
   - 現在の ATR 倍率が大きすぎてリジェクトされている可能性を調査
   - screeningResult の PF が 0.87〜1.20 に集中している原因分析

3. **screening 閾値の妥当性確認** (`src/side-b/` の ScreeningOrchestrator)
   - PF > 1.3 / 勝率 > 40% の閾値が XAU/USD 15m に対して適切かを AGENTS.md で確認
   - ただし `CLAUDE.md` 5条: **「閾値は設計書で議論される場合のみ変更可」** を厳守

---

## 9. 未確認・要継続観察項目

| 項目 | 理由 | 推奨アクション |
|------|------|--------------|
| Critical-7 の discoveryHints 実効性 | AITradePlan 最新が fallback のため HG への伝達未確認 | 次回 Plan 生成成功時に metadata / HG 出力ログを確認 |
| {multi} 旧 48 件の処理方針 | 新規生成ゼロを確認。旧仮説は screening 結果は存在するが永続化なし | 別タスクで `deprecated` 移行を検討 |
| BacktestRun 空の影響範囲 | Side-B screening backtests の詳細データ消失 | Critical-4 着手時に設計確認 |
| PromptVersion avgScore 低下 | 全専門家で旧版より低下。プロンプト変更の影響か | Critical-10 の一部として調査 |

---

## 10. 変化サマリー表（ベースライン比較）

| 指標 | ベースライン (04-30 17:30) | 現在 (05-01 21:00) | 変化 |
|------|--------------------------|-------------------| ----|
| EdgeHypothesis 総件数 | 72 | **81** | +9 |
| status: rejected | 72 | 81 | +9 |
| status: not_testable | 0 (整流後) | **0** | ✅ 維持 |
| status: screening_passed | 0 | 0 | 変化なし |
| timeframes: {multi} 新規 | 存在 | **0** | ✅ Critical-1.5 効果 |
| timeframes: {15m} 新規 | — | 9 | 正常 |
| statusNote: not_testable 系 | 0 (整流後) | **0** | ✅ 維持 |
| BT 勝率 最大値 | ~33% | **47.6%** | ↑ 改善 |
| BT PF 最大値 | ~1.13 | **1.196** | ↑ 微改善 |
| AITradePlan fallback 率 | — | 1/2 (最新が fallback) | ⚠️ 要注意 |
| BacktestRun 永続化 | 未確認 | **0件 (空)** | ❌ Critical-4 継続 |

---

*生成: Claude Code / Supabase MCP (project: rmsylwmqxyeqgplysqoa) + GitHub MCP*  
*次回観察推奨: Critical-10 着手後の screening 1 サイクル完了時点*
