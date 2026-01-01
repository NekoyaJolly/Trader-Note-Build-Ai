/**
 * Legacy NoteEvaluator アダプター
 * 
 * 目的:
 * - 既存の12次元特徴量ベクトルロジックを NoteEvaluator インターフェースでラップ
 * - 既存コードを「触らない・削除しない」で委譲する
 * - 新旧ロジックの並行運用を可能にする
 * 
 * 設計方針:
 * - 既存の featureVectorService, matchEvaluationService を内部で使用
 * - 12次元固定ベクトルを「このノートの設定」として扱う
 * - indicatorConfig が null の場合はレガシーモードで動作
 * 
 * @see src/domain/noteEvaluator.ts - インターフェース定義
 * @see src/services/featureVectorService.ts - レガシー実装
 */

import {
  NoteEvaluator,
  IndicatorSpec,
  MarketSnapshot,
  EvaluationResult,
  NoteIndicatorConfig,
  cosineSimilarity,
  getSimilarityLevel,
  DEFAULT_THRESHOLDS,
  DEFAULT_TRIGGER_THRESHOLD,
} from '../domain/noteEvaluator';

import {
  generateFeatureVector,
  SIMILARITY_THRESHOLDS,
  VECTOR_DIMENSION,
  FeatureGenerationInput,
  IndicatorData,
} from './featureVectorService';

import { IndicatorId, IndicatorParams, IndicatorConfig } from '../models/indicatorConfig';
import { TradeNote as PrismaTradeNote } from '@prisma/client';

// ============================================================================
// 型定義
// ============================================================================

/**
 * レガシー12次元で使用するインジケーター仕様
 */
const LEGACY_INDICATOR_SPECS: IndicatorSpec[] = [
  { indicatorId: 'rsi', params: { period: 14 }, required: true },
  { indicatorId: 'macd', params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }, required: true },
  { indicatorId: 'bb', params: { period: 20 }, required: true },
  { indicatorId: 'sma', params: { period: 20 }, required: false },
  { indicatorId: 'ema', params: { period: 20 }, required: false },
  { indicatorId: 'atr', params: { period: 14 }, required: false },
];

// ============================================================================
// LegacyNoteEvaluator 実装
// ============================================================================

/**
 * レガシー12次元特徴量ベースの NoteEvaluator 実装
 * 
 * 既存の featureVectorService ロジックを NoteEvaluator インターフェースでラップする。
 * indicatorConfig が null または未設定のノートは、このアダプターで評価される。
 */
export class LegacyNoteEvaluator implements NoteEvaluator {
  readonly noteId: string;
  readonly symbol: string;
  
  /** ノートに保存されている特徴量ベクトル（12次元） */
  private readonly noteVector: number[];
  
  /** 発火閾値 */
  private readonly threshold: number;
  
  /**
   * コンストラクタ
   * 
   * @param note Prismaから取得したTradeNoteレコード
   * @param threshold 発火閾値（デフォルト: 0.75）
   */
  constructor(note: PrismaTradeNote, threshold = DEFAULT_TRIGGER_THRESHOLD) {
    this.noteId = note.id;
    this.symbol = note.symbol;
    this.noteVector = note.featureVector ?? [];
    this.threshold = threshold;
  }
  
  /**
   * レガシー12次元で必要なインジケーター仕様を返す
   * 
   * 固定の仕様を返す（RSI, MACD, BB, SMA, EMA, ATR）
   */
  requiredIndicators(): IndicatorSpec[] {
    return LEGACY_INDICATOR_SPECS;
  }
  
  /**
   * 市場スナップショットから12次元特徴量ベクトルを構築
   * 
   * 既存の generateFeatureVector 関数に委譲する
   */
  buildFeatureVector(snapshot: MarketSnapshot): number[] {
    // MarketSnapshot から FeatureGenerationInput を構築
    const input: FeatureGenerationInput = {
      ohlcv: {
        timestamp: snapshot.timestamp,
        open: snapshot.ohlcv.open,
        high: snapshot.ohlcv.high,
        low: snapshot.ohlcv.low,
        close: snapshot.ohlcv.close,
        volume: snapshot.ohlcv.volume,
      },
      indicators: this.convertSnapshotToIndicatorData(snapshot),
      timestamp: snapshot.timestamp,
    };
    
    return generateFeatureVector(input);
  }
  
  /**
   * 2つのベクトル間のコサイン類似度を計算
   * 
   * @param vectorA 比較元ベクトル
   * @param vectorB 比較先ベクトル
   * @returns 類似度（0.0〜1.0）
   */
  similarity(vectorA: number[], vectorB: number[]): number {
    return cosineSimilarity(vectorA, vectorB);
  }
  
  /**
   * 類似度が閾値を超えているか判定
   */
  isTriggered(similarity: number): boolean {
    return similarity >= this.threshold;
  }
  
  /**
   * 閾値設定を取得
   */
  getThresholds(): { strong: number; medium: number; weak: number } {
    return {
      strong: SIMILARITY_THRESHOLDS.STRONG,
      medium: SIMILARITY_THRESHOLDS.MEDIUM,
      weak: SIMILARITY_THRESHOLDS.WEAK,
    };
  }
  
  /**
   * 市場スナップショットを使ってノートを評価
   * 
   * @param snapshot 市場スナップショット
   * @param noteVector ノートの保存済みベクトル（オプション）
   * @returns 評価結果
   */
  evaluate(snapshot: MarketSnapshot, noteVector?: number[]): EvaluationResult {
    const vector = noteVector ?? this.noteVector;
    const marketVector = this.buildFeatureVector(snapshot);
    const sim = this.similarity(vector, marketVector);
    const thresholds = this.getThresholds();
    
    // 使用したインジケーターラベルを収集
    const usedIndicators = this.requiredIndicators()
      .filter(spec => spec.required)
      .map(spec => this.formatIndicatorLabel(spec));
    
    return {
      noteId: this.noteId,
      similarity: sim,
      level: getSimilarityLevel(sim, thresholds),
      triggered: this.isTriggered(sim),
      vectorDimension: VECTOR_DIMENSION,
      usedIndicators,
      evaluatedAt: new Date(),
      diagnostics: {
        noteVector: vector,
        marketVector,
      },
    };
  }
  
  // ============================================================================
  // プライベートメソッド
  // ============================================================================
  
  /**
   * MarketSnapshot のインジケーター値を IndicatorData 形式に変換
   */
  private convertSnapshotToIndicatorData(snapshot: MarketSnapshot): IndicatorData {
    const ind = snapshot.indicators;
    
    return {
      // RSI
      rsi: ind['RSI(14)'] ?? ind['rsi'] ?? undefined,
      rsiZone: this.determineRsiZone(ind['RSI(14)'] ?? ind['rsi']),
      
      // MACD
      macdLine: ind['MACD_line'] ?? ind['macdLine'] ?? undefined,
      macdSignal: ind['MACD_signal'] ?? ind['macdSignal'] ?? undefined,
      macdHistogram: ind['MACD_histogram'] ?? ind['macdHistogram'] ?? undefined,
      
      // SMA/EMA
      sma: ind['SMA(20)'] ?? ind['sma'] ?? undefined,
      ema: ind['EMA(20)'] ?? ind['ema'] ?? undefined,
      
      // ボリンジャーバンド
      bbUpper: ind['BB_upper'] ?? ind['bbUpper'] ?? undefined,
      bbMiddle: ind['BB_middle'] ?? ind['bbMiddle'] ?? undefined,
      bbLower: ind['BB_lower'] ?? ind['bbLower'] ?? undefined,
      
      // ATR
      atr: ind['ATR(14)'] ?? ind['atr'] ?? undefined,
      
      // 終値
      close: snapshot.ohlcv.close,
    };
  }
  
  /**
   * RSI 値からゾーンを判定
   */
  private determineRsiZone(rsi?: number | null): 'overbought' | 'oversold' | 'neutral' | undefined {
    if (rsi == null) return undefined;
    if (rsi >= 70) return 'overbought';
    if (rsi <= 30) return 'oversold';
    return 'neutral';
  }
  
  /**
   * インジケーター仕様からラベルを生成
   */
  private formatIndicatorLabel(spec: IndicatorSpec): string {
    const { indicatorId, params } = spec;
    const period = params.period ?? params.fastPeriod ?? params.kPeriod;
    return period ? `${indicatorId.toUpperCase()}(${period})` : indicatorId.toUpperCase();
  }
}

// ============================================================================
// ユーザー定義インジケーター NoteEvaluator（将来拡張用）
// ============================================================================

/**
 * ユーザー定義インジケーターベースの NoteEvaluator 実装
 * 
 * ノートの indicatorConfig に基づいて、可変次元の特徴量ベクトルを生成する。
 * indicatorConfig が設定されているノートは、このクラスで評価される。
 */
export class UserIndicatorNoteEvaluator implements NoteEvaluator {
  readonly noteId: string;
  readonly symbol: string;
  
  private readonly config: NoteIndicatorConfig;
  private readonly noteVector: number[];
  
  constructor(
    note: PrismaTradeNote,
    config: NoteIndicatorConfig,
    noteVector: number[]
  ) {
    this.noteId = note.id;
    this.symbol = note.symbol;
    this.config = config;
    this.noteVector = noteVector;
  }
  
  /**
   * ノート固有のインジケーター仕様を返す
   */
  requiredIndicators(): IndicatorSpec[] {
    return this.config.indicators
      .filter(c => c.enabled)
      .map(c => ({
        indicatorId: c.indicatorId,
        params: c.params,
        required: true,
      }));
  }
  
  /**
   * 市場スナップショットからノート固有の特徴量ベクトルを構築
   * 
   * インジケーター設定の順序に従って値を抽出
   */
  buildFeatureVector(snapshot: MarketSnapshot): number[] {
    const vector: number[] = [];
    
    for (const config of this.config.indicators) {
      if (!config.enabled) continue;
      
      // インジケーターラベルを生成
      const label = config.label ?? this.formatLabel(config);
      const value = snapshot.indicators[label];
      
      // 値が取得できない場合は 0 を使用（要改善: missing indicator tracking）
      vector.push(value ?? 0);
    }
    
    return vector;
  }
  
  /**
   * 設定された方式で類似度を計算
   */
  similarity(vectorA: number[], vectorB: number[]): number {
    switch (this.config.similarityMethod) {
      case 'euclidean':
        return this.euclideanSimilarity(vectorA, vectorB);
      case 'manhattan':
        return this.manhattanSimilarity(vectorA, vectorB);
      case 'cosine':
      default:
        return cosineSimilarity(vectorA, vectorB);
    }
  }
  
  /**
   * 発火条件を判定
   */
  isTriggered(similarity: number): boolean {
    return similarity >= this.config.threshold;
  }
  
  /**
   * 閾値設定を取得
   */
  getThresholds(): { strong: number; medium: number; weak: number } {
    // ユーザー定義では threshold を medium として扱う
    return {
      strong: Math.min(this.config.threshold + 0.1, 1.0),
      medium: this.config.threshold,
      weak: Math.max(this.config.threshold - 0.1, 0.0),
    };
  }
  
  /**
   * 市場スナップショットを使ってノートを評価
   */
  evaluate(snapshot: MarketSnapshot, noteVector?: number[]): EvaluationResult {
    const vector = noteVector ?? this.noteVector;
    const marketVector = this.buildFeatureVector(snapshot);
    const sim = this.similarity(vector, marketVector);
    const thresholds = this.getThresholds();
    
    // 使用したインジケーターラベルを収集
    const usedIndicators = this.config.indicators
      .filter(c => c.enabled)
      .map(c => c.label ?? this.formatLabel(c));
    
    // 不足インジケーターを検出
    const missingIndicators = usedIndicators.filter(
      label => snapshot.indicators[label] == null
    );
    
    return {
      noteId: this.noteId,
      similarity: sim,
      level: getSimilarityLevel(sim, thresholds),
      triggered: this.isTriggered(sim),
      vectorDimension: vector.length,
      usedIndicators,
      evaluatedAt: new Date(),
      diagnostics: {
        noteVector: vector,
        marketVector,
        missingIndicators: missingIndicators.length > 0 ? missingIndicators : undefined,
      },
    };
  }
  
  // ============================================================================
  // プライベートメソッド
  // ============================================================================
  
  private formatLabel(config: IndicatorConfig): string {
    const period = config.params.period ?? config.params.fastPeriod ?? config.params.kPeriod;
    return period
      ? `${config.indicatorId.toUpperCase()}(${period})`
      : config.indicatorId.toUpperCase();
  }
  
  /**
   * ユークリッド距離ベースの類似度（0-1 正規化）
   */
  private euclideanSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) return 0;
    
    let sumSquared = 0;
    for (let i = 0; i < vecA.length; i++) {
      const diff = (vecA[i] ?? 0) - (vecB[i] ?? 0);
      sumSquared += diff * diff;
    }
    
    const distance = Math.sqrt(sumSquared);
    // 距離を0-1の類似度に変換（距離が大きいほど類似度が低い）
    return 1 / (1 + distance);
  }
  
  /**
   * マンハッタン距離ベースの類似度（0-1 正規化）
   */
  private manhattanSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) return 0;
    
    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
      sum += Math.abs((vecA[i] ?? 0) - (vecB[i] ?? 0));
    }
    
    // 距離を0-1の類似度に変換
    return 1 / (1 + sum);
  }
}

// ============================================================================
// ファクトリ関数
// ============================================================================

/**
 * ノートから適切な NoteEvaluator を生成する
 * 
 * - indicatorConfig が設定されている場合: UserIndicatorNoteEvaluator
 * - indicatorConfig が null の場合: LegacyNoteEvaluator
 * 
 * @param note Prismaから取得したTradeNoteレコード
 * @returns NoteEvaluator インスタンス
 */
export function createNoteEvaluator(note: PrismaTradeNote): NoteEvaluator {
  // indicatorConfig が設定されているか確認
  if (note.indicatorConfig) {
    const config = note.indicatorConfig as unknown as NoteIndicatorConfig;
    
    // バージョンチェック（将来のマイグレーション用）
    if (config.version && config.indicators && config.threshold) {
      return new UserIndicatorNoteEvaluator(note, config, note.featureVector ?? []);
    }
  }
  
  // レガシーモード（12次元固定）
  return new LegacyNoteEvaluator(note);
}

/**
 * 複数ノートの NoteEvaluator を一括生成する
 * 
 * @param notes Prismaから取得したTradeNoteレコード配列
 * @returns Map<noteId, NoteEvaluator>
 */
export function createNoteEvaluators(notes: PrismaTradeNote[]): Map<string, NoteEvaluator> {
  const evaluators = new Map<string, NoteEvaluator>();
  
  for (const note of notes) {
    evaluators.set(note.id, createNoteEvaluator(note));
  }
  
  return evaluators;
}

// ============================================================================
// FS型 TradeNote 用アダプター
// ============================================================================

import { TradeNote as FSTradeNote, MarketData } from '../models/types';

/**
 * FS型 TradeNote から NoteEvaluator を生成する
 * 
 * matchingService が tradeNoteService (FS型) を使用しているため、
 * このファクトリ関数で互換性を維持する。
 * 
 * @param note FS型のTradeNote（data/notes/*.json）
 * @returns NoteEvaluator インスタンス
 */
export function createNoteEvaluatorFromFSNote(note: FSTradeNote): NoteEvaluator {
  // FS型 → Prisma型の必要フィールドのみを変換
  // LegacyNoteEvaluator が使用するのは id, symbol, featureVector のみ
  const { Decimal } = require('@prisma/client/runtime/library');
  
  const pseudoPrismaNote: PrismaTradeNote = {
    id: note.id,
    symbol: note.symbol,
    featureVector: note.features,
    tradeId: note.tradeId,
    side: note.side.toUpperCase() as any,
    entryPrice: new Decimal(note.entryPrice),
    indicators: note.marketContext.indicators ?? null,
    timeframe: note.marketContext.timeframe ?? null,
    marketContext: note.marketContext as any,
    userNotes: note.userNotes ?? null,
    tags: note.tags ?? [],
    status: note.status.toUpperCase() as any,
    approvedAt: note.approvedAt ?? null,
    rejectedAt: note.rejectedAt ?? null,
    lastEditedAt: note.lastEditedAt ?? null,
    createdAt: note.createdAt,
    updatedAt: note.createdAt, // FS型にはないので createdAt で代用
    indicatorConfig: null, // FS型ノートは従来のレガシーモード
    // フェーズ8: 複数ノート運用UX
    priority: 5, // デフォルト優先度
    enabled: true, // デフォルト有効
    pausedUntil: null, // 停止なし
  };
  
  return new LegacyNoteEvaluator(pseudoPrismaNote);
}

/**
 * 複数のFS型 TradeNote から NoteEvaluator を一括生成する
 * 
 * @param notes FS型のTradeNote配列
 * @returns Map<noteId, NoteEvaluator>
 */
export function createNoteEvaluatorsFromFSNotes(notes: FSTradeNote[]): Map<string, NoteEvaluator> {
  const evaluators = new Map<string, NoteEvaluator>();
  
  for (const note of notes) {
    evaluators.set(note.id, createNoteEvaluatorFromFSNote(note));
  }
  
  return evaluators;
}

/**
 * MarketData を MarketSnapshot に変換する
 * 
 * matchingService が marketDataService から取得する MarketData を
 * NoteEvaluator.evaluate() に渡すための変換関数。
 * 
 * @param market MarketData（現在の市場データ）
 * @returns MarketSnapshot（NoteEvaluator用）
 */
export function convertMarketDataToSnapshot(market: MarketData): MarketSnapshot {
  // インジケーター値を Record<string, number | null> に変換
  const indicators: Record<string, number | null> = {};
  
  if (market.indicators) {
    // 基本インジケーターを変換
    if (market.indicators.rsi !== undefined) {
      indicators['RSI(14)'] = market.indicators.rsi;
      indicators['rsi'] = market.indicators.rsi;
    }
    if (market.indicators.macd !== undefined) {
      indicators['MACD_histogram'] = market.indicators.macd;
      indicators['macdHistogram'] = market.indicators.macd;
    }
  }
  
  // 拡張インジケーター（市場データに含まれる場合）
  const extendedIndicators = market.indicators as Record<string, unknown> | undefined;
  if (extendedIndicators) {
    for (const [key, value] of Object.entries(extendedIndicators)) {
      if (typeof value === 'number') {
        indicators[key] = value;
      }
    }
  }
  
  return {
    symbol: market.symbol,
    timestamp: market.timestamp,
    timeframe: market.timeframe,
    ohlcv: {
      open: market.open,
      high: market.high,
      low: market.low,
      close: market.close,
      volume: market.volume,
    },
    indicators,
  };
}
