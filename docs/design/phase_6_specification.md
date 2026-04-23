# フェーズ6 発注仕様書: プロンプト進化 + 専門家エージェント体制 + 自己再編成の骨格

> **期間目安**: 3-5週間
> **目的**: プロンプト自体を進化対象にしつつ、エージェント構造を下位専門家層 + 中位統合層 + 上位判定層の3階層に再編成。将来の自律再編成のための骨格(MetaEvolutionAgent)も配置する
> **前提**: Phase 1-5A, 5.5 完了
> **前提読み物**:
> - `docs/design/DESIGN_DOC_autonomous_trading_architecture.md`(全体設計)
> - `docs/design/phase_5_5_specification.md`(スキル基盤、このフェーズで活用)

---

## 0. このフェーズの位置付け

### 0.1 3つの主要要素

このフェーズでは相互に関連する3つの要素を同時に実装する:

1. **プロンプト進化基盤**: エージェントのシステムプロンプトをバージョン管理し、A/B テストで進化させる
2. **専門家エージェント体制**: 既存の汎用エージェント群を「下位専門家 + 中位統合 + 上位判定」の3階層に再編成
3. **MetaEvolutionAgent の骨格**: エージェント構成自体を AI が再編成する仕組みの最小実装(手動トリガー、人間承認のみ)

### 0.2 なぜ同時にやるか

プロンプト進化と専門家化は **密接に関連** している:

- 専門家エージェントは各領域に特化したプロンプトを持つ
- プロンプト進化は専門家ごとに独立して最適化できる
- 専門家化してからプロンプト進化基盤を作ると、既存プロンプト進化機構の再設計が発生する
- 一緒にやることで、専門家体制に最適化された進化基盤が作れる

MetaEvolutionAgent も一緒に骨格だけ配置する理由は **将来の自律再編成への扉を最初から開けておくため**。後から追加すると、専門家構造がそれ前提になってない可能性がある。

### 0.3 このフェーズの設計思想(最終形への布石)

**このシステムの真の理想は、人間が専門家エージェントを配置するのではなく、AI 自身が進化ループの過程で「どんな専門家が必要か」を発見し、自律的にエージェント構成を再編成すること** である。

Phase 6 では人間が手動で専門家を配置するが、これは **過渡的措置** である。MetaEvolutionAgent の骨格を置くことで、将来の自動再編成への道筋を確保する。

---

## 1. このフェーズのゴール

完了時点で以下が成立する:

- 7-8 体のエージェントが3階層に再編成されている(下位専門家、中位統合、上位判定)
- 各エージェントのプロンプトがバージョン管理されている
- プロンプトの A/B テストが実行可能
- プロンプト変異エージェント(PromptMutationAgent)が実装されている
- 月次スケジューラーでプロンプト進化が実行される
- MetaEvolutionAgent が手動トリガーで動作し、再編成提案を出力する
- 人間承認を経て新エージェントが PromptRegistry に追加できる
- 既存機能(Phase 1-5A, 5.5)は全て維持されている

---

## 2. 完了条件

### 2.1 プロンプト進化基盤

- [ ] `PromptRegistry` が実装され、プロンプトのバージョン管理ができる
- [ ] プロンプトが DB または JSON で永続化されている
- [ ] `ABTestRunner` が実装され、複数バリアントを並行実行できる
- [ ] `PromptMutationAgent` が実装され、既存プロンプトから改善案を生成できる
- [ ] 月次スケジューラーでプロンプト進化が実行される
- [ ] 実験プロンプトの使用率に上限がある(暴走防止)
- [ ] 人間承認フローが実装されている(最初の数サイクル必須)

### 2.2 専門家エージェント体制

- [ ] 下位専門家層に3体のエージェントが追加されている
- [ ] 中位統合層(既存 HypothesisGenerator, StrategyThinker)が専門家の意見を統合するよう再定義
- [ ] 上位判定層(既存 DevilsAdvocate, StrategistAgent)の役割は変更なし
- [ ] 各専門家が Phase 5.5 の SkillRegistry を使える
- [ ] エージェント間のメッセージ/データフローが定義されている

### 2.3 MetaEvolutionAgent の骨格

- [ ] `MetaEvolutionAgent` クラスが実装されている
- [ ] 既存エージェントのパフォーマンス記録を入力として受け取る
- [ ] 再編成提案(AgentRestructureProposal)を出力する
- [ ] 提案は **実行されない**(出力のみ)
- [ ] 人間承認フロー経由で PromptRegistry に新エージェントを追加できる
- [ ] 自動スケジューラー統合は **しない**(手動トリガーのみ)
- [ ] 安全装置(月あたり追加上限、削除は自動化しない)が組み込まれている

### 2.4 共通

- [ ] 既存テストが全て通る
- [ ] 新ロジックのユニットテストがある
- [ ] Side-A のコードに変更がない(協業パートナー原則)
- [ ] 既存エージェント(Phase 1-5A で作ったもの)の破壊的変更がない

---

## 3. 実装仕様

### 3.1 プロンプト進化基盤

#### 3.1.1 PromptRegistry

`src/side-b/prompts/registry/PromptRegistry.ts`

プロンプトのバージョン管理、ステータス管理、使用記録:

```typescript
export interface PromptVersion {
  id: string;
  agentName: string;          // どのエージェント用か
  version: string;            // セマンティックバージョンまたはタイムスタンプ
  content: string;            // プロンプト本文
  parentVersionId?: string;   // 変異元のプロンプト ID
  createdAt: Date;
  createdBy: 'human' | 'mutation' | 'meta_evolution';
  
  // 成績追跡
  usageCount: number;
  successCount: number;       // このプロンプトで生成された戦略が confirmed に至った回数
  avgScore: number;           // 生成された戦略の平均スコア
  
  status: 'active' | 'experimental' | 'deprecated' | 'rejected';
  
  // メタデータ
  notes?: string;             // 変異時の意図、改善狙いなど
}

export class PromptRegistry {
  async register(prompt: PromptVersion): Promise<void>;
  async getActive(agentName: string): Promise<PromptVersion>;
  async getExperimental(agentName: string): Promise<PromptVersion[]>;
  async recordUsage(versionId: string, score: number, success: boolean): Promise<void>;
  async promote(versionId: string): Promise<void>;  // experimental → active
  async deprecate(versionId: string): Promise<void>; // active → deprecated
  
  // 動的エージェント追加対応(MetaEvolutionAgent 用)
  async registerNewAgent(agentName: string, initialPrompt: PromptVersion): Promise<void>;
  async listAgents(): Promise<string[]>;  // 現在登録されているエージェント一覧
}
```

**重要設計判断**:
- `agentName` は **列挙型で固定しない**。動的にエージェントを追加できる設計
- プロンプトは初期投入時に既存ファイル(`src/side-b/prompts/*.md`)から読み込み

#### 3.1.2 ABTestRunner

`src/side-b/prompts/abtest/ABTestRunner.ts`

同じ入力を複数のプロンプトバリアントで並行実行し、結果を比較:

```typescript
export interface ABTestResult {
  agentName: string;
  testedAt: Date;
  variants: Array<{
    promptVersionId: string;
    output: unknown;
    score: number;
    durationMs: number;
  }>;
  winner?: string;  // 統計的有意に優れたバリアント(あれば)
}

export class ABTestRunner {
  async runTest(
    agentName: string,
    input: unknown,
    variantIds: string[]  // experimental + active を含む
  ): Promise<ABTestResult>;
}
```

**スコアリング**: どうスコアを付けるかは agent によって異なる。スコアリング関数を agent 毎に定義する(例: HypothesisGenerator なら「生成された仮説の confirmed 率」、Strategist なら「判定の一致率」等)。

#### 3.1.3 PromptMutationAgent

`src/side-b/agents/PromptMutationAgent.ts` + `src/side-b/prompts/prompt_mutation.md`

既存プロンプトの改善案を生成する専門エージェント:

```typescript
export class PromptMutationAgent {
  async proposeImprovements(
    agentName: string,
    currentPrompt: PromptVersion,
    recentPerformance: {
      avgScore: number;
      recentFailures: Array<{ context: unknown; output: unknown }>;
    }
  ): Promise<PromptVersion[]>;  // 改善案を 3-5 個生成
}
```

入力:
- 現プロンプト
- そのプロンプトで生成された結果のサンプル
- 失敗した事例(あれば)

出力:
- 改善案プロンプト(experimental として PromptRegistry に登録)
- 各案に「なぜ改善になるか」のメモ

#### 3.1.4 月次スケジューラー

`src/side-b/jobs/sideBScheduler.ts` に追加:

```typescript
schedule('monthly_prompt_evolution', '0 2 1 * *', async () => {
  for (const agentName of await promptRegistry.listAgents()) {
    // 1. 実験プロンプトの成績評価
    const experimentals = await promptRegistry.getExperimental(agentName);
    const active = await promptRegistry.getActive(agentName);
    
    // 2. 明確に active を上回るものがあれば昇格候補に
    const winners = evaluateExperimentals(experimentals, active);
    
    // 3. 人間承認フロー経由で昇格(最初の数サイクル必須)
    if (winners.length > 0) {
      await notifyHumanForApproval(agentName, winners);
    }
    
    // 4. PromptMutationAgent で新実験案を 3 個生成
    const newProposals = await promptMutationAgent.proposeImprovements(
      agentName, active, await getRecentPerformance(agentName)
    );
    
    for (const proposal of newProposals) {
      await promptRegistry.register({ ...proposal, status: 'experimental' });
    }
  }
});
```

#### 3.1.5 安全装置

**実験プロンプトの使用率上限**:
- 1エージェントあたり、全トレード呼び出しの **20% 以下** に制限
- 残り 80% は active プロンプトで処理

**実験プロンプトの即時中止**:
- 実験プロンプトの成績が active を **明確に下回る** 場合、即座に deprecated へ
- 判定基準: 使用回数20回以上、かつ active の平均スコア × 0.7 を下回る

**人間承認フロー**:
- 最初の 3 サイクルは必須
- 4 サイクル目以降、成績が明確に良い場合は自動承認に切り替え可能(ただし明示的な設定変更が必要)

### 3.2 専門家エージェント体制

#### 3.2.1 3階層構造

```
【上位層】判定エージェント(既存、役割継続)
  - DevilsAdvocate: 反証
  - StrategistAgent: 最終判定

【中位層】統合エージェント(既存、役割再定義)
  - HypothesisGenerator: 下位専門家の意見を統合して仮説生成
  - StrategyThinker: 下位専門家の意見を統合して戦略化

【下位層】専門家エージェント(新設)★ Phase 6 で追加
  - TrendSpecialist(トレンド系インジケーター群)
  - OscillatorSpecialist(オシレーター/モメンタム系)
  - VolatilityVolumeSpecialist(ボラティリティ/ボリューム系)
```

#### 3.2.2 各専門家の詳細

**TrendSpecialist**

`src/side-b/agents/specialists/TrendSpecialist.ts` + `src/side-b/prompts/specialists/trend_specialist.md`

- **担当レンズ**: dow_theory, current_analysis(MA関連部分)
- **担当インジケーター**: SMA, EMA, ADX, トレンドライン
- **出力**:
  ```typescript
  interface TrendAnalysis {
    trendState: 'strong_up' | 'weak_up' | 'ranging' | 'weak_down' | 'strong_down';
    trendStrength: number;       // 0-1
    trendMaturity: 'early' | 'middle' | 'late';
    keyLevels: { support: number[]; resistance: number[] };
    interpretation: string;      // 人間語の解釈
    confidence: number;           // 自分の分析への確信度
  }
  ```

**OscillatorSpecialist**

`src/side-b/agents/specialists/OscillatorSpecialist.ts` + `src/side-b/prompts/specialists/oscillator_specialist.md`

- **担当レンズ**: current_analysis(RSI, MACD部分)
- **担当インジケーター**: RSI, MACD, Stochastic, Williams %R
- **出力**:
  ```typescript
  interface OscillatorAnalysis {
    momentum: 'overbought' | 'bullish' | 'neutral' | 'bearish' | 'oversold';
    divergence: 'bullish_divergence' | 'bearish_divergence' | 'none';
    interpretation: string;
    confidence: number;
  }
  ```

**VolatilityVolumeSpecialist**

`src/side-b/agents/specialists/VolatilityVolumeSpecialist.ts` + `src/side-b/prompts/specialists/volatility_volume_specialist.md`

- **担当レンズ**: volatility_regime, current_analysis(ATR, BB部分)
- **担当インジケーター**: ATR, Bollinger Bands, ボリューム系(データがあれば)
- **出力**:
  ```typescript
  interface VolatilityVolumeAnalysis {
    volatilityRegime: 'expansion' | 'normal' | 'contraction';
    breakoutRisk: 'high' | 'medium' | 'low';
    volumeSignal: 'unusual_high' | 'normal' | 'unusual_low' | 'no_data';
    interpretation: string;
    confidence: number;
  }
  ```

#### 3.2.3 統合エージェントの再定義

**HypothesisGenerator の再定義**

既存の `hypothesis_generator.md` プロンプトを更新:

- 入力に「3専門家の分析結果」を追加
- 「専門家の意見を統合して仮説を生成する」役割に明示化
- 各専門家の confidence を考慮した統合ロジックをプロンプトで指示

**StrategyThinker の再定義**

同様に `strategy_thinker.md` を更新:

- 専門家の意見を統合して戦略化
- 専門家間で意見が対立する場合の扱いを明記

#### 3.2.4 スキル基盤との連携

各専門家は Phase 5.5 で作った SkillRegistry を使える:

- TrendSpecialist は `compute_lens_features`(dow_theory 絞り込み)を呼ぶ
- OscillatorSpecialist も同様(current_analysis 絞り込み)
- VolatilityVolumeSpecialist も同様(volatility_regime 絞り込み)

これにより、**専門家が自律的に必要なデータを取得する** 動きが実現する。

### 3.3 MetaEvolutionAgent の骨格

#### 3.3.1 目的

将来の自律再編成の最小実装。**提案のみ、実行は人間承認必須**。

#### 3.3.2 実装

`src/side-b/agents/MetaEvolutionAgent.ts` + `src/side-b/prompts/meta_evolution.md`

```typescript
export interface AgentRestructureProposal {
  proposedAt: Date;
  analysis: {
    currentAgents: string[];          // 現エージェント一覧
    coverageGaps: string[];           // 分析のカバーが不足している領域
    underperformers: string[];        // 成績が悪いエージェント名
  };
  proposals: Array<{
    type: 'add' | 'modify' | 'deprecate';
    agentName: string;
    role: string;                     // 担当領域
    reasoning: string;                // なぜこの提案か
    expectedImprovement: string;      // 期待される改善
    initialPrompt?: string;           // add の場合、初期プロンプト
  }>;
  confidence: number;                 // 提案全体への確信度
}

export class MetaEvolutionAgent {
  async propose(input: {
    recentPerformance: Map<string, AgentPerformance>;
    recentDiscoveryReports: DiscoveryReport[];
    recentReflections: ReflectionLesson[];
  }): Promise<AgentRestructureProposal>;
  
  // 実行は別メソッド(人間承認必須)
  async executeProposal(
    proposal: AgentRestructureProposal,
    humanApproval: { approvedBy: string; approvedAt: Date; notes?: string }
  ): Promise<{ applied: string[]; skipped: string[] }>;
}
```

#### 3.3.3 発動条件

- **自動スケジューラー統合: なし**(このフェーズでは絶対にしない)
- 手動トリガーのみ: `runMetaEvolutionNow()`
- または UI から明示的に実行

#### 3.3.4 安全装置

**追加制限**:
- 月あたり新エージェント追加上限: 1体
- 新エージェントは初期状態で experimental、一定期間後に active 昇格可

**削除制限**:
- 既存エージェントの削除は **絶対に自動化しない**
- deprecate への移行も人間判断のみ
- MetaEvolutionAgent が deprecate 提案を出しても、実行は人間承認必須

**履歴保存**:
- 全提案を永続化
- 実行されなかった提案も保存(後で振り返り可能)
- 実行された提案は「誰が承認したか」も記録

#### 3.3.5 将来の発展余地

このフェーズで実装しないが、設計書に明記する:

- 自動実行モード(運用データが十分蓄積されてから)
- 複数提案の自動 A/B 評価
- エージェント間の協調学習

---

## 4. 触っていいファイル / 触ってはいけないファイル

### 触っていい(新規作成)

**プロンプト進化基盤**:
- `src/side-b/prompts/registry/PromptRegistry.ts`
- `src/side-b/prompts/abtest/ABTestRunner.ts`
- `src/side-b/agents/PromptMutationAgent.ts`
- `src/side-b/prompts/prompt_mutation.md`

**専門家エージェント**:
- `src/side-b/agents/specialists/TrendSpecialist.ts`
- `src/side-b/agents/specialists/OscillatorSpecialist.ts`
- `src/side-b/agents/specialists/VolatilityVolumeSpecialist.ts`
- `src/side-b/prompts/specialists/trend_specialist.md`
- `src/side-b/prompts/specialists/oscillator_specialist.md`
- `src/side-b/prompts/specialists/volatility_volume_specialist.md`

**MetaEvolutionAgent**:
- `src/side-b/agents/MetaEvolutionAgent.ts`
- `src/side-b/prompts/meta_evolution.md`

**テスト**:
- `src/side-b/tests/prompts/` 以下
- `src/side-b/tests/agents/specialists/` 以下
- `src/side-b/tests/agents/metaEvolution.test.ts`

**DB/永続化**:
- Prisma マイグレーション(PromptRegistry 用テーブル追加)
- 必要なら MetaEvolutionAgent の提案履歴用テーブル

### 触っていい(改修)

- `src/side-b/prompts/hypothesis_generator.md`: 専門家統合の役割追加
- `src/side-b/prompts/strategy_thinker.md`: 同上
- `src/side-b/agents/HypothesisGeneratorAgent.ts`: 入力型に専門家分析結果を追加
- `src/side-b/agents/StrategyThinker.ts`(実体があれば): 同上
- `src/side-b/jobs/sideBScheduler.ts`: 月次プロンプト進化ジョブ追加
- `prisma/schema.prisma`: プロンプト関連テーブル追加

### 触ってはいけない

- Phase 1-3 のレンズ実装(既存の動作保持)
- Phase 4a-4d の成果物全般
- Phase 5A の進化ループ実装
- Phase 5.5 の SkillRegistry 実装
- **Side-A 関連ファイル全般**(協業パートナー原則)
- 既存の既存エージェント(DevilsAdvocate, ReflectionAI, Discovery, Strategist, Mutation, Crossover)の振る舞いを **破壊的に変更しない**
- 既存の Prisma テーブル(TradeNote, AITradeNote, EdgeHypothesis 等)

---

## 5. 設計上の注意

### 5.1 このフェーズでやらないこと

- **Elliott Lens / SMC Lens の実装**: Phase 7(SMC), Phase 8(Elliott)で別途
- **Elliott 専門家 / SMC 専門家**: 上記レンズ実装後に追加
- **ファンダメンタルズ専門家**: 別フェーズ(Phase 9 想定、ファンダメンタルズ基盤構築を含む)
- **MetaEvolutionAgent の自動実行**: 手動トリガーのみ、運用観察後に自動化検討
- **既存エージェントの大規模リファクタ**: HypothesisGenerator/StrategyThinker の入力型追加程度に留める

### 5.2 設計思想の再確認

**なぜ専門家化するか**:
- 概念が複雑な領域(将来の Elliott, SMC)は専門家が必須
- 機能グループ(トレンド、ボラ、モメンタム)で専門家化するとエージェント数を抑えつつコンテキストを洗練できる
- インジケーター個別の専門家化は行わない(粒度が細かすぎ)

**なぜ MetaEvolutionAgent の骨格を今置くか**:
- 将来の自律再編成への扉を最初から開けておく
- 専門家構造を MetaEvolutionAgent の観測対象として最初から整える
- 後から追加すると、既存構造が MetaEvolutionAgent 前提になってない可能性

### 5.3 LLM コスト配慮

このフェーズでエージェント数が 7 → 10 に増える(3専門家 + 1 PromptMutation + 1 MetaEvolution、既存継続 7)。LLM 呼び出しコストが増える。

対策:
- 専門家は必要な時のみ呼び出す(HypothesisGenerator が呼ぶ時のみ)
- プロンプト進化の実験使用率は 20% 以下
- MetaEvolutionAgent は手動トリガーのみ、月1回程度の想定

### 5.4 既存エージェントとの互換性

HypothesisGenerator と StrategyThinker は入力型に専門家分析を **オプショナルで追加**。既存の呼び出しコード(専門家なしでの呼び出し)が動き続ける必要がある。

段階的移行:
1. まず HypothesisGenerator に専門家入力をオプショナル追加
2. 呼び出し側で徐々に専門家分析を渡すように更新
3. 両パスが動作することを確認

### 5.5 将来拡張の扉を開けておく

**動的エージェント追加への対応**:
- PromptRegistry は `agentName` を列挙型で固定しない
- エージェント一覧は動的に取得できる(`listAgents()`)
- 新エージェント追加時の DB スキーマ変更が不要な設計

**エージェント間通信の余地**:
- 将来エージェント間で直接通信する可能性を考慮
- 現状は中位統合層が仲介、将来は peer-to-peer も可能な抽象化

---

## 6. 実装順序(推奨)

Claude Code に推奨する実装順序:

### ステップ1: プロンプト進化基盤
1. PromptRegistry + DB マイグレーション
2. 既存プロンプトの初期投入(既存 `.md` ファイルから)
3. ABTestRunner
4. PromptMutationAgent
5. 月次スケジューラー統合(実行はしない設定)

### ステップ2: 専門家エージェント
1. TrendSpecialist 実装
2. OscillatorSpecialist 実装
3. VolatilityVolumeSpecialist 実装
4. 各専門家のユニットテスト

### ステップ3: 既存エージェントの再定義
1. HypothesisGenerator のプロンプト更新
2. HypothesisGenerator の入力型拡張
3. StrategyThinker 同様
4. 既存呼び出しの互換性確認

### ステップ4: MetaEvolutionAgent
1. 骨格クラス実装
2. 提案生成ロジック(LLM 呼び出し)
3. 実行メソッド(人間承認必須)
4. 安全装置の組み込み

### ステップ5: 統合と動作確認
1. エンドツーエンド動作確認
2. 既存テスト全通過の確認
3. 新規テストの追加

各ステップ終了時にコミット。

---

## 7. 完了報告時に含めること

1. 作成/変更したファイル一覧
2. DB マイグレーション差分
3. プロンプト進化基盤の動作ログ:
   - 実験プロンプト生成の例
   - A/B テスト実行の例
4. 専門家エージェントの動作ログ:
   - 各専門家の出力サンプル
   - 統合エージェントが専門家意見をどう統合したか
5. MetaEvolutionAgent の動作ログ:
   - 手動トリガーでの提案生成例
   - 人間承認フローの動作確認
6. 既存テスト全通過の確認
7. 新規テストの実行結果
8. LLM コストの概算(月次プロンプト進化 + 日次の専門家呼び出し)
9. Phase 7 以降への引き継ぎメモ

---

## 8. レビュー観点

- PromptRegistry が動的エージェント追加に対応しているか(列挙型固定していないか)
- 実験プロンプトの使用率制限が機能しているか
- 専門家エージェントが SkillRegistry を介してレンズにアクセスしているか
- 既存エージェント(HypothesisGenerator 等)の変更が後方互換か
- MetaEvolutionAgent が自動実行されていないか(手動トリガーのみか)
- 既存エージェントの削除/deprecate が自動化されていないか
- 人間承認フローが全ての破壊的変更で必須になっているか
- Side-A のコードに一切変更がないか

---

## 9. 将来拡張(このフェーズの範囲外)

### 9.1 専門家の追加予定

このフェーズで3専門家を作るが、将来以下を追加する:

- **Phase 7**: SMC Lens 実装、SMC 専門家追加
- **Phase 8**: Elliott Lens 実装、Elliott 専門家追加
- **Phase 9(構想)**: ファンダメンタルズ基盤 + ファンダメンタルズ専門家
  - 経済指標カレンダー
  - 中央銀行政策スタンス
  - 地政学・市場センチメント

### 9.2 MetaEvolutionAgent の発展

Phase 6 では骨格のみ。運用観察を経て以下を追加する候補:

- **自動実行モード**: 人間承認なしでの再編成(データが十分蓄積されてから)
- **複数提案の自動 A/B 評価**
- **エージェント自動削除**: 長期間使われないエージェントの自動 deprecate

### 9.3 自律再編成の最終形

**このシステムの真の理想**:

AI 自身が進化ループの過程で「どんな専門家が必要か」を発見し、自律的にエージェント構成を再編成する。人間が事前に「トレンド専門家、オシレーター専門家...」と配置するのではなく、データから必要な専門性が自発的に立ち上がる。

Phase 6 時点ではこの自律再編成は実装しない。しかし以下の扉は開けておく:

- PromptRegistry は動的エージェント追加を拒否しない
- エージェントは自分の担当領域をメタデータで自己記述する(`role`, `expectedImprovement`)
- 将来、MetaEvolutionAgent がエージェント構成を自動再編成する可能性を想定した設計

Phase 6 完了後の運用で「どの専門家が効いたか」「新しい専門家が必要か」が見えてから、MetaEvolutionAgent の自動化を判断する。

---

## 10. このフェーズの位置付け(設計書全体の中で)

Phase 6 は、Phase 1-5A, 5.5 で築いた基盤の上に **エージェントの自己改善機構** を乗せるフェーズ。

- Phase 1-3 で「観察する土台」(レンズ基盤)を作った
- Phase 4 系で「エッジを検証する仕組み」(検証パイプライン)を作った
- Phase 5A で「戦略を進化させる仕組み」(DSL + 進化ループ)を作った
- Phase 5.5 で「エージェントが使える道具」(スキル基盤)を作った
- **Phase 6 で「エージェント自身が改善される仕組み」(プロンプト進化 + 専門家体制 + 自己再編成骨格)を作る**

これ以降のフェーズ(Phase 7 以降)は、この上に新しいレンズ/専門家/データソースを追加していく段階になる。

---

*Phase 6 完了時点で、システムは単なる「固定のルールで動くツール」から「自己改善し続けるエージェント群」へと質的に変化する。このフェーズはアーキテクチャ上の転換点である。*
