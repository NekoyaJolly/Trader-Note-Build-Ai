# フェーズ4c 発注仕様書: 検証ツール群と2層エージェント構造

> **期間目安**: 3〜4週間
> **目的**: Python ライブラリを活用した検証ツール群(WF/MC/BH)を Docker コンテナ化し、2層エージェント構造(Strategist + Backtester + Tools)で仮説検証を完成させる
> **前提**: フェーズ1-3 完了、フェーズ4a 完了、フェーズ4b 縮小版 完了
> **前提読み物**:
> - `docs/design/DESIGN_DOC_autonomous_trading_architecture.md`
> - `docs/design/phase_4b_specification.md`(縮小版)
> - このフェーズは Phase 4b で発覚した「Side-A の ConditionGroup 制約」への本質的解決策

---

## 0. このフェーズの位置づけ

### 0.1 設計思想の転換

Phase 4b の実装過程で判明した構造的問題(Side-A の walkForwardService が ConditionGroup を要求する)への対応として、**検証プロセス自体をエージェント化し、Python ライブラリを活用する** 方針に転換した。

**旧方針(Phase 4b 元仕様)**:
仮説 → Side-A サービスに直接接続 → ConditionGroup 変換の壁に阻まれる

**新方針(Phase 4c)**:
仮説 → 2層エージェント(Strategist + Backtester)→ Python ツール群を並列実行 → 結果統合 → 昇格判定

### 0.2 CLAUDE.md 原則との整合性

この設計は設計書の原則を構造レベルで実現する:

- **原則3 LLM に期待することを限定する**: 各ツールは決定論的実装、LLM は Strategist の結果解釈のみ
- **原則4 検証可能性を絶対に捨てない**: 統計的検証の責務を明確化
- **協業パートナー原則**: Side-A のコードは一切変更しない、Side-B 独自の検証パイプラインを構築

### 0.3 2層構造の定義

```
【上位層】Strategist Agent
   役割: 昇格判定 + LLM による結果解釈
   実装: 決定論的判定ロジック + オプショナルな LLM 呼び出し

【中位層】Backtester Agent  
   役割: 検証ツール群の並列実行統括
   実装: 純粋な TypeScript オーケストレーター、LLM 不使用

【下位層】Validation Tools 群
   役割: 個別の検証計算
   実装: TypeScript または Python(Docker)
   - BacktestScreeningTool: Phase 4b 縮小版で実装済み(既存 Side-A BacktestService のラッパー)
   - WalkForwardTool: Python + vectorbt(Docker)
   - MonteCarloTool: TypeScript 自前 or Python(Docker)
   - BuyAndHoldTool: TypeScript 自前
```

将来的に上位にさらなる Orchestrator が立つ可能性はあるが、このフェーズでは作らない(PDCA ループが実質的な上位統括)。

---

## 1. このフェーズのゴール

Phase 4b 縮小版で `screening_passed` になった仮説を、4つの検証ツールで多角的に評価し、総合判定で `confirmed` または `rejected` に昇格・棄却する。

完了時点で以下が実現される:

- Docker ベースの Python 検証環境が稼働
- WalkForward/MonteCarlo/BuyAndHold の3つのツールが並列実行可能
- Backtester Agent が検証レポートを統合
- Strategist Agent が昇格判定を下し、結果を LLM で解釈
- スケジューラーが日次で `screening_passed` 仮説を検証対象として消化
- 手動トリガー API が実装されている(UI は Phase 4d)
- Phase 4b 縮小版で `screening_passed` になった仮説が順次評価される

---

## 2. 完了条件

以下の全てを満たす:

- [ ] Docker コンテナで Python + vectorbt(または選定ライブラリ)環境が稼働している
- [ ] `PythonBridge` が実装され、TS から Python スクリプトを呼び出せる
- [ ] `ValidationTool` インターフェースが定義されている
- [ ] `WalkForwardTool` が実装され、Python 経由で検証できる
- [ ] `MonteCarloTool` が実装されている
- [ ] `BuyAndHoldTool` が実装されている
- [ ] `BacktesterAgent` が実装され、3ツールを並列実行して統合レポートを返す
- [ ] `StrategistAgent` が実装され、昇格判定 + LLM 解釈を行う
- [ ] EdgeLedger に新ステータス(後述)が追加されている
- [ ] スケジューラーに日次検証ジョブが追加されている
- [ ] 手動トリガー API(`POST /api/side-b/hypotheses/:id/validate`)が実装されている
- [ ] Phase 4b 縮小版で作られた `暫定昇格` 仕組みがある場合、それを Phase 4c の正式判定で置き換える
- [ ] 既存テスト全通過
- [ ] 新規ロジックにユニットテスト

---

## 3. 触っていいファイル / 触ってはいけないファイル

### 触っていい(新規作成)

**エージェント層**
- `src/side-b/agents/StrategistAgent.ts`
- `src/side-b/agents/BacktesterAgent.ts`
- `src/side-b/prompts/strategist.md`

**ツール層**
- `src/side-b/validation/tools/types.ts`
- `src/side-b/validation/tools/WalkForwardTool.ts`
- `src/side-b/validation/tools/MonteCarloTool.ts`
- `src/side-b/validation/tools/BuyAndHoldTool.ts`

**Python ブリッジ**
- `src/side-b/validation/python_bridge/PythonBridge.ts`
- `src/side-b/validation/python_bridge/types.ts`

**Python 側**
- `python/walk_forward/walk_forward.py`
- `python/walk_forward/requirements.txt`
- `python/monte_carlo/monte_carlo.py`(Python実装を選んだ場合)
- `python/Dockerfile`
- `python/docker-compose.yml`
- `python/README.md`

**API 層**
- `src/side-b/api/validationRoutes.ts`
- `src/side-b/controllers/validationController.ts`

**テスト**
- `src/side-b/tests/agents/strategist.test.ts`
- `src/side-b/tests/agents/backtester.test.ts`
- `src/side-b/tests/validation/tools/*.test.ts`
- `src/side-b/tests/validation/python_bridge.test.ts`
- `python/tests/test_walk_forward.py`

### 触っていい(改修)
- `src/side-b/models/edgeHypothesis.ts` ― 新ステータス、検証レポートフィールド追加
- `src/side-b/ledger/EdgeLedger.ts` ― 新ステータス対応、検証結果記録メソッド
- `src/side-b/ledger/StatusManager.ts` ― 昇格判定ロジックを Phase 4c 完全版に
- `src/side-b/jobs/sideBScheduler.ts` ― 日次検証ジョブ追加
- `prisma/schema.prisma` ― 新フィールド(BH比較結果、MC結果等)
- `package.json` ― 必要な TS 依存関係追加

### 触ってはいけない
- `src/side-b/lenses/`
- `src/side-b/agents/` の既存エージェント(DevilsAdvocate, HypothesisGenerator, Discovery)
- `src/side-b/bridge/`(Phase 4b 縮小版成果物)の MaterializationService
- **Side-A のコード全般**(`src/services/`, `src/backend/` 配下)
- 既存の Prisma 定義(TradeNote, BacktestRun 等)
- **フロントエンド関連ファイル全般**(Phase 4d で扱う)

---

## 4. 実装仕様

### 4.1 Python ライブラリ選定指針

Claude Code が選定するが、以下の基準を必ず守る:

**最優先基準**:
- LTS または十分に安定した枯れたライブラリ(突然の破壊的変更がない)
- アクティブメンテナンスされている(直近1年以内の更新)
- 計算精度に関する問題報告が少ない
- ドキュメントが充実している

**推奨候補**(Claude Code が最終判断):
- **vectorbt**: 高速、研究用途で実績、NumPy ベース
- **backtrader**: 枯れていて情報量豊富、情報ソース多い
- **backtesting.py**: 軽量、シンプル、学習コスト低

選定時には `python/README.md` に選定理由を記録すること。

### 4.2 Docker 構成

`python/Dockerfile` 基本構成:
```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# スクリプト実行用のエントリポイント
CMD ["python", "-u", "/app/entrypoint.py"]
```

`python/docker-compose.yml` 基本構成:
```yaml
version: '3.8'
services:
  python_validator:
    build: .
    container_name: side_b_python_validator
    volumes:
      - ./shared:/app/shared  # データ受け渡し用
    networks:
      - side_b_network

networks:
  side_b_network:
    driver: bridge
```

**運用方針**:
- 開発時: `docker-compose up -d` で起動、TS から同一ホスト内の Python に接続
- 本番: 将来 Docker ホスティング(例: Fly.io, Railway, 自前VPS)にデプロイ
- このフェーズでは **ローカル Docker で動作完結** を目標とする

### 4.3 PythonBridge

`src/side-b/validation/python_bridge/PythonBridge.ts`

TS から Python コンテナを呼び出す統一インターフェース。

```typescript
export interface PythonExecutionRequest {
  scriptPath: string;  // コンテナ内のスクリプトパス
  input: Record<string, unknown>;
  timeoutMs?: number;
}

export interface PythonExecutionResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

export class PythonBridge {
  constructor(
    private config: {
      containerName: string;
      sharedDir: string;  // TS-Python 間のデータ受け渡しディレクトリ
      defaultTimeoutMs: number;
    }
  ) {}
  
  async execute(request: PythonExecutionRequest): Promise<PythonExecutionResult> {
    // 1. 入力データを JSON ファイルに書き出し(shared ディレクトリ)
    // 2. docker exec で Python スクリプトを実行
    // 3. 出力 JSON を読み取り
    // 4. 結果を返す
  }
  
  async healthCheck(): Promise<boolean> {
    // コンテナが起動しているか確認
  }
}
```

**重要な実装判断**:
- データ受け渡しは **共有ボリューム経由の JSON ファイル** を採用(標準入出力より安定)
- タイムアウト制御必須(無限ループ防止)
- Python 側のエラーはキャッチして TS 側の ValidationTool に伝播させる

### 4.4 ValidationTool インターフェース

`src/side-b/validation/tools/types.ts`

```typescript
export interface ValidationToolInput {
  hypothesis: EdgeHypothesis;
  tradeNoteId: string;  // Phase 4b で materialize された TradeNote の ID
  period: { start: string; end: string };
  additionalParams?: Record<string, unknown>;
}

export interface ValidationToolResult {
  toolName: string;
  success: boolean;
  passed: boolean;  // このツール単独の判定
  metrics: Record<string, number | string | boolean>;
  interpretation?: string;
  error?: string;
  durationMs: number;
}

export interface ValidationTool {
  readonly name: string;
  readonly implementation: 'native_ts' | 'python_bridge';
  readonly requiredInputs: string[];
  
  execute(input: ValidationToolInput): Promise<ValidationToolResult>;
  
  isAvailable(): Promise<boolean>;  // 実行可能な状態か確認
}
```

### 4.5 WalkForwardTool

`src/side-b/validation/tools/WalkForwardTool.ts`

Python の vectorbt(等)を Docker 経由で呼び出し、ウォークフォワード検証を実行する。

```typescript
export class WalkForwardTool implements ValidationTool {
  readonly name = 'walk_forward';
  readonly implementation = 'python_bridge';
  readonly requiredInputs = ['hypothesis', 'tradeNoteId', 'period'];
  
  constructor(
    private pythonBridge: PythonBridge,
    private tradeNoteRepo: TradeNoteRepository,  // 既存の Side-A リポジトリ
  ) {}
  
  async execute(input: ValidationToolInput): Promise<ValidationToolResult> {
    const start = Date.now();
    try {
      // 1. TradeNote から OHLCV データ + 条件を取得
      const tradeNote = await this.tradeNoteRepo.findById(input.tradeNoteId);
      const ohlcv = await this.loadOhlcv(tradeNote, input.period);
      
      // 2. Python スクリプトに渡すペイロードを構築
      const payload = {
        ohlcv,
        conditions: this.translateConditionsForPython(input.hypothesis),
        riskManagement: input.hypothesis.defaultRiskManagement,
        splitCount: 4,
        period: input.period,
      };
      
      // 3. Python 実行
      const pyResult = await this.pythonBridge.execute({
        scriptPath: '/app/walk_forward/walk_forward.py',
        input: payload,
        timeoutMs: 300000,  // 5分
      });
      
      if (!pyResult.success || !pyResult.output) {
        return this.errorResult(pyResult.error, start);
      }
      
      const output = pyResult.output as WalkForwardPythonOutput;
      
      // 4. 判定(過学習スコア < 0.3)
      const passed = output.overfitScore < 0.3;
      
      return {
        toolName: this.name,
        success: true,
        passed,
        metrics: {
          overfitScore: output.overfitScore,
          avgInSampleWinRate: output.avgInSampleWinRate,
          avgOutOfSampleWinRate: output.avgOutOfSampleWinRate,
          inSamplePF: output.inSamplePF,
          outOfSamplePF: output.outOfSamplePF,
          splitCount: output.splitCount,
        },
        interpretation: this.interpretResult(output),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return this.errorResult(String(error), start);
    }
  }
  
  async isAvailable(): Promise<boolean> {
    return await this.pythonBridge.healthCheck();
  }
  
  private translateConditionsForPython(hyp: EdgeHypothesis): PythonCondition[] {
    // MachineReadableCondition[] を Python 側で解釈可能な形式に変換
  }
  
  private interpretResult(output: WalkForwardPythonOutput): string {
    // 結果の簡易解釈テキスト生成(LLM 不使用、テンプレートベース)
  }
}
```

Python 側(`python/walk_forward/walk_forward.py`):
```python
import json
import sys
from pathlib import Path

def run_walk_forward(payload: dict) -> dict:
    """
    入力ペイロードを受け取り、ウォークフォワード検証を実行
    
    payload:
        ohlcv: list of OHLCV bars
        conditions: list of conditions
        riskManagement: dict
        splitCount: int
        period: dict with start/end
    
    returns:
        dict with overfitScore, avgInSampleWinRate, ...
    """
    # vectorbt or backtrader を使った実装
    # ここは Claude Code が選定ライブラリで実装
    pass

if __name__ == '__main__':
    input_path = sys.argv[1] if len(sys.argv) > 1 else '/app/shared/input.json'
    output_path = sys.argv[2] if len(sys.argv) > 2 else '/app/shared/output.json'
    
    with open(input_path) as f:
        payload = json.load(f)
    
    result = run_walk_forward(payload)
    
    with open(output_path, 'w') as f:
        json.dump(result, f)
```

### 4.6 MonteCarloTool

`src/side-b/validation/tools/MonteCarloTool.ts`

**実装選択**: TypeScript 自前実装 or Python 経由

推奨: **TypeScript 自前実装**(数十行で書ける、Python 起動コスト不要)

```typescript
export class MonteCarloTool implements ValidationTool {
  readonly name = 'monte_carlo';
  readonly implementation = 'native_ts';
  readonly requiredInputs = ['tradeNoteId'];
  
  async execute(input: ValidationToolInput): Promise<ValidationToolResult> {
    // 1. TradeNote のバックテスト結果から全トレード損益リストを取得
    // 2. トレードをランダムにリサンプリング(1000回)
    // 3. 各シミュレーションで最大ドローダウン、最終損益を計算
    // 4. 分布から信頼区間を算出
    
    // 判定基準:
    // - 95%信頼区間の下側ドローダウンが想定以内
    // - 95%信頼区間の下側最終損益が0以上
    
    return {
      toolName: this.name,
      success: true,
      passed: /* 判定 */,
      metrics: {
        simulationCount: 1000,
        medianFinalPnl: /* */,
        p5FinalPnl: /* 下側5% */,
        p95FinalPnl: /* 上側95% */,
        medianMaxDrawdown: /* */,
        p5MaxDrawdown: /* */,
      },
      durationMs: /* */,
    };
  }
}
```

**Python 実装を選ぶ場合**: vectorbt にモンテカルロ機能がある場合はそれを使う、独自実装でも良い。TS vs Python の選択は Claude Code が判断(TS 実装が20行以上複雑になるなら Python へ)。

### 4.7 BuyAndHoldTool

`src/side-b/validation/tools/BuyAndHoldTool.ts`

純粋な TS 実装(数十行)。

```typescript
export class BuyAndHoldTool implements ValidationTool {
  readonly name = 'buy_and_hold';
  readonly implementation = 'native_ts';
  readonly requiredInputs = ['tradeNoteId', 'period'];
  
  async execute(input: ValidationToolInput): Promise<ValidationToolResult> {
    // 1. 対象期間の始値と終値を取得
    // 2. バイアンドホールド収益率を計算
    // 3. 仮説のバックテスト結果と比較
    
    const bhReturn = /* 終値/始値 - 1 */;
    const strategyReturn = /* バックテスト結果から */;
    const outperformance = strategyReturn - bhReturn;
    
    // 判定基準: 戦略収益率が BH を 0.5% 以上上回る
    const passed = outperformance > 0.005;
    
    return {
      toolName: this.name,
      success: true,
      passed,
      metrics: {
        buyAndHoldReturn: bhReturn,
        strategyReturn: strategyReturn,
        outperformance: outperformance,
        periodDays: /* */,
      },
      durationMs: /* */,
    };
  }
}
```

**重要**: この判定基準は **戦略が市場全体の動きに乗っただけではないか** を見るためのもの。詳細な判定基準はユーザーと調整する余地あり(閾値 0.5% は暫定値)。

### 4.8 BacktesterAgent

`src/side-b/agents/BacktesterAgent.ts`

3ツールを並列実行し、統合レポートを返す。LLM は使わない。

```typescript
export interface ConsolidatedValidationReport {
  hypothesisId: string;
  periodUsed: { start: string; end: string };
  
  screening?: ValidationToolResult;  // Phase 4b 縮小版の結果を流用
  walkForward?: ValidationToolResult;
  monteCarlo?: ValidationToolResult;
  buyAndHold?: ValidationToolResult;
  
  allPassed: boolean;
  passedCount: number;
  totalCount: number;
  
  startedAt: Date;
  completedAt: Date;
  totalDurationMs: number;
  
  errors: string[];  // 一部ツール失敗時のエラー
}

export class BacktesterAgent {
  constructor(
    private tools: {
      walkForward: WalkForwardTool;
      monteCarlo: MonteCarloTool;
      buyAndHold: BuyAndHoldTool;
    },
    private edgeLedger: EdgeLedger,
  ) {}
  
  async runFullValidation(
    hypothesis: EdgeHypothesis,
    tradeNoteId: string,
    period: { start: string; end: string }
  ): Promise<ConsolidatedValidationReport> {
    const startedAt = new Date();
    const input: ValidationToolInput = { hypothesis, tradeNoteId, period };
    
    // 既存のスクリーニング結果を取得(Phase 4b 縮小版で既に実行済み)
    const screening = hypothesis.screeningResult;
    
    // 3ツールを並列実行
    const [wf, mc, bh] = await Promise.allSettled([
      this.tools.walkForward.execute(input),
      this.tools.monteCarlo.execute(input),
      this.tools.buyAndHold.execute(input),
    ]);
    
    const errors: string[] = [];
    const results = [wf, mc, bh].map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      const toolNames = ['walkForward', 'monteCarlo', 'buyAndHold'];
      errors.push(`${toolNames[i]}: ${r.reason}`);
      return undefined;
    });
    
    const passedCount = [screening, ...results].filter(r => r?.passed).length;
    const totalCount = 4;
    const allPassed = results.every(r => r?.passed) && screening?.passed === true;
    
    return {
      hypothesisId: hypothesis.id,
      periodUsed: period,
      screening,
      walkForward: results[0],
      monteCarlo: results[1],
      buyAndHold: results[2],
      allPassed,
      passedCount,
      totalCount,
      startedAt,
      completedAt: new Date(),
      totalDurationMs: Date.now() - startedAt.getTime(),
      errors,
    };
  }
}
```

**重要な挙動**:
- 3ツールのいずれかが失敗しても、他のツールの結果は保持(Promise.allSettled)
- 部分的成功でも `allPassed: false` になる(失敗したツールの判定は得られないため)
- エラー詳細は `errors` フィールドに記録

### 4.9 StrategistAgent

`src/side-b/agents/StrategistAgent.ts` + `src/side-b/prompts/strategist.md`

昇格判定と LLM による結果解釈。

```typescript
export interface PromotionVerdict {
  verdict: 'confirmed' | 'rejected' | 'insufficient_data' | 'not_testable';
  hypothesisId: string;
  report: ConsolidatedValidationReport;
  baseCriteriaReasons: string[];  // 決定論的判定の理由
  interpretation?: string;  // LLM による言語化(任意)
  actionableInsights?: string[];  // 改善提案(任意)
  decidedAt: Date;
}

export class StrategistAgent {
  constructor(
    private backtester: BacktesterAgent,
    private edgeLedger: EdgeLedger,
    private statusManager: StatusManager,
    private llmClient: AIProvider,
  ) {}
  
  async validate(hypothesisId: string): Promise<PromotionVerdict> {
    const hypothesis = await this.edgeLedger.get(hypothesisId);
    if (!hypothesis) throw new Error(`Hypothesis ${hypothesisId} not found`);
    
    // 1. 期間決定
    const period = this.determineValidationPeriod(hypothesis);
    if (!period) {
      await this.edgeLedger.update(hypothesisId, { 
        status: 'insufficient_data',
        statusUpdatedAt: new Date(),
      });
      return this.buildVerdict('insufficient_data', hypothesis, null, [], null);
    }
    
    // 2. ステータスを testing に
    await this.edgeLedger.markTesting(hypothesisId);
    
    // 3. Phase 4b 縮小版で materialize された TradeNote ID を取得
    const tradeNoteId = hypothesis.materializedTradeNoteIds?.[0];
    if (!tradeNoteId) {
      return this.buildVerdict('not_testable', hypothesis, null, ['TradeNote が未生成'], null);
    }
    
    // 4. BacktesterAgent で全検証実行
    const report = await this.backtester.runFullValidation(hypothesis, tradeNoteId, period);
    
    // 5. 決定論的判定
    const baseCriteria = this.statusManager.canPromoteToConfirmedFull(hypothesis, report);
    
    // 6. LLM による解釈(判定結果を言語化、判定自体には影響しない)
    let interpretation: string | undefined;
    let actionableInsights: string[] | undefined;
    try {
      const llmResult = await this.interpretWithLLM(hypothesis, report, baseCriteria);
      interpretation = llmResult.interpretation;
      actionableInsights = llmResult.actionableInsights;
    } catch (error) {
      // LLM 失敗は判定を妨げない
      console.error('[StrategistAgent] LLM interpretation failed:', error);
    }
    
    // 7. EdgeLedger 更新
    if (baseCriteria.ok) {
      await this.edgeLedger.markConfirmed(hypothesisId, report, interpretation);
      return this.buildVerdict('confirmed', hypothesis, report, baseCriteria.reasons, interpretation, actionableInsights);
    } else {
      await this.edgeLedger.markRejected(hypothesisId, baseCriteria.reasons.join('; '), report);
      return this.buildVerdict('rejected', hypothesis, report, baseCriteria.reasons, interpretation, actionableInsights);
    }
  }
  
  private async interpretWithLLM(
    hypothesis: EdgeHypothesis,
    report: ConsolidatedValidationReport,
    baseCriteria: { ok: boolean; reasons: string[] }
  ): Promise<{ interpretation: string; actionableInsights: string[] }> {
    const systemPrompt = loadPrompt('strategist');
    const userPrompt = this.buildInterpretationPrompt(hypothesis, report, baseCriteria);
    
    const response = await this.llmClient.call({
      systemPrompt,
      userPrompt,
      model: this.llmClient.defaultModel,
      responseFormat: 'json_object',
    });
    
    return validateStrategistOutput(response);
  }
  
  // ... 他のメソッド
}
```

**StrategistAgent の設計原則**:
- **LLM に判定させない**: 昇格・棄却の決定は全て StatusManager の決定論的ロジック
- **LLM は解釈のみ**: 「なぜこの結果になったか」の言語化と改善提案
- **LLM 失敗時もフォールバック**: 解釈がなくても判定は完了する

### 4.10 StatusManager の完全版

`src/side-b/ledger/StatusManager.ts`

Phase 4b 縮小版の暫定版から、Phase 4c の完全版に置き換える。

```typescript
canPromoteToConfirmedFull(
  hyp: EdgeHypothesis,
  report: ConsolidatedValidationReport
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  
  // 1. スクリーニング(Phase 4b)通過
  if (!report.screening?.passed) {
    reasons.push('事前スクリーニング未通過');
  }
  
  // 2. WalkForward 通過(過学習スコア < 0.3)
  if (!report.walkForward) {
    reasons.push('WalkForward 実行失敗');
  } else if (!report.walkForward.passed) {
    reasons.push(`過学習スコア超過: ${report.walkForward.metrics.overfitScore}`);
  }
  
  // 3. MonteCarlo 通過
  if (!report.monteCarlo) {
    reasons.push('MonteCarlo 実行失敗');
  } else if (!report.monteCarlo.passed) {
    reasons.push(`モンテカルロ下側PnLマイナス: ${report.monteCarlo.metrics.p5FinalPnl}`);
  }
  
  // 4. BuyAndHold 通過(市場平均を上回る)
  if (!report.buyAndHold) {
    reasons.push('BuyAndHold 実行失敗');
  } else if (!report.buyAndHold.passed) {
    reasons.push(`BuyAndHold を上回れず: +${report.buyAndHold.metrics.outperformance}`);
  }
  
  // 5. 最低トレード数チェック
  const tradeCount = report.screening?.metrics?.tradeCount ?? 0;
  if (tradeCount < 20) {
    reasons.push(`トレード数不足: ${tradeCount} (必要20以上)`);
  }
  
  return { ok: reasons.length === 0, reasons };
}

/** Phase 4b 縮小版で生成された screening_passed を再評価 */
async reevaluatePassedScreenings(
  edgeLedger: EdgeLedger,
  strategist: StrategistAgent
): Promise<ReEvaluationReport> {
  const screeningPassed = await edgeLedger.findByStatus('screening_passed');
  
  const results = [];
  for (const hyp of screeningPassed) {
    const verdict = await strategist.validate(hyp.id);
    results.push(verdict);
  }
  
  return {
    total: screeningPassed.length,
    confirmed: results.filter(r => r.verdict === 'confirmed').length,
    rejected: results.filter(r => r.verdict === 'rejected').length,
    failed: results.filter(r => !['confirmed', 'rejected'].includes(r.verdict)).length,
  };
}
```

### 4.11 EdgeHypothesis への追加フィールド

`src/side-b/models/edgeHypothesis.ts`

```typescript
export type EdgeStatus = 
  | 'unverified'
  | 'screening_passed'  // Phase 4b 縮小版で追加
  | 'testing'
  | 'confirmed'
  | 'rejected'
  | 'stale'
  | 'insufficient_data'
  | 'not_testable';

export interface EdgeHypothesis {
  // ... 既存フィールド ...
  
  /** 統合検証レポート(Phase 4c で追加) */
  fullValidationReport?: ConsolidatedValidationReport;
  
  /** 昇格時の LLM 解釈 */
  confirmationInterpretation?: string;
  
  /** 棄却時の LLM 解釈 */
  rejectionInterpretation?: string;
  
  /** 改善提案(LLM 生成) */
  actionableInsights?: string[];
}
```

マイグレーション: 全フィールドオプショナル、既存データ保護。

### 4.12 スケジューラー統合

`src/side-b/jobs/sideBScheduler.ts`

```typescript
// Phase 4b 縮小版で screening_passed になった仮説を日次で検証
schedule('daily_full_validation', '0 4 * * *', async () => {
  const MAX_PER_DAY = 5;  // 検証はコスト重いので控えめ
  const targets = await edgeLedger.findByStatus('screening_passed');
  const limited = targets.slice(0, MAX_PER_DAY);
  
  for (const hyp of limited) {
    try {
      console.log(`[scheduler] Validating hypothesis: ${hyp.id}`);
      await strategistAgent.validate(hyp.id);
      await sleep(10000);  // Python コンテナ保護のためクールダウン
    } catch (error) {
      console.error(`[scheduler] Validation failed for ${hyp.id}:`, error);
    }
  }
});
```

### 4.13 手動トリガー API

`src/side-b/api/validationRoutes.ts`

```typescript
// POST /api/side-b/hypotheses/:id/validate
router.post('/hypotheses/:id/validate', async (req, res) => {
  const { id } = req.params;
  
  try {
    const verdict = await strategistAgent.validate(id);
    res.json({
      success: true,
      verdict: verdict.verdict,
      report: verdict.report,
      interpretation: verdict.interpretation,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

// GET /api/side-b/hypotheses/:id/validation-status
router.get('/hypotheses/:id/validation-status', async (req, res) => {
  // 検証進行中かどうか、完了していれば結果を返す
});

// GET /api/side-b/hypotheses/pending-validation
router.get('/hypotheses/pending-validation', async (req, res) => {
  // screening_passed 状態の仮説一覧(UI 用)
});
```

### 4.14 テスト

**必須テスト**:

TS 側:
- `python_bridge.test.ts`: Docker コンテナとの通信、タイムアウト処理
- `walkForwardTool.test.ts`: Python 経由の WF 実行(Python モックで)
- `monteCarloTool.test.ts`: モンテカルロ計算の正確性
- `buyAndHoldTool.test.ts`: BH 計算の正確性
- `backtester.test.ts`: 並列実行、部分失敗の処理
- `strategist.test.ts`: 昇格判定、LLM 失敗時のフォールバック

Python 側:
- `test_walk_forward.py`: vectorbt(等)実装のユニットテスト
- 既知データセットに対する期待値テスト

**統合テスト**:
- `integration.test.ts`: Phase 4b で materialize された仮説を Phase 4c で検証するエンドツーエンドフロー

---

## 5. 設計上の注意

### 5.1 このフェーズでやらないこと

- UI 実装(Phase 4d)
- 実発注ゲート(Phase 7以降)
- プロンプト進化(Phase 6)
- 進化的探索(Phase 5)
- 仮説の自動再評価(スケジュール再検証は Phase 5-6 で)

### 5.2 Docker 運用の最小原則

- Docker Compose で起動可能な状態を必須
- 本番デプロイは後回し(ローカル動作で十分)
- Dockerfile と docker-compose.yml にコメント必須
- python/README.md に起動手順を明記

### 5.3 Python 選定ライブラリの記録

選定時に必ず `python/README.md` に以下を記録:
- 選ばれたライブラリ名とバージョン
- 選定理由(なぜ vectorbt か、なぜ backtrader ではなかったか等)
- 安定性評価(GitHub Stars, 最終更新、Issue 対応速度)
- 既知の制約や注意点

**将来のライブラリ変更時に判断材料として使う**。

### 5.4 LLM 失敗時のフォールバック

StrategistAgent の LLM 解釈は **必須ではない**。失敗しても検証全体は完了する。以下は絶対守る:
- LLM エラー → コンソールログ記録のみ、検証は継続
- LLM タイムアウト → 解釈なしで判定結果のみ返す
- LLM 不正レスポンス → バリデーション失敗として記録、判定は決定論的に行う

### 5.5 コスト配慮

- 日次検証上限は初期値5件(設定可能にする)
- Python コンテナ起動コストを減らすため、1回のジョブで複数仮説をまとめて処理する実装も検討(ただし並列性より単純さ優先)
- LLM 呼び出しは結果解釈のみ(判定には使わない)

### 5.6 判定基準の可変性

現在の判定基準(過学習スコア<0.3、BH outperformance>0.005 等)は **暫定値**。運用開始後、ユーザーと相談して調整する前提。閾値は設定ファイルまたは環境変数で外部化すること:

```typescript
// src/side-b/config/validationThresholds.ts
export const VALIDATION_THRESHOLDS = {
  walkForward: {
    maxOverfitScore: parseFloat(process.env.WF_MAX_OVERFIT ?? '0.3'),
  },
  buyAndHold: {
    minOutperformance: parseFloat(process.env.BH_MIN_OUTPERFORMANCE ?? '0.005'),
  },
  monteCarlo: {
    p5MinFinalPnl: parseFloat(process.env.MC_P5_MIN_PNL ?? '0'),
  },
  common: {
    minTradeCount: parseInt(process.env.MIN_TRADE_COUNT ?? '20'),
  },
};
```

### 5.7 Side-A 領域への絶対不介入

既存の Side-A コード(`src/services/`, `src/backend/`)は **一切変更しない**。もし Side-A の仕組みを使いたい場合、外部 API 呼び出しに留める。

### 5.8 Python コード品質

Python スクリプトも本番品質を要求する:
- 型アノテーション必須
- ユニットテスト必須(pytest)
- ライブラリのエラーを Python 側で握りつぶさず、TS 側に伝播させる
- ログ出力は stdout/stderr に統一(Docker で拾えるように)

### 5.9 部分成功の扱い

BacktesterAgent で3ツールのうち1-2個が成功した場合:
- 全ツール成功を昇格条件にする(partial success は rejected)
- エラー詳細は rejectionInterpretation に含める
- 後で全ツール成功状態で再試行可能にする(ステータスを `unverified` に戻す機能は将来検討)

---

## 6. 完了報告時に含めること

1. 作成/変更したファイルの一覧
2. 選定した Python ライブラリと選定理由
3. Docker 起動手順と動作確認ログ
4. エンドツーエンドフローの実行ログ:
   - screening_passed な仮説 → 検証実行 → 4ツール並列実行 → 判定 → 昇格 or 棄却
5. 各ツールの実行時間計測(並列性の効果確認)
6. 昇格に成功した仮説の例
7. 棄却された仮説の例と理由別分類
8. 既存テスト全通過の確認
9. LLM コストの概算(1日の日次検証あたり)
10. Phase 4d への引き継ぎメモ(UI が必要とするデータ構造、API 仕様)

---

## 7. レビュー観点

- Docker 環境が起動するか(コマンド1つで稼働確認)
- Python ライブラリの選定理由が妥当か
- 3ツール並列実行が機能するか(1ツール失敗で全体が止まらないか)
- LLM が判定に関与していないか(決定論的ロジックのみで判定か)
- Side-A 領域に一切の変更がないか(git diff で確認)
- 判定閾値が外部化されているか
- Python コードに型とテストがあるか
- 昇格した仮説の例で、4ツール全てが passed になっているか

---

## 8. Phase 4d への引き継ぎ要件

Phase 4d(UI 実装)着手時に必要な情報を、このフェーズで確実に準備する:

- **API エンドポイント一覧**: UI が呼ぶべき API のリストとレスポンス形式
- **ConsolidatedValidationReport の型**: UI が受け取るデータ構造
- **検証進行中状態の判別方法**: Polling または WebSocket どちらの方式で UI に通知するか(推奨: polling)
- **エラー表示用の情報**: ツール別エラー詳細、部分失敗時の UI 表示指針

Phase 4c の完了報告に、これらを「Phase 4d 前提情報」としてまとめること。
