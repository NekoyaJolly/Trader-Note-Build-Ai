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
