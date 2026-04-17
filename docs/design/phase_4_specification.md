# フェーズ4 発注仕様書: エージェント役割の完全分化

> **期間目安**: 2〜3週間
> **目的**: Hypothesis Generator, Edge Validator, Discovery AI を独立エージェント化し、エッジ台帳の骨格を作る
> **前提**: フェーズ1-3 完了(レンズ基盤 + レンズ3種 + AIロール分化)
> **前提読み物**: `docs/design/DESIGN_DOC_autonomous_trading_architecture.md` の全体

---

## 1. このフェーズのゴール

フェーズ2 で Strategy Thinker 内部に組み込まれていた「仮説生成」を独立エージェント `HypothesisGeneratorAgent` に分離する。同時に、エッジを検証する `EdgeValidatorAgent` と、週次で効いているレンズを調査する `DiscoveryAgent` を新設する。

最重要成果物は **エッジ台帳 (EdgeLedger) の実装**。これまで `AgentMemory.lessons` に混在していた学びから、**検証可能な仮説の台帳** を切り出す。

---

## 2. 完了条件

以下の全てを満たす:

- [ ] `EdgeHypothesis` 型とそのスキーマが定義されている
- [ ] `EdgeLedger` クラスが実装され、仮説の CRUD とステータス管理ができる
- [ ] `HypothesisGeneratorAgent` が実装され、独立した仮説生成ができる
- [ ] `EdgeValidatorAgent` が実装され、strategyBacktestService を使って仮説を検証できる
- [ ] `DiscoveryAgent` が実装され、週次でレンズ有効性レポートを出力できる
- [ ] `ReflectionAIService` が EdgeLedger に書き込むよう改修されている
- [ ] PDCA ループに新エージェント群が統合されている
- [ ] スケジューラーに DiscoveryAgent の週次実行が登録されている
- [ ] 既存テストが全て通る
- [ ] 新エージェント各々にユニットテストがある

---

## 3. 触っていいファイル / 触ってはいけないファイル

### 触っていい(新規作成)
- `src/side-b/models/edgeHypothesis.ts`
- `src/side-b/ledger/EdgeLedger.ts`
- `src/side-b/ledger/types.ts`
- `src/side-b/agents/HypothesisGeneratorAgent.ts`
- `src/side-b/agents/EdgeValidatorAgent.ts`
- `src/side-b/agents/DiscoveryAgent.ts`
- `src/side-b/prompts/hypothesis_generator.md`
- `src/side-b/prompts/edge_validator.md`
- `src/side-b/prompts/discovery.md`
- `src/side-b/tests/ledger/edgeLedger.test.ts`
- `src/side-b/tests/agents/*.test.ts`

### 触っていい(改修)
- `src/side-b/prompts/strategy_thinker.md` ― 仮説生成部分を削除、「台帳からの仮説受け取り」に変更
- `src/side-b/services/planAIService.ts` ― EdgeLedger からの仮説取得ロジック追加
- `src/side-b/services/reflectionAIService.ts` ― EdgeLedger への書き込み追加
- `src/side-b/agent/pdcaLoop.ts` ― 新エージェント群の統合
- `src/side-b/jobs/sideBScheduler.ts` ― 週次 Discovery 実行の追加
- `src/side-b/models/aiTradeNote.ts` ― `relatedHypothesisIds` フィールド追加(オプショナル)

### 触ってはいけない
- `src/side-b/lenses/` (フェーズ1-3の成果物)
- `src/side-b/agents/DevilsAdvocateAgent.ts` (フェーズ2の成果物、変更禁止)
- 既存 `AgentMemory` のコア機能(lessons 機構は残すが、新仮説は EdgeLedger に書く)
- UI 関連

---

## 4. 実装仕様

### 4.1 EdgeHypothesis 型

`src/side-b/models/edgeHypothesis.ts`

```typescript
export type EdgeCategory = 
  | 'time' 
  | 'level' 
  | 'event' 
  | 'correlation' 
  | 'positioning' 
  | 'volatility' 
  | 'structure' 
  | 'other';

export type EdgeStatus = 
  | 'unverified'   // 新規、未検証
  | 'testing'      // バックテスト中
  | 'confirmed'    // 昇格済み
  | 'stale'        // 劣化中
  | 'rejected';    // 棄却

export type EdgeSource = 
  | 'ai_generated' 
  | 'reflection' 
  | 'user_input' 
  | 'backtest' 
  | 'discovery';

/** 機械判定可能な条件 */
export interface MachineReadableCondition {
  lensName: string;       // どのレンズの
  featureKey: string;     // どの特徴量が
  op: '<' | '<=' | '>' | '>=' | '==' | '!=' | 'between' | 'in';
  value: number | string | boolean | [number, number] | string[];
}

export interface BacktestSummary {
  pf: number;
  winRate: number;
  tradeCount: number;
  runAt: Date;
  runId?: string;
}

export interface WalkForwardSummary {
  overfitScore: number;
  avgInSampleWinRate: number;
  avgOutOfSampleWinRate: number;
  runAt: Date;
  runId?: string;
}

export interface EdgeHypothesis {
  id: string;
  
  // 記述
  statement: string;
  category: EdgeCategory;
  conditions: MachineReadableCondition[];
  expectedDirection: 'long' | 'short' | 'either';
  
  // ライフサイクル
  status: EdgeStatus;
  statusUpdatedAt: Date;
  
  // 対象
  symbols: string[];  // 適用対象シンボル
  timeframes: string[];  // 適用対象時間足
  
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
  source: EdgeSource;
  lensRelevance?: Record<string, number>;  // レンズごとの重要度推定(0-1)
  
  // タイムスタンプ
  firstObservedAt: Date;
  lastObservedAt: Date;
  lastTestedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  
  // 関連
  parentIds?: string[];  // この仮説が派生した親仮説
  relatedNoteIds?: string[];  // 関連する AITradeNote
}
```

### 4.2 EdgeLedger

`src/side-b/ledger/EdgeLedger.ts`

仮説の永続化・検索・ステータス管理を担うクラス。

基本機能:
```typescript
export class EdgeLedger {
  // CRUD
  async create(hypothesis: Omit<EdgeHypothesis, 'id' | 'createdAt' | 'updatedAt'>): Promise<EdgeHypothesis>;
  async get(id: string): Promise<EdgeHypothesis | null>;
  async update(id: string, patch: Partial<EdgeHypothesis>): Promise<EdgeHypothesis>;
  async delete(id: string): Promise<void>;
  
  // 検索
  async findByStatus(status: EdgeStatus): Promise<EdgeHypothesis[]>;
  async findBySymbol(symbol: string): Promise<EdgeHypothesis[]>;
  async findByCategory(category: EdgeCategory): Promise<EdgeHypothesis[]>;
  async findActive(symbol: string): Promise<EdgeHypothesis[]>;  // confirmed のみ
  async findMatching(symbol: string, snapshot: LensFeatureSnapshot): Promise<EdgeHypothesis[]>;
  
  // ステータス遷移
  async markTesting(id: string): Promise<void>;
  async markConfirmed(id: string, backtest: BacktestSummary, walkForward: WalkForwardSummary): Promise<void>;
  async markStale(id: string, reason: string): Promise<void>;
  async markRejected(id: string, reason: string): Promise<void>;
  
  // 観測更新
  async recordObservation(id: string, outcome: 'win' | 'loss' | 'breakeven', pnlPips: number, rr: number, noteId: string): Promise<void>;
  
  // 統計
  async getStats(): Promise<EdgeLedgerStats>;
}
```

**永続化**: 既存の Prisma ベースの DB を使う前提。マイグレーションを追加して `EdgeHypothesis` テーブルを作る。マイグレーション仕様も含める。

**条件マッチング** `findMatching`:
- 渡された `LensFeatureSnapshot` に対して、各仮説の `conditions` が全て満たされるかを機械的に評価
- 全条件 `true` の仮説を返す

### 4.3 昇格・降格ロジック

`src/side-b/ledger/statusManager.ts`

```typescript
export class StatusManager {
  /** 昇格条件のチェック */
  canPromoteToConfirmed(hyp: EdgeHypothesis): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    
    if (!hyp.backtestResults) {
      reasons.push('バックテスト未実施');
    } else {
      if (hyp.backtestResults.pf < 1.5) reasons.push(`学習期間PF不足: ${hyp.backtestResults.pf}`);
      // 検証期間スコアは別途保持する設計にするか、backtestResults に統合する
    }
    
    if (!hyp.walkForwardResults) {
      reasons.push('ウォークフォワード未実施');
    } else {
      if (hyp.walkForwardResults.overfitScore > 0.3) reasons.push(`過学習スコア超過: ${hyp.walkForwardResults.overfitScore}`);
    }
    
    return { ok: reasons.length === 0, reasons };
  }
  
  /** 降格判定(stale) */
  shouldMarkStale(hyp: EdgeHypothesis, recentObservations: number = 10): { yes: boolean; reason?: string } {
    // 直近の観測で勝率が大きく下がっている場合
    if (hyp.observationCount < recentObservations) return { yes: false };
    
    const recentWinRate = /* 直近N回の勝率を計算 */;
    const expectedWinRate = hyp.backtestResults?.winRate ?? 0.5;
    
    if (recentWinRate < expectedWinRate - 0.2) {
      return { yes: true, reason: `直近の勝率乖離: 期待${expectedWinRate} vs 実績${recentWinRate}` };
    }
    
    return { yes: false };
  }
}
```

### 4.4 HypothesisGeneratorAgent

`src/side-b/agents/HypothesisGeneratorAgent.ts` + `src/side-b/prompts/hypothesis_generator.md`

**入力**: LensFeatureSnapshot + 既存の EdgeLedger 内容(類似仮説の重複を避けるため)

**出力**: 新規仮説候補(複数)

プロンプトの要点:
- 既知の仮説リストを参考として渡し、「これらと異なる新規仮説を」生成させる
- 禁止事項: 文献でよく見る組み合わせ、有名戦略名の使用
- 探索ステップ:
  1. レンズ出力を物理量カテゴリで分類
  2. 異なるカテゴリから2つ選び、比率・差分・条件付きで組み合わせ
  3. 最も他の参加者が見ていなさそうな3つを選ぶ
  4. それぞれを仮説文として記述

### 4.5 EdgeValidatorAgent

`src/side-b/agents/EdgeValidatorAgent.ts` + `src/side-b/prompts/edge_validator.md`

**入力**: EdgeHypothesis(unverified / testing)

**処理**:
1. 仮説を戦略化(JSON DSL はフェーズ5以降、ここでは既存のバックテスト入力形式)
2. `strategyBacktestService.runBacktest()` を呼び、学習期間+検証期間で実行
3. 過学習が疑わしい場合は `walkForwardService.runWalkForwardTest()` も実行
4. 結果を解釈し、EdgeLedger にバックテスト結果を記録
5. 昇格条件を満たすかを `StatusManager` で判定
6. 満たせば `markConfirmed`、満たさなければ `markRejected`

**LLM の役割**: 
- 仮説を具体的なバックテスト可能なパラメーターに落とし込む
- バックテスト結果を解釈し、なぜ成功/失敗したかを言語化する
- 改善案が考えられる場合は、新仮説として EdgeLedger に追加する

### 4.6 DiscoveryAgent

`src/side-b/agents/DiscoveryAgent.ts` + `src/side-b/prompts/discovery.md`

**実行頻度**: 週次(スケジューラー起動)

**入力**: 
- 過去1週間(または1ヶ月)の AITradeNote 全件
- 各 note の lensSnapshot
- 結果(win/loss)

**処理**:
1. 過去データを集計:
   - レンズ別・特徴量別に、勝ちトレード時の値分布と負けトレード時の値分布を比較
   - 統計的に有意な分離があった特徴量を抽出
2. LLM に渡して解釈:
   - 「これらの特徴量が勝敗を分けているように見える。市場構造として何を意味するか?」
3. 新規仮説を EdgeLedger に記録(status: `unverified`)

**出力**: WeeklyDiscoveryReport

```typescript
export interface WeeklyDiscoveryReport {
  periodStart: Date;
  periodEnd: Date;
  analyzedTradeCount: number;
  
  lensInsights: Array<{
    lensName: string;
    effectiveFeatures: Array<{
      featureKey: string;
      separationScore: number;  // KS distance や Mutual Information
      interpretation: string;
    }>;
  }>;
  
  newHypotheses: EdgeHypothesis[];  // 新規登録された仮説
  promotionCandidates: string[];  // testing → confirmed を推薦される仮説ID
  staleCandidates: string[];  // confirmed → stale を推薦される仮説ID
}
```

### 4.7 ReflectionAIService の改修

既存の振り返りロジックに加えて:
- 「このトレードは既存仮説 X の観測事例として記録すべきか」を判定
- 該当する場合、`EdgeLedger.recordObservation()` を呼ぶ
- 「この振り返りから新規仮説が生まれたか」を判定
- 該当する場合、新規 `EdgeHypothesis` を `unverified` で作成

### 4.8 Strategy Thinker のリファクタ

仮説生成責務を HypothesisGeneratorAgent に移譲したため、Strategy Thinker は:
- 入力に「候補仮説リスト(EdgeLedger の confirmed + HypothesisGenerator の新規)」を受け取る
- その中から現状況に最適な仮説を選択
- 選択した仮説を戦略(エントリー条件、SL、TP)に落とし込む
- 選択理由、不採用理由を明示

プロンプトから「仮説を生成する」という責務記述を削除し、「仮説を選択・戦略化する」に変更。

### 4.9 PDCA ループの統合

実行順序(簡略):

```
1. 市場データ取得
2. LensAggregator で全レンズ計算
3. EdgeLedger から現状況マッチの confirmed 仮説を取得
4. HypothesisGeneratorAgent で新規候補生成(既存仮説と重複しないもの)
5. Strategy Thinker で候補仮説から戦略化
6. Devil's Advocate で戦略レビュー
7. 仮想トレード実行 or ノートレード
8. (トレード完了後) ReflectionAI で振り返り → EdgeLedger 更新
9. (週次) DiscoveryAgent でレンズ分析 → 新仮説登録
10. (該当時) EdgeValidatorAgent で unverified 仮説の検証実行
```

### 4.10 スケジューラー拡張

`sideBScheduler.ts` に以下を追加:
- 週次 DiscoveryAgent 実行(土曜日 UTC 22:00 など)
- 日次 EdgeValidator 実行(unverified 仮説のバックテストキュー処理)
- ステータス劣化チェック(日次)

---

## 5. 設計上の注意

### 5.1 このフェーズでやらないこと

- 戦略 JSON DSL の実装(フェーズ5)
- 進化的探索ループ(フェーズ5)
- エリオット波動・SMC レンズ(フェーズ6)
- プロンプト自体の進化(フェーズ6)
- EdgeLedger の UI 表示(別途)

### 5.2 EdgeLedger の永続化の重さ

EdgeLedger は長期的にデータ量が増える。初期実装は DB 保存で OK だが、検索性能のため将来インデックス最適化が必要になる可能性がある。このフェーズでは基本的なインデックス(status, symbol, category)だけ張っておく。

### 5.3 LLM コストの見積もり

新エージェントが増えるため LLM 呼び出し数が増加する:
- HypothesisGenerator: トレードごと(PDCA 1サイクル)
- EdgeValidator: 日次バッチ + 新仮説発生時
- DiscoveryAgent: 週次
- 既存(MarketAnalyst, StrategyThinker, DevilsAdvocate, Reflection)もあり

コスト制御として:
- HypothesisGenerator は最小限にする(既存仮説マッチがあれば呼ばない)
- DiscoveryAgent の分析対象期間を絞る(最大1000トレード)
- 各エージェントに max_tokens 上限を設定

### 5.4 エッジ台帳の "肥大化対策"

鑑賞価値のない仮説で台帳が埋まらないよう:
- `rejected` ステータスの仮説は30日後に自動削除(設定可能)
- 同一シンボル・同一カテゴリで類似度が高い `unverified` 仮説は自動統合

### 5.5 既存 AgentMemory との関係

既存の `AgentMemory.lessons` は **残す**。EdgeLedger は **検証済み仮説の台帳**、`lessons` は **短期的な学びのメモ**、という使い分け。Reflection AI は両方に書く可能性がある。

---

## 6. 完了報告時に含めること

1. 作成/変更したファイルの一覧
2. DB マイグレーション差分
3. 各エージェントの実行サンプル出力
4. EdgeLedger の CRUD テスト結果
5. 既存テスト全通過の確認
6. LLM コスト見積もり(1日あたりの呼び出し数)
7. エンドツーエンドの1サイクル実行ログ(レンズ → 仮説生成 → 戦略 → Devil's Advocate → トレード → Reflection → EdgeLedger 更新)
8. 次フェーズへの引き継ぎメモ

---

## 7. レビュー観点

- EdgeLedger が正しく仮説を記録・更新しているか
- 昇格条件が設計通り(PF基準、過学習スコア)守られているか
- HypothesisGenerator が「既知仮説と異なる新規」を出せているか
- DiscoveryAgent の週次実行が機能するか
- PDCA 1サイクル全体のレイテンシが許容範囲か(目安: 30秒以内)
