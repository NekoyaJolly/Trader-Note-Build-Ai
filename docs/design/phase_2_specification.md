# フェーズ2 発注仕様書: AIロール分化の最小版

> **期間目安**: 1〜2週間
> **目的**: LLMエージェントを専門役割に分化させ、Strategy Thinker の思考構造を変える
> **前提**: フェーズ1 完了済み(並列レンズ基盤が稼働)
> **前提読み物**: `docs/design/DESIGN_DOC_autonomous_trading_architecture.md` のセクション1(設計哲学)と セクション5(エージェント設計)

---

## 1. このフェーズのゴール

現在の Strategy Thinker AI を「戦略を1つ出すAI」から「仮説3つ → 自己反証 → 戦略化する3段階AI」に進化させる。同時に、戦略を叩く専任エージェント「Devil's Advocate」を新設する。

**このフェーズで最も重要なのは**、既存の `CORE_TRADING_RULES` の「インジケーター優先順位」を撤廃し、代わりに「判断品質のメタルール」を注入すること。これによりAIの思考パターンが固定化から脱却する。

---

## 2. 完了条件

以下の全てを満たす:

- [x] 各エージェントのシステムプロンプトが `src/side-b/prompts/*.md` に外部ファイル化されている
- [x] `CORE_TRADING_RULES` の「インジケーター優先順位」が撤廃され、「判断品質メタルール」に置き換わっている
- [x] Strategy Thinker が「仮説 → 反証 → 戦略化」の3ステップで動作する
- [x] 新エージェント `DevilsAdvocateAgent` が実装され、Strategy Thinker の出力を叩く
- [x] PDCA ループに Devil's Advocate 呼び出しが組み込まれている（実装場所: `aiOrchestrator.ts` の Plan AI 呼び出し直後。pdcaLoop.ts は状態機械のみで planAI を直接呼ばないため、実際の呼び出し元である orchestrator に配置。PDCA サイクルの一部として機能する）
- [x] Strategy Thinker の出力に `indicatorsUsed` / `indicatorsIgnored` / `patternLabel` / `multipleTestingDefense` フィールドが追加されている
- [x] 既存のテストが全て通る（Side-B 全 292 テスト passing）
- [x] 新ロジックにユニットテストが追加されている（loader.test.ts 7件 + devilsAdvocate.test.ts 12件）

---

## 3. 触っていいファイル / 触ってはいけないファイル

### 触っていい(新規作成)
- `src/side-b/prompts/strategy_thinker.md` (新規、既存プロンプト移植)
- `src/side-b/prompts/devils_advocate.md` (新規)
- `src/side-b/prompts/market_observer.md` (新規、参考文書)
- `src/side-b/agents/DevilsAdvocateAgent.ts` (新規)
- `src/side-b/tests/agents/devilsAdvocate.test.ts` (新規)

### 触っていい(改修)
- `src/side-b/services/planAIService.ts` ― 3ステップ化、プロンプト外部ファイル化
- `src/side-b/knowledge/indicatorKnowledge.ts` ― `CORE_TRADING_RULES` 書き換え
- `src/side-b/agent/pdcaLoop.ts` ― Devil's Advocate の呼び出し統合
- `src/side-b/models/tradePlan.ts` ― 新フィールド追加(オプショナル)

### 触ってはいけない
- `src/side-b/lenses/` 以下(フェーズ1の成果物、変更禁止)
- `src/side-b/services/researchAIService.ts` (このフェーズでは Research は変更しない)
- `src/side-b/services/reflectionAIService.ts` (このフェーズでは Reflection は変更しない)
- UI 関連のコード

---

## 4. 実装仕様

### 4.1 CORE_TRADING_RULES の書き換え

`src/side-b/knowledge/indicatorKnowledge.ts` の `CORE_TRADING_RULES` を以下の内容に置き換える:

```typescript
export const CORE_TRADING_RULES = `
## トレーディング判断品質ルール

### 単独判断の禁止
どのインジケーター・レンズも単独で売買判断の根拠にしてはならない。最低2系統(異なるカテゴリ)の合意を要求する。

### 採用理由の明示義務
使用したインジケーター/レンズについて、なぜそれを選んだかを必ず明記する。同時に、使わなかった主要なインジケーター/レンズについてもなぜ使わなかったかを明記する。

### オッカムの剃刀の原則
同じトレード判断を異なる指標の組み合わせで説明できる場合、最も少ない指標数で説明できる仮説を優先する。複雑な組み合わせは、より単純な説明が不可能である時のみ採用する。

### 矛盾の取り扱い
インジケーター同士が矛盾する場合、それは「見送りの理由」ではなく「解釈が必要な市場状態」として扱う。「この矛盾が示す市場状態は何か」を必ず言語化する。

### 多重検定問題への自覚
多数のインジケーター・レンズの中から組み合わせを試せば、偶然有意に見えるものが必ず出現する。あなたが見つけたパターンが偶然ではないと示せる理由(過去の再現事例、市場構造からの説明、等)を述べられない場合、そのパターンをエッジとして採用してはならない。

### 「エントリーしない」判断の価値
全てのトレードに参加する必要はない。条件が揃わない場合に見送る判断は、悪い判断よりはるかに価値が高い。

### 禁止事項
- ADXの値だけでトレンド方向を判断すること(ADXは強度のみ)
- ATRの値だけで方向性を判断すること(ATRは大きさのみ)
- 1回のバックテスト結果でエッジを確定すること(N=1は棄却)
- 「なんとなくそう思う」「チャートパターンが綺麗」等、言語化不能な理由で判断すること
`.trim();
```

**重要**: 既存の「インジケーター優先順位 1〜7」を完全削除する。これは意図的な撤廃。

`INDICATOR_CONTEXT` (個別インジケーターの解説)はそのまま残す。これは「順位」ではなく「各指標の個性の説明」なので価値がある。

### 4.2 エージェントのプロンプト外部ファイル化

#### `src/side-b/prompts/strategy_thinker.md` の作成

既存の `planAIService.ts` 内にハードコードされているシステムプロンプトを、このファイルに抽出する。その上で以下の改修を加える:

- 出力を「単一戦略」から「3ステップ(仮説生成 → 自己反証 → 戦略化)」に変更
- 新出力フィールドの要求を追加

プロンプトの骨子:

```markdown
# Strategy Thinker システムプロンプト

あなたは自律型トレーディングAIの戦略思考エンジンです。
Market Analyst の分析結果と並列レンズの出力に基づいて、
以下の3ステップで思考してください。

## ステップ1: 仮説生成
現在の市場状況に対して、「もし〜なら〜という偏りがある」という形の
検証可能な仮説を最低3個生成してください。

仮説の条件:
- 特定の時間帯・レベル・状態で発動する具体的な条件を持つ
- 期待される価格挙動の方向と大きさが明示される
- なぜその偏りが存在するかを市場構造から説明できる

## ステップ2: 自己反証
ステップ1で出した仮説それぞれについて、それが成立しない具体的なシナリオを
最低2つずつ挙げてください。反証が容易な仮説は棄却します。

## ステップ3: 戦略化
反証に耐えた仮説のうち、最も確度が高いものを戦略に落とし込みます。
戦略には以下を必ず含めてください:
- エントリー条件(機械判定可能)
- ストップロス(テクニカル根拠あり)
- テイクプロフィット(RR比 1.5 以上推奨)
- 無効化条件

{{CORE_TRADING_RULES}}
{{MACRO_ENVIRONMENT_RULES}}
{{MTF_ANALYSIS_RULES}}

## 出力形式
以下の JSON 形式で出力:

\`\`\`json
{
  "hypotheses": [
    {
      "id": "h1",
      "statement": "...",
      "reasoning": "...",
      "expectedBehavior": "..."
    }
  ],
  "selfRefutation": [
    {
      "hypothesisId": "h1",
      "counterScenarios": ["...", "..."]
    }
  ],
  "marketAnalysis": { /* 既存と同じ構造 */ },
  "scenarios": [
    {
      /* 既存と同じ構造 */
      "indicatorsUsed": ["RSI", "BB"],
      "indicatorsIgnored": ["MACD", "Stochastic"],
      "reasonForSelection": "なぜこの組み合わせを選んだか",
      "reasonForIgnoring": "なぜ他を使わなかったか",
      "patternLabel": "レンジ下限反発",
      "multipleTestingDefense": "この判断が偶然ではない理由"
    }
  ],
  "overallConfidence": 0-100,
  "warnings": [...]
}
\`\`\`
```

#### `src/side-b/prompts/devils_advocate.md` の作成

```markdown
# Devil's Advocate システムプロンプト

あなたは反証専任のトレーディングアナリストです。
Strategy Thinker が提案した戦略を受け取り、その戦略が失敗する
具体的なシナリオを生成してください。

## あなたの役割
- 戦略を採用してはならない
- 代替戦略を提案してはならない  
- ただ、戦略の弱点を見つけることだけに集中する

## タスク
渡された戦略について以下を出力してください:

1. この戦略が負ける具体シナリオを3つ
   (それぞれのシナリオが実現する条件を明示)
2. 戦略の前提仮定のうち、最も脆弱な仮定を1つ
3. 改善提案(戦略を修正すべきか、見送るべきか)

## 出力形式
\`\`\`json
{
  "failureScenarios": [
    {
      "description": "...",
      "triggerConditions": "...",
      "estimatedLikelihood": "low" | "medium" | "high"
    }
  ],
  "weakestAssumption": {
    "description": "...",
    "whyVulnerable": "..."
  },
  "recommendation": {
    "action": "proceed" | "modify" | "abandon",
    "rationale": "...",
    "suggestedModifications": ["..."]
  }
}
\`\`\`

出力は必ず日本語で、有効なJSONのみ。
```

### 4.3 プロンプトファイルの読み込み機構

`src/side-b/prompts/` にあるマークダウンファイルを読み込むユーティリティを作る:

`src/side-b/prompts/loader.ts`

```typescript
import fs from 'fs';
import path from 'path';

const PROMPTS_DIR = path.join(__dirname);

// マクロ展開用の辞書
export interface PromptMacros {
  CORE_TRADING_RULES?: string;
  MACRO_ENVIRONMENT_RULES?: string;
  MTF_ANALYSIS_RULES?: string;
  // 将来追加される可能性
}

export function loadPrompt(name: string, macros?: PromptMacros): string {
  const filePath = path.join(PROMPTS_DIR, `${name}.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt file not found: ${name}`);
  }
  
  let content = fs.readFileSync(filePath, 'utf-8');
  
  if (macros) {
    for (const [key, value] of Object.entries(macros)) {
      const placeholder = `{{${key}}}`;
      content = content.replaceAll(placeholder, value ?? '');
    }
  }
  
  return content;
}
```

### 4.4 planAIService.ts の改修

既存の `planAIService.ts` を以下のように改修:

1. システムプロンプトを `loadPrompt('strategy_thinker', { CORE_TRADING_RULES, ... })` に置き換える
2. ユーザープロンプト構築部分は既存ロジックを維持(レンズ出力の注入はフェーズ3以降)
3. 出力JSONのスキーマ(zod)に新フィールドを追加:
   - `hypotheses`: 配列、オプショナル(後方互換のため)
   - `selfRefutation`: 配列、オプショナル
   - シナリオ内の `indicatorsUsed`, `indicatorsIgnored`, `reasonForSelection`, `reasonForIgnoring`, `patternLabel`, `multipleTestingDefense` をオプショナル追加

**重要**: 既存の呼び出し側コードが壊れないよう、新フィールドは全てオプショナル。

### 4.5 DevilsAdvocateAgent の実装

`src/side-b/agents/DevilsAdvocateAgent.ts`

```typescript
export class DevilsAdvocateAgent {
  private apiKey: string;
  private baseURL: string;
  private model: string;
  
  constructor(config: { apiKey: string; baseURL: string; model: string }) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.model = config.model;
  }
  
  async critique(strategy: AITradeScenario, marketContext: MarketAnalysis): Promise<DevilsAdvocateOutput> {
    const systemPrompt = loadPrompt('devils_advocate');
    const userPrompt = this.buildUserPrompt(strategy, marketContext);
    
    // OpenAI互換APIを呼び出す(既存 planAIService の呼び出し方に準拠)
    const response = await this.callAI(systemPrompt, userPrompt);
    
    return validateDevilsAdvocateOutput(response);
  }
  
  private buildUserPrompt(strategy: AITradeScenario, context: MarketAnalysis): string {
    return `
## 提案された戦略
${JSON.stringify(strategy, null, 2)}

## 市場状況
${JSON.stringify(context, null, 2)}

この戦略の弱点を3つ、最も脆弱な仮定を1つ、改善提案を出してください。
`;
  }
  
  private async callAI(systemPrompt: string, userPrompt: string): Promise<unknown> {
    // 既存の callAI パターンに準拠
  }
}
```

出力の型定義:

```typescript
export interface DevilsAdvocateOutput {
  failureScenarios: Array<{
    description: string;
    triggerConditions: string;
    estimatedLikelihood: 'low' | 'medium' | 'high';
  }>;
  weakestAssumption: {
    description: string;
    whyVulnerable: string;
  };
  recommendation: {
    action: 'proceed' | 'modify' | 'abandon';
    rationale: string;
    suggestedModifications?: string[];
  };
}
```

### 4.6 PDCA ループへの統合

`src/side-b/agent/pdcaLoop.ts` の Strategy Thinker 呼び出し箇所の直後に、Devil's Advocate 呼び出しを追加:

```typescript
// 既存: Strategy Thinker で戦略生成
const plan = await planAIService.generatePlan(...);

// 新規追加: Devil's Advocate でレビュー
if (plan.scenarios && plan.scenarios.length > 0) {
  for (const scenario of plan.scenarios) {
    const critique = await devilsAdvocateAgent.critique(scenario, plan.marketAnalysis);
    
    // critique.recommendation.action が 'abandon' の場合、
    // そのシナリオの confidence を大きく下げる(または除外する)
    if (critique.recommendation.action === 'abandon') {
      scenario.confidence = Math.min(scenario.confidence, 20);
      scenario.warnings = [...(scenario.warnings ?? []), 
        `Devil's Advocate: ${critique.recommendation.rationale}`];
    }
    
    // critique を AgentMemory やログに保存(フェーズ4以降で活用)
  }
}
```

### 4.7 テスト

`src/side-b/tests/agents/devilsAdvocate.test.ts`

- モックされた AI レスポンスに対して正しくパースできるか
- 不正な JSON レスポンスに対してエラーを返すか
- `recommendation.action` が 3 種類のいずれかであることのバリデーション

`src/side-b/tests/prompts/loader.test.ts`

- プロンプトファイルが正しく読み込まれるか
- マクロ展開が機能するか
- 存在しないプロンプト名でエラーになるか

---

## 5. 設計上の注意

### 5.1 このフェーズでやらないこと(意図的な制限)

- レンズ出力を Strategy Thinker プロンプトに注入すること(フェーズ3で)
- Hypothesis Generator を独立エージェント化すること(フェーズ4で)
- Edge Validator の実装(フェーズ4で)
- Discovery AI の実装(フェーズ4で)
- エージェント間の会話ループを組むこと(今回は1回のレビューのみ)

### 5.2 既存プロンプトの扱いに関する注意

`planAIService.ts` 内の既存システムプロンプトには `MACRO_ENVIRONMENT_RULES` や `MTF_ANALYSIS_RULES` の注入がある。これらは維持する。撤廃対象は `CORE_TRADING_RULES` の「優先順位」部分のみ。

### 5.3 3ステップ思考の実装注意

LLMは「1回の呼び出しで3ステップ全て」でも「3回の呼び出しで分けて」でも実装可能。**このフェーズでは1回の呼び出し内で3ステップを出力させる** 方針にする。理由:
- トークンコストの節約
- レイテンシ削減
- 既存の呼び出しフローを大きく変えない

将来、プロンプト進化で「3回分割したほうが精度が上がる」と判明したら変更する。

### 5.4 Devil's Advocate の confidence 減衰ルール

`abandon` 判定時に confidence を 20 以下に落とす、という仕様は暫定。実運用で調整する前提。過度に慎重になりすぎて常にノートレードになる場合はこの数値を見直す。

---

## 6. 完了報告時に含めること

1. 作成/変更したファイルの一覧
2. 追加したテストの実行結果
3. 既存テストの実行結果(全て通ることの確認)
4. 新旧の Strategy Thinker 出力のサンプル比較(同じ入力に対して)
5. Devil's Advocate の実行サンプル出力
6. `CORE_TRADING_RULES` の新旧比較
7. 次フェーズ(フェーズ3)に向けた引き継ぎメモ

---

## 7. レビュー観点

- Strategy Thinker の出力が実際に「仮説 → 反証 → 戦略化」の構造を持っているか
- 新フィールド(`indicatorsUsed` 等)が埋まっているか
- Devil's Advocate が的確に弱点を指摘しているか(LLMの出力品質は質的評価)
- 既存のトレード1サイクルが従来通り動作するか
- 過度にノートレード判定が増えていないか
