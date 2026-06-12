/**
 * ストラテジー関連の型定義
 * 
 * 目的:
 * - インジケーター条件を組み合わせた売買戦略の定義
 * - バックテスト・アラート用のストラテジー管理
 * 
 * Phase A: AND/OR/NOT 論理演算子
 * Phase B: IF-THEN, SEQUENCE 追加、バックテスト機能
 */

import type { IndicatorId, IndicatorParams } from './indicator';
import type { TimeframeApi, MtfTimeframeApi } from '@/lib/marketConstants';

// ============================================
// 対応シンボル
// ============================================

/**
 * 対応通貨ペア（Phase A 初期対応）
 */
export const SUPPORTED_SYMBOLS = [
  'USDJPY',
  'EURJPY',
  'GBPJPY',
  'AUDJPY',
  'EURUSD',
  'GBPUSD',
  'AUDUSD',
  'XAUUSD', // GOLD
] as const;

export type SupportedSymbol = typeof SUPPORTED_SYMBOLS[number];

/**
 * シンボル表示情報
 */
export const SYMBOL_INFO: Record<SupportedSymbol, { label: string; category: string }> = {
  USDJPY: { label: 'USD/JPY', category: 'JPYペア' },
  EURJPY: { label: 'EUR/JPY', category: 'JPYペア' },
  GBPJPY: { label: 'GBP/JPY', category: 'JPYペア' },
  AUDJPY: { label: 'AUD/JPY', category: 'JPYペア' },
  EURUSD: { label: 'EUR/USD', category: 'USDペア' },
  GBPUSD: { label: 'GBP/USD', category: 'USDペア' },
  AUDUSD: { label: 'AUD/USD', category: 'USDペア' },
  XAUUSD: { label: 'XAU/USD (GOLD)', category: '貴金属' },
};

// ============================================
// 論理演算子・比較演算子
// ============================================

/**
 * 論理演算子
 * Phase A: AND, OR, NOT
 * Phase B: IF_THEN, SEQUENCE 追加
 */
export type LogicalOperator = 'AND' | 'OR' | 'NOT' | 'IF_THEN' | 'SEQUENCE';

/**
 * 比較演算子
 */
export type ComparisonOperator =
  | '<'           // より小さい
  | '<='          // 以下
  | '='           // 等しい
  | '>='          // 以上
  | '>'           // より大きい
  | 'between'     // 範囲内（下限〜上限の間）
  | 'not_between' // 範囲外（下限〜上限の外）
  | 'cross_above' // 上抜け（クロスアップ）
  | 'cross_below' // 下抜け（クロスダウン）
  | 'GC'          // ゴールデンクロス（上抜けの別名）
  | 'DC'          // デッドクロス（下抜けの別名）
  | 'Touch'       // タッチ（接触/近接） - 旧形式（後方互換）
  | 'touch_close' // 終値タッチ（終値ベースの近接/一致）
  | 'touch_wick'; // ヒゲタッチ（当該バーの high-low の範囲到達）

/**
 * 比較演算子の表示情報
 */
export const COMPARISON_OPERATOR_INFO: Record<ComparisonOperator, { label: string; description: string }> = {
  '<': { label: 'より小さい', description: '左辺が右辺より小さい' },
  '<=': { label: '以下', description: '左辺が右辺以下' },
  '=': { label: '等しい', description: '左辺と右辺が等しい（誤差許容あり）' },
  '>=': { label: '以上', description: '左辺が右辺以上' },
  '>': { label: 'より大きい', description: '左辺が右辺より大きい' },
  'between': { label: '範囲内', description: '左辺が下限〜上限の間（両端含む）' },
  'not_between': { label: '範囲外', description: '左辺が下限〜上限の外' },
  'cross_above': { label: '上抜け', description: '前回は下、今回は上（クロスアップ）' },
  'cross_below': { label: '下抜け', description: '前回は上、今回は下（クロスダウン）' },
  GC: { label: 'ゴールデンクロス', description: '上抜け（別名）' },
  DC: { label: 'デッドクロス', description: '下抜け（別名）' },
  Touch: { label: 'タッチ（旧）', description: '旧形式: 近接/接触/反転を含む（後方互換）' },
  touch_close: { label: 'タッチ（終値）', description: '終値がライン（例: MA）に一致/近接したら成立' },
  touch_wick: { label: 'タッチ（ヒゲ）', description: '当該バーの high-low がライン（例: MA）に到達したら成立' },
};

// ============================================
// ローソク足パターン条件（バックテスト強化）
// ============================================

export type CandlePatternId =
  | 'pinbar'
  | 'pinbar_bull'
  | 'pinbar_bear'
  | 'hammer'
  | 'hammer_bull'
  | 'hammer_bear'
  | 'shooting_star'
  | 'engulfing_bull'
  | 'engulfing_bear'
  | 'doji'
  | 'thrust_bull'
  | 'thrust_bear';

export type PatternOperator = 'is_true' | 'is_false';

export interface PatternCondition {
  conditionId: string;
  type: 'pattern';
  patternId: CandlePatternId;
  operator: PatternOperator;
  /**
   * 直近ルックバック: 「直近 N 本以内（現在足含む）にこのパターンが出現したら成立」。
   * 未指定 / 1 なら現在足のみ（通常挙動）。timeframeOverride 指定時はその足の本数。
   */
  lookbackBars?: number;
  /**
   * マルチタイムフレーム条件 (Phase γ): この条件だけ別の時間足で評価する。
   * 未指定 = ストラテジーの基準足。上位足 (1d/1w 含む) は確定バーのみ参照される。
   */
  timeframeOverride?: MtfTimeframeApi;
}

// ============================================
// 時間条件（時間帯 / 曜日 / セッション）
// ============================================

/**
 * セッションID（プリセット）。時間帯は JST 基準（後述 SESSION_PRESETS_JST）。
 */
export type SessionId = 'tokyo' | 'london' | 'newyork';

/**
 * 時間条件の種別。
 * - time_range: 時間帯（HH:MM〜HH:MM、JST。日跨ぎ対応）
 * - day_of_week: 曜日の集合（JST。0=日〜6=土）
 * - session: セッションプリセット（東京 / ロンドン / NY）
 */
export type TimeConditionKind = 'time_range' | 'day_of_week' | 'session';

interface TimeConditionBase {
  conditionId: string;
  type: 'time';
  /** true なら「その時間帯/曜日を除外（= 時間外で成立）」 */
  negate?: boolean;
}

/** 時間帯条件（JST、分単位 0-1439。start>end は日跨ぎ） */
export interface TimeRangeCondition extends TimeConditionBase {
  kind: 'time_range';
  startMinutes: number;
  endMinutes: number;
}

/** 曜日条件（JST、0=日〜6=土の集合） */
export interface DayOfWeekCondition extends TimeConditionBase {
  kind: 'day_of_week';
  days: number[];
}

/** セッション条件（プリセット） */
export interface SessionCondition extends TimeConditionBase {
  kind: 'session';
  session: SessionId;
}

export type TimeCondition = TimeRangeCondition | DayOfWeekCondition | SessionCondition;

/**
 * セッションのプリセット時間帯（JST、DST 非考慮の目安）。
 * 由来: Neko 判断 2026-06-08。ロンドン/NY は DST で ±1h ずれるが v1 は固定 JST。
 * UI には label とともに実時間を併記して透明化する。
 */
export const SESSION_PRESETS_JST: Record<SessionId, { label: string; startMinutes: number; endMinutes: number }> = {
  tokyo: { label: '東京', startMinutes: 8 * 60, endMinutes: 17 * 60 },        // 08:00–17:00
  london: { label: 'ロンドン', startMinutes: 16 * 60, endMinutes: 1 * 60 },   // 16:00–翌01:00
  newyork: { label: 'ニューヨーク', startMinutes: 21 * 60, endMinutes: 6 * 60 }, // 21:00–翌06:00
};

/** 曜日ラベル（JST、0=日〜6=土） */
export const DAY_OF_WEEK_LABELS: readonly string[] = ['日', '月', '火', '水', '木', '金', '土'];

// JST は UTC+9（DST なし）
const JST_OFFSET_MINUTES = 9 * 60;

/** epoch(ms) から JST の「0時からの分」と「曜日(0=日)」を取り出す */
function jstPartsOf(epochMs: number): { minutes: number; day: number } {
  // UTC に +9h して getUTC* で読むと、サーバ TZ に依存せず JST の壁時計が得られる
  const shifted = new Date(epochMs + JST_OFFSET_MINUTES * 60_000);
  return {
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    day: shifted.getUTCDay(),
  };
}

/** 時間帯メンバーシップ（start<end は通常、start>end は日跨ぎ、start==end は常に false） */
function minutesInRange(minutes: number, startMinutes: number, endMinutes: number): boolean {
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) return minutes >= startMinutes && minutes < endMinutes;
  // 日跨ぎ: 22:00〜翌05:00 のように end が start より小さい
  return minutes >= startMinutes || minutes < endMinutes;
}

/**
 * 時間条件を、あるバーの timestamp(epoch ms) に対して評価する純粋関数。
 *
 * **重要**: 同一ロジックがプレビュー（本ファイル経由）とバックテスト（backend
 * strategyConditionEvaluator）で必要。フロントは src/shared を import しない構成のため、
 * backend 側にも同等のロジックを置く（compareValues の二重化と同じ方針。ドリフト注意）。
 */
export function evaluateTimeConditionAt(condition: TimeCondition, epochMs: number): boolean {
  if (!Number.isFinite(epochMs)) return false;
  const { minutes, day } = jstPartsOf(epochMs);

  let hit: boolean;
  if (condition.kind === 'time_range') {
    hit = minutesInRange(minutes, condition.startMinutes, condition.endMinutes);
  } else if (condition.kind === 'day_of_week') {
    hit = condition.days.includes(day);
  } else {
    const preset = SESSION_PRESETS_JST[condition.session];
    hit = minutesInRange(minutes, preset.startMinutes, preset.endMinutes);
  }
  return condition.negate ? !hit : hit;
}

/** 分(0-1439) を "HH:MM" にする表示ヘルパー */
export function minutesToHHMM(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** "HH:MM" を分(0-1439) にする。失敗時は null */
export function hhmmToMinutes(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

// ============================================
// レンズ条件（レンズ条件タイプ #3。柱1/柱2 合流の核）
//
// 正本設計: docs/architecture/NOTE_SIMILARITY_FOUNDATION.md §12
// 注意: lensId の形式・featureKey 集合・値種別は backend のレンズ基盤
// (src/shared/similarity/indicatorLenses.ts / lensComparators.ts) が単一情報源。
// フロントは src/shared を import しない構成のため本ファイルに UI 用カタログを
// 二重化している（evaluateTimeConditionAt と同じ方針。仕様変更時は両方を同時に直すこと）。
// ============================================

/**
 * レンズ条件の対象レンズ種別。
 * - インジケーター系（コア4種 + MA クロス）: lensId にパラメータ識別子を含む（例 `ind:rsi#p14`）
 * - 状態系（#3 第2弾、TS 計算可能な 3 種）: lensId = 種別名そのまま（例 `time_session`）
 *   ※ smc / chart_pattern / wyckoff は analysis-engine 拡張後に追加（加算的拡張）
 */
export type LensConditionKind =
  | 'rsi'
  | 'macd'
  | 'ma'
  | 'ma_cross'
  | 'bb'
  | 'time_session'
  | 'dow_theory'
  | 'volatility_regime';

/** 状態系レンズの種別集合（lensId = 種別名そのまま） */
export const STATE_LENS_CONDITION_KINDS = [
  'time_session',
  'dow_theory',
  'volatility_regime',
] as const;

/** 種別が状態系レンズかどうか（パラメータ入力なし・lensId に `#` を含まない） */
export function isStateLensKind(kind: LensConditionKind): boolean {
  return (STATE_LENS_CONDITION_KINDS as readonly string[]).includes(kind);
}

/**
 * レンズ条件の比較演算子。
 * featureKey の値種別ごとに使える演算子を制限する（enum/event/bool は =/!=、数値は </<=/>=/>）。
 */
export type LensConditionOperator = '=' | '!=' | '<' | '<=' | '>=' | '>';

/**
 * レンズ条件。柱1（ノート類似）のインジケーターレンズが出す正規化済み特徴
 * （例: `ind:rsi#p14` の `rsi_zone`）を、条件ツリーの leaf 条件として評価する。
 */
export interface LensCondition {
  /** 条件の一意ID */
  conditionId: string;
  type: 'lens';
  /** レンズ ID（パラメータ識別子込み。例 `ind:rsi#p14` / `ind:ma_cross#ema20xsma75`） */
  lensId: string;
  /** 比較する featureKey（例 `rsi_zone`） */
  featureKey: string;
  operator: LensConditionOperator;
  /** enum/event は文字列、bool は真偽値、数値系は number */
  value: number | string | boolean;
  /**
   * 直近ルックバック: 「直近 N 本以内（現在足含む）にこの条件が成立したら成立」。
   * 未指定 / 1 なら現在足のみ。timeframeOverride 指定時はその足の本数。
   */
  lookbackBars?: number;
  /** マルチタイムフレーム条件: この条件だけ別の時間足で評価する（確定バーのみ参照） */
  timeframeOverride?: MtfTimeframeApi;
}

/**
 * レンズ条件 featureKey の値種別（使える演算子と入力 UI を決める）。
 * - enum: 順序付き列挙（等価 + 順序範囲比較可。backend orderedEnum）
 * - category: 順序なし列挙（等価のみ。backend categoricalEnum、options 順 = backend values 順）
 * - event: 方向イベント bull/none/bear（等価のみ）
 * - bool / number
 */
export type LensFeatureValueKind = 'enum' | 'category' | 'event' | 'bool' | 'number';

/** enum / event 値の選択肢 */
export interface LensFeatureOption {
  value: string;
  label: string;
}

/** featureKey 1 つ分の UI 用メタデータ */
export interface LensFeatureInfo {
  key: string;
  label: string;
  valueKind: LensFeatureValueKind;
  /**
   * enum / event の選択肢（valueKind が enum/event のとき必須）。
   * **enum の並び順は backend lensComparators の orderedEnum `order` と同期させること**
   * （プレビュー評価の数値エンコードが選択肢 index を使うため。ドリフト注意）。
   */
  options?: LensFeatureOption[];
  /** number の入力範囲・刻み */
  min?: number;
  max?: number;
  step?: number;
  /** 条件作成時の既定値 */
  defaultValue: number | string | boolean;
  /**
   * 「該当なし」を表す番兵値（例 bars_since 系の -1 = イベント未発生）。
   * プレビュー評価で系列値がこの値のとき比較せず不成立に倒す（backend と同挙動）。
   */
  sentinel?: number;
  /** 値の意味の補足説明 */
  description?: string;
}

/** 方向イベント（クロス / ダイバージェンス）の共通選択肢 */
const LENS_EVENT_OPTIONS: LensFeatureOption[] = [
  { value: 'bull', label: '強気（上抜け/強気ダイバー）' },
  { value: 'none', label: 'なし' },
  { value: 'bear', label: '弱気（下抜け/弱気ダイバー）' },
];

/** レンズ種別の表示情報 */
export const LENS_CONDITION_KIND_INFO: Record<LensConditionKind, { label: string }> = {
  rsi: { label: 'RSI レンズ' },
  macd: { label: 'MACD レンズ' },
  ma: { label: '移動平均レンズ' },
  ma_cross: { label: 'MA クロスレンズ' },
  bb: { label: 'ボリンジャーバンドレンズ' },
  time_session: { label: '時間帯レンズ（状態）' },
  dow_theory: { label: 'ダウ理論レンズ（状態）' },
  volatility_regime: { label: 'ボラティリティレンズ（状態）' },
};

/**
 * レンズ種別ごとの featureKey カタログ（backend lensComparators の
 * IND_*_DEFINITION / INDICATOR_LENS_FEATURE_KEYS と同期。ドリフト注意）。
 */
export const LENS_FEATURE_INFO: Record<LensConditionKind, LensFeatureInfo[]> = {
  rsi: [
    {
      key: 'rsi_zone',
      label: 'RSI ゾーン',
      valueKind: 'enum',
      options: [
        { value: 'oversold', label: '売られすぎ（≤30）' },
        { value: 'neutral', label: '中立' },
        { value: 'overbought', label: '買われすぎ（≥70）' },
      ],
      defaultValue: 'oversold',
    },
    {
      key: 'rsi_value',
      label: 'RSI 値（0〜1 正規化）',
      valueKind: 'number',
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 0.3,
      description: 'RSI を 100 で割った値（例: RSI 30 = 0.3）',
    },
    { key: 'rsi_divergence', label: 'RSI ダイバージェンス', valueKind: 'event', options: LENS_EVENT_OPTIONS, defaultValue: 'bull' },
  ],
  macd: [
    {
      key: 'macd_cross',
      label: 'MACD クロス（直近5本以内）',
      valueKind: 'event',
      options: [
        { value: 'bull', label: 'ゴールデンクロス' },
        { value: 'none', label: 'なし' },
        { value: 'bear', label: 'デッドクロス' },
      ],
      defaultValue: 'bull',
    },
    {
      key: 'macd_bars_since_cross',
      label: 'クロスからの経過バー数',
      valueKind: 'number',
      min: 0,
      max: 20,
      step: 1,
      defaultValue: 5,
      sentinel: -1,
      description: '直近 20 本以内にクロスが無い場合は条件不成立',
    },
    {
      key: 'macd_hist_slope',
      label: 'ヒストグラム傾き（-1〜1）',
      valueKind: 'number',
      min: -1,
      max: 1,
      step: 0.05,
      defaultValue: 0,
    },
    { key: 'macd_divergence', label: 'MACD ダイバージェンス', valueKind: 'event', options: LENS_EVENT_OPTIONS, defaultValue: 'bull' },
  ],
  ma: [
    {
      key: 'ma_slope',
      label: 'MA 傾き（-1〜1）',
      valueKind: 'number',
      min: -1,
      max: 1,
      step: 0.05,
      defaultValue: 0,
      description: 'プラス = 上向き、マイナス = 下向き',
    },
    {
      key: 'ma_distance_norm',
      label: '価格と MA の乖離（-1〜1）',
      valueKind: 'number',
      min: -1,
      max: 1,
      step: 0.05,
      defaultValue: 0,
      description: 'プラス = 価格が MA より上、マイナス = 下',
    },
  ],
  ma_cross: [
    {
      key: 'ma_cross',
      label: 'MA クロス（直近5本以内）',
      valueKind: 'event',
      options: [
        { value: 'bull', label: 'ゴールデンクロス' },
        { value: 'none', label: 'なし' },
        { value: 'bear', label: 'デッドクロス' },
      ],
      defaultValue: 'bull',
    },
    {
      key: 'ma_bars_since_cross',
      label: 'クロスからの経過バー数',
      valueKind: 'number',
      min: 0,
      max: 20,
      step: 1,
      defaultValue: 5,
      sentinel: -1,
      description: '直近 20 本以内にクロスが無い場合は条件不成立',
    },
    { key: 'ma_fast_above_slow', label: '短期線が長期線より上', valueKind: 'bool', defaultValue: true },
  ],
  bb: [
    {
      key: 'bb_position',
      label: 'バンド内位置（0〜1）',
      valueKind: 'number',
      min: 0,
      max: 1,
      step: 0.05,
      defaultValue: 0.2,
      description: '0 = 下限バンド、0.5 = 中央、1 = 上限バンド',
    },
    {
      key: 'bb_width_norm',
      label: 'バンド幅（0〜1 正規化）',
      valueKind: 'number',
      min: 0,
      max: 1,
      step: 0.05,
      defaultValue: 0.5,
      description: '0 に近いほどスクイーズ（収縮）',
    },
  ],
  // --- 状態系レンズ (#3 第2弾、TS 計算可能な 3 種。値は直近 150 本の窓で見た状態) ---
  time_session: [
    { key: 'tokyo_active', label: '東京時間', valueKind: 'bool', defaultValue: true },
    { key: 'london_active', label: 'ロンドン時間', valueKind: 'bool', defaultValue: true },
    { key: 'ny_active', label: 'NY 時間', valueKind: 'bool', defaultValue: true },
    { key: 'overlap_london_ny', label: 'ロンドン×NY 重複時間', valueKind: 'bool', defaultValue: true },
    { key: 'overlap_tokyo_london', label: '東京×ロンドン 重複時間', valueKind: 'bool', defaultValue: true },
    { key: 'is_weekend', label: '週末', valueKind: 'bool', defaultValue: false },
    { key: 'is_monday_open', label: '月曜オープン直後', valueKind: 'bool', defaultValue: true },
    { key: 'is_friday_close', label: '金曜クローズ前', valueKind: 'bool', defaultValue: false },
    { key: 'is_tokyo_lunch', label: '東京ランチタイム', valueKind: 'bool', defaultValue: false },
    {
      key: 'minutes_since_tokyo_open',
      label: '東京オープンからの分数',
      valueKind: 'number',
      min: 0,
      max: 480,
      step: 5,
      defaultValue: 60,
      sentinel: -1,
      description: 'セッション外は条件不成立',
    },
    {
      key: 'minutes_since_london_open',
      label: 'ロンドンオープンからの分数',
      valueKind: 'number',
      min: 0,
      max: 480,
      step: 5,
      defaultValue: 60,
      sentinel: -1,
      description: 'セッション外は条件不成立',
    },
    {
      key: 'minutes_since_ny_open',
      label: 'NY オープンからの分数',
      valueKind: 'number',
      min: 0,
      max: 480,
      step: 5,
      defaultValue: 60,
      sentinel: -1,
      description: 'セッション外は条件不成立',
    },
  ],
  dow_theory: [
    {
      key: 'trend_state',
      label: 'トレンド状態',
      valueKind: 'category',
      // 並びは backend lensComparators の values と同期 (ドリフト注意)
      options: [
        { value: 'uptrend', label: '上昇トレンド' },
        { value: 'downtrend', label: '下降トレンド' },
        { value: 'range', label: 'レンジ' },
        { value: 'unclear', label: '不明確' },
      ],
      defaultValue: 'uptrend',
    },
    {
      key: 'trend_phase',
      label: 'トレンド段階',
      valueKind: 'enum',
      options: [
        { value: 'early', label: '初期' },
        { value: 'middle', label: '中期' },
        { value: 'late', label: '後期' },
      ],
      defaultValue: 'early',
      description: 'トレンドが不明確なバーは条件不成立',
    },
    { key: 'recent_higher_high', label: '直近の高値切り上げ', valueKind: 'bool', defaultValue: true },
    { key: 'recent_higher_low', label: '直近の安値切り上げ', valueKind: 'bool', defaultValue: true },
    { key: 'recent_lower_high', label: '直近の高値切り下げ', valueKind: 'bool', defaultValue: true },
    { key: 'recent_lower_low', label: '直近の安値切り下げ', valueKind: 'bool', defaultValue: true },
    {
      key: 'bars_since_last_high',
      label: '直近ピボット高値からのバー数',
      valueKind: 'number',
      min: 0,
      max: 50,
      step: 1,
      defaultValue: 5,
      sentinel: -1,
      description: 'ピボット未検出のバーは条件不成立',
    },
    {
      key: 'bars_since_last_low',
      label: '直近ピボット安値からのバー数',
      valueKind: 'number',
      min: 0,
      max: 50,
      step: 1,
      defaultValue: 5,
      sentinel: -1,
      description: 'ピボット未検出のバーは条件不成立',
    },
    {
      key: 'trend_duration_bars',
      label: 'トレンド継続バー数',
      valueKind: 'number',
      min: 0,
      max: 60,
      step: 1,
      defaultValue: 10,
    },
    { key: 'pullback_active', label: '押し目/戻り目 形成中', valueKind: 'bool', defaultValue: true },
    {
      key: 'pullback_depth_pct',
      label: '押し/戻りの深さ（%）',
      valueKind: 'number',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 30,
      description: '直近トレンド幅に対する割合',
    },
  ],
  volatility_regime: [
    {
      key: 'regime_label',
      label: 'ボラティリティ状態',
      valueKind: 'enum',
      // 並びは backend orderedEnum の order と同期 (ドリフト注意)
      options: [
        { value: 'contracting', label: '収縮' },
        { value: 'low', label: '低' },
        { value: 'normal', label: '通常' },
        { value: 'elevated', label: '高' },
        { value: 'expanding', label: '拡大' },
      ],
      defaultValue: 'contracting',
      description: 'BB 幅パーセンタイルによる区分',
    },
    {
      key: 'bb_width_percentile',
      label: 'BB 幅パーセンタイル（0〜100）',
      valueKind: 'number',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 20,
      description: '直近 100 本の中での現在 BB 幅の位置',
    },
    {
      key: 'atr_percentile',
      label: 'ATR パーセンタイル（0〜100）',
      valueKind: 'number',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 50,
    },
    {
      key: 'atr_change_rate',
      label: 'ATR 変化率',
      valueKind: 'number',
      min: -1,
      max: 1,
      step: 0.05,
      defaultValue: 0.1,
      description: '直近 5 本前との比（0.1 = +10%）',
    },
    { key: 'is_squeeze', label: 'スクイーズ中', valueKind: 'bool', defaultValue: true },
    { key: 'is_expanding', label: '拡大中', valueKind: 'bool', defaultValue: true },
    {
      key: 'bars_in_current_regime',
      label: '現在の状態の継続バー数',
      valueKind: 'number',
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 10,
    },
  ],
};

/** 値種別ごとに許可する演算子（設計書 §12.4-6） */
export function lensOperatorsForValueKind(valueKind: LensFeatureValueKind): LensConditionOperator[] {
  if (valueKind === 'number') {
    return ['<', '<=', '>=', '>'];
  }
  if (valueKind === 'enum') {
    // 順序付き enum（例 RSI ゾーン: 売られすぎ < 中立 < 買われすぎ）は順序範囲比較も許可する。
    // 数値エンコードが選択肢 index（= backend orderedEnum の順序 index）のため大小比較が成立する
    return ['=', '!=', '<', '<=', '>=', '>'];
  }
  // category（順序なし列挙）/ event（方向イベント）/ bool は等価比較のみ
  // （カテゴリ index や bull=1/none=0/bear=-1 の大小に意味を持たせない）
  return ['=', '!='];
}

/** レンズ条件演算子の表示ラベル */
export const LENS_OPERATOR_INFO: Record<LensConditionOperator, string> = {
  '=': 'が一致',
  '!=': 'が不一致',
  '<': 'より小さい',
  '<=': '以下',
  '>=': '以上',
  '>': 'より大きい',
};

/** MA 種別（lensId のパラメータ識別子に使う） */
export type LensMaType = 'sma' | 'ema';

/** lensId 組み立てに使うパラメータ群（種別ごとに使うキーが異なる） */
export interface LensIdParams {
  period?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  maType?: LensMaType;
  fastMaType?: LensMaType;
  fastMaPeriod?: number;
  slowMaType?: LensMaType;
  slowMaPeriod?: number;
}

/** 期間入力の正規化（不正値は fallback、整数化。backend normalizePeriod と同じ規則） */
function normalizeLensPeriod(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return fallback;
  return Math.round(value);
}

/**
 * レンズ種別 + パラメータから lensId を組み立てる。
 * backend resolveIndicatorLensSpecs / parseIndicatorLensId の形式と一致させること（ドリフト注意）:
 * `ind:rsi#p14` / `ind:macd#f12s26g9` / `ind:ma#ema20` / `ind:ma_cross#ema20xsma75` / `ind:bb#p20`
 */
export function buildLensId(kind: LensConditionKind, params: LensIdParams): string {
  switch (kind) {
    // 状態系レンズは lensId = 種別名そのまま（パラメータなし。backend カタログのキーと一致）
    case 'time_session':
    case 'dow_theory':
    case 'volatility_regime':
      return kind;
    case 'rsi':
      return `ind:rsi#p${normalizeLensPeriod(params.period, 14)}`;
    case 'macd':
      return (
        `ind:macd#f${normalizeLensPeriod(params.fastPeriod, 12)}` +
        `s${normalizeLensPeriod(params.slowPeriod, 26)}` +
        `g${normalizeLensPeriod(params.signalPeriod, 9)}`
      );
    case 'ma':
      return `ind:ma#${params.maType ?? 'ema'}${normalizeLensPeriod(params.period, 20)}`;
    case 'ma_cross':
      return (
        `ind:ma_cross#${params.fastMaType ?? 'ema'}${normalizeLensPeriod(params.fastMaPeriod, 20)}` +
        `x${params.slowMaType ?? 'ema'}${normalizeLensPeriod(params.slowMaPeriod, 75)}`
      );
    case 'bb':
      return `ind:bb#p${normalizeLensPeriod(params.period, 20)}`;
  }
}

/** lensId を編集 UI 用に分解する。不正な形式は null（UI はフォールバック表示） */
export function parseLensIdForEdit(
  lensId: string
): { kind: LensConditionKind; params: LensIdParams } | null {
  // 状態系レンズ（lensId = 種別名そのまま、パラメータなし）
  if ((STATE_LENS_CONDITION_KINDS as readonly string[]).includes(lensId)) {
    return { kind: lensId as LensConditionKind, params: {} };
  }
  const match = /^ind:([a-z_]+)#(.+)$/.exec(lensId);
  if (!match) return null;
  const kind = match[1];
  const paramKey = match[2];
  switch (kind) {
    case 'rsi':
    case 'bb': {
      const m = /^p(\d+)$/.exec(paramKey);
      return m ? { kind, params: { period: Number.parseInt(m[1], 10) } } : null;
    }
    case 'macd': {
      const m = /^f(\d+)s(\d+)g(\d+)$/.exec(paramKey);
      return m
        ? {
            kind,
            params: {
              fastPeriod: Number.parseInt(m[1], 10),
              slowPeriod: Number.parseInt(m[2], 10),
              signalPeriod: Number.parseInt(m[3], 10),
            },
          }
        : null;
    }
    case 'ma': {
      const m = /^(sma|ema)(\d+)$/.exec(paramKey);
      return m
        ? { kind, params: { maType: m[1] as LensMaType, period: Number.parseInt(m[2], 10) } }
        : null;
    }
    case 'ma_cross': {
      const m = /^(sma|ema)(\d+)x(sma|ema)(\d+)$/.exec(paramKey);
      return m
        ? {
            kind,
            params: {
              fastMaType: m[1] as LensMaType,
              fastMaPeriod: Number.parseInt(m[2], 10),
              slowMaType: m[3] as LensMaType,
              slowMaPeriod: Number.parseInt(m[4], 10),
            },
          }
        : null;
    }
    default:
      return null;
  }
}

/** featureKey の UI メタデータを引く（未知キーは undefined） */
export function getLensFeatureInfo(
  kind: LensConditionKind,
  featureKey: string
): LensFeatureInfo | undefined {
  return LENS_FEATURE_INFO[kind].find((info) => info.key === featureKey);
}

/**
 * レンズ系列のキャッシュキー（backend `makeLensCacheKey` と同一規約 `lens:<lensId>:<featureKey>`。
 * フロントは src/shared を import しない構成のためミラー。仕様変更時は両方を直すこと）。
 */
export function makeLensConditionCacheKey(lensId: string, featureKey: string): string {
  return `lens:${lensId}:${featureKey}`;
}

/** 方向イベント値の数値エンコード表（backend と同一: bull=1 / none=0 / bear=-1） */
const LENS_EVENT_VALUE_ENCODING: Record<string, number> = { bull: 1, none: 0, bear: -1 };

/**
 * レンズ条件の比較値を、バックエンドが返す「数値エンコード済みレンズ系列」と同じ規約で
 * 数値化する（プレビュー評価用。backend `encodeLensFeatureValueAsNumber` のミラー。ドリフト注意）。
 * - enum: 選択肢 options の index（並びは backend orderedEnum の order と同期している前提）
 * - event: bull=1 / none=0 / bear=-1
 * - bool: true=1 / false=0
 * - number: 有限値をそのまま
 * エンコード不能（型不一致・未知値）は null = 比較不能（条件不成立に倒す）。
 */
export function encodeLensConditionValue(
  info: LensFeatureInfo,
  value: number | string | boolean
): number | null {
  switch (info.valueKind) {
    case 'bool':
      return typeof value === 'boolean' ? (value ? 1 : 0) : null;
    case 'enum':
    case 'category': {
      // enum = backend orderedEnum の order 順 / category = backend categoricalEnum の values 順。
      // どちらも options の index がエンコード値（並びの同期が前提。ドリフト注意）
      if (typeof value !== 'string' || !info.options) return null;
      const index = info.options.findIndex((o) => o.value === value);
      return index >= 0 ? index : null;
    }
    case 'event':
      // own property のみ許可 (constructor/toString 等の継承プロパティを拾うと
      // 未知値が null にならず比較が誤成立するため。Copilot レビュー対応 PR #400)
      return typeof value === 'string' &&
        Object.prototype.hasOwnProperty.call(LENS_EVENT_VALUE_ENCODING, value)
        ? LENS_EVENT_VALUE_ENCODING[value]
        : null;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
}

/**
 * 論理演算子の表示情報
 */
export const LOGICAL_OPERATOR_INFO: Record<LogicalOperator, { label: string; description: string }> = {
  AND: { label: 'かつ', description: 'すべての条件を満たす' },
  OR: { label: 'または', description: 'いずれかの条件を満たす' },
  NOT: { label: '〜でない', description: '条件を満たさない' },
  IF_THEN: { label: 'IF→THEN', description: 'IF条件成立後にTHEN条件を評価' },
  SEQUENCE: { label: '順序', description: '条件が順番に成立する' },
};

// ============================================
// インジケーター条件
// ============================================

/**
 * インジケーターのフィールド（出力値）
 * インジケーターごとに異なるフィールドを持つ
 */
export type IndicatorField = 
  | 'value'     // 単一値（RSI, ATR など）
  | 'macd'      // MACD線
  | 'signal'    // シグナル線
  | 'histogram' // ヒストグラム
  | 'upper'     // 上バンド（BB, KC）
  | 'middle'    // 中央線
  | 'lower'     // 下バンド
  | 'k'         // %K（ストキャスティクス）
  | 'd'         // %D
  | 'tenkan'    // 転換線（一目均衡表）
  | 'kijun'     // 基準線
  | 'senkouA'   // 先行スパンA
  | 'senkouB'   // 先行スパンB
  | 'chikou';   // 遅行スパン

/**
 * インジケーターごとの利用可能フィールド
 */
export const INDICATOR_FIELDS: Record<IndicatorId, IndicatorField[]> = {
  rsi: ['value'],
  sma: ['value'],
  ema: ['value'],
  macd: ['macd', 'signal', 'histogram'],
  bb: ['upper', 'middle', 'lower'],
  atr: ['value'],
  stochastic: ['k', 'd'],
  obv: ['value'],
  vwap: ['value'],
  williamsR: ['value'],
  cci: ['value'],
  aroon: ['value'], // aroonUp, aroonDown は簡略化
  roc: ['value'],
  mfi: ['value'],
  cmf: ['value'],
  dema: ['value'],
  tema: ['value'],
  kc: ['upper', 'middle', 'lower'],
  psar: ['value'],
  ichimoku: ['tenkan', 'kijun', 'senkouA', 'senkouB', 'chikou'],
};

/**
 * フィールド表示名
 */
export const FIELD_LABELS: Record<IndicatorField, string> = {
  value: '値',
  macd: 'MACD線',
  signal: 'シグナル線',
  histogram: 'ヒストグラム',
  upper: '上バンド',
  middle: '中央線',
  lower: '下バンド',
  k: '%K',
  d: '%D',
  tenkan: '転換線',
  kijun: '基準線',
  senkouA: '先行スパンA',
  senkouB: '先行スパンB',
  chikou: '遅行スパン',
};

/**
 * 比較対象の種類
 */
export type CompareTargetType = 'fixed' | 'indicator' | 'price';

/**
 * 比較対象（固定値）
 */
export interface FixedValueTarget {
  type: 'fixed';
  value: number;
}

/**
 * 比較対象（別のインジケーター）
 */
export interface IndicatorTarget {
  type: 'indicator';
  indicatorId: IndicatorId;
  params: IndicatorParams;
  field: IndicatorField;
}

/**
 * 比較対象（価格）
 */
export interface PriceTarget {
  type: 'price';
  priceType: 'open' | 'high' | 'low' | 'close';
}

/**
 * 比較対象の共用型
 */
export type CompareTarget = FixedValueTarget | IndicatorTarget | PriceTarget;

/**
 * 単一のインジケーター条件
 */
export interface IndicatorCondition {
  /** 条件の一意ID */
  conditionId: string;
  /** 左辺: インジケーターID */
  indicatorId: IndicatorId;
  /** 左辺: インジケーターパラメータ */
  params: IndicatorParams;
  /** 左辺: インジケーターのフィールド */
  field: IndicatorField;
  /** 比較演算子 */
  operator: ComparisonOperator;
  /** 右辺: 比較対象（between では下限） */
  compareTarget: CompareTarget;
  /** between / not_between 専用: 上限。未指定なら範囲判定は不成立 */
  compareTargetUpper?: CompareTarget;
  /**
   * 直近ルックバック: 「直近 N 本以内（現在足含む）にこの条件が成立したら成立」。
   * 未指定 / 1 なら現在足のみ（通常挙動）。timeframeOverride 指定時はその足の本数。
   */
  lookbackBars?: number;
  /**
   * マルチタイムフレーム条件 (Phase γ): この条件だけ別の時間足で評価する。
   * 未指定 = ストラテジーの基準足。上位足 (1d/1w 含む) は確定バーのみ参照される。
   */
  timeframeOverride?: MtfTimeframeApi;
}

// ============================================
// 条件グループ（再帰的構造）
// ============================================

/**
 * 条件グループ（複数条件を論理演算子で結合）
 */
export interface ConditionGroup {
  /** グループの一意ID */
  groupId: string;
  /** 論理演算子 */
  operator: LogicalOperator;
  /** 子要素（条件 or サブグループ） */
  conditions: (IndicatorCondition | PatternCondition | TimeCondition | LensCondition | ConditionGroup)[];

  /** SEQUENCE専用: 各ステップ間の最大バー数（未指定なら evaluator 側のデフォルト） */
  maxBarsBetweenSteps?: number;

  /** IF-THEN専用（将来拡張） */
  ifCondition?: ConditionGroup | IndicatorCondition | PatternCondition | LensCondition;
  thenCondition?: ConditionGroup | IndicatorCondition | PatternCondition | LensCondition;
  maxBarsToWait?: number;
}

/**
 * 条件がIndicatorConditionかどうかを判定する型ガード
 */
export function isIndicatorCondition(
  condition: IndicatorCondition | PatternCondition | TimeCondition | LensCondition | ConditionGroup
): condition is IndicatorCondition {
  return 'indicatorId' in condition;
}

export function isPatternCondition(
  condition: IndicatorCondition | PatternCondition | TimeCondition | LensCondition | ConditionGroup
): condition is PatternCondition {
  return 'type' in condition && (condition as { type?: string }).type === 'pattern';
}

/**
 * 条件が TimeCondition かどうかを判定する型ガード。
 * 注意: indicator/pattern/group のいずれにも該当しないので、評価・描画では
 * group フォールバックより前に必ずこのガードを通すこと。
 */
export function isTimeCondition(
  condition: IndicatorCondition | PatternCondition | TimeCondition | LensCondition | ConditionGroup
): condition is TimeCondition {
  return 'type' in condition && (condition as { type?: string }).type === 'time';
}

/**
 * 条件が LensCondition かどうかを判定する型ガード（レンズ条件タイプ #3）。
 * time 条件と同様、group フォールバックより前に必ずこのガードを通すこと。
 */
export function isLensCondition(
  condition: IndicatorCondition | PatternCondition | TimeCondition | LensCondition | ConditionGroup
): condition is LensCondition {
  return 'type' in condition && (condition as { type?: string }).type === 'lens';
}

/**
 * 条件がConditionGroupかどうかを判定する型ガード
 */
export function isConditionGroup(
  condition: IndicatorCondition | PatternCondition | TimeCondition | LensCondition | ConditionGroup
): condition is ConditionGroup {
  return 'conditions' in condition;
}

// ============================================
// エントリー・イグジット設定
// ============================================

/**
 * エントリータイミング
 */
export type EntryTiming =
  | 'next_open'     // 次足始値（デフォルト）
  | 'current_close'; // 現足終値（現足エントリーの近似）

/**
 * TP/SL の単位
 */
export type ExitUnit = 'percent' | 'pips';

/**
 * イグジット設定
 */
export interface ExitSettings {
  /** 利確（Take Profit） */
  takeProfit: {
    value: number;
    unit: ExitUnit;
  };
  /** 損切（Stop Loss） */
  stopLoss: {
    value: number;
    unit: ExitUnit;
  };
  /** 最大保有時間（分）- オプション */
  maxHoldingMinutes?: number;
}

// ============================================
// ストラテジー本体
// ============================================

/**
 * トレード方向（ストラテジー用）
 * - 'buy'  : 買いのみ（Buy Only）。entryConditions を買い条件として使う
 * - 'sell' : 売りのみ（Sell Only）。entryConditions を売り条件として使う
 * - 'both' : 買い+売り（Buy & Sell）。entryConditions=買い条件 / shortEntryConditions=売り条件 を
 *            それぞれ独立に評価し、発火した側でエントリーする。
 *            ※「両建て」（逆ポジ同時保有によるヘッジ）とは別概念。本モデルは同時保有を前提にしない。
 */
export type StrategyDirection = 'buy' | 'sell' | 'both';

/**
 * ストラテジーの対象時間足（API 文字列）。
 *
 * **単一ソース**: UI の時間足セレクタ (`marketConstants.TIMEFRAME_OPTIONS`) の `api` 値に一致させる
 * （= フロントで選べる集合そのもの）。手書きユニオンだと UI と齟齬が出る（例: 型に 1d があるのに
 * セレクタに無い）ため `TimeframeApi` を参照する。バックテストのステージ足 (`BacktestTimeframe`) は
 * 1d を含む別集合なので、こことは意図的に分離している。
 */
export type StrategyTimeframe = TimeframeApi;

/**
 * トレード方向（バックテスト/イベント用）
 */
export type TradeSide = 'buy' | 'sell';

/**
 * ストラテジーステータス
 */
export type StrategyStatus = 'draft' | 'active' | 'archived';

/**
 * ストラテジーバージョン（履歴保存用）
 */
export interface StrategyVersion {
  /** バージョンID（APIからの応答） */
  id: string;
  /** バージョン番号（1, 2, 3...） */
  versionNumber: number;
  /** エントリー条件（side=both では「買い用」） */
  entryConditions: ConditionGroup;
  /** 売り用エントリー条件（side=both のときのみ。買い=entryConditions と対） */
  shortEntryConditions?: ConditionGroup | null;
  /** イグジット設定 */
  exitSettings: ExitSettings;
  /** エントリータイミング */
  entryTiming: EntryTiming;
  /** 作成日時 */
  createdAt: string;
  /** 変更理由メモ（オプション） */
  changeNote?: string | null;
}

/**
 * ストラテジー（メインエンティティ）
 */
export interface Strategy {
  /** ストラテジーID */
  id: string;
  /** ストラテジー名 */
  name: string;
  /** 説明 */
  description?: string;
  /** 対象シンボル */
  symbol: SupportedSymbol;
  /** 対象時間足（レガシーストラテジーは null） */
  timeframe: StrategyTimeframe | null;
  /** トレード方向 */
  side: StrategyDirection;
  /** ステータス */
  status: StrategyStatus;
  /** 現在のバージョンID */
  currentVersionId: string;
  /** 現在のバージョン（展開済み） */
  currentVersion: StrategyVersion;
  /** バージョン履歴 */
  versions: StrategyVersion[];
  /** 作成日時 */
  createdAt: string;
  /** 更新日時 */
  updatedAt: string;
  /** タグ */
  tags?: string[];
}

// ============================================
// API リクエスト/レスポンス型
// ============================================

/**
 * ストラテジー作成リクエスト
 */
export interface CreateStrategyRequest {
  name: string;
  description?: string;
  symbol: SupportedSymbol;
  timeframe: StrategyTimeframe;
  side: StrategyDirection;
  entryConditions: ConditionGroup;
  /** side=both のときのみ必須（売り用条件） */
  shortEntryConditions?: ConditionGroup;
  exitSettings: ExitSettings;
  entryTiming?: EntryTiming;
  tags?: string[];
}

/**
 * ストラテジー更新リクエスト
 */
export interface UpdateStrategyRequest {
  name?: string;
  description?: string;
  symbol?: SupportedSymbol;
  timeframe?: StrategyTimeframe;
  side?: StrategyDirection;
  entryConditions?: ConditionGroup;
  shortEntryConditions?: ConditionGroup;
  exitSettings?: ExitSettings;
  entryTiming?: EntryTiming;
  status?: StrategyStatus;
  tags?: string[];
  changeNote?: string;
}

/**
 * ストラテジー一覧のサマリー
 */
export interface StrategySummary {
  id: string;
  name: string;
  symbol: SupportedSymbol;
  timeframe: StrategyTimeframe | null;
  side: StrategyDirection;
  status: StrategyStatus;
  versionCount: number;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

/**
 * ストラテジー一覧取得パラメータ
 */
export interface FetchStrategiesParams {
  status?: StrategyStatus;
  symbol?: SupportedSymbol;
  limit?: number;
}

// ============================================
// ユーティリティ関数
// ============================================

/**
 * 新しい条件IDを生成
 */
export function generateConditionId(): string {
  return `cond_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 新しいグループIDを生成
 */
export function generateGroupId(): string {
  return `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * デフォルトの単一条件を生成
 */
export function createDefaultCondition(): IndicatorCondition {
  return {
    conditionId: generateConditionId(),
    indicatorId: 'rsi',
    params: { period: 14 },
    field: 'value',
    operator: '<',
    compareTarget: { type: 'fixed', value: 30 },
  };
}

/**
 * デフォルトのレンズ条件を生成（RSI ゾーン = 売られすぎ）
 */
export function createDefaultLensCondition(): LensCondition {
  return {
    conditionId: generateConditionId(),
    type: 'lens',
    lensId: buildLensId('rsi', { period: 14 }),
    featureKey: 'rsi_zone',
    operator: '=',
    value: 'oversold',
  };
}

/**
 * デフォルトの条件グループを生成
 */
export function createDefaultConditionGroup(): ConditionGroup {
  return {
    groupId: generateGroupId(),
    operator: 'AND',
    conditions: [createDefaultCondition()],
  };
}

/**
 * デフォルトのイグジット設定を生成
 */
export function createDefaultExitSettings(): ExitSettings {
  return {
    takeProfit: { value: 1.0, unit: 'percent' },
    stopLoss: { value: 0.5, unit: 'percent' },
    maxHoldingMinutes: undefined,
  };
}

// ============================================
// 接合点ごとの論理演算子（フラット ⇄ ツリー変換）
// ============================================

/**
 * 子要素（条件 / パターン / サブグループ）の共用型。
 * ConditionGroup.conditions の要素と同じ。
 */
export type ConditionChild = IndicatorCondition | PatternCondition | TimeCondition | LensCondition | ConditionGroup;

/**
 * 接合点ごとに AND/OR を選べるフラット表現。
 *
 * - `items[i]` と `items[i+1]` の結合子が `junctions[i]`（長さは items.length - 1）。
 * - ここで扱う結合子は AND / OR のみ。NOT / IF_THEN / SEQUENCE はグループ単位の
 *   意味を持つため接合点モデルには載せず、編集 UI 側で従来の単一演算子表示にフォールバックする。
 *
 * 目的: UI 上は「接合点ごとに AND/OR」を見せつつ、保存・評価は従来どおりツリー
 * （OR を外・AND を内とする標準的なブール優先順位）に正規化することで、評価器・DB・API を無改修に保つ。
 */
export interface FlatConditionList {
  items: ConditionChild[];
  /** AND / OR のみ。長さは items.length - 1 */
  junctions: ('AND' | 'OR')[];
}

/**
 * フラット表現に展開可能なグループかどうか。
 * AND / OR のみ展開可能（NOT / IF_THEN / SEQUENCE は従来 UI で扱う）。
 */
export function isFlattenableGroup(group: ConditionGroup): boolean {
  return group.operator === 'AND' || group.operator === 'OR';
}

/**
 * AND グループの子要素を結合則で平坦化して列挙する。
 * 理由: `AND(A, AND(B, C))` は `AND(A, B, C)` と等価なので、入れ子の AND は 1 列に潰す。
 * OR グループや NOT/IF_THEN/SEQUENCE、リーフ条件はそのまま 1 要素（ブロック）として残す。
 */
function collectAndItems(group: ConditionGroup): ConditionChild[] {
  const items: ConditionChild[] = [];
  for (const child of group.conditions) {
    if (isConditionGroup(child) && child.operator === 'AND') {
      items.push(...collectAndItems(child));
    } else {
      items.push(child);
    }
  }
  return items;
}

/**
 * OR グループを「AND ラン（= AND で繋がった要素の並び）」の配列に展開する。
 * 各 AND ランが OR の 1 アームに対応する。
 * 理由: 表示・編集では OR を最外（低優先）、AND を内（高優先）に固定したいため。
 */
function collectOrArms(group: ConditionGroup): ConditionChild[][] {
  const arms: ConditionChild[][] = [];
  for (const child of group.conditions) {
    if (isConditionGroup(child) && child.operator === 'OR') {
      // OR の入れ子は結合則で平坦化
      arms.push(...collectOrArms(child));
    } else if (isConditionGroup(child) && child.operator === 'AND') {
      // AND サブグループ → 1 つの AND ラン
      arms.push(collectAndItems(child));
    } else {
      // リーフ / OR ブロック / NOT 等 → 単独アーム
      arms.push([child]);
    }
  }
  return arms;
}

/**
 * 条件グループを接合点ごとの AND/OR を持つフラット表現に変換する。
 *
 * AND/OR ツリー（OR-of-AND 標準形を含む）を、`items` の一次元列 + 接合点 `junctions` に展開する。
 * 同じ AND ラン内は 'AND'、ラン境界（OR アームの切れ目）は 'OR' になる。
 * 空アームは捨てる（編集途中の空グループでも phantom な接合点を作らない）。
 */
export function flattenConditionGroup(group: ConditionGroup): FlatConditionList {
  const arms = (group.operator === 'OR' ? collectOrArms(group) : [collectAndItems(group)])
    .filter((arm) => arm.length > 0);

  const items: ConditionChild[] = [];
  const junctions: ('AND' | 'OR')[] = [];
  arms.forEach((arm) => {
    arm.forEach((item, indexInArm) => {
      if (items.length > 0) {
        // アーム先頭は OR（前アームとの境界）、それ以外は AND
        junctions.push(indexInArm === 0 ? 'OR' : 'AND');
      }
      items.push(item);
    });
  });
  return { items, junctions };
}

/**
 * フラット表現を標準形ツリー（OR を外・AND を内）に正規化する。
 *
 * - OR で区切って AND ランに分割し、ラン内を AND グループ、ラン同士を OR グループで束ねる。
 * - 単一ランなら AND グループ 1 つ（リーフ 1 個でも AND グループで包む）。
 * - 複数ランなら OR グループ。長さ 1 のアームは AND で包まず子要素を直接 OR の下に置く。
 *
 * 評価器は `operator` と `conditions` のみ読むため、この標準形なら従来どおり正しく評価される。
 * AND ラッパーの groupId は `${baseGroupId}__and${armIndex}` で armIndex から決定的に導出する
 * （= 同じフラット構成なら毎回同じ ID。接合点の切り替え等でアーム構成が変わると ID も変わるが、
 * このラッパー ID は React key には使わず（key はリーフの conditionId）、評価にも影響しないため無害）。
 *
 * @param flat - フラット表現
 * @param baseGroupId - 生成するルートグループの groupId（元グループのものを引き継ぐ）
 */
export function normalizeFlatConditions(
  flat: FlatConditionList,
  baseGroupId: string,
): ConditionGroup {
  const { items, junctions } = flat;

  // OR を境界に AND ランへ分割
  const arms: ConditionChild[][] = [];
  let current: ConditionChild[] = [];
  items.forEach((item, i) => {
    if (i > 0 && junctions[i - 1] === 'OR') {
      arms.push(current);
      current = [];
    }
    current.push(item);
  });
  if (current.length > 0) arms.push(current);

  // 空 or 単一ラン → AND グループ（空グループも許容）
  if (arms.length <= 1) {
    return { groupId: baseGroupId, operator: 'AND', conditions: arms[0] ?? [] };
  }

  // 複数ラン → OR グループ。各アームは長さ>1なら AND サブグループ、1ならそのまま子に置く。
  return {
    groupId: baseGroupId,
    operator: 'OR',
    conditions: arms.map((arm, armIndex) =>
      arm.length === 1
        ? arm[0]
        : {
            groupId: `${baseGroupId}__and${armIndex}`,
            operator: 'AND' as LogicalOperator,
            conditions: arm,
          },
    ),
  };
}

// ============================================
// IF-THEN / SEQUENCE 専用型（Phase B）
// ============================================

/**
 * IF-THEN条件グループ
 * IF部が成立した後、指定時間内にTHEN部を評価
 */
export interface IfThenConditionGroup {
  groupId: string;
  operator: 'IF_THEN';
  /** IF部（トリガー条件） */
  ifCondition: ConditionGroup | IndicatorCondition;
  /** THEN部（確認条件） */
  thenCondition: ConditionGroup | IndicatorCondition;
  /** IF成立後、THEN評価を継続する最大バー数 */
  maxBarsToWait: number;
}

/**
 * SEQUENCE条件グループ
 * 条件が順番に成立することを要求
 */
export interface SequenceConditionGroup {
  groupId: string;
  operator: 'SEQUENCE';
  /** 順序付き条件リスト */
  sequence: (ConditionGroup | IndicatorCondition)[];
  /** 各ステップ間の最大バー数 */
  maxBarsBetweenSteps: number;
}

/**
 * 拡張条件グループ（Phase B対応）
 */
export type ExtendedConditionGroup = 
  | ConditionGroup 
  | IfThenConditionGroup 
  | SequenceConditionGroup;

/**
 * IF-THEN条件かどうかを判定する型ガード
 */
export function isIfThenConditionGroup(
  group: ExtendedConditionGroup
): group is IfThenConditionGroup {
  return 'operator' in group && group.operator === 'IF_THEN';
}

/**
 * SEQUENCE条件かどうかを判定する型ガード
 */
export function isSequenceConditionGroup(
  group: ExtendedConditionGroup
): group is SequenceConditionGroup {
  return 'operator' in group && group.operator === 'SEQUENCE';
}

// ============================================
// バックテスト関連型（Phase B）
// ============================================

/**
 * バックテストの時間足
 */
export type BacktestTimeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

/**
 * バックテストステージ
 * Stage1: 15m以上で高速スキャン
 * Stage2: 1mで精密検証
 */
export type BacktestStage = 'stage1' | 'stage2';

/**
 * バックテスト実行リクエスト
 */
export interface BacktestRequest {
  /** 対象ストラテジーID */
  strategyId: string;
  /** バックテスト期間（開始） */
  startDate: string;
  /** バックテスト期間（終了） */
  endDate: string;
  /** Stage1の時間足（15m, 30m, 1h, 4h, 1d） */
  stage1Timeframe: BacktestTimeframe;
  /** Stage2を実行するか（精密検証） */
  runStage2: boolean;
  /** 初期資金 */
  initialCapital: number;
  /** ポジションサイズ（ロット） */
  positionSize: number;
}

/**
 * バックテスト結果サマリー
 */
export interface BacktestResultSummary {
  /** 総トレード数 */
  totalTrades: number;
  /** 勝ちトレード数 */
  winningTrades: number;
  /** 負けトレード数 */
  losingTrades: number;
  /** 勝率 (%) */
  winRate: number;
  /** 純損益 */
  netProfit: number;
  /** 純損益率 (%) */
  netProfitRate: number;
  /** 最大ドローダウン */
  maxDrawdown: number;
  /** 最大ドローダウン率 (%) */
  maxDrawdownRate: number;
  /** プロフィットファクター */
  profitFactor: number;
  /** 平均利益 */
  averageWin: number;
  /** 平均損失 */
  averageLoss: number;
  /** リスクリワード比 */
  riskRewardRatio: number;
  /** 最大連勝 */
  maxConsecutiveWins: number;
  /** 最大連敗 */
  maxConsecutiveLosses: number;
  /** シャープレシオ（年率換算） */
  sharpeRatio?: number;
  /** ソルティノレシオ（下方リスクのみ考慮） */
  sortinoRatio?: number;
  /** t検定によるp値（帰無仮説: 平均リターン = 0） */
  pValue?: number;
  /** 統計的有意性（p < 0.05） */
  isStatisticallySignificant?: boolean;
  /** 信頼度レベル（トレード数ベース） */
  confidenceLevel?: 'low' | 'medium' | 'high';
  /** 停止理由（破産など） */
  stoppedReason?: 'bankruptcy' | 'completed';
  /** 最終資金残高 */
  finalCapital?: number;
}

/**
 * バックテストイベント（個別トレード）
 */
export interface BacktestTradeEvent {
  /** イベントID */
  eventId: string;
  /** エントリー日時 */
  entryTime: string;
  /** エントリー価格 */
  entryPrice: number;
  /** イグジット日時 */
  exitTime: string;
  /** イグジット価格 */
  exitPrice: number;
  /** 売買方向 */
  side: TradeSide;
  /** ポジションサイズ */
  positionSize: number;
  /** 損益 */
  pnl: number;
  /** 損益率 (%) */
  pnlPercent: number;
  /** イグジット理由 */
  exitReason: 'take_profit' | 'stop_loss' | 'timeout' | 'signal';
  /** 条件成立時のインジケーター値 */
  indicatorValues?: Record<string, number>;
}

/**
 * バックテスト実行結果
 */
export interface BacktestResult {
  /** 結果ID */
  id: string;
  /** ストラテジーID */
  strategyId: string;
  /** バージョン番号 */
  versionNumber: number;
  /** 実行日時 */
  executedAt: string;
  /** バックテスト期間（開始） */
  startDate: string;
  /** バックテスト期間（終了） */
  endDate: string;
  /** 使用した時間足 */
  timeframe: BacktestTimeframe;
  /** ステージ */
  stage: BacktestStage;
  /** 結果サマリー */
  summary: BacktestResultSummary;
  /** 個別トレードイベント */
  trades: BacktestTradeEvent[];
  /** 実行ステータス */
  status: 'running' | 'completed' | 'failed';
  /** エラーメッセージ（失敗時） */
  errorMessage?: string;
}

/**
 * バックテスト実行ステータス
 */
export interface BacktestRunStatus {
  /** 実行ID */
  runId: string;
  /** ステータス */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** 進捗率 (0-100) */
  progress: number;
  /** 現在処理中のステージ */
  currentStage?: BacktestStage;
  /** 処理済みバー数 */
  processedBars?: number;
  /** 総バー数 */
  totalBars?: number;
  /** 開始時刻 */
  startedAt?: string;
  /** 完了時刻 */
  completedAt?: string;
}
