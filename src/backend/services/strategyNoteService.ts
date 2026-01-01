/**
 * ストラテジーノートサービス
 * 
 * 目的:
 * - StrategyNote の CRUD 操作
 * - 特徴量ベクトル（featureVector）の計算
 * - タグ管理と状態遷移
 * 
 * 参照: Phase C 実装計画、インジケーター定義書 Section 12
 */

import { PrismaClient, StrategyNoteStatus, BacktestOutcome, Prisma, StrategyBacktestEvent } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

// ============================================
// 型定義
// ============================================

/**
 * インジケーター値の型定義
 * indicatorValues JSON の構造
 */
export interface IndicatorValues {
  rsi?: RSIValue;
  macd?: MACDValue;
  bb?: BBValue;
  sma?: SMAValue;
  ema?: EMAValue;
  [key: string]: unknown;
}

/**
 * RSI インジケーター値
 */
export interface RSIValue {
  value: number;           // RSI 値（0-100）
  direction: 'rising' | 'falling' | 'flat';  // 方向
  zone: 'overbought' | 'oversold' | 'neutral';  // ゾーン
}

/**
 * MACD インジケーター値
 */
export interface MACDValue {
  macdLine: number;         // MACD ライン
  signalLine: number;       // シグナルライン
  histogram: number;        // ヒストグラム
  histogramSign: 'positive' | 'negative';
  histogramSlope: 'increasing' | 'decreasing' | 'flat';
  zeroLinePosition: 'above' | 'below';
  macdSlope: 'up' | 'down' | 'flat';
}

/**
 * BB インジケーター値
 */
export interface BBValue {
  upper: number;            // 上バンド
  middle: number;           // ミドルバンド
  lower: number;            // 下バンド
  percentB: number;         // %B（0-100）
  bandWidthTrend: 'expanding' | 'contracting' | 'flat';
  zone: 'upperStick' | 'upperApproach' | 'middle' | 'lowerApproach' | 'lowerStick';
}

/**
 * SMA インジケーター値
 */
export interface SMAValue {
  value: number;            // SMA 値
  deviationRate: number;    // 乖離率（%）
  slopeDirection: 'up' | 'down' | 'flat';
  trendStrength: number;    // トレンド強度（0-1）
  pricePosition: 'above' | 'below';
  period: number;           // 期間
}

/**
 * EMA インジケーター値
 */
export interface EMAValue {
  value: number;            // EMA 値
  deviationRate: number;    // 乖離率（%）
  slopeDirection: 'up' | 'down' | 'flat';
  trendStrength: number;    // トレンド強度（0-1）
  emaVsSmaPosition: 'above' | 'below';
  period: number;           // 期間
}

/**
 * ストラテジーノート作成リクエスト
 */
export interface CreateStrategyNoteInput {
  strategyId: string;
  entryTime: Date;
  entryPrice: number | Decimal;
  conditionSnapshot: object;
  indicatorValues: IndicatorValues;
  outcome: BacktestOutcome;
  pnl?: number | Decimal;
  notes?: string;
  tags?: string[];
}

/**
 * ストラテジーノート更新リクエスト
 */
export interface UpdateStrategyNoteInput {
  status?: StrategyNoteStatus;
  tags?: string[];
  notes?: string;
}

/**
 * ストラテジーノート一覧取得パラメータ
 */
export interface ListStrategyNotesParams {
  strategyId?: string;
  status?: StrategyNoteStatus;
  outcome?: BacktestOutcome;
  tags?: string[];
  limit?: number;
  offset?: number;
}

/**
 * ストラテジーノートサマリー
 */
export interface StrategyNoteSummary {
  id: string;
  strategyId: string;
  strategyName: string;
  entryTime: Date;
  entryPrice: Decimal;
  outcome: BacktestOutcome;
  pnl: Decimal | null;
  status: StrategyNoteStatus;
  tags: string[];
  createdAt: Date;
}

/**
 * ストラテジーノート詳細
 */
export interface StrategyNoteDetail {
  id: string;
  strategyId: string;
  strategyName: string;
  entryTime: Date;
  entryPrice: Decimal;
  conditionSnapshot: object;
  indicatorValues: IndicatorValues;
  outcome: BacktestOutcome;
  pnl: Decimal | null;
  notes: string | null;
  status: StrategyNoteStatus;
  tags: string[];
  featureVector: number[];
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// 特徴量ベクトル計算
// ============================================

/**
 * 特徴量ベクトルのインデックス定義
 * インジケーター定義書 Section 12 に基づく
 */
const FEATURE_VECTOR_SCHEMA = {
  // RSI (0-4)
  rsi_value: 0,              // RSI 値を 0-1 に正規化
  rsi_direction: 1,          // rising=1, flat=0.5, falling=0
  rsi_zone: 2,               // overbought=1, neutral=0.5, oversold=0
  
  // MACD (3-7)
  macd_histogramSign: 3,     // positive=1, negative=0
  macd_histogramSlope: 4,    // increasing=1, flat=0.5, decreasing=0
  macd_zeroLinePosition: 5,  // above=1, below=0
  macd_slope: 6,             // up=1, flat=0.5, down=0
  
  // BB (7-10)
  bb_percentB: 7,            // %B を 0-1 に正規化
  bb_bandWidthTrend: 8,      // expanding=1, flat=0.5, contracting=0
  bb_zone: 9,                // upperStick=1, upperApproach=0.75, middle=0.5, lowerApproach=0.25, lowerStick=0
  
  // SMA (10-14)
  sma_deviationRate: 10,     // 乖離率を -1〜1 に正規化
  sma_slopeDirection: 11,    // up=1, flat=0.5, down=0
  sma_trendStrength: 12,     // 0-1
  sma_pricePosition: 13,     // above=1, below=0
  
  // EMA (14-18)
  ema_deviationRate: 14,     // 乖離率を -1〜1 に正規化
  ema_slopeDirection: 15,    // up=1, flat=0.5, down=0
  ema_trendStrength: 16,     // 0-1
  ema_vsSmaPosition: 17,     // above=1, below=0
};

// 特徴量ベクトルの長さ
const FEATURE_VECTOR_LENGTH = 18;

/**
 * インジケーター値から特徴量ベクトルを計算
 * 
 * @param indicatorValues - インジケーター値
 * @returns 特徴量ベクトル（数値配列）
 */
export function calculateFeatureVector(indicatorValues: IndicatorValues): number[] {
  const vector = new Array(FEATURE_VECTOR_LENGTH).fill(0);
  
  // RSI
  if (indicatorValues.rsi) {
    const rsi = indicatorValues.rsi;
    vector[FEATURE_VECTOR_SCHEMA.rsi_value] = rsi.value / 100;  // 0-1 に正規化
    vector[FEATURE_VECTOR_SCHEMA.rsi_direction] = 
      rsi.direction === 'rising' ? 1 : rsi.direction === 'flat' ? 0.5 : 0;
    vector[FEATURE_VECTOR_SCHEMA.rsi_zone] = 
      rsi.zone === 'overbought' ? 1 : rsi.zone === 'neutral' ? 0.5 : 0;
  }
  
  // MACD
  if (indicatorValues.macd) {
    const macd = indicatorValues.macd;
    vector[FEATURE_VECTOR_SCHEMA.macd_histogramSign] = macd.histogramSign === 'positive' ? 1 : 0;
    vector[FEATURE_VECTOR_SCHEMA.macd_histogramSlope] = 
      macd.histogramSlope === 'increasing' ? 1 : macd.histogramSlope === 'flat' ? 0.5 : 0;
    vector[FEATURE_VECTOR_SCHEMA.macd_zeroLinePosition] = macd.zeroLinePosition === 'above' ? 1 : 0;
    vector[FEATURE_VECTOR_SCHEMA.macd_slope] = 
      macd.macdSlope === 'up' ? 1 : macd.macdSlope === 'flat' ? 0.5 : 0;
  }
  
  // BB
  if (indicatorValues.bb) {
    const bb = indicatorValues.bb;
    // %B を 0-1 に正規化（0未満や100超も許容）
    vector[FEATURE_VECTOR_SCHEMA.bb_percentB] = Math.max(0, Math.min(1, bb.percentB / 100));
    vector[FEATURE_VECTOR_SCHEMA.bb_bandWidthTrend] = 
      bb.bandWidthTrend === 'expanding' ? 1 : bb.bandWidthTrend === 'flat' ? 0.5 : 0;
    // ゾーン: upperStick=1, upperApproach=0.75, middle=0.5, lowerApproach=0.25, lowerStick=0
    const zoneMap: Record<string, number> = {
      upperStick: 1,
      upperApproach: 0.75,
      middle: 0.5,
      lowerApproach: 0.25,
      lowerStick: 0,
    };
    vector[FEATURE_VECTOR_SCHEMA.bb_zone] = zoneMap[bb.zone] ?? 0.5;
  }
  
  // SMA
  if (indicatorValues.sma) {
    const sma = indicatorValues.sma;
    // 乖離率を -1〜1 に正規化（±10% を上限とする）
    vector[FEATURE_VECTOR_SCHEMA.sma_deviationRate] = 
      Math.max(-1, Math.min(1, sma.deviationRate / 10));
    vector[FEATURE_VECTOR_SCHEMA.sma_slopeDirection] = 
      sma.slopeDirection === 'up' ? 1 : sma.slopeDirection === 'flat' ? 0.5 : 0;
    vector[FEATURE_VECTOR_SCHEMA.sma_trendStrength] = Math.max(0, Math.min(1, sma.trendStrength));
    vector[FEATURE_VECTOR_SCHEMA.sma_pricePosition] = sma.pricePosition === 'above' ? 1 : 0;
  }
  
  // EMA
  if (indicatorValues.ema) {
    const ema = indicatorValues.ema;
    // 乖離率を -1〜1 に正規化（±8% を上限とする）
    vector[FEATURE_VECTOR_SCHEMA.ema_deviationRate] = 
      Math.max(-1, Math.min(1, ema.deviationRate / 8));
    vector[FEATURE_VECTOR_SCHEMA.ema_slopeDirection] = 
      ema.slopeDirection === 'up' ? 1 : ema.slopeDirection === 'flat' ? 0.5 : 0;
    vector[FEATURE_VECTOR_SCHEMA.ema_trendStrength] = Math.max(0, Math.min(1, ema.trendStrength));
    vector[FEATURE_VECTOR_SCHEMA.ema_vsSmaPosition] = ema.emaVsSmaPosition === 'above' ? 1 : 0;
  }
  
  return vector;
}

// ============================================
// サービス関数
// ============================================

/**
 * ストラテジーノートを作成
 * 
 * @param input - 作成リクエスト
 * @returns 作成されたノート
 */
export async function createStrategyNote(input: CreateStrategyNoteInput): Promise<StrategyNoteDetail> {
  const {
    strategyId,
    entryTime,
    entryPrice,
    conditionSnapshot,
    indicatorValues,
    outcome,
    pnl,
    notes,
    tags = [],
  } = input;
  
  // 特徴量ベクトルを計算
  const featureVector = calculateFeatureVector(indicatorValues);
  
  // ストラテジーの存在確認
  const strategy = await prisma.strategy.findUnique({
    where: { id: strategyId },
    select: { id: true, name: true },
  });
  
  if (!strategy) {
    throw new Error(`ストラテジーが見つかりません: ${strategyId}`);
  }
  
  // ノートを作成
  const note = await prisma.strategyNote.create({
    data: {
      strategyId,
      entryTime,
      entryPrice: new Decimal(entryPrice.toString()),
      conditionSnapshot: conditionSnapshot as Prisma.JsonObject,
      indicatorValues: indicatorValues as Prisma.JsonObject,
      outcome,
      pnl: pnl ? new Decimal(pnl.toString()) : null,
      notes,
      status: 'draft' as StrategyNoteStatus,
      tags,
      featureVector,
    },
  });
  
  return {
    id: note.id,
    strategyId: note.strategyId,
    strategyName: strategy.name,
    entryTime: note.entryTime,
    entryPrice: note.entryPrice,
    conditionSnapshot: note.conditionSnapshot as object,
    indicatorValues: note.indicatorValues as IndicatorValues,
    outcome: note.outcome,
    pnl: note.pnl,
    notes: note.notes,
    status: note.status,
    tags: note.tags,
    featureVector: note.featureVector,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/**
 * ストラテジーノート一覧を取得
 */
export async function listStrategyNotes(params: ListStrategyNotesParams = {}): Promise<StrategyNoteSummary[]> {
  const { strategyId, status, outcome, tags, limit = 50, offset = 0 } = params;
  
  // フィルタ条件を構築
  const where: Prisma.StrategyNoteWhereInput = {};
  if (strategyId) where.strategyId = strategyId;
  if (status) where.status = status;
  if (outcome) where.outcome = outcome;
  if (tags && tags.length > 0) {
    where.tags = { hasSome: tags };
  }
  
  const notes = await prisma.strategyNote.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
    include: {
      strategy: {
        select: { name: true },
      },
    },
  });
  
  return notes.map(note => ({
    id: note.id,
    strategyId: note.strategyId,
    strategyName: note.strategy.name,
    entryTime: note.entryTime,
    entryPrice: note.entryPrice,
    outcome: note.outcome,
    pnl: note.pnl,
    status: note.status,
    tags: note.tags,
    createdAt: note.createdAt,
  }));
}

/**
 * ストラテジーノート詳細を取得
 */
export async function getStrategyNote(noteId: string): Promise<StrategyNoteDetail | null> {
  const note = await prisma.strategyNote.findUnique({
    where: { id: noteId },
    include: {
      strategy: {
        select: { name: true },
      },
    },
  });
  
  if (!note) return null;
  
  return {
    id: note.id,
    strategyId: note.strategyId,
    strategyName: note.strategy.name,
    entryTime: note.entryTime,
    entryPrice: note.entryPrice,
    conditionSnapshot: note.conditionSnapshot as object,
    indicatorValues: note.indicatorValues as IndicatorValues,
    outcome: note.outcome,
    pnl: note.pnl,
    notes: note.notes,
    status: note.status,
    tags: note.tags,
    featureVector: note.featureVector,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/**
 * ストラテジーノートを更新
 */
export async function updateStrategyNote(
  noteId: string,
  input: UpdateStrategyNoteInput
): Promise<StrategyNoteDetail | null> {
  const { status, tags, notes } = input;
  
  // 更新データを構築
  const updateData: Prisma.StrategyNoteUpdateInput = {};
  if (status !== undefined) updateData.status = status;
  if (tags !== undefined) updateData.tags = tags;
  if (notes !== undefined) updateData.notes = notes;
  
  const note = await prisma.strategyNote.update({
    where: { id: noteId },
    data: updateData,
    include: {
      strategy: {
        select: { name: true },
      },
    },
  });
  
  return {
    id: note.id,
    strategyId: note.strategyId,
    strategyName: note.strategy.name,
    entryTime: note.entryTime,
    entryPrice: note.entryPrice,
    conditionSnapshot: note.conditionSnapshot as object,
    indicatorValues: note.indicatorValues as IndicatorValues,
    outcome: note.outcome,
    pnl: note.pnl,
    notes: note.notes,
    status: note.status,
    tags: note.tags,
    featureVector: note.featureVector,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/**
 * ストラテジーノートを削除
 */
export async function deleteStrategyNote(noteId: string): Promise<boolean> {
  try {
    await prisma.strategyNote.delete({
      where: { id: noteId },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * ノートの状態を変更
 * draft → active への遷移時に特徴量ベクトルを再計算
 */
export async function changeNoteStatus(
  noteId: string,
  newStatus: StrategyNoteStatus
): Promise<StrategyNoteDetail | null> {
  const note = await prisma.strategyNote.findUnique({
    where: { id: noteId },
  });
  
  if (!note) return null;
  
  // draft → active への遷移時は特徴量ベクトルを再計算
  let featureVector = note.featureVector;
  if (note.status === 'draft' && newStatus === 'active') {
    const indicatorValues = note.indicatorValues as IndicatorValues;
    featureVector = calculateFeatureVector(indicatorValues);
  }
  
  return updateStrategyNote(noteId, { status: newStatus });
}

/**
 * バックテストイベントから StrategyNote を一括作成
 * 勝ちトレードのみをノートとして保存
 * 
 * @param runId - バックテスト実行 ID
 * @param onlyWins - 勝ちトレードのみ保存するか（デフォルト: true）
 * @returns 作成されたノート数
 */
export async function createNotesFromBacktestRun(
  runId: string,
  onlyWins: boolean = true
): Promise<number> {
  // バックテスト実行情報を取得
  const run = await prisma.strategyBacktestRun.findUnique({
    where: { id: runId },
    include: {
      events: true,
    },
  });
  
  if (!run) {
    throw new Error(`バックテスト実行が見つかりません: ${runId}`);
  }
  
  // ストラテジーのバージョン情報を取得
  const strategy = await prisma.strategy.findUnique({
    where: { id: run.strategyId },
    select: {
      currentVersionId: true,
    },
  });
  
  if (!strategy?.currentVersionId) {
    throw new Error(`ストラテジーバージョンが見つかりません: ${run.strategyId}`);
  }
  
  const version = await prisma.strategyVersion.findUnique({
    where: { id: strategy.currentVersionId },
  });
  
  if (!version) {
    throw new Error(`バージョンが見つかりません: ${strategy.currentVersionId}`);
  }
  
  // フィルタリング
  const events: StrategyBacktestEvent[] = onlyWins
    ? run.events.filter((e: StrategyBacktestEvent) => e.outcome === 'win')
    : run.events;
  
  let createdCount = 0;
  
  for (const event of events) {
    try {
      await createStrategyNote({
        strategyId: run.strategyId,
        entryTime: event.entryTime,
        entryPrice: event.entryPrice,
        conditionSnapshot: version.entryConditions as object,
        indicatorValues: event.indicatorValues as IndicatorValues,
        outcome: event.outcome,
        pnl: event.pnl ?? undefined,
        tags: ['backtest', `run:${runId}`],
      });
      createdCount++;
    } catch (error) {
      console.warn(`ノート作成エラー (eventId: ${event.id}):`, error);
    }
  }
  
  return createdCount;
}

/**
 * 特定のストラテジーの勝ちノート統計を取得
 */
export async function getStrategyNoteStats(strategyId: string): Promise<{
  total: number;
  active: number;
  draft: number;
  archived: number;
  byOutcome: { win: number; loss: number; timeout: number };
}> {
  const notes = await prisma.strategyNote.groupBy({
    by: ['status', 'outcome'],
    where: { strategyId },
    _count: true,
  });
  
  const stats = {
    total: 0,
    active: 0,
    draft: 0,
    archived: 0,
    byOutcome: { win: 0, loss: 0, timeout: 0 },
  };
  
  for (const group of notes) {
    const count = group._count;
    stats.total += count;
    
    // ステータス別
    if (group.status === 'active') stats.active += count;
    else if (group.status === 'draft') stats.draft += count;
    else if (group.status === 'archived') stats.archived += count;
    
    // アウトカム別
    if (group.outcome === 'win') stats.byOutcome.win += count;
    else if (group.outcome === 'loss') stats.byOutcome.loss += count;
    else if (group.outcome === 'timeout') stats.byOutcome.timeout += count;
  }
  
  return stats;
}
