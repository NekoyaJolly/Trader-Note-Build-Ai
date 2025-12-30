import { TradeNote, MarketData } from '../models/types';
import { MarketDataService } from './marketDataService';
import { TradeNoteService } from './tradeNoteService';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import { MatchResultDTO } from '../domain/matching/MatchResultDTO';
import { MatchResultRepository } from '../backend/repositories/matchResultRepository';
import { MarketSnapshotRepository } from '../backend/repositories/marketSnapshotRepository';

/**
 * マッチングサービス
 * 
 * 責務:
 * - 過去トレードノートと現在の市場状態の一致判定
 * - ルールベースの特徴量比較（コサイン類似度）
 * - MatchResult の DB 永続化
 */
export class MatchingService {
  private marketDataService: MarketDataService;
  private noteService: TradeNoteService;
  private matchResultRepository: MatchResultRepository;
  private marketSnapshotRepository: MarketSnapshotRepository;
  private threshold: number;

  constructor() {
    this.marketDataService = new MarketDataService();
    this.noteService = new TradeNoteService();
    this.matchResultRepository = new MatchResultRepository();
    this.marketSnapshotRepository = new MarketSnapshotRepository();
    this.threshold = config.matching.threshold;
  }

  /**
   * 承認済みノートに対して現在の市場状態との一致をチェック
   * マッチした結果は DB に永続化される
   * 
   * 重要: 承認済み（approved）のノートのみがマッチング対象
   * draft や rejected のノートは照合しない
   */
  async checkForMatches(): Promise<MatchResultDTO[]> {
    // 承認済みノートのみを取得（Phase 2 要件）
    const notes = await this.noteService.loadApprovedNotes();
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
        
        // MarketSnapshot を DB に保存
        let marketSnapshotId: string | undefined;
        try {
          const snapshot = await this.marketSnapshotRepository.upsertSnapshot({
            symbol: currentMarket.symbol,
            timeframe: currentMarket.timeframe,
            close: currentMarket.close,
            volume: currentMarket.volume,
            indicators: currentMarket.indicators || {},
            fetchedAt: currentMarket.timestamp,
          });
          marketSnapshotId = snapshot.id;
        } catch (snapshotError) {
          console.warn('MarketSnapshot 保存をスキップ:', snapshotError);
        }
        
        // 各ノートに対してマッチスコアを計算
        for (const note of symbolNotes) {
          const matchScore = this.calculateMatchScore(note, currentMarket);
          const isMatch = matchScore >= this.threshold;
          const trendMatched = this.checkTrendMatch(note, currentMarket);
          const priceRangeMatched = this.checkPriceRange(note, currentMarket);
          const reasons = this.generateMatchReasons(note, currentMarket, matchScore, trendMatched, priceRangeMatched);

          if (isMatch) {
            const matchId = uuidv4();
            const evaluatedAt = new Date();

            // MatchResult を DB に永続化（marketSnapshotId がある場合のみ）
            if (marketSnapshotId) {
              try {
                await this.matchResultRepository.upsertByNoteAndSnapshot({
                  noteId: note.id,
                  marketSnapshotId,
                  symbol,
                  score: matchScore,
                  threshold: this.threshold,
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
              matchScore,
              historicalNoteId: note.id,
              marketSnapshot: currentMarket,
              marketSnapshotId,
              symbol,
              threshold: this.threshold,
              trendMatched,
              priceRangeMatched,
              reasons,
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
   * マッチスコアを計算
   * ノートと現在の市場データ間のスコア（0 - 1）を返す
   */
  calculateMatchScore(note: TradeNote, currentMarket: MarketData): number {
    // 現在の市場から特徴量を抽出
    const currentFeatures = this.extractMarketFeatures(currentMarket);
    
    // コサイン類似度を計算
    const similarity = this.cosineSimilarity(note.features, currentFeatures);
    
    // ルールベースの追加チェック
    const trendMatch = this.checkTrendMatch(note, currentMarket);
    const priceRangeMatch = this.checkPriceRange(note, currentMarket);
    
    // 重み付け組み合わせ
    const finalScore = (
      similarity * 0.6 +
      (trendMatch ? 0.3 : 0) +
      (priceRangeMatch ? 0.1 : 0)
    );

    return Math.min(finalScore, 1);
  }

  /**
   * マッチ理由を生成（日本語）
   */
  private generateMatchReasons(
    note: TradeNote,
    market: MarketData,
    score: number,
    trendMatched: boolean,
    priceRangeMatched: boolean
  ): string[] {
    const reasons: string[] = [];

    reasons.push(`一致スコア: ${(score * 100).toFixed(1)}%`);

    if (trendMatched) {
      reasons.push(`トレンド一致: ${market.indicators?.trend || 'neutral'}`);
    } else {
      reasons.push(`トレンド不一致: ノート=${note.marketContext.trend}, 現在=${market.indicators?.trend || 'neutral'}`);
    }

    if (priceRangeMatched) {
      const deviation = Math.abs(market.close - note.entryPrice) / note.entryPrice * 100;
      reasons.push(`価格レンジ一致: ${deviation.toFixed(2)}% 以内`);
    } else {
      const deviation = Math.abs(market.close - note.entryPrice) / note.entryPrice * 100;
      reasons.push(`価格レンジ外: ${deviation.toFixed(2)}% 乖離`);
    }

    return reasons;
  }

  /**
   * 現在の市場データから特徴量を抽出
   */
  private extractMarketFeatures(market: MarketData): number[] {
    const features: number[] = [];

    // 価格関連の特徴量
    features.push(market.close);
    features.push(market.volume);

    // インジケーター（実際の計算値を使用）
    features.push(market.indicators?.rsi ?? 50);
    features.push(market.indicators?.macd ?? 0);
    features.push(market.volume);

    // トレンドエンコーディング
    const trendValue = 
      market.indicators?.trend === 'bullish' ? 1 :
      market.indicators?.trend === 'bearish' ? -1 : 0;
    features.push(trendValue);

    // サイドのプレースホルダー（現在の市場では中立）
    features.push(0);

    return features;
  }

  /**
   * コサイン類似度を計算
   * 
   * 次元不一致の場合:
   * - 短い方のベクトルを0で埋めて長さを揃える
   * - NaN/undefined/Infinity は 0 として扱う
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    // 空のベクトルチェック
    if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) {
      console.warn('空の特徴量ベクトル');
      return 0;
    }

    // 次元を揃える（短い方を0で埋める）
    const maxLen = Math.max(vecA.length, vecB.length);
    const a = [...vecA];
    const b = [...vecB];
    
    while (a.length < maxLen) a.push(0);
    while (b.length < maxLen) b.push(0);

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < maxLen; i++) {
      // NaN/undefined/Infinity を 0 として扱う
      const valA = isFinite(a[i]) ? a[i] : 0;
      const valB = isFinite(b[i]) ? b[i] : 0;
      
      dotProduct += valA * valB;
      normA += valA * valA;
      normB += valB * valB;
    }

    // 0除算防御
    if (normA === 0 || normB === 0) {
      return 0;
    }

    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    
    // NaN チェック
    if (isNaN(similarity)) {
      return 0;
    }

    return similarity;
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
   * Check if current price is within reasonable range of note price
   */
  private checkPriceRange(note: TradeNote, market: MarketData): boolean {
    const priceDeviation = Math.abs(market.close - note.entryPrice) / note.entryPrice;
    return priceDeviation < 0.05; // Within 5% of historical price
  }

  /**
   * Group notes by symbol
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
}
