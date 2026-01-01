import { TradeNote, MarketData } from '../models/types';
import { MarketDataService } from './marketDataService';
import { TradeNoteService } from './tradeNoteService';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import { MatchResultDTO } from '../domain/matching/MatchResultDTO';
import { MatchResultRepository } from '../backend/repositories/matchResultRepository';
import { MarketSnapshotRepository } from '../backend/repositories/marketSnapshotRepository';
import { EvaluationLogRepository } from '../backend/repositories/evaluationLogRepository';
import { 
  SimultaneousHitControlService,
  MatchHit,
} from './notification/simultaneousHitControlService';
import { 
  normalizeIndicators, 
  DEFAULT_ANOMALY_THRESHOLD,
  NormalizedIndicators 
} from '../utils/indicatorNormalizer';
import {
  createNoteEvaluatorFromFSNote,
  convertMarketDataToSnapshot,
} from './legacyNoteEvaluatorAdapter';
import { NoteEvaluator, EvaluationResult } from '../domain/noteEvaluator';

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

  constructor() {
    this.marketDataService = new MarketDataService();
    this.noteService = new TradeNoteService();
    this.matchResultRepository = new MatchResultRepository();
    this.marketSnapshotRepository = new MarketSnapshotRepository();
    this.evaluationLogRepository = new EvaluationLogRepository();
    this.simultaneousHitControl = new SimultaneousHitControlService();
  }

  /**
   * 承認済みノートに対して現在の市場状態との一致をチェック
   * マッチした結果は DB に永続化される
   * 
   * 重要: 承認済み（approved）のノートのみがマッチング対象
   * draft や rejected のノートは照合しない
   * 
   * 設計（Task 6）:
   * - 各ノートから NoteEvaluator を生成
   * - NoteEvaluator.evaluate() に市場スナップショットを渡す
   * - Service は類似度を直接計算しない
   * 
   * フェーズ8: loadActiveNotesForMatching を使用し、enabled/pausedUntil をフィルタ
   */
  async checkForMatches(): Promise<MatchResultDTO[]> {
    // 有効なノートのみを取得（フェーズ8: enabled=true, pausedUntil 考慮）
    const notes = await this.noteService.loadActiveNotesForMatching();
    const matches: MatchResultDTO[] = [];

    // マッチング対象がない場合は早期リターン
    if (notes.length === 0) {
      console.log('[MatchingService] 承認済みノートがありません。マッチングをスキップします。');
      return matches;
    }

    // ノートをシンボル別にグループ化
    const notesBySymbol = this.groupNotesBySymbol(notes);

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
          // ノートから NoteEvaluator を生成
          const evaluator = createNoteEvaluatorFromFSNote(note);
          
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
          const trendMatched = this.checkTrendMatch(note, currentMarket);
          const priceRangeMatched = this.checkPriceRange(note, currentMarket);
          
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
            warnings = this.checkIndicatorAnomalies(note, currentMarket);
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
        'max_simultaneous'
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
        marketSnapshot: (r as any).marketSnapshot || {},
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
}
