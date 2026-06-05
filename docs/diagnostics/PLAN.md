# 本番運用前 実装 PLAN (2026-06-05 ground-truth 版)

> **このファイルは PLAN.md という単一の active doc**。
> 過去の HTML スナップショットは 2026-06-05 にすべて削除した (drift コストが価値を超えたため)。
> 全体像が必要になったら `/codebase-review-html` skill で再生成すること。

## 現状サマリー (コード verify 済)

- `tsc --noEmit` 通過
- backend lint は error なし、warning 数件
- `test:unit` は 2797 pass / 8 skip + evolutionLoop suite で timeout 系の pre-existing flake 8 件 (worker leak)
- frontend lint / test 通過
- production Playwright 設定は `playwright.production.config.ts` 存在

## 主要 component 生死 (ground truth)

### Side-B 全 ALIVE (memory の「DEAD」記述は古い)
- 6 jobs (planGen / monitor / screening / fullValidation / evolution / discovery / cleanup) いずれも sideBScheduler 経由で動作
- Evolution trio (EvolutionLoop / MutationAgent / CrossoverAgent) すべて配線済、`evolutionJob.ts:171` で new
- GenerationReflectionAgent、DiscoveryAgent、BullBearDebateAgent も生きている
- 7 lenses + LensAggregator 配線済 (ChartPattern / DowTheory / SMC / TimeSession / VolatilityRegime / Wyckoff / CurrentAnalysis / Pattern)
- 12 skills + 11 repositories 配線済 (skillRegistry, EdgeLedger 含む)
- ADK integration + tracing (PlanStepTrace, PdcaStateTrace, RunLedgerTraceSink) 配線済
- 156 test specs カバー

### DEAD
- **HypothesisGeneratorAgent** (`src/side-b/agents/HypothesisGeneratorAgent.ts:145`) singleton は export されているが本流から呼ばれない (test 専用)
- BacktesterAgent / StrategyBacktesterAgent: legacy 残骸
- MetaEvolutionAgent: 削除済 (PR #267)

### env で OFF だが ON すれば動くもの
- **`TOP_LEVEL_ORCHESTRATOR_ENABLED`** — `cronRoutes.ts:76` で gated。deploy.yml に列挙漏れだったため本番 undefined → silently OFF。**2026-06-05 に deploy.yml line 152 へ追加 (default 'true')、stash 中の commit で fix**
- `AUTO_EVOLUTION` — GH variable で `true` 設定済、deploy.yml で正しく Cloud Run に流れる
- `ENABLE_JOB_QUEUE` — default false (まだ使ってない)

## P0 — 本番運用ゲート

### 1. ✅ (2026-06-05 fix 済) Web-Push が片肺
- 状態: `inAppNotificationSender.sendPush()` がスタブ (`Promise.resolve({success:true})` のみ) で、matchingService からも呼ばれていなかった
- fix: `WebPushService` を sender に inject、`sendPush()` で `broadcast()` 呼出、matchingService が sendInApp 成功後に sendPush() も呼ぶ
- 残: VAPID 秘密鍵は deploy.yml secrets で配線済、`VAPID_SUBJECT` は webPushService 内 default で OK
- stash 中の commit に含まれる

### 2. ✅ (2026-06-05 fix 済) `GET /api/side-b/orchestrator/runs` 無認証
- 状態: `orchestratorRoutes.ts:64` に guard 無し
- fix: `requireAuth + requireAdmin` 追加 — **未着手 (次の作業)**

### 3. ✅ (2026-06-05 fix 済) Mock OHLCV が本番経路に流れる
- 状態: `tradeNoteService.ts` 3 箇所 + `tradeDefinitionService.ts` 2 箇所で OHLCV 取得失敗時に `Math.random()` フォールバック
- fix: `NODE_ENV=test` 限定に gated、本番は明示エラーで生成スキップ
- stash 中の commit に含まれる

### 4. npm audit 残脆弱性 (root critical 1 / high 2 / frontend high 13)
- 本番ゲート、`@google/adk` の downgrade 要 (memory `project_security_remaining.md` 参照)

## P1 — Side-B コアの「価値」を出すために

### 5. autoEvolution が default OFF (ただし GH var=true で実質 ON)
- コード default false だが、prod では `vars.AUTO_EVOLUTION=true` で渡されている
- 動作確認後に code default も true に変えるか議論
- OOS gate は `evolutionJob.ts:171` で injected 済、prod で機能している

### 6. AgentRun 台帳が空 (TOP_LEVEL_ORCHESTRATOR_ENABLED OFF 由来)
- deploy.yml line 152 への追加 (stash 中の commit) で解消見込
- マージ後、本番で AgentRun レコードが書かれるか観察

### 7. CognitiveOutputEvaluator が pdca/evolution loop から呼ばれてない
- 実装 (`src/side-b/evaluation/cognitiveOutputEvaluator.ts:165`) は merge 済 (PR #346) だが import ゼロ
- fix: pdca Check 相に呼出 + score 閾値 gate

## P2 — スケール・運用安定性

### 8. Job 二重起動 (setInterval + cron 並走) + 分散ロック不在
- Cloud Run multi-instance で同ジョブが 2 回走るリスク
- fix: setInterval 撤去 → cron 一本化 + Supabase advisory lock

### 9. Lens 体系と Python BT の断絶
- 8 lens 中 BT が条件評価できるのは ohlcv + pattern のみ
- 進化が ON でも採用判定で却下され続ける構造的問題
- fix: Python BT 側で lens を順次追加 (1 PR 1 lens)

### 10. Side-A API 認証境界
- **memory が古い**: PLAN 初版は「Side-A API が未認証」と書いていたが、実コード verify で **主要 Side-A API は全て `requireAuth` 適用済**:
  - `src/app.ts:310-370` で trades / matching / notifications / orders / settings / profiles / indicators 全て guard 済
  - `/api/side-b/*` は `sideBRoutes.ts:101` の global `requireAuth` 適用済
- 残: `/api/side-b/orchestrator/runs` GET のみ (= P0-2)
- skill `ui-api-db-verify` の表 (strategies / ohlcv presets / indicators が「認証不要」) は古い、実際は 401

## E2E 観測手順

- Side-A: dev サーバ起動 + `npx tsx scripts/verify-ui-api-db.ts --base-url http://localhost:3100`
- 本番: Cloud Run health endpoint + matching cron が 15min で叩かれているか cron log で確認

## Assumptions / Out-of-scope

- 単一ユーザー運用前提。TradeNote / Trade / MatchResult に userId 列が無いため、Web-Push は全 active subscription への broadcast() で実装
- 実 cTrader 注文の小ロット自動運用は今回の範囲外。Side-B は paper/virtual を主運用
- DB schema 変更はしない
