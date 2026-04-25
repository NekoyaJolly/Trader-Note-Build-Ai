# Phase 6.7 — プロンプト合成（`getCompositeActive` 一本化）の方針

> 出典: [phase_6_7a_infrastructure.md](phase_6_7a_infrastructure.md) §1.2, §4 / [loader.ts](../../src/side-b/prompts/loader.ts) コメント  
> 日付: 2026-04-25

---

## 状況

- **Registry API** には `PromptRegistry.getCompositeActive(agentName, macros?)` があり、**`__global__` の DB active + 各エージェントの content** に `expandMacros` を適用して連結する（[PromptRegistry.ts](../../src/side-b/prompts/registry/PromptRegistry.ts)）。
- **実行時の多くのエージェント**は、代わりに  
  - `loadPromptWithGlobal`（`__global__.md` + ファイル直読み）、または  
  - Registry から取った 1 本の `content` に `prependGlobalPromptFromFile` をかける  
  経路を使っている。`getCompositeActive` を**本番の全 12 本で直に呼ぶ**形には揃っていない。

## 方針（結論）

| 項目 | 判定 |
|------|------|
| **Phase 6.7b（BT 層）のブロッカーにするか** | **否**。マクロ展開とグローバル合成は既存の二経路で満たしており、BT/DSL/Validation とは直交する。 |
| **いつ揃えるか** | **6.7c 以前**（Strategy Thinker の Registry 接続・プロンプト改訂）に合わせて、`getCompositeActive` への寄せ or **Registry の `__global__` active を prepend 系で優先**する統一を検討するのが自然。 |
| **リスク** | DB の `__global__` 更新と `__global__.md` の**二重管理**。運用でどちらを真実のソースにするかを 6.7c タスクに含める。 |

## 補足

- 厳格に「6.7a 完了票の check の文言」と一致させる必要がある場合、**小さな follow-up タスク**（全エージェントの 1 箇所に `getCompositeActive` 導入、または専用ラッパー 1 本に集約）を切る。  
- 本件は [phase_6_7b_strategy_dsl_audit.md](phase_6_7b_strategy_dsl_audit.md) の分析とも独立。

## 履歴

| 日付 | 内容 |
|------|------|
| 2026-04-25 | 初版（任意 To-do: optional-composite の記録） |
