# 自律型トレーディングAI アーキテクチャ設計ドキュメント

> **目的**: Side-B AI Trade System を、AI が自律的に市場を観察し、仮説を立て、検証し、エッジ台帳を育てながら運用できるシステムに進化させるための設計指針。
> **作成背景**: 現状の Side-B は AI がテクニカルルールに従ってシナリオを出す設計だが、「エッジそのものを発見・定式化・検証する思考」のレイヤーが弱い。この設計書はその空白を埋めるためのもの。
> **最終更新**: Phase 5.5 完了時点。Phase 1-3, 4a, 4b 縮小版, 4c, 4d, 5A, 5.5 実装済み。Phase 5B, 6 未着手。

---

## 1. 設計哲学

### 1.1 根本原則

このシステムは以下の原則に立脚する。実装判断で迷った時は、ここに立ち返る。

**原則1: 優先順位ではなく、判断品質のメタルールを与える**
人間由来の「SMA最優先、次にADX...」のような優先順位注入は、AI の思考を固定しエッジ発見を殺す。代わりに「単独指標判断禁止」「採用理由の明示」「オッカムの剃刀」といった判断の作法だけを与える。

**原則2: レンズは排他選択ではなく並列計算**
ダウ理論、エリオット波動、SMC、時間帯、月相 ― あらゆる相場観は「どれを信じるか」ではなく「どれも同時に観測する」。どのレンズが効くかは実データが事後的に語る。

**原則3: LLM に期待することを限定する**
LLM は「構造の発見」「結果の解釈」「失敗からの学習」に強い。「数値最適化」「大量データの統計処理」「厳密な客観判定」は Python または TypeScript の決定論的コードに任せる。LLM の創造性が及ぶ範囲を明確に限定する。

**原則4: 検証可能性を絶対に捨てない**
エリオット波動のカウントのような主観判定はアルゴリズム化しない。客観的に測定可能な要素だけを機械判定層に組み込み、主観が必要な概念は確率分布として扱う。統計的検証を通過していないものは confirmed に昇格させない。

**原則5: 人間との共通言語を維持する**
AI がベクトル空間で発見したパターンは必ず人間語に翻訳して記録する。翻訳できないパターンは採用しない。ブラックボックスを避ける。

**原則6: 勝ちを急がない**
短期的なゴールは「勝つ」ではなく「エッジ台帳の成長速度を最大化する」。台帳が育てば勝ちは後から付いてくる。

**原則7: 協業パートナーとしての Side-A / Side-B**(Phase 4b で明確化)
Side-A(人間向け分析・検証基盤)と Side-B(AI 自律分析基盤)は **独立した協業パートナー関係** にある。どちらかがどちらかに従属しない。両者は特定のブリッジ層で情報を共有するが、独立性を保つ。

### 1.2 人間の学習プロセスの模倣と、その限界

人間のトレーダーは「フラットから観察 → エッジ発見 → ノート化 → 類似性で発動」という経路で上達する。この経路は AI にも有効だが、以下の制約がある:

- 人間は言語化できない身体的記憶・情動的記憶を持つが、LLM は言語的記憶しか持てない
- だから人間の「3つの記憶システム」のうち「言語化されたもの」だけを極端に高速に回すのが AI の戦い方
- 純粋な強化学習(エンドツーエンド)は実相場で失敗しやすい。LLM + ツール使用 + エッジ台帳のハイブリッドが現実解

### 1.3 Note 統一モデル(Phase 4b で確立)

このシステムで最も重要な概念の一つ。

**全ての戦略的知恵は「Note」に統一表現される**。どんな経路で生まれたアイディアも、最終的には Note として保存され、同じ検証パイプラインを通る:

- Strategy Thinker が作った戦略 → Note化
- Hypothesis Generator が作った仮説 → Note化
- Discovery AI の発見 → Note化
- Reflection からの学び → Note化
- 進化ループで生まれた DSL 戦略 → Note化(Phase 5B 予定)

市場からの入力に対して、Note との類似性を検出する仕組みが共通の発動メカニズムとなる。これは人間トレーダーが実際に行う「ある手法をチャートで見て、過去の類似パターンと比較する」行為を模している。

### 1.4 最終的なエージェント階層

このプロジェクトは最終的に以下の構成を持つ。Phase 4c 完了時点で **2層エージェント構造** が確立された:

**【上位層】判断するエージェント**
- **Strategist Agent**: 検証結果の総合判定と LLM による解釈
- **Hypothesis Generator**: 観察から仮説を生成する専門役
- **Strategy Thinker**: 仮説を実行可能な戦略(JSON DSL)に落とす
- **Devil's Advocate**: 戦略を叩く反証専任
- **Reflection AI**: トレード結果から学びを抽出、エッジ台帳を更新
- **Discovery AI**(週次): レジーム別に効いているレンズ/指標を洗い出す調査員

**【中位層】束ねるエージェント**
- **Backtester Agent**: 検証ツール群の並列実行統括(LLM 不使用、決定論的オーケストレーター)
- **Market Observer**: 並列レンズで全特徴量を出力(LLM 不使用、LensAggregator)

**【下位層】検証ツール群(Phase 4c)**
- **BacktestScreeningTool**: Side-A BacktestService のラッパー
- **WalkForwardTool**: Python + vectorbt(Docker)
- **MonteCarloTool**: TypeScript 自前実装
- **BuyAndHoldTool**: TypeScript 自前実装

**【進化系】(Phase 5A)**
- **Mutation Agent**: LLM による戦略変異オペレーター
- **Crossover Agent**: LLM による戦略交配オペレーター

背後で **進化的探索ループ**(Phase 5A) が戦略集団を世代交代させ、進化由来候補の Phase 4c 接続は Phase 5B で実装予定。

---

## 2. システム全体像

### 2.1 4つの柱と既存基盤の関係

```
┌─────────────────────────────────────────────────────────┐
│  柱4: スキル基盤(Phase 5.5)                              │
│  SkillRegistry / 統一インターフェース / MCP 互換          │
├─────────────────────────────────────────────────────────┤
│  柱3: 進化的探索ループ(Phase 5A / 5B)                    │
│  戦略JSON DSL / 変異・交配オペレーター / 淘汰ロジック      │
├─────────────────────────────────────────────────────────┤
│  柱1: AIロール分化 + 検証パイプライン                      │
│  Hypothesis / Strategist / Backtester / Tools /         │
│  Devil's Advocate / Reflection / Discovery              │
├─────────────────────────────────────────────────────────┤
│  柱2: 並列レンズ特徴量基盤                                 │
│  Lens インターフェース / レンズ群 / LensAggregator        │
├─────────────────────────────────────────────────────────┤
│  既存基盤(Side-A 含む、協業パートナー)                    │
│  Side-B システム / PDCA ループ / AgentMemory /           │
│  Side-A BacktestService / walkForwardService / MCP      │
└─────────────────────────────────────────────────────────┘
```

### 2.2 積み上げ順序

この順序は交換不可能。理由:

- 柱2(レンズ基盤)ができてないと、柱1のエージェントが何をデータとして受け取るか決まらない
- 柱1の役割分化ができてないと、柱3の進化ループで何を変異させるのか(戦略? 仮説? プロンプト?)が決まらない
- 柱4(スキル基盤)は柱1と柱3がある程度固まってから整備する方が、必要なスキル範囲が明確になる
- 既存基盤を壊さないように柱2を被せる → 柱1を足す → 柱3を被せる、という順序なら既存機能を常に動作させながら進化できる

### 2.3 データフロー(Phase 5A 完了時点)

```
市場データ
   ↓
[Market Observer] ── 全レンズで並列計算 ──→ LensFeatureSnapshot
   ↓
[Discovery AI] ←── 週次でレンズ有効性を分析
   ↓                                        ↑
[Hypothesis Generator] ── 仮説群 ──→ EdgeLedger(unverified)
   ↓                                        ↓
[Strategy Thinker] ── 戦略 ──→ Note(統一表現)
   ↓
[Devil's Advocate] ── 反証フィードバック ──→ Note(改訂)
   ↓
[ScreeningOrchestrator] ── 事前スクリーニング ──→ screening_passed
   ↓
[Strategist Agent]
   ├→ [Backtester Agent] ── 並列実行統括
   │    ├→ BacktestScreeningTool(TS)
   │    ├→ WalkForwardTool(Python)
   │    ├→ MonteCarloTool(TS)
   │    └→ BuyAndHoldTool(TS)
   ↓
EdgeLedger(confirmed/rejected 判定)
   ↓
[仮想トレード実行]
   ↓
[Reflection AI] ── 学び抽出 ──→ EdgeLedger(更新)
   ↓                                        ↑
[進化的探索ループ(Phase 5A)] ─ 戦略集団の世代交代
   ↓
promotionCandidates(JSON レポート)
   ↓
[Phase 5B: 4c 接続]── 未実装
```

### 2.4 UI スイッチングの実現方法

ユーザーが「エリオットを使う/使わない」を切り替えたい要求は、**レンズの ON/OFF ではなく、検索時の重み付け** で実現する。

- 全レンズは常に計算される(記録は変わらない)
- エッジ台帳検索時、ユーザー設定に応じて各レンズ次元の重みを変える
- これによりエッジ台帳の蓄積は分断されず、かつユーザーの好みは反映される
- 「モード」として事前設定を用意: "クラシカルモード"(ダウ中心)、"SMC モード"、"エリオット重視モード"、"データドリブンモード"(全フラット)等

### 2.5 Side-A / Side-B の協業パートナー関係

**Phase 4b で確立された公式関係**:

- **Side-A**: 人間のトレーダー向けの検証・分析基盤(既存)
- **Side-B**: AI エージェントによる自律分析・仮想トレード基盤
- 両者は独立性を保ちつつ、特定のブリッジ層で情報を共有する
- どちらかがどちらかに従属することはない
- 両者は同じ TradeNote プールを共有できる(Phase 4b の materialization 層経由)

実装上の含意:
- Side-A のコードは Side-B の変更で破壊しない
- Side-B から Side-A の機能を利用する時は、外部 API として扱う
- 両者の Note 型(TradeNote / AITradeNote)は別モデルのまま、必要に応じてブリッジ経由で変換

---

## 3. エッジ台帳のデータモデル

### 3.1 EdgeHypothesis 型

```typescript
interface EdgeHypothesis {
  id: string;
  statement: string;                    // 人間語の仮説文
  category: 'time' | 'level' | 'event' | 'correlation' | 
            'positioning' | 'volatility' | 'structure' | 'other';
  conditions: MachineReadableCondition[];  // 機械判定可能な条件
  expectedDirection: 'long' | 'short' | 'either';
  
  // ライフサイクル(Phase 4b で拡張)
  status: 'unverified' | 'screening_passed' | 'testing' | 'confirmed' 
        | 'rejected' | 'stale' | 'insufficient_data' | 'not_testable';
  
  // 実績
  observationCount: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  totalPnlPips: number;
  avgRR: number;
  
  // 検証(Phase 4b 以降)
  defaultRiskManagement?: {
    stopLoss: { type: 'atr_multiple' | 'rr_ratio'; value: number };
    takeProfit: { type: 'rr_ratio' | 'atr_multiple'; value: number };
    maxHoldingBars?: number;
  };
  materializedTradeNoteIds?: string[];
  screeningResult?: ScreeningResult;       // Phase 4b
  fullValidationReport?: ConsolidatedValidationReport;  // Phase 4c
  confirmationInterpretation?: string;     // Phase 4c(LLM 解釈)
  rejectionInterpretation?: string;        // Phase 4c(LLM 解釈)
  actionableInsights?: string[];           // Phase 4c(改善提案)
  
  // メタデータ
  source: 'ai_generated' | 'reflection' | 'user_input' | 'backtest' | 'discovery';
  // Phase 5B で 'evolution' 追加予定
  lensRelevance?: Record<string, number>;
  firstObservedAt: Date;
  lastObservedAt: Date;
  lastTestedAt?: Date;
}
```

### 3.2 ステータス遷移(Phase 4b/4c 完了時点)

```
unverified ──→ screening_passed ──→ testing ──→ confirmed
     │              │                   │          │
     │              │                   │          ↓
     │              │                   │         stale
     │              │                   │
     │              └────→ rejected ────┘
     │
     ├──→ insufficient_data(期間不足)
     └──→ not_testable(Side-A BT 変換不能)
```

### 3.3 昇格条件(screening_passed → confirmed)

Phase 4c の 4 ツール全てが passed すること:

- **BacktestScreeningTool**: 学習 PF > 1.3, 勝率 > 40%, トレード数 >= 20(Phase 4b 時点の基準、Phase 4c で再評価)
- **WalkForwardTool**: 過学習スコア < 0.3
- **MonteCarloTool**: 95% 信頼区間の下側 PnL が 0 以上
- **BuyAndHoldTool**: バイアンドホールドを 0.5% 以上上回る

**判定は全て決定論的ロジック**。LLM は結果解釈のみ。

### 3.4 降格条件(confirmed → stale)

- 直近10回の発動で勝率が期待値から有意に乖離
- 経過期間が長い(例: 6ヶ月再検証なし)

---

## 4. 並列レンズ仕様

### 4.1 Lens インターフェース

```typescript
interface Lens {
  readonly name: string;              // ユニーク識別子
  readonly version: string;            // バージョン管理用
  readonly dependencies: string[];     // 必要な入力データ種別
  
  compute(input: MarketData): Promise<LensFeature>;
}

interface LensFeature {
  lensName: string;
  lensVersion: string;
  features: Record<string, number | string | boolean>;
  computedAt: Date;
  computeDurationMs?: number;
  confidence?: number;  // レンズ自身の出力への確信度(任意)
}
```

### 4.2 実装済みレンズ(Phase 1-3)

| レンズ名 | 出力例 | フェーズ |
|---------|--------|---------|
| current_analysis | 既存 MarketAnalysis をラップ | 1 |
| time_session | tokyo_active, ny_active, minutes_since_ny_open, etc. | 1 |
| dow_theory | higher_high, higher_low, trend_state, phase | 3 |
| volatility_regime | bb_width_percentile, atr_change_rate, regime_label | 3 |

### 4.3 Phase 6 で追加予定のレンズ

| レンズ名 | 出力例 | サブフェーズ |
|---------|--------|-----------|
| elliott_simple | rule_violations, wave_candidates(確率分布), fib_fit_score | 6.2 |
| smc | liquidity_sweep_detected, fvg_present, order_block_proximity | 6.3 |

### 4.4 将来追加候補

- structure_pivots: recent_swing_high, recent_swing_low, pivot_age_bars
- moon_phase: phase_name, days_from_full_moon
- その他運用観察で見えてきたもの

### 4.5 レンズ実装規約

- **副作用なし**: レンズは純関数に近い実装。計算以外の I/O は禁止
- **独立性**: 他のレンズの出力に依存しない。必要なら元データから再計算
- **決定性**: 同じ入力に対して同じ出力を返す。ランダム要素禁止
- **高速**: 1レンズの計算は可能な限り軽量に。全レンズ合計でも数百 ms に収まる
- **バージョン管理**: 内部ロジック変更時は `version` を上げる

---

## 5. エージェント設計

### 5.1 Market Observer

- **役割**: 相場データを受け取り、全レンズを並列実行して LensFeatureSnapshot を出力
- **実装**: LLM ではなく純粋な TypeScript クラス(LensAggregator)
- **出力**: 全レンズ出力を統合した Record 型

### 5.2 Hypothesis Generator

- **役割**: LensFeatureSnapshot から「もし〜なら〜という偏りがある」という仮説を複数生成
- **実装**: LLM、システムプロンプトは "探索モード" を強制する設計
- **禁止事項**: 文献でよく見る組み合わせの提案、有名戦略名の使用
- **出力**: HypothesisCandidate[](最低5個)
- **Phase 4b 以降**: defaultRiskManagement を含めて出力

### 5.3 Strategy Thinker

- **役割**: 仮説3つ → 自己反証 → 戦略化 の3ステップ
- **出力**: 戦略を Note として保存(Phase 4b で Note 統一モデル確立)

### 5.4 Devil's Advocate

- **役割**: Strategy Thinker の出力を叩く。「この戦略が負ける具体シナリオを3つ」だけを考える
- **実装**: LLM、極めてシンプルなプロンプト
- **出力**: WeaknessAnalysis(戦略の弱点3つ + 修正提案)

### 5.5 Strategist Agent(Phase 4c で確立)

- **役割**: 検証結果の総合判定と LLM 解釈
- **実装**: LLM + 決定論的判定ロジック(StatusManager)
- **重要原則**: **LLM は判定しない、解釈のみ**。昇格/棄却の決定は StatusManager の決定論的ロジック

### 5.6 Backtester Agent(Phase 4c で確立)

- **役割**: 検証ツール群の並列実行統括
- **実装**: 純粋な TypeScript オーケストレーター、LLM 不使用
- **並列実行**: Promise.allSettled で部分失敗許容

### 5.7 Reflection AI

- **役割**: トレード結果の振り返り + エッジ台帳への書き込み
- **改修履歴**: 「新規仮説発生」「既存仮説確認」「既存仮説反証」を分類

### 5.8 Discovery AI

- **役割**: 週次実行、レジーム別に効いているレンズ/指標の組み合わせを洗い出す
- **実装**: LLM + 統計分析ツール
- **出力**: WeeklyDiscoveryReport

### 5.9 Mutation Agent / Crossover Agent(Phase 5A)

- **役割**: 戦略 DSL の変異/交配オペレーター
- **実装**: LLM + JSON パース(3回リトライ)
- **呼び出し頻度**: EvolutionLoop の各世代

### 5.10 プロンプト管理

各エージェントのシステムプロンプトは **独立したファイル** として管理:

```
src/side-b/prompts/
  strategy_thinker.md      (使用中)
  discovery.md             (使用中)
  hypothesis_generator.md  (使用中)
  strategist.md            (使用中)
  devils_advocate.md       (使用中)
  mutation.md              (使用中)
  crossover.md             (使用中)
  market_observer.md       (未使用、保留)
```

**インラインプロンプト残存**: ResearchAIService, ReflectionAIService には LLM 呼び出しがインラインで記述されている箇所がある。Phase 6.1(プロンプト進化基盤)着手時にファイル化を検討。

Phase 6.1 でプロンプト自体が進化的探索の対象になるため、コードから分離する意義がある。

---

## 6. 進化的探索ループ(Phase 5A)

### 6.1 戦略 JSON DSL

戦略を機械可読・機械実行可能な形式で表現。詳細は `phase_5a_specification.md` 参照。

主要構造:
- `id`, `metadata`, `regimeTarget`
- `entryConditions`(ConditionGroup、AND/OR 入れ子可能)
- `exitConditions`, `riskManagement`
- `parameters`(可変パラメータ、進化対象)

条件式は数値比較、範囲、集合、パラメータ参照、論理演算を評価可能。

### 6.2 世代交代のサイクル

```
1. 現集団をバックテストで評価(TS シミュレーション、DSLBacktestAdapter)
2. エリート保存 + 淘汰
3. LLM による変異(MutationAgent)
4. LLM による交配(CrossoverAgent)
5. DiversityEnforcer で多様性維持
6. 昇格候補の抽出(厳格3条件: trainPF > 1.5, validPF > 1.3, overfit < 0.3)
7. GenerationReport 生成(promotionCandidates 含む)
```

### 6.3 Phase 5A / 5B 分割(重要な設計判断)

**Phase 5A(実装済み)**:
- 候補生成まで実装
- 自動 confirmed 昇格は **行わない**
- 候補は `promotionCandidates` 配列に保持(JSON レポート)

**Phase 5B(未実装)**:
- 候補を Phase 4c 精密検証に接続する仕組み
- 設計判断は運用観察データを経て確定

分割理由: 進化ループ内の TS シミュレーションだけで confirmed させると、Phase 4c の WF/MC/BH を通っていないため、confirmed の意味論がソース依存になる。これを避けるため自動昇格を切り離した。

### 6.4 実行頻度と制約

- 戦略進化: 手動トリガーのみ(autoEvolution=false がデフォルト)
- プロンプト進化: Phase 6.1 で実装予定
- リソース上限: レジーム間 30 秒スリープ、集団サイズ調整可能

---

## 7. スキル基盤(Phase 5.5)

### 7.1 目的

Side-B のエージェント群が自律的に動くための「スキル」(ツール化された操作群)を統一インターフェースで公開する。

### 7.2 SkillRegistry

スキルの登録・列挙・実行を管理する中央マネージャー。既存の MCP ツール(`McpClientManager`)と同形インターフェースを提供し、将来の AgentLoop 統合に備える。

### 7.3 実装された MVP スキル(8 個)

| カテゴリ | スキル | ラップ対象 |
|---------|--------|-----------|
| 仮説操作 | query_edge_ledger, get_hypothesis, register_hypothesis | EdgeLedger |
| 検証実行 | run_screening, run_full_validation | ScreeningOrchestrator, StrategistAgent |
| ノート/学び | read_recent_notes, record_lesson | aiNoteRepository, agentMemory |
| 市場観察 | compute_lens_features | LensAggregator |

### 7.4 Phase 6 以降との関係

- Phase 6.1 プロンプト進化で、スキル呼び出しパターンを最適化
- AgentLoop へのスキル群差し込みは Phase 6.1 着手時に検討

---

## 8. 段階的実装計画(現在の全体像)

| フェーズ | 内容 | ステータス |
|---------|------|----------|
| 1 | 並列レンズ基盤(current_analysis, time_session) | 完了 |
| 2 | AIロール分化(Devil's Advocate, Strategy Thinker 3ステップ) | 完了 |
| 3 | レンズ拡張(dow_theory, volatility_regime) | 完了 |
| 4a | エッジ台帳、HypothesisGenerator、Discovery AI | 完了 |
| 4b(縮小版) | Note 統一基盤、事前スクリーニング | 完了 |
| 4c | 検証ツール群(WF/MC/BH)+ 2層エージェント | 完了 |
| 4d | Side-B 検証UI 完全実装 | 完了 |
| 5A | 戦略 DSL、進化ループ(候補生成まで) | 完了 |
| 5.5 | スキル基盤 MVP | 完了 |
| 5B | 進化候補の Phase 4c 接続 | 未実装(運用観察後) |
| 6.1 | プロンプト進化基盤 | 未実装 |
| 6.2 | Elliott Simple Lens | 未実装 |
| 6.3 | SMC Lens | 未実装 |

各フェーズは独立した `phase_N_specification.md` ファイルを持つ。Claude Code への発注時はそのファイルを主入力として渡す。

---

## 9. 重要な設計上の禁止事項

以下は実装時に絶対に侵犯してはならない。

- **既存の MarketAnalysis / featureVector / AgentMemory のデータ構造を破壊的変更しない**。新機能は常に後方互換のラッパー or 拡張として実装
- **Side-A のコードを Side-B の変更で壊さない**(協業パートナー原則)
- **UI の全機能停止を伴う移行をしない**。既存機能が動き続けながら新機能を重ねる
- **一度に複数フェーズを並行着手しない**。1フェーズ完了 → 運用確認 → 次フェーズ
- **AI 独自のブラックボックスパターンをエッジ台帳に記録しない**。人間語への翻訳が必須
- **"暗記した" 成績でエッジを昇格させない**。未知データでの検証必須
- **LLM に昇格判定をさせない**。LLM は解釈のみ、判定は決定論的ロジック
- **統計的検証を飛ばした自動昇格を行わない**(Phase 5A の設計教訓)

---

## 10. 成功の指標

このアーキテクチャが機能しているかは以下で測る:

- **短期(3ヶ月)**: エッジ台帳に `confirmed` ステータスのエントリが5個以上
- **中期(6ヶ月)**: 仮想トレードの月次 PF が 3ヶ月連続で 1.3 以上
- **長期(1年)**: Discovery AI が発見した「人間が気付かなかった組み合わせ」で稼働中のエッジが存在

勝率や PnL は副次的指標。**エッジ台帳の成長と、そのエッジの再現性** が主要指標。

---

## 11. 設計教訓(実装を通じて得た知見)

### 11.1 仕様書の空白が実装に流出する

Phase 5 → Phase 5A への縮小、Phase 4 → Phase 4a/4b/4c/4d への分岐で学んだ教訓。

**データ構造の境界を跨ぐ箇所は、必ず詳細仕様を書く**。暗黙の了解に任せると、Claude Code が最小侵襲で埋めた結果として予期しない挙動(例: `[DSL:uuid]` プレフィックスが UI に露出)が発生する。

### 11.2 他 AI との壁打ちの価値

Phase 5A への縮小判断は、他 AI との壁打ちで得られた指摘が決め手となった。設計者の盲点を外部視点で補う手法として有効。実装中の AI(Claude)は実装の流れに引きずられやすく、より大きな設計判断では外部視点が必要。

### 11.3 急いで作ろうとすると意味論が壊れる

Phase 5 の自動 confirmed 昇格、Phase 4 で Side-A 検証基盤に無理に接続しようとした試み ― これらは「早く完成させたい」気持ちから意味論的な妥協をしかけた事例。

**設計の整合性を犠牲にして速度を取ると、後で大きな手戻りになる**。

### 11.4 既存を壊さない重要性

Side-A と Side-B の協業パートナー関係、MaterializationService による片方向ブリッジ、EdgeHypothesis の新フィールドを全てオプショナル化 ― これらは全て「既存を壊さない」原則の具体化。

動いているものを壊すコストは、新機能を付け加えるコストより遥かに大きい。

### 11.5 分割の価値

Phase 4 → 4a/4b/4c/4d、Phase 5 → 5A/5B の分割で学んだ教訓。

**一つの大きなフェーズを無理に完遂するより、小さなフェーズに分割して段階的に進める方が、設計の整合性を保ちやすい**。各段階で区切って運用観察を入れれば、次の段階の判断材料が増える。

---

## 12. 参考文献 / 関連研究

- Case-Based Reasoning (CBR): 過去事例に基づく判断の古典的 AI 手法
- Retrieval-Augmented Generation (RAG): 検索統合型 LLM 推論
- Generative Agents (Park et al., 2023, Stanford/Google): LLM エージェントの記憶・反省・計画の統合
- FinMem / TradingGPT / FinAgent: 金融特化 LLM エージェントの先行研究
- Promptbreeder / FunSearch: LLM を進化計算のオペレーターとして使う手法
- Regime-Switching Strategy: 市場状態別に戦略を切り替える機関投資家の設計思想

---

*この設計書は生きたドキュメントである。実装を進める中で発見された制約や改善点は、該当セクションに追記していく。*
