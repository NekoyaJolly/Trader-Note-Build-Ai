import type { TradeNote, MarketData } from '../models/types';
import { MarketDataService } from './marketDataService';
import { TradeNoteService } from './tradeNoteService';
import { v4 as uuidv4 } from 'uuid';
import type { MatchResultDTO } from '../domain/matching/MatchResultDTO';
import { MatchResultRepository } from '../backend/repositories/matchResultRepository';
import { MarketSnapshotRepository } from '../backend/repositories/marketSnapshotRepository';
import { EvaluationLogRepository } from '../backend/repositories/evaluationLogRepository';
import type {
  MatchHit} from './notification/simultaneousHitControlService';
import {
  SimultaneousHitControlService
} from './notification/simultaneousHitControlService';
import type {
  NormalizedIndicators
} from '../utils/indicatorNormalizer';
import {
  normalizeIndicators,
  DEFAULT_ANOMALY_THRESHOLD
} from '../utils/indicatorNormalizer';
import {
  createNoteEvaluator,
  convertMarketDataToSnapshot,
} from './legacyNoteEvaluatorAdapter';
import type { EvaluationResult } from '../domain/noteEvaluator';
import type { TradeNote as PrismaTradeNote, MatchResult, MarketSnapshot } from '@prisma/client';
import { SideBMatchingAdapter } from './sideBMatchingAdapter';
import type { SideBNoteMatchingData } from '../domain/matching/sideBNoteEvaluator';
import { NotificationTriggerService } from './notification/notificationTriggerService';
import { InAppNotificationSender } from './notification/inAppNotificationSender';
import type { JsonValue } from '../utils/jsonValue';
import { MatchingPipelineRunRepository } from '../backend/repositories/matchingPipelineRunRepository';
import type { MatchingPipelineRunStatus } from '@prisma/client';
import { LensNoteCoreService, type LensShadowSummary } from './lensNoteCoreService';

/**
 * matching pipeline の起動元（observability 用）。
 */
export type PipelineRunTrigger = 'cron' | 'manual_test' | 'scheduler' | 'unknown';

/**
 * runMatchingPipeline() の戻り値（P1: observability）。
 *
 * 既存フィールド（totalMatches / notified / skipped / errors）は後方互換のため維持し、
 * runId（実行単位 ID）・skipReasons（reason code -> 件数）・status を追加する。
 */
export interface MatchingPipelineRunResult {
  /// 実行単位 ID（DB の MatchingPipelineRun.id と一致）
  runId: string;
  totalMatches: number;
  notified: number;
  skipped: number;
  errors: string[];
  /// スキップ理由の集計（reason code -> 件数）
  skipReasons: Record<string, number>;
  status: MatchingPipelineRunStatus;
  /// レンズ類似度シャドー評価のサマリー（Phase α-2、観測のみ・通知挙動に影響しない。
  /// 無効化時・評価失敗時は undefined）
  lensShadow?: LensShadowSummary;
}

/**
 * MatchingService の依存性注入オプション。
 *
 * 通知パイプライン(runMatchingPipeline)のコラボレータをテストから差し替えられるようにする。
 * 本サービスが実際に使うメソッドのみ Pick で要求し、軽量モックが型契約を満たせるようにする
 * (= テストで `as any` を避ける。最優先5原則 §2)。未指定時は既定の実装を使う。
 */
export interface MatchingServiceDeps {
  notificationTriggerService?: Pick<
    NotificationTriggerService,
    'evaluateWithPersistence' | 'invalidateNotificationLog'
  >;
  inAppNotificationSender?: Pick<InAppNotificationSender, 'sendInApp' | 'sendPush'>;
  simultaneousHitControl?: SimultaneousHitControlService;
  matchingPipelineRunRepository?: Pick<
    MatchingPipelineRunRepository,
    'create' | 'findLatest' | 'findMany'
  >;
  lensNoteCoreService?: Pick<LensNoteCoreService, 'shadowEvaluateActiveNotes'>;
}

/**
 * マッチングサービス
 *
 * 責務:
 * - 過去トレードノートと現在の市場状態の一致判定
 * - NoteEvaluator に評価を委譲（Service は similarity を直接計算しない）
 * - MatchResult の DB 永続化
 *
 * 設計方針（Task 6）:
 * - Service は「今の市場」を渡すだけ
 * - 類似度計算、閾値判定は NoteEvaluator の責務
 * - ノートA（UserIndicator）もノートB（Legacy）も同じフローで評価
 */
export class MatchingService {
  private marketDataService: MarketDataService;
  private noteService: TradeNoteService;
  private matchResultRepository: MatchResultRepository;
  private marketSnapshotRepository: MarketSnapshotRepository;
  private evaluationLogRepository: EvaluationLogRepository;
  private simultaneousHitControl: SimultaneousHitControlService;
  private sideBAdapter: SideBMatchingAdapter;
  private notificationTriggerService: Pick<
    NotificationTriggerService,
    'evaluateWithPersistence' | 'invalidateNotificationLog'
  >;
  // 通知許可後に UI 表示用 Notification 行を生成する送信器。
  // 理由: 旧パイプラインは NotificationLog(監査ログ)のみ upsert しており、
  // ユーザーが見る通知フィード(Notification)が永続化されず通知が UI に届かなかった。
  private inAppNotificationSender: Pick<InAppNotificationSender, 'sendInApp' | 'sendPush'>;
  // run 単位 observability の永続化先 (P1)。runMatchingPipeline の各実行を 1 行記録する。
  private matchingPipelineRunRepository: Pick<
    MatchingPipelineRunRepository,
    'create' | 'findLatest' | 'findMany'
  >;
  // レンズ類似度シャドー評価 (Phase α-2、移行戦略 §9-2)。観測のみで通知に影響しない。
  private lensNoteCoreService: Pick<LensNoteCoreService, 'shadowEvaluateActiveNotes'>;

  constructor(deps: MatchingServiceDeps = {}) {
    this.marketDataService = new MarketDataService();
    this.noteService = new TradeNoteService();
    this.matchResultRepository = new MatchResultRepository();
    this.marketSnapshotRepository = new MarketSnapshotRepository();
    this.evaluationLogRepository = new EvaluationLogRepository();
    this.simultaneousHitControl = deps.simultaneousHitControl ?? new SimultaneousHitControlService();
    this.sideBAdapter = new SideBMatchingAdapter();
    this.notificationTriggerService = deps.notificationTriggerService ?? new NotificationTriggerService();
    this.inAppNotificationSender = deps.inAppNotificationSender ?? new InAppNotificationSender();
    this.matchingPipelineRunRepository =
      deps.matchingPipelineRunRepository ?? new MatchingPipelineRunRepository();
    this.lensNoteCoreService = deps.lensNoteCoreService ?? new LensNoteCoreService();
  }

  /**
   * 有効ノートに対して現在の市場状態との一致をチェック
   * マッチした結果は DB に永続化される
   * 
   * 重要: 有効化済み（active）のノートのみがマッチング対象
   * draft や archived のノートは照合しない
   * 
   * 設計（Task 6）:
   * - 各ノートから NoteEvaluator を生成
   * - NoteEvaluator.evaluate() に市場スナップショットを渡す
   * - Service は類似度を直接計算しない
   * 
   * フェーズ8: loadActiveNotesForMatchingAsPrisma を使用し、enabled/pausedUntil をフィルタ
   * DB統一: Prisma型を直接使用（FS型への変換をスキップ）
   */
  async checkForMatches(): Promise<MatchResultDTO[]> {
    // 有効なノートのみを取得（Prisma型で直接取得）
    const notes = await this.noteService.loadActiveNotesForMatchingAsPrisma();
    const matches: MatchResultDTO[] = [];

    // マッチング対象がない場合は早期リターン
    if (notes.length === 0) {
      console.log('[MatchingService] 承認済みノートがありません。マッチングをスキップします。');
      return matches;
    }

    // ノートをシンボル別にグループ化
    const notesBySymbol = this.groupNotesBySymbolPrisma(notes);

    for (const [symbol, symbolNotes] of notesBySymbol.entries()) {
      try {
        // 現在の市場データを取得（インジケーター計算付き）
        const currentMarket = await this.marketDataService.getCurrentMarketDataWithIndicators(symbol);

        // MarketData → MarketSnapshot に変換（NoteEvaluator用）
        const snapshot = convertMarketDataToSnapshot(currentMarket);

        // MarketSnapshot を DB に保存
        let marketSnapshotId: string | undefined;
        try {
          const savedSnapshot = await this.marketSnapshotRepository.upsertSnapshot({
            symbol: currentMarket.symbol,
            timeframe: currentMarket.timeframe,
            close: currentMarket.close,
            volume: currentMarket.volume,
            indicators: currentMarket.indicators || {},
            fetchedAt: currentMarket.timestamp,
          });
          marketSnapshotId = savedSnapshot.id;
        } catch (snapshotError) {
          console.warn('MarketSnapshot 保存をスキップ:', snapshotError);
        }

        // 各ノートに対して NoteEvaluator で評価
        for (const note of symbolNotes) {
          // ノートから NoteEvaluator を生成（Prisma型を直接使用）
          const evaluator = createNoteEvaluator(note);

          // NoteEvaluator.evaluate() で評価（Service は類似度を直接計算しない）
          const evalResult = evaluator.evaluate(snapshot);

          // ★ EvaluationLog を記録（triggered=false も含む、勝率計算の分母となる）
          // marketSnapshotId が取得できている場合のみ記録
          if (marketSnapshotId) {
            try {
              await this.evaluationLogRepository.upsertLog({
                noteId: note.id,
                marketSnapshotId,
                symbol,
                timeframe: currentMarket.timeframe,
                evaluationResult: evalResult,
              });
            } catch (logError) {
              // EvaluationLog 記録の失敗はマッチング処理をブロックしない
              console.warn('[MatchingService] EvaluationLog 記録をスキップ:', logError);
            }
          }

          // 追加のルールベースチェック（トレンド・価格帯）
          const trendMatched = this.checkTrendMatchPrisma(note, currentMarket);
          const priceRangeMatched = this.checkPriceRangePrisma(note, currentMarket);

          // 補正スコア（評価結果のsimilarityをベースに補正）
          const adjustedScore = this.applyRuleAdjustment(evalResult.similarity, trendMatched, priceRangeMatched);

          // 理由を生成
          const reasons = this.generateMatchReasonsFromEvaluation(
            evalResult,
            currentMarket,
            trendMatched,
            priceRangeMatched
          );

          // NoteEvaluator の閾値で発火判定
          const isMatch = evaluator.isTriggered(adjustedScore);

          // 無界インジケーターの異常値チェック（マッチした場合のみ警告を生成）
          let warnings: string[] = [];
          if (isMatch) {
            warnings = this.checkIndicatorAnomaliesPrisma(note, currentMarket);
          }

          if (isMatch) {
            const matchId = uuidv4();
            const evaluatedAt = new Date();
            const threshold = evaluator.getThresholds().weak; // 発火に使用した閾値

            // MatchResult を DB に永続化（marketSnapshotId がある場合のみ）
            if (marketSnapshotId) {
              try {
                await this.matchResultRepository.upsertByNoteAndSnapshot({
                  noteId: note.id,
                  marketSnapshotId,
                  symbol,
                  score: adjustedScore,
                  threshold,
                  trendMatched,
                  priceRangeMatched,
                  reasons,
                  evaluatedAt,
                });
              } catch (persistError) {
                console.warn('MatchResult 永続化をスキップ:', persistError);
              }
            }

            matches.push({
              id: matchId,
              matchScore: adjustedScore,
              historicalNoteId: note.id,
              marketSnapshot: currentMarket,
              marketSnapshotId,
              symbol,
              threshold,
              trendMatched,
              priceRangeMatched,
              reasons,
              warnings,
              evaluatedAt,
            });
          }
        }
      } catch (error) {
        console.error(`${symbol} のマッチチェックエラー:`, error);
      }
    }

    return matches;
  }

  /**
   * 同時ヒット制御付きでマッチをチェック（フェーズ8）
   * 
   * 1. checkForMatches() で全マッチを取得
   * 2. 同時ヒット制御を適用
   * 3. 通知対象とスキップ対象を分離
   * 
   * @returns 通知対象のマッチ結果（優先度順）
   */
  async checkForMatchesWithControl(): Promise<{
    toNotify: MatchResultDTO[];
    skipped: MatchResultDTO[];
    groupedMessage: Map<string, string>;
  }> {
    // 1. 全マッチを取得
    const allMatches = await this.checkForMatches();

    if (allMatches.length === 0) {
      return {
        toNotify: [],
        skipped: [],
        groupedMessage: new Map(),
      };
    }

    // 2. MatchResultDTO → MatchHit に変換
    const hits: MatchHit[] = await Promise.all(
      allMatches.map(async (match) => {
        // ノートの優先度を取得（デフォルト: 5）
        const priority = await this.getNotePriority(match.historicalNoteId);
        return {
          noteId: match.historicalNoteId,
          symbol: match.symbol || '', // undefined の場合は空文字
          similarity: match.matchScore,
          marketSnapshotId: match.marketSnapshotId || '',
          priority,
          matchedAt: match.evaluatedAt,
        };
      })
    );

    // 3. 同時ヒット制御を適用
    const controlResult = await this.simultaneousHitControl.control(hits);

    // 4. 通知対象の noteId セット
    const toNotifyNoteIds = new Set(controlResult.toNotify.map(h => h.noteId));

    // 5. 通知対象とスキップ対象に分離
    const toNotify = allMatches.filter(m => toNotifyNoteIds.has(m.historicalNoteId));
    const skipped = allMatches.filter(m => !toNotifyNoteIds.has(m.historicalNoteId));

    // 6. スキップログを記録
    if (controlResult.toSkip.length > 0) {
      await this.simultaneousHitControl.logSkippedHits(
        controlResult.toSkip,
        allMatches.length,
        'max_simultaneous_exceeded'
      );
    }

    // 7. シンボルごとのまとめメッセージを生成
    const groupedMessage = new Map<string, string>();
    for (const [symbol, symbolHits] of controlResult.groupedBySymbol) {
      const message = await this.simultaneousHitControl.generateGroupedMessage(symbolHits);
      groupedMessage.set(symbol, message);
    }

    return {
      toNotify,
      skipped,
      groupedMessage,
    };
  }

  /**
   * ノートの優先度を取得
   * @private
   */
  private async getNotePriority(noteId: string): Promise<number> {
    try {
      const note = await this.noteService.getNoteById(noteId);
      // TradeNote 型に priority がない場合はデフォルト値を返す
      return (note as { priority?: number })?.priority ?? 5;
    } catch {
      return 5; // デフォルト優先度
    }
  }

  /**
   * ルールベースの補正を適用
   * 
   * 類似度スコアにトレンド一致・価格帯一致の補正を加える
   * 
   * @param baseSimilarity NoteEvaluator から得た類似度
   * @param trendMatched トレンド一致フラグ
   * @param priceRangeMatched 価格帯一致フラグ
   * @returns 補正後スコア（0〜1）
   */
  private applyRuleAdjustment(
    baseSimilarity: number,
    trendMatched: boolean,
    priceRangeMatched: boolean
  ): number {
    // 重み付け: 類似度60% + トレンド30% + 価格帯10%
    const finalScore = (
      baseSimilarity * 0.6 +
      (trendMatched ? 0.3 : 0) +
      (priceRangeMatched ? 0.1 : 0)
    );
    return Math.min(finalScore, 1);
  }

  /**
   * 評価結果からマッチ理由を生成（日本語）
   */
  private generateMatchReasonsFromEvaluation(
    evalResult: EvaluationResult,
    market: MarketData,
    trendMatched: boolean,
    priceRangeMatched: boolean
  ): string[] {
    const reasons: string[] = [];

    // 類似度レベルに応じたメッセージ
    const levelMessages: Record<string, string> = {
      strong: '非常に高い類似度',
      medium: '高い類似度',
      weak: '中程度の類似度',
      none: '低い類似度',
    };
    reasons.push(`${levelMessages[evalResult.level]}: ${(evalResult.similarity * 100).toFixed(1)}%`);

    if (trendMatched) {
      reasons.push(`トレンド一致: ${market.indicators?.trend || 'neutral'}`);
    } else {
      reasons.push(`トレンド不一致: 現在=${market.indicators?.trend || 'neutral'}`);
    }

    if (priceRangeMatched) {
      reasons.push('価格レンジ一致');
    }

    return reasons;
  }

  /**
   * マッチ履歴を DB から取得
   */
  async getMatchHistory(options: {
    symbol?: string;
    limit?: number;
    offset?: number;
    minScore?: number;
  } = {}): Promise<MatchResultDTO[]> {
    try {
      const results = await this.matchResultRepository.findHistory(options);
      return results.map(r => ({
        id: r.id,
        matchScore: r.score,
        historicalNoteId: r.noteId,
        marketSnapshot: (r as MatchResult & { marketSnapshot?: MarketSnapshot }).marketSnapshot || {},
        marketSnapshotId: r.marketSnapshotId,
        symbol: r.symbol,
        threshold: r.threshold,
        trendMatched: r.trendMatched,
        priceRangeMatched: r.priceRangeMatched,
        reasons: Array.isArray(r.reasons) ? r.reasons as string[] : [],
        evaluatedAt: r.evaluatedAt,
        createdAt: r.createdAt,
      }));
    } catch (error) {
      console.error('マッチ履歴取得エラー:', error);
      return [];
    }
  }

  /**
   * トレンド一致をチェック
   */
  private checkTrendMatch(note: TradeNote, market: MarketData): boolean {
    const noteTrend = note.marketContext.trend;
    const currentTrend = market.indicators?.trend;

    return noteTrend === currentTrend;
  }

  /**
   * 価格が過去ノートの価格帯内かチェック（5%以内）
   */
  private checkPriceRange(note: TradeNote, market: MarketData): boolean {
    const priceDeviation = Math.abs(market.close - note.entryPrice) / note.entryPrice;
    return priceDeviation < 0.05;
  }

  /**
   * ノートをシンボル別にグループ化
   */
  private groupNotesBySymbol(notes: TradeNote[]): Map<string, TradeNote[]> {
    const grouped = new Map<string, TradeNote[]>();

    for (const note of notes) {
      const existing = grouped.get(note.symbol) || [];
      existing.push(note);
      grouped.set(note.symbol, existing);
    }

    return grouped;
  }

  /**
   * 無界インジケーターの異常値をチェック
   * 
   * ノートの過去インジケーター値を基準に、現在の市場データが
   * ±3σ以上乖離している場合に警告を生成する
   */
  private checkIndicatorAnomalies(note: TradeNote, market: MarketData): string[] {
    // 現在の市場インジケーター値を抽出
    const currentIndicators: Record<string, number | undefined> = {};
    if (market.indicators) {
      for (const [key, value] of Object.entries(market.indicators)) {
        if (typeof value === 'number') {
          currentIndicators[key] = value;
        }
      }
    }

    // ノートの過去インジケーター値を取得
    const historicalIndicators: Record<string, number | undefined>[] = [];

    if (note.marketContext && typeof note.marketContext === 'object') {
      const noteIndicators: Record<string, number | undefined> = {};
      for (const [key, value] of Object.entries(note.marketContext)) {
        if (typeof value === 'number') {
          noteIndicators[key] = value;
        }
      }
      if (Object.keys(noteIndicators).length > 0) {
        historicalIndicators.push(noteIndicators);
      }
    }

    if (historicalIndicators.length === 0) {
      return [];
    }

    const result: NormalizedIndicators = normalizeIndicators(
      currentIndicators,
      historicalIndicators,
      DEFAULT_ANOMALY_THRESHOLD
    );

    return result.warnings;
  }

  // ============================================================================
  // Prisma型用ヘルパーメソッド (DB統一対応)
  // ============================================================================

  /**
   * Prisma型ノートをシンボル別にグループ化
   */
  private groupNotesBySymbolPrisma(notes: PrismaTradeNote[]): Map<string, PrismaTradeNote[]> {
    const grouped = new Map<string, PrismaTradeNote[]>();

    for (const note of notes) {
      const existing = grouped.get(note.symbol) || [];
      existing.push(note);
      grouped.set(note.symbol, existing);
    }

    return grouped;
  }

  /**
   * Prisma型ノートでトレンド一致をチェック
   */
  private checkTrendMatchPrisma(note: PrismaTradeNote, market: MarketData): boolean {
    // Prisma の marketContext は JsonValue 型なので型安全に取得
    const marketContext = note.marketContext as Record<string, JsonValue | undefined> | null;
    const noteTrend = marketContext?.trend as string | undefined;
    const currentTrend = market.indicators?.trend;

    return noteTrend === currentTrend;
  }

  /**
   * Prisma型ノートで価格が過去ノートの価格帯内かチェック（5%以内）
   */
  private checkPriceRangePrisma(note: PrismaTradeNote, market: MarketData): boolean {
    const entryPrice = Number(note.entryPrice);
    const priceDeviation = Math.abs(market.close - entryPrice) / entryPrice;
    return priceDeviation < 0.05;
  }

  /**
   * Prisma型ノートで無界インジケーターの異常値をチェック
   */
  private checkIndicatorAnomaliesPrisma(note: PrismaTradeNote, market: MarketData): string[] {
    // 現在の市場インジケーター値を抽出
    const currentIndicators: Record<string, number | undefined> = {};
    if (market.indicators) {
      for (const [key, value] of Object.entries(market.indicators)) {
        if (typeof value === 'number') {
          currentIndicators[key] = value;
        }
      }
    }

    // Prisma型の marketContext からインジケーター値を取得
    const historicalIndicators: Record<string, number | undefined>[] = [];
    const marketContext = note.marketContext as Record<string, JsonValue | undefined> | null;

    if (marketContext && typeof marketContext === 'object') {
      const noteIndicators: Record<string, number | undefined> = {};
      for (const [key, value] of Object.entries(marketContext)) {
        if (typeof value === 'number') {
          noteIndicators[key] = value;
        }
      }
      if (Object.keys(noteIndicators).length > 0) {
        historicalIndicators.push(noteIndicators);
      }
    }

    if (historicalIndicators.length === 0) {
      return [];
    }

    const result: NormalizedIndicators = normalizeIndicators(
      currentIndicators,
      historicalIndicators,
      DEFAULT_ANOMALY_THRESHOLD
    );

    return result.warnings;
  }

  // ============================================================================
  // Side-B マッチング統合
  // ============================================================================

  /**
   * Side-B 勝ちパターンノートのマッチングチェック
   *
   * AITradeNote (outcome='win') を SideBNoteEvaluator で現在の市場と照合し、
   * 類似度が閾値を超えた場合に MatchResultDTO を返す。
   *
   * Side-A の checkForMatches() と同じ MatchResultDTO 形式で返すため、
   * 通知パイプラインに統一的に流せる。
   */
  async checkForSideBMatches(): Promise<MatchResultDTO[]> {
    const matches: MatchResultDTO[] = [];

    try {
      // 1. 勝ちパターンの Evaluator をロード
      const evaluatorsBySymbol = await this.sideBAdapter.loadWinningNoteEvaluators(['win']);

      if (evaluatorsBySymbol.size === 0) {
        console.log('[MatchingService] Side-B 勝ちパターンがありません。スキップ。');
        return matches;
      }

      // 2. シンボルごとに市場データを取得して評価
      for (const [symbol, evaluatorEntries] of evaluatorsBySymbol.entries()) {
        try {
          const currentMarket = await this.marketDataService.getCurrentMarketDataWithIndicators(symbol);
          const snapshot = convertMarketDataToSnapshot(currentMarket);

          // MarketSnapshot を DB に保存
          let marketSnapshotId: string | undefined;
          try {
            const savedSnapshot = await this.marketSnapshotRepository.upsertSnapshot({
              symbol: currentMarket.symbol,
              timeframe: currentMarket.timeframe,
              close: currentMarket.close,
              volume: currentMarket.volume,
              indicators: currentMarket.indicators || {},
              fetchedAt: currentMarket.timestamp,
            });
            marketSnapshotId = savedSnapshot.id;
          } catch (snapshotError) {
            console.warn('[MatchingService] Side-B MarketSnapshot 保存スキップ:', snapshotError);
          }

          // 3. 各 Evaluator で評価
          for (const { evaluator, data } of evaluatorEntries) {
            const evalResult = evaluator.evaluate(snapshot);

            // EvaluationLog を記録
            if (marketSnapshotId) {
              try {
                await this.evaluationLogRepository.upsertLog({
                  noteId: `sideb:${evaluator.noteId}`,
                  marketSnapshotId,
                  symbol,
                  timeframe: currentMarket.timeframe,
                  evaluationResult: evalResult,
                });
              } catch (logError) {
                console.warn('[MatchingService] Side-B EvaluationLog 記録スキップ:', logError);
              }
            }

            // Side-B 用の補正: 方向一致ボーナス
            const directionBonus = this.checkDirectionAlignment(data, currentMarket) ? 0.1 : 0;
            const adjustedScore = Math.min(evalResult.similarity + directionBonus, 1.0);

            const isMatch = evaluator.isTriggered(adjustedScore);

            if (isMatch) {
              const matchId = uuidv4();
              const evaluatedAt = new Date();
              const threshold = evaluator.getThresholds().weak;

              // MatchResult を DB に永続化
              if (marketSnapshotId) {
                try {
                  await this.matchResultRepository.upsertByNoteAndSnapshot({
                    noteId: `sideb:${evaluator.noteId}`,
                    marketSnapshotId,
                    symbol,
                    score: adjustedScore,
                    threshold,
                    trendMatched: true,  // Side-B は条件ベクトルに含む
                    priceRangeMatched: false,
                    reasons: this.generateSideBMatchReasons(evalResult, data, adjustedScore),
                    evaluatedAt,
                  });
                } catch (persistError) {
                  console.warn('[MatchingService] Side-B MatchResult 永続化スキップ:', persistError);
                }
              }

              matches.push({
                id: matchId,
                matchScore: adjustedScore,
                historicalNoteId: `sideb:${evaluator.noteId}`,
                marketSnapshot: currentMarket,
                marketSnapshotId,
                symbol,
                threshold,
                trendMatched: true,
                priceRangeMatched: false,
                reasons: this.generateSideBMatchReasons(evalResult, data, adjustedScore),
                warnings: [],
                evaluatedAt,
              });
            }
          }
        } catch (error) {
          console.error(`[MatchingService] Side-B ${symbol} マッチチェックエラー:`, error);
        }
      }
    } catch (error) {
      console.error('[MatchingService] Side-B マッチング全体エラー:', error);
    }

    return matches;
  }

  /**
   * Side-A + Side-B 統合マッチングチェック
   *
   * 両方のノートソースからマッチを収集し、統一された MatchResultDTO[] を返す。
   * 通知パイプラインは checkForMatchesWithControl() から統一的に呼ばれる。
   */
  async checkForAllMatches(): Promise<MatchResultDTO[]> {
    // Side-A と Side-B を並行実行
    const [sideAMatches, sideBMatches] = await Promise.all([
      this.checkForMatches(),
      this.checkForSideBMatches(),
    ]);

    console.log(
      `[MatchingService] 統合マッチ結果: Side-A=${sideAMatches.length}, Side-B=${sideBMatches.length}`
    );

    return [...sideAMatches, ...sideBMatches];
  }

  /**
   * 統合マッチング + 同時ヒット制御 + 通知パイプライン
   *
   * Side-A & Side-B の全マッチを収集 → 同時ヒット制御 → 通知判定 → 送信
   */
  async runMatchingPipeline(
    options: { trigger?: PipelineRunTrigger } = {},
  ): Promise<MatchingPipelineRunResult> {
    const runId = uuidv4();
    const trigger = options.trigger ?? 'unknown';
    const startedAt = new Date();
    const errors: string[] = [];
    // スキップ理由の reason code -> 件数 集計 (P1 observability)
    const skipReasons: Record<string, number> = {};
    const bumpSkipReason = (code: string): void => {
      skipReasons[code] = (skipReasons[code] ?? 0) + 1;
    };
    let notifiedCount = 0;
    let skippedCount = 0;
    let totalMatches = 0;
    // レンズ類似度シャドー評価の結果 (Phase α-2)。失敗時・無効時は undefined のまま
    let lensShadow: LensShadowSummary | undefined;

    try {
      // 1. 統合マッチング（Side-A + Side-B）
      const allMatches = await this.checkForAllMatches();
      totalMatches = allMatches.length;

      // 1.5 レンズ類似度シャドー評価 (Phase α-2、NOTE_SIMILARITY_FOUNDATION.md §9-2)
      // 旧マッチングと並行してレンズ基盤のスコアを観測する。通知挙動には一切影響せず、
      // 失敗してもパイプラインは継続する。LENS_SHADOW_EVALUATION=false で無効化できる。
      if (process.env.LENS_SHADOW_EVALUATION !== 'false') {
        try {
          lensShadow = await this.lensNoteCoreService.shadowEvaluateActiveNotes();
          console.log(
            `[LensShadow] active=${lensShadow.activeNotes} withSnapshot=${lensShadow.notesWithSnapshot} ` +
            `comparable=${lensShadow.comparable} triggered=${lensShadow.triggered} ` +
            `avg=${lensShadow.averageScore === null ? 'n/a' : lensShadow.averageScore.toFixed(3)} ` +
            `errors=${lensShadow.errors.length}`
          );
        } catch (shadowError) {
          console.warn('[LensShadow] シャドー評価失敗 (パイプライン継続):', shadowError);
        }
      }

      if (allMatches.length === 0) {
        console.log('[MatchingPipeline] マッチなし。パイプライン終了。');
        const emptyResult = await this.finalizePipelineRun({
          runId, trigger, startedAt,
          totalMatches: 0, notified: 0, skipped: 0, errors: [], skipReasons: {},
        });
        return lensShadow ? { ...emptyResult, lensShadow } : emptyResult;
      }

      // Side-A / Side-B の切り分け:
      // MatchResult / NotificationLog / Notification は noteId が TradeNote(UUID) への FK で
      // **Side-A 専用**。Side-B のマッチ ID は `sideb:<uuid>` という非 UUID 文字列のため、
      // この通知経路に通すと UUID パースエラーになり Notification も作成できない。
      // よって Side-B はここでは通知対象外として明示的に切り分ける (= UUID エラーで毎回
      // notify_error になる不具合の解消)。Side-B 専用の通知経路は別途設計する (本修正の範囲外)。
      const sideAMatches = allMatches.filter((m) => !m.historicalNoteId.startsWith('sideb:'));
      const sideBExcluded = allMatches.length - sideAMatches.length;
      if (sideBExcluded > 0) {
        skippedCount += sideBExcluded;
        skipReasons['side_b_excluded'] = (skipReasons['side_b_excluded'] ?? 0) + sideBExcluded;
        console.log(
          `[MatchingPipeline] Side-B マッチ ${sideBExcluded} 件は Side-A 通知経路の対象外として除外 (切り分け)`
        );
      }

      // 2. 同時ヒット制御 (Side-A のみ)
      const hits: MatchHit[] = await Promise.all(
        sideAMatches.map(async (match) => {
          const priority = await this.getNotePriority(match.historicalNoteId);
          return {
            noteId: match.historicalNoteId,
            symbol: match.symbol || '',
            similarity: match.matchScore,
            marketSnapshotId: match.marketSnapshotId || '',
            priority,
            matchedAt: match.evaluatedAt,
          };
        })
      );

      const controlResult = await this.simultaneousHitControl.control(hits);
      const toNotifyNoteIds = new Set(controlResult.toNotify.map(h => h.noteId));

      // 3. 通知判定 & 送信 (Side-A のみ)
      for (const match of sideAMatches) {
        if (!toNotifyNoteIds.has(match.historicalNoteId)) {
          skippedCount++;
          bumpSkipReason('simultaneous_hit');
          continue;
        }

        try {
          const triggerResult = await this.notificationTriggerService.evaluateWithPersistence({
            matchScore: match.matchScore,
            historicalNoteId: match.historicalNoteId,
            marketSnapshot: match.marketSnapshot,
            marketSnapshotId: match.marketSnapshotId,
            symbol: match.symbol,
            channel: 'in_app',
          });

          if (triggerResult.shouldNotify) {
            // marketSnapshotId が無いと sendInApp は MatchResult を引けず、空文字での
            // 無駄な DB クエリ + catch ログのノイズになる。さらに MatchResult 永続化は
            // marketSnapshotId がある場合のみ行われる (= snapshotId 無し = 紐づく
            // MatchResult も無い) ため、明示的に skip して理由を残す。
            if (!match.marketSnapshotId) {
              skippedCount++;
              bumpSkipReason('missing_market_snapshot_id');
              const warnMsg = `通知スキップ(marketSnapshotId 欠落で Notification 作成不可): noteId=${match.historicalNoteId}, symbol=${match.symbol}`;
              errors.push(warnMsg);
              console.warn(`[MatchingPipeline] ${warnMsg}`);
              continue;
            }

            // 通知が許可されたら UI 表示用 Notification 行を実際に作成する。
            // sendInApp は (noteId, marketSnapshotId) で永続化済み MatchResult を引き、
            // それに紐づく Notification を upsert する。MatchResult が無い等で
            // 失敗しても例外にせず success:false を返すため、パイプラインは継続する。
            const sendResult = await this.inAppNotificationSender.sendInApp({
              noteId: match.historicalNoteId,
              marketSnapshotId: match.marketSnapshotId,
              symbol: match.symbol || '',
              score: match.matchScore,
              title: `一致検出: ${match.symbol || 'シンボル不明'}`,
              message: match.reasons?.[0] || 'ノートと現在の市場が一致しました',
              reasonSummary: triggerResult.reasonSummary || `スコア: ${match.matchScore.toFixed(3)}`,
            });

            if (sendResult.success) {
              notifiedCount++;
              console.log(
                `[MatchingPipeline] 通知送信: noteId=${match.historicalNoteId}, ` +
                `symbol=${match.symbol}, score=${match.matchScore.toFixed(3)}, notificationId=${sendResult.id}`
              );
              // In-App Notification 行を作成できたら Web-Push でも配信する。
              // VAPID 未設定 / 購読 0 の場合は WebPushService が空結果を返すため
              // pipeline は安全に継続する。Push 失敗はパイプライン失敗にしない。
              void this.inAppNotificationSender
                .sendPush({
                  noteId: match.historicalNoteId,
                  marketSnapshotId: match.marketSnapshotId,
                  symbol: match.symbol || '',
                  score: match.matchScore,
                  title: `一致検出: ${match.symbol || 'シンボル不明'}`,
                  message: match.reasons?.[0] || 'ノートと現在の市場が一致しました',
                  reasonSummary: triggerResult.reasonSummary || `スコア: ${match.matchScore.toFixed(3)}`,
                })
                .catch((pushError) => {
                  console.warn(
                    `[MatchingPipeline] Push 配信失敗 (継続): noteId=${match.historicalNoteId}, ` +
                    `${pushError instanceof Error ? pushError.message : String(pushError)}`
                  );
                });
            } else {
              // 通知判定は許可されたが Notification 行を作れなかった場合 (MatchResult 不在 等)。
              // evaluateWithPersistence が先に status='sent' ログを書いており、isDuplicate は
              // status 不問で重複判定するため、このままだと次回以降のパイプラインが永久に
              // スキップして Notification が作られないままになる。先行ログを無効化(削除)して
              // 次回パイプラインで再評価・再配信できるようにする。
              if (triggerResult.notificationLogId) {
                await this.notificationTriggerService.invalidateNotificationLog(
                  triggerResult.notificationLogId,
                );
              }
              skippedCount++;
              bumpSkipReason('send_failed');
              const warnMsg = `通知送信失敗(Notification未作成・再試行可能化): noteId=${match.historicalNoteId}, symbol=${match.symbol}`;
              errors.push(warnMsg);
              console.warn(`[MatchingPipeline] ${warnMsg}`);
            }
          } else {
            skippedCount++;
            // trigger 側の reason code を集計に反映 (なければ other)
            bumpSkipReason(triggerResult.skipReasonCode ?? 'other');
            console.log(
              `[MatchingPipeline] 通知スキップ: noteId=${match.historicalNoteId}, ` +
              `reason=${triggerResult.skipReason}`
            );
          }
        } catch (notifyError) {
          bumpSkipReason('notify_error');
          const errMsg = `通知エラー: noteId=${match.historicalNoteId}, ${notifyError instanceof Error ? notifyError.message : String(notifyError)}`;
          errors.push(errMsg);
          console.error(`[MatchingPipeline] ${errMsg}`);
        }
      }

      // 4. スキップログ
      if (controlResult.toSkip.length > 0) {
        await this.simultaneousHitControl.logSkippedHits(
          controlResult.toSkip,
          sideAMatches.length,
          'max_simultaneous_exceeded'
        );
      }

      const result = await this.finalizePipelineRun({
        runId, trigger, startedAt,
        totalMatches,
        notified: notifiedCount,
        skipped: skippedCount,
        errors,
        skipReasons,
      });
      return lensShadow ? { ...result, lensShadow } : result;
    } catch (error) {
      const errMsg = `パイプライン全体エラー: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errMsg);
      console.error(`[MatchingPipeline] ${errMsg}`);
      const failedResult = await this.finalizePipelineRun({
        runId, trigger, startedAt,
        totalMatches,
        notified: notifiedCount,
        skipped: skippedCount,
        errors,
        skipReasons,
        forcedStatus: 'failed',
      });
      return lensShadow ? { ...failedResult, lensShadow } : failedResult;
    }
  }

  /**
   * パイプライン run の終了処理: status / durationMs を確定し、MatchingPipelineRun を
   * 1 行永続化してから結果を返す（P1 observability）。
   *
   * 永続化失敗はパイプライン本体の成否に影響させない（runId は in-memory で確定済みのため
   * API レスポンスには返せる）。status は強制指定がなければエラー有無で partial_failure /
   * success を決める。
   */
  private async finalizePipelineRun(params: {
    runId: string;
    trigger: PipelineRunTrigger;
    startedAt: Date;
    totalMatches: number;
    notified: number;
    skipped: number;
    errors: string[];
    skipReasons: Record<string, number>;
    forcedStatus?: MatchingPipelineRunStatus;
  }): Promise<MatchingPipelineRunResult> {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - params.startedAt.getTime();
    const errorCount = params.errors.length;
    const status: MatchingPipelineRunStatus =
      params.forcedStatus ?? (errorCount > 0 ? 'partial_failure' : 'success');

    try {
      await this.matchingPipelineRunRepository.create({
        id: params.runId,
        trigger: params.trigger,
        status,
        startedAt: params.startedAt,
        finishedAt,
        durationMs,
        totalMatches: params.totalMatches,
        notified: params.notified,
        skipped: params.skipped,
        errorCount,
        errors: params.errors,
        skipReasons: params.skipReasons,
        marketStatus: null,
      });
    } catch (persistError) {
      console.error(
        `[MatchingPipeline] run 永続化失敗 (継続): runId=${params.runId}, ` +
        `${persistError instanceof Error ? persistError.message : String(persistError)}`
      );
    }

    return {
      runId: params.runId,
      totalMatches: params.totalMatches,
      notified: params.notified,
      skipped: params.skipped,
      errors: params.errors,
      skipReasons: params.skipReasons,
      status,
    };
  }

  /**
   * 市場休場などで matching pipeline 本体を実行せずスキップした場合に、
   * status='skipped' の run を 1 行記録する（P1 observability）。runId を返す。
   */
  async recordMarketClosedRun(params: {
    trigger: PipelineRunTrigger;
    marketStatus: string;
  }): Promise<string> {
    const runId = uuidv4();
    const now = new Date();
    try {
      await this.matchingPipelineRunRepository.create({
        id: runId,
        trigger: params.trigger,
        status: 'skipped',
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        totalMatches: 0,
        notified: 0,
        skipped: 0,
        errorCount: 0,
        errors: [],
        skipReasons: {},
        marketStatus: params.marketStatus,
      });
    } catch (persistError) {
      console.error(
        `[MatchingPipeline] 休場 run 永続化失敗 (継続): runId=${runId}, ` +
        `${persistError instanceof Error ? persistError.message : String(persistError)}`
      );
    }
    return runId;
  }

  /**
   * 最新の matching pipeline run を 1 件取得する（診断 API 用）。
   */
  async getLatestPipelineRun() {
    return this.matchingPipelineRunRepository.findLatest();
  }

  /**
   * matching pipeline run を最新順に取得する（診断 API 用）。
   */
  async getPipelineRuns(limit: number) {
    return this.matchingPipelineRunRepository.findMany(limit);
  }

  /**
   * Side-B ノートの方向とマーケットトレンドの一致をチェック
   */
  private checkDirectionAlignment(data: SideBNoteMatchingData, market: MarketData): boolean {
    const trend = market.indicators?.trend as string | undefined;
    if (!trend) return false;

    if (data.direction === 'long' && (trend === 'up' || trend === 'bullish')) return true;
    if (data.direction === 'short' && (trend === 'down' || trend === 'bearish')) return true;
    return false;
  }

  /**
   * Side-B マッチの理由テキストを生成
   */
  private generateSideBMatchReasons(
    evalResult: EvaluationResult,
    data: SideBNoteMatchingData,
    adjustedScore: number
  ): string[] {
    const reasons: string[] = [];
    reasons.push(`[Side-B] 勝ちパターン一致: ${(adjustedScore * 100).toFixed(1)}%`);
    reasons.push(`パターン: ${data.direction} / ${data.marketAnalysis.regime} / ${data.marketAnalysis.volatility}vol`);
    reasons.push(`過去実績: +${data.pnlPips}pips (RR ${data.rrActual})`);
    if (evalResult.level === 'strong') {
      reasons.push('★ 非常に高い類似度');
    }
    return reasons;
  }
}
