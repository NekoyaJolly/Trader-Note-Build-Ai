# 自律型トレーディングAI アーキテクチャ設計ドキュメント

> **目的**: Side-B AI Trade System を、AIが自律的に市場を観察し、仮説を立て、検証し、エッジ台帳を育てながら運用できるシステムに進化させるための設計指針。
> **作成背景**: 現状の Side-B は AI がテクニカルルールに従ってシナリオを出す設計だが、「エッジそのものを発見・定式化・検証する思考」のレイヤーが弱い。この設計書はその空白を埋めるためのもの。

---

## 1. 設計哲学

### 1.1 根本原則
このシステムは以下の原則に立脚する。実装判断で迷った時は、ここに立ち返る。

**原則1: 優先順位ではなく、判断品質のメタルールを与える**
人間由来の「SMA最優先、次にADX...」のような優先順位注入は、AIの思考を固定しエッジ発見を殺す。代わりに「単独指標判断禁止」「採用理由の明示」「オッカムの剃刀」といった判断の作法だけを与える。

**原則2: レンズは排他選択ではなく並列計算**
ダウ理論、エリオット波動、SMC、時間帯、月相 ― あらゆる相場観は「どれを信じるか」ではなく「どれも同時に観測する」。どのレンズが効くかは実データが事後的に語る。

**原則3: LLMに期待することを限定する**
LLMは「構造の発見」「結果の解釈」「失敗からの学習」に強い。「数値最適化」「大量データの統計処理」「厳密な客観判定」は Python に任せる。LLMの創造性が及ぶ範囲を明確に限定する。

**原則4: 検証可能性を絶対に捨てない**
エリオット波動のカウントのような主観判定はアルゴリズム化しない。客観的に測定可能な要素だけを機械判定層に組み込み、主観が必要な概念は確率分布として扱う。

**原則5: 人間との共通言語を維持する**
AIがベクトル空間で発見したパターンは必ず人間語に翻訳して記録する。翻訳できないパターンは採用しない。ブラックボックスを避ける。

**原則6: 勝ちを急がない**
短期的なゴールは「勝つ」ではなく「エッジ台帳の成長速度を最大化する」。台帳が育てば勝ちは後から付いてくる。

### 1.2 人間の学習プロセスの模倣と、その限界
人間のトレーダーは「フラットから観察 → エッジ発見 → ノート化 → 類似性で発動」という経路で上達する。この経路は AI にも有効だが、以下の制約がある:

- 人間は言語化できない身体的記憶・情動的記憶を持つが、LLMは言語的記憶しか持てない
- だから人間の「3つの記憶システム」のうち「言語化されたもの」だけを極端に高速に回すのが AI の戦い方
- 純粋な強化学習(エンドツーエンド)は実相場で失敗しやすい。LLM + ツール使用 + エッジ台帳のハイブリッドが現実解

### 1.3 最終的なエージェント階層
このプロジェクトは最終的に以下の7役のエージェントを持つ。これが完成形。

1. **Market Observer**: 相場を観察し、並列レンズで全特徴量を出力する(人間的判断なし)
2. **Hypothesis Generator**: 観察から仮説を生成する専門役
3. **Strategy Thinker**: 仮説を実行可能な戦略(JSON DSL)に落とす
4. **Devil's Advocate**: 戦略を叩く反証専任
5. **Edge Validator**: 戦略をバックテストに流し統計的有意性を判定
6. **Reflection AI**: トレード結果から学びを抽出、エッジ台帳を更新
7. **Discovery AI**(週次): レジーム別に効いているレンズ/指標を洗い出す調査員

これらに加え、背後で **進化的探索ループ** が戦略集団を世代交代させる。

---

## 2. システム全体像

### 2.1 3つのレイヤーと既存基盤の関係

```
┌─────────────────────────────────────────────────────────┐
│  柱3: 進化的探索ループ                                    │
│  戦略JSON DSL / 変異・交配オペレーター / 淘汰ロジック      │
├─────────────────────────────────────────────────────────┤
│  柱1: AIロール分化                                        │
│  Hypothesis / Devil's Advocate / Edge Validator / etc.  │
├─────────────────────────────────────────────────────────┤
│  柱2: 並列レンズ特徴量基盤                                 │
│  Lens インターフェース / レンズ群 / LensAggregator        │
├─────────────────────────────────────────────────────────┤
│  既存基盤                                                 │
│  Side-B システム / PDCA ループ / AgentMemory /           │
│  strategyBacktestService / walkForwardService / MCP     │
└─────────────────────────────────────────────────────────┘
```

### 2.2 積み上げ順序が絶対であること

この順序は交換不可能。理由:

- 柱2(レンズ基盤)ができてないと、柱1のエージェントが何をデータとして受け取るか決まらない
- 柱1の役割分化ができてないと、柱3の進化ループで何を変異させるのか(戦略? 仮説? プロンプト?)が決まらない
- 既存基盤を壊さないように柱2を被せる → 柱1を足す → 柱3を被せる、という順序なら既存機能を常に動作させながら進化できる

### 2.3 データフロー(完成形)

```
市場データ
   ↓
[Market Observer] ── 全レンズで並列計算 ──→ LensFeatureSnapshot
   ↓
[Discovery AI] ←── 週次でレンズ有効性を分析
   ↓                                        ↑
[Hypothesis Generator] ── 仮説群 ──→ HypothesisPool
   ↓                                        ↓
[Strategy Thinker] ── 戦略JSON ──→ StrategyCandidate
   ↓
[Devil's Advocate] ── 反証フィードバック ──→ StrategyCandidate(改訂)
   ↓
[Edge Validator] ── バックテスト → 昇格/棄却 ──→ EdgeLedger
   ↓
[仮想トレード実行]
   ↓
[Reflection AI] ── 学び抽出 ──→ EdgeLedger(更新)
   ↓                                        ↑
[進化的探索ループ] ←── 戦略集団の世代交代 ────┘
```

### 2.4 UIスイッチングの実現方法

ユーザーが「エリオットを使う/使わない」を切り替えたい要求は、**レンズのON/OFF ではなく、検索時の重み付け** で実現する。

- 全レンズは常に計算される(記録は変わらない)
- エッジ台帳検索時、ユーザー設定に応じて各レンズ次元の重みを変える
- これによりエッジ台帳の蓄積は分断されず、かつユーザーの好みは反映される
- 「モード」として事前設定を用意: "クラシカルモード"(ダウ中心)、"SMCモード"、"エリオット重視モード"、"データドリブンモード"(全フラット)等

---

## 3. エッジ台帳のデータモデル

### 3.1 EdgeHypothesis 型(新規追加予定)

```typescript
interface EdgeHypothesis {
  id: string;
  statement: string;                    // 人間語の仮説文
  category: 'time' | 'level' | 'event' | 'correlation' | 
            'positioning' | 'volatility' | 'structure' | 'other';
  conditions: MachineReadableCondition[];  // 機械判定可能な条件
  expectedDirection: 'long' | 'short' | 'either';
  
  // ライフサイクル
  status: 'unverified' | 'testing' | 'confirmed' | 'stale' | 'rejected';
  
  // 実績
  observationCount: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  totalPnlPips: number;
  avgRR: number;
  
  // 検証履歴
  backtestResults?: BacktestSummary;
  walkForwardResults?: WalkForwardSummary;
  
  // メタデータ
  source: 'ai_generated' | 'reflection' | 'user_input' | 'backtest' | 'discovery';
  lensRelevance?: Record<string, number>;  // どのレンズがこのエッジに効くかの推定
  firstObservedAt: Date;
  lastObservedAt: Date;
  lastTestedAt?: Date;
}
```

### 3.2 昇格条件(unverified → confirmed)

3つ全てを満たすこと:
- 学習期間バックテスト PF > 1.5
- 検証期間(未知データ)バックテスト PF > 1.3
- ウォークフォワード過学習スコア < 0.3

いずれか未達の場合は unverified または rejected のまま。

### 3.3 降格条件(confirmed → stale)

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

### 4.2 初期実装するレンズ(フェーズ1〜3)

| レンズ名 | 出力例 | フェーズ |
|---------|--------|---------|
| current_analysis | 既存 MarketAnalysis をラップ | 1 |
| time_session | tokyo_active, ny_active, minutes_since_ny_open, etc. | 1 |
| dow_theory | higher_high, higher_low, trend_state, phase | 3 |
| volatility_regime | bb_width_percentile, atr_change_rate, regime_label | 3 |

### 4.3 中期追加予定レンズ(フェーズ5以降)

| レンズ名 | 出力例 |
|---------|--------|
| elliott_simple | rule_violations, wave_candidates(確率分布), fib_fit_score |
| smc | liquidity_sweep_detected, fvg_present, order_block_proximity |
| structure_pivots | recent_swing_high, recent_swing_low, pivot_age_bars |
| moon_phase | phase_name, days_from_full_moon |

### 4.4 レンズ実装規約

- **副作用なし**: レンズは純関数に近い実装にする。計算以外の I/O は禁止。
- **独立性**: 他のレンズの出力に依存しない。必要なら元データから再計算する。
- **決定性**: 同じ入力に対して同じ出力を返す。ランダム要素禁止。
- **高速**: 1レンズの計算は可能な限り軽量に。全レンズ合計でも数百 ms に収まる。
- **バージョン管理**: 内部ロジック変更時は `version` を上げる。過去の特徴量スナップショットと識別可能にする。

---

## 5. エージェント設計

### 5.1 Market Observer
- **役割**: 相場データを受け取り、全レンズを並列実行して LensFeatureSnapshot を出力
- **実装**: LLM ではなく純粋な TypeScript クラス(LensAggregator)
- **出力**: 全レンズ出力を統合した Record 型

### 5.2 Hypothesis Generator
- **役割**: LensFeatureSnapshot から「もし〜なら〜という偏りがある」という仮説を複数生成
- **実装**: LLM, システムプロンプトは "探索モード" を強制する設計
- **禁止事項**: 文献でよく見る組み合わせの提案、有名戦略名の使用
- **出力**: HypothesisCandidate[](最低5個)

### 5.3 Strategy Thinker(改修)
- **既存**: 単一シナリオ生成
- **改修後**: 仮説3つ → 自己反証 → 戦略化 の3ステップ
- **新出力**: 戦略を JSON DSL 形式で出力(フェーズ5以降)

### 5.4 Devil's Advocate
- **役割**: Strategy Thinker の出力を叩く。「この戦略が負ける具体シナリオを3つ」だけを考える
- **実装**: LLM, 極めてシンプルなプロンプト
- **出力**: WeaknessAnalysis(戦略の弱点3つ + 修正提案)

### 5.5 Edge Validator
- **役割**: 戦略/仮説を受けて、strategyBacktestService にテスト発注、結果を解釈
- **実装**: オーケストレーター(Python呼び出しを管理する TypeScript)+ LLM(結果解釈)
- **出力**: ValidationReport(昇格可否判定)

### 5.6 Reflection AI(改修)
- **既存**: トレード結果の振り返りコメント生成
- **改修後**: 「新規仮説発生」「既存仮説確認」「既存仮説反証」を分類し、EdgeLedger に書き込む

### 5.7 Discovery AI
- **役割**: 週次実行。レジーム別に効いているレンズ/指標の組み合わせを洗い出す
- **実装**: LLM + 統計分析ツール(組み合わせ評価)
- **出力**: WeeklyDiscoveryReport

### 5.8 プロンプト管理
各エージェントのシステムプロンプトは **独立したファイル** として管理する:
```
src/side-b/prompts/
  market_observer.md  (参考文書のみ、LLMは使わない)
  hypothesis_generator.md
  strategy_thinker.md
  devils_advocate.md
  edge_validator.md
  reflection.md
  discovery.md
```

進化的探索の対象にプロンプト自体を含める可能性があるため、コードから分離する。

---

## 6. 進化的探索ループ

### 6.1 戦略JSON DSL

```json
{
  "id": "strategy_abc123",
  "generation": 5,
  "parent_ids": ["strategy_xyz789"],
  "regime_target": "trending_with_pullback",
  "entry": {
    "conditions": [
      {"lens": "current_analysis", "feature": "rsi", "op": "<", "value": "$p1"},
      {"lens": "volatility_regime", "feature": "bb_width_percentile", "op": ">", "value": "$p2"}
    ],
    "logic": "AND"
  },
  "exit": {
    "stop_loss": {"type": "atr_multiple", "value": "$p3"},
    "take_profit": {"type": "rr_ratio", "value": "$p4"}
  },
  "parameters": {
    "p1": {"range": [20, 40], "default": 30, "type": "int"},
    "p2": {"range": [0.3, 0.8], "default": 0.5, "type": "float"},
    "p3": {"range": [1.0, 3.0], "default": 1.5, "type": "float"},
    "p4": {"range": [1.5, 4.0], "default": 2.0, "type": "float"}
  }
}
```

### 6.2 世代交代のサイクル

```
1. 初期集団: 20戦略をランダム or Strategy Thinker 出力から生成
2. バックテスト実行(Python側、並列)
3. スコアリング(3分割データでの総合成績)
4. 選抜:
   - 上位5個 → エリート保存(次世代へそのまま残す)
   - 上位10個 → 交配元
   - 下位5個 → 廃棄
5. LLM呼び出し:
   - 上位5個を渡して「共通点を強化した変異体10個」
   - 下位5個を渡して「失敗要因を避ける変異体5個」
   - 上位ペアから「交配体5個」
6. 多様性チェック: 類似しすぎた個体を発見 → 強制多様化プロンプト
7. 新集団でループ
```

### 6.3 実行頻度

- 戦略進化: 日次(夜間スケジューラー)
- プロンプト進化: 月次
- 仮説進化: 週次(Discovery AI と連動)

### 6.4 リソース上限

- 1世代あたりの LLM 呼び出し上限: 30回
- 1世代あたりのバックテスト実行上限: 100回
- 集団サイズ上限: 50戦略/レジーム

---

## 7. 段階的実装計画(概観)

| フェーズ | 期間目安 | 内容 |
|---------|---------|------|
| フェーズ1 | 1-2週間 | 柱2の最小版 ― Lens インターフェース + 既存ラップ + 時間帯レンズ + スキーマ拡張 |
| フェーズ2 | 1-2週間 | 柱1の最小版 ― Devil's Advocate + Strategy Thinker 3ステップ化 + プロンプトファイル分離 |
| フェーズ3 | 継続的 | 柱2の拡張 ― ダウ理論レンズ、ボラ状態レンズを追加 |
| フェーズ4 | 2-3週間 | 柱1の拡張 ― Hypothesis Generator, Edge Validator, Discovery AI |
| フェーズ5 | 2-4週間 | 柱3の最小版 ― 戦略JSON DSL + 単純な変異ループ + バックテスト統合 |
| フェーズ6 | 継続的 | 柱3の本格化 ― 多様性維持、プロンプト進化、複雑レンズ(エリオット、SMC)追加 |

各フェーズは独立した `phase_N_specification.md` ファイルを持つ。Claude Code への発注時はそのファイルを主入力として渡す。

---

## 8. 重要な設計上の禁止事項

以下は実装時に絶対に侵犯してはならない。

- **既存の MarketAnalysis / featureVector / AgentMemory のデータ構造を破壊的変更しない**。新機能は常に後方互換のラッパー or 拡張として実装する。
- **UIの全機能停止を伴う移行をしない**。既存の Side-B が動き続けながら新機能を重ねる。
- **一度に複数フェーズを並行着手しない**。1フェーズ完了 → 運用確認 → 次フェーズ。
- **AI独自のブラックボックスパターンをエッジ台帳に記録しない**。人間語への翻訳が必須。
- **"暗記した"成績でエッジを昇格させない**。未知データでの検証必須。

---

## 9. 成功の指標

このアーキテクチャが機能しているかは以下で測る:

- **短期(3ヶ月)**: エッジ台帳に `confirmed` ステータスのエントリが5個以上
- **中期(6ヶ月)**: 仮想トレードの月次 PF が 3ヶ月連続で 1.3 以上
- **長期(1年)**: Discovery AI が発見した「人間が気付かなかった組み合わせ」で稼働中のエッジが存在

勝率や PnL は副次的指標。**エッジ台帳の成長と、そのエッジの再現性** が主要指標。

---

## 10. 参考文献 / 関連研究

- Case-Based Reasoning (CBR): 過去事例に基づく判断の古典的AI手法
- Retrieval-Augmented Generation (RAG): 検索統合型LLM推論
- Generative Agents (Park et al., 2023, Stanford/Google): LLMエージェントの記憶・反省・計画の統合
- FinMem / TradingGPT / FinAgent: 金融特化LLMエージェントの先行研究
- Promptbreeder / FunSearch: LLMを進化計算のオペレーターとして使う手法
- Regime-Switching Strategy: 市場状態別に戦略を切り替える機関投資家の設計思想

---

*この設計書は生きたドキュメントである。実装を進める中で発見された制約や改善点は、該当セクションに追記していく。*
