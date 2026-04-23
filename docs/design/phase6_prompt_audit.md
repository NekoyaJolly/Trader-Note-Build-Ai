# Phase 6 プロンプト呼び出し実態調査

> 調査日: 2026-04-24
> 調査対象: `src/` 配下全体(テスト系 `*.test.ts` / `__tests__/` 除外)
> 目的: Phase 6 プロンプト見直しの前提情報を確定する

---

## TL;DR(最重要)

1. **seed は 13 エージェントではなく 12 エージェント**。`market_observer` は seed 対象外 + 呼び出しゼロ = **完全死蔵**
2. **Registry 経由の呼び出しは 4 エージェントのみ**(HypothesisGenerator + Trend/Oscillator/VolatilityVolume Specialists)。それ以外 8 エージェントは **loadPrompt 直読み** のまま
3. **マクロ展開を使っているのは `planAIService.ts` (= StrategyThinker) の 1 箇所のみ**(`CORE_TRADING_RULES` / `MACRO_ENVIRONMENT_RULES` / `MTF_ANALYSIS_RULES`)
4. **マクロプレースホルダを含む .md は 2 件**: `strategy_thinker.md` と `market_observer.md`。後者は死蔵のためマクロも未使用
5. **重大な整合性問題**: HypothesisGenerator / Specialists が Registry 経由でプロンプトを取得した場合、**マクロ展開はされない**(Registry には展開前の本文がそのまま保存されている可能性 + loader.loadPrompt() の macro 展開 path を通らない)

---

## エージェント稼働状況マップ

| agentName | seed済み | 呼び出し箇所 | 取得経路 | マクロ使用 | 判定 |
|---|---|---|---|---|---|
| `strategy_thinker` | ✓ | `services/planAIService.ts:337` | **loadPrompt のみ**(Registry 未接続) | CORE_TRADING_RULES / MACRO_ENVIRONMENT_RULES / MTF_ANALYSIS_RULES | **現役**、マクロあり |
| `strategist` | ✓ | `agents/StrategistAgent.ts:171` | **loadPrompt のみ** | なし | 現役 |
| `devils_advocate` | ✓ | `agents/DevilsAdvocateAgent.ts:167` | **loadPrompt のみ** | なし | **現役**(orchestrator:436 で使用確認) |
| `discovery` | ✓ | `agents/DiscoveryAgent.ts:256` | **loadPrompt のみ** | なし | 現役 |
| `hypothesis_generator` | ✓ | `agents/HypothesisGeneratorAgent.ts:281`(fallback)+ `.content` を Registry から | **Registry 主 + loadPrompt fallback** | なし | **現役、Phase 6.6 で Registry 接続済み** |
| `trend_specialist` | ✓ | `agents/specialists/TrendSpecialist.ts:55`(fallback)+ Registry | **Registry 主 + loadPrompt fallback** | なし | **現役、Phase 6.6 で Registry 接続済み** |
| `oscillator_specialist` | ✓ | `agents/specialists/OscillatorSpecialist.ts:51`(fallback)+ Registry | 同上 | なし | 同上 |
| `volatility_volume_specialist` | ✓ | `agents/specialists/VolatilityVolumeSpecialist.ts:46`(fallback)+ Registry | 同上 | なし | 同上 |
| `mutation` | ✓ | `agents/MutationAgent.ts:59, 90` | **loadPrompt のみ** | なし | 現役(EvolutionLoop 内) |
| `crossover` | ✓ | `agents/CrossoverAgent.ts:41` | **loadPrompt のみ** | なし | 現役(EvolutionLoop 内) |
| `prompt_mutation` | ✓ | `agents/PromptMutationAgent.ts:109` | **loadPrompt のみ** | なし | 現役(promptEvolutionJob から) |
| `meta_evolution` | ✓ | `agents/MetaEvolutionAgent.ts:193` | **loadPrompt のみ** | なし | 現役(metaEvolutionCli 経由、手動) |
| `market_observer` | ✗ | **呼び出しなし** | - | .md 内に `{{CORE_TRADING_RULES}}` はあるが注入側なし | **完全死蔵**(seed 対象外 + 使用箇所ゼロ) |

---

## マクロ注入の実態

### CORE_TRADING_RULES

- **定義箇所**: `src/side-b/knowledge/indicatorKnowledge.ts:23`(export)
- **注入経路**:
  1. `services/planAIService.ts:337-341`: `loadPrompt('strategy_thinker', { CORE_TRADING_RULES, MACRO_ENVIRONMENT_RULES, MTF_ANALYSIS_RULES })` で `{{...}}` プレースホルダを展開
  2. `services/researchAIService.ts:301`: テンプレ文字列に `${CORE_TRADING_RULES}` を直接埋め込み(Research AI 独自、.md 経由ではない)
  3. `agent/agentLoop.ts:91`: テンプレ文字列に直接埋め込み(汎用 AgentLoop、PDCA ループ経由だが **現状 PDCALoop 無効**)
- **注入先プロンプト**: `strategy_thinker.md` のみ(`{{CORE_TRADING_RULES}}` を持つ .md のうち、実際に注入されるのはこの 1 件)

### MACRO_ENVIRONMENT_RULES

- **定義**: `src/side-b/knowledge/macroKnowledge.ts:64`
- **注入経路**: `services/planAIService.ts:337-341` のみ
- **注入先**: `strategy_thinker.md` のみ

### MTF_ANALYSIS_RULES

- **定義**: `src/side-b/knowledge/mtfKnowledge.ts:44`
- **注入経路**: `services/planAIService.ts:337-341` のみ
- **注入先**: `strategy_thinker.md` のみ

### マクロプレースホルダを持つ .md ファイル

- `src/side-b/prompts/strategy_thinker.md:71,73,75` → **planAIService から注入されている、現役**
- `src/side-b/prompts/market_observer.md:28` → **注入側なし、死蔵**

---

## PromptRegistry vs loadPrompt の使い分け

### loadPrompt を直接呼んでいる箇所(12 件)

| ファイル | 用途 | マクロ展開 |
|---|---|---|
| `services/planAIService.ts:337` | **メインのプロンプト取得** | ✓ 3 種類注入 |
| `agents/StrategistAgent.ts:171` | メイン | ✗ |
| `agents/DevilsAdvocateAgent.ts:167` | メイン | ✗ |
| `agents/DiscoveryAgent.ts:256` | メイン | ✗ |
| `agents/MutationAgent.ts:59, 90` | メイン | ✗ |
| `agents/CrossoverAgent.ts:41` | メイン | ✗ |
| `agents/PromptMutationAgent.ts:109` | メイン | ✗ |
| `agents/MetaEvolutionAgent.ts:193` | メイン | ✗ |
| `agents/HypothesisGeneratorAgent.ts:281` | **fallback のみ**(Registry 未接続時) | ✗ |
| `agents/specialists/TrendSpecialist.ts:55` | fallback のみ | ✗ |
| `agents/specialists/OscillatorSpecialist.ts:51` | fallback のみ | ✗ |
| `agents/specialists/VolatilityVolumeSpecialist.ts:46` | fallback のみ | ✗ |

### Registry (`getActive` / `getExperimental`) 経由(4 エージェント)

| ファイル | 呼び出し |
|---|---|
| `agents/HypothesisGeneratorAgent.ts:343,354` | `registry.getActive/getExperimental('hypothesis_generator')` |
| `agents/specialists/specialistCommon.ts:140,149` | 3 Specialists が `runSpecialistWithVariant` 経由で使用 |
| `prompts/registry/seed.ts:101` | seed 処理(管理用) |
| `prompts/registry/promptEvolutionJob.ts:94,103` | 月次プロンプト進化ジョブ |
| `prompts/registry/approveCli.ts:52,53` | CLI 管理 |

### **重要な整合性問題**: Registry 経由はマクロ展開されない

- `loader.loadPrompt(name, macros)` は `{{KEY}}` を辞書値で置換する
- しかし `PromptRegistry.getActive` / `getExperimental` が返すのは **`content` フィールドをそのまま** 。マクロ展開ロジックを通らない
- したがって:
  - **`strategy_thinker` を Phase 6.6 流に Registry 経由で取得する日が来ると、`{{CORE_TRADING_RULES}}` が未展開のまま LLM に渡る**
  - 現状 `strategy_thinker` は Registry 未接続なのでこの問題は潜在化しているだけ
  - 既に Registry 接続済みの `hypothesis_generator` / 3 Specialists は元々マクロを使っていないので偶発的に無事故

### PromptRegistry instantiation の棚卸し

| 場所 | インスタンス生成方法 |
|---|---|
| `agents/MetaEvolutionAgent.ts:184` | `options.registry ?? new PromptRegistry(this.prisma)` |
| `agents/HypothesisGeneratorAgent.ts:252` | **遅延 getter**(`_registry = new PromptRegistry()` on first access) |
| `agents/specialists/specialistCommon.ts:129` | `options.registry ?? new PromptRegistry()` |
| `prompts/registry/seed.ts:85` | デフォルト引数で新規生成 |
| `prompts/registry/promptEvolutionJob.ts:74` | `options.registry ?? new PromptRegistry()` |
| `prompts/registry/approveCli.ts:145` | CLI 内で新規生成 |

---

## 死蔵プロンプト候補

### 確定: `market_observer.md`

- **seed 対象外**(`DEFAULT_SEED_ENTRIES` に無し)
- **コード内呼び出しゼロ**
- ファイル内に `{{CORE_TRADING_RULES}}` マクロプレースホルダあり(注入側なし)
- **アクション候補**:
  - 削除する(`prompts/market_observer.md` を消す)
  - 代わりに「参考ファイル」として明示コメントを追加して残す(現状コメントあるが曖昧)
  - `LensAggregator` を将来 LLM 化する場合の種として温存するかを判断

### 疑いなし、明確に現役のもの: 他 12 エージェントすべて

Phase 6.6 の「variantSelector 未接続エージェントは loadPrompt で動く」設計が効いているため、Registry 接続されていなくても死蔵ではない。ただし **Registry 接続の不均一性** は後述の整合性問題として追記。

---

## PromptRegistry の "実 DB シード" 現状(参考)

`npm run cli:show-scoring -- --all` を本番に打つと、seed 済みの 12 エージェント全てが active 状態で DB に存在する(今日 seed 実行済み)。ただし実運用で registry の `content` がマクロ展開されないまま LLM に渡る可能性があるため、以下の優先度で整合性を取る必要:

1. **`strategy_thinker` を Registry 接続する前にマクロ展開をどう扱うか決定**
2. **Registry 経由で使用する現役 4 エージェント(HG + 3 Specialists)のプロンプト本文はマクロを含んでいないことを確認**(→ 現状は OK、今後の改訂時に注意)

---

## 調査中に見つかった気になる点

### 1. Registry 接続の不均一性

Phase 6.6 で `HypothesisGenerator` と 3 `Specialists` だけ Registry に接続、他 8 エージェントは loadPrompt 直読み。これは意図的だったが、**プロンプト進化の輪が 4 エージェントでしか回らない** 状態。

→ Phase 6.6 範囲外、将来「variantSelector 接続拡大」フェーズで対応予定。

### 2. `market_observer.md` は中途半端に残っている

- ファイルは存在、マクロプレースホルダあり
- しかし seed にも呼び出しにも無い
- このまま放置すると「何のために残っているか不明」になる

→ プロンプトレビュー時に「削除 or 明示的に参考として残す(README 追記)」のどちらかに決めるべき。

### 3. 複数経路で同じ `CORE_TRADING_RULES` が使われている(3 系統)

- `planAIService` 経由: `loadPrompt` のマクロ展開
- `researchAIService` 経由: テンプレ文字列に直接埋込
- `agentLoop` 経由: 同じくテンプレ文字列に直接埋込(ただし PDCALoop 未起動)

**3 系統が並存**しており、いずれ 1 系統に統一したい(プロンプトレビュー時の検討事項)。

### 4. Registry 経由で取得したプロンプトに `{{...}}` が残っていた場合の挙動

現状 `hypothesis_generator.md` / `specialists/*.md` にはマクロプレースホルダがない。しかし今後の改訂で誰かが追加すると、**Registry 経由で取得した本文がマクロ展開されず LLM に渡る** という潜在バグがある。

→ 推奨: `PromptRegistry.getActive` / `getExperimental` の戻り値に **マクロ展開ヘルパー** を噛ませる責務を明確化(別タスク)。

### 5. プロンプトの内部構造が統一されていない

- `hypothesis_generator.md` / `strategy_thinker.md` / `specialists/*.md` は構造が似ている(# 役割 → # 禁止事項 → # 出力形式)
- 一方 `discovery.md` / `mutation.md` / `crossover.md` / `prompt_mutation.md` / `meta_evolution.md` は構造が揃っていない
- グローバルルール導入時に **全プロンプトの章構造を合わせる** のが全体整合性の観点で必要

### 6. `DevilsAdvocate` は現役だがシナリオ単位で呼ばれる設計

`aiOrchestrator.ts:436`: `await this.devilsAdvocate.critique(scenario, ...)` が **scenarios ループ内** で呼ばれる。つまり scenarios=0 なら DevilsAdvocate も呼ばれない → 今日の問題 B(ノートレード判断)では DevilsAdvocate が発動しなかった。

→ これは妥当な設計だが、プロンプトレビュー時に「scenarios=0 のときに DevilsAdvocate がやるべきことは何もない」ことを明文化しておくとよい。

### 7. `agentLoop.ts` の CORE_TRADING_RULES 埋め込み箇所は現状使われていない

`PDCALoop 無効` の状態なので `agentLoop.ts` の `CORE_TRADING_RULES` 注入は実運用で走っていない。Phase 5.5 / 6.6 のメモ参照。

→ 将来 PDCALoop を復活させるなら、ここのプロンプト整合性も再確認が必要。

---

## Phase 6 プロンプト見直しの前提として確定できたこと

| 項目 | 結論 |
|---|---|
| 対象エージェント数 | 12(market_observer は除外) |
| Registry 接続済み | 4(HG + 3 Specialists) |
| loadPrompt のみで動く | 8(他全員) |
| マクロ使用箇所 | `strategy_thinker` のみ(3 種マクロ) |
| 死蔵確定 | `market_observer.md` |
| Registry 経由でマクロが展開されるか | **されない**(潜在バグ) |
| PDCALoop 使用中か | 否(無効) |

---

## 次のアクション(プロンプトレビュー開始時に検討)

1. **グローバルルールの配置決定** — マクロ展開を Registry 経由でも効かせる仕組み(例: `loadPromptWithMacros(content: string)` ユーティリティを Registry 戻り値に噛ませる)
2. **`market_observer.md` の扱い決定** — 削除 or 明示的に参考として残す
3. **`strategy_thinker.md` の改訂**(問題 B 対応、`scenarios` 空配列禁止など)
4. **Registry 接続の統一性** — 残 8 エージェントの Registry 接続を段階的に進めるか、今回はスコープ外にするか(将来フェーズ判断)
5. **`CORE_TRADING_RULES` の 3 系統統合** — 単一の global ルール配信経路にまとめる
