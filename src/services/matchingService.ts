import { TradeNote, MarketData, MatchResult } from '../models/types';
import { MarketDataService } from './marketDataService';
import { TradeNoteService } from './tradeNoteService';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';

/**
 * Service for matching historical trade notes with current market conditions
 * Uses rule-based matching with feature vector comparison
 */
export class MatchingService {
  private marketDataService: MarketDataService;
  private noteService: TradeNoteService;
  private threshold: number;

  constructor() {
    this.marketDataService = new MarketDataService();
    this.noteService = new TradeNoteService();
    this.threshold = config.matching.threshold;
  }

  /**
   * Check all notes for matches with current market conditions
   */
  async checkForMatches(): Promise<MatchResult[]> {
    const notes = await this.noteService.loadAllNotes();
    const matches: MatchResult[] = [];

    // Group notes by symbol
    const notesBySymbol = this.groupNotesBySymbol(notes);

    for (const [symbol, symbolNotes] of notesBySymbol.entries()) {
      try {
        // Get current market data for this symbol
        const currentMarket = await this.marketDataService.getCurrentMarketData(symbol);
        
        // Check each note for matches
        for (const note of symbolNotes) {
          const matchScore = this.calculateMatchScore(note, currentMarket);
          const isMatch = matchScore >= this.threshold;

          if (isMatch) {
            matches.push({
              noteId: note.id,
              symbol,
              matchScore,
              threshold: this.threshold,
              isMatch,
              currentMarket,
              historicalNote: note,
              timestamp: new Date(),
            });
          }
        }
      } catch (error) {
        console.error(`Error checking matches for ${symbol}:`, error);
      }
    }

    return matches;
  }

  /**
   * Calculate match score between a note and current market
   * Returns a score between 0 and 1
   */
  calculateMatchScore(note: TradeNote, currentMarket: MarketData): number {
    // Extract current market features
    const currentFeatures = this.extractMarketFeatures(currentMarket);
    
    // Compare feature vectors using cosine similarity
    const similarity = this.cosineSimilarity(note.features, currentFeatures);
    
    // Additional rule-based checks
    const trendMatch = this.checkTrendMatch(note, currentMarket);
    const priceRangeMatch = this.checkPriceRange(note, currentMarket);
    
    // Weighted combination of scores
    const finalScore = (
      similarity * 0.6 +
      (trendMatch ? 0.3 : 0) +
      (priceRangeMatch ? 0.1 : 0)
    );

    return Math.min(finalScore, 1);
  }

  /**
   * Extract features from current market data
   */
  private extractMarketFeatures(market: MarketData): number[] {
    const features: number[] = [];

    // Price-related features
    features.push(market.close);
    features.push(market.volume);

    // Indicators
    features.push(market.indicators?.rsi || 50);
    features.push(market.indicators?.macd || 0);
    features.push(market.volume);

    // Trend encoding
    const trendValue = 
      market.indicators?.trend === 'bullish' ? 1 :
      market.indicators?.trend === 'bearish' ? -1 : 0;
    features.push(trendValue);

    // Placeholder for side (neutral for current market)
    features.push(0);

    return features;
  }

  /**
   * Calculate cosine similarity between two feature vectors
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      console.warn('Feature vector length mismatch');
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Check if trends match
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
