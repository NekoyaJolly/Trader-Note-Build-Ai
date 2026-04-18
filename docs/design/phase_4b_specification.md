# フェーズ4b 発注仕様書(縮小版): Note 統一基盤と事前スクリーニング

> **期間目安**: 1〜1.5週間
> **目的**: 仮説を TradeNote として materialize し、Side-A の BacktestService で事前スクリーニングする最小限のブリッジ層を実装する
> **前提**: フェーズ1-3 完了、フェーズ4a 完了
> **前提読み物**:
> - `docs/design/DESIGN_DOC_autonomous_trading_architecture.md`
> - `docs/design/phase_4c_specification.md`(後続フェーズで何を扱うか把握のため)
>
> **重要**: このファイルは Phase 4b 縮小版の仕様書。以前の `phase_4b_specification.md`(旧版)で記述された HypothesisBacktestOrchestrator, HypothesisWalkForwardOrchestrator, EdgeValidatorAgent 等は **Phase 4c に移行** される。このフェーズでは扱わない。

---

## 0. このフェーズの位置づけ

### 0.1 縮小の背景

当初の Phase 4b は「仮説の完全な検証パイプライン」を想定していたが、実装過程で以下の構造的問題が判明した:

- Side-A の walkForwardService が ConditionGroup を要求し、仮説のレンズベース条件と噛み合わない
- Side-A に無理に接続しようとすると、not_testable が多発するリスク

これを受け、**検証の本格実装を Phase 4c に移し、Phase 4b は最小限のブリッジ層のみ** に縮小した。

### 0.2 このフェーズで実現すること

- 仮説を TradeNote として materialize するサービス
- Side-A の BacktestService を使った **事前スクリーニング** のみ
- スクリーニング通過仮説を `screening_passed` ステータスに昇格
- AITradeNote と TradeNote の片方向リンク強化

### 0.3 このフェーズでしないこと

- 過学習検出(WalkForward)
- モンテカルロ分析
- バイアンドホールド比較
- LLM による結果解釈
- EdgeValidator の完成形実装
- confirmed への昇格(screening_passed 止まり)

これらは全て **Phase 4c** で実装する。

---

## 1. このフェーズのゴール

Phase 4a の成果物(EdgeHypothesis, EdgeLedger, HypothesisGenerator, Discovery)を活かしつつ、以下を実現する:

- 仮説を TradeNote として materialize できる
- Side-A の BacktestService で事前スクリーニングが実行できる
- スクリーニング通過仮説が `screening_passed` ステータスになる
- AITradeNote 生成時に TradeNote も同時生成される

これにより Phase 4c(本格検証)の前提条件が整う。

---

## 2. 完了条件

以下の全てを満たす:

- [ ] `MaterializationService` が実装され、EdgeHypothesis から TradeNote を生成できる
- [ ] `ScreeningOrchestrator` が実装され、materialize → Side-A BT 実行 → 結果を EdgeHypothesis に反映
- [ ] EdgeHypothesis に新ステータス `screening_passed` が追加されている
- [ ] EdgeHypothesis に `materializedTradeNoteIds`, `defaultRiskManagement`, `screeningResult` フィールドが追加されている(全てオプショナル)
- [ ] AITradeNote に `tradeNoteId` フィールドが追加されている(オプショナル)
- [ ] `aiNoteService.generateNoteFromTrade` が AITradeNote と TradeNote を同時生成する
- [ ] HypothesisGenerator プロンプトが `defaultRiskManagement` を出力するよう更新されている
- [ ] スケジューラーに日次スクリーニングジョブが追加されている
- [ ] 既存テスト全通過
- [ ] 新規ロジックにユニットテスト

---

## 3. 触っていいファイル / 触ってはいけないファイル

### 触っていい(新規作成)
- `src/side-b/bridge/MaterializationService.ts`
- `src/side-b/bridge/ScreeningOrchestrator.ts`
- `src/side-b/bridge/types.ts`
- `src/side-b/tests/bridge/*.test.ts`
- `prisma/migrations/[timestamp]_add_note_bridge_fields/migration.sql`

### 触っていい(改修)
- `src/side-b/models/edgeHypothesis.ts` ― 新フィールド追加(オプショナル)
- `src/side-b/models/aiTradeNote.ts` ― `tradeNoteId` 追加(オプショナル)
- `src/side-b/services/aiNoteService.ts` ― TradeNote 同時生成
- `src/side-b/ledger/EdgeLedger.ts` ― スクリーニング結果記録メソッド
- `src/side-b/ledger/StatusManager.ts` ― `screening_passed` 判定のみ追加(confirmed 判定は Phase 4c)
- `src/side-b/jobs/sideBScheduler.ts` ― 日次スクリーニングジョブ
- `src/side-b/prompts/hypothesis_generator.md` ― `defaultRiskManagement` 出力指示
- `prisma/schema.prisma` ― 新フィールド定義

### 触ってはいけない
- `src/side-b/lenses/`(Phase 1-3 成果物)
- `src/side-b/agents/` の既存全エージェント
- **Side-A コード全般**(`src/services/`, `src/backend/`)― 外部 API 呼び出しのみ
- 既存 Prisma 定義(TradeNote, BacktestRun 等)
- **旧版 `phase_4b_specification.md` に記載されていた `HypothesisBacktestOrchestrator`, `HypothesisWalkForwardOrchestrator`, `EdgeValidatorAgent` は実装しない**(Phase 4c 移行)
- フロントエンド関連(Phase 4d)

---

## 4. 実装仕様

### 4.1 EdgeHypothesis への追加フィールド

`src/side-b/models/edgeHypothesis.ts`

```typescript
// ステータスに screening_passed 追加
export type EdgeStatus = 
  | 'unverified'
  | 'screening_passed'  // 新規: Phase 4b で追加、事前スクリーニング通過
  | 'testing'
  | 'confirmed'         // Phase 4c で実装
  | 'rejected'
  | 'stale'
  | 'insufficient_data'
  | 'not_testable';

export interface EdgeHypothesis {
  // ... 既存フィールド ...
  
  /**
   * デフォルトのリスク管理設定
   * HypothesisGenerator が生成時に決定(オプショナル、欠落時はデフォルト値補完)
   */
  defaultRiskManagement?: {
    stopLoss: 
      | { type: 'atr_multiple'; value: number }
      | { type: 'rr_ratio'; value: number };  // Phase 4b では ATR と RR のみ対応
    takeProfit:
      | { type: 'rr_ratio'; value: number }
      | { type: 'atr_multiple'; value: number };
    maxHoldingBars?: number;
  };
  
  /**
   * materialize された TradeNote の ID 群
   */
  materializedTradeNoteIds?: string[];
  
  /**
   * スクリーニング結果(Phase 4b で実行)
   * Phase 4c の完全検証とは別物
   */
  screeningResult?: {
    executedAt: string;
    tradeNoteId: string;
    passed: boolean;
    metrics: {
      pf: number;
      winRate: number;
      tradeCount: number;
    };
    reasons?: string[];  // passed=false の場合の理由
  };
  
  /** 無効化条件(Phase 4a 既存) */
  invalidationConditions?: any[];
}
```

**マイグレーション**: 全フィールドオプショナル、既存データ保護。

**デフォルトリスク管理の補完値**:
```typescript
export const DEFAULT_RISK_MANAGEMENT = {
  stopLoss: { type: 'atr_multiple', value: 1.5 },
  takeProfit: { type: 'rr_ratio', value: 2.0 },
  maxHoldingBars: 48,
};
```

### 4.2 AITradeNote への追加フィールド

`src/side-b/models/aiTradeNote.ts`

```typescript
export interface AITradeNote {
  // ... 既存フィールド ...
  
  /** 対応する Side-A TradeNote の ID */
  tradeNoteId?: string;
}
```

マイグレーション: オプショナル追加のみ。

### 4.3 MaterializationService

`src/side-b/bridge/MaterializationService.ts`

仮説を Side-A の TradeNote 形式に変換する。**遅延生成方式**: 検証実行時にのみ呼ばれる(仮説生成時ではない)。

```typescript
export class MaterializationService {
  constructor(
    private lensAggregator: LensAggregator,
    // 必要なら他の既存サービス
  ) {}
  
  /**
   * 仮説を検証用に TradeNote に materialize する
   * 
   * 変換方針:
   *   - User パス優先: MachineReadableCondition[] を UserIndicatorNoteEvaluator が
   *     理解できる indicatorConfig に変換
   *   - Legacy パスはフォールバック
   *   - 変換不能な条件を含む仮説は MaterializationError を投げる
   * 
   * @returns 生成された TradeNote の ID
   */
  async materializeForValidation(
    hypothesis: EdgeHypothesis,
    period: { start: string; end: string }
  ): Promise<string> {
    // 1. defaultRiskManagement を補完
    const riskMgmt = hypothesis.defaultRiskManagement ?? DEFAULT_RISK_MANAGEMENT;
    
    // 2. 条件を User パス形式に変換試行
    const userConfig = this.tryConvertToUserIndicator(hypothesis.conditions);
    
    if (userConfig) {
      // User パス採用
      return await this.createTradeNoteWithIndicatorConfig(hypothesis, userConfig, riskMgmt);
    }
    
    // 3. User 変換不能なら Legacy にフォールバック
    const featureVector = this.tryConvertToFeatureVector(hypothesis.conditions);
    if (featureVector) {
      return await this.createTradeNoteWithFeatureVector(hypothesis, featureVector, riskMgmt);
    }
    
    // 4. どちらでも変換不能なら検証不可
    throw new MaterializationError(
      `Cannot materialize hypothesis ${hypothesis.id}: conditions not translatable`,
      hypothesis.id
    );
  }
  
  /**
   * 仮想トレード完了時に AITradeNote と同時に TradeNote を生成する
   * aiNoteService から呼ばれる
   */
  async materializeFromVirtualTrade(
    virtualTrade: VirtualTrade,
    aiNote: AITradeNote
  ): Promise<string> {
    // 仮想トレードの完了情報から TradeNote を作る
    // 既存の TradeNote スキーマに合わせてマッピング
  }
  
  private tryConvertToUserIndicator(conditions: any[]): IndicatorConfig | null {
    // レンズ特徴量 → Side-A インジケーター条件
    // 変換可能なものだけ: current_analysis.rsi, volatility_regime.bb_width_percentile 等
    // 変換不能なもの(time_session.*、smc.*等)は null を返す
  }
  
  private tryConvertToFeatureVector(conditions: any[]): number[] | null {
    // 12次元 featureVector 投影
    // current_analysis レンズの数値を12次元に割り当て
  }
  
  private async createTradeNoteWithIndicatorConfig(
    hypothesis: EdgeHypothesis,
    config: IndicatorConfig,
    riskMgmt: any
  ): Promise<string> {
    // Prisma で TradeNote を作成
    // Trade エンティティも必要なら作る(Phase 4b での最小実装)
  }
  
  private async createTradeNoteWithFeatureVector(
    hypothesis: EdgeHypothesis,
    vector: number[],
    riskMgmt: any
  ): Promise<string> {
    // Prisma で TradeNote を作成(featureVector パス)
  }
}

export class MaterializationError extends Error {
  constructor(message: string, public hypothesisId: string) {
    super(message);
  }
}
```

**重要**: ATR 値の取得は VolatilityRegimeLens の出力を使う。レンズ計算は既に Phase 3 で完成している。

### 4.4 ScreeningOrchestrator

`src/side-b/bridge/ScreeningOrchestrator.ts`

スクリーニングの全体フローを統括する。

```typescript
export class ScreeningOrchestrator {
  constructor(
    private materialization: MaterializationService,
    private edgeLedger: EdgeLedger,
    // Side-A backtestService への参照
  ) {}
  
  /**
   * 仮説に対して事前スクリーニングを実行
   * 
   * フロー:
   *   1. 仮説を TradeNote に materialize
   *   2. Side-A BacktestService で BT 実行
   *   3. 結果を評価
   *   4. 通過なら screening_passed に昇格、不通過なら rejected
   */
  async runScreening(hypothesisId: string): Promise<ScreeningResult> {
    const hypothesis = await this.edgeLedger.get(hypothesisId);
    if (!hypothesis) throw new Error(`Hypothesis ${hypothesisId} not found`);
    
    if (hypothesis.status !== 'unverified') {
      throw new Error(`Hypothesis ${hypothesisId} is not unverified: ${hypothesis.status}`);
    }
    
    // 1. 期間決定(直近1年が基本)
    const period = this.determineScreeningPeriod();
    
    try {
      // 2. Materialize
      const tradeNoteId = await this.materialization.materializeForValidation(
        hypothesis, period
      );
      
      // 3. Side-A BacktestService で BT 実行
      const btResult = await backtestService.execute({
        noteId: tradeNoteId,
        startDate: period.start,
        endDate: period.end,
        // 他必要パラメータ
      });
      
      // 4. スクリーニング判定
      const passed = this.evaluateScreening(btResult);
      
      // 5. EdgeLedger 更新
      await this.edgeLedger.update(hypothesisId, {
        materializedTradeNoteIds: [tradeNoteId],
        screeningResult: {
          executedAt: new Date().toISOString(),
          tradeNoteId,
          passed,
          metrics: {
            pf: btResult.pf,
            winRate: btResult.winRate,
            tradeCount: btResult.tradeCount,
          },
          reasons: passed ? undefined : this.getRejectionReasons(btResult),
        },
        status: passed ? 'screening_passed' : 'rejected',
        statusUpdatedAt: new Date(),
      });
      
      return { 
        hypothesisId, 
        passed, 
        tradeNoteId, 
        metrics: btResult 
      };
    } catch (error) {
      if (error instanceof MaterializationError) {
        // 変換不能
        await this.edgeLedger.update(hypothesisId, {
          status: 'not_testable',
          statusUpdatedAt: new Date(),
        });
        return { 
          hypothesisId, 
          passed: false, 
          error: 'not_testable',
          errorDetails: error.message 
        };
      }
      throw error;
    }
  }
  
  private evaluateScreening(btResult: any): boolean {
    // スクリーニング通過基準(暫定):
    // - PF > 1.3
    // - トレード数 >= 20
    // - 勝率 > 40%
    // 基準は後で調整可能にすべき(設定ファイル化検討)
    return btResult.pf > 1.3 
        && btResult.tradeCount >= 20 
        && btResult.winRate > 0.4;
  }
  
  private getRejectionReasons(btResult: any): string[] {
    const reasons: string[] = [];
    if (btResult.pf <= 1.3) reasons.push(`PF不足: ${btResult.pf}`);
    if (btResult.tradeCount < 20) reasons.push(`トレード数不足: ${btResult.tradeCount}`);
    if (btResult.winRate <= 0.4) reasons.push(`勝率不足: ${btResult.winRate}`);
    return reasons;
  }
  
  private determineScreeningPeriod(): { start: string; end: string } {
    // 直近1年(または設定可能な期間)
    const end = new Date();
    const start = new Date();
    start.setFullYear(start.getFullYear() - 1);
    return { 
      start: start.toISOString().split('T')[0], 
      end: end.toISOString().split('T')[0] 
    };
  }
}
```

**スクリーニング基準の根拠**:
- PF > 1.3: 明らかに損失を出す戦略を弾く(本昇格の 1.5 より緩い)
- トレード数 20以上: 統計的に意味のある数
- 勝率 40% 以上: RR が低すぎる戦略を弾く

これらは Phase 4c の最終判定(Phase 4c で PF > 1.5 等より厳しい基準)に進む前の **粗いフィルタ**。ここで大量の not_testable を避けつつ、明らかに弱い仮説を除外する。

### 4.5 StatusManager の拡張(Phase 4b 部分のみ)

`src/side-b/ledger/StatusManager.ts`

Phase 4b では `screening_passed` への遷移判定のみ追加。`confirmed` 判定は Phase 4c で実装。

```typescript
// Phase 4b で追加
canPromoteToScreeningPassed(screeningResult: any): { ok: boolean; reasons: string[] } {
  // ScreeningOrchestrator の evaluateScreening と同等
  // こちらは再利用可能な形で実装
}

// Phase 4c で実装予定(今は実装しない)
// canPromoteToConfirmedFull() → Phase 4c
```

### 4.6 HypothesisGenerator プロンプト更新

`src/side-b/prompts/hypothesis_generator.md`

仮説生成時に `defaultRiskManagement` を含めるよう指示を追加:

```markdown
## 出力形式の追加要件(Phase 4b 対応)

各仮説に、デフォルトのリスク管理設定を含めてください(オプショナル):

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

## defaultRiskManagement の制約(Phase 4b)

このフェーズでは以下の type のみサポート:
- stopLoss: `atr_multiple` または `rr_ratio`
- takeProfit: `rr_ratio` または `atr_multiple`

swing_point や fixed_pips は将来のフェーズで対応します。
上記以外を生成した場合、デフォルト値に置き換えられます。
```

### 4.7 aiNoteService の TradeNote 同時生成

`src/side-b/services/aiNoteService.ts`

既存の `generateNoteFromTrade` を改修。

```typescript
async generateNoteFromTrade(
  trade: VirtualTrade, 
  plan: AITradePlan, 
  lensSnapshot?: LensFeatureSnapshot
): Promise<AITradeNote> {
  // 既存ロジック: AITradeNote 生成
  const aiNote = await this.createAITradeNote(trade, plan, lensSnapshot);
  
  // 新規: 同時に TradeNote も生成(best-effort)
  try {
    const tradeNoteId = await this.materializationService.materializeFromVirtualTrade(trade, aiNote);
    aiNote.tradeNoteId = tradeNoteId;
    await this.aiNoteRepository.update(aiNote.id, { tradeNoteId });
  } catch (error) {
    // TradeNote 生成失敗は AITradeNote 保存を妨げない
    console.error('[aiNoteService] TradeNote 同時生成失敗 (継続):', error);
  }
  
  return aiNote;
}
```

**重要**: TradeNote 生成失敗で AITradeNote 生成が止まらない設計。ブリッジは best-effort。

### 4.8 EdgeLedger の更新

`src/side-b/ledger/EdgeLedger.ts`

```typescript
// 既存の EdgeStatus 型に 'screening_passed' を追加済み(4.1で)

// 新規追加: スクリーニング結果記録
async recordScreeningResult(
  hypothesisId: string, 
  result: EdgeHypothesis['screeningResult']
): Promise<void> {
  const hyp = await this.get(hypothesisId);
  if (!hyp) throw new Error(`Not found: ${hypothesisId}`);
  
  const newStatus = result?.passed ? 'screening_passed' : 'rejected';
  await this.update(hypothesisId, {
    screeningResult: result,
    status: newStatus,
    statusUpdatedAt: new Date(),
  });
}

// 既存 findByStatus で 'screening_passed' も検索可能(ステータス文字列を増やしただけ)
```

### 4.9 スケジューラー統合

`src/side-b/jobs/sideBScheduler.ts`

```typescript
// Phase 4b: 日次スクリーニング
schedule('daily_hypothesis_screening', '0 3 * * *', async () => {
  const MAX_PER_DAY = 10;
  const targets = await edgeLedger.findByStatus('unverified');
  const limited = targets.slice(0, MAX_PER_DAY);
  
  for (const hyp of limited) {
    try {
      console.log(`[scheduler] Screening hypothesis: ${hyp.id}`);
      await screeningOrchestrator.runScreening(hyp.id);
      await sleep(3000);  // Side-A 基盤負荷配慮
    } catch (error) {
      console.error(`[scheduler] Screening failed for ${hyp.id}:`, error);
    }
  }
});

// 注意: 'daily_full_validation'(Phase 4c)はこのフェーズでは実装しない
```

### 4.10 テスト

**必須テスト**:

`src/side-b/tests/bridge/materializationService.test.ts`
- User パス変換が成功するケース
- Legacy パス変換が成功するケース
- 両方不能で MaterializationError を投げるケース
- defaultRiskManagement 欠落時のデフォルト補完

`src/side-b/tests/bridge/screeningOrchestrator.test.ts`
- スクリーニング通過 → screening_passed
- スクリーニング不通過 → rejected
- Materialize 失敗 → not_testable
- BT 実行失敗時のエラーハンドリング
- 既に unverified でない仮説への呼び出しを拒否

`src/side-b/tests/services/aiNoteService.test.ts`(既存テスト拡張)
- TradeNote 同時生成が動作
- TradeNote 生成失敗でも AITradeNote 生成は継続

---

## 5. 設計上の注意

### 5.1 このフェーズでやらないこと

- **WalkForward 実行**: Phase 4c
- **MonteCarlo**: Phase 4c
- **BuyAndHold 比較**: Phase 4c
- **LLM による解釈**: Phase 4c
- **confirmed 昇格**: Phase 4c(このフェーズでは screening_passed まで)
- **手動トリガー API**: Phase 4c
- **UI 実装**: Phase 4d

### 5.2 スクリーニング基準の暫定性

現在のスクリーニング基準(PF > 1.3, 勝率 40%, トレード数20)は暫定。運用開始後に調整。環境変数での外部化は Phase 4c で実施(Phase 4b ではハードコードで可、TODO コメント付けておく)。

### 5.3 変換失敗(not_testable)の扱い

MaterializationError が発生した仮説は `not_testable` ステータス。これらは:
- EdgeLedger には残る(将来の解析材料)
- Phase 4c でも扱わない
- Phase 5-6 で「仮説レベル backtester」を別途検討する際の材料になる

大量発生する場合は HypothesisGenerator のプロンプトで「変換しやすい条件を優先的に生成」指示を追加することを検討(ただしこの調整は Phase 4c 以降)。

### 5.4 Side-A 領域への不介入

既存の `src/services/backtestService.ts` 等は **読み取り専用の外部 API として扱う**。
- シグネチャ変更禁止
- 内部ロジック変更禁止
- import して呼ぶのは OK

### 5.5 HypothesisBacktestOrchestrator 等の旧設計の扱い

旧版の `phase_4b_specification.md` に記載されていた以下のクラスは **このフェーズでは実装しない**:
- HypothesisBacktestOrchestrator → Phase 4c の BacktesterAgent + ツール群に発展
- HypothesisWalkForwardOrchestrator → Phase 4c の WalkForwardTool(Python)
- EdgeValidatorAgent → Phase 4c の StrategistAgent

Claude Code が旧仕様書を参照してしまわないよう、新仕様書(この4b縮小版)のみ読むよう発注時に明確に指示すること。

### 5.6 ベストエフォート原則

- スクリーニング1件の失敗は他の仮説に影響しない
- TradeNote 同時生成失敗は AITradeNote を止めない
- エラーは全てログに残す、握りつぶさない

---

## 6. 実装順序

Claude Code 向けの推奨順序:

### ステップ1: データモデル更新(最初)
1. EdgeHypothesis 型に新フィールド追加
2. AITradeNote 型に新フィールド追加
3. Prisma マイグレーション作成

### ステップ2: MaterializationService
1. 変換ロジック(User パス優先、Legacy フォールバック)
2. ユニットテスト

### ステップ3: ScreeningOrchestrator
1. スクリーニングフロー実装
2. EdgeLedger 連携
3. ユニットテスト

### ステップ4: HypothesisGenerator 更新
1. プロンプトに defaultRiskManagement 出力指示追加
2. 既存テストが通ることを確認

### ステップ5: aiNoteService 改修
1. TradeNote 同時生成を追加
2. ユニットテスト更新

### ステップ6: スケジューラー統合
1. 日次スクリーニングジョブ追加
2. エンドツーエンド動作確認

各ステップ終了時にコミット。

---

## 7. 完了報告時に含めること

1. 作成/変更したファイルの一覧
2. Prisma マイグレーション差分
3. スクリーニングフローのエンドツーエンド実行ログ:
   - unverified 仮説 → materialize → BT → screening_passed or rejected
4. 通過した仮説の例(screening_passed 状態になったもの)
5. not_testable になった仮説の例(変換不能だったもの)
6. 既存テスト全通過の確認
7. 追加テストの実行結果
8. Phase 4c への引き継ぎメモ

### Phase 4c への引き継ぎメモに含めるべき内容

- `screening_passed` 状態の仮説件数(Phase 4c の入力として)
- Materialize 時に発見された翻訳上の限界事例(Phase 4c で Python ツール側で解決すべき課題)
- スクリーニング基準の妥当性評価(今後調整が必要か)

---

## 8. レビュー観点

- EdgeHypothesis の新フィールドが全てオプショナルで、後方互換が保たれているか
- MaterializationService の変換が User パス優先・Legacy フォールバックになっているか
- ScreeningOrchestrator が正しくステータス遷移させているか(unverified → screening_passed or rejected or not_testable)
- aiNoteService の TradeNote 同時生成が失敗しても AITradeNote 生成が続くか
- Side-A コードに一切変更がないか(git diff 確認)
- スケジューラーが日次で動くよう登録されているか
- 旧版仕様書の HypothesisBacktestOrchestrator 等が **実装されていないこと** の確認
- テストがあるか

---

## 9. Phase 4c 接続仕様

Phase 4c が期待する Phase 4b 成果物:

- `screening_passed` ステータスを持つ EdgeHypothesis が存在する
- それらに `materializedTradeNoteIds` が埋まっている
- それらに `screeningResult` が記録されている
- MaterializationService が再利用可能な形で存在している(Phase 4c でも内部で使う)
- AITradeNote.tradeNoteId フィールドが機能している

これらを満たしていれば Phase 4c が着手可能。
