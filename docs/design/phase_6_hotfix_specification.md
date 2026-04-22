# Phase 6 Hotfix 仕様書: パース層堅牢化 + max_tokens 明示化

> **ステータス**: 未実装、設計ドラフト
> **期間目安**: 1-2 日
> **目的**: Phase 6.5 の動作確認で判明した `PromptMutationAgent` / `MetaEvolutionAgent` のパース層脆弱性を修正する
> **前提**: Phase 6.5 完了(OpenRouter 接続層は正常稼働)

---

## 0. 背景

Phase 6.5 の手動トリガー動作確認で以下が判明:

### 問題1: コードフェンス正規表現の誤マッチ

`PromptMutationAgent.parseProposalArray` および `MetaEvolutionAgent.parseProposalJson` は以下の順序でパースを試みる:

```ts
const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
const body = (fence ? fence[1] : content).trim();
const data = JSON.parse(body);
```

**誤マッチ例**: LLM が「プレーンな JSON 配列」を返し、かつその `"content"` フィールドの中に ``` ``` ``` を含むマークダウン記法(Markdown コードフェンスの例示など)が混入している場合、正規表現が本文中の一部を fence として誤認し、壊れた断片を JSON.parse に渡して失敗する。

Phase 6.5 検証時の実例(Sonnet 4.6 応答):
```
[
  {
    "version": "1.1.0-mut-a",
    "content": "# テストエージェント\n\n## 出力形式\n\n```json\n{ \"value\": ... }\n```",
    ...
  }
]
```
→ 正規表現が `content` 内の `` ```json ... ``` `` をマッチさせ、断片 `{ \"value\": ...}` を parse に渡す → 失敗

### 問題2: max_tokens 未指定による応答打ち切り

`AIProvider.chat()` (src/side-b/agent/aiProvider.ts:107-122) は `max_tokens` をリクエストボディに含めない:

```ts
const body: Record<string, unknown> = {
  model: this.model,
  messages,
  temperature,
};
```

プロバイダーの既定 `max_tokens` (Anthropic 経由だと比較的短い) に引っかかり、長い JSON 出力(MetaEvolution の再編成提案など)が **途中で切れて Unterminated string になる**。

Phase 6.5 検証時の実例(Opus 4.7 応答):
- 1951 文字で途中終了
- `Unterminated string in JSON at position 1370` で JSON.parse 失敗

---

## 1. このフェーズのゴール

- Phase 6 のエージェント群(`PromptMutationAgent`, `MetaEvolutionAgent`, および同じパターンを持つ `MutationAgent` / `CrossoverAgent`)のパース層が、現実の LLM 応答フォーマットに対して堅牢になる
- LLM 応答が途中で切れるケースを `max_tokens` 明示指定で回避する
- 実 LLM 応答を使ったテストケースを追加し、回帰を防ぐ

---

## 2. 完了条件

- [ ] `parseProposalArray` / `parseProposalJson` の順序を逆転(生 JSON 先、fence 除去は fallback)
- [ ] `AIProvider.chat()` が `max_tokens` をオプションで受け取る(後方互換)
- [ ] エージェント呼出時に適切な `max_tokens` を明示指定
  - MetaEvolutionAgent: 4096
  - PromptMutationAgent: 4096
  - MutationAgent / CrossoverAgent: 4096
  - StrategistAgent: 既存の max_tokens 値を確認、必要なら調整
  - Specialists 3 体: 2048(出力スキーマが小さいため)
- [ ] フェンス正規表現の誤マッチ防止(非貪欲 + ``` の直後に改行 or `json` 必須、等)
- [ ] 実 LLM 応答を模したテストケース追加(PromptMutation / MetaEvolution それぞれで、フェンスなし JSON + 内部に ``` を含むケース、切断されたケース)
- [ ] 既存テスト全通過(回帰ゼロ)

---

## 3. 実装仕様

### 3.1 パース順序の逆転

**現行**:
```ts
function parseProposalArray(content: string): PromptMutationProposal[] {
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fence ? fence[1] : content).trim();
  const data = JSON.parse(body) as unknown;
  // ...
}
```

**修正後**:
```ts
function parseProposalArray(content: string): PromptMutationProposal[] {
  const trimmed = content.trim();
  // 1. 先に生の JSON として parse を試みる
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    // 2. 失敗したらフェンス除去に fallback
    const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
    //                    ^                                 ^ 応答全体が fence で包まれているもののみ
    //                    ^-- 行頭アンカー追加で本文中の誤マッチを防ぐ
    if (!fence) throw new Error('JSON として解釈できない');
    try {
      data = JSON.parse(fence[1]!.trim());
    } catch {
      // 3. 更に fallback: 最初の [ / { から最後の ] / } を切り出して parse
      const bracket = extractOutermostBrackets(trimmed);
      if (!bracket) throw new Error('JSON 境界を特定できない');
      data = JSON.parse(bracket);
    }
  }
  // 後段のバリデーションは現行のまま
  if (!Array.isArray(data)) throw new Error('応答は JSON 配列である必要があります');
  // ...
}
```

`MetaEvolutionAgent.parseProposalJson` にも同じ順序変更を適用する。

**`extractOutermostBrackets()` の仕様**: 応答が生テキスト + JSON 混在のとき、最初の `[` or `{` から対応する最後の `]` or `}` までを取り出す。ネストのバランスを考慮して適切に抜き出す。

### 3.2 `AIProvider.chat()` の `max_tokens` 対応

**現行シグネチャ**:
```ts
async chat(
  messages: ChatMessage[],
  mcpTools?: McpToolDefinition[],
  temperature = 0.3,
): Promise<AIResponse>
```

**修正後**(後方互換、引数追加のみ):
```ts
export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: McpToolDefinition[];
}

async chat(
  messages: ChatMessage[],
  options?: ChatOptions | McpToolDefinition[],
  temperature?: number,
): Promise<AIResponse>
```

**判断点**: 既存呼び出しは `ai.chat(msg, undefined, 0.4)` のような形(2番目引数が tools、3番目が temperature)。型安全に破壊しないためには:
- **選択肢A**: オーバーロードで新 shape `{ options?: ChatOptions }` を追加
- **選択肢B**: 引数を破壊的に変更して全 caller を更新(4-5 ファイル)

どちらを採るかは実装時にユーザーと相談。

**呼出側(例)**:
```ts
// MetaEvolutionAgent.propose()
const res = await this.ai.chat(
  [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ],
  { maxTokens: 4096, temperature: 0.4 },
);
```

### 3.3 max_tokens のエージェント別既定値

| エージェント | 推奨 max_tokens | 根拠 |
|---|---|---|
| MetaEvolutionAgent | 4096 | 再編成提案の JSON が長い(analysis + proposals 配列 + initialPrompt 本文) |
| PromptMutationAgent | 4096 | 3 案分の full content を返す |
| MutationAgent / CrossoverAgent | 4096 | StrategyDSL 配列を複数返す |
| HypothesisGeneratorAgent | 2500 (既存) | 現行設定を維持 |
| StrategistAgent | 現行確認 | 現状を確認後判断 |
| Trend/Oscillator/VolatilityVolumeSpecialist | 2048 | 出力スキーマが小さい |

### 3.4 テストケース追加

**新規テストケース (実 LLM 応答パターンを模したもの)**:

```ts
describe('PromptMutationAgent parseProposalArray 堅牢化', () => {
  it('プレーン JSON 配列で、内部に ``` を含むマークダウンが混入していてもパースできる', () => {
    const response = `[
  {
    "version": "v1",
    "content": "\\n\\n## 出力形式\\n\\n\\u0060\\u0060\\u0060json\\n{...}\\n\\u0060\\u0060\\u0060",
    "notes": "test"
  }
]`;
    const result = parseProposalArray(response);
    expect(result.length).toBe(1);
    expect(result[0].content).toContain('出力形式');
  });

  it('応答全体が ```json フェンスで囲まれていてもパースできる', () => {
    const response = '```json\n[{"version":"v1","content":"...","notes":"x"}]\n```';
    const result = parseProposalArray(response);
    expect(result.length).toBe(1);
  });
});

describe('MetaEvolutionAgent parseProposalJson 堅牢化', () => {
  it('max_tokens 切断で Unterminated string になったら null を返す(例外を投げない)', () => {
    const truncated = '```json\n{"analysis":{"currentAgents":["x"],"coverageGaps":["y"';
    const result = parseProposalJson(truncated);
    expect(result).toBeNull();
  });
});
```

---

## 4. 触るファイル

### 新規/改修

- `src/side-b/agents/PromptMutationAgent.ts` (parseProposalArray 順序逆転)
- `src/side-b/agents/MetaEvolutionAgent.ts` (parseProposalJson 同上 + max_tokens 明示)
- `src/side-b/agent/aiProvider.ts` (max_tokens 引数対応)
- `src/side-b/agents/MutationAgent.ts` / `CrossoverAgent.ts` (parse 順序逆転 + max_tokens 明示)
- 呼び出し側: 必要に応じて `ai.chat(msg, { maxTokens: N })` 形式に更新

### テスト

- `src/side-b/tests/agents/metaEvolution.test.ts` (新ケース追加)
- `src/side-b/tests/prompts/promptMutationAgent.test.ts` (新規 or 既存へ追加)
- `src/side-b/tests/agent/aiProvider.test.ts` (max_tokens 引数テスト、なければ新規)

### 触らない

- `src/side-b/agents/specialists/*` (JSON パースは `parseJsonLoose` を使っており既に堅牢、最小改修で済む可能性大、実装時に確認)
- 既存 StrategistAgent / DiscoveryAgent / HypothesisGeneratorAgent の **核心ロジック** (既に独自 `fetch` 実装で max_tokens 指定済みのはず、確認のみ)
- Side-A 全般
- Phase 6.5 で変更した `src/config/index.ts`

---

## 5. スコープ外

- LLM プロバイダー自体の変更(OpenRouter → 他への切替は別フェーズ)
- エージェント別モデル割当の変更
- プロンプト自体の書き換え
- パースの完全 schema-driven 化 (zod schema で受ける設計は将来の別フェーズ)

---

## 6. 実装順序

1. `aiProvider.ts` の `max_tokens` 引数対応(後方互換 or 破壊的変更の判断)
2. `parseProposalArray` / `parseProposalJson` の順序逆転 + 正規表現修正
3. MetaEvolutionAgent / PromptMutationAgent / MutationAgent / CrossoverAgent の呼出側で `maxTokens` 明示
4. 実応答を模したテストケース追加
5. 既存テスト全通過確認
6. 可能なら実 OpenRouter で再度手動トリガー動作確認(Phase 6.5 の手順を再実行)

---

## 7. リスク

- パース順序の逆転で、**意図的にフェンスで囲まれた応答** がある場合に fallback 経路が走る → 挙動は等価だがログに残る warning 等の扱いを検討
- `max_tokens` を大きくするとコストが増える → 実運用での token 使用量を監視し、必要なら下方修正

---

## 8. 将来拡張

- LLM 応答を zod schema で直接受ける設計への移行(JSON parse + validator を 1 関数に統合)
- リトライ時にプロンプトを微調整する機構(「前回は途中で切れたのでより短く」等)
