# Codebase Review 観点リスト

`SKILL.md` から参照される、領域別のレビュー観点。プロジェクトの進化に合わせて追記する。

---

## Frontend (`src/frontend/`)

### 必ず確認
- `package.json` の依存と Next.js バージョン
- `app/layout.tsx` 構造 + 認証 Provider 配置
- `contexts/AuthContext.tsx` の JWT / token 保存方式 (= XSS リスク)
- `lib/api.ts` の API client (= レスポンス型検証の有無)
- Tailwind / CSS 設定
- 主要ページ (`app/**/page.tsx`) の存在

### よく見落とすが重要
- `next.config.ts` の rewrite / headers 設定
- 環境変数の参照 (`process.env.NEXT_PUBLIC_*`)
- フォーム / ユーザー入力の Zod 検証
- `__AI_DEBUG_CONTEXT__` (= last-mile-context) への機密混入リスク

---

## Backend Node (`src/backend/`, `src/app.ts`, `src/routes/`)

### 必ず確認
- `src/app.ts` middleware 構成 (helmet / rate-limit / CSRF / CORS)
- `src/routes/**.ts` 認証要件 + Zod validation
- `src/services/**.ts` 主要 service の責務分離
- `src/middleware/` の認証 / ロギング
- エラーハンドリング (`global error handler`)
- 環境変数 / config (`src/config/index.ts`)

### よく見落とすが重要
- OAuth callback の state 検証 (CSRF 防止)
- `process.env` 直接参照 vs config 経由
- async error の握りつぶし
- DB transaction 境界 (Prisma)

---

## Backend Python (`analysis-engine/`)

### 必ず確認
- `app/main.py` FastAPI endpoints 構成
- `app/schemas.py` Pydantic schemas
- `app/db.py` DB 接続設定
- `requirements.txt` 依存と version
- `Dockerfile` build 構成
- DB 直読み箇所 (= OHLCVCandle 等)

### よく見落とすが重要
- async / sync の混在
- 例外伝播 (HTTP exception への変換)
- pandas / numpy のメモリ消費 (大 dataset)
- timeout 設定 (uvicorn / FastAPI)

---

## Database (`prisma/schema.prisma`)

### 必ず確認
- model 数と主要 model (User / Trade / AITradeNote / EdgeHypothesis / EvolutionBacktestRun / AgentRun 等)
- index 設定 (`@@index`)
- relation 構造 (1:N / M:N)
- token / 秘密情報の暗号化方式 (= `String` 平文か?)
- migration 履歴 (`prisma/migrations/`)

### よく見落とすが重要
- N+1 クエリ誘発しそうな relation
- 大量 row テーブルの retention (cleanup job との整合)
- enum vs String の選択
- JSONB column 内の構造化 (validate されているか)

---

## AI Agent / Side-B (`src/side-b/`)

### 必ず確認
- 8.1 **PDCALoop** (`agent/pdcaLoop.ts`): state machine 7 state、各 handler、AgentMemory 経由のデータ流
- 8.2 **EvolutionLoop** (`evolution/EvolutionLoop.ts`): 進化 9 step、formal BT、QD archive
- 8.3 **AIOrchestrator** (`orchestrator/aiOrchestrator.ts`): Plan 多段 10 step、specialists / debate
- 8.4 **観測性**: ADK trace 配線 (`adk/tracing/`)、RunLedger 接続
- 8.5 **PromptRegistry** (`prompts/registry/`): seed / active / experimental
- 8.6 **Edge Ledger** (`ledger/EdgeLedger.ts`): 仮説状態 (unverified / screening_passed / confirmed / 等)
- 8.7 **Bridge** (`bridge/ScreeningOrchestrator.ts`): analysis-engine 連携

### よく見落とすが重要
- LLM token 消費の見積もり (大量 prompt が走るか)
- `loadPrompt` 直呼び (= Registry 未経由) の残存 → プロンプト進化対象外
- 自動実行フラグ (= 既定 false の Phase 6 系)
- AgentLoop 撤去 (PR #231) 後の上位統括層の存在 / 不在
- 各 Job の cron 設定と cooldown (`jobs/sideBScheduler.ts`)
- Discovery / Reflection / Strategist の役割分離 (Discovery は仮説生成しない方針)

---

## Testing / CI

### 必ず確認
- テストファイル数と主要 suite (`src/**/tests/`)
- `npx tsc --noEmit` clean か
- `npx jest` 全体 pass か (= 直近 CI で確認)
- `.github/workflows/*.yml` CI 構成
- pre-commit hook (`.husky/` または `lefthook.yml`)
- E2E (`tests/e2e/playwright`) の状況

### よく見落とすが重要
- 時間依存テスト (= `Date.now()` 直書き) → flake 化リスク
- mock の漏れ (= 本番 DB 接続するテスト)
- カバレッジ閾値設定の有無
- CI で skip / `it.skip` されているテスト

---

## 環境設定 / DevOps

### 必ず確認
- `.env.example` の必須環境変数
- `package.json` scripts セクション (= 主要コマンド)
- `Dockerfile` / `docker-compose.yml`
- Cloud Run / Vercel / Supabase 設定 (= `gcloud` / `vercel.json`)
- `scripts/` 配下のスクリプト一覧と `scripts/README.md` 整合性

### よく見落とすが重要
- `package-lock.json` と `package.json` の整合
- ports 衝突 (3100 / 3102 / 5432)
- 秘密情報の漏洩 (`.env` の commit、log の API key 等)
- ESLint / Prettier 設定の strictness

---

## ドキュメント

### 必ず確認
- `AGENTS.md` (= 全エージェント正本) の最終更新日
- `CLAUDE.md` / `.cursorrules` / `GEMINI.md` シムの整合
- `docs/architecture/` 主要設計書
- `docs/design/` 現在進行中のフェーズ仕様
- `docs/diagnostics/` 既知問題の蓄積
- README.md の最小性 (= 詳細は AGENTS.md に集約しているか)

### よく見落とすが重要
- 設計書と実装の乖離 (Phase 完了時の更新義務、AGENTS.md §5)
- KICKOFF / NOTES / AUDIT 系の md 増殖 (= 禁止パターン)

---

## 既知 diagnostics の参照

`docs/diagnostics/*.md` および `*.html` の中で未解決 / 議論中のものを必ず読み、レポートに反映する:

- `2026-05-18_g2_pipeline_audit.md` (Side-B validation pipeline)
- `2026-05-19_loops_flow_diagram.html` (PDCA + Evolution 配線)
- `trader_note_build_ai_comprehensive_review_2026-05-20.html` (= 過去レポート、本 skill の原型)

これら過去レポートと比較し、**解消済 / 進行中 / 新規** の状態を明示する。
