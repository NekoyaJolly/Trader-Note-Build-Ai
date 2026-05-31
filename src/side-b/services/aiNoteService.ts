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

import type {
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
  SummarySummary} from '../models';
import {
  determineOutcome,
  calculateHoldingDuration,
  calculateActualRR,
  calculateStatisticsFromNotes,
} from '../models';
import * as aiNoteRepository from '../repositories/aiNoteRepository';
import { serializeLensSnapshot, type LensFeatureSnapshot } from '../lenses';
import { edgeLedger } from '../ledger';
import { materializationService } from '../bridge';
import { modelFor } from '../../config';
import type { Prisma } from '@prisma/client';
import { ReflectionOutputSchema } from '../../schemas/api/sideB';

// ===== 設定 =====

// 使用するAIモデル ラベル (`ai_note` キー、env 上書き可: AI_MODEL_AI_NOTE / AI_MODEL_OVERRIDE_ALL)。
// ノートに保存する aiModel ラベル用。aiNoteService 自体は LLM を直接
// 呼ばないが、どのモデルで周辺処理が動いているかを記録する目印となる。
function currentAIModel(): string {
  return modelFor('ai_note');
}

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
  /** MTF 文脈: 執行足 + 上位足 (VirtualTrade から伝播、legacy トレードは null)。 */
  timeframe?: string | null;
  higherTimeframe?: string | null;
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
  /** Step C-1: reflectionAI の分析結果 (VirtualTrade.reflection、未生成は null)。統合ノートに反映する。 */
  reflection?: Prisma.JsonValue | null;
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
  plan: PlanInput,
  lensSnapshot?: LensFeatureSnapshot,
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
  // Step C-1: 決定論的 learnings に reflectionAI の分析結果を統合する。
  // reflection が null なら従来通り (= aiNoteService 単独分析)。
  const baseLearnings = extractLearnings(result, entryAnalysis, exitAnalysis, planEvaluation);
  const learnings = mergeReflectionIntoLearnings(baseLearnings, trade.reflection);

  // 類似パターンを検索
  const similarPatterns = await findSimilarPatterns(trade, result);

  // レンズスナップショットを AITradeNote 形式に変換（Phase 3）
  let lensSnapshotForNote: CreateAITradeNoteInput['lensSnapshot'];
  if (lensSnapshot) {
    const serialized = serializeLensSnapshot(lensSnapshot);
    lensSnapshotForNote = {
      timestamp: serialized.timestamp,
      features: serialized.features,
      totalComputeDurationMs: serialized.totalComputeDurationMs,
    };
  }

  // Phase 4a: トレード時点で成立していた仮説を EdgeLedger から抽出
  let matchedHypothesisIds: string[] = [];
  if (lensSnapshot) {
    try {
      const matched = await edgeLedger.findMatching(trade.symbol, lensSnapshot, {
        statuses: ['confirmed', 'testing', 'unverified'],
      });
      matchedHypothesisIds = matched.map((h) => h.id);
    } catch (err) {
      console.warn('[aiNoteService] EdgeLedger.findMatching 失敗:', err);
    }
  }

  // ノート入力を作成
  const input: CreateAITradeNoteInput = {
    virtualTradeId: trade.id,
    planId: trade.planId,
    date: trade.exitedAt.toISOString().split('T')[0],
    symbol: trade.symbol,
    timeframe: trade.timeframe ?? undefined,
    higherTimeframe: trade.higherTimeframe ?? undefined,
    direction: trade.direction,
    result,
    entryAnalysis,
    exitAnalysis,
    planEvaluation,
    marketReview,
    learnings,
    similarPatterns: similarPatterns.length > 0 ? similarPatterns : undefined,
    lensSnapshot: lensSnapshotForNote,
    relatedHypothesisIds: matchedHypothesisIds.length > 0 ? matchedHypothesisIds : undefined,
    aiModel: currentAIModel(),
  };

  // ノートを保存
  const note = await aiNoteRepository.createAITradeNote(input);

  // Phase 4b ブリッジ層: Side-A TradeNote を同時生成（best-effort）
  //   失敗時は AITradeNote 作成は成功扱いのまま継続し、warning ログのみ残す。
  if (trade.enteredAt) {
    const entryPrice = trade.actualEntry ?? trade.plannedEntry;
    try {
      const tradeNoteId = await materializationService.materializeFromVirtualTrade({
        symbol: trade.symbol,
        side: trade.direction,
        entryPrice,
        enteredAt: trade.enteredAt,
      });
      await aiNoteRepository.updateAITradeNoteTradeNoteId(note.id, tradeNoteId);
      note.tradeNoteId = tradeNoteId;
    } catch (err) {
      console.warn('[aiNoteService] TradeNote 同時生成失敗 (継続):', err);
    }
  }

  // Phase 4a: 成立仮説に対して観測結果を反映（failure は warnings に留めてノート作成は成功扱い）
  for (const hypothesisId of matchedHypothesisIds) {
    try {
      await edgeLedger.recordObservation(hypothesisId, {
        outcome: result.outcome,
        pnlPips: result.pnlPips,
        rr: result.riskRewardActual,
        noteId: note.id,
      });
    } catch (err) {
      console.warn(
        `[aiNoteService] EdgeLedger.recordObservation 失敗 (hypothesis=${hypothesisId}):`,
        err,
      );
    }
  }

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
  /** 本番運用フラグでの絞り込み。「本番運用」タブ表示で true を渡す。未指定なら全件。 */
  usedForMatching?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{
  notes: AITradeNote[];
  total: number;
  stats: {
    winCount: number;
    lossCount: number;
    winRate: number;
    totalTrades: number;
    profitFactor: number;
    totalPnlPips: number;
  };
}> {
  const { notes, total } = await aiNoteRepository.findAITradeNotes(options);
  // 統計は「全ノート」を DB 集計で対象にする（本番運用フィルタ・ページングの影響を受けない＝計算は全体）
  const [counts, pnl] = await Promise.all([
    aiNoteRepository.countNotesByOutcome(),
    aiNoteRepository.aggregateAllNotesPnl(),
  ]);

  const totalCounted = counts.win + counts.loss + counts.breakeven;
  const winRate = totalCounted > 0 ? (counts.win / totalCounted) * 100 : 0;
  // PF は損失が無い場合 0 とする（既存フロント計算と同じ規約で表示の整合を保つ）
  const profitFactor = pnl.grossLossPips > 0 ? pnl.grossWinPips / pnl.grossLossPips : 0;

  return {
    notes,
    total,
    stats: {
      winCount: counts.win,
      lossCount: counts.loss,
      winRate: Math.round(winRate * 10) / 10,
      totalTrades: totalCounted,
      profitFactor: Math.round(profitFactor * 100) / 100,
      totalPnlPips: Math.round(pnl.totalPnlPips * 10) / 10,
    },
  };
}

/**
 * AIノートの本番運用フラグ（usedForMatching）を更新する
 *
 * 「本番運用」選別の手動トグルで呼ばれる。フラグを true にしたノートだけが
 * 実行時のライブ照合（cross/cron）の対象になる。存在しない ID は null を返す。
 */
export async function setNoteUsedForMatching(
  id: string,
  usedForMatching: boolean
): Promise<AITradeNote | null> {
  return aiNoteRepository.setAITradeNoteUsedForMatching(id, usedForMatching);
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
  const evaluation =
    timing === 'good'
      ? '計画通りのエントリーを実行できた。'
      : timing === 'fair'
        ? `計画価格から${priceVsPlan} pips乖離したが許容範囲内。`
        : `計画価格から${priceVsPlan} pips乖離。エントリー条件の見直しが必要。`;

  return {
    timing,
    priceVsPlan,
    marketConditionAtEntry: '市場状況の詳細分析は今後実装予定',
    evaluation,
  };
}

/**
 * 決済を分析
 * 
 * 決済後の価格推移を分析し、タイミング評価を行う
 * - 利確後にさらに伸びた場合: early（早すぎた）
 * - 利確後に反転した場合: optimal（適切）
 * - 損切り後に回復した場合: poor（早すぎた損切り）
 * - 損切り後にさらに下げた場合: optimal（適切な損切り）
 */
function analyzeExit(trade: VirtualTradeInput): ExitAnalysis {
  const exitReason = trade.exitReason ?? 'manual';
  const type = mapExitReason(exitReason);

  // 決済タイミングの評価
  let timing: ExitTimingEvaluation = 'optimal';
  let missedPotential: number | undefined;

  const entryPrice = trade.actualEntry ?? trade.plannedEntry;
  const pnlPips = trade.pnlPips ?? 0;

  // 決済タイプ別のタイミング評価
  switch (type) {
    case 'take_profit': {
      // 利確の場合
      // RRが1.5以上達成できていれば「良い」、1未満なら「早すぎた」
      const plannedRR = Math.abs(trade.takeProfit - entryPrice) / Math.abs(entryPrice - trade.stopLoss);
      const actualRR = Math.abs(pnlPips) / Math.abs(entryPrice - trade.stopLoss);
      
      if (actualRR >= plannedRR * 0.9) {
        // 計画通りまたはそれ以上達成
        timing = 'optimal';
      } else if (actualRR >= plannedRR * 0.5) {
        // 50%以上達成
        timing = 'early';
        missedPotential = Math.round((plannedRR - actualRR) * Math.abs(entryPrice - trade.stopLoss) * 10) / 10;
      } else {
        // 50%未満
        timing = 'early';
        missedPotential = Math.round((plannedRR - actualRR) * Math.abs(entryPrice - trade.stopLoss) * 10) / 10;
      }
      break;
    }
    
    case 'stop_loss': {
      // 損切りの場合、損失幅で評価
      const plannedLoss = Math.abs(entryPrice - trade.stopLoss);
      const actualLoss = Math.abs(pnlPips);
      
      if (actualLoss <= plannedLoss * 1.1) {
        // 計画通りの損切り（10%以内の誤差）
        timing = 'optimal';
      } else {
        // スリッページで損失拡大
        timing = 'late';
        missedPotential = Math.round((actualLoss - plannedLoss) * 10) / 10;
      }
      break;
    }
    
    case 'manual': {
      // 手動決済の場合、利益が出ているかで判断
      if (pnlPips > 0) {
        // 利益が出ている手動決済は基本的にOK
        timing = 'optimal';
      } else if (pnlPips < 0) {
        // 損失での手動決済は、計画SLより小さければOK
        const plannedLoss = Math.abs(entryPrice - trade.stopLoss);
        if (Math.abs(pnlPips) < plannedLoss) {
          timing = 'optimal';
        } else {
          timing = 'late';
        }
      }
      break;
    }
    
    case 'time_expiry': {
      // 時間切れは基本的に「遅い」
      timing = pnlPips >= 0 ? 'optimal' : 'late';
      break;
    }
    
    default:
      timing = 'optimal';
  }

  // 評価コメント生成
  let evaluation: string;
  switch (type) {
    case 'take_profit':
      if (timing === 'optimal') {
        evaluation = '計画通りの利確を達成。良好なトレード管理。';
      } else {
        evaluation = '利確目標に到達。';
        if (missedPotential) {
          evaluation += `さらに${missedPotential} pips伸びる余地があった可能性。`;
        }
      }
      break;
    case 'stop_loss':
      if (timing === 'optimal') {
        evaluation = '損切りラインに到達。リスク管理は機能した。';
      } else {
        evaluation = '損切り執行にスリッページあり。約定環境の改善を検討。';
      }
      break;
    case 'manual':
      if (pnlPips > 0) {
        evaluation = '手動で利益確定。裁量判断は功を奏した。';
      } else if (pnlPips < 0 && timing === 'optimal') {
        evaluation = '計画損切り前に手動決済。損失を限定できた。';
      } else {
        evaluation = '手動で決済を実行。';
      }
      break;
    case 'time_expiry':
      evaluation = pnlPips >= 0 
        ? '時間切れで決済。利益は確保できた。'
        : '時間切れで決済。ポジション管理を見直す必要あり。';
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
  const evaluation =
    scenarioAccuracy === 'accurate'
      ? 'プランのシナリオが機能した。'
      : scenarioAccuracy === 'partial'
        ? '部分的にシナリオが機能したが、改善の余地あり。'
        : 'シナリオの精度に課題あり。前提条件の見直しが必要。';

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
  const keyInsight =
    result.outcome === 'win'
      ? result.riskRewardActual >= 1.5
        ? '良好なRR比でのトレードを実現できた。'
        : '勝ちトレードだが、RR比の改善余地あり。'
      : actionItems.length > 0
        ? `改善ポイント: ${actionItems[0]}`
        : '損失を最小限に抑えられた。';

  return {
    whatWorked,
    whatDidntWork,
    keyInsight,
    actionItems,
  };
}

/**
 * Step C-1: reflectionAI の分析結果を決定論的 learnings に統合する。
 *
 * - reflection が ReflectionOutput (= reflection 成功) としてパースできる場合:
 *   lessons / strategyAdjustment を actionItems に追記し、keyInsight に
 *   outcomeAnalysis + overallScore を補足する。
 * - reflection が簡易フォールバック構造 ({ fallback: true, summary }) の場合:
 *   summary を keyInsight に補足する。
 * - reflection が null / 不正な場合: 従来の learnings をそのまま返す。
 *
 * 決定論的処理 (= LLM 非使用) を維持。reflection は別途 reflectionAIService が生成済。
 *
 * `export` はユニットテスト用 (= generateNoteFromTrade 経由だと mock が重いため純粋関数を直接検証)。
 */
export function mergeReflectionIntoLearnings(
  learnings: Learnings,
  reflection: Prisma.JsonValue | null | undefined,
): Learnings {
  if (!reflection) return learnings;

  const parsed = ReflectionOutputSchema.safeParse(reflection);
  if (parsed.success) {
    const r = parsed.data;
    const reflectionActions = [...r.lessons];
    if (r.strategyAdjustment) {
      reflectionActions.push(r.strategyAdjustment);
    }
    return {
      whatWorked: learnings.whatWorked,
      whatDidntWork: learnings.whatDidntWork,
      keyInsight: `${learnings.keyInsight}【Reflection (スコア ${String(r.overallScore)})】${r.outcomeAnalysis}`,
      actionItems: [...learnings.actionItems, ...reflectionActions],
    };
  }

  const fallbackSummary = extractReflectionFallbackSummary(reflection);
  if (fallbackSummary) {
    return {
      ...learnings,
      keyInsight: `${learnings.keyInsight}【Reflection (簡易)】${fallbackSummary}`,
    };
  }

  return learnings;
}

/**
 * reflection が簡易フォールバック構造 ({ fallback: true, summary: string }) の場合に
 * summary を取り出す。それ以外は null。Prisma.JsonValue を型安全に narrow する。
 *
 * PR #273 Copilot review #1: `fallback === true` を必須条件にして、たまたま summary を
 * 含む別構造を誤ってフォールバック扱いしないようにする。
 */
function extractReflectionFallbackSummary(reflection: Prisma.JsonValue): string | null {
  if (
    typeof reflection === 'object' &&
    reflection !== null &&
    !Array.isArray(reflection) &&
    'fallback' in reflection &&
    reflection.fallback === true &&
    'summary' in reflection &&
    typeof reflection.summary === 'string'
  ) {
    return reflection.summary;
  }
  return null;
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
  _analysis: SummaryAnalysis
): SummarySummary {
  // 総合評価
  const overallAssessment =
    statistics.winRate >= 60 && statistics.profitFactor >= 1.5
      ? '優秀なパフォーマンス。現在の戦略を継続。'
      : statistics.winRate >= 50 && statistics.profitFactor >= 1.0
        ? '安定したパフォーマンス。微調整で改善可能。'
        : '改善が必要。戦略の見直しを検討。';

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
  const focusForNext =
    statistics.winRate < 50
      ? 'エントリー精度の向上'
      : statistics.profitFactor < 1.5
        ? 'リスクリワード比の改善'
        : '現在の戦略の維持・微調整';

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
