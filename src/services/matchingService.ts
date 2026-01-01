import { TradeNote, MarketData } from '../models/types';
import { MarketDataService } from './marketDataService';
import { TradeNoteService } from './tradeNoteService';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import { MatchResultDTO } from '../domain/matching/MatchResultDTO';
import { MatchResultRepository } from '../backend/repositories/matchResultRepository';
import { MarketSnapshotRepository } from '../backend/repositories/marketSnapshotRepository';
import { 
  normalizeIndicators, 
  DEFAULT_ANOMALY_THRESHOLD,
  NormalizedIndicators 
} from '../utils/indicatorNormalizer';
import {
  calculateCosineSimilarity,
  generateFeatureVectorFromIndicators,
  SIMILARITY_THRESHOLDS,
  type IndicatorData,
} from './featureVectorService';

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
          
          // 無界インジケーターの異常値チェック（マッチした場合のみ警告を生成）
          let warnings: string[] = [];
          if (isMatch) {
            warnings = this.checkIndicatorAnomalies(note, currentMarket);
          }

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
   * 現在の市場データから12次元特徴量ベクトルを抽出
   * 
   * 12次元構成:
   * - トレンド系 (0-2): trendDirection, trendStrength, trendAlignment
   * - モメンタム系 (3-4): macdHistogram, macdCrossover
   * - 過熱度系 (5-6): rsiValue, rsiZone
   * - ボラティリティ系 (7-8): bbPosition, bbWidth
   * - ローソク足構造 (9-10): candleBody, candleDirection
   * - 時間軸 (11): sessionFlag
   */
  private extractMarketFeatures(market: MarketData): number[] {
    // MarketData のインジケーターを IndicatorData 形式に変換
    // 注: MarketData.indicators の型は限定的なため、存在するフィールドのみ使用
    const marketIndicators = market.indicators as Record<string, unknown> | undefined;
    
    const indicatorData: IndicatorData = {
      rsi: market.indicators?.rsi,
      rsiZone: this.determineRsiZone(market.indicators?.rsi),
      macdHistogram: market.indicators?.macd,
      macdCrossover: this.determineMacdCrossover(market.indicators),
      smaSlope: this.determineTrendSlope(market.indicators?.trend),
      emaSlope: this.determineTrendSlope(market.indicators?.trend),
      priceVsSma: this.determinePricePosition(market.indicators?.trend),
      priceVsEma: this.determinePricePosition(market.indicators?.trend),
      // BB データは MarketData の基本型には含まれないため、拡張データがあれば使用
      bbPosition: (marketIndicators?.bb as { percentB?: number })?.percentB,
      bbWidth: (marketIndicators?.bb as { width?: number })?.width,
      close: market.close,
    };

    // 12次元ベクトルを生成
    return generateFeatureVectorFromIndicators(indicatorData, new Date(market.timestamp));
  }

  /**
   * RSI ゾーンを判定
   */
  private determineRsiZone(rsi?: number): 'overbought' | 'oversold' | 'neutral' {
    if (rsi === undefined) return 'neutral';
    if (rsi >= 70) return 'overbought';
    if (rsi <= 30) return 'oversold';
    return 'neutral';
  }

  /**
   * MACD クロスオーバーを判定（トレンドから推定）
   */
  private determineMacdCrossover(indicators?: MarketData['indicators']): 'bullish' | 'bearish' | 'none' {
    if (!indicators) return 'none';
    if (indicators.trend === 'bullish') return 'bullish';
    if (indicators.trend === 'bearish') return 'bearish';
    return 'none';
  }

  /**
   * トレンドから傾きを判定
   */
  private determineTrendSlope(trend?: string): 'up' | 'down' | 'flat' {
    if (trend === 'bullish') return 'up';
    if (trend === 'bearish') return 'down';
    return 'flat';
  }

  /**
   * 価格位置を判定
   */
  private determinePricePosition(trend?: string): 'above' | 'below' | 'at' {
    if (trend === 'bullish') return 'above';
    if (trend === 'bearish') return 'below';
    return 'at';
  }

  /**
   * コサイン類似度を計算
   * 
   * 統一された featureVectorService の calculateCosineSimilarity を使用
   * 次元が異なる場合は旧ベクトルを12次元に変換してから計算
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    // 空のベクトルチェック
    if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) {
      console.warn('空の特徴量ベクトル');
      return 0;
    }

    // 次元が異なる場合は長い方に合わせてパディング
    // 注: 本来は両方12次元であるべきだが、後方互換のため対応
    const maxLen = Math.max(vecA.length, vecB.length);
    const a = [...vecA];
    const b = [...vecB];
    
    while (a.length < maxLen) a.push(0);
    while (b.length < maxLen) b.push(0);

    return calculateCosineSimilarity(a, b);
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

  /**
   * 無界インジケーターの異常値をチェック
   * 
   * ノートの過去インジケーター値を基準に、現在の市場データが
   * ±3σ以上乖離している場合に警告を生成する
   * 
   * 対象インジケーター（無界）:
   * - OBV, VWAP, ATR, MACD, CCI, ROC, SMA, EMA, DEMA, TEMA, BB, KC, PSAR, Ichimoku
   * 
   * 非対象（有界、正規化不要）:
   * - RSI, Stochastic, Williams %R, MFI, CMF, Aroon
   */
  private checkIndicatorAnomalies(note: TradeNote, market: MarketData): string[] {
    // 現在の市場インジケーター値を抽出
    const currentIndicators: Record<string, number | undefined> = {};
    if (market.indicators) {
      // インジケーターオブジェクトから数値フィールドを抽出
      for (const [key, value] of Object.entries(market.indicators)) {
        if (typeof value === 'number') {
          currentIndicators[key] = value;
        }
      }
    }

    // ノートの過去インジケーター値を取得（特徴量から推定）
    // 注: 現在の実装ではノートにはインジケーター履歴が保存されていないため、
    //     単一のノートのみで正規化を行う。将来的には複数ノートの履歴を使用可能
    const historicalIndicators: Record<string, number | undefined>[] = [];
    
    // ノートに marketContext.indicators がある場合はそれを使用
    if (note.marketContext && typeof note.marketContext === 'object') {
      const noteIndicators: Record<string, number | undefined> = {};
      // marketContext から数値フィールドを抽出
      for (const [key, value] of Object.entries(note.marketContext)) {
        if (typeof value === 'number') {
          noteIndicators[key] = value;
        }
      }
      if (Object.keys(noteIndicators).length > 0) {
        historicalIndicators.push(noteIndicators);
      }
    }

    // 過去データが不十分な場合は警告なし
    if (historicalIndicators.length === 0) {
      return [];
    }

    // 正規化と異常値検出を実行
    const result: NormalizedIndicators = normalizeIndicators(
      currentIndicators,
      historicalIndicators,
      DEFAULT_ANOMALY_THRESHOLD
    );

    return result.warnings;
  }
}
