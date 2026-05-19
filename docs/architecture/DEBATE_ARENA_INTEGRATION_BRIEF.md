# DEBATE_ARENA_INTEGRATION_BRIEF.md — debate-arena 側 API 拡張 作業指示書

> **位置づけ**: 別リポジトリ [`debate-arena`](https://github.com/NekoyaJolly/debate-arena) で作業するエージェント (Claude Code 等) への **作業依頼書**。TradeAssist (本リポジトリ、Trader-Note-Build-Ai) から debate-arena を非同期 push-pull で呼び出すための 3 個の Supabase Edge Function を新規追加する。
> **発火元**: TradeAssist の Last-Mile 探索セッション (2026-05-19) で確定した agent 統合方針 ([`memory/project_agent_consolidation_plan.md`](https://github.com/NekoyaJolly/debate-arena) と本ファイル冒頭参照)。
> **作業対象リポジトリ**: `debate-arena` (https://github.com/NekoyaJolly/debate-arena)、master ブランチ
> **作業者**: debate-arena 側のエージェント (本ファイルをそのまま渡せば作業可能なように記述)
> **責務**: 本ファイルは「依頼書」、実装は debate-arena 側で完結。TradeAssist 側は別 PR で `eodhdClient.ts` 同様の `debateArenaClient.ts` 薄ラッパーを追加する想定。
> **統合しなかった理由 (file creation policy)**: TradeAssist 側既存 docs に統合せず本ファイルを新設する理由は (a) 別リポジトリのエージェント向けで本リポジトリ内部 doc とは責務が異なる (b) debate-arena 側でも参照しやすい単一ファイルとして配布する必要 (c) `LAST_MILE_INTEGRATION.md` と同じ命名規約で `_BRIEF` suffix を付け作業依頼であることを明示。
> **削除条件**: debate-arena 側で本仕様の 3 Edge Function が実装・デプロイされ、TradeAssist の `debateArenaClient.ts` から正常呼び出しが確認できた段階で、本ファイルは履歴として残し新規追記しない (= 完了ノートを末尾に追記する)。

---

## 1. 背景 (= なぜこの追加が必要か)

TradeAssist (本リポジトリ) は AI 駆動のトレーディングシステム。Last-Mile 探索 2026-05-19 セッションで以下が確定:

- 旧 `BullBearDebateAgent` (= bull vs bear の対立検証) + 旧 `DevilsAdvocateAgent` (= 最有力仮説への反証) を撤去
- これら 2 agent の役割を **debate-arena (= AI ディベートアプリ、5 ペルソナ × 9 step) に置換**
- TradeAssist の `aiOrchestrator.generatePlan` 内で、戦略候補をディベートさせて synthesis を受け取る
- ディベート結果は **debate-arena 側 DB に永続化** (= TradeAssist 側で複製しない、microservice 的な責務分離)

現状の debate-arena には `debate-proxy` Edge Function (= 単純な Anthropic API プロキシ、1 リクエスト = 1 LLM call) のみ。9 step orchestration はクライアント側 (React Native の `src/lib/debate/engine.ts:runDebate`) で実行。

**TradeAssist (Node.js + Next.js) からは「ディベート完結 API」が必要**。クライアント runDebate ロジックを server-side に移植して Edge Function 化する。

---

## 2. 追加する Edge Function 3 個 (仕様)

### 2.1 `trigger-debate` (POST、非同期トリガー)

**目的**: ディベートを **非同期で開始**、即座に `debate_id` を返す。実 9 step は背景で実行。

**Endpoint**: `POST /functions/v1/trigger-debate`

**認証**: Bearer Token (Supabase JWT)。TradeAssist 専用 service account を発行 or `SERVICE_ROLE_KEY` 直叩き経路を用意。

**リクエスト body**:
```json
{
  "topic": "EUR/USD 上昇トレンド継続",
  "context": {
    "strategy": { ... },
    "marketRegime": "trending",
    "symbol": "EUR/USD",
    "timeframe": "1h"
  },
  "callbackUrl": null,
  "metadata": {
    "tradeAssistAgentRunId": "uuid-from-TradeAssist",
    "callerApp": "trade-assist"
  }
}
```

- `topic` (required): ディベートのテーマ (= 日本語短文、現状の `prompts.ts` の `topic` placeholder と互換)
- `context` (optional): `strategy` / `marketRegime` 等の補足 (= prompt 内の `参考情報` として渡す)
- `callbackUrl` (optional): 完了通知用 webhook URL (= 将来用、当面 polling)
- `metadata.tradeAssistAgentRunId`: TradeAssist 側の `AgentRun.id` (= 後で結果を fetch する時の照合キー)
- `metadata.callerApp`: 呼び出し元アプリ名 (= rate limit 振り分け / 監査用)

**レスポンス (success, 202 Accepted)**:
```json
{
  "debate_id": "uuid",
  "status": "running",
  "createdAt": "2026-05-19T12:34:56Z",
  "estimatedCompletionMs": 240000
}
```

- `estimatedCompletionMs`: 想定完了時間 (= 3-5 分なので 180,000-300,000 ms、固定値で OK)

**レスポンス (error)**: 既存 `debate-proxy` と同形式 (`{ error: { message } }`)

**実装メモ**:
- `debates` テーブルに INSERT (status='running', metadata に caller info)
- 背景で `runDebate` を起動 (= Deno の `EdgeRuntime.waitUntil()` で background task として実行)
- 9 step ごとに `debate_messages` に追記、最終 `debate_results` に synthesis 保存
- 失敗時は `debates.status='failed'` + errorMessage
- レート制限 (`FREE_DAILY_LIMIT=3`) は **TradeAssist caller には bypass** (= metadata.callerApp='trade-assist' で除外、または専用 user に `DEV_BYPASS_DAILY_LIMIT=true` 適用)

### 2.2 `debate-status` (GET、進捗確認)

**目的**: TradeAssist が polling して完了を待つ用途。

**Endpoint**: `GET /functions/v1/debate-status/{debate_id}`

**認証**: 同上

**レスポンス**:
```json
{
  "debate_id": "uuid",
  "status": "running" | "completed" | "failed" | "timeout",
  "progress": {
    "currentStep": 5,
    "totalSteps": 9,
    "currentPhase": "検証" | "立論" | "収束",
    "currentRole": "肯定派" | "否定派" | "証拠監査" | "審判" | "司会"
  },
  "createdAt": "...",
  "completedAt": "..." | null,
  "errorMessage": "..." | null
}
```

**TradeAssist 側 polling 仕様**:
- 間隔: **1-2 分** (= ディベート実行が 3-5 分なので、30 秒は短すぎる、Neko 判断)
- 上限: ディベート開始から 10 分でタイムアウト扱い (= TradeAssist 側で `status='timeout'` 記録)

### 2.3 `debate-result` (GET、結果取得)

**目的**: 完了したディベートの synthesis + 全メッセージを取得。

**Endpoint**: `GET /functions/v1/debate-result/{debate_id}`

**認証**: 同上

**レスポンス**:
```json
{
  "debate_id": "uuid",
  "status": "completed",
  "topic": "EUR/USD 上昇トレンド継続",
  "synthesis": {
    "preferredDirection": "bullish" | "bearish" | "neutral",
    "preferredConfidence": 0.72,
    "summary": "...",
    "keyArguments": ["...", "..."],
    "evidenceUrls": ["https://...", "..."]
  },
  "audit": {
    "evidenceQualityScore": 0.85,
    "issues": ["..."]
  },
  "judge": {
    "winner": "bullish" | "bearish" | "draw",
    "rationale": "...",
    "score": { "bull": 7, "bear": 5 }
  },
  "fullMessages": [ ... ],
  "metadata": { ... }
}
```

- `synthesis`: TradeAssist が `PlanAIService` に渡す主要結論 (= TradeAssist 側でキャッシュ保存)
- `audit`: 証拠監査ペルソナの出力 (= URL 品質 / 証拠不足箇所)
- `judge`: 審判ペルソナの最終判定
- `fullMessages`: 9 step 全メッセージ (= TradeAssist 側では取得するが、複製保存は基本不要、debug 用に inspect 可能)

---

## 3. 認証 / 環境変数の追加

debate-arena 側に追加すべき Supabase secrets / 環境変数:

| 変数名 | 値 | 用途 |
|---|---|---|
| `TRADE_ASSIST_SERVICE_USER_ID` | UUID | TradeAssist 専用 user の Supabase Auth user_id (= rate limit / 監査識別用) |
| `TRADE_ASSIST_BYPASS_DAILY_LIMIT` | `true` | callerApp='trade-assist' の場合に `FREE_DAILY_LIMIT` を bypass |

または **service_role_key 直叩き経路** を `trigger-debate` で許可する設計でも可。

---

## 4. データベース schema 変更

既存 `debates` / `debate_messages` / `debate_results` テーブルへの **追記** が必要:

```sql
ALTER TABLE debates
  ADD COLUMN IF NOT EXISTS caller_app TEXT,
  ADD COLUMN IF NOT EXISTS caller_run_id UUID,           -- TradeAssist の AgentRun.id 等
  ADD COLUMN IF NOT EXISTS background_task_status TEXT,  -- 'pending'|'running'|'completed'|'failed'
  ADD COLUMN IF NOT EXISTS estimated_completion_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_debates_caller ON debates(caller_app, caller_run_id);
CREATE INDEX IF NOT EXISTS idx_debates_status_created ON debates(background_task_status, created_at DESC);
```

RLS ポリシーは既存と互換、ただし TradeAssist user は `caller_app='trade-assist'` の row に対する read/write を許可する追加ポリシーが必要。

---

## 5. 背景実行 (= 9 step runDebate の Edge Function 移植)

現状の `src/lib/debate/engine.ts:runDebate` (= クライアント側) を `supabase/functions/debate-runner/` (= 内部 Edge Function、または `trigger-debate` 内の `EdgeRuntime.waitUntil()` 内) に移植する。

**移植要件**:
- `prompts.ts` (= v8.3 Artifact 改変禁止) はそのまま使用
- `parser.ts` の `extractHeadline` / `stripHeadline` / `splitTextWithUrls` 等もそのまま
- `callClaude` の代わりに **Deno 環境用に書き直し** (= `getSupabase` client を Deno で作る)
- Promise.race timeout / retry max 2 回も維持
- 各 step ごとに `debate_messages` に INSERT、完了で `debates.status='completed'` + `debate_results` 保存

**重要な制約**:
- Supabase Edge Function の実行時間制限 (= 50 秒 hard limit) を超える可能性 (3-5 分実行)
- 対策: `EdgeRuntime.waitUntil(promise)` で background task として実行、レスポンスは即座に返す
- 50 秒制限を超える場合、Supabase Edge Functions の long-running task 用機能を確認 (= Deno Background Tasks)
- ローカル動作確認: `supabase functions serve --no-verify-jwt` + `curl POST` + status polling

---

## 6. テスト方針

- `trigger-debate` 正常呼び出し → `debate_id` 即返却 + 背景で実行開始
- `debate-status` polling で `running` → `completed` 遷移を確認
- `debate-result` で synthesis 取得を確認
- TradeAssist 側との結合テスト: ローカルで両アプリ起動 + 環境変数で接続 + 1 ディベート完走
- レート制限 bypass テスト: TradeAssist user で 4 回連続呼び出しが通ることを確認

---

## 7. 完了 DoD

- [ ] `trigger-debate` Edge Function deploy 済、TradeAssist user から POST で `debate_id` 受領可
- [ ] `debate-status` で polling 動作確認 (1-2 分間隔)
- [ ] `debate-result` で synthesis fetch 動作確認
- [ ] 既存 `debates` / `debate_messages` / `debate_results` テーブルに schema 追加適用済
- [ ] RLS ポリシー追加済
- [ ] TradeAssist 専用 user (service account) 発行済 + bypass 設定
- [ ] README / CLAUDE.md 等に「TradeAssist 連携 endpoint」セクション追加
- [ ] 結合テスト 1 ディベート完走済

---

## 8. TradeAssist 側で必要な対応 (= 別 PR、参考)

debate-arena 側完了後、TradeAssist 側で以下を実装:

1. `src/side-b/services/debateArenaClient.ts` (新規、`eodhdClient.ts` 同パターン)
2. `aiOrchestrator.generatePlan` 内で旧 BullBearDebate / DevilsAdvocate 呼び出しを `triggerDebate` → polling → result fetch に置換
3. `StrategyDebateLink` Prisma model 追加 (= 薄いリンクテーブル)
4. 環境変数 `DEBATE_ARENA_BASE_URL` / `DEBATE_ARENA_SERVICE_TOKEN` を `.env.example` に追記

---

## 9. 参照

- TradeAssist 側方針: `memory/project_agent_consolidation_plan.md` (Claude memory、ローカル)
- 元 prompts (改変禁止): debate-arena `src/lib/debate/prompts.ts`
- 元 engine: debate-arena `src/lib/debate/engine.ts:runDebate`
- 元 proxy: debate-arena `supabase/functions/debate-proxy/index.ts`
- TradeAssist Last-Mile 探索セッション (2026-05-18〜19): TradeAssist 内 `docs/diagnostics/2026-05-18_g2_pipeline_audit.md` および `docs/diagnostics/2026-05-19_loops_flow_diagram.html`
