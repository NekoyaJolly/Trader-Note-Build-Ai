/**
 * 並列レンズ基盤の型定義（Phase 1）
 *
 * 設計哲学:
 * - レンズは相場観を排他選択ではなく並列計算する抽象
 * - 各レンズは副作用なし・他レンズ非依存・決定性保証
 * - 失敗したレンズは他レンズの結果に影響を与えない（Promise.allSettled 方式）
 *
 * @see docs/design/phase_1_specification.md
 * @see docs/design/DESIGN_DOC_autonomous_trading_architecture.md セクション4
 */

import type { CandlePatternId } from '../../shared/patterns';
import type { MarketAnalysis } from '../models/marketAnalysis';
import type { OHLCVSnapshot } from '../models/marketResearch';
import type { OHLCVBar } from './utils/pivotDetection';

/**
 * レンズへの入力データ
 *
 * 既存の MarketResearch / OHLCV データをラップした形。
 * existingAnalysis が渡された場合は再計算せずラップするだけでよい。
 */
export interface LensInput {
  /** 銘柄シンボル（例: "XAUUSD"） */
  symbol: string;
  /** 時間枠（例: "15m", "1h"） */
  timeframe: string;
  /** 分析対象時刻（UTC） */
  timestamp: Date;
  /** OHLCV 要約スナップショット（Phase 1 基本レンズ用） */
  ohlcv?: OHLCVSnapshot;
  /**
   * OHLCV バー列（Phase 3 で追加）
   * ピボット検出・BB幅パーセンタイル等、バー単位の計算が必要なレンズはここを参照する。
   * 既存レンズ（CurrentAnalysis / TimeSession）は無視して問題ない。
   */
  ohlcvBars?: readonly OHLCVBar[];
  /** 事前計算済みインジケーター値（あれば） */
  indicators?: Record<string, number>;
  /** 既存の MarketAnalysis 結果（渡されていれば再計算不要） */
  existingAnalysis?: MarketAnalysis;
  /**
   * PR ④F: ローソク足パターン flag 配列。bar index ごとに各 patternId の boolean
   * を持つ。`PatternLens` が末尾バーの flags を features として返すために参照する。
   *
   * 真実は analysis-engine `compute_candlestick_pattern_flags` / `compute_pinbar_flags`。
   * `EvolutionLoop` が世代開始時に `/v1/indicator-series` で取得して LensInput に
   * 詰める想定。未指定なら `PatternLens.compute` は全 false features + confidence 0
   * を返す。
   */
  precomputedPatternFlags?: Readonly<Record<CandlePatternId, ReadonlyArray<boolean>>>;

  /**
   * Phase 7a: 末尾バー時点での SMC (Smart Money Concept) 構造観測結果。
   *
   * 真実は analysis-engine `compute_smc_structures` (`smc.py`)。
   * `EvolutionLoop` 等が `/v1/indicator-series` (`includeSmc: true`) で取得して
   * LensInput に詰める想定。未指定なら `SMCLens.compute` は全 sentinel features +
   * confidence 0 を返す。
   *
   * 設計書: `docs/design/phase_7_specification.md` §5.1
   */
  precomputedSmcStructures?: SmcStructuresPayload;

  /**
   * Phase 7b: 末尾バー時点での Chart Pattern (N-bar 構造) 検出結果。
   *
   * 真実は analysis-engine `compute_chart_patterns` (`chart_patterns.py`)。
   * `EvolutionLoop` 等が `/v1/indicator-series` (`includeChartPatterns: true`) で
   * 取得して LensInput に詰める想定。未指定なら `ChartPatternLens.compute` は
   * sentinel features + confidence 0 を返す。
   *
   * 「Pattern」(ローソク足、既存 PatternLens) と「Chart Pattern」(N-bar 構造、本 lens)
   * は階層的に異なる概念。ローソク足 = 基本、Chart Pattern = 応用 / 組み合わせ。
   * user 哲学 (2026-05-14): pattern = 基本、chart_pattern = 応用。
   *
   * 設計書: `docs/design/phase_7_specification.md` §5.2
   */
  precomputedChartPatterns?: ChartPatternsPayload;

  /**
   * Phase 7c: 末尾バー時点での Wyckoff phase 判定 + 主要シグナル検出結果。
   *
   * 真実は analysis-engine `compute_wyckoff_phases` (`wyckoff.py`)。`EvolutionLoop`
   * 等が `/v1/indicator-series` (`includeWyckoff: true`) で取得して LensInput に
   * 詰める想定。未指定なら `WyckoffLens.compute` は sentinel features + confidence 0 を返す。
   *
   * Wyckoff phase 判定は **SMC context (Phase 7a) を input として活用** することで
   * 精度が向上する。`includeSmc: true` も併用すると BOS / CHOCH 情報が反映される。
   *
   * 設計書: `docs/design/phase_7_specification.md` §5.4
   */
  precomputedWyckoffPhases?: WyckoffPhasesPayload;
}

/**
 * Phase 7a: SMC structures snapshot at end-of-bars.
 *
 * 末尾バー時点での Order Block / Liquidity / FVG / Structure event / Zone の
 * 観測結果。`LensFeature.features` の型制約 (`number | string | boolean`、null 不可、
 * 配列不可) に合わせ、すべて scalar 型のみで表現。「なし」は sentinel
 * (`-1.0` / `-1` / `'NONE'`) で表現する。
 *
 * 設計書: `docs/design/phase_7_specification.md` §5.1 / `analysis-engine/app/smc.py`
 */
export interface SmcStructuresPayload {
  /** 直近 Bull OB との距離 (pips)。なし時 -1.0 */
  readonly nearestObBullDistancePips: number;
  /** 直近 Bear OB との距離 (pips)。なし時 -1.0 */
  readonly nearestObBearDistancePips: number;
  /** 上方 BSL (Buy-side liquidity) クラスター数 (lookback 20 bars) */
  readonly liquidityAboveCount: number;
  /** 下方 SSL (Sell-side liquidity) クラスター数 */
  readonly liquidityBelowCount: number;
  /** 直近 20 bars 内の Bull FVG 数 */
  readonly fvgBullCountLast20: number;
  /** 直近 20 bars 内の Bear FVG 数 */
  readonly fvgBearCountLast20: number;
  /** 直近の構造イベント。BOS = trend 継続、CHOCH = trend 転換。なし時 'NONE' */
  readonly lastStructureEvent: 'BOS_BULL' | 'BOS_BEAR' | 'CHOCH_BULL' | 'CHOCH_BEAR' | 'NONE';
  /** 直近構造イベントから経過したバー数。なし時 -1 */
  readonly barsSinceLastStructureEvent: number;
  /**
   * 現在の zone。zonePositionPct 基準で:
   * - 0.0-0.45: DISCOUNT
   * - 0.45-0.55: EQUILIBRIUM (中央 10%)
   * - 0.55-1.0: PREMIUM
   *
   * Phase 7a 設計選択 (analysis-engine `smc.py` `_compute_zone` と一致)。
   */
  readonly currentZone: 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM';
  /** swing range 内の現在位置 (0.0=extreme discount, 1.0=extreme premium) */
  readonly zonePositionPct: number;
}

/**
 * Phase 7b: Chart Pattern (N-bar 構造) 検出 snapshot。
 *
 * `compute_chart_patterns` (`chart_patterns.py`) が同時複数パターン検出時は
 * confidence が最も高い 1 つを採用する。`LensFeature.features` の型制約 (`Record<string,
 * number | string | boolean>`、null 不可) に合わせ scalar 型のみで構成。「なし」は
 * `patternDetected: 'NONE'` で表現、その他は 0 / false / 'NEUTRAL' で表現。
 *
 * 設計書: `docs/design/phase_7_specification.md` §5.2 / `analysis-engine/app/chart_patterns.py`
 */
export interface ChartPatternsPayload {
  /**
   * 検出された chart pattern。なし時 'NONE'。
   *
   * 11 種:
   * - FLAG / PENNANT: 大きな impulse 後の consolidation
   * - TRIANGLE_ASC / DESC / SYM: 高値・安値線の収束
   * - HEAD_SHOULDER / INV_HEAD_SHOULDER: 3 山構造
   * - DOUBLE_TOP / DOUBLE_BOTTOM: 2 山構造
   * - WEDGE_RISE / FALL: 高安両方向の収束
   */
  readonly patternDetected:
    | 'FLAG'
    | 'PENNANT'
    | 'TRIANGLE_ASC'
    | 'TRIANGLE_DESC'
    | 'TRIANGLE_SYM'
    | 'HEAD_SHOULDER'
    | 'INV_HEAD_SHOULDER'
    | 'DOUBLE_TOP'
    | 'DOUBLE_BOTTOM'
    | 'WEDGE_RISE'
    | 'WEDGE_FALL'
    | 'NONE';
  /** 検出 confidence (0.0-1.0)。NONE 時は 0.0 */
  readonly patternConfidence: number;
  /** 直近 3 本以内に breakout / breakdown が発生しそうか */
  readonly patternBreakImminent: boolean;
  /** パターン形成期間 (バー数)。0 = なし or NONE */
  readonly patternBarsCount: number;
  /** パターンが示唆する方向バイアス */
  readonly patternDirectionBias: 'BULL' | 'BEAR' | 'NEUTRAL';
}

/**
 * Phase 7c: Wyckoff phase / signal detection snapshot at end-of-bars.
 *
 * `compute_wyckoff_phases` (`wyckoff.py`) が SMC context (Phase 7a) を optional input
 * として活用、BOS / CHOCH 情報を phase 判定に組み込む。`LensFeature.features` の型制約
 * に合わせ scalar 型のみで構成。「なし」は sentinel (`-1` / `'UNKNOWN'` / `false`) で表現。
 *
 * 設計書: `docs/design/phase_7_specification.md` §5.4 / `analysis-engine/app/wyckoff.py`
 */
export interface WyckoffPhasesPayload {
  /**
   * Wyckoff サイクル phase 判定:
   * - ACCUMULATION: 横ばい + 下方ゾーン (買い溜め期)
   * - MARKUP: 強い上昇 + BOS_BULL
   * - DISTRIBUTION: 横ばい + 上方ゾーン (利確期)
   * - MARKDOWN: 強い下降 + BOS_BEAR
   * - RE_ACCUMULATION: 横ばい + CHOCH_BULL (= MARKUP への転換期)
   * - RE_DISTRIBUTION: 横ばい + CHOCH_BEAR
   * - UNKNOWN: 判定材料不足
   */
  readonly wyckoffPhase:
    | 'ACCUMULATION'
    | 'MARKUP'
    | 'DISTRIBUTION'
    | 'MARKDOWN'
    | 'RE_ACCUMULATION'
    | 'RE_DISTRIBUTION'
    | 'UNKNOWN';
  /** phase 判定の confidence (0-1)。SMC context が一致すると高くなる */
  readonly wyckoffPhaseConfidence: number;
  /** 直近 20 bars 内に Spring (= swing low 一時 break) 検出 */
  readonly springDetectedInLast20Bars: boolean;
  /** 直近 20 bars 内に Upthrust (= swing high 一時 break) 検出 */
  readonly upthrustDetectedInLast20Bars: boolean;
  /** 直近の SOS (Sign of Strength) からの経過バー数。なし時 -1 sentinel */
  readonly lastSosBarsAgo: number;
  /** 直近の SOW (Sign of Weakness) からの経過バー数。なし時 -1 sentinel */
  readonly lastSowBarsAgo: number;
}

/**
 * レンズが出力する特徴量
 *
 * features は数値・文字列・真偽値の混在を許可する（レンズごとに意味が異なるため）。
 */
export interface LensFeature {
  /** レンズ名（一意識別子） */
  readonly lensName: string;
  /** レンズのバージョン（互換性チェック用） */
  readonly lensVersion: string;
  /** レンズが抽出した特徴量 */
  readonly features: Readonly<Record<string, number | string | boolean>>;
  /** 計算完了時刻 */
  readonly computedAt: Date;
  /** 計算に要した時間（ms） */
  readonly computeDurationMs?: number;
  /** レンズ自身が申告する信頼度（0.0〜1.0） */
  readonly confidence?: number;
}

/**
 * レンズのインターフェース
 *
 * 実装規約（CLAUDE.md 原則4）:
 * - 副作用なし（純関数に近い実装）
 * - 他レンズへの依存禁止（dependencies は LensInput のキーのみ）
 * - 決定性あり（同じ入力 → 同じ出力）
 * - ランダム要素禁止
 */
export interface Lens {
  /** レンズ名（一意） */
  readonly name: string;
  /** レンズのバージョン */
  readonly version: string;
  /** このレンズが必要とする LensInput のフィールド */
  readonly dependencies: ReadonlyArray<keyof LensInput>;

  /**
   * 特徴量を計算する
   *
   * 入力に必要なフィールドが欠けている場合は
   * confidence: 0 / features: {} を返すか、例外を投げる（実装側の判断）。
   *
   * @throws 入力が不正（timestamp が未来等）の場合
   */
  compute(input: LensInput): Promise<LensFeature>;
}

/**
 * 全レンズ出力の統合スナップショット
 *
 * LensAggregator.computeAll() が返す型。
 * features は Map<string, LensFeature> で lensName をキーとする。
 */
export interface LensFeatureSnapshot {
  /** スナップショット時刻（LensInput.timestamp と一致） */
  timestamp: Date;
  /** 銘柄シンボル */
  symbol: string;
  /** レンズ名 → 特徴量 の対応（失敗したレンズは含まれない） */
  features: Map<string, LensFeature>;
  /** 全レンズ合計の計算時間（ms） */
  totalComputeDurationMs: number;
  /**
   * PR ⑤B (MTF): 主 timeframe (canonical 表記、例: `'15m'`)。MTF 評価で
   * `condition.timeframe` を主 timeframe と比較して、一致なら接尾なしの lens key
   * (`'ohlcv'`)、上位足なら `'ohlcv@1h'` のような lens key で snapshot.features
   * を引くために必要。surrogate / analysis-engine 側で snapshot 構築時に詰める。
   * 未設定 (= MTF 非対応の経路) なら DSLEvaluator は condition.timeframe を無視。
   */
  primaryTimeframe?: string;
}

/**
 * AITradeNote.lensSnapshot 用の永続化形式（JSON シリアライズ可能）
 *
 * Map は JSON 化時にプレーンオブジェクトへ変換する必要があるため、
 * 永続化する際はこの型へ変換する。
 */
export interface SerializedLensFeatureSnapshot {
  timestamp: string;
  symbol: string;
  features: Record<string, Record<string, number | string | boolean>>;
  totalComputeDurationMs: number;
}
