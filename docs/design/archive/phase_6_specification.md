# フェーズ6 発注仕様書: 高度レンズとプロンプト進化

> **期間目安**: 継続的(各サブフェーズ 2〜4週間)
> **目的**: エリオット波動簡易レンズ・SMCレンズ等の複雑レンズを追加、プロンプト自体を進化対象にする
> **前提**: フェーズ1-5 完了(基盤 + エージェント分化 + 進化ループ)
> **前提読み物**: `docs/design/DESIGN_DOC_autonomous_trading_architecture.md` 全体

---

## 1. このフェーズのゴール

システムが「考える土台」として持つレンズと、「思考そのもの」としてのプロンプトの両方を拡張する最終段階。ここまでくるとシステムは単なるツールから、**自己改善し続けるエージェント群** に近づく。

このフェーズは他と異なり **複数のサブフェーズに分かれる**。並行せず、順次実行する。

- **6.1**: ElliottSimpleLens(エリオット絶対ルール + 確率分布カウント)
- **6.2**: SMCLens(流動性スイープ、FVG、オーダーブロック)
- **6.3**: プロンプト進化基盤
- **6.4**: 複雑レンズの DSL 統合
- **6.5**: ユーザー設定UI統合(レンズ重み付け)

---

## 2. 全体完了条件

全サブフェーズ完了時に以下を満たす:

- [ ] エリオット波動の絶対ルールチェッカーが実装され、違反を検出できる
- [ ] エリオット波動のカウント候補が確率分布として出力される
- [ ] SMC の主要概念(流動性スイープ、FVG、オーダーブロック)が機械判定されている
- [ ] 両レンズが進化ループの戦略 DSL で使用可能である
- [ ] プロンプトのバージョン管理と A/B テスト基盤がある
- [ ] プロンプト進化が月次スケジューラーで実行される
- [ ] UI でユーザーが検索時のレンズ重み付けを選択できる
- [ ] 既存テスト・機能が全て維持されている

---

## サブフェーズ 6.1: ElliottSimpleLens

### 6.1.1 ゴール

エリオット波動を「カウント一意決定」ではなく「確率分布 + 絶対ルール違反検出」として扱う形でレンズ化する。主観性を排除し、検証可能性を維持する。

### 6.1.2 触るファイル

新規:
- `src/side-b/lenses/ElliottSimpleLens.ts`
- `src/side-b/lenses/utils/elliottRules.ts`
- `src/side-b/lenses/utils/fibonacciRatios.ts`
- `src/side-b/tests/lenses/elliottSimpleLens.test.ts`

### 6.1.3 実装仕様

#### 絶対ルールチェッカー

エリオット波動の「絶対に満たされる必要があるルール」を機械判定:

```typescript
export interface ElliottRuleViolation {
  rule: 'wave2_overlap_wave1_start' | 'wave3_shortest' | 'wave4_overlap_wave1' | /* etc */;
  severity: 'strict' | 'guideline';
  affectedWaves: string[];
  description: string;
}

export function checkAbsoluteRules(waveCandidate: WaveLabeling, pivots: Pivot[]): ElliottRuleViolation[];
```

判定するルール:
- 第2波の終点が第1波の起点を超えない(strict)
- 第3波が1/3/5波の中で最短にならない(strict)
- 第4波が第1波の価格領域に重ならない(原則、guideline)
- A波・B波・C波の関係性(ABC調整の場合)

#### フィボナッチ尤度計算

```typescript
/** 波の長さの比率に対するフィボナッチ適合度 */
export function fibonacciFitness(
  actualRatio: number,
  targetRatio: number,
  tolerance: number = 0.05
): number {
  // 正規分布ライクな尤度関数
  // 完全一致で 1.0、遠ざかるほど減衰
  const deviation = Math.abs(actualRatio - targetRatio);
  return Math.exp(-(deviation * deviation) / (2 * tolerance * tolerance));
}

/** 波動カウントの全体尤度 */
export function countLikelihood(waveCandidate: WaveLabeling, pivots: Pivot[]): number;
```

#### ElliottSimpleLens の出力

```typescript
interface ElliottSimpleLensOutput {
  // 絶対ルール違反
  rule_violations_count: number;
  has_strict_violation: boolean;
  
  // カウント候補(最大5個、確率で正規化)
  candidates: Array<{
    label: string;  // "推進第3波途中", "調整B波", など
    probability: number;
    fibonacciFit: number;
  }>;
  
  // 最有力候補
  top_candidate_label: string;
  top_candidate_probability: number;
  
  // 補助特徴量
  fib_fit_score_best: number;  // 最高尤度のカウントの適合度
  mtf_consistency: number;  // マルチTFで整合するカウントの割合(0-1)
  
  // ロバスト性
  alternative_count: number;  // 尤度上位5個の中で大きく異なるもの
}
```

**重要**: このレンズは「カウントを決定しない」。常に確率分布として出力する。どの戦略もこの確率を加重して使う。

### 6.1.4 マルチタイムフレーム統合

オプション機能として、複数タイムフレームでカウントを実行し、整合性スコアを出力:
- 日足で上位5候補
- 4時間足で上位5候補
- 両方で整合するカウントの割合 → `mtf_consistency`

初回実装は単一TFでも可。MTF は 6.1.b として後段に回す。

---

## サブフェーズ 6.2: SMCLens

### 6.2.1 ゴール

Smart Money Concepts の主要要素を客観判定可能なレンズとして実装する。これもトレーダー間で用語が統一されていない領域なので、機械判定可能な定義に絞る。

### 6.2.2 実装する特徴量

| キー | 説明 |
|------|------|
| `liquidity_sweep_high_recent` | 直近で前回スイングハイを一時的に抜いて戻した動きがあったか |
| `liquidity_sweep_low_recent` | 直近で前回スイングローを一時的に抜いて戻した動きがあったか |
| `fvg_bullish_present` | 直近で未充填のブリッシュ FVG が存在するか |
| `fvg_bearish_present` | 直近で未充填のベアリッシュ FVG が存在するか |
| `fvg_nearest_distance_pips` | 最も近い未充填 FVG までの距離(pips) |
| `order_block_bullish_proximity` | 直近のブリッシュ OB までの距離 |
| `order_block_bearish_proximity` | 直近のベアリッシュ OB までの距離 |
| `bos_bullish_recent` | 直近で上方へのストラクチャーブレイクがあったか |
| `bos_bearish_recent` | 直近で下方へのストラクチャーブレイクがあったか |
| `choch_recent` | 直近で CHOCH(Change of Character)の兆候があったか |

### 6.2.3 判定定義

解釈の揺れを避けるため、各概念に **コード上の厳密定義** を与える:

- **Liquidity Sweep**: 直近N本の価格が過去M本の最高値/最安値を超え、かつ D 本以内に価格がその水準を明確に下回った(上回った)
- **FVG (Fair Value Gap)**: 連続する3本のローソク足で、中央のローソクが前後のローソクの実体・ヒゲで埋められないギャップを作った状態
- **Order Block**: 強い推進の直前の最後の反対方向ローソク
- **BOS (Break of Structure)**: 直近のスイングハイ/ローを実体ベースで明確にブレイクした動き

**重要**: 定義に揺れがある場合は、コード内のコメントで **このレンズの定義** を明示する。他の人が同じ用語で違う意味で使っていても、このレンズはこの定義で一貫する。

### 6.2.4 触るファイル

- `src/side-b/lenses/SMCLens.ts`
- `src/side-b/lenses/utils/smcDetection.ts` (FVG、OB、スイープ検出ロジック)
- `src/side-b/tests/lenses/smcLens.test.ts`

---

## サブフェーズ 6.3: プロンプト進化基盤

### 6.3.1 ゴール

エージェントのシステムプロンプトを **進化対象** にする。同じタスクに対して異なるプロンプトバリアントの成績を比較し、優れたバリアントを残していく。

### 6.3.2 実装する仕組み

#### PromptRegistry

`src/side-b/prompts/PromptRegistry.ts`

プロンプトのバージョン管理:

```typescript
export interface PromptVersion {
  id: string;
  agentName: string;
  version: string;
  content: string;
  parentVersionId?: string;
  createdAt: Date;
  createdBy: 'human' | 'mutation';
  
  // 成績追跡
  usageCount: number;
  successCount: number;  // 該当プロンプトで生成された戦略が confirmed に至った回数
  avgScore: number;  // 生成された戦略の平均スコア
  
  status: 'active' | 'experimental' | 'deprecated';
}

export class PromptRegistry {
  async register(prompt: PromptVersion): Promise<void>;
  async getActive(agentName: string): Promise<PromptVersion>;
  async getExperimental(agentName: string): Promise<PromptVersion[]>;
  async recordUsage(versionId: string, score: number): Promise<void>;
}
```

#### A/B テストランナー

`src/side-b/prompts/ABTestRunner.ts`

- 同じ入力を複数のプロンプトバリアントで並行実行
- 結果のスコアを比較
- 統計的有意な差が出たら新しい active を決定

#### PromptMutationAgent

`src/side-b/agents/PromptMutationAgent.ts`

既存プロンプトを変異させる専門エージェント:

- 現プロンプトと、そのプロンプトで生成された戦略の成績を受け取る
- LLM に「このプロンプトを改善するには?」と問う
- 改善案を3-5個生成し、`experimental` として PromptRegistry に登録

### 6.3.3 スケジューラー

月次で以下を実行:
1. 各エージェントの active プロンプトと実験プロンプト群の成績比較
2. 実験プロンプトの中で active を明確に上回るものがあれば昇格
3. PromptMutationAgent で新たな実験プロンプトを3個生成

### 6.3.4 安全装置

プロンプト変異が悪化を引き起こさないよう:
- 実験プロンプトは全トレードの最大 20% にのみ使用
- 実験プロンプトの成績が active を明確に下回る場合、即座に中止
- Human-in-the-loop: 月次の昇格判定は人間承認を必須にする(最初の数サイクル)

---

## サブフェーズ 6.4: 複雑レンズの DSL 統合

### 6.4.1 ゴール

エリオット・SMC レンズの特徴量を戦略 JSON DSL で使えるようにし、進化ループでこれらのレンズを活用した戦略が生成できるようにする。

### 6.4.2 作業内容

- `DSLEvaluator` が新レンズの特徴量を評価できるよう拡張
- `MutationAgent` のプロンプトに「エリオット特徴量、SMC特徴量を使う戦略の例」を追加
- 新レンズを使った初期戦略テンプレートを追加(例: 「エリオット第3波可能性高 + SMC流動性スイープ後のエントリー」)

### 6.4.3 注意事項

- エリオットは **確率分布** で扱う。「top_candidate_label == '推進第3波'」のような離散判定ではなく、「top_candidate_probability > 0.5」のような確率閾値で条件化する
- SMC の判定は時間依存性がある(FVGが埋まったかどうかなど)。戦略の有効期間を意識する

---

## サブフェーズ 6.5: ユーザー設定UI統合

### 6.5.1 ゴール

設計書でずっと議論してきた「UIでレンズのON/OFFを切り替える」要求に、**検索時重み付けとして** 応える。

### 6.5.2 実装内容

#### レンズモード

事前定義された検索モード:

```typescript
export const LensSearchModes = {
  classical: {
    name: 'クラシカル',
    description: '伝統的なテクニカル分析中心',
    weights: {
      current_analysis: 1.0,
      dow_theory: 1.0,
      volatility_regime: 0.8,
      time_session: 0.5,
      elliott_simple: 0.0,
      smc: 0.0,
    },
  },
  elliott_focused: {
    name: 'エリオット重視',
    description: '波動分析を主軸に',
    weights: {
      current_analysis: 0.5,
      dow_theory: 0.8,
      volatility_regime: 0.5,
      time_session: 0.3,
      elliott_simple: 1.0,
      smc: 0.3,
    },
  },
  smc_focused: {
    name: 'SMC重視',
    description: 'スマートマネー概念を主軸に',
    weights: {
      current_analysis: 0.3,
      dow_theory: 0.5,
      volatility_regime: 0.5,
      time_session: 0.5,
      elliott_simple: 0.0,
      smc: 1.0,
    },
  },
  data_driven: {
    name: 'データドリブン',
    description: '全レンズを均等に扱う',
    weights: { /* 全部 1.0 */ },
  },
};
```

#### EdgeLedger の findMatching の重み付け対応

```typescript
async findMatching(
  symbol: string, 
  snapshot: LensFeatureSnapshot,
  lensWeights?: Record<string, number>
): Promise<Array<{ hypothesis: EdgeHypothesis; matchScore: number }>>;
```

仮説のマッチングスコア計算時、ユーザーが選択したモードの `lensWeights` を適用。重み 0 のレンズは類似度計算から除外される。

#### UI

- モード選択ドロップダウン(プリセット)
- 詳細調整画面(各レンズに 0-1 のスライダー)
- 現在のモードをユーザープロファイルに保存

### 6.5.3 重要な設計原則の再確認

**UI のレンズ重み付けは "表示の見え方" だけに影響する**。以下は絶対に重みで変わらない:
- 全レンズは常に計算される(記録は一律)
- エッジ台帳の蓄積は分断されない
- 進化ループは全レンズを使い続ける
- 背景で稼働する自動学習も全レンズを使う

これにより、ユーザーの好みとシステムの学習は独立する。

---

## 3. 全体の注意事項

### 3.1 サブフェーズの順序

必ずこの順:
1. 6.1 ElliottSimpleLens
2. 6.2 SMCLens
3. 6.3 プロンプト進化基盤
4. 6.4 DSL 統合
5. 6.5 UI 統合

6.1 と 6.2 は独立しているので順序入れ替え可能だが、 6.3 以降は両方のレンズが動いている前提。

### 3.2 品質より慎重さを優先

このフェーズは複雑度が高い。「とりあえず動く」ではなく「本当に正しく動いているか」を確認しながら進む。エリオット・SMC は誤判定が多発すると、システム全体の信頼性を損なう。

### 3.3 各サブフェーズごとの運用期間

各サブフェーズ完了後、**次のサブフェーズに進む前に最低2週間の運用観察期間** を入れる。この期間に:
- 新レンズの出力が妥当か
- 既存機能への影響がないか
- コストが想定内か
を確認する。

### 3.4 縮退可能にする

新レンズ・新機能は全て「無効化スイッチ」を持つこと。問題が出たら即座に OFF にできる設計。

---

## 4. 最終状態の確認

全サブフェーズ完了時、システムは以下を実現している:

- 並列6-8レンズが常時計算されている
- 7つの専門エージェントが役割分化して動いている
- エッジ台帳が常時更新・検証されている
- 戦略集団が自動進化している
- プロンプト自体も進化している
- ユーザーは複数の "視点" でシステムを扱える
- 全ての挙動が検証可能・説明可能

これが「自律型トレーディングAI」の完成形。

---

## 5. 完了後の展望(このプロジェクトの範囲外)

フェーズ6完了後に検討に値する拡張:
- 実トレード統合(本番資金での運用)
- 複数ブローカーAPI対応
- マルチシンボル・ポートフォリオ最適化
- 他のトレーダーとのエッジ共有(コミュニティ機能)
- エージェントの強化学習による追加改善

これらは全て現在のアーキテクチャの上に乗せられる。**設計の拡張性が、最終的な投資の価値** になる。

---

*このフェーズが完了する頃には、設計開始から1年以上経過している可能性がある。継続することが最も重要。*
