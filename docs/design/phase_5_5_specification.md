# フェーズ5.5 仕様書: スキル基盤 MVP(Skills Foundation)

> **ステータス**: 実装完了(事後記録)
> **実装期間**: 約1日(Claude Code 実行時間)
> **目的**: Side-B のエージェント群が自律的に動くための「スキル」(ツール化された操作群) を整備する
> **位置付け**: Phase 5A と Phase 6 の間の中間フェーズ
> **前提**: Phase 1-5A 完了

---

## 0. このフェーズの位置付け

### 0.1 背景

Phase 5A 完了後、エージェント群が **自律的に動く** ための基盤が不足していることが判明した。具体的には:

- エージェントが他のエージェントや決定論ロジック層を呼び出す統一インターフェースがない
- LLM エージェントから EdgeLedger, ScreeningOrchestrator, LensAggregator 等への呼び出し経路が個別実装されている
- 将来の「自律 PDCA ループ」(LLM 判断駆動) の前提となるスキル群が未整備

このギャップを埋めるため、Phase 5A と Phase 6 の間に Phase 5.5 として **スキル基盤** を整備した。

### 0.2 Phase 5.5 の独自性

このフェーズは以下の点で Phase 1-6 と性格が異なる:

- **戦略系ではない**: 仮説生成、検証、進化といった戦略ロジックには手を入れない
- **UI 系でもない**: フロントエンド実装を含まない
- **基盤整備系**: エージェントが操作可能な機能を統一インターフェースで公開するのみ
- **軽量**: 既存関数のラップが中心、新規ロジックはほぼ無し

「Phase 5 の直接の続き」でも「Phase 6 の前提」でもなく、**どちらにも属さない基盤整備** として 5.5 番が付けられた。

### 0.3 Phase 6 との関係

Phase 6 は元々 3 サブフェーズ(Elliott/SMC/プロンプト進化)で構成されている。Phase 5.5 の成果物は Phase 6 のどのサブフェーズも前提にしないが、特に **Phase 6.3 プロンプト進化** と補完関係にある:

- Phase 5.5: 「エージェントが何ができるか」(スキル)
- Phase 6.3: 「エージェントが何を言うか」(プロンプト)

この分離により、スキル群とプロンプト群を別々に進化・改良できる。

---

## 1. このフェーズのゴール

- 自律 PDCA ループに必要な **最小限のスキル群(MVP)** を実装する
- エージェントが共通インターフェース経由でスキルを呼び出せるようにする
- 将来の AgentLoop 統合を見越した設計にする(ただしこのフェーズでは統合は行わない)

**完了条件**:

- 最小の自律ループが成立する 8 個のスキルが実装されている
- スキル登録・列挙・実行を管理する `SkillRegistry` が実装されている
- 各スキルにユニットテストが存在する
- PDCALoop・スケジューラーには一切変更がない(Phase 6 以降の課題)

---

## 2. 完了報告(実装結果)

### 2.1 実装されたスキル 8 個

| # | スキル名 | ラップ対象 | 用途 |
|---|---------|-----------|------|
| 1 | `query_edge_ledger` | `EdgeLedger.find()` | 条件で仮説検索 |
| 2 | `get_hypothesis` | `EdgeLedger.get()` | 単一仮説の詳細取得 |
| 3 | `register_hypothesis` | `EdgeLedger.create()` | 新規仮説を unverified で登録 |
| 4 | `run_screening` | `ScreeningOrchestrator.runScreening()` | Phase 4b スクリーニング実行 |
| 5 | `run_full_validation` | `StrategistAgent.validate()` | Phase 4c フル検証実行 |
| 6 | `read_recent_notes` | `aiNoteRepository.findRecentAITradeNotes()` | 直近ノート取得 |
| 7 | `record_lesson` | `agentMemory.addLesson()` | 学びを記録 |
| 8 | `compute_lens_features` | `LensAggregator.computeAll()` | レンズ特徴量スナップショット取得 |

### 2.2 自律ループの閉じ方

8 スキルで以下の閉ループが成立する:

```
(1)(2)で検索 → (3)で新仮説登録 → (4)(5)で検証 →
(6)でコンテキスト取得 → (7)で学び蓄積 → (8)で現在市場を観察
```

### 2.3 MVP に含めなかった機能(理由付き)

以下は将来の拡張候補だが、MVP スコープ外:

| 除外したスキル | 理由 |
|--------------|------|
| `spawn_discovery_agent` | Discovery は週次スケジューラで十分 |
| `spawn_evolution_loop` | Phase 5A(autoEvolution=false)なので MVP 外 |
| `run_backtest` / `run_walk_forward` 単体 | `run_full_validation` がまとめる |
| `analyze_market_regime` / `query_indicators` | `compute_lens_features` に包含 |

### 2.4 実装ファイル

新規ディレクトリ: `src/side-b/skills/`

```
src/side-b/skills/
├── index.ts              # 全スキル集約・一括エクスポート + buildDefaultSkillRegistry()
├── registry.ts           # SkillRegistry(登録・列挙・invoke・エラー wrap)
├── types.ts              # Skill インターフェース + SkillContext 共通型
├── ledger/               # スキル 1-3 (仮説操作系)
├── validation/           # スキル 4-5 (検証実行系)
├── notes/                # スキル 6-7 (ノート/学び系)
└── lens/                 # スキル 8 (レンズ系)
```

既存ファイル改修(最小): `src/side-b/agent/agentMemory.ts`

- `LESSON_SOURCES`, `LessonSource`, `LessonMetadata` を追加エクスポート
- `LessonEntry` に `metadata?: LessonMetadata` を追加(オプショナル、後方互換)
- `addLesson` に 4 番目引数 `metadata?: LessonMetadata` を追加(後方互換)
- 既存呼び出し(`pdcaLoop.ts:382`)は変更不要

### 2.5 テスト

- `src/side-b/tests/skills/registry.test.ts`: 17 件
- `src/side-b/tests/skills/skills.test.ts`: 12 件
- 合計 29 件追加、全通過
- Side-B 全体: 542 passed / 4 skipped / 44 suites

---

## 3. 設計仕様

### 3.1 Skill インターフェース

```typescript
interface Skill<Input, Output> {
  name: string;
  description: string;
  inputSchema: ZodSchema<Input>;
  execute(input: Input, context: SkillContext): Promise<Output>;
}
```

### 3.2 SkillContext

スキル呼び出しのコンテキスト情報:

```typescript
interface SkillContext {
  callerAgent?: string;    // 呼び出しエージェント名(オプショナル)
  callerReason?: string;   // 呼び出し理由(LLM が自由記述可、オプショナル)
  timestamp: string;       // 呼び出し時刻(必須、Registry が自動補完)
}
```

これにより、将来のデバッグ・分析で「どのエージェントがいつ何のスキルを呼んだか」を追跡可能。

### 3.3 SkillRegistry

スキルの登録・列挙・実行を管理する中央マネージャー:

```typescript
class SkillRegistry {
  register(skill: Skill): void;
  listTools(): SkillDefinition[];
  invoke(name: string, input: unknown, context?: Partial<SkillContext>): Promise<SkillResult>;
  
  // MCP 互換インターフェース
  toMcpToolDefinitions(): McpToolDefinition[];
  callAsMcpTool(name: string, args: unknown, context?: Partial<SkillContext>): Promise<McpToolResult>;
}
```

`toMcpToolDefinitions()` と `callAsMcpTool()` は既存の `McpClientManager` と同形インターフェース。これにより将来 AgentLoop に差し込む時、shim 置き換えだけで済む。

### 3.4 エラーハンドリング

スキル内部で例外発生時、`SkillRegistry.invoke` が try/catch で wrap:

- `SkillResult` の `success: false` フィールドに統一
- 元例外情報は `details` に保持
- AgentLoop(LLM 側) が「エラーの種類」を判断できる形式

**握りつぶし禁止**。エラーは必ず上位に伝播させる。

### 3.5 record_lesson の運用ガイドライン

スキル自体は誰からでも呼び出し可能だが、運用ルールとして以下を明記(スキルの description と JSDoc に記載):

**現状(Phase 5.5)の想定呼び出し元**:
- Reflection AI(トレード振り返りからの学び)
- Strategist Agent(検証結果の解釈からの学び)

**運用上の推奨**:
- 他エージェントからの直接呼び出しは非推奨
- 将来、日次サマリーシステム実装後は個別呼び出しは完全に非推奨になる予定

**メタデータ**:
- `source`: reflection / strategist / discovery / other
- `linkedNoteIds`: 関連ノート(オプショナル)
- `linkedHypothesisIds`: 関連仮説(オプショナル)

### 3.6 compute_lens_features の入力設計

- `symbol`: 必須
- `timeframe`: 必須
- `timestamp`: オプショナル(省略時は最新データで計算)
- `lenses`: オプショナル(省略時は全レンズ計算、指定時は計算後に絞り込み)

リアルタイム計算と過去時点取得の両方に対応。将来の連続監視システム(Phase 7 以降予定)の基盤にもなる。

---

## 4. スコープ外(このフェーズでは扱わない)

以下は Phase 5.5 では意図的に扱わず、将来のフェーズに残す:

### 4.1 AgentLoop との結線

- SkillRegistry を AgentLoop に差し込む実装は行わない
- インターフェース互換性は保つ(shim 置き換えのみで統合可能な設計)
- 統合タイミング: Phase 6.3 プロンプト進化着手時 or 別フェーズ

### 4.2 PDCA Loop 刷新

- 現在の状態機械(IDLE/MONITORING/...)は変更しない
- LLM 判断駆動の PDCA Loop 刷新は Phase 6 以降の課題

### 4.3 日次サマリーシステム

- 各エージェントの活動を翌朝統合する仕組みは未実装
- record_lesson の運用ガイドラインは将来実装を前提に記述のみ
- 実装は Phase 6 以降の別フェーズ

### 4.4 スキル拡張

- 25 個の候補のうち 8 個のみを MVP として実装
- 残りの候補(spawn 系、個別 backtest 系、詳細レンズ系)は運用で必要性が見えてから追加

---

## 5. 制約事項

### 5.1 守った制約

- **PDCA Loop とスケジューラーには一切手を入れない**: Phase 6 以降の課題として残す
- **既存エージェントのロジックを変更しない**: スキルは既存関数のラッパーのみ
- **既存呼び出し元への破壊的変更なし**: agentMemory.addLesson の拡張も後方互換

### 5.2 将来の拡張余地

- 新スキル追加: `SkillRegistry.register()` で動的に追加可能
- スキルの進化: Phase 6.3(プロンプト進化)でスキル呼び出しパターンの最適化
- MCP サーバー化: Python バックテスト基盤等の外部ツールとの統合余地

---

## 6. このフェーズで得られた設計知見

### 6.1 「スキル」というインターフェース層の価値

エージェントが共通インターフェース経由で機能を呼び出せることで:

- テスタビリティ向上(スキル単位でモック化)
- 観測性向上(呼び出しログが統一形式)
- 将来の LLM 自律化への道筋が明確化

### 6.2 最小セット優先の判断

25 個の候補から 8 個に絞ったことで:

- 実装工数の削減
- 「本当に使われるスキル」が運用から見えてから拡張する戦略
- 不要なスキルが量産されるリスクの回避

### 6.3 MCP 互換性を保つ設計

既存の `McpClientManager` と同形のインターフェースを公開することで:

- 将来の AgentLoop 統合時に大規模改修を回避
- 他プロジェクトのスキル(Python バックテスト基盤等)も同じ形で統合可能

---

## 7. 次フェーズへの引き継ぎ

### Phase 6 着手前に考慮すべき点

1. **Phase 6.3 プロンプト進化** 着手時、SkillRegistry を AgentLoop に差し込むか検討
2. **新しいスキル追加**の必要性を運用観察で判断
3. **record_lesson の運用実態** を観察し、将来の日次サマリーシステム設計の材料とする

### 将来の独立フェーズ候補

- **日次サマリーシステム**: 各エージェントの活動を統合記録
- **連続監視システム**: レンズ特徴量によるリアルタイム市場観察
- **Python バックテスト基盤 MCP 化**: 他プロジェクト資産との統合
