# AI Agent Orchestration ベストプラクティス + AI トレーディング OSS 事例調査

> 調査日: 2026-05-24
> 対象: TradeAssist (Side-B 自律 AI レイヤ) における上位 Orchestrator 設計の評価
> 形式: 外部事例 + 既知パターンの整理 → TradeAssist へのマッピング → 推奨アクション
> 注記: WebFetch / WebSearch 結果は 2026-05 時点のスナップショット。`未検証ですが` `推測ですが` を明示する。

---

## 0. 調査目的と背景

TradeAssist は AI 主導の自律トレーディング支援アプリで、現在 **PDCALoop / EvolutionLoop / Cron Scheduler** の 3 系統が並列稼働している。過去に `AgentLoop` (1 LLM で PDCA 全部を回す設計) が「production 起動経路ゼロ」のまま残骸化し撤去された経緯がある (PR #231, 2026-05-18 マージ)。撤去メモには「次のステップ = PDCALoop の Plan 段に Orchestrator を統合」とのみ残っており、具体設計は未着手。

Nekoさん の現在の発想は次のとおり:

- **最上位 Orchestrator は「次にどのループを回すか」だけ判断する薄い判断層**
- PDCA 各段は既存の 4 体の専門 LLM (Research / Plan / Reflection / Strategist) が動かす
- 入力 = ADK trace 集計 + EdgeLedger 状況 + Evolution 結果 + 各段最新 output
- 出力 = 「新規仮説作成 / 既存検証推進 / Evolution 回す / 全部やる / 待機」のいずれか

本ドキュメントは「この発想が外部のベストプラクティスに照らして妥当か」「逸脱があるとすればどこか」「次の妥当な実装方針は何か」を整理するための一次資料である。コード変更は伴わず、`docs/research/` 配下の調査ノートとして残す。

---

## 1. AI Agent Orchestration フレームワーク

### 1.1 LangGraph (LangChain)

LangGraph はノード/エッジで状態遷移を記述するグラフベースのオーケストレーションフレームワーク。multi-agent の代表 3 パターン:

- **Supervisor pattern**: 1 つの supervisor ノードが構造化出力で「次にどの specialist に渡すか」を決める。最も production で使われている。
- **Hierarchical pattern**: Supervisor の supervisor を置く 2 層構造。6 体以上の worker を抱えるときに採用される。
- **Network (peer-to-peer)**: どの agent も任意の agent を呼べる。スケールしにくく "chaos" と評される。

**Plan-and-Execute** も LangGraph のチュートリアルで明示的にサポートされている: Planner ノードが先に全 step を計画 → Executor ノードが順次/並列実行 → 必要なら re-plan。利点は「大型 LLM を planner のみに使い、execution は smaller model で済ませられる」「計画が事前に inspectable」「ReAct より LLM call が少なく安価」。

**最上位の判断層をどう置いているか**: Supervisor ノードを `structured output` で実装し、`route: Literal["agent_a", "agent_b", "FINISH"]` を返させる。判断層は薄い (= prompt + structured output のみ) のがイディオム。

**責務分担**: Supervisor = 「次は誰」+ 終了判定、Specialist = 専門領域の実行 + tool use。状態 (`MessagesState` などの shared state) は明示的にグラフへ持たせる。

### 1.2 CrewAI

Role-based collaboration を中心に据えたフレームワーク。`Process` 型で flow を切り替える:

- **Sequential**: 事前に定義した順番で task を回す (パイプライン向き)
- **Hierarchical**: manager agent (LLM) が goal を読み、subtask に分解して worker に dispatch、出力を validate して synthesize する。`manager_llm` または `manager_agent` の指定が必須。
- **Consensual** (実験的): 合意形成型。

注意点として、外部記事では `「Hierarchical の各 manager 判断はそれぞれ LLM call で、3 worker × 3 task = 6-9 manager calls がオーバーヘッドに乗る」「memory=True で 30% 程度コスト削減」` という運用 tip が指摘されている。

**最上位の判断層**: manager_llm 自体が thick (= タスク分解 + 委譲 + 検収を全て担う) になりがちで、Nekoさん 発想の "薄い判断層" とは対極にある。

### 1.3 Microsoft AutoGen / Agent Framework

AutoGen は GroupChat / GraphFlow / event-driven runtime を pioneered したが、現在は **maintenance mode** に入り、後継の **Microsoft Agent Framework** が推奨されている (migration guide 公開済)。

- **GroupChat**: speaker selection を admin agent (role-play prompt) が担い、次の発言者を動的に決める。
- **GraphFlow**: 直接的な DAG 記述。state は複数の next state を許容し、admin が context から選択する (finite state machine より柔軟)。
- **Event-driven runtime**: メッセージ駆動で worker が反応する loosely-coupled な構成。

**最上位の判断層**: admin agent が GroupChat 全体の進行を司る。Supervisor pattern に近いが、speaker 選択 prompt に "role-play で次話者を選ぶ" 自然言語指示が混ざるのが特徴。

### 1.4 OpenAI Swarm

教育目的の lightweight framework (production 推奨ではない、と公式が明記)。Primitive は **Routines** と **Handoffs** の 2 つだけ:

- Routine = instructions + tools (= Agent class)
- Handoff = `return another_agent` する関数

State は明示的に持たず、`run()` ごとに stateless。supervisor はおらず、各 agent が「次は誰に渡すか」を tool call として decide する peer-to-peer 寄り。

**最上位の判断層**: 存在しない。各 agent が handoff を判断する分散型。Nekoさん 発想とは対極。

### 1.5 AgentScope (Alibaba)

production-grade を謳う framework (19.6k+ star)。主要抽象:

- **MsgHub**: async context manager。participants 間で message を broadcast。`add` / `delete` / `broadcast` で動的に参加者管理。
- **Pipeline**: sequential / conditional / iterative の会話パターンを再利用可能なコンポーネントとして抽象化。
- **OpenTelemetry 統合**: production deploy 前提で trace/metric を built-in 対応。

**最上位の判断層**: Pipeline が orchestration を司るが、これは "決定論的な順序付け" 寄りで、LLM 判断による動的ルーティングは別途必要。

### 1.6 LlamaIndex AgentWorkflow

3 段階の使い分けがドキュメントに明記されている:

1. **AgentWorkflow** (built-in hand-off): 最速プロトタイピング、デフォルトのハンドオフヒューリスティクスで満足できる場合。
2. **Orchestrator agent pattern**: 1 つの orchestrator が「毎ステップ次に何をするか」を決める。sub-agent を tool として expose して呼び出す declarative 構成。
3. **Custom planner**: 上の 2 つで表現できない flow のときに自前 planner を書く。

**最上位の判断層**: Orchestrator agent pattern は Nekoさん の発想に最も近い。sub-agent を tool として expose し、orchestrator は「次にどれを呼ぶか」と「終了判定」のみに責務を絞る。

### 1.7 まとめ表

| Framework | 上位層の置き方 | 専門 agent との責務分担 | TradeAssist との親和性 |
|---|---|---|---|
| LangGraph Supervisor | 薄い routing node (structured output) | 明示的、shared state あり | 高 (発想と一致) |
| LangGraph Plan-and-Execute | Planner + Executor 2 段分離 | Plan 段は大型 LLM、Execute は smaller | 高 (Plan 段への統合と方向性一致) |
| CrewAI Hierarchical | thick manager (LLM + 分解 + 検収) | 全部 manager が握る | 中 (manager が厚すぎ) |
| AutoGen GroupChat | admin agent (speaker selection) | event-driven message-based | 中 (event-driven は魅力) |
| Swarm | 上位層なし (peer handoff) | agent 同士で渡し合う | 低 |
| AgentScope Pipeline | Pipeline が決定論的に司る | MsgHub で message broadcast | 中 (観測性は参考になる) |
| LlamaIndex Orchestrator | 薄い orchestrator (sub-agent as tool) | sub-agent を tool として expose | 高 (発想と一致) |

---

## 2. AI トレーディング系 OSS 事例

### 2.1 TradingAgents (TauricResearch) — 最重要参照

- GitHub: https://github.com/TauricResearch/TradingAgents
- 規模: 78.9k stars / 626 watchers / 15.4k forks / 最新 v0.2.5 (2026-05-11)
- 実装基盤: **LangGraph**
- 論文: arXiv:2412.20138

**アーキテクチャ (3 チーム階層)**:

1. **Analyst Team** (観察)
   - Fundamentals Analyst: 財務指標
   - Sentiment Analyst: SNS sentiment (StockTwits / Reddit)
   - News Analyst: マクロ / 大局
   - Technical Analyst: MACD / RSI 等
2. **Researcher Team** (判断)
   - Bullish / Bearish researcher の **構造化ディベート** (debate) で analyst output を批判的に再評価
3. **Decision Layer** (実行)
   - Trader Agent: タイミング + 数量
   - Risk Management Team: ポートフォリオ volatility/liquidity 監視
   - Portfolio Manager: 最終承認 / 拒否権

**PDCA との対応**:
- Plan (Observe + Decide): Analyst → Researcher debate → Trader proposal
- Do (Act): Portfolio Manager approval → execution
- Check + Act (Reflect): decision log を蓄積し「lessons を Portfolio Manager prompt に取り込む」と明記

**最上位の判断層**: Portfolio Manager が最終承認権を持つが、`次にどのループを回すか` ではなく `この trade を通すか` を判断する。Nekoさん 発想の "ループ選択 orchestrator" とは責務が異なる。

**観察**: TradingAgents は「1 つの trade proposal をパイプラインで通す」設計で、`複数のループ (新規仮説 / 検証推進 / Evolution)` を持つ TradeAssist のような構造ではない。**TradeAssist は TradingAgents より 1 段上のメタ層を扱っている**と位置づけられる。

### 2.2 FinRobot (AI4Finance-Foundation)

- GitHub: https://github.com/AI4Finance-Foundation/FinRobot
- 規模: 7,000 stars / 1,200 forks / 最新 v1.0.0 (2026-03-20)
- 論文: arXiv:2405.14767

**4 層アーキテクチャ**:
1. Financial AI Agents Layer (Chain-of-Thought)
2. Financial LLMs Algorithms Layer (ドメイン特化 tuned models)
3. LLMOps / DataOps Layer
4. Multi-source LLM Foundation Models Layer

**Perception-Brain-Action モデル**:
- Perception: 市場データ + news の取り込み
- Brain: LLM + Financial Chain-of-Thought で structured instruction 生成
- Action: trade / portfolio 調整 / report / alert

**Smart Scheduler** (= 上位 orchestrator):
- Director Agent: agent の performance metric を見て task 配分
- Agent Registration: 利用可能 agent の追跡
- Agent Adaptor: タスクに合わせて機能を tailoring
- Task Manager: 各 agent の保持

**PDCA との対応**:
- Plan: Brain (CoT)
- Do: Action
- Check: Director Agent が performance metric を参照
- Act (改善): Smart Scheduler が次の task 配分を更新

**スケジューリングモデル**: 純 event-driven ではなく **task-driven scheduling** (= Smart Scheduler が定期的に agent capability を更新)。Nekoさん 発想に近い「上位層が次を決める」が、ここでも **performance metric driven** で動いている点が示唆的。

### 2.3 FinMem (pipiku915)

- GitHub: https://github.com/pipiku915/FinMem-LLM-StockTrading
- 論文: arXiv:2311.13743 (AAAI 採録)

**3 モジュール構成**:
- **Profiling**: agent の character (risk preference 等)
- **Memory** (= 中核): **階層化された short / mid / long term memory** で hierarchical financial data を取り込む
- **Decision-making**: memory からの insight を投資判断に変換

**特徴**: 「self-evolve professional knowledge」「real-time tuning」を agent loop に組み込み、Reflexion 寄りの "過去の判断を memory に蓄えて以後の判断を磨く" 設計。**TradeAssist の Reflection / Strategist 系統と方向性が一致**する (= layered memory の発想は EdgeLedger + ResearchOutput 永続化に対応)。

**上位 orchestrator は明示的に存在しない** (単一エージェントの精度向上が主眼)。

### 2.4 AgenticTrading (Open-Finance-Lab)

- GitHub: https://github.com/Open-Finance-Lab/AgenticTrading
- 「**垂直階層型 protocol-oriented architecture**」を標榜
- 特徴: **task-specific execution graph を動的に composing** することで real-time decision making を実現

詳細は star 数が少ない (= 未検証ですが小規模 OSS) ため深堀りせず、ただし「task-specific graph を動的構築」というアプローチは Nekoさん 発想の "次にどのループを回すか" を **graph 構築問題として表現する** という別解釈になり、参考価値がある。

### 2.5 まとめ (PDCA / 上位 orchestrator の有無)

| OSS | スター | 上位 orchestrator | PDCA 構造 | TradeAssist との関連 |
|---|---|---|---|---|
| TradingAgents | 78.9k | Portfolio Manager (trade 承認層) | Analyst→Researcher→Trader→Risk→PM、Reflect は prompt 取込 | 1 trade pipeline の参考。メタ層は別途必要 |
| FinRobot | 7.0k | **Smart Scheduler** (Director Agent + performance metric driven) | Perception-Brain-Action + Director が再配分 | **発想に最も近い**。performance driven な再配分が参考 |
| FinMem | (中規模) | なし (単体 agent) | layered memory + Reflexion 風 | Reflection / Memory 設計の参考 |
| AgenticTrading | (小規模) | dynamic graph composer | task-specific execution graph | "ループ選択 = graph 構築" の別視点 |

---

## 3. アーキテクチャ概念

### 3.1 ReAct (Reasoning + Acting)

単体 agent の基本パターン。`Thought → Action → Observation` を 1 loop に閉じ込め、tool use と推論を交互に行う。LangChain agent 実装の基礎。**長 chain で爆発的にコストが上がる** のが弱点で、enterprise 用途には Plan-and-Execute や Reflexion との組合せが推奨される。

### 3.2 Reflexion

ReAct/Plan-and-Execute に **verbalized self-critique loop** を追加し、過去の失敗から学ぶ。FinMem の layered memory はこの系譜。一方、2026 の比較論文 (`arXiv:2512.03560` 等) では「Reflexion 単独はタスクによっては最低性能になる」とも指摘されており、Reflection は **何を振り返るか** の定義設計が重要となる。

### 3.3 Plan-and-Execute

Planner agent が全 step を先に計画 → Executor が逐次実行する 2 段分離。利点は (a) 大型 LLM を planner にだけ使い execution は smaller で安価、(b) 計画が事前に inspectable、(c) 不要な intermediate LLM call を削減。LangGraph では正式チュートリアルが用意されている。**Nekoさん 発想の "Plan 段に Orchestrator を統合する"** は、まさにこの Plan-and-Execute の Planner を強化する方向に対応する。

### 3.4 Supervisor agent pattern

「上位 supervisor + worker agents」の標準形。enterprise multi-agent で最も多用される production パターン。
- Supervisor の責務: 「次に誰」+ 「終了判定」+ 「shared state 更新」
- Worker の責務: 専門タスク + tool use
- 6 体以上に worker が増えると Hierarchical (= supervisor の supervisor) へ進化する

設計のキモは **supervisor を薄く保つ** こと (= CrewAI のように thick manager にすると LLM call が爆発する)。

### 3.5 Event-driven agent loop vs scheduled cron

- **Cron scheduled**: 定期実行 (daily report, cleanup, 定時バッチ)。「前回 run の context を引き継ぐ仕組み」が課題。
- **Event-driven**: 外部 event (webhook, file upload, message arrival) で発火。リアルタイム反応に強い。
- **Condition-based** (= AgentC2 等): 条件を毎回評価して run するか決める ハイブリッド。

production の最新動向は **3 つを併用する hybrid** が標準: cron で baseline、event で reactive、condition で gate。TradeAssist の現状 (Cron Scheduler + EvolutionLoop + PDCALoop) はすでにこの hybrid に近い。

### 3.6 Goal-driven Top-Loop

`Tungsten Automation` / Google Cloud Architecture Center などの記事で整理されている "**managing agent owns the overall goal, controls the lifecycle of a case**" パターン。worker は agents-as-a-service として well-defined task を担当し、orchestrator がライフサイクル (= 何をいつ start/stop するか) を所有する。Nekoさん 発想の Top-Loop はこの系譜。

### 3.7 BabyAGI / AutoGPT (歴史的参照)

`task list の作成 → 実行 → 結果からの新規 task 生成 → 再優先順位付け` のシンプルな task loop。**ハルシネーション loop (= 計画と再計画だけ繰り返して進捗なし)** が代表的な失敗。これは TradeAssist の旧 `AgentLoop` 撤去の経緯 (= 起動経路ゼロで残骸化) と教訓を共有する。「Top-Loop を作るときは "進捗しているか" の終了判定とエスケープ機構が必須」 という重要な反面教師。

---

## 4. TradeAssist の現状との比較

### 4.1 現状の 3 並列ループ構造

`/Users/jolly_app/projects/trader-note-build-ai/src/side-b/` 配下の実装から、現状の loop 構造は以下のとおり:

| ループ | 主体ファイル | 役割 | 駆動 |
|---|---|---|---|
| PDCALoop | `agent/` 配下 + `orchestrator/aiOrchestrator.ts` + `orchestrator/existingPlanDecision.ts` | Research → Plan → Reflection → Strategist の PDCA | 外部 trigger (scheduler / API) |
| EvolutionLoop | `evolution/EvolutionLoop.ts` + `evolution/multiGenerationRunner.ts` + `evolution/workflowRunner.ts` | GA で strategy population を進化 | scheduler + 手動 |
| Cron Scheduler | `jobs/sideBScheduler.ts` + `jobs/jobCoordinator.ts` + `jobs/sideBSchedulerOrchestratorBridge.ts` | discovery / planGeneration / screening / fullValidation / tradeMonitoring / evolution / promptEvolution / cleanup | cron 設定 |

すでに `orchestrator/aiOrchestrator.ts` および `jobs/sideBSchedulerOrchestratorBridge.ts` が存在し、ADK のサイドカー観測 (`adk/agents/sideBOrchestrator.ts`) も配線済み。つまり **"orchestrator" の語は既存だが、責務は "Plan 段の AI 委譲" にとどまり、3 ループ全体を統合する Top-Loop には至っていない** (推測ですが、PR #231 撤去メモから判断)。

### 4.2 ベストプラクティスへの位置付け

| 軸 | TradeAssist 現状 | 最も近い外部パターン |
|---|---|---|
| 上位層の有無 | 部分的 (aiOrchestrator は Plan 段限定、3 ループ統合層は不在) | LangGraph Plan-and-Execute の Planner 強化途上 |
| 4 体の専門 LLM | 既存 (Research / Plan / Reflection / Strategist) | LangGraph Supervisor の specialist 群、TradingAgents の Analyst Team に相当 |
| ループ駆動方式 | Cron + 手動 trigger | hybrid (cron + event-driven が標準) のうち scheduled 寄り |
| 進化 / 学習機構 | EvolutionLoop (GA) + ResearchOutput 永続化 | FinMem layered memory + FinRobot Smart Scheduler の中間 |
| 観測層 | ADK trace サイドカー | AgentScope OpenTelemetry に相当 (整備度は中程度、推測) |

### 4.3 ギャップ

- **3 ループ間の `次に何を回すか` 判断が暗黙 (= cron 設定 or 手動)**。これが Nekoさん の課題認識と一致。
- **PDCA の Reflection 出力が次サイクルの Plan 入力に systematic に流れていない** (未検証ですが、`existingPlanDecision.ts` の存在から、現状は Plan 段内で限定的に閉じている可能性が高い)。
- **EvolutionLoop と PDCALoop の interplay が cron 任せ** (= Evolution 結果が PDCA の strategy 選択を実時間で動かすパスは未整備、推測)。

---

## 5. Nekoさん 発想の Top-Level Orchestrator 評価

### 5.1 発想の要約 (再掲)

> 最上位 Orchestrator = 薄い判断層。
> 入力: ADK trace 集計 + EdgeLedger 状況 + Evolution 結果 + 各段最新 output。
> 出力: 「新規仮説作成 / 既存検証推進 / Evolution 回す / 全部やる / 待機」。

### 5.2 ベストプラクティスとの合致点

1. **薄い supervisor を保つ方針は LangGraph Supervisor / LlamaIndex Orchestrator 系列の主流派と完全一致**
   - LangGraph では supervisor を `structured output で routing label を返すだけ` に保つのがイディオム化している。
   - CrewAI Hierarchical のように manager に分解 + 検収まで持たせると LLM call が爆発する反面教師がある。Nekoさん 発想はこれを回避できる。

2. **入力に "ADK trace 集計 + EdgeLedger 状況 + Evolution 結果" を統合する設計は FinRobot Smart Scheduler の "performance metric driven な再配分" と方向性が同じ**
   - FinRobot は agent の performance metric を見て task 配分を更新するが、TradeAssist は trace + ledger + evolution という **3 系統のシグナル統合** を行う点で 1 歩先まで踏み込んでいる。

3. **出力を 5 択 (新規仮説 / 検証推進 / Evolution / 全部 / 待機) に限定するのは Plan-and-Execute の "計画が事前に inspectable" 原則に合致**
   - 自由形式の自然言語 plan ではなく label 出力にすることで、(a) audit しやすい (b) test しやすい (c) 自由度爆発による hallucination loop (= 旧 AgentLoop の失敗) を防げる。

### 5.3 注意すべき逸脱 / リスク

1. **「待機」を本当に選ぶ仕組みになっているか**
   - BabyAGI / 旧 AgentLoop の失敗は「常に何かする」設計だった点にある。**`待機` を first-class の選択肢として `次の wakeup 条件` まで返させる** 必要がある (例: `wait_until: { ledger_event: "fill" }` / `wait_until: { cron: "next_market_open" }`)。
   - そうしないと cron で毎回 LLM 呼ばれて全部 "待機" を返すだけのコスト loop に陥る可能性あり (推測ですが、過去の AgentLoop の撤去理由と類似)。

2. **「全部やる」の意味の曖昧さ**
   - 3 ループを並列発火するのか、順序ありで直列発火するのか、resource budget をどう割るかが曖昧だと CrewAI Hierarchical のような LLM call 爆発が起きる。**`全部やる` を `priority list + budget` に展開する仕様** を最初から決めるべき。

3. **Top-Loop 自体の終了判定 / エスカレーション**
   - Goal-driven Top-Loop の標準パターンでは「目標達成」「リソース枯渇」「エラー連鎖」のいずれかで人間にエスカレーションする経路を持つ。**Nekoさん へのエスカレーション条件 (例: 3 サイクル連続 "新規仮説" + 検証が進まない場合)** を first-class に組み込むべき。

4. **既存の Cron Scheduler との二重判断問題**
   - Top-Loop と Cron Scheduler が両方発火 trigger を持つと判断が衝突する。**Cron Scheduler を Top-Loop の wakeup signal generator に降格させる** か、Top-Loop が cron を suppress できる仕組みが必要 (= AutoGen の admin / FinRobot Director Agent の発想)。

5. **ADK trace 集計 → 入力化のレイテンシ**
   - ADK trace は現状 Plan 段 / PDCALoop に配線済 (PR #242, #243) だが、集計入力化までのパイプラインが未整備な可能性が高い (推測)。Top-Loop 着手前に **trace 集計 view (= Top-Loop の入力スキーマ確定)** を先行整備する必要がある。

### 5.4 総合評価

- **発想の方向性はベストプラクティスに合致** (LangGraph Supervisor + LlamaIndex Orchestrator + FinRobot Smart Scheduler の交点)。
- **逸脱はなく、むしろ TradeAssist 独自の "3 ループ統合" は外部 OSS より 1 段先進的**。
- ただし **旧 AgentLoop と同じ失敗 (起動経路ゼロで残骸化、hallucination loop)** を避けるための制約条件 = `待機の first-class 化` `全部やる の展開仕様` `終了/エスカレーション条件` `Cron との責務分離` を初期設計に必ず盛り込む必要がある。

---

## 6. 推奨される次のアクション

3 つの実装方針案を trade-off 付きで提示する。

### 案 A: Plan-and-Execute 強化 (最小侵襲、撤去メモ直系)

**内容**: 既存 `aiOrchestrator.ts` を Planner 強化し、PDCALoop の Plan 段に統合。Top-Loop は作らず、Plan 段 LLM が `existingPlanDecision` の延長で `新規仮説 / 検証推進 / Evolution kick` を返せるよう拡張する。

- **Pros**:
  - 撤去メモ ("次のステップ = PDCALoop の Plan 段に Orchestrator を統合") と直接一致
  - 既存 cron + 既存 PDCALoop を温存、影響範囲が最小
  - Plan-and-Execute (LangGraph 公式チュートリアル) の素直な拡張
- **Cons**:
  - Plan 段が trigger されない限り判断機会がない (= cron 依存が残る)
  - 3 ループ統合という Nekoさん 発想の本質に届かない
  - "次のループ" 概念を Plan 段に押し込むため責務が肥大化しがち

### 案 B: 薄い Top-Level Orchestrator を新規追加 (Nekoさん 発想直球)

**内容**: `src/side-b/orchestrator/topLoopOrchestrator.ts` を新設。入力 (ADK trace 集計 + EdgeLedger + Evolution + 各段最新 output) を構造化スキーマで受け取り、`structured output` で `{ action: "research_new" | "validate_existing" | "evolve" | "all" | "wait", wait_until?: {...}, budget?: {...}, reason: string }` を返す薄い LLM 呼び出しを定義。Cron Scheduler は wakeup signal generator に降格し、Top-Loop が最終発火判断を持つ。

- **Pros**:
  - LangGraph Supervisor / LlamaIndex Orchestrator / FinRobot Smart Scheduler のベストプラクティス交点
  - `待機` `budget` `escalation` を first-class で扱える
  - audit / test が容易 (= 出力が label + structured fields)
- **Cons**:
  - 旧 AgentLoop と表面的に似た構造 → 「起動経路ゼロ残骸化」リスク
  - 初期は Top-Loop の入力スキーマ整備 (trace 集計 view) が先行コストとして必要
  - Cron Scheduler との責務分離設計に注意 (二重判断問題)

### 案 C: TradingAgents 風の hierarchical pipeline 全面再構築

**内容**: LangGraph 基盤を導入し、Analyst Team (= Research 系) → Researcher Team (= Plan で debate) → Decision Layer (= Strategist + Reflection) → Portfolio Manager (= 最終承認) という 4 段 hierarchical を構築。Evolution / Cron は orchestrator の外側に置く。

- **Pros**:
  - TradingAgents (78.9k star) の実績パターンを丸ごと採用
  - 各 agent の責務が prompt level で明確化
  - debate (Bullish / Bearish) で確証バイアス対策が built-in
- **Cons**:
  - **影響範囲が広すぎる** (4 体 LLM の責務再設計 + LangGraph 導入 + Cron 再配線)
  - 既存の ADK trace 配線・PDCALoop 実装が大幅に書き換え対象になる
  - Phase 5.5 / Phase 6 の既存 roadmap と整合性が取りにくい (推測)
  - 1 trade pipeline 設計のため、`3 ループ統合` 課題への直接解にならない

### 推奨

**案 B (薄い Top-Level Orchestrator 新規追加) を基本線とし、案 A の Plan 段強化を併用** することを推奨する。具体的には:

1. **先行 step**: ADK trace 集計 view を整備し、Top-Loop の `入力スキーマ` を確定する (= Top-Loop 本体実装前)。
2. **Top-Loop 本体**: 案 B の構造で実装。ただし以下を初期設計に盛り込む:
   - `wait` を first-class 化し `wait_until` 必須
   - `all` を `priority list + budget` に展開
   - 3 サイクル連続停滞でエスカレーション
   - Cron Scheduler は wakeup signal generator に降格
3. **Plan 段の補強**: 案 A 路線で `aiOrchestrator.ts` の `existingPlanDecision` を Top-Loop の出力に応じて分岐強化。
4. **TradingAgents 風 debate** は将来 Phase で Plan 段の内部実装として検討 (= 案 C のうち取り入れ可能な部分のみ)。

**初期最小スコープ (= Phase 5B 着手時の最小実装案)**:
- `topLoopOrchestrator.ts` の skeleton + 入力スキーマ型定義
- `wait_until` + `budget` の型定義
- ADK trace 集計 view の最小実装 (`lenses/` 配下で済むなら新規ディレクトリ不要)
- Top-Loop は最初 **shadow mode** (= 判断は出すが発火はしない) で稼働させ、cron 並列で観察 1-2 週間 → 既存 cron との判断一致率を測ってから本番化

---

## 参考リンク

### Frameworks (軸 1)
- LangGraph Supervisor reference: https://reference.langchain.com/python/langgraph-supervisor
- LangGraph Supervisor 解説: https://focused.io/lab/multi-agent-orchestration-in-langgraph-supervisor-vs-swarm-tradeoffs-and-architecture
- LangGraph Plan-and-Execute (公式 blog): https://blog.langchain.com/planning-agents/
- CrewAI Processes (公式): https://docs.crewai.com/en/concepts/processes
- CrewAI Hierarchical 解説: https://markaicode.com/crewai-hierarchical-process-manager-worker-agents/
- AutoGen → Microsoft Agent Framework migration: https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-autogen/
- AutoGen GroupChat / GraphFlow: https://microsoft.github.io/autogen-for-net/articles/Use-graph-in-group-chat.html
- AutoGen GitHub: https://github.com/microsoft/autogen
- OpenAI Swarm GitHub: https://github.com/openai/swarm
- OpenAI Swarm 解説 (VentureBeat): https://venturebeat.com/ai/openais-swarm-ai-agent-framework-routines-and-handoffs
- AgentScope GitHub: https://github.com/agentscope-ai/agentscope
- AgentScope 1.0 論文: https://arxiv.org/html/2508.16279v1
- LlamaIndex multi-agent: https://developers.llamaindex.ai/python/framework/understanding/agent/multi_agent/

### Trading OSS (軸 2)
- TradingAgents GitHub: https://github.com/TauricResearch/TradingAgents
- TradingAgents 論文: https://arxiv.org/pdf/2412.20138
- FinRobot GitHub: https://github.com/AI4Finance-Foundation/FinRobot
- FinRobot 論文: https://arxiv.org/pdf/2405.14767
- FinMem GitHub: https://github.com/pipiku915/FinMem-LLM-StockTrading
- FinMem 論文: https://arxiv.org/abs/2311.13743
- AgenticTrading GitHub: https://github.com/Open-Finance-Lab/AgenticTrading
- awesome-ai-in-finance: https://github.com/georgezouq/awesome-ai-in-finance

### アーキテクチャ概念 (軸 3)
- ReAct vs Plan-and-Execute vs ReWOO vs Reflexion: https://theaiengineer.substack.com/p/the-4-single-agent-patterns
- Agent Architecture Patterns 2026 taxonomy: https://www.digitalapplied.com/blog/agent-architecture-patterns-taxonomy-2026
- Reason-Plan-ReAct (2026 論文): https://arxiv.org/html/2512.03560v1
- Agentic Orchestration Design Patterns: https://www.putitforward.com/agentic-ai/agentic-orchestration-design-patterns
- Google Cloud agentic design pattern guide: https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system
- AWS Agentic AI patterns: https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-patterns/introduction.html
- Databricks agent system design patterns: https://docs.databricks.com/aws/en/generative-ai/guide/agent-system-design-patterns
- Agent Design Pattern Catalogue (arXiv:2405.10467): https://arxiv.org/pdf/2405.10467
- Event-driven vs scheduled (AgentC2): https://agentc2.ai/blog/how-to-schedule-ai-agents-cron-triggers
- BabyAGI 解説 (IBM): https://www.ibm.com/think/topics/babyagi
