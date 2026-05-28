/**
 * AIトレードノート モデル定義
 * 
 * 仮想トレードの結果をAIが自動分析し記録するノート
 * Side-A（人間のノート）との違い:
 * - 作成者: AI
 * - 対象: 仮想トレード
 * - 感情記録: なし（AIは感情を持たない）
 * 
 * @see docs/side-b/phase-c-ai-trade-note.md
 */

// ===== 列挙型 =====

/** トレード結果 */
export type TradeOutcome = 'win' | 'loss' | 'breakeven';

/** タイミング評価 */
export type TimingEvaluation = 'good' | 'fair' | 'poor';

/** 決済タイミング評価 */
export type ExitTimingEvaluation = 'optimal' | 'early' | 'late';

/** 精度評価 */
export type AccuracyEvaluation = 'accurate' | 'partial' | 'inaccurate';

/** 決済タイプ */
export type ExitType = 'take_profit' | 'stop_loss' | 'manual' | 'trailing_stop' | 'time_expiry' | 'other';

/** サマリー期間 */
export type SummaryPeriod = 'daily' | 'weekly' | 'monthly';

// ===== サブ型定義 =====

/** 結果サマリー */
export interface TradeResult {
  /** 勝敗 */
  outcome: TradeOutcome;
  /** PnL (pips) */
  pnlPips: number;
  /** PnL (%) */
  pnlPercentage: number;
  /** 実際のリスクリワード比 */
  riskRewardActual: number;
  /** 保有時間（分） */
  holdingDuration: number;
}

/** エントリー分析 */
export interface EntryAnalysis {
  /** タイミング評価 */
  timing: TimingEvaluation;
  /** 計画との乖離 (pips) */
  priceVsPlan: number;
  /** エントリー時の市場状況 */
  marketConditionAtEntry: string;
  /** AIの評価コメント */
  evaluation: string;
}

/** 決済分析 */
export interface ExitAnalysis {
  /** 決済タイプ */
  type: ExitType;
  /** タイミング評価 */
  timing: ExitTimingEvaluation;
  /** 逃した利益 (pips) - TP到達後も伸びた場合など */
  missedPotential?: number;
  /** AIの評価コメント */
  evaluation: string;
}

/** プラン評価 */
export interface PlanEvaluation {
  /** シナリオ精度 */
  scenarioAccuracy: AccuracyEvaluation;
  /** レベル（S/R）精度 */
  levelAccuracy: AccuracyEvaluation;
  /** 方向が正しかったか */
  directionCorrect: boolean;
  /** AIの評価コメント */
  evaluation: string;
}

/** 市場振り返り */
export interface MarketReview {
  /** 実際のレジーム */
  regimeActual: string;
  /** 予測したレジーム */
  regimePredicted: string;
  /** 影響したイベント */
  keyEventsImpact: string[];
  /** ボラティリティに関するメモ */
  volatilityNote: string;
}

/** 学び */
export interface Learnings {
  /** うまくいったこと */
  whatWorked: string[];
  /** うまくいかなかったこと */
  whatDidntWork: string[];
  /** 主要な気づき */
  keyInsight: string;
  /** 次回への改善項目 */
  actionItems: string[];
}

/** 類似パターン */
export interface SimilarPattern {
  /** 類似ノートのID */
  noteId: string;
  /** 類似度 (0-100) */
  similarity: number;
  /** そのノートの結果 */
  outcome: TradeOutcome;
}

// ===== メイン型定義 =====

/**
 * AIトレードノート
 * 仮想トレード完了後にAIが自動生成する分析ノート
 */
export interface AITradeNote {
  id: string;

  // 関連ID
  virtualTradeId: string;
  planId: string;

  // 基本情報
  date: string;  // YYYY-MM-DD
  symbol: string;
  direction: 'long' | 'short';
  /** 執行足（current timeframe）。trade から伝播。MTF 文脈の一級フィールド。既存ノートは未設定あり。 */
  timeframe?: string;
  /** 分析した上位足（higher timeframe）。trade から伝播。 */
  higherTimeframe?: string;

  // 結果
  result: TradeResult;

  // 分析
  entryAnalysis: EntryAnalysis;
  exitAnalysis: ExitAnalysis;
  planEvaluation: PlanEvaluation;
  marketReview: MarketReview;
  learnings: Learnings;

  // 類似パターン
  similarPatterns?: SimilarPattern[];

  /**
   * レンズ特徴量スナップショット（Phase 1: 並列レンズ基盤）
   *
   * トレード時点での全レンズ出力。SerializedLensFeatureSnapshot と同じ
   * 構造だが、永続化層（Prisma Json?）との互換性のためにここでは
   * プレーンな型のみで表現する。
   *
   * 既存ノートは undefined のまま読み込めるよう optional。
   */
  lensSnapshot?: {
    timestamp: string;
    features: Record<string, Record<string, number | string | boolean>>;
    totalComputeDurationMs?: number;
  };

  /**
   * このトレード時点で成立していたエッジ仮説ID（Phase 4a）
   * EdgeLedger.findMatching で抽出された仮説。ReflectionAI が recordObservation
   * で実績を反映する。
   */
  relatedHypothesisIds?: string[];

  /**
   * 対応する Side-A TradeNote の ID（Phase 4b）
   * aiNoteService.generateNoteFromTrade 内で同時生成された TradeNote との紐付け
   */
  tradeNoteId?: string;

  // メタ情報
  aiModel: string;
  createdAt: Date;
}

/**
 * AIノート生成用入力
 */
export interface CreateAITradeNoteInput {
  virtualTradeId: string;
  planId: string;
  date: string;
  symbol: string;
  direction: 'long' | 'short';
  /** 執行足（current timeframe）。trade から伝播。MTF 文脈の一級フィールド。 */
  timeframe?: string;
  /** 分析した上位足（higher timeframe）。trade から伝播。 */
  higherTimeframe?: string;
  result: TradeResult;
  entryAnalysis: EntryAnalysis;
  exitAnalysis: ExitAnalysis;
  planEvaluation: PlanEvaluation;
  marketReview: MarketReview;
  learnings: Learnings;
  similarPatterns?: SimilarPattern[];
  lensSnapshot?: AITradeNote['lensSnapshot'];
  relatedHypothesisIds?: string[];
  tradeNoteId?: string;
  aiModel: string;
}

// ===== サマリー型定義 =====

/** レジーム別パフォーマンス */
export interface RegimePerformance {
  regime: string;
  winRate: number;
  avgPnl: number;
  tradeCount: number;
}

/** 時間帯別パフォーマンス */
export interface TimeOfDayPerformance {
  session: string;  // 'tokyo' | 'london' | 'newyork'
  winRate: number;
  avgPnl: number;
  tradeCount: number;
}

/** サマリー統計 */
export interface SummaryStatistics {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  totalPnl: number;
}

/** サマリー分析 */
export interface SummaryAnalysis {
  bestPerformingSetup: string;
  worstPerformingSetup: string;
  regimePerformance: RegimePerformance[];
  timeOfDayPerformance: TimeOfDayPerformance[];
}

/** サマリー総括 */
export interface SummarySummary {
  overallAssessment: string;
  keyLearnings: string[];
  recommendations: string[];
  focusForNext: string;
}

/**
 * AIノートサマリー（期間集計）
 */
export interface AINoteSummary {
  id: string;
  
  // 期間
  period: SummaryPeriod;
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
  
  // 統計
  statistics: SummaryStatistics;
  
  // 分析
  analysis: SummaryAnalysis;
  
  // 総括
  summary: SummarySummary;
  
  // メタ
  createdAt: Date;
}

/**
 * サマリー生成用入力
 */
export interface CreateAINoteSummaryInput {
  period: SummaryPeriod;
  startDate: string;
  endDate: string;
  statistics: SummaryStatistics;
  analysis: SummaryAnalysis;
  summary: SummarySummary;
}

// ===== ユーティリティ関数 =====

/**
 * 結果を日本語に変換
 */
export function outcomeToJapanese(outcome: TradeOutcome): string {
  const map: Record<TradeOutcome, string> = {
    win: '勝ち',
    loss: '負け',
    breakeven: '同値撤退',
  };
  return map[outcome];
}

/**
 * タイミング評価を日本語に変換
 */
export function timingToJapanese(timing: TimingEvaluation): string {
  const map: Record<TimingEvaluation, string> = {
    good: '良好',
    fair: '普通',
    poor: '不良',
  };
  return map[timing];
}

/**
 * 決済タイミング評価を日本語に変換
 */
export function exitTimingToJapanese(timing: ExitTimingEvaluation): string {
  const map: Record<ExitTimingEvaluation, string> = {
    optimal: '最適',
    early: '早すぎ',
    late: '遅すぎ',
  };
  return map[timing];
}

/**
 * 精度評価を日本語に変換
 */
export function accuracyToJapanese(accuracy: AccuracyEvaluation): string {
  const map: Record<AccuracyEvaluation, string> = {
    accurate: '正確',
    partial: '部分的',
    inaccurate: '不正確',
  };
  return map[accuracy];
}

/**
 * 決済タイプを日本語に変換
 */
export function exitTypeToJapanese(type: ExitType): string {
  const map: Record<ExitType, string> = {
    take_profit: '利確',
    stop_loss: '損切り',
    manual: '手動決済',
    trailing_stop: 'トレーリング',
    time_expiry: '期限切れ',
    other: 'その他',
  };
  return map[type];
}

/**
 * 期間を日本語に変換
 */
export function periodToJapanese(period: SummaryPeriod): string {
  const map: Record<SummaryPeriod, string> = {
    daily: '日次',
    weekly: '週次',
    monthly: '月次',
  };
  return map[period];
}

/**
 * PnLから結果を判定
 */
export function determineOutcome(pnlPips: number): TradeOutcome {
  if (pnlPips > 0.5) return 'win';
  if (pnlPips < -0.5) return 'loss';
  return 'breakeven';
}

/**
 * 保有時間（分）を計算
 */
export function calculateHoldingDuration(entryTime: Date, exitTime: Date): number {
  return Math.round((exitTime.getTime() - entryTime.getTime()) / (1000 * 60));
}

/**
 * 実際のRR比を計算
 */
export function calculateActualRR(
  direction: 'long' | 'short',
  entryPrice: number,
  exitPrice: number,
  stopLoss: number
): number {
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = direction === 'long' 
    ? exitPrice - entryPrice 
    : entryPrice - exitPrice;
  
  if (risk === 0) return 0;
  return Math.round((reward / risk) * 100) / 100;
}

/**
 * デフォルトの学びを作成
 */
export function createDefaultLearnings(): Learnings {
  return {
    whatWorked: [],
    whatDidntWork: [],
    keyInsight: '',
    actionItems: [],
  };
}

/**
 * デフォルトの統計を作成
 */
export function createDefaultStatistics(): SummaryStatistics {
  return {
    totalTrades: 0,
    winRate: 0,
    profitFactor: 0,
    averageWin: 0,
    averageLoss: 0,
    largestWin: 0,
    largestLoss: 0,
    totalPnl: 0,
  };
}

/**
 * ノート配列から統計を計算
 */
export function calculateStatisticsFromNotes(notes: AITradeNote[]): SummaryStatistics {
  if (notes.length === 0) {
    return createDefaultStatistics();
  }
  
  const wins = notes.filter(n => n.result.outcome === 'win');
  const losses = notes.filter(n => n.result.outcome === 'loss');
  
  const winPnls = wins.map(n => n.result.pnlPips);
  const lossPnls = losses.map(n => Math.abs(n.result.pnlPips));
  
  const totalWinPips = winPnls.reduce((sum, p) => sum + p, 0);
  const totalLossPips = lossPnls.reduce((sum, p) => sum + p, 0);
  
  return {
    totalTrades: notes.length,
    winRate: notes.length > 0 ? (wins.length / notes.length) * 100 : 0,
    profitFactor: totalLossPips > 0 ? totalWinPips / totalLossPips : 0,
    averageWin: wins.length > 0 ? totalWinPips / wins.length : 0,
    averageLoss: losses.length > 0 ? totalLossPips / losses.length : 0,
    largestWin: winPnls.length > 0 ? Math.max(...winPnls) : 0,
    largestLoss: lossPnls.length > 0 ? Math.max(...lossPnls) : 0,
    totalPnl: notes.reduce((sum, n) => sum + n.result.pnlPips, 0),
  };
}

/**
 * 類似度を計算（特徴量ベクトル間）
 */
export function calculateNoteSimilarity(
  note1Features: number[],
  note2Features: number[]
): number {
  if (note1Features.length !== note2Features.length) return 0;
  
  // コサイン類似度
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < note1Features.length; i++) {
    dotProduct += note1Features[i] * note2Features[i];
    norm1 += note1Features[i] * note1Features[i];
    norm2 += note2Features[i] * note2Features[i];
  }
  
  if (norm1 === 0 || norm2 === 0) return 0;
  
  return Math.round((dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2))) * 100);
}
