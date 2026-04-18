# フェーズ4b 発注仕様書: Side-A 検証基盤へのブリッジ層実装

> **期間目安**: 2〜3週間
> **目的**: Side-B の仮説(EdgeHypothesis)を、Side-A の既存検証基盤(BT/WF/MC)で評価できるようにするブリッジ層を実装する
> **前提**: フェーズ1-3 完了(レンズ基盤)、フェーズ4a 完了(仮説プール、EdgeLedger、HypothesisGenerator、Discovery、StatusManager)
> **前提読み物**: 
> - `docs/design/DESIGN_DOC_autonomous_trading_architecture.md`
> - `docs/design/phase_4_specification.md`(4a の実装内容)
> - この仕様書は 4a の引き継ぎメモで提示された「設計ギャップ」への回答である

---

## 0. このフェーズの位置づけと背景

### 0.1 発見された構造的ギャップ

フェーズ4a 完了後の棚卸しにより、以下のギャップが判明した:

- Side-A には既に完成した検証パイプライン(BT/WF/MC)が存在する
- ただし対象は **TradeNote** または **Strategy** エンティティに限定される
- Side-B の **AITradeNote** / **EdgeHypothesis** を直接受け付ける経路が存在しない
- 唯一の接点は類似検索層(crossSimilarityService)のみ

### 0.2 採用した方針

3つの選択肢から **選択肢A(Side-A 基盤を活かす materialization 層)** を採用した。

**理由**:
1. 動いている Side-A 基盤(BT/WF/MC)を作り直さずに済む
2. 人間(Side-A)と AI(Side-B)を「独立した協業パートナー」として位置づけ、両者が同じ検証基盤を共有する構図になる
3. Side-B の Note と Side-A の TradeNote を無理に統合せず、ブリッジで繋ぐことで既存機能を壊さない
4. 段階的な発展が可能(将来の完全統合も選択肢として残せる)

### 0.3 Side-A / Side-B の関係性(公式定義)

**独立した協業パートナー関係**:
- Side-A は人間のトレーダー向けの検証・分析基盤
- Side-B は AI エージェントによる自律分析・仮想トレード基盤
- 両者は独立性を保ちつつ、特定のブリッジ層で情報を共有する
- どちらかがどちらかに従属することはない

この関係性は今後の設計判断の前提となる。このフェーズ以降も維持される。

---

## 1. このフェーズのゴール

Side-B の EdgeHypothesis が、Side-A の検証パイプラインを通して評価され、検証結果に基づいて昇格・棄却されるフローを完成させる。

完了時点で以下が実現される:

- EdgeHypothesis を検証実行時に TradeNote として materialize できる
- Materialize された TradeNote で、既存の Side-A backtest/walkForward が実行できる
- 検証結果(PF、勝率、過学習スコア)が EdgeHypothesis の判定に使われる
- 昇格条件(PF>1.5, 検証期間PF>1.3, 過学習スコア<0.3)を満たした仮説が自動的に confirmed に昇格する

**このフェーズで意図的にやらないこと**: 
- バイアンドホールド比較(Phase 4c で実装)
- モンテカルロによる昇格判定の厳格化(基盤連携のみ、判定条件化は Phase 4c 以降)
- 実発注ゲート(Phase 7以降)

---

## 2. 完了条件

以下の全てを満たす:

- [ ] `MaterializationService` が実装され、EdgeHypothesis から TradeNote を生成できる
- [ ] ~~`HypothesisBacktestOrchestrator` が実装され、仮説を受けて materialize → Side-A BT 実行 → 結果を EdgeHypothesis に反映できる~~ ← **Q3 採用により廃止**: WF が IS/OOS で内部的に BT を実行するため、`HypothesisWalkForwardOrchestrator` に統合
- [ ] `HypothesisWalkForwardOrchestrator` が実装され、ウォークフォワードを実行・PF と過学習スコアの両方を EdgeHypothesis に反映できる
- [ ] `EdgeValidatorAgent`(未実装だった 4a の残タスク)が上記 Orchestrator を使って仮説を評価する
- [ ] EdgeHypothesis に `materializedTradeNoteIds` フィールドが追加されている(オプショナル)
- [ ] AITradeNote に `tradeNoteId` フィールドが追加されている(オプショナル)
- [ ] `aiNoteService.generateNoteFromTrade` が AITradeNote と同時に TradeNote を生成する(片方向 bridge 強化)
- [ ] 昇格判定が Side-A 検証結果に基づいて動作する
- [ ] スケジューラーに仮説検証ジョブ(unverified 仮説のキュー処理)が登録されている
- [ ] 既存テストが全て通る
- [ ] 新規ロジックにユニットテストがある

---

## 3. 触っていいファイル / 触ってはいけないファイル

### 触っていい(新規作成)
- `src/side-b/bridge/MaterializationService.ts`
- `src/side-b/bridge/HypothesisBacktestOrchestrator.ts`
- `src/side-b/bridge/HypothesisWalkForwardOrchestrator.ts`
- `src/side-b/bridge/types.ts`
- `src/side-b/agents/EdgeValidatorAgent.ts`(4a で未実装のまま持ち越し)
- `src/side-b/prompts/edge_validator.md`
- `src/side-b/tests/bridge/*.test.ts`
- `src/side-b/tests/agents/edgeValidator.test.ts`
- `prisma/migrations/[timestamp]_add_note_bridge_fields/migration.sql`

### 触っていい(改修)
- `src/side-b/models/edgeHypothesis.ts` ― `materializedTradeNoteIds`, `defaultRiskManagement` フィールド追加
- `src/side-b/models/aiTradeNote.ts` ― `tradeNoteId` フィールド追加
- `src/side-b/services/aiNoteService.ts` ― TradeNote 同時生成ロジック追加
- `src/side-b/ledger/EdgeLedger.ts` ― materialize 情報の記録メソッド追加
- `src/side-b/ledger/StatusManager.ts` ― 検証結果に基づく昇格判定ロジック接続
- `src/side-b/jobs/sideBScheduler.ts` ― 仮説検証ジョブ追加
- `src/side-b/agent/pdcaLoop.ts` ― Validator 呼び出しの統合
- `src/side-b/prompts/hypothesis_generator.md` ― `defaultRiskManagement` を生成させるよう更新
- `prisma/schema.prisma` ― 新フィールドの定義

### 触ってはいけない
- `src/side-b/lenses/`(フェーズ1-3成果物)
- `src/side-b/agents/DevilsAdvocateAgent.ts`(フェーズ2成果物)
- `src/side-b/agents/HypothesisGeneratorAgent.ts`(本文は変更せずプロンプトのみ変更)
- Side-A 側のコード(`src/services/backtestService.ts`, `src/backend/services/strategyBacktestService.ts`, `src/backend/services/walkForwardService.ts` 等)
  - これらは外部インターフェース経由で呼び出すのみ
  - Side-A のロジック変更は **絶対に行わない**
- 既存の Prisma 定義(TradeNote, BacktestRun, WalkForwardRun 等)
- UI 関連のコード

---

## 4. 実装仕様

### 4.1 EdgeHypothesis への追加フィールド

`src/side-b/models/edgeHypothesis.ts`

```typescript
export interface EdgeHypothesis {
  // ... 既存フィールド ...
  
  /**
   * デフォルトのリスク管理設定
   * HypothesisGenerator が仮説生成時に決定する
   */
  defaultRiskManagement?: {
    stopLoss: 
      | { type: 'atr_multiple'; value: number }
      | { type: 'fixed_pips'; value: number }
      | { type: 'swing_point'; lookbackBars: number };
    takeProfit:
      | { type: 'rr_ratio'; value: number }
      | { type: 'fixed_pips'; value: number }
      | { type: 'atr_multiple'; value: number };
    maxHoldingBars?: number;
  };
  
  /**
   * この仮説から materialize された TradeNote の ID 群
   * 検証実行時に生成され、既存 Side-A 検証基盤で使われる
   */
  materializedTradeNoteIds?: string[];
  
  /** 無効化条件(既に存在する場合は維持) */
  invalidationConditions?: MachineReadableCondition[];
}
```

**マイグレーション**: フィールド全てオプショナル。既存データは影響を受けない。

### 4.2 AITradeNote への追加フィールド

`src/side-b/models/aiTradeNote.ts`

```typescript
export interface AITradeNote {
  // ... 既存フィールド ...
  
  /**
   * 対応する Side-A TradeNote の ID
   * aiNoteService.generateNoteFromTrade 内で同時生成された TradeNote との紐付け
   */
  tradeNoteId?: string;
}
```

**マイグレーション**: オプショナル追加のみ。

### 4.3 MaterializationService

`src/side-b/bridge/MaterializationService.ts`

EdgeHypothesis を Side-A の TradeNote 形式に変換する責務。

```typescript
export class MaterializationService {
  constructor(
    private lensAggregator: LensAggregator,
    // 必要なら他の既存サービス
  ) {}
  
  /**
   * 仮説から TradeNote を生成する(検証実行時の遅延生成)
   * 
   * @param hypothesis 検証対象の仮説
   * @param period 検証対象期間
   * @returns 生成された TradeNote の ID
   */
  async materializeForValidation(
    hypothesis: EdgeHypothesis,
    period: { start: string; end: string }
  ): Promise<string> {
    // 1. 仮説の条件(MachineReadableCondition[])を、TradeNote で
    //    バックテスト可能な形式(インジケーター条件等)に変換
    // 2. defaultRiskManagement から SL/TP 設定を構築
    // 3. 対象シンボル・時間足を仮説から取得
    // 4. 既存の TradeNote Prisma モデルに合わせたデータを作成
    // 5. DB に保存し、生成された ID を返す
  }
  
  /**
   * 仮想トレード完了時に、AITradeNote と同時に TradeNote を生成する
   * 
   * @param virtualTrade 完了した仮想トレード情報
   * @param aiNote 生成される AITradeNote
   * @returns 生成された TradeNote の ID
   */
  async materializeFromVirtualTrade(
    virtualTrade: VirtualTrade,
    aiNote: AITradeNote
  ): Promise<string> {
    // 仮想トレード結果を TradeNote 形式で保存
    // 既存の TradeNote スキーマに合わせてマッピング
  }
}
```

**重要な設計判断**:
- **条件変換ロジック**: MachineReadableCondition[] から TradeNote の検索条件への変換は、完全自動化を目指さず「このレンズ特徴量はこのインジケーターに近い」というマッピングテーブルを持つ
- **不可能な変換の扱い**: 全ての仮説が Side-A で検証可能とは限らない。変換不可能な場合は `MaterializationError` を投げ、EdgeValidator がその仮説を「検証不能」として記録する
- **レンズ特徴量のうち Side-A 対応が難しいもの**: 時間帯レンズなど → 可能な範囲でマッピング、残りは将来の Phase 4c/5 で仮説レベル backtester を別途検討

### 4.4 HypothesisBacktestOrchestrator ← **Q3 採用により廃止**

> **設計変更（Phase 4b 着手時）**:
> ユーザー回答 Q3 により、BT 50/25/25 分割は廃止し、`HypothesisWalkForwardOrchestrator` が WF を介して PF と過学習スコアの両方を取得する方針に統一しました。
>
> 理由: `walkForwardService` 内部で `runBacktest` が IS/OOS の各分割で複数回呼ばれ、結果に PF が含まれます (`SplitResult.inSample.profitFactor` / `outOfSample.profitFactor`)。これらの平均を取れば 50/25/25 分割相当の学習PF・検証PFが得られるため、別途 BT を独立実行する必要はありません。
>
> 以下の擬似コード（旧設計）は traceability のため残しますが、Phase 4b では実装しません。

仮説のバックテスト全体を統括する（旧設計）。

```typescript
export class HypothesisBacktestOrchestrator {
  constructor(
    private materialization: MaterializationService,
    private edgeLedger: EdgeLedger,
    // Side-A backtestService への参照(import)
  ) {}
  
  /**
   * 仮説に対する学習期間・検証期間の分割バックテストを実行
   */
  async runSplitBacktest(
    hypothesisId: string,
    fullPeriod: { start: string; end: string }
  ): Promise<HypothesisBacktestResult> {
    const hypothesis = await this.edgeLedger.get(hypothesisId);
    if (!hypothesis) throw new Error('Hypothesis not found');
    
    // 1. 期間を 50/25/25 に分割
    //    [学習期間 50%] [検証期間 25%] [本番相当期間 25%(このフェーズでは使用しない)]
    const { learning, validation } = this.splitPeriod(fullPeriod);
    
    // 2. 仮説を TradeNote として materialize(学習期間用)
    const learningNoteId = await this.materialization.materializeForValidation(
      hypothesis, learning
    );
    
    // 3. Side-A の backtestService で学習期間の BT 実行
    const learningResult = await backtestService.execute({ 
      noteId: learningNoteId, 
      period: learning 
    });
    
    // 4. 検証期間用に materialize & BT 実行
    const validationNoteId = await this.materialization.materializeForValidation(
      hypothesis, validation
    );
    const validationResult = await backtestService.execute({ 
      noteId: validationNoteId, 
      period: validation 
    });
    
    // 5. EdgeLedger に両結果を記録
    await this.edgeLedger.update(hypothesisId, {
      materializedTradeNoteIds: [learningNoteId, validationNoteId],
      backtestResults: {
        learning: { pf: learningResult.pf, winRate: learningResult.winRate, ... },
        validation: { pf: validationResult.pf, winRate: validationResult.winRate, ... },
        runAt: new Date(),
      },
    });
    
    return { learning: learningResult, validation: validationResult };
  }
  
  private splitPeriod(period: { start: string; end: string }) {
    // 時系列で 50/25/25 に分割
  }
}
```

### 4.5 HypothesisWalkForwardOrchestrator

`src/side-b/bridge/HypothesisWalkForwardOrchestrator.ts`

ウォークフォワード検証を統括する。**Q3 採用により、WF 実行結果から学習PF・検証PF・過学習スコアの3指標を全て EdgeHypothesis に反映する**（旧 BT 独立実行は不要）。

```typescript
export class HypothesisWalkForwardOrchestrator {
  constructor(
    private materialization: MaterializationService,
    private edgeLedger: EdgeLedger,
  ) {}
  
  async runWalkForward(
    hypothesisId: string,
    period: { start: string; end: string },
    splitCount: number = 4
  ): Promise<HypothesisWalkForwardResult> {
    const hypothesis = await this.edgeLedger.get(hypothesisId);
    if (!hypothesis) throw new Error('Hypothesis not found');
    
    // 1. 仮説を materialize
    const noteId = await this.materialization.materializeForValidation(hypothesis, period);
    
    // 2. 仮説に対応する Strategy エンティティが必要な場合、一時的に生成
    //    (既存 walkForwardService は strategyId を要求するため)
    const tempStrategyId = await this.createTemporaryStrategy(noteId);
    
    // 3. 既存 walkForwardService を呼び出し
    const result = await walkForwardService.runWalkForwardTest({
      strategyId: tempStrategyId,
      startDate: period.start,
      endDate: period.end,
      splitCount,
    });
    
    // 4. EdgeLedger に結果を記録
    await this.edgeLedger.update(hypothesisId, {
      walkForwardResults: {
        overfitScore: result.overfitScore,
        avgInSampleWinRate: result.summary.avgInSampleWinRate,
        avgOutOfSampleWinRate: result.summary.avgOutOfSampleWinRate,
        runAt: new Date(),
        runId: result.id,
      },
    });
    
    return result;
  }
  
  private async createTemporaryStrategy(noteId: string): Promise<string> {
    // Note から Strategy を一時生成する既存パスがあればそれを使う
    // なければこのフェーズで簡易実装(TradeNote 単体を Strategy として登録する最小ラッパー)
  }
}
```

**既存 walkForwardService への接続**:
既存の walkForwardService は `strategyId` を要求する。Note → Strategy の変換パスが既存に存在するかを確認し、以下どちらかを選択:
- 存在する → それを使う
- 存在しない → このフェーズで最小のラッパーを実装(TradeNote 単体を Strategy として扱う)

**注意**: この部分は実装時に既存コードの調査が必要。設計判断が出たら Claude Code は人間に確認すること。

### 4.6 EdgeValidatorAgent

`src/side-b/agents/EdgeValidatorAgent.ts` + `src/side-b/prompts/edge_validator.md`

仮説検証の高水準オーケストレーション。LLM は結果解釈のみ担当。

```typescript
export class EdgeValidatorAgent {
  constructor(
    private backtestOrch: HypothesisBacktestOrchestrator,
    private walkForwardOrch: HypothesisWalkForwardOrchestrator,
    private edgeLedger: EdgeLedger,
    private statusManager: StatusManager,
    // LLM クライアント
  ) {}
  
  async validate(hypothesisId: string): Promise<ValidationReport> {
    const hypothesis = await this.edgeLedger.get(hypothesisId);
    
    // 1. 検証期間を決定(直近1年が基本、データ不足なら保留)
    const period = this.determineValidationPeriod(hypothesis);
    if (!period) {
      await this.edgeLedger.update(hypothesisId, { 
        status: 'insufficient_data',  // 新ステータス
        statusUpdatedAt: new Date(),
      });
      return { verdict: 'insufficient_data' };
    }
    
    // 2. 状態を testing に遷移
    await this.edgeLedger.markTesting(hypothesisId);
    
    try {
      // 3. バックテスト実行
      const btResult = await this.backtestOrch.runSplitBacktest(hypothesisId, period);
      
      // 4. ウォークフォワード実行
      const wfResult = await this.walkForwardOrch.runWalkForward(hypothesisId, period);
      
      // 5. 昇格判定(StatusManager に委譲)
      const updated = await this.edgeLedger.get(hypothesisId);
      const canPromote = this.statusManager.canPromoteToConfirmed(updated!);
      
      if (canPromote.ok) {
        // 6a. LLM による結果解釈(任意、記録用)
        const interpretation = await this.interpretResults(btResult, wfResult);
        
        await this.edgeLedger.markConfirmed(
          hypothesisId,
          updated!.backtestResults!,
          updated!.walkForwardResults!,
          interpretation
        );
        return { verdict: 'confirmed', interpretation };
      } else {
        // 6b. LLM による失敗要因分析
        const failureAnalysis = await this.analyzeFailure(btResult, wfResult, canPromote.reasons);
        
        await this.edgeLedger.markRejected(hypothesisId, canPromote.reasons.join('; '));
        return { verdict: 'rejected', reasons: canPromote.reasons, analysis: failureAnalysis };
      }
    } catch (error) {
      // Materialize 失敗等は 'not_testable' として記録
      await this.edgeLedger.update(hypothesisId, { 
        status: 'not_testable',
        statusUpdatedAt: new Date(),
      });
      return { verdict: 'not_testable', error: String(error) };
    }
  }
  
  private async interpretResults(bt: any, wf: any): Promise<string> {
    // LLM に「なぜ成功したか」を言語化させる(任意、Note に記録される)
  }
  
  private async analyzeFailure(bt: any, wf: any, reasons: string[]): Promise<string> {
    // LLM に「なぜ失敗したか」を言語化させる(仮説改善の提案を含む)
  }
}
```

### 4.7 StatusManager の更新

`src/side-b/ledger/StatusManager.ts`

**Q3 採用**: 昇格判定は WF 結果のみに依存させる。`WalkForwardSummary.avgInSamplePF >= 1.5` (学習) / `avgOutOfSamplePF >= 1.3` (検証) / `overfitScore < 0.3` (過学習) の3条件で判定する。BT 独立フィールドは参照しない。

```typescript
canPromoteToConfirmed(hyp: EdgeHypothesis): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  
  if (!hyp.backtestResults) {
    reasons.push('バックテスト未実施');
    return { ok: false, reasons };
  }
  
  const { learning, validation } = hyp.backtestResults;
  
  if (!learning || learning.pf < 1.5) {
    reasons.push(`学習期間PF不足: ${learning?.pf ?? 'N/A'}`);
  }
  
  if (!validation || validation.pf < 1.3) {
    reasons.push(`検証期間PF不足: ${validation?.pf ?? 'N/A'}`);
  }
  
  if (!hyp.walkForwardResults) {
    reasons.push('ウォークフォワード未実施');
  } else if (hyp.walkForwardResults.overfitScore > 0.3) {
    reasons.push(`過学習スコア超過: ${hyp.walkForwardResults.overfitScore}`);
  }
  
  // トレード数が少なすぎる場合も棄却
  const tradeCount = learning?.tradeCount ?? 0;
  if (tradeCount < 20) {
    reasons.push(`学習期間のトレード数不足: ${tradeCount} (必要20以上)`);
  }
  
  return { ok: reasons.length === 0, reasons };
}
```

### 4.8 aiNoteService の TradeNote 同時生成

`src/side-b/services/aiNoteService.ts`

既存の `generateNoteFromTrade` を改修。AITradeNote 生成と同時に、対応する TradeNote を Side-A に生成する。

```typescript
async generateNoteFromTrade(trade: VirtualTrade, plan: AITradePlan, lensSnapshot?: LensFeatureSnapshot): Promise<AITradeNote> {
  // 既存ロジック: AITradeNote 生成
  const aiNote = await this.createAITradeNote(trade, plan, lensSnapshot);
  
  // 新規: 同時に TradeNote も生成(bridge 強化)
  try {
    const tradeNoteId = await this.materializationService.materializeFromVirtualTrade(trade, aiNote);
    aiNote.tradeNoteId = tradeNoteId;
    await this.aiNoteRepository.update(aiNote.id, { tradeNoteId });
  } catch (error) {
    // TradeNote 生成失敗は AITradeNote 保存を妨げない(ログのみ)
    console.error('[aiNoteService] TradeNote 同時生成失敗:', error);
  }
  
  return aiNote;
}
```

**重要**: TradeNote 生成失敗で AITradeNote 生成が失敗しない設計にすること。ブリッジは best-effort で動く。

### 4.9 HypothesisGenerator プロンプト更新

`src/side-b/prompts/hypothesis_generator.md`

仮説生成時に `defaultRiskManagement` を含めるよう指示を追加:

```markdown
## 出力形式の追加要件(Phase 4b 対応)

各仮説に対して、デフォルトのリスク管理設定を含めてください:

\`\`\`json
{
  "statement": "...",
  "conditions": [...],
  "defaultRiskManagement": {
    "stopLoss": { "type": "atr_multiple", "value": 1.5 },
    "takeProfit": { "type": "rr_ratio", "value": 2.0 },
    "maxHoldingBars": 48
  }
}
\`\`\`

## defaultRiskManagement の選び方

- SL は仮説が捉えようとする "偏り" がなくなる水準に置く
- TP は仮説が期待する "偏り" が実現した水準に置く
- maxHoldingBars は偏りの持続期間を超えない範囲で

これらは検証時のデフォルトパラメーターとなる。
完璧である必要はない。検証結果が悪ければ rejected として適切に棄却される。
```

### 4.10 EdgeLedger の更新

`src/side-b/ledger/EdgeLedger.ts`

新ステータスの追加と、materialize 情報管理メソッド追加:

```typescript
// 新ステータス(EdgeStatus 型に追加)
export type EdgeStatus = 
  | 'unverified'
  | 'testing'
  | 'confirmed'
  | 'stale'
  | 'rejected'
  | 'insufficient_data'  // 新規: データ不足で検証保留
  | 'not_testable';      // 新規: Side-A で検証不能な仮説

// 新メソッド
async recordMaterialization(hypothesisId: string, tradeNoteId: string): Promise<void> {
  const hyp = await this.get(hypothesisId);
  const existing = hyp?.materializedTradeNoteIds ?? [];
  await this.update(hypothesisId, {
    materializedTradeNoteIds: [...existing, tradeNoteId],
  });
}

async markConfirmed(
  id: string,
  backtest: BacktestResultsSummary,
  walkForward: WalkForwardSummary,
  interpretation?: string
): Promise<void> {
  await this.update(id, {
    status: 'confirmed',
    statusUpdatedAt: new Date(),
    backtestResults: backtest,
    walkForwardResults: walkForward,
    confirmationNote: interpretation,
  });
}
```

### 4.11 スケジューラー統合

`src/side-b/jobs/sideBScheduler.ts`

日次で unverified 仮説の検証を実行する。

```typescript
// 新規追加
schedule('daily_edge_validation', '0 4 * * *', async () => {
  const unverified = await edgeLedger.findByStatus('unverified');
  
  // 1日あたりの検証上限(コスト管理)
  const MAX_PER_DAY = 10;
  const targets = unverified.slice(0, MAX_PER_DAY);
  
  for (const hyp of targets) {
    try {
      await edgeValidator.validate(hyp.id);
      await sleep(5000);  // Side-A 基盤への負荷配慮
    } catch (error) {
      console.error(`[scheduler] Validation failed for ${hyp.id}:`, error);
    }
  }
});
```

### 4.12 テスト

**必須テスト**:

`src/side-b/tests/bridge/materializationService.test.ts`
- EdgeHypothesis → TradeNote 変換が正しく動作するか
- 変換不能なケースで MaterializationError が投げられるか
- defaultRiskManagement が欠落している仮説の扱い

`src/side-b/tests/bridge/hypothesisBacktestOrchestrator.test.ts`
- 期間分割が 50/25/25 で正しく行われるか
- 学習・検証両方のバックテストが実行されるか
- 結果が EdgeLedger に正しく記録されるか
- モックされた backtestService への呼び出し検証

`src/side-b/tests/agents/edgeValidator.test.ts`
- 昇格条件を満たす仮説が confirmed になるか
- 条件を満たさない仮説が rejected になるか
- データ不足で insufficient_data になるか
- Materialize 失敗で not_testable になるか

`src/side-b/tests/services/aiNoteService.test.ts`(既存テスト拡張)
- TradeNote 同時生成が動作するか
- TradeNote 生成失敗でも AITradeNote 生成が継続するか

---

## 5. 設計上の注意

### 5.1 このフェーズでやらないこと

- **バイアンドホールド比較**: Phase 4c で実装。エッジ昇格判定の信頼性向上は Phase 4c 完了後
- **モンテカルロ連携**: 基盤は既に Side-A にあるが、仮説検証への組み込みは Phase 4c 以降
- **実発注ゲート**: Phase 7 以降
- **Side-A と Side-B の Note の完全統合**: 協業パートナー関係を維持する方針のため、恒久的に実施しない
- **仮説レベル backtester の新設**: 選択肢 B は採らなかった。もし Side-A で検証できない仮説カテゴリが多発した場合は Phase 5 以降で再検討

### 5.2 エラー処理の方針

ブリッジ層は **本質的に best-effort** で動く:

- Materialize 失敗 → 仮説は `not_testable` として記録、他の仮説の検証は継続
- Side-A の BT 失敗 → その仮説の検証は失敗として記録、スケジューラーは次の仮説へ
- AITradeNote ↔ TradeNote の同時生成の片方失敗 → もう片方の生成は継続

**一つの失敗が全体を止めない** 設計を徹底する。

### 5.3 既存 Side-A コードの扱い

Side-A の検証基盤コードは **一切変更しない**。以下は禁止:

- backtestService.execute() のシグネチャ変更
- walkForwardService の内部ロジック変更
- Side-A の Prisma モデル変更(TradeNote, BacktestRun 等)

ブリッジは **Side-A を外部 API として呼び出す** 形で実装する。

### 5.4 コスト配慮

仮説検証は Side-A BT/WF を複数回呼び出すため、計算コストが高い。配慮:

- 日次検証上限を設ける(上記では10件)
- 検証対象期間を適切に絞る(最大1年)
- 同一仮説の再検証は長めのクールダウンを置く(例: 30日)

### 5.5 LLM の役割の限定

EdgeValidatorAgent の LLM 呼び出しは **結果解釈のみ**。以下は LLM に判断させない:

- 昇格/棄却の判定(StatusManager の決定論的ロジック)
- PF や過学習スコアの計算(Side-A が計算)
- 検証期間の決定(ルールベースで決定)

LLM は「なぜ成功/失敗したか」の言語化のみ担当。

### 5.6 仮説の条件変換の限界

MachineReadableCondition は `lens.feature op value` という形式。Side-A の TradeNote は既存のインジケーター条件を使う。完全な1対1変換は不可能。

**このフェーズでの妥協**（Q1 採用: ハイブリッド方式）:
- **User パス優先 / Legacy フォールバック**: 仮説の条件群を `indicatorConfig` (UserIndicatorNoteEvaluator) で表現できる場合は優先採用、無理なら `featureVector` (LegacyNoteEvaluator) にフォールバック
- 変換可能なレンズ特徴量(current_analysis, dow_theory, volatility_regime)を優先対応
- 変換不能な特徴量(時間帯、SMC 等)を含む仮説は `not_testable` として扱う
- 将来 Phase 5 以降で、仮説レベル backtester を別途検討する余地を残す

### 5.7 「協業パートナー」原則の守り方

実装中、以下の誘惑に駆られることがあるが全て禁止:

- 「Side-B から Side-A の Note を直接編集したい」 → 禁止。Side-B は自分の領域だけを管理
- 「Side-A のバックテスト結果を Side-B 形式に書き換えたい」 → 禁止。解釈はするが変換しない
- 「Side-A と Side-B を統合したい」 → 禁止。独立性を維持

ブリッジ層は **両者を尊重する薄いアダプター**。分厚くなりすぎたら設計を見直す合図。

---

## 6. 完了報告時に含めること

1. 作成/変更したファイルの一覧
2. DB マイグレーション差分
3. 新エンドツーエンドフローの実行ログ:
   - 仮説生成 → 検証実行 → materialize → Side-A BT → Side-A WF → 昇格 or 棄却
4. 昇格に成功した仮説の例(もしあれば)
5. 昇格に失敗した仮説の例と理由
6. 既存テスト全通過の確認
7. 追加テストの実行結果
8. 未対応の仮説カテゴリの一覧(not_testable になった例)
9. 次フェーズ(Phase 4c: バイアンドホールド比較)への引き継ぎメモ

---

## 7. レビュー観点

- EdgeHypothesis が Side-A 検証基盤で評価されているか(実データで確認)
- 昇格判定が設計通りの3条件(学習PF>1.5, 検証PF>1.3, 過学習スコア<0.3)を守っているか
- 既存の Side-A 機能が一切変更されていないか(git diff で Side-A 領域を確認)
- `aiNoteService.generateNoteFromTrade` で TradeNote が同時生成されているか
- エラー処理が best-effort 原則に従っているか(一部失敗で全体が止まらないか)
- LLM が昇格判定に関与していないか(決定論的ロジックで判定されているか)
- 新ステータス(insufficient_data, not_testable)が適切に使われているか
- スケジューラーの日次検証ジョブが機能するか

---

## 8. Phase 4c への引き継ぎ要件

Phase 4c(バイアンドホールド比較)着手時に必要な情報を、このフェーズで記録する:

- Phase 4b で `confirmed` に至った仮説のリスト(Phase 4c で BH 比較を実施する対象)
- Side-A / Side-B の検証対象期間の標準(BH 比較の期間合わせに使う)
- materialize 時の対象シンボル・時間足の分布(BH 対象の選定材料)

これらを Phase 4b の完了報告に含めること。
