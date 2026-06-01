import { z } from 'zod';

/**
 * analysis-engine（Python）との通信スキーマ
 * 
 * 目的:
 * - pandas-ta を正としてインジケーター系列を取得
 * - 大量データは DB 共有で転送を避け、Node → Python は最小情報のみ
 */

export const AnalysisEngineIndicatorSpecSchema = z.object({
  indicatorId: z.string().min(1),
  params: z.record(z.string(), z.number()).default({}),
  field: z.string().min(1),
});

export type AnalysisEngineIndicatorSpec = z.infer<typeof AnalysisEngineIndicatorSpecSchema>;

export const AnalysisEngineIndicatorSeriesRequestSchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  indicators: z.array(AnalysisEngineIndicatorSpecSchema).default([]),
  patterns: z
    .array(
      z.enum([
        'pinbar',
        'pinbar_bull',
        'pinbar_bear',
        'hammer',
        'hammer_bull',
        'hammer_bear',
        'shooting_star',
        'engulfing_bull',
        'engulfing_bear',
        'doji',
        'thrust_bull',
        'thrust_bear',
        'bb_bandwidth',
      ])
    )
    .default([]),
  bbBandwidthWindow: z.number().int().min(2).max(500).default(20),
  bbBandwidthThreshold: z.number().min(0).max(10).default(0.2),
  // Phase 7a: SMC structures 取得フラグ。default false で既存挙動互換。
  // True の場合 response.smc に AnalysisEngineSmcStructuresPayload が返る。
  includeSmc: z.boolean().default(false),
  // Phase 7b: Chart Patterns 取得フラグ。default false で既存挙動互換。
  // True の場合 response.chartPatterns に AnalysisEngineChartPatternsPayload が返る。
  includeChartPatterns: z.boolean().default(false),
  // Phase 7c: Wyckoff phases 取得フラグ。default false で既存挙動互換。
  // True の場合 response.wyckoff に AnalysisEngineWyckoffPhasesPayload が返る。
  // SMC context (Phase 7a) を Wyckoff phase 判定に活用するため、includeSmc も
  // 同時に True にすると精度が上がる (互いに独立に設定可)。
  includeWyckoff: z.boolean().default(false),
});

export type AnalysisEngineIndicatorSeriesRequest = z.infer<typeof AnalysisEngineIndicatorSeriesRequestSchema>;

// Node → Python を ID ベースにする（StrategyVersion を Python が DB 直読み）
export const AnalysisEngineIndicatorSeriesByVersionRequestSchema = z.object({
  strategyId: z.string().uuid(),
  versionId: z.string().uuid(),
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  patterns: z
    .array(
      z.enum([
        'pinbar',
        'pinbar_bull',
        'pinbar_bear',
        'hammer',
        'hammer_bull',
        'hammer_bear',
        'shooting_star',
        'engulfing_bull',
        'engulfing_bear',
        'doji',
        'thrust_bull',
        'thrust_bear',
        'bb_bandwidth',
      ])
    )
    .default([]),
  bbBandwidthWindow: z.number().int().min(2).max(500).default(20),
  bbBandwidthThreshold: z.number().min(0).max(10).default(0.2),
});

export type AnalysisEngineIndicatorSeriesByVersionRequest = z.infer<typeof AnalysisEngineIndicatorSeriesByVersionRequestSchema>;

/**
 * Phase 7a: SMC (Smart Money Concept) structures snapshot at end-of-bars.
 *
 * analysis-engine `compute_smc_structures` の返り値。`LensFeature.features` の型制約
 * (Record<string, number | string | boolean>、null 不可、配列不可) に合わせ、すべて
 * scalar 型のみで構成。「なし」は sentinel (-1.0 / -1 / 'NONE') で表現する。
 *
 * Node 側 EvolutionLoop 等が `/v1/indicator-series` (`includeSmc: true`) で取得して
 * `LensInput.precomputedSmcStructures` 経由で `SMCLens` に渡す。
 *
 * 設計書: `docs/design/phase_7_specification.md` §5.1
 */
export const AnalysisEngineSmcStructuresPayloadSchema = z.object({
  // OB (Order Block) — 直近の Bull/Bear OB との距離 (pips)、なし時 -1.0
  nearestObBullDistancePips: z.number(),
  nearestObBearDistancePips: z.number(),
  // Liquidity zone (BSL / SSL) — lookback 20 bars 内のクラスター数
  liquidityAboveCount: z.number().int().min(0),
  liquidityBelowCount: z.number().int().min(0),
  // Fair Value Gap (FVG) — 直近 20 bars 内の 3-bar gap 数
  fvgBullCountLast20: z.number().int().min(0),
  fvgBearCountLast20: z.number().int().min(0),
  // Structure event (BOS / CHOCH) — 直近イベント、なし時 'NONE'
  lastStructureEvent: z.enum(['BOS_BULL', 'BOS_BEAR', 'CHOCH_BULL', 'CHOCH_BEAR', 'NONE']),
  barsSinceLastStructureEvent: z.number().int(),
  // Zone (Premium / Discount / Equilibrium) — 直近 swing range の中央 10% (0.45-0.55) を Equilibrium
  currentZone: z.enum(['PREMIUM', 'DISCOUNT', 'EQUILIBRIUM']),
  zonePositionPct: z.number().min(0).max(1),
});

export type AnalysisEngineSmcStructuresPayload = z.infer<typeof AnalysisEngineSmcStructuresPayloadSchema>;

/**
 * Phase 7b: Chart Patterns (N-bar structural) detection snapshot at end-of-bars.
 *
 * analysis-engine `compute_chart_patterns` の返り値。同時複数検出時は confidence
 * 最高の 1 つを採用する。LensFeature.features の型制約に合わせて scalar 型のみで構成。
 *
 * 「Pattern」(ローソク足、既存 `PatternLens` / `lensName: 'pattern'`) と
 * 「Chart Pattern」(N-bar 構造、本 lens / `lensName: 'chart_pattern'`) は階層的に
 * 異なる概念。ローソク足 = 基本、Chart Pattern = 応用 / 組み合わせ。
 * user 哲学 (2026-05-14): pattern = 基本、chart_pattern = 応用。
 *
 * 設計書: `docs/design/phase_7_specification.md` §5.2
 */
export const AnalysisEngineChartPatternsPayloadSchema = z.object({
  patternDetected: z.enum([
    'FLAG',
    'PENNANT',
    'TRIANGLE_ASC',
    'TRIANGLE_DESC',
    'TRIANGLE_SYM',
    'HEAD_SHOULDER',
    'INV_HEAD_SHOULDER',
    'DOUBLE_TOP',
    'DOUBLE_BOTTOM',
    'WEDGE_RISE',
    'WEDGE_FALL',
    'NONE',
  ]),
  patternConfidence: z.number().min(0).max(1),
  patternBreakImminent: z.boolean(),
  patternBarsCount: z.number().int().min(0),
  patternDirectionBias: z.enum(['BULL', 'BEAR', 'NEUTRAL']),
});

export type AnalysisEngineChartPatternsPayload = z.infer<typeof AnalysisEngineChartPatternsPayloadSchema>;

/**
 * Phase 7c: Wyckoff phase / signal detection snapshot at end-of-bars.
 *
 * analysis-engine `compute_wyckoff_phases(df, smc_context)` の返り値。SMC context
 * (Phase 7a) を input として活用し、BOS / CHOCH 情報で phase 判定の精度を上げる。
 *
 * LensFeature.features の型制約に合わせ scalar 型のみで構成。「なし」は sentinel
 * (-1 / 'UNKNOWN' / false) で表現する。
 *
 * 設計書: `docs/design/phase_7_specification.md` §5.4
 */
export const AnalysisEngineWyckoffPhasesPayloadSchema = z.object({
  wyckoffPhase: z.enum([
    'ACCUMULATION',
    'MARKUP',
    'DISTRIBUTION',
    'MARKDOWN',
    'RE_ACCUMULATION',
    'RE_DISTRIBUTION',
    'UNKNOWN',
  ]),
  wyckoffPhaseConfidence: z.number().min(0).max(1),
  springDetectedInLast20Bars: z.boolean(),
  upthrustDetectedInLast20Bars: z.boolean(),
  // Sign of Strength / Weakness 経過バー数。-1 (sentinel = なし) または 0+ (実データ) のみ許可
  // (Copilot review PR #191 指摘: 仕様上の境界を Zod でも明示)
  lastSosBarsAgo: z.number().int().min(-1),
  lastSowBarsAgo: z.number().int().min(-1),
});

export type AnalysisEngineWyckoffPhasesPayload = z.infer<typeof AnalysisEngineWyckoffPhasesPayloadSchema>;

export const AnalysisEngineIndicatorSeriesResponseSchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  timestamps: z.array(z.string().datetime()),
  series: z.record(z.string(), z.array(z.number().nullable())),
  patterns: z.record(z.string(), z.array(z.boolean())).default({}),
  // Phase 7a: SMC structures snapshot (request.includeSmc=true 時のみ Python 側で詰まる)
  // 未指定 (request.includeSmc=false) なら null / 省略。Zod は未知フィールドを silently
  // strip するため、本フィールドが無いと SMCLens まで届かない (Copilot review PR #186 指摘)
  smc: AnalysisEngineSmcStructuresPayloadSchema.nullable().optional(),
  // Phase 7b: Chart Patterns snapshot (request.includeChartPatterns=true 時のみ Python 側で詰まる)
  chartPatterns: AnalysisEngineChartPatternsPayloadSchema.nullable().optional(),
  // Phase 7c: Wyckoff phases snapshot (request.includeWyckoff=true 時のみ Python 側で詰まる)
  wyckoff: AnalysisEngineWyckoffPhasesPayloadSchema.nullable().optional(),
});

export type AnalysisEngineIndicatorSeriesResponse = z.infer<typeof AnalysisEngineIndicatorSeriesResponseSchema>;

// ============================================
// Critical-4 段階 1: スクリーニング BT API
// ============================================

/**
 * Indicator operand (PR #116c で追加): condition の右辺に別 indicator series を置く。
 *
 * `value` の代替として `compareTarget` を指定すると、Python 側 condition_evaluator は
 * `lensName.featureKey(params)` を snapshot key にして series を引き、それを right
 * operand として比較する (例: `close > ema(20)`)。
 */
const ScreeningBacktestIndicatorOperandSchema = z.object({
  lensName: z.string(),
  featureKey: z.string(),
  params: z.record(z.string(), z.number().finite()).optional(),
  /** PR ⑤B (MTF): 上位足を指定する場合の canonical timeframe (例: "1h")。 */
  timeframe: z.string().optional(),
});

/**
 * 仮説の MachineReadableCondition を Python BT で評価可能な形で送る。
 * 設計方針 (§12.3): 「変換アダプタを作らない」 → そのまま素直に渡す。
 * Python 側の app/backtest.py で評価する。
 *
 * PR #116c: `params` (動的 indicator パラメータ) と `compareTarget` (indicator operand)
 * を追加。後方互換のため両方 optional、`value` も optional 化 (compareTarget 指定時は
 * value 不要)。
 */
const ScreeningBacktestConditionSchema = z
  .object({
    lensName: z.string(),
    featureKey: z.string(),
    op: z.enum([
      '<',
      '<=',
      '>',
      '>=',
      '==',
      '!=',
      'between',
      'in',
      // PR ①-B (post-Phase 5A): Side-A 戦略表現力に揃える
      'cross_above',
      'cross_below',
      'touch_close',
      'touch_wick',
      'is_true',
      'is_false',
    ]),
    value: z
      .union([
        z.number(),
        z.string(),
        z.boolean(),
        z.tuple([z.number(), z.number()]),
        z.array(z.string()),
      ])
      .optional(),
    /** PR #116c: 動的 indicator パラメータ (例: { period: 20 })。snapshot key 構築に使う */
    params: z.record(z.string(), z.number().finite()).optional(),
    /** PR #116c: 別 indicator series との比較 (例: close > ema(20)) */
    compareTarget: ScreeningBacktestIndicatorOperandSchema.optional(),
    /** PR ⑤B (MTF): 上位足を指定する場合の canonical timeframe (例: "1h")。主と一致するなら未指定で OK */
    timeframe: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    // PR ①-B: is_true / is_false は左辺の Boolean 評価のみで RHS 不要 (= DSL ConditionSchema と同じ規則)。
    // value / compareTarget なしでも合法。両方指定もここでは弾かない。
    if (val.op === 'is_true' || val.op === 'is_false') {
      return;
    }
    // PR #118 Copilot review #1: value と compareTarget の排他性を schema 上で強制。
    // どちらも未指定 / 両方指定の不正 payload を schema 段階で弾く (= Python 側で
    // 静かに false 評価されて原因が隠れることを防ぐ)。DSL 側 ConditionSchema と同じ規則。
    const hasValue = val.value !== undefined;
    const hasTarget = val.compareTarget !== undefined;
    if (!hasValue && !hasTarget) {
      ctx.addIssue({
        code: 'custom',
        message: 'condition は value または compareTarget のどちらかを指定する必要がある',
      });
      return;
    }
    if (hasValue && hasTarget) {
      ctx.addIssue({
        code: 'custom',
        message: 'condition に value と compareTarget を同時指定することはできない (排他)',
      });
    }
  });

const ScreeningBacktestStopLossSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('atr_multiple'), value: z.number().positive() }),
  z.object({ type: z.literal('fixed_pips'), value: z.number().positive() }),
  z.object({ type: z.literal('swing_point'), lookbackBars: z.number().int().positive() }),
]);

const ScreeningBacktestTakeProfitSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rr_ratio'), value: z.number().positive() }),
  z.object({ type: z.literal('atr_multiple'), value: z.number().positive() }),
  z.object({ type: z.literal('fixed_pips'), value: z.number().positive() }),
]);

/**
 * Critical-4 PR #112: AND/OR 構造を保持した条件グループ。
 *
 * 旧 `conditions[]` は flatten された配列で AND/OR ロジックを失っていたが、
 * Python 側で DSL 通りの BT を行うには **構造を保ったまま** 渡す必要がある。
 * 本フィールドが指定されている場合、Python 評価器はこちらを優先する。
 *
 * 既存 `conditions[]` は後方互換のため残す (= 旧 client / 旧 Python は flatten 配列を見る)。
 */
export type ScreeningBacktestConditionGroup = {
  logic: 'AND' | 'OR';
  conditions: Array<
    z.infer<typeof ScreeningBacktestConditionSchema> | ScreeningBacktestConditionGroup
  >;
};

/**
 * PR #112 Copilot review #4: schema を `export` して下流 consumer (テスト / mapper /
 * 他 service) からも runtime で parse できるよう一貫性を保つ (型 `ScreeningBacktestConditionGroup`
 * とセットで export)。
 */
export const ScreeningBacktestConditionGroupSchema: z.ZodType<ScreeningBacktestConditionGroup> = z.lazy(
  () =>
    z.object({
      logic: z.enum(['AND', 'OR']),
      conditions: z.array(
        z.union([ScreeningBacktestConditionSchema, ScreeningBacktestConditionGroupSchema]),
      ),
    }),
);

/**
 * BT 入力スナップショット (notePayload)。
 * 「ノート schema を BT 入力形式に寄せる」(§12.3) ため、仮説側のフィールド名をそのまま使う。
 */
export const ScreeningBacktestNotePayloadSchema = z.object({
  direction: z.enum(['long', 'short', 'either']),
  conditions: z.array(ScreeningBacktestConditionSchema),
  /**
   * PR #112: AND/OR 構造を保った条件グループ。指定時 Python 側はこちらを優先評価する。
   * 未指定時は既存挙動 (= conditions[] flatten 経路) で互換動作。
   */
  triggerGroup: ScreeningBacktestConditionGroupSchema.optional(),
  stopLoss: ScreeningBacktestStopLossSchema,
  takeProfit: ScreeningBacktestTakeProfitSchema,
  /** 指標スペック (Python 側で pandas_ta により計算) */
  indicators: z.array(AnalysisEngineIndicatorSpecSchema).default([]),
  /** 保有上限バー数 */
  maxHoldingBars: z.number().int().positive().optional(),
});

export type ScreeningBacktestNotePayload = z.infer<typeof ScreeningBacktestNotePayloadSchema>;

export const ScreeningBacktestConfigSchema = z.object({
  initialCapital: z.number().positive().default(10_000),
  /** レバレッジ。1 を渡すとレバレッジなし */
  leverage: z.number().positive().default(1),
  /** 片道手数料 (%, 例: 0.05 = 0.05%) */
  tradingCost: z.number().min(0).default(0),
  /**
   * 往復スプレッド (pips)。analysis-engine 側で `pipSize` と期間平均価格を使って
   * backtesting.py の `spread`（価格に対する率）に換算する。未指定/0 = スプレッドなし（後方互換）。
   * 極小SL戦略がコスト無視で過大評価される問題への対処（シンボル別コスト配線）。
   * 現状は進化ループの正式BTのみが指定し、他経路は未指定（= コスト0据え置き）。
   */
  spreadPips: z.number().min(0).optional(),
  /** 1 pip の価格幅（pips→価格率の換算用）。未指定/0 の場合は spread を適用しない。 */
  pipSize: z.number().min(0).optional(),
});

export const AnalysisEngineScreeningBacktestRequestSchema = z.object({
  hypothesisId: z.string().min(1),
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  notePayload: ScreeningBacktestNotePayloadSchema,
  config: ScreeningBacktestConfigSchema.optional().default(() => ({
    initialCapital: 10_000,
    leverage: 1,
    tradingCost: 0,
  })),
});

export type AnalysisEngineScreeningBacktestRequest = z.infer<
  typeof AnalysisEngineScreeningBacktestRequestSchema
>;

export const ScreeningBacktestSummarySchema = z.object({
  pf: z.number(),
  winRate: z.number(),
  tradeCount: z.number().int().nonnegative(),
  maxDD: z.number().nullable(),
  sharpe: z.number().nullable(),
  returnPct: z.number().nullable(),
  recoveryFactor: z.number().nullable().optional(),
  riskReward: z.number().nullable().optional(),
});

export type ScreeningBacktestSummary = z.infer<typeof ScreeningBacktestSummarySchema>;

export const ScreeningBacktestTradeSchema = z.object({
  entryTime: z.string().datetime(),
  entryPrice: z.number(),
  exitTime: z.string().datetime().nullable(),
  exitPrice: z.number().nullable(),
  side: z.enum(['long', 'short']),
  pnl: z.number(),
  outcome: z.enum(['win', 'loss', 'timeout']),
});

export type ScreeningBacktestTrade = z.infer<typeof ScreeningBacktestTradeSchema>;

export const AnalysisEngineScreeningBacktestResponseSchema = z.object({
  summary: ScreeningBacktestSummarySchema,
  trades: z.array(ScreeningBacktestTradeSchema),
  /** equity curve (省略可、長大なため将来サンプリング検討) */
  equity: z.array(z.number()).nullable(),
  /** BT エンジン名+バージョン (例: 'analysis-engine/backtesting.py@0.6.5') */
  engineVersion: z.string().min(1),
  /**
   * 評価できなかった条件 (Python 側で lens 名→指標マッピングできなかったもの)。
   * 段階 1 では SL/TP のみで BT を進めるためのデバッグ用。
   */
  unsupportedConditions: z.array(z.string()).default([]),
});

export type AnalysisEngineScreeningBacktestResponse = z.infer<
  typeof AnalysisEngineScreeningBacktestResponseSchema
>;

// ============================================
// 進化ループ再設計 Phase 1: パラメータ最適化 (/v1/optimize)
// ============================================
//
// 数値最適化は analysis-engine 側 (backtesting.py Backtest.optimize) の決定論処理に委ねる
// (AGENTS.md ドメイン原則#3)。探索空間 (候補値リスト) は呼び出し側が「現在値±N%・型刻み」で生成。
// Phase 1: SL/TP 値の最適化（全期間）。
// Phase 1b: アンカード・ウォークフォワード過学習ガード（複数 OOS 窓 + DSR + トレード数フロア）。
//           インジ期間最適化は別メカニズム（variant DSL 生成）のため Phase 1c に分離。

/**
 * Phase 1b: 過学習ガード（アンカード WF）の既定値。
 * per-field default と request 側の object default の両方がここを参照し、単一の真実点にする
 * （= 二重管理によるドリフト防止）。
 */
export const WALK_FORWARD_DEFAULTS = {
  enabled: true,
  windows: 4,
  minTradesPerWindow: 25,
} as const;

/** Phase 1b: 過学習ガード（アンカード WF）の設定。enabled=false で Phase 1 互換（全期間1回）。 */
export const AnalysisEngineWalkForwardConfigSchema = z.object({
  enabled: z.boolean().default(WALK_FORWARD_DEFAULTS.enabled),
  /** OOS 窓数（fold 数）。全期間を windows+1 ブロックに等分して anchored WF。 */
  windows: z.number().int().min(1).max(12).default(WALK_FORWARD_DEFAULTS.windows),
  /** 各 OOS 窓で過学習判定に必要な最低トレード数。未満は not_evaluated。 */
  minTradesPerWindow: z.number().int().nonnegative().default(WALK_FORWARD_DEFAULTS.minTradesPerWindow),
});

export type AnalysisEngineWalkForwardConfig = z.infer<typeof AnalysisEngineWalkForwardConfigSchema>;

export const AnalysisEngineOptimizeRequestSchema = z.object({
  hypothesisId: z.string().min(1),
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  notePayload: ScreeningBacktestNotePayloadSchema,
  config: ScreeningBacktestConfigSchema.optional().default(() => ({
    initialCapital: 10_000,
    leverage: 1,
    tradingCost: 0,
  })),
  /** 探索する SL 値の候補（atr_multiple/fixed_pips の value）。空なら SL は最適化しない。 */
  slValues: z.array(z.number().positive()).default([]),
  /** 探索する TP 値の候補（rr_ratio/atr_multiple/fixed_pips の value）。空なら TP は最適化しない。 */
  tpValues: z.array(z.number().positive()).default([]),
  /** 最大化指標。過学習回避のため既定はリスク調整後（sharpe）。 */
  maximize: z.enum(['sharpe', 'profit_factor', 'return']).default('sharpe'),
  method: z.enum(['grid', 'sambo']).default('grid'),
  maxTries: z.number().int().positive().optional(),
  /**
   * Phase 1b: 過学習ガード設定。既定で WF 有効。
   * 既定値は `WALK_FORWARD_DEFAULTS` を単一の真実点として参照する（= ドリフト防止）。
   */
  walkForward: AnalysisEngineWalkForwardConfigSchema.default(() => ({ ...WALK_FORWARD_DEFAULTS })),
});

export type AnalysisEngineOptimizeRequest = z.infer<typeof AnalysisEngineOptimizeRequestSchema>;
/** 呼び出し側用の入力型（default 付きフィールドは省略可）。 */
export type AnalysisEngineOptimizeRequestInput = z.input<typeof AnalysisEngineOptimizeRequestSchema>;

/** Phase 1b: Deflated Sharpe Ratio 観測値。notComputable!=null なら計算不能。 */
export const AnalysisEngineDsrMetricsSchema = z.object({
  dsr: z.number(),
  sharpeRatio: z.number(),
  expectedMaxSr: z.number(),
  sampleSize: z.number().int().nonnegative(),
  notComputable: z.string().nullable().default(null),
});

export type AnalysisEngineDsrMetrics = z.infer<typeof AnalysisEngineDsrMetricsSchema>;

/** Phase 1b: ウォークフォワード 1 窓の OOS 結果。 */
export const AnalysisEngineWalkForwardFoldSchema = z.object({
  foldIndex: z.number().int(),
  trainStartIndex: z.number().int().nonnegative(),
  trainEndIndex: z.number().int().nonnegative(),
  oosStartIndex: z.number().int().nonnegative(),
  oosEndIndex: z.number().int().nonnegative(),
  bestParams: z.record(z.string(), z.number()).default({}),
  oosSummary: ScreeningBacktestSummarySchema,
  oosTradeCount: z.number().int().nonnegative(),
  evaluated: z.boolean(),
  skipReason: z.string().nullable().default(null),
});

export type AnalysisEngineWalkForwardFold = z.infer<typeof AnalysisEngineWalkForwardFoldSchema>;

/**
 * Phase 1b: ウォークフォワード過学習ガードの観測結果。
 * verdict は助言（observation）。合否強制は Side-B 確証ゲート（Phase 4）。
 */
export const AnalysisEngineOverfitGuardSchema = z.object({
  method: z.literal('walk_forward'),
  windows: z.number().int().min(1),
  minTradesPerWindow: z.number().int().nonnegative(),
  trialCount: z.number().int().nonnegative(),
  evaluatedFoldCount: z.number().int().nonnegative(),
  folds: z.array(AnalysisEngineWalkForwardFoldSchema).default([]),
  aggregateOos: ScreeningBacktestSummarySchema,
  dsr: AnalysisEngineDsrMetricsSchema.nullable().default(null),
  verdict: z.enum(['robust', 'overfit_suspected', 'not_evaluated']),
});

export type AnalysisEngineOverfitGuard = z.infer<typeof AnalysisEngineOverfitGuardSchema>;

export const AnalysisEngineOptimizeResponseSchema = z.object({
  /** 最適化されたパラメータ（探索対象のみ。例: { slValue: 1.8, tpValue: 2.2 }）。WF 有効時は全期間最適化結果。 */
  bestParams: z.record(z.string(), z.number()).default({}),
  summary: ScreeningBacktestSummarySchema,
  trades: z.array(ScreeningBacktestTradeSchema).default([]),
  equity: z.array(z.number()).nullable().default(null),
  engineVersion: z.string().min(1),
  /** Phase 1b: WF 有効時のみ非 null。無効（walkForward.enabled=false）なら null。 */
  overfitGuard: AnalysisEngineOverfitGuardSchema.nullable().default(null),
});

export type AnalysisEngineOptimizeResponse = z.infer<typeof AnalysisEngineOptimizeResponseSchema>;

// ============================================
// Critical-4 PR #109/#110: OOS Validation
// ============================================
//
// Python 側 `/v1/oos-validation` の request/response。Side-B `OosBacktestRunnerResult`
// (TS) と互換命名で運ぶ vehicle。verdict は **analysis-engine 側で判定** する
// (= Side-B では再判定しない、PR #105 設計確定事項)。

export const OosValidationVerdictSchema = z.enum(['passed', 'failed', 'unknown']);
export type OosValidationVerdict = z.infer<typeof OosValidationVerdictSchema>;

export const OosValidationFailureReasonSchema = z.enum([
  'low_oos_pf',
  'insufficient_oos_trades',
  'high_oos_drawdown',
  'oos_engine_error',
  'insufficient_oos_data',
  'unknown',
]);
export type OosValidationFailureReason = z.infer<typeof OosValidationFailureReasonSchema>;

export const OosValidationThresholdsSchema = z.object({
  /** OOS 期間の PF 下限 (default 1.0)。 */
  minOosPf: z.number().positive().default(1.0),
  /** OOS 期間の最低 trade 数 (default 20)。 */
  minOosTrades: z.number().int().nonnegative().default(20),
  /** OOS 期間の最大 maxDD (% スケール、default 30)。 */
  maxOosDrawdown: z.number().positive().default(30.0),
});
export type OosValidationThresholds = z.infer<typeof OosValidationThresholdsSchema>;

export const AnalysisEngineOosValidationRequestSchema = z.object({
  hypothesisId: z.string().min(1),
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  /** OOS 期間 start (= 既に Side-B adapter 側で OOS split 済みの範囲)。 */
  startDate: z.string().datetime(),
  /** OOS 期間 end。 */
  endDate: z.string().datetime(),
  notePayload: ScreeningBacktestNotePayloadSchema,
  config: ScreeningBacktestConfigSchema.optional().default(() => ({
    initialCapital: 10_000,
    leverage: 1,
    tradingCost: 0,
  })),
  thresholds: OosValidationThresholdsSchema.optional().default(() => ({
    minOosPf: 1.0,
    minOosTrades: 20,
    maxOosDrawdown: 30.0,
  })),
});

export type AnalysisEngineOosValidationRequest = z.infer<
  typeof AnalysisEngineOosValidationRequestSchema
>;

/**
 * `runOosValidation` の **入力型** (= `z.input`)。schema の `.default(...)` を持つ
 * フィールド (`config` / `thresholds`) を **省略可能** にする。defaults は schema parse の
 * 中で埋まるため、adapter 側で値を再ハードコードしなくても良い (= 単一の真実、
 * PR #110 Copilot review #2 対応で drift 防止)。
 */
export type AnalysisEngineOosValidationRequestInput = z.input<
  typeof AnalysisEngineOosValidationRequestSchema
>;

export const OosValidationMetricsSchema = z.object({
  pf: z.number().nullable(),
  tradeCount: z.number().int().nonnegative(),
  maxDrawdown: z.number().nullable(),
  expectancy: z.number().nullable(),
  winRate: z.number().nullable(),
});
export type OosValidationMetrics = z.infer<typeof OosValidationMetricsSchema>;

export const AnalysisEngineOosValidationResponseSchema = z.object({
  metrics: OosValidationMetricsSchema,
  verdict: OosValidationVerdictSchema,
  failureReasons: z.array(OosValidationFailureReasonSchema).default([]),
  evaluationKind: z.literal('oos').default('oos'),
  warnings: z.array(z.string()).default([]),
  engineVersion: z.string().min(1),
  unsupportedConditions: z.array(z.string()).default([]),
});

export type AnalysisEngineOosValidationResponse = z.infer<
  typeof AnalysisEngineOosValidationResponseSchema
>;
