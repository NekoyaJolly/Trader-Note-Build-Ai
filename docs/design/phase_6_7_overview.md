# Phase 6.7 全体概要 — プロンプト改訂 + 即時バックテスト層

> 作成日: 2026-04-24
> 前提: Phase 6 系統(Phase 6, 6.5, 6 hotfix, 6.6)完走済み、本番稼働中
> 次フェーズ: Phase 7 (SMC)

---

## 0. このフェーズの位置づけ

Phase 6 までで「自律的にプロンプトが進化するエージェント群」の骨格は完成した。ただし実運用すると以下が明らかになった:

1. **戦略立案エージェントが scenarios=0(ノートレード推奨)で逃げる** — シナリオ提示自体を避ける傾向
2. **戦略の即時バックテストが存在しない** — Strategy Thinker が出した戦略を検証せずに下流に流している
3. **仮説生成の「新規発見」という責務が機能していない** — LLMが本当に新しい仮説を出すのは困難
4. **プロンプト間の共通ルールが各ファイルに散在** — C案(グローバル+ローカル)に整理されていない
5. **インフラ層に潜在バグ複数** — Registry経由でマクロ未展開、OHLCV休場日バグ、3系統並存のCORE_TRADING_RULES

Phase 6.7 は **Phase 7 (SMC) に進む前に** これらを片付ける中間フェーズ。

---

## 1. Phase 6.7 の範囲

Phase 6.7 は 3 つのサブフェーズに分割する:

| サブ | 内容 | 依存 |
|---|---|---|
| **6.7a** | インフラ整備(休場日バグ、マクロ展開統一、グローバル層導入) | — |
| **6.7b** | 即時BT層 + StrategyDSL拡張 | 6.7a |
| **6.7c** | プロンプト改訂(12本、C案対応) | 6.7a, 6.7b |

各サブフェーズは独立したドキュメントに分割:
- `phase_6_7a_infrastructure.md`
- `phase_6_7b_bt_layer.md`
- `phase_6_7c_prompts.md`

**順序厳守**: 6.7a(インフラ)→ 6.7b(BT層) → 6.7c(プロンプト)。後工程の改訂内容は前工程が決めた仕様に依存する。

---

## 2. 確定した設計方針(サマリー)

### 2.1 オーケストレーション構造
- **C案採用**: グローバルルール + ローカル(各エージェント)の2階層。衝突時はグローバル優先
- グローバルは Registry で versioned 管理(特殊 agentName `__global__`)

### 2.2 即時バックテスト層
- **B案採用**: 既存 `DSLBacktestAdapter` (Phase 5A) を `ValidationTool` 互換でラップ
- Python サービス新設は**しない**(既存の walk_forward と analysis-engine は維持)
- **Side-A独立経路**: noteId を介さず、DSLBacktestAdapter の結果を直接ツールに流す

### 2.3 StrategyDSL 拡張
- `parameters スイープ` (範囲指定) に対応
- **`wait_for_trigger`** エントリー形式を追加(複合条件でのエントリー待機)
- Strategy Thinker は固定値だけでなく探索範囲も出せるように

### 2.4 プロンプト責務再定義
- **Strategy Thinker**: `scenarios=0 禁止`、必ず最低1シナリオ(wait_for_trigger 活用)
- **HG (HypothesisGenerator)**: 「新規発見」を降ろし、「BTに投げる価値がある仮説候補を出す」に再定義
- **Discovery**: 「レンズ統計の専門家」に純化(ダウ理論/ワイコフ/SMC/エリオット等、複雑なレンズの統計を担当)
- **Strategist (解釈者)**: 現状維持(小幅調整のみ)
- **DevilsAdvocate**: 役割見直し(scenario単位反証 → BT結果の弱点指摘)
- **専門家3本**: 共通テンプレート化、Phase 7 SMC 専門家も同構造で載せる
- **進化系4本**: C案対応(mutation/crossover はBT即時検証前提、prompt_mutation/meta_evolutionはグローバル保護)
- **market_observer**: 廃止(死蔵)

### 2.5 インフラ修正
- **OHLCV休場日バグ**: 書き込み時 `isFXMarketOpen` でフィルタ。既存データは truncate して再収集
- **Registry × マクロ展開**: `loader.loadPromptWithMacros(content)` ユーティリティを Registry 戻り値にも噛ませる
- **CORE_TRADING_RULES 3系統並存**: グローバル層に統合

---

## 3. 仮説・戦略・BT の新しいパイプライン

Phase 6.7 完了後の想定フロー:

```
[レンズ観察] (trend/oscillator/volatility_volume/将来のSMC等 の専門家)
    ↓ 専門家分析
[Discovery] レンズ組み合わせの統計的有効性分析 → HGへのヒント(週次)
    ↓
[HG] 現状スナップショット + 専門家 + Discoveryヒント → 仮説候補(BT投入可能な形)
    ↓
[Strategy Thinker] 仮説から StrategyDSL を生成
   ・scenarios は必ず1つ以上(wait_for_trigger含む)
   ・固定値ではなくパラメータ範囲も指定可能
    ↓
[DSLBacktestAdapter] 即時BT + パラメータスイープ
    ↓
[ValidationTool wrapper] WalkForward / MonteCarlo / BuyAndHold
    ↓
[Strategist] 4ツール結果の解釈
    ↓
[DevilsAdvocate] BT結果の弱点指摘
    ↓
[Orchestrator] 仮想実行判断
```

---

## 4. Phase 6.7 が扱わない範囲(Phase 7 以降)

- **SMC レンズ・SMC 専門家の追加** → Phase 7
- **経済指標カレンダー・スプレッド情報の導入** → Phase 8+
- **Side-A MonteCarlo と Phase 4c MonteCarlo の2系統統合** → 将来フェーズ
- **分 Walk-Forward 化(真のローリング最適化)** → 将来フェーズ
- **複数銘柄×複数時間足への拡張** → Phase 7 以降で段階的に

---

## 5. 人間承認が必要な決定ポイント一覧

Phase 6.7 実装中、Claude Code が自動判断せず **Nekoさんの承認** を取るべき決定点:

| # | 決定ポイント | サブフェーズ | 所在 |
|---|---|---|---|
| 1 | グローバル層の最終的な文面(サイズ・章立て・禁止事項の範囲) | 6.7a | 付録A |
| 2 | 休場日フィルタ方式の最終確認(書き込み時で良いか) | 6.7a | 7a §2 |
| 3 | 既存OHLCVデータの truncate 実行 | 6.7a | 7a §2 |
| 4 | StrategyDSL 拡張仕様(parameters / wait_for_trigger の具体) | 6.7b | 7b §3 |
| 5 | wait_for_trigger のBT層での評価ロジック | 6.7b | 7b §4 |
| 6 | scenarios=0 禁止の具体表現(プロンプト文面) | 6.7c | 7c §2 |
| 7 | HG 改訂後プロンプトを experimental でデプロイするか active 直上書きか | 6.7c | 7c §3 |
| 8 | DevilsAdvocate の役割変更(BT結果反証に移行するか現状維持か) | 6.7c | 7c §5 |
| 9 | market_observer.md の物理削除 | 6.7c | 7c §6 |

---

## 6. 成功判定指標

Phase 6.7 完了時に以下が達成されていること:

1. `scenarios=0` 出力が**月次実績で 5% 未満**(旧: 30%超と推定)
2. Strategy Thinker の出力が **DSLBacktestAdapter に自動で流れ、BT結果が返る**
3. プロンプト Registry 経由でもマクロ展開が正しく動作する(回帰テストあり)
4. OHLCV テーブルに**土日バーが 0**(再収集後の確認)
5. **3系統並存の CORE_TRADING_RULES が 1系統に統合**される
6. 全12エージェントがグローバル層を参照する構造になっている

運用観察は Phase 6.7 完了後、**2〜4週間** を予定。観察期間中に問題が出なければ Phase 7 (SMC) に進む。

---

## 7. 調査・前提条件(Claude Code 向け追加タスク)

Phase 6.7 実装前に、以下の追加調査が必要:

### 調査タスク 1: StrategyDSL の現仕様
- `src/side-b/strategy_dsl/` の型定義(interface/type)を全て抽出
- 現仕様で `parameters スイープ` に相当するフィールドがあるか
- `entry.type` の union 値すべて
- `DSLBacktestAdapter` が受け付ける入力形式

### 調査タスク 2: 既存OHLCVに土日バーがあるか
```sql
SELECT symbol, timeframe, COUNT(*)
FROM "OHLCVCandle"
WHERE EXTRACT(DOW FROM timestamp AT TIME ZONE 'UTC') IN (0, 6)
GROUP BY symbol, timeframe;
```
→ 結果が 0 なら truncate 不要。行があれば truncate 実施

### 調査タスク 3: MonteCarlo 2系統の呼び出し元確認
- `src/services/backtest/monteCarloService.ts` を誰が呼んでいるか(UIなら運用影響あり)
- `src/side-b/validation/tools/MonteCarloTool.ts` は確定済み(仮説評価用)

---

## 8. 参考資料

- **前提調査**: `docs/design/phase6_prompt_audit.md`(プロンプト呼び出し実態調査)
- **BT層調査**: `docs/design/phase_x_bt_layer_audit.md`(Phase 4c 4ツール実装調査)
- **Phase 6 系統**:
  - `docs/design/phase_6_specification.md`
  - `docs/design/phase_6_hotfix_specification.md`
  - `docs/design/phase_6_6_specification.md`
- **既存基盤**: `docs/design/DESIGN_DOC_autonomous_trading_architecture.md`
- **本番執行シミュ層(Phase 6.8)**: `docs/design/phase_6.8_execution_simulation_specification.md`（6.7 の即時BT・検証の**執行忠実度**を引き上げる別枠; 6.7 完走後に参照）

---

## 9. 履歴

| 日付 | 内容 |
|---|---|
| 2026-04-24 | 初版作成(Phase 6 完走後、プロンプト見直し議論セッション成果物) |
