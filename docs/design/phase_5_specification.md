# フェーズ5 発注仕様書: 戦略 JSON DSL と進化的探索の最小版

> **期間目安**: 2〜4週間
> **目的**: 戦略を機械可読な JSON DSL で表現し、LLM を "変異オペレーター" として世代交代ループを動かす
> **前提**: フェーズ1-4 完了(レンズ基盤、AIロール分化、EdgeLedger)
> **前提読み物**: `docs/design/DESIGN_DOC_autonomous_trading_architecture.md` の セクション6(進化的探索ループ)

---

## 1. このフェーズのゴール

LLM の「構造の発見」能力を進化計算として活用する。単一の LLM 呼び出しでは到達しない戦略組み合わせに、**世代交代を繰り返すことで到達する** 仕組みを作る。

成果物は3つ:
1. **戦略 JSON DSL** ― 戦略を機械可読・機械実行可能な形式で表現
2. **StrategyPopulation** ― レジーム別の戦略集団管理
3. **EvolutionLoop** ― 選抜・変異・交配・淘汰の自動化ループ

**このフェーズで意図的にやらないこと**: 複雑レンズ(エリオット、SMC)の追加、プロンプト自体の進化(フェーズ6)。

---

## 2. 完了条件

以下の全てを満たす:

- [ ] 戦略 JSON DSL のスキーマが定義され、zod バリデーションが存在する
- [ ] `DSLEvaluator` が実装され、DSL を受けて条件評価・バックテスト実行ができる
- [ ] `StrategyPopulation` が実装され、レジーム別に戦略集団を管理できる
- [ ] LLM を使った変異オペレーター(`MutationAgent`)が実装されている
- [ ] LLM を使った交配オペレーター(`CrossoverAgent`)が実装されている
- [ ] 多様性維持機構(類似戦略の淘汰)が実装されている
- [ ] 日次スケジューラーで1世代分の進化が実行される
- [ ] 昇格した戦略が EdgeLedger に confirmed として登録される
- [ ] 既存テストが全て通る
- [ ] 新ロジックのユニットテストがある

---

## 3. 触っていいファイル / 触ってはいけないファイル

### 触っていい(新規作成)
- `src/side-b/strategy_dsl/schema.ts`
- `src/side-b/strategy_dsl/DSLEvaluator.ts`
- `src/side-b/strategy_dsl/DSLBacktestAdapter.ts`
- `src/side-b/evolution/StrategyPopulation.ts`
- `src/side-b/evolution/EvolutionLoop.ts`
- `src/side-b/evolution/DiversityEnforcer.ts`
- `src/side-b/agents/MutationAgent.ts`
- `src/side-b/agents/CrossoverAgent.ts`
- `src/side-b/prompts/mutation.md`
- `src/side-b/prompts/crossover.md`
- 関連テスト群

### 触っていい(改修)
- `src/side-b/jobs/sideBScheduler.ts` ― 進化ループの日次実行追加
- `src/side-b/ledger/EdgeLedger.ts` ― 戦略 DSL との紐付けフィールド追加(オプショナル)
- `src/side-b/agents/EdgeValidatorAgent.ts` ― DSL 経由のバックテスト呼び出しに対応

### 触ってはいけない
- `src/side-b/lenses/` (確定したレンズ基盤)
- `src/side-b/agents/` の既存エージェント(変更禁止、拡張のみ)
- `src/side-b/models/edgeHypothesis.ts` の既存フィールド

---

## 4. 実装仕様

### 4.1 戦略 JSON DSL スキーマ

`src/side-b/strategy_dsl/schema.ts`

```typescript
import { z } from 'zod';

/** 比較演算子 */
export const OpSchema = z.enum(['<', '<=', '>', '>=', '==', '!=', 'between', 'in']);

/** パラメーター参照("$p1" のような記法) */
export const ParamRefSchema = z.string().regex(/^\$[a-z][a-z0-9_]*$/);

/** 条件式(レンズ特徴量と値の比較) */
export const ConditionSchema = z.object({
  lens: z.string(),
  feature: z.string(),
  op: OpSchema,
  value: z.union([z.number(), z.string(), z.boolean(), ParamRefSchema]),
});

/** 条件グループ(AND/OR) */
export const ConditionGroupSchema: z.ZodType<ConditionGroup> = z.lazy(() => z.object({
  logic: z.enum(['AND', 'OR']),
  conditions: z.array(z.union([ConditionSchema, ConditionGroupSchema])),
}));

/** エントリー定義 */
export const EntrySchema = z.object({
  direction: z.enum(['long', 'short']),
  trigger: ConditionGroupSchema,
  orderType: z.enum(['market', 'limit', 'stop']).default('market'),
});

/** ストップロス定義 */
export const StopLossSchema = z.union([
  z.object({ type: z.literal('atr_multiple'), value: z.union([z.number(), ParamRefSchema]) }),
  z.object({ type: z.literal('fixed_pips'), value: z.union([z.number(), ParamRefSchema]) }),
  z.object({ type: z.literal('swing_point'), lookbackBars: z.union([z.number(), ParamRefSchema]) }),
]);

/** テイクプロフィット定義 */
export const TakeProfitSchema = z.union([
  z.object({ type: z.literal('rr_ratio'), value: z.union([z.number(), ParamRefSchema]) }),
  z.object({ type: z.literal('fixed_pips'), value: z.union([z.number(), ParamRefSchema]) }),
  z.object({ type: z.literal('atr_multiple'), value: z.union([z.number(), ParamRefSchema]) }),
]);

/** パラメーター定義 */
export const ParameterDefSchema = z.object({
  range: z.tuple([z.number(), z.number()]),
  default: z.number(),
  type: z.enum(['int', 'float']),
});

/** 戦略DSLルート */
export const StrategyDSLSchema = z.object({
  id: z.string(),
  generation: z.number().default(0),
  parentIds: z.array(z.string()).default([]),
  regimeTarget: z.string(),  // "trending_with_pullback" など
  symbol: z.string(),
  timeframe: z.string(),
  entry: EntrySchema,
  stopLoss: StopLossSchema,
  takeProfit: TakeProfitSchema,
  parameters: z.record(ParameterDefSchema).default({}),
  metadata: z.object({
    createdAt: z.string(),
    createdBy: z.enum(['initial_random', 'mutation', 'crossover', 'llm_generated']),
    description: z.string().optional(),
  }),
});

export type StrategyDSL = z.infer<typeof StrategyDSLSchema>;
```

### 4.2 DSLEvaluator

`src/side-b/strategy_dsl/DSLEvaluator.ts`

DSL と現在の LensFeatureSnapshot を受け取り、エントリー条件が成立しているかを評価する。

```typescript
export class DSLEvaluator {
  /** 条件評価 */
  evaluateConditions(
    conditions: ConditionGroup,
    snapshot: LensFeatureSnapshot,
    paramValues: Record<string, number>
  ): boolean {
    // 再帰的に AND/OR を評価
    // Condition は lens, feature を snapshot から取得して op で比較
  }
  
  /** パラメーター置換 */
  resolveParam(value: unknown, paramValues: Record<string, number>): unknown {
    if (typeof value === 'string' && value.startsWith('$')) {
      const key = value.slice(1);
      if (!(key in paramValues)) throw new Error(`Undefined parameter: ${value}`);
      return paramValues[key];
    }
    return value;
  }
}
```

### 4.3 DSLBacktestAdapter

`src/side-b/strategy_dsl/DSLBacktestAdapter.ts`

DSL を既存の `strategyBacktestService` が受け取れる形式に変換する。既存サービスのインターフェースに寄せる。

```typescript
export class DSLBacktestAdapter {
  async runBacktest(
    dsl: StrategyDSL,
    paramValues: Record<string, number>,
    period: { start: string; end: string }
  ): Promise<BacktestResult> {
    // 1. DSL と paramValues から既存の BacktestRequest を構築
    // 2. strategyBacktestService.runBacktest() を呼び出す
    // 3. 結果を返す
  }
  
  async runWithParameterSweep(
    dsl: StrategyDSL,
    period: { start: string; end: string },
    samplingStrategy: 'grid' | 'random' | 'default',
    sampleCount?: number
  ): Promise<BacktestResult[]> {
    // パラメーター空間を探索しつつ複数回バックテスト
  }
}
```

### 4.4 StrategyPopulation

`src/side-b/evolution/StrategyPopulation.ts`

レジーム別の戦略集団を管理。

```typescript
export class StrategyPopulation {
  private populations: Map<string, StrategyDSL[]> = new Map();
  
  readonly maxSize = 50;
  
  add(regime: string, strategy: StrategyDSL): void {
    const list = this.populations.get(regime) ?? [];
    list.push(strategy);
    if (list.length > this.maxSize) {
      // サイズ超過時は削除(淘汰ロジック別途呼び出し前提)
    }
    this.populations.set(regime, list);
  }
  
  getByRegime(regime: string): StrategyDSL[];
  getElites(regime: string, count: number, scores: Map<string, number>): StrategyDSL[];
  getLosers(regime: string, count: number, scores: Map<string, number>): StrategyDSL[];
  
  // 淘汰
  pruneBySize(regime: string, scores: Map<string, number>): StrategyDSL[];  // 返り値は削除された戦略
  pruneBySimilarity(regime: string, enforcer: DiversityEnforcer): StrategyDSL[];
  
  // 永続化
  async save(): Promise<void>;
  async load(): Promise<void>;
}
```

### 4.5 MutationAgent

`src/side-b/agents/MutationAgent.ts` + `src/side-b/prompts/mutation.md`

**入力**: エリート戦略群 + それらのバックテスト成績

**処理**: LLM に以下を問う:
- これらの戦略の共通点は何か
- その共通点を強化した変異体を N 個生成せよ

**出力**: 新規 StrategyDSL[](検証前)

プロンプトのポイント:
- 変異の種類を明示(パラメーター範囲変更、条件追加、条件緩和、レンズ組み替え)
- 親戦略の `id` を `parentIds` に記録
- `generation` を親 + 1 に設定

### 4.6 CrossoverAgent

`src/side-b/agents/CrossoverAgent.ts` + `src/side-b/prompts/crossover.md`

**入力**: 戦略ペア(親A, 親B)+ 両者のバックテスト成績

**処理**: LLM に「AとBの良い部分を組み合わせた戦略を生成せよ」と指示

**出力**: 新規 StrategyDSL(親2つを持つ)

### 4.7 DiversityEnforcer

`src/side-b/evolution/DiversityEnforcer.ts`

戦略同士の類似度を計算し、集団内で似すぎた個体を検出する。

```typescript
export class DiversityEnforcer {
  /** 2つの戦略の類似度(0-1、1が完全一致) */
  similarity(a: StrategyDSL, b: StrategyDSL): number {
    // 同じ lens/feature を使っているか、条件数、パラメーター範囲の近さ、など
  }
  
  /** 集団内で類似度が閾値を超えるペアを検出 */
  findTooSimilarPairs(strategies: StrategyDSL[], threshold = 0.85): Array<[string, string]>;
  
  /** 多様性スコア(集団全体の分散) */
  diversityScore(strategies: StrategyDSL[]): number;
}
```

### 4.8 EvolutionLoop

`src/side-b/evolution/EvolutionLoop.ts`

1世代分の進化を実行するメインロジック。

```typescript
export class EvolutionLoop {
  async runOneGeneration(regime: string): Promise<GenerationReport> {
    // 1. 現集団を取得
    const population = this.populations.getByRegime(regime);
    
    // 2. 全戦略をバックテスト
    const scores = new Map<string, number>();
    for (const strategy of population) {
      const result = await this.adapter.runBacktest(strategy, /* default params */, /* period */);
      scores.set(strategy.id, this.scoreStrategy(result));
    }
    
    // 3. エリート選抜(上位5個保存)
    const elites = this.populations.getElites(regime, 5, scores);
    
    // 4. 下位廃棄(下位5個削除)
    this.populations.pruneBySize(regime, scores);
    
    // 5. LLM 呼び出しで変異体生成
    const mutants = await this.mutationAgent.generateMutants(elites, 10);
    
    // 6. 交配体生成
    const crossovers = await this.crossoverAgent.generateCrossovers(elites, 5);
    
    // 7. 多様性強制
    const survivors = this.enforcer.filterDiverse([...mutants, ...crossovers]);
    
    // 8. 新集団に追加
    for (const s of survivors) this.populations.add(regime, s);
    
    // 9. 多様性低下時は強制多様化プロンプト実行
    if (this.enforcer.diversityScore(this.populations.getByRegime(regime)) < 0.3) {
      const diverseStrategies = await this.mutationAgent.generateDiverse(regime, 5);
      for (const s of diverseStrategies) this.populations.add(regime, s);
    }
    
    // 10. 昇格候補を EdgeLedger に通知
    await this.promoteEligibleStrategies(elites, scores);
    
    return this.buildReport(regime, elites, mutants, crossovers, scores);
  }
  
  private scoreStrategy(result: BacktestResult): number {
    // PF + 勝率 + トレード数 + RR の重み付け合成スコア
  }
  
  private async promoteEligibleStrategies(elites: StrategyDSL[], scores: Map<string, number>): Promise<void> {
    for (const strategy of elites) {
      // 3条件チェック: 学習PF > 1.5, 検証PF > 1.3, 過学習スコア < 0.3
      // 満たしたら EdgeLedger.markConfirmed()
    }
  }
}
```

### 4.9 スケジューラー統合

`sideBScheduler.ts` に追加:

```typescript
// 日次実行: 各レジームで1世代進化
schedule('daily_evolution', '0 3 * * *', async () => {
  const regimes = ['trending_with_pullback', 'breakout', 'consolidation', 'reversal'];
  for (const regime of regimes) {
    await evolutionLoop.runOneGeneration(regime);
  }
});
```

リソース配慮:
- 全レジーム連続実行を避け、間に sleep を入れる
- LLM 呼び出し失敗時はリトライ、3回失敗でスキップ

### 4.10 テスト

- `DSLEvaluator`: 条件評価の真偽テスト、ネストされた AND/OR のテスト
- `DSLBacktestAdapter`: DSL から BacktestRequest への変換が正しいか
- `StrategyPopulation`: サイズ管理、淘汰
- `DiversityEnforcer`: 類似度計算、重複検出
- `EvolutionLoop`: モックされた LLM/バックテストで1世代実行
- 各エージェント: 出力パースのテスト

---

## 5. 設計上の注意

### 5.1 このフェーズでやらないこと

- 複雑レンズ(エリオット、SMC)を DSL に組み込むこと(フェーズ6)
- プロンプト自体の進化(フェーズ6)
- 戦略 DSL の UI 表示・編集
- 戦略の共有・エクスポート機能
- Optuna など高度な最適化ライブラリの導入(最小版はグリッドサーチ)

### 5.2 初期集団の作り方

世代0の初期集団は以下の組み合わせで20個:
- `StrategyThinker` の過去出力を DSL に変換したもの: 5個
- ランダム生成(条件を無作為に組み合わせる): 10個
- LLM に「バラエティに富んだ戦略を5個」と指示した出力: 5個

### 5.3 スコアリング関数

初期は単純な合成スコア:
```
score = PF * 0.4 + winRate * 0.2 + min(tradeCount, 100) * 0.002 + avgRR * 0.2
```
運用しながら調整する。`tradeCount` に上限をつけないと「頻繁にトレードする戦略」が勝ちすぎる。

### 5.4 LLM コストの監視

進化ループは LLM 呼び出しが多い:
- 1世代 × 4レジーム × (変異10 + 交配5 + 多様化5) = 80呼び出し/日
- コスト予算を決めて、超える場合は世代頻度を週次に落とす

### 5.5 「勝てる戦略」の罠

進化の過程で過学習した戦略が高スコアを得る可能性がある。対策:
- スコアリングは **検証期間の成績で** 行う(学習期間ではなく)
- 定期的(週次)に「全戦略を未見期間で再評価」する

### 5.6 過剰な自動化を避ける

**全自動で戦略を本番トレードに使う前に、必ず人間の確認を入れる**。このフェーズでは:
- 進化ループは仮想トレードまで
- `confirmed` に昇格しても、実トレード(将来実装)への自動投入は別途判断

---

## 6. 完了報告時に含めること

1. 作成/変更したファイルの一覧
2. DSL サンプル(3〜5個、簡単な戦略から複雑な戦略まで)
3. `EvolutionLoop.runOneGeneration()` のサンプル実行ログ
4. 1世代実行時の LLM コスト実測
5. 既存テスト全通過の確認
6. 昇格された戦略の例(あれば)
7. 次フェーズへの引き継ぎメモ

---

## 7. レビュー観点

- DSL が意図した戦略を正しく表現できているか(手書き戦略で検証)
- 進化ループ1世代が現実的な時間(目安: 30分以内)で完了するか
- 多様性が維持されているか(全戦略が同じ形に収束していないか)
- スコアリング関数が「未知データでの性能」を反映しているか
- EdgeLedger への昇格が厳格な3条件を守っているか
