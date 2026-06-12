/**
 * ノート類似度基盤 — レンズ別 比較定義カタログ
 *
 * 正本設計: docs/architecture/NOTE_SIMILARITY_FOUNDATION.md §4 / §6.2
 *
 * 責務:
 * - 各レンズの featureKey ごとに「どう比較するか」(comparator) を宣言的に定義する
 * - enum は近さに応じた部分点(順序 enum は順序距離、カテゴリは類似表)、
 *   生値(pips/bars 等)は「保存は生値・比較時に正規化」を実現する(§6.2 確定)
 *
 * カタログ方針:
 * - 状態レンズ 8 種(src/side-b/lenses/ の現行実装出力キー)を正準カタログとして固定
 * - インジケーターレンズは lensId の `#` より前(例: `ind:rsi`)でカタログを引く
 * - カタログ未定義のキー: boolean は一致/不一致で比較、それ以外は比較対象外(skip)。
 *   新レンズ・新キーを類似度に効かせたい場合は本カタログに追記する(加算的拡張)
 */

import { INDICATOR_LENS_PREFIX } from './indicatorLenses';

/** レンズの層(層重み付けの単位。§6.3) */
export type LensLayer = 'state' | 'indicator';

/**
 * featureKey 1 つ分の比較方法。
 *
 * - linear:           値域 [min,max] の数値を 1 - |a-b|/(max-min) で比較
 * - normalizedLinear: 生値(bars/pips/count 等)を min(v/cap, 1) で [0,1] 化してから線形比較。
 *                     sentinel 値(例: -1 = なし)はどちらかが該当したらキーごとスキップ
 * - tanhLinear:       符号付き生値を tanh(v/scale) で [-1,1] 化してから線形比較
 * - orderedEnum:      順序付き列挙。1 - 順序距離/最大距離(§6.2 確定: 部分点)
 * - categoricalEnum:  順序なし列挙。類似表があれば参照、無ければ一致=1/不一致=0
 * - bool:             一致=1、不一致=0
 * - event:            方向イベント(bull/none/bear)。同方向=1、none同士=0.5、逆方向=0、
 *                     none と方向の組=0.25(§6.2)
 * - cyclic:           周期値(時刻等)。1 - 周回距離/半周期
 * - skip:             比較対象外(絶対価格・メタ confidence 等)を明示する
 */
export type FeatureComparator =
  | { readonly kind: 'linear'; readonly min: number; readonly max: number }
  | { readonly kind: 'normalizedLinear'; readonly cap: number; readonly sentinel?: number }
  | { readonly kind: 'tanhLinear'; readonly scale: number }
  | {
      readonly kind: 'orderedEnum';
      readonly order: ReadonlyArray<string>;
      readonly skipValues?: ReadonlyArray<string>;
    }
  | {
      readonly kind: 'categoricalEnum';
      readonly table?: Readonly<Record<string, Readonly<Record<string, number>>>>;
      readonly skipValues?: ReadonlyArray<string>;
      /**
       * 取り得る値の正準リスト (レンズ条件タイプ #3 の数値エンコード = この index)。
       * 宣言されたカテゴリ enum のみ条件タイプで比較可能になる (加算的拡張)。
       * フロント UI の選択肢の並びはこのリストと同期させること (ドリフト注意)。
       */
      readonly values?: ReadonlyArray<string>;
    }
  | { readonly kind: 'bool' }
  | { readonly kind: 'event' }
  | { readonly kind: 'cyclic'; readonly modulo: number }
  | { readonly kind: 'skip' };

/** 1 レンズ分の比較定義 */
export interface LensComparisonDefinition {
  /** 層(state / indicator)。層重み(§6.3)の適用単位 */
  readonly layer: LensLayer;
  /** featureKey → 比較方法 */
  readonly features: Readonly<Record<string, FeatureComparator>>;
}

// ============================================================
// 類似表ビルダー(カテゴリ enum 用)
// ============================================================

/**
 * 対称な類似表を作る(a→b を登録すると b→a も同値になる)。
 * 同値ペア(a===b)は表に無くても常に 1.0 として扱われる。
 */
function symmetricTable(
  entries: ReadonlyArray<readonly [string, string, number]>
): Readonly<Record<string, Readonly<Record<string, number>>>> {
  const table: Record<string, Record<string, number>> = {};
  for (const [a, b, score] of entries) {
    (table[a] ??= {})[b] = score;
    (table[b] ??= {})[a] = score;
  }
  return table;
}

/**
 * chart_pattern 用の類似表。
 * パターンを方向グループ(BULL/BEAR/NEUTRAL)で束ね、
 * 同一パターン=1 / 同グループ=0.5 / NEUTRAL×方向=0.3 / 逆グループ=0 / NONE×検出=0。
 */
function buildChartPatternTable(): Readonly<Record<string, Readonly<Record<string, number>>>> {
  const groups: Record<string, 'BULL' | 'BEAR' | 'NEUTRAL'> = {
    INV_HEAD_SHOULDER: 'BULL',
    DOUBLE_BOTTOM: 'BULL',
    TRIANGLE_ASC: 'BULL',
    WEDGE_FALL: 'BULL',
    HEAD_SHOULDER: 'BEAR',
    DOUBLE_TOP: 'BEAR',
    TRIANGLE_DESC: 'BEAR',
    WEDGE_RISE: 'BEAR',
    FLAG: 'NEUTRAL',
    PENNANT: 'NEUTRAL',
    TRIANGLE_SYM: 'NEUTRAL',
  };
  const ids = Object.keys(groups);
  const entries: Array<readonly [string, string, number]> = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      const ga = groups[a];
      const gb = groups[b];
      let score = 0;
      if (ga === gb) {
        score = 0.5;
      } else if (ga === 'NEUTRAL' || gb === 'NEUTRAL') {
        score = 0.3;
      }
      entries.push([a, b, score] as const);
    }
  }
  for (const id of ids) {
    entries.push(['NONE', id, 0] as const);
  }
  return symmetricTable(entries);
}

/**
 * current_analysis の regime 類似表。
 * 順序を持つ 5 値(strong_down〜strong_up)は順序距離ベース、
 * breakout / choppy はカテゴリとして個別に近さを定義する。
 */
function buildRegimeTable(): Readonly<Record<string, Readonly<Record<string, number>>>> {
  const ordered = [
    'strong_downtrend',
    'weak_downtrend',
    'range',
    'weak_uptrend',
    'strong_uptrend',
  ];
  const entries: Array<readonly [string, string, number]> = [];
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const distance = j - i;
      entries.push([ordered[i], ordered[j], 1 - distance / (ordered.length - 1)] as const);
    }
  }
  // breakout: 強トレンドに近く、レンジ・choppy から遠い
  entries.push(['breakout', 'strong_uptrend', 0.4] as const);
  entries.push(['breakout', 'strong_downtrend', 0.4] as const);
  entries.push(['breakout', 'weak_uptrend', 0.2] as const);
  entries.push(['breakout', 'weak_downtrend', 0.2] as const);
  entries.push(['breakout', 'range', 0.1] as const);
  entries.push(['breakout', 'choppy', 0] as const);
  // choppy: レンジに近く、トレンドから遠い
  entries.push(['choppy', 'range', 0.5] as const);
  entries.push(['choppy', 'weak_uptrend', 0.25] as const);
  entries.push(['choppy', 'weak_downtrend', 0.25] as const);
  entries.push(['choppy', 'strong_uptrend', 0] as const);
  entries.push(['choppy', 'strong_downtrend', 0] as const);
  return symmetricTable(entries);
}

/**
 * wyckoff_phase の類似表。
 * サイクル(ACC→MARKUP→DIST→MARKDOWN→ACC)の隣接 phase に部分点、
 * RE_* は対応する蓄積/分配 phase に近い扱い。
 */
function buildWyckoffTable(): Readonly<Record<string, Readonly<Record<string, number>>>> {
  return symmetricTable([
    ['ACCUMULATION', 'MARKUP', 0.5],
    ['MARKUP', 'DISTRIBUTION', 0.5],
    ['DISTRIBUTION', 'MARKDOWN', 0.5],
    ['MARKDOWN', 'ACCUMULATION', 0.5],
    ['ACCUMULATION', 'DISTRIBUTION', 0],
    ['MARKUP', 'MARKDOWN', 0],
    ['RE_ACCUMULATION', 'ACCUMULATION', 0.75],
    ['RE_ACCUMULATION', 'MARKUP', 0.5],
    ['RE_DISTRIBUTION', 'DISTRIBUTION', 0.75],
    ['RE_DISTRIBUTION', 'MARKDOWN', 0.5],
    ['RE_ACCUMULATION', 'RE_DISTRIBUTION', 0],
    ['RE_ACCUMULATION', 'DISTRIBUTION', 0],
    ['RE_ACCUMULATION', 'MARKDOWN', 0.25],
    ['RE_DISTRIBUTION', 'ACCUMULATION', 0],
    ['RE_DISTRIBUTION', 'MARKUP', 0.25],
  ]);
}

/**
 * SMC 構造イベントの類似表。
 * 同方向の BOS/CHOCH は部分点(0.5)、逆方向は 0、NONE×イベントは 0.25。
 */
function buildStructureEventTable(): Readonly<Record<string, Readonly<Record<string, number>>>> {
  return symmetricTable([
    ['BOS_BULL', 'CHOCH_BULL', 0.5],
    ['BOS_BEAR', 'CHOCH_BEAR', 0.5],
    ['BOS_BULL', 'BOS_BEAR', 0],
    ['BOS_BULL', 'CHOCH_BEAR', 0],
    ['CHOCH_BULL', 'BOS_BEAR', 0],
    ['CHOCH_BULL', 'CHOCH_BEAR', 0],
    ['NONE', 'BOS_BULL', 0.25],
    ['NONE', 'BOS_BEAR', 0.25],
    ['NONE', 'CHOCH_BULL', 0.25],
    ['NONE', 'CHOCH_BEAR', 0.25],
  ]);
}

/** dow_theory の trend_state 類似表(uptrend/downtrend/range。unclear はスキップ) */
function buildTrendStateTable(): Readonly<Record<string, Readonly<Record<string, number>>>> {
  return symmetricTable([
    ['uptrend', 'downtrend', 0],
    ['uptrend', 'range', 0.3],
    ['downtrend', 'range', 0.3],
  ]);
}

/** 方向(bullish/bearish/neutral)の類似表 */
function buildDirectionTable(): Readonly<Record<string, Readonly<Record<string, number>>>> {
  return symmetricTable([
    ['bullish', 'bearish', 0],
    ['bullish', 'neutral', 0.4],
    ['bearish', 'neutral', 0.4],
  ]);
}

/** パターン方向バイアス(BULL/BEAR/NEUTRAL)の類似表 */
function buildBiasTable(): Readonly<Record<string, Readonly<Record<string, number>>>> {
  return symmetricTable([
    ['BULL', 'BEAR', 0],
    ['BULL', 'NEUTRAL', 0.5],
    ['BEAR', 'NEUTRAL', 0.5],
  ]);
}

// ============================================================
// 状態レンズ カタログ(設計書 §4。現行 src/side-b/lenses/ の出力キーに準拠)
// ============================================================

const DOW_THEORY_DEFINITION: LensComparisonDefinition = {
  layer: 'state',
  features: {
    trend_state: {
      kind: 'categoricalEnum',
      table: buildTrendStateTable(),
      skipValues: ['unclear'],
      // 条件タイプ用の正準値リスト (DowTheoryLens の TrendState と同期)
      values: ['uptrend', 'downtrend', 'range', 'unclear'],
    },
    trend_phase: { kind: 'orderedEnum', order: ['early', 'middle', 'late'], skipValues: ['unknown'] },
    recent_higher_high: { kind: 'bool' },
    recent_higher_low: { kind: 'bool' },
    recent_lower_high: { kind: 'bool' },
    recent_lower_low: { kind: 'bool' },
    // 絶対価格はトレード時点が違えば一致し得ないため比較しない
    last_high_price: { kind: 'skip' },
    last_low_price: { kind: 'skip' },
    bars_since_last_high: { kind: 'normalizedLinear', cap: 50, sentinel: -1 },
    bars_since_last_low: { kind: 'normalizedLinear', cap: 50, sentinel: -1 },
    trend_duration_bars: { kind: 'normalizedLinear', cap: 100 },
    pullback_active: { kind: 'bool' },
    pullback_depth_pct: { kind: 'linear', min: 0, max: 100 },
    pivot_count: { kind: 'normalizedLinear', cap: 20 },
  },
};

const VOLATILITY_REGIME_DEFINITION: LensComparisonDefinition = {
  layer: 'state',
  features: {
    regime_label: {
      kind: 'orderedEnum',
      order: ['contracting', 'low', 'normal', 'elevated', 'expanding'],
      skipValues: ['unknown'],
    },
    // 絶対値(bb_width / atr)はシンボル・価格水準依存のため、percentile で比較する
    bb_width: { kind: 'skip' },
    bb_width_percentile: { kind: 'linear', min: 0, max: 100 },
    atr: { kind: 'skip' },
    atr_change_rate: { kind: 'tanhLinear', scale: 0.5 },
    atr_percentile: { kind: 'linear', min: 0, max: 100 },
    is_squeeze: { kind: 'bool' },
    is_expanding: { kind: 'bool' },
    bars_in_current_regime: { kind: 'normalizedLinear', cap: 50 },
  },
};

const SMC_DEFINITION: LensComparisonDefinition = {
  layer: 'state',
  features: {
    nearest_ob_bull_distance_pips: { kind: 'normalizedLinear', cap: 100, sentinel: -1 },
    nearest_ob_bear_distance_pips: { kind: 'normalizedLinear', cap: 100, sentinel: -1 },
    liquidity_above_count: { kind: 'normalizedLinear', cap: 5, sentinel: -1 },
    liquidity_below_count: { kind: 'normalizedLinear', cap: 5, sentinel: -1 },
    fvg_bull_count_last_20: { kind: 'normalizedLinear', cap: 5 },
    fvg_bear_count_last_20: { kind: 'normalizedLinear', cap: 5 },
    last_structure_event: { kind: 'categoricalEnum', table: buildStructureEventTable() },
    bars_since_last_structure_event: { kind: 'normalizedLinear', cap: 20, sentinel: -1 },
    current_zone: { kind: 'orderedEnum', order: ['DISCOUNT', 'EQUILIBRIUM', 'PREMIUM'] },
    zone_position_pct: { kind: 'normalizedLinear', cap: 1, sentinel: -1 },
  },
};

const WYCKOFF_DEFINITION: LensComparisonDefinition = {
  layer: 'state',
  features: {
    wyckoff_phase: { kind: 'categoricalEnum', table: buildWyckoffTable(), skipValues: ['UNKNOWN'] },
    // メタ情報(レンズ confidence の写像)は重み側で扱うため比較しない
    wyckoff_phase_confidence: { kind: 'skip' },
    spring_detected_in_last_20_bars: { kind: 'bool' },
    upthrust_detected_in_last_20_bars: { kind: 'bool' },
    last_sos_bars_ago: { kind: 'normalizedLinear', cap: 20, sentinel: -1 },
    last_sow_bars_ago: { kind: 'normalizedLinear', cap: 20, sentinel: -1 },
  },
};

const CHART_PATTERN_DEFINITION: LensComparisonDefinition = {
  layer: 'state',
  features: {
    pattern_detected: { kind: 'categoricalEnum', table: buildChartPatternTable() },
    pattern_confidence: { kind: 'skip' },
    pattern_break_imminent: { kind: 'bool' },
    pattern_bars_count: { kind: 'normalizedLinear', cap: 50 },
    pattern_direction_bias: { kind: 'categoricalEnum', table: buildBiasTable() },
  },
};

/** ローソク足パターン(12 種 bool) */
const PATTERN_DEFINITION: LensComparisonDefinition = {
  layer: 'state',
  features: {
    pinbar: { kind: 'bool' },
    pinbar_bull: { kind: 'bool' },
    pinbar_bear: { kind: 'bool' },
    hammer: { kind: 'bool' },
    hammer_bull: { kind: 'bool' },
    hammer_bear: { kind: 'bool' },
    shooting_star: { kind: 'bool' },
    engulfing_bull: { kind: 'bool' },
    engulfing_bear: { kind: 'bool' },
    doji: { kind: 'bool' },
    thrust_bull: { kind: 'bool' },
    thrust_bear: { kind: 'bool' },
  },
};

const TIME_SESSION_DEFINITION: LensComparisonDefinition = {
  layer: 'state',
  features: {
    utc_hour: { kind: 'cyclic', modulo: 24 },
    // 分単位・日付は粒度が細かすぎて類似の本質でないため比較しない
    utc_minute: { kind: 'skip' },
    day_of_week: { kind: 'cyclic', modulo: 7 },
    day_of_month: { kind: 'skip' },
    tokyo_active: { kind: 'bool' },
    london_active: { kind: 'bool' },
    ny_active: { kind: 'bool' },
    overlap_london_ny: { kind: 'bool' },
    overlap_tokyo_london: { kind: 'bool' },
    minutes_since_tokyo_open: { kind: 'normalizedLinear', cap: 480, sentinel: -1 },
    minutes_since_london_open: { kind: 'normalizedLinear', cap: 480, sentinel: -1 },
    minutes_since_ny_open: { kind: 'normalizedLinear', cap: 480, sentinel: -1 },
    is_weekend: { kind: 'bool' },
    is_monday_open: { kind: 'bool' },
    is_friday_close: { kind: 'bool' },
    is_tokyo_lunch: { kind: 'bool' },
  },
};

const CURRENT_ANALYSIS_DEFINITION: LensComparisonDefinition = {
  layer: 'state',
  features: {
    regime: { kind: 'categoricalEnum', table: buildRegimeTable() },
    direction: { kind: 'categoricalEnum', table: buildDirectionTable() },
    volatility: { kind: 'orderedEnum', order: ['low', 'medium', 'high'] },
    confidence_pct: { kind: 'skip' },
    trend_strength: { kind: 'linear', min: 0, max: 100 },
    momentum: { kind: 'linear', min: 0, max: 100 },
    volatility_score: { kind: 'linear', min: 0, max: 100 },
    support_proximity: { kind: 'linear', min: 0, max: 100 },
    resistance_proximity: { kind: 'linear', min: 0, max: 100 },
    key_levels_count: { kind: 'normalizedLinear', cap: 8 },
    strong_supports: { kind: 'normalizedLinear', cap: 4 },
    strong_resistances: { kind: 'normalizedLinear', cap: 4 },
  },
};

// ============================================================
// インジケーターレンズ カタログ(設計書 §5.2 / §5.4)
// ============================================================

const IND_RSI_DEFINITION: LensComparisonDefinition = {
  layer: 'indicator',
  features: {
    rsi_zone: { kind: 'orderedEnum', order: ['oversold', 'neutral', 'overbought'] },
    rsi_value: { kind: 'linear', min: 0, max: 1 },
    rsi_divergence: { kind: 'event' },
  },
};

const IND_MACD_DEFINITION: LensComparisonDefinition = {
  layer: 'indicator',
  features: {
    macd_cross: { kind: 'event' },
    macd_bars_since_cross: { kind: 'normalizedLinear', cap: 20, sentinel: -1 },
    macd_hist_slope: { kind: 'linear', min: -1, max: 1 },
    macd_divergence: { kind: 'event' },
  },
};

const IND_MA_DEFINITION: LensComparisonDefinition = {
  layer: 'indicator',
  features: {
    ma_slope: { kind: 'linear', min: -1, max: 1 },
    ma_distance_norm: { kind: 'linear', min: -1, max: 1 },
  },
};

const IND_MA_CROSS_DEFINITION: LensComparisonDefinition = {
  layer: 'indicator',
  features: {
    ma_cross: { kind: 'event' },
    ma_bars_since_cross: { kind: 'normalizedLinear', cap: 20, sentinel: -1 },
    ma_fast_above_slow: { kind: 'bool' },
  },
};

const IND_BB_DEFINITION: LensComparisonDefinition = {
  layer: 'indicator',
  features: {
    bb_position: { kind: 'linear', min: 0, max: 1 },
    bb_width_norm: { kind: 'linear', min: 0, max: 1 },
  },
};

// ============================================================
// カタログ解決
// ============================================================

/** 状態レンズ(完全一致 lensId)のカタログ */
const STATE_LENS_DEFINITIONS: Readonly<Record<string, LensComparisonDefinition>> = {
  dow_theory: DOW_THEORY_DEFINITION,
  volatility_regime: VOLATILITY_REGIME_DEFINITION,
  smc: SMC_DEFINITION,
  wyckoff: WYCKOFF_DEFINITION,
  chart_pattern: CHART_PATTERN_DEFINITION,
  pattern: PATTERN_DEFINITION,
  time_session: TIME_SESSION_DEFINITION,
  current_analysis: CURRENT_ANALYSIS_DEFINITION,
};

/** インジケーターレンズ(`ind:<kind>` 部分でマッチ)のカタログ */
const INDICATOR_LENS_DEFINITIONS: Readonly<Record<string, LensComparisonDefinition>> = {
  'ind:rsi': IND_RSI_DEFINITION,
  'ind:macd': IND_MACD_DEFINITION,
  'ind:ma': IND_MA_DEFINITION,
  'ind:ma_cross': IND_MA_CROSS_DEFINITION,
  'ind:bb': IND_BB_DEFINITION,
};

/**
 * lensId から比較定義を解決する。
 * - `ind:xxx#params` 形式は `#` より前で引く(パラメータ違いの同一指標は同じ比較定義)
 * - 未知の lensId は undefined(呼び出し側がフォールバックポリシーを適用)
 */
export function getLensComparisonDefinition(lensId: string): LensComparisonDefinition | undefined {
  if (lensId.startsWith(INDICATOR_LENS_PREFIX)) {
    const hashIndex = lensId.indexOf('#');
    const baseId = hashIndex >= 0 ? lensId.slice(0, hashIndex) : lensId;
    return INDICATOR_LENS_DEFINITIONS[baseId];
  }
  return STATE_LENS_DEFINITIONS[lensId];
}

/**
 * lensId から層(state / indicator)を解決する。
 * カタログ未定義のレンズは接頭辞 `ind:` の有無で判定する(フォールバック)。
 */
export function getLensLayer(lensId: string): LensLayer {
  const definition = getLensComparisonDefinition(lensId);
  if (definition) {
    return definition.layer;
  }
  return lensId.startsWith(INDICATOR_LENS_PREFIX) ? 'indicator' : 'state';
}

// ============================================================
// レンズ条件タイプ (#3) 用の数値エンコード(設計書 §12.4)
// ============================================================

/**
 * lensId + featureKey から比較方法を 1 キー分解決する(レンズ条件タイプ #3 用)。
 * 未知の lensId / featureKey は undefined(呼び出し側が条件不成立に倒す)。
 */
export function getLensFeatureComparator(
  lensId: string,
  featureKey: string
): FeatureComparator | undefined {
  return getLensComparisonDefinition(lensId)?.features[featureKey];
}

/** 方向イベント値(bull/none/bear)の数値エンコード表 */
const EVENT_VALUE_ENCODING: Readonly<Record<string, number>> = {
  bull: 1,
  none: 0,
  bear: -1,
};

/**
 * レンズ特徴値を、条件評価器の数値キャッシュ(number[])に載せるための数値へ
 * エンコードする(レンズ条件タイプ #3。設計書 §12.4-2「列挙の数値化」)。
 *
 * - bool: true=1 / false=0
 * - orderedEnum: 順序リストの index(等価比較・順序比較の両方が成立する)
 * - event: bull=1 / none=0 / bear=-1
 * - linear / normalizedLinear / tanhLinear: 数値をそのまま
 * - 上記以外(categoricalEnum / cyclic / skip)・型不一致: null(= 比較不能 → 条件不成立)
 *
 * 系列側のエンコードと条件右辺(ユーザー指定値)のエンコードが必ず本関数を通ることで、
 * 「キャッシュと条件で別エンコード」というドリフトを構造的に防ぐ。
 */
export function encodeLensFeatureValueAsNumber(
  comparator: FeatureComparator | undefined,
  value: number | string | boolean
): number | null {
  if (!comparator) {
    return null;
  }
  switch (comparator.kind) {
    case 'bool':
      return typeof value === 'boolean' ? (value ? 1 : 0) : null;
    case 'orderedEnum': {
      if (typeof value !== 'string') {
        return null;
      }
      const index = comparator.order.indexOf(value);
      return index >= 0 ? index : null;
    }
    case 'event':
      // own property のみ許可 (constructor/toString 等の継承プロパティを拾うと
      // 未知値が null にならず比較が誤成立するため。フロントミラーと同修正。PR #400)
      return typeof value === 'string' &&
        Object.prototype.hasOwnProperty.call(EVENT_VALUE_ENCODING, value)
        ? EVENT_VALUE_ENCODING[value]
        : null;
    case 'linear':
    case 'normalizedLinear':
    case 'tanhLinear':
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    case 'categoricalEnum': {
      // 正準値リスト (values) を宣言したカテゴリ enum のみ index で数値化する (#3 第2弾)
      if (typeof value !== 'string' || !comparator.values) {
        return null;
      }
      const index = comparator.values.indexOf(value);
      return index >= 0 ? index : null;
    }
    default:
      // cyclic / skip は条件タイプ対象外(加算的に拡張する)
      return null;
  }
}
