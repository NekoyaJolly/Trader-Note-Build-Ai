import dotenv from 'dotenv';

dotenv.config();

/**
 * アプリケーション設定
 * 環境変数から設定値を取得し、型安全に提供する
 * 注意: DATABASE_URL は Prisma が直接参照するため、ここでの定義は参考用
 */

console.log('[Config] 環境変数をロード中...');
console.log('[Config] NODE_ENV:', process.env.NODE_ENV);
console.log('[Config] PORT:', process.env.PORT);
console.log('[Config] BACKEND_PORT:', process.env.BACKEND_PORT);
console.log('[Config] DATABASE_URL 存在:', !!process.env.DATABASE_URL);
console.log('[Config] process.env のキー数:', Object.keys(process.env).length);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('═══════════════════════════════════════');
  console.error('  ⚠️ DATABASE_URL が見つかりません');
  console.error('═══════════════════════════════════════');
  console.error('');
  console.error('設定されている環境変数:');
  const envKeys = Object.keys(process.env)
    .filter(key => !key.includes('npm_') && !key.includes('TERM') && !key.includes('PATH'))
    .sort();

  if (envKeys.length === 0) {
    console.error('  ❌ 環境変数が全く設定されていません（.env ファイル読み込み失敗？）');
  } else {
    envKeys.forEach(key => {
      const value = process.env[key] || '';
      const displayValue = value.length > 60 ? value.substring(0, 60) + '...' : value;
      console.error(`  ${key}=${displayValue}`);
    });
  }
  console.error('');
  console.error('必須環境変数チェックリスト:');
  const requiredVars = [
    'DATABASE_URL',
    'NODE_ENV',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'AI_API_KEY',
    'MARKET_API_KEY',
  ];
  requiredVars.forEach(varName => {
    const isSet = !!process.env[varName];
    console.error(`  ${isSet ? '✅' : '❌'} ${varName}`);
  });
  console.error('═══════════════════════════════════════');
  throw new Error('DATABASE_URL is required but not found in environment variables');
}

// DATABASE_URL が参照変数のままになっていないかチェック
if (databaseUrl.includes('${{')) {
  console.error('═══════════════════════════════════════');
  console.error('  ⚠️ DATABASE_URL が参照変数形式のまま');
  console.error('═══════════════════════════════════════');
  console.error('DATABASE_URL が未展開の参照変数形式です:');
  console.error(`  ${databaseUrl}`);
  console.error('');
  console.error('修正方法:');
  console.error('1. デプロイ先の環境変数設定画面を開く');
  console.error('2. PostgreSQL の DATABASE_URL を直接コピー');
  console.error('3. DATABASE_URL を直接設定（参照ではなく実値）');
  console.error('═══════════════════════════════════════');
  throw new Error('DATABASE_URL contains unexpanded variable reference');
}

console.log('[Config] DATABASE_URL（プロトコル）:', databaseUrl.split('://')[0]);
console.log('[Config] DATABASE_URL（ホスト）:', databaseUrl.split('@')[1]?.split('/')[0] || 'unknown');
console.log('[Config] ✅ 設定ロード成功');
console.log('[Config] NODE_ENV:', process.env.NODE_ENV === 'production' ? '本番' : '開発');
console.log('[Config] サーバーポート:', process.env.BACKEND_PORT || process.env.PORT || '3100');

/**
 * LLM を呼び出すエージェント／サービスのキー。
 * コスト最適化のためエージェントごとに異なるモデルを指定できるよう、
 * `config.ai.models[key]` から個別モデル名を取得できる。
 * 未設定の場合はグローバル既定の `config.ai.model` にフォールバックする。
 */
export type AIAgentKey =
  | 'strategist'
  | 'devils_advocate'
  | 'discovery'
  | 'hypothesis_generator'
  | 'plan'
  | 'research'
  | 'reflection'
  | 'lesson_similarity'
  | 'mutation'
  | 'crossover'
  // Phase 6 旧: 3 体並列 Specialist (次 PR で削除予定、Phase 6.8 で IndicatorSpecialist に統合)
  | 'trend_specialist'
  | 'oscillator_specialist'
  | 'volatility_volume_specialist'
  // Phase 6.8 (2026-05-27): IndicatorSpecialist 統合 (= 旧 3 key を統合した新 key)
  | 'indicator_specialist'
  | 'prompt_mutation'
  | 'meta_evolution'
  // Phase 7: Bull vs Bear 討論
  | 'bull_bear_debate'
  // Side-B AI ノート生成 (aiNoteService) — Gemini 既定の汎用ノート文章生成
  | 'ai_note'
  // Side-A AI サマリ (aiSummaryService) — トレード履歴の要約
  | 'ai_summary'
  // Phase B+ (2026-05-24): Top-Level Orchestrator — 「次にどのループを回すか」の薄い判断層
  | 'top_level_orchestrator'
  // Side-A 強化版 AI サマリ (enhancedAISummaryService) — マルチモーダル / 拡張プロンプト
  | 'ai_summary_enhanced'
  // 推論サービス (decisionInferenceService) — 判断推論の説明生成
  | 'decision_inference'
  // Filter Evolution Phase D-1b (2026-05-09): 世代単位 reflection 専用 — 軽量サマリ系で十分
  | 'generation_reflection'
  // パターン分析 (patternAnalysisService) — チャートパターン抽出 + アノマリー検知、低コスト想定
  | 'pattern_analysis';

/**
 * `AI_REASONING_EFFORT` env のホワイトリスト検証。
 * 許容値: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
 * 不正値・未設定の場合は 'high' にフォールバック。
 * 不正値の時は警告ログを出して運用事故を可視化する。
 *
 * NOTE: `config` 内 `ai.reasoningEffort` の初期化から呼ばれるため、参照する
 *       `const VALID_REASONING_EFFORTS` を `config` 宣言より前に置く必要がある
 *       (TDZ 回避)。
 */
const VALID_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type ReasoningEffortValue = typeof VALID_REASONING_EFFORTS[number];

export function resolveReasoningEffort(): ReasoningEffortValue {
  const raw = process.env.AI_REASONING_EFFORT;
  if (!raw) return 'high';
  const trimmed = raw.trim().toLowerCase();
  if ((VALID_REASONING_EFFORTS as readonly string[]).includes(trimmed)) {
    return trimmed as ReasoningEffortValue;
  }
  console.warn(
    `[Config] AI_REASONING_EFFORT に不正な値: "${raw}". 'high' にフォールバックします. ` +
      `許容値: ${VALID_REASONING_EFFORTS.join(', ')}`,
  );
  return 'high';
}

export const config = {
  server: {
    // 優先度: BACKEND_PORT > PORT > 3100（env設定がある場合はそちらを優先）
    port: parseInt(process.env.BACKEND_PORT || process.env.PORT || '3100', 10),
    env: process.env.NODE_ENV || 'development',
    // 本番環境かどうかを判定するヘルパー
    isProduction: process.env.NODE_ENV === 'production',
  },
  database: {
    // Prisma が DATABASE_URL を直接参照するため、ここでは参照用として保持
    url: databaseUrl,
  },
  ai: {
    apiKey: process.env.AI_API_KEY || '',
    // Phase 6.5: OpenRouter (https://openrouter.ai/api/v1) を既定プロキシとし、
    // OpenAI 互換 /chat/completions 1 本で複数プロバイダー(Anthropic / Google / Qwen 等)の
    // モデルを呼び分ける設計に統一。
    // 各エージェントは `config.ai.models[<key>]` に明示的なモデル ID を持つ(下記)。
    // グローバル既定 `config.ai.model` は安全網としてのみ使う(新エージェント追加時の忘れ対策)。
    model: process.env.AI_MODEL || 'anthropic/claude-sonnet-4.6',
    baseURL: process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1',
    // reasoning モデル (gpt-5系 / o系) の思考レベル既定値。
    // AIProvider は isReasoningModel() で対象モデル時のみ送信するため、
    // 非 reasoning モデル (gpt-4o, anthropic/* 等) では無視される。
    reasoningEffort: resolveReasoningEffort(),
    // エージェント別モデル既定値(Phase 6.5 確定)。
    // - 最重要判断(MetaEvolution/Strategist/HypothesisGen/Discovery/DevilsAdvocate) → Opus 4.7
    // - 中位生成系(Mutation/Crossover/PromptMutation/StrategyThinker/Reflection) → Sonnet 4.6 or Haiku 4.5
    // - 下位専門家 + 軽量タスク → Gemini 3.1 Flash Lite Preview
    // 環境変数 `AI_MODEL_<KEY>` で上書き可。
    models: {
      strategist: process.env.AI_MODEL_STRATEGIST || 'anthropic/claude-opus-4.7',
      devils_advocate: process.env.AI_MODEL_DEVILS_ADVOCATE || 'anthropic/claude-opus-4.7',
      discovery: process.env.AI_MODEL_DISCOVERY || 'anthropic/claude-opus-4.7',
      hypothesis_generator: process.env.AI_MODEL_HYPOTHESIS_GENERATOR || 'anthropic/claude-opus-4.7',
      plan: process.env.AI_MODEL_PLAN || 'anthropic/claude-sonnet-4.6',
      research: process.env.AI_MODEL_RESEARCH || 'google/gemini-3.1-flash-lite-preview',
      reflection: process.env.AI_MODEL_REFLECTION || 'anthropic/claude-haiku-4.5',
      lesson_similarity: process.env.AI_MODEL_LESSON_SIMILARITY || 'google/gemini-3.1-flash-lite-preview',
      mutation: process.env.AI_MODEL_MUTATION || 'anthropic/claude-sonnet-4.6',
      crossover: process.env.AI_MODEL_CROSSOVER || 'anthropic/claude-sonnet-4.6',
      // Phase 6 旧: 3 体並列 Specialist (次 PR で削除予定、Phase 6.8 で IndicatorSpecialist に統合)
      trend_specialist: process.env.AI_MODEL_TREND_SPECIALIST || 'google/gemini-3.1-flash-lite-preview',
      oscillator_specialist: process.env.AI_MODEL_OSCILLATOR_SPECIALIST || 'google/gemini-3.1-flash-lite-preview',
      volatility_volume_specialist:
        process.env.AI_MODEL_VOLATILITY_VOLUME_SPECIALIST || 'google/gemini-3.1-flash-lite-preview',
      // Phase 6.8 (2026-05-27): 旧 trend / oscillator / volatility_volume の 3 体を統合し
      // IndicatorSpecialist 1 体に。LLM call 数 1/3 + MTF 整合性 + 役割分離。default は
      // Sonnet 4.6 (= 17+ indicator + MTF を扱うため Gemini Flash Lite より中位モデル推奨)。
      indicator_specialist:
        process.env.AI_MODEL_INDICATOR_SPECIALIST || 'anthropic/claude-sonnet-4.6',
      prompt_mutation: process.env.AI_MODEL_PROMPT_MUTATION || 'anthropic/claude-sonnet-4.6',
      meta_evolution: process.env.AI_MODEL_META_EVOLUTION || 'anthropic/claude-opus-4.7',
      // Phase 7: Bull vs Bear 討論 — 判断品質重視のため Opus
      bull_bear_debate: process.env.AI_MODEL_BULL_BEAR_DEBATE || 'anthropic/claude-opus-4.7',
      // 軽量サマリ・推論系 — 既定は Gemini Flash Lite (低コスト)
      ai_note: process.env.AI_MODEL_AI_NOTE || 'google/gemini-3.1-flash-lite-preview',
      ai_summary: process.env.AI_MODEL_AI_SUMMARY || 'google/gemini-3.1-flash-lite-preview',
      ai_summary_enhanced:
        process.env.AI_MODEL_AI_SUMMARY_ENHANCED || 'google/gemini-3.1-flash-lite-preview',
      decision_inference:
        process.env.AI_MODEL_DECISION_INFERENCE || 'google/gemini-3.1-flash-lite-preview',
      // Phase D-1b: 世代単位 reflection — 軽量サマリ + categoization タスク、Haiku 4.5 既定
      generation_reflection:
        process.env.AI_MODEL_GENERATION_REFLECTION || 'anthropic/claude-haiku-4.5',
      // パターン分析 — 旧ハードコード 'gpt-4o-mini' を撤去し、AI_MODEL_OVERRIDE_ALL が効くよう modelFor 経由に統一
      pattern_analysis:
        process.env.AI_MODEL_PATTERN_ANALYSIS || 'google/gemini-3.1-flash-lite-preview',
      // Phase B+ (2026-05-24): Top-Level Orchestrator — 「次にどのループを回すか」だけ判断する軽量層、Haiku 4.5 既定
      top_level_orchestrator:
        process.env.AI_MODEL_TOP_LEVEL_ORCHESTRATOR || 'anthropic/claude-haiku-4.5',
    } as Record<AIAgentKey, string>,
  },
  market: {
    // Twelve Data API のデフォルトURL を設定 (Phase D で撤去予定)
    apiUrl: process.env.MARKET_API_URL || process.env.TWELVE_DATA_API_URL || 'https://api.twelvedata.com',
    // TWELVE_DATA_API_KEY も MARKET_API_KEY のエイリアスとして使用可能
    apiKey: process.env.MARKET_API_KEY || process.env.TWELVE_DATA_API_KEY || '',
  },
  // Phase A 新設: EODHD All-In-One ($99.99/月、2026-05-19 確定)
  eodhd: {
    apiToken: (process.env.EODHD_API_KEY || '').trim(),
    baseUrl: process.env.EODHD_BASE_URL || 'https://eodhd.com/api',
  },
  matching: {
    threshold: parseFloat(process.env.MATCH_THRESHOLD || '0.75'),
    checkIntervalMinutes: parseInt(process.env.CHECK_INTERVAL_MINUTES || '15', 10),
  },
  notification: {
    pushKey: process.env.PUSH_NOTIFICATION_KEY || '',
    // 本番環境ではDBモード、開発環境ではFSモード（環境変数で上書き可能）
    storageMode: (process.env.NOTIFICATION_STORAGE_MODE ||
      (process.env.NODE_ENV === 'production' ? 'db' : 'fs')) as 'db' | 'fs',
  },
  ctrader: {
    clientId: (process.env.CTRADER_CLIENT_ID || '').trim(),
    clientSecret: (process.env.CTRADER_CLIENT_SECRET || '').trim(),
    // OAuth エンドポイント（connect.spotware.com を使用）
    authUrl: 'https://connect.spotware.com/apps/auth',
    tokenUrl: 'https://connect.spotware.com/apps/token',
    // WebSocket エンドポイント
    wsUrl: 'wss://live.ctraderapi.com',
    wsDemoUrl: 'wss://demo.ctraderapi.com',
    // WebSocket接続設定（ホストとポート）
    wsLiveHost: process.env.CTRADER_WS_LIVE_HOST || 'live.ctraderapi.com',
    wsDemoHost: process.env.CTRADER_WS_DEMO_HOST || 'demo.ctraderapi.com',
    wsPort: parseInt(process.env.CTRADER_WS_PORT || '5035', 10),
    // Redirect URI（Vercel）
    redirectUri: process.env.CTRADER_REDIRECT_URI || 'https://trader-note-build-ai.vercel.app/auth/ctrader/callback',
  },
  paths: {
    trades: './data/trades',
    notes: './data/notes',
  },
};

/**
 * `AI_MODEL_OVERRIDE_ALL` env が有効に設定されていれば trim した値を返す。
 * 空文字 / 空白のみは未設定扱い。
 *
 * `modelFor()` と `AIProvider` の既定モデル解決の両方から呼ばれ、
 * 「override が効くのは `modelFor()` 経由だけ」という抜けを塞ぐ。
 */
function readOverrideAll(): string | null {
  const raw = process.env.AI_MODEL_OVERRIDE_ALL;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * `AIProvider` 等が `options.model` 未指定で構築された時のグローバル既定モデル。
 * `AI_MODEL_OVERRIDE_ALL` を最優先、無ければ `config.ai.model` (= `AI_MODEL` env / ハードコード既定)。
 */
export function resolveDefaultModel(): string {
  return readOverrideAll() ?? config.ai.model;
}

/**
 * エージェント／サービスに対応するモデル名を返すヘルパー。
 *
 * 優先順位 (上から先勝ち):
 *   1. `AI_MODEL_OVERRIDE_ALL` env (= 全 modelFor() 呼び出しを一括上書き、テスト・コスト切替用)
 *   2. エージェント別環境変数 `AI_MODEL_<KEY>`（例: `AI_MODEL_STRATEGIST`）
 *      ※ 上記は config 初期化時に `config.ai.models[key]` へ既に反映済み
 *   3. `config.ai.models[key]` のハードコード既定値 (Phase 6.5 で全キー設定済み)
 *   4. グローバル `AI_MODEL` / `config.ai.model` (安全網、通常は使われない)
 *
 * 1 を入れる動機: 16+ 個ある `AI_MODEL_<KEY>` を 1 個ずつ書き換えなくても、
 *   `AI_MODEL_OVERRIDE_ALL=gpt-4o-mini` の 1 行で全エージェントを安いモデルに振れる。
 *   未設定なら 2〜4 の挙動 (= 既存のまま) を保つので本番設定は完全に非破壊。
 *
 * ※ `modelFor()` を経由しない `new AIProvider()` (引数なし) も `resolveDefaultModel()`
 *    が同じ override を読むため、本当に全 AI 呼び出しが上書きされる。
 */
export function modelFor(key: AIAgentKey): string {
  const overrideAll = readOverrideAll();
  if (overrideAll !== null) return overrideAll;
  return config.ai.models[key] || config.ai.model;
}
