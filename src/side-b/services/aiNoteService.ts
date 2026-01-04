/**
 * AIノート サービス
 * 
 * 仮想トレード決済後にAIが自動でノートを生成し、分析を行う
 * - C-1: ノート自動生成
 * - C-2: 結果分析
 * - C-3: パターン検出
 * - C-4: 学び抽出
 * 
 * @see docs/side-b/phase-c-ai-trade-note.md
 */

import {
  AITradeNote,
  AINoteSummary,
  CreateAITradeNoteInput,
  CreateAINoteSummaryInput,
  TradeOutcome,
  TimingEvaluation,
  ExitTimingEvaluation,
  AccuracyEvaluation,
  ExitType,
  SummaryPeriod,
  TradeResult,
  EntryAnalysis,
  ExitAnalysis,
  PlanEvaluation,
  MarketReview,
  Learnings,
  SimilarPattern,
  SummaryStatistics,
  SummaryAnalysis,
  SummarySummary,
  determineOutcome,
  calculateHoldingDuration,
  calculateActualRR,
  calculateStatisticsFromNotes,
} from '../models';
import * as aiNoteRepository from '../repositories/aiNoteRepository';

// ===== 設定 =====

// 使用するAIモデル
const AI_MODEL = 'gpt-4o-mini';

// 類似度の閾値（この値以上なら類似パターンとして登録）
const SIMILARITY_THRESHOLD = 70;

// 類似パターン検索の最大件数
const MAX_SIMILAR_PATTERNS = 5;

// ===== 型定義 =====

/** 仮想トレード（サービス入力用） */
interface VirtualTradeInput {
  id: string;
  planId: string;
  symbol: string;
  direction: 'long' | 'short';
  plannedEntry: number;
  actualEntry: number | null;
  stopLoss: number;
  takeProfit: number;
  exitPrice: number | null;
  exitReason: string | null;
  enteredAt: Date | null;
  exitedAt: Date | null;
  pnlPips: number | null;
}

/** プラン（サービス入力用） */
interface PlanInput {
  id: string;
  marketAnalysis: {
    regime: string;
    summary: string;
  };
  scenarios: Array<{
    direction: string;
    priority: string;
  }>;
}

/** ノート生成結果 */
interface GenerateNoteResult {
  note: AITradeNote;
  similarPatternsFound: number;
}

// ===== メインサービス関数 =====

/**
 * 仮想トレード決済時にAIノートを自動生成
 * 
 * C-1: ノート自動生成
 * C-2: 結果分析
 * C-3: パターン検出
 * C-4: 学び抽出
 */
export async function generateNoteFromTrade(
  trade: VirtualTradeInput,
  plan: PlanInput
): Promise<GenerateNoteResult> {
  // 決済されていない場合はエラー
  if (!trade.exitPrice || !trade.exitedAt || !trade.enteredAt) {
    throw new Error('トレードが決済されていません');
  }

  // 既存ノートがあるかチェック
  const existingNote = await aiNoteRepository.findAITradeNoteByVirtualTradeId(trade.id);
  if (existingNote) {
    return { note: existingNote, similarPatternsFound: 0 };
  }

  // 結果を計算
  const result = calculateTradeResult(trade);

  // 各分析を生成
  const entryAnalysis = analyzeEntry(trade);
  const exitAnalysis = analyzeExit(trade);
  const planEvaluation = evaluatePlan(trade, plan);
  const marketReview = reviewMarket(trade, plan);
  const learnings = extractLearnings(result, entryAnalysis, exitAnalysis, planEvaluation);

  // 類似パターンを検索
  const similarPatterns = await findSimilarPatterns(trade, result);

  // ノート入力を作成
  const input: CreateAITradeNoteInput = {
    virtualTradeId: trade.id,
    planId: trade.planId,
    date: trade.exitedAt.toISOString().split('T')[0],
    symbol: trade.symbol,
    direction: trade.direction,
    result,
    entryAnalysis,
    exitAnalysis,
    planEvaluation,
    marketReview,
    learnings,
    similarPatterns: similarPatterns.length > 0 ? similarPatterns : undefined,
    aiModel: AI_MODEL,
  };

  // ノートを保存
  const note = await aiNoteRepository.createAITradeNote(input);

  return {
    note,
    similarPatternsFound: similarPatterns.length,
  };
}

/**
 * AIノートを取得
 */
export async function getNote(id: string): Promise<AITradeNote | null> {
  return aiNoteRepository.findAITradeNoteById(id);
}

/**
 * AIノート一覧を取得
 */
export async function listNotes(options: {
  from?: string;
  to?: string;
  outcome?: TradeOutcome;
  symbol?: string;
  limit?: number;
  offset?: number;
}): Promise<{ notes: AITradeNote[]; total: number; stats: { winCount: number; lossCount: number; winRate: number } }> {
  const { notes, total } = await aiNoteRepository.findAITradeNotes(options);
  const counts = await aiNoteRepository.countNotesByOutcome();

  const totalCounted = counts.win + counts.loss + counts.breakeven;
  const winRate = totalCounted > 0 ? (counts.win / totalCounted) * 100 : 0;

  return {
    notes,
    total,
    stats: {
      winCount: counts.win,
      lossCount: counts.loss,
      winRate: Math.round(winRate * 10) / 10,
    },
  };
}

// ===== サマリー生成 =====

/**
 * 期間サマリーを生成
 */
export async function generateSummary(
  period: SummaryPeriod,
  startDate: string,
  endDate: string
): Promise<AINoteSummary> {
  // 期間内のノートを取得
  const notes = await aiNoteRepository.findAITradeNotesInPeriod(startDate, endDate);

  // 統計を計算
  const statistics = calculateStatisticsFromNotes(notes);

  // 分析を生成
  const analysis = generateAnalysis(notes);

  // 総括を生成
  const summary = generateSummarySummary(notes, statistics, analysis);

  // 入力を作成
  const input: CreateAINoteSummaryInput = {
    period,
    startDate,
    endDate,
    statistics,
    analysis,
    summary,
  };

  // upsertで保存（既存があれば更新）
  return aiNoteRepository.upsertAINoteSummary(input);
}

/**
 * サマリー一覧を取得
 */
export async function listSummaries(options: {
  period?: SummaryPeriod;
  limit?: number;
  offset?: number;
}): Promise<{ summaries: AINoteSummary[]; total: number }> {
  return aiNoteRepository.findAINoteSummaries(options);
}

// ===== 分析ヘルパー関数 =====

/**
 * トレード結果を計算
 */
function calculateTradeResult(trade: VirtualTradeInput): TradeResult {
  const pnlPips = trade.pnlPips ?? 0;
  const entryPrice = trade.actualEntry ?? trade.plannedEntry;
  const holdingDuration = trade.enteredAt && trade.exitedAt
    ? calculateHoldingDuration(trade.enteredAt, trade.exitedAt)
    : 0;

  const rrActual = calculateActualRR(
    trade.direction,
    entryPrice,
    trade.exitPrice!,
    trade.stopLoss
  );

  // PnL%を計算（エントリー価格に対する変動率）
  const pnlPercentage = entryPrice > 0 
    ? ((trade.exitPrice! - entryPrice) / entryPrice) * 100 * (trade.direction === 'long' ? 1 : -1)
    : 0;

  return {
    outcome: determineOutcome(pnlPips),
    pnlPips,
    pnlPercentage: Math.round(pnlPercentage * 100) / 100,
    riskRewardActual: rrActual,
    holdingDuration,
  };
}

/**
 * エントリーを分析
 */
function analyzeEntry(trade: VirtualTradeInput): EntryAnalysis {
  const plannedEntry = trade.plannedEntry;
  const actualEntry = trade.actualEntry ?? plannedEntry;
  const priceVsPlan = Math.round(Math.abs(actualEntry - plannedEntry) * 10) / 10;

  // 計画との乖離が小さいほど良い評価
  let timing: TimingEvaluation = 'good';
  if (priceVsPlan > 5) timing = 'poor';
  else if (priceVsPlan > 2) timing = 'fair';

  // 評価コメント生成
  let evaluation = '';
  if (timing === 'good') {
    evaluation = '計画通りのエントリーを実行できた。';
  } else if (timing === 'fair') {
    evaluation = `計画価格から${priceVsPlan} pips乖離したが許容範囲内。`;
  } else {
    evaluation = `計画価格から${priceVsPlan} pips乖離。エントリー条件の見直しが必要。`;
  }

  return {
    timing,
    priceVsPlan,
    marketConditionAtEntry: '市場状況の詳細分析は今後実装予定',
    evaluation,
  };
}

/**
 * 決済を分析
 */
function analyzeExit(trade: VirtualTradeInput): ExitAnalysis {
  const exitReason = trade.exitReason ?? 'manual';
  const type = mapExitReason(exitReason);

  // 決済タイミングの評価
  // TODO: 決済後の価格推移を見て評価する（今は仮実装）
  let timing: ExitTimingEvaluation = 'optimal';
  let missedPotential: number | undefined;

  // TPで決済した場合、もう少し伸びた可能性
  if (type === 'take_profit') {
    timing = 'early'; // 仮：今後実装
    missedPotential = 10; // 仮値
  }

  // 評価コメント生成
  let evaluation = '';
  switch (type) {
    case 'take_profit':
      evaluation = '利確目標に到達。';
      if (missedPotential) {
        evaluation += `さらに${missedPotential} pips伸びた可能性あり。`;
      }
      break;
    case 'stop_loss':
      evaluation = '損切りラインに到達。リスク管理は機能した。';
      break;
    case 'manual':
      evaluation = '手動で決済を実行。';
      break;
    default:
      evaluation = `${exitReason}による決済。`;
  }

  return {
    type,
    timing,
    missedPotential,
    evaluation,
  };
}

/**
 * プランを評価
 */
function evaluatePlan(trade: VirtualTradeInput, plan: PlanInput): PlanEvaluation {
  // 方向が正しかったか
  const primaryScenario = plan.scenarios[0];
  const directionCorrect = primaryScenario 
    ? primaryScenario.direction === trade.direction
    : true;

  // シナリオ精度（勝ちなら正確と仮定）
  const pnl = trade.pnlPips ?? 0;
  let scenarioAccuracy: AccuracyEvaluation = 'partial';
  if (pnl > 0) scenarioAccuracy = 'accurate';
  else if (pnl < -10) scenarioAccuracy = 'inaccurate';

  // レベル精度（SL/TPに対するエントリーの位置）
  const levelAccuracy: AccuracyEvaluation = 'accurate'; // 今後詳細実装

  // 評価コメント
  let evaluation = '';
  if (scenarioAccuracy === 'accurate') {
    evaluation = 'プランのシナリオが機能した。';
  } else if (scenarioAccuracy === 'partial') {
    evaluation = '部分的にシナリオが機能したが、改善の余地あり。';
  } else {
    evaluation = 'シナリオの精度に課題あり。前提条件の見直しが必要。';
  }

  return {
    scenarioAccuracy,
    levelAccuracy,
    directionCorrect,
    evaluation,
  };
}

/**
 * 市場を振り返り
 */
function reviewMarket(trade: VirtualTradeInput, plan: PlanInput): MarketReview {
  return {
    regimeActual: plan.marketAnalysis.regime, // 今後: 実際のレジームを検証
    regimePredicted: plan.marketAnalysis.regime,
    keyEventsImpact: [], // 今後: 重要イベントの影響を分析
    volatilityNote: '今後実装: ボラティリティ分析',
  };
}

/**
 * 学びを抽出
 */
function extractLearnings(
  result: TradeResult,
  entryAnalysis: EntryAnalysis,
  exitAnalysis: ExitAnalysis,
  planEvaluation: PlanEvaluation
): Learnings {
  const whatWorked: string[] = [];
  const whatDidntWork: string[] = [];
  const actionItems: string[] = [];

  // 勝ちの場合
  if (result.outcome === 'win') {
    if (entryAnalysis.timing === 'good') {
      whatWorked.push('計画通りのエントリータイミング');
    }
    if (planEvaluation.scenarioAccuracy === 'accurate') {
      whatWorked.push('シナリオ分析の精度');
    }
    if (planEvaluation.directionCorrect) {
      whatWorked.push('トレンド方向の判断');
    }

    // 改善点
    if (exitAnalysis.timing === 'early' && exitAnalysis.missedPotential) {
      whatDidntWork.push('利益の取り逃し');
      actionItems.push('トレーリングストップの検討');
    }
  }
  // 負けの場合
  else if (result.outcome === 'loss') {
    if (entryAnalysis.timing === 'poor') {
      whatDidntWork.push('エントリータイミングの悪さ');
      actionItems.push('エントリー条件の厳格化');
    }
    if (!planEvaluation.directionCorrect) {
      whatDidntWork.push('トレンド方向の誤判断');
      actionItems.push('マルチタイムフレーム分析の強化');
    }
    if (planEvaluation.scenarioAccuracy === 'inaccurate') {
      whatDidntWork.push('シナリオ分析の精度不足');
      actionItems.push('市場環境の判定ロジック見直し');
    }

    // SL機能は常に機能
    whatWorked.push('損切りルールの遵守');
  }

  // 主要な気づき
  let keyInsight = '';
  if (result.outcome === 'win') {
    keyInsight = result.riskRewardActual >= 1.5
      ? '良好なRR比でのトレードを実現できた。'
      : '勝ちトレードだが、RR比の改善余地あり。';
  } else {
    keyInsight = actionItems.length > 0
      ? `改善ポイント: ${actionItems[0]}`
      : '損失を最小限に抑えられた。';
  }

  return {
    whatWorked,
    whatDidntWork,
    keyInsight,
    actionItems,
  };
}

/**
 * 類似パターンを検索
 */
async function findSimilarPatterns(
  trade: VirtualTradeInput,
  result: TradeResult
): Promise<SimilarPattern[]> {
  // 過去のノートを取得
  const recentNotes = await aiNoteRepository.findAITradeNotesBySymbol(
    trade.symbol,
    50
  );

  if (recentNotes.length === 0) {
    return [];
  }

  // 現在のトレードの特徴を抽出
  const currentFeatures = extractTradeFeatures(trade, result);

  // 各ノートとの類似度を計算
  const similarPatterns: SimilarPattern[] = [];

  for (const note of recentNotes) {
    // 同じトレードはスキップ
    if (note.virtualTradeId === trade.id) continue;

    // 特徴を抽出して類似度計算
    const noteFeatures = extractNoteFeatures(note);
    const similarity = calculateSimpleSimilarity(currentFeatures, noteFeatures);

    if (similarity >= SIMILARITY_THRESHOLD) {
      similarPatterns.push({
        noteId: note.id,
        similarity,
        outcome: note.result.outcome,
      });
    }
  }

  // 類似度順にソートして上位を返す
  return similarPatterns
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, MAX_SIMILAR_PATTERNS);
}

/**
 * トレードから特徴を抽出
 */
function extractTradeFeatures(
  trade: VirtualTradeInput,
  result: TradeResult
): number[] {
  return [
    trade.direction === 'long' ? 1 : 0,
    Math.min(result.riskRewardActual, 5) / 5, // RR比（正規化）
    Math.min(result.holdingDuration, 480) / 480, // 保有時間（正規化、8時間まで）
    result.outcome === 'win' ? 1 : 0,
  ];
}

/**
 * ノートから特徴を抽出
 */
function extractNoteFeatures(note: AITradeNote): number[] {
  return [
    note.direction === 'long' ? 1 : 0,
    Math.min(note.result.riskRewardActual, 5) / 5,
    Math.min(note.result.holdingDuration, 480) / 480,
    note.result.outcome === 'win' ? 1 : 0,
  ];
}

/**
 * 簡易類似度計算
 */
function calculateSimpleSimilarity(
  features1: number[],
  features2: number[]
): number {
  if (features1.length !== features2.length) return 0;

  let diff = 0;
  for (let i = 0; i < features1.length; i++) {
    diff += Math.abs(features1[i] - features2[i]);
  }

  // 差分を類似度に変換（0-100）
  const maxDiff = features1.length; // 各特徴の最大差は1
  return Math.round((1 - diff / maxDiff) * 100);
}

/**
 * 分析を生成
 */
function generateAnalysis(notes: AITradeNote[]): SummaryAnalysis {
  // セットアップ別の成績を集計（今後実装：詳細分析）
  const directionStats: Record<string, { wins: number; losses: number; pnl: number }> = {
    long: { wins: 0, losses: 0, pnl: 0 },
    short: { wins: 0, losses: 0, pnl: 0 },
  };

  for (const note of notes) {
    const stat = directionStats[note.direction];
    if (note.result.outcome === 'win') stat.wins++;
    else if (note.result.outcome === 'loss') stat.losses++;
    stat.pnl += note.result.pnlPips;
  }

  // ベスト/ワーストのセットアップを判定
  const longTotal = directionStats.long.wins + directionStats.long.losses;
  const shortTotal = directionStats.short.wins + directionStats.short.losses;
  const longWinRate = longTotal > 0 ? directionStats.long.wins / longTotal : 0;
  const shortWinRate = shortTotal > 0 ? directionStats.short.wins / shortTotal : 0;

  const bestSetup = longWinRate >= shortWinRate ? 'ロング' : 'ショート';
  const worstSetup = longWinRate < shortWinRate ? 'ロング' : 'ショート';

  return {
    bestPerformingSetup: bestSetup,
    worstPerformingSetup: worstSetup,
    regimePerformance: [], // 今後実装
    timeOfDayPerformance: [], // 今後実装
  };
}

/**
 * サマリー総括を生成
 */
function generateSummarySummary(
  notes: AITradeNote[],
  statistics: SummaryStatistics,
  analysis: SummaryAnalysis
): SummarySummary {
  // 総合評価
  let overallAssessment = '';
  if (statistics.winRate >= 60 && statistics.profitFactor >= 1.5) {
    overallAssessment = '優秀なパフォーマンス。現在の戦略を継続。';
  } else if (statistics.winRate >= 50 && statistics.profitFactor >= 1.0) {
    overallAssessment = '安定したパフォーマンス。微調整で改善可能。';
  } else {
    overallAssessment = '改善が必要。戦略の見直しを検討。';
  }

  // 学びを集約
  const keyLearnings: string[] = [];
  const allLearnings = notes.flatMap(n => n.learnings.whatWorked);
  const uniqueLearnings = [...new Set(allLearnings)].slice(0, 3);
  keyLearnings.push(...uniqueLearnings);

  // 改善推奨
  const recommendations: string[] = [];
  const allActions = notes.flatMap(n => n.learnings.actionItems);
  const uniqueActions = [...new Set(allActions)].slice(0, 3);
  recommendations.push(...uniqueActions);

  // 次期間の焦点
  let focusForNext = '';
  if (statistics.winRate < 50) {
    focusForNext = 'エントリー精度の向上';
  } else if (statistics.profitFactor < 1.5) {
    focusForNext = 'リスクリワード比の改善';
  } else {
    focusForNext = '現在の戦略の維持・微調整';
  }

  return {
    overallAssessment,
    keyLearnings,
    recommendations,
    focusForNext,
  };
}

// ===== ユーティリティ =====

/**
 * 決済理由をExitTypeにマッピング
 */
function mapExitReason(reason: string): ExitType {
  const map: Record<string, ExitType> = {
    take_profit: 'take_profit',
    stop_loss: 'stop_loss',
    trailing_stop: 'trailing_stop',
    time_expiry: 'time_expiry',
    manual: 'manual',
    signal_invalidation: 'other',
  };
  return map[reason] ?? 'other';
}
