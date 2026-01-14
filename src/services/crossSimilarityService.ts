/**
 * 横断類似ノート検索サービス
 * 
 * Side-A（TradeNote）とSide-B（AITradeNote）を横断して類似ノートを検索する
 * 
 * 主要機能:
 * - OHLCV データまたは特徴ベクトルから類似ノート検索
 * - TradeNote と AITradeNote の統合検索
 * - 類似度スコアによる統一ソート
 * - コード重複削減のための共通化
 */

import { PrismaClient } from '@prisma/client';
import { FeatureService } from './featureService';
import { IndicatorService, OHLCVData } from './indicators/indicatorService';
import { calculateCosineSimilarity } from './featureVectorService';
import * as aiNoteRepository from '../side-b/repositories/aiNoteRepository';
import type { AITradeNote } from '../side-b/models';
import type { SimilarNoteItem, NoteType } from '../schemas/api/similarity';

const prisma = new PrismaClient();
const featureService = new FeatureService();
const indicatorService = new IndicatorService();

/**
 * 横断検索パラメータ
 */
export interface CrossSearchParams {
  // クエリ（OHLCVデータまたは特徴ベクトル）
  ohlcvData?: OHLCVData[];
  featureVector?: number[];
  
  // フィルタ
  symbol?: string;
  
  // 検索パラメータ
  topK?: number;
  minSimilarity?: number;
  
  // 検索対象
  searchTradeNotes?: boolean;
  searchAITradeNotes?: boolean;
}

/**
 * 検索統計情報
 */
export interface SearchStats {
  tradeNotesSearched: number;
  aiTradeNotesSearched: number;
  tradeNotesMatched: number;
  aiTradeNotesMatched: number;
}

/**
 * 横断検索結果
 */
export interface CrossSearchResult {
  results: SimilarNoteItem[];
  totalCount: number;
  searchStats: SearchStats;
}

/**
 * 横断類似ノート検索サービスクラス
 */
export class CrossSimilarityService {
  /**
   * Side-A と Side-B を横断して類似ノートを検索
   * 
   * @param params - 検索パラメータ
   * @returns 検索結果
   */
  async searchSimilarNotes(params: CrossSearchParams): Promise<CrossSearchResult> {
    const {
      ohlcvData,
      featureVector,
      symbol,
      topK = 10,
      minSimilarity = 0.5,
      searchTradeNotes = true,
      searchAITradeNotes = true,
    } = params;

    // クエリベクトルを準備
    const queryVector = await this.prepareQueryVector(ohlcvData, featureVector);

    // 統計情報を初期化
    const stats: SearchStats = {
      tradeNotesSearched: 0,
      aiTradeNotesSearched: 0,
      tradeNotesMatched: 0,
      aiTradeNotesMatched: 0,
    };

    // 並列検索（統計情報付き）
    const [tradeNoteSearchResult, aiTradeNoteSearchResult] = await Promise.all([
      searchTradeNotes
        ? this.searchTradeNotesWithStats(queryVector, symbol, minSimilarity)
        : Promise.resolve({ results: [], totalSearched: 0 }),
      searchAITradeNotes
        ? this.searchAITradeNotesWithStats(queryVector, symbol, minSimilarity)
        : Promise.resolve({ results: [], totalSearched: 0 }),
    ]);

    // 統計を更新
    stats.tradeNotesSearched = tradeNoteSearchResult.totalSearched;
    stats.aiTradeNotesSearched = aiTradeNoteSearchResult.totalSearched;
    stats.tradeNotesMatched = tradeNoteSearchResult.results.length;
    stats.aiTradeNotesMatched = aiTradeNoteSearchResult.results.length;

    // 結果をマージしてソート
    const allResults = [...tradeNoteSearchResult.results, ...aiTradeNoteSearchResult.results];
    const sortedResults = allResults
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    return {
      results: sortedResults,
      totalCount: sortedResults.length,
      searchStats: stats,
    };
  }

  /**
   * クエリベクトルを準備
   * 
   * OHLCVデータまたは特徴ベクトルから検索用ベクトルを生成
   */
  private async prepareQueryVector(
    ohlcvData?: OHLCVData[],
    featureVector?: number[]
  ): Promise<number[]> {
    // 特徴ベクトルが直接指定されている場合
    if (featureVector && featureVector.length > 0) {
      return featureVector;
    }

    // OHLCVデータから特徴量を抽出
    if (ohlcvData && ohlcvData.length > 0) {
      const snapshot = indicatorService.generateFeatureSnapshot(ohlcvData, '1h');
      return indicatorService.generateFeatureVector(snapshot);
    }

    throw new Error('ohlcvData または featureVector が必要です');
  }

  /**
   * TradeNote（Side-A）を検索（統計情報付き）
   */
  private async searchTradeNotesWithStats(
    queryVector: number[],
    symbol?: string,
    minSimilarity: number = 0.5
  ): Promise<{ results: SimilarNoteItem[]; totalSearched: number }> {
    // 特徴量ベクトルを持つノートを取得
    const whereClause: { featureVector: { isEmpty: boolean }; symbol?: string } = {
      featureVector: {
        isEmpty: false,
      },
    };
    if (symbol) {
      whereClause.symbol = symbol;
    }

    const notes = await prisma.tradeNote.findMany({
      where: whereClause,
      include: {
        trade: true,
      },
    });

    const totalSearched = notes.length;

    // 類似度を計算
    const results: SimilarNoteItem[] = [];
    for (const note of notes) {
      if (!note.featureVector || note.featureVector.length === 0) {
        continue;
      }

      const similarity = this.calculateSimilarity(queryVector, note.featureVector);
      const distance = this.calculateEuclideanDistance(queryVector, note.featureVector);

      if (similarity >= minSimilarity) {
        results.push({
          noteId: note.id,
          noteType: 'tradeNote' as NoteType,
          similarity,
          distance,
          symbol: note.symbol,
          date: note.entryTime.toISOString().split('T')[0],
          direction: note.trade?.direction as 'long' | 'short' | undefined,
          outcome: note.outcome || undefined,
          pnl: note.trade?.pnl?.toNumber() || undefined,
          metadata: {
            tradeId: note.tradeId,
            timeframe: note.timeframe,
          },
        });
      }
    }

    return { results, totalSearched };
  }

  /**
   * AITradeNote（Side-B）を検索（統計情報付き）
   */
  private async searchAITradeNotesWithStats(
    queryVector: number[],
    symbol?: string,
    minSimilarity: number = 0.5
  ): Promise<{ results: SimilarNoteItem[]; totalSearched: number }> {
    // AITradeNoteはfeatureVectorを持たないため、簡易特徴量を抽出
    // 将来的には AITradeNote にも featureVector を保存する想定
    
    // 検索条件を構築
    const options: { limit: number; symbol?: string } = {
      limit: 100, // 一旦多めに取得してフィルタ
    };
    if (symbol) {
      options.symbol = symbol;
    }

    const { notes } = await aiNoteRepository.findAITradeNotes(options);
    const totalSearched = notes.length;

    // 類似度を計算
    const results: SimilarNoteItem[] = [];
    for (const note of notes) {
      // AITradeNote から簡易特徴量を抽出
      const noteFeatures = this.extractAITradeNoteFeatures(note);
      
      const similarity = this.calculateSimilarity(queryVector, noteFeatures);
      const distance = this.calculateEuclideanDistance(queryVector, noteFeatures);

      if (similarity >= minSimilarity) {
        results.push({
          noteId: note.id,
          noteType: 'aiTradeNote' as NoteType,
          similarity,
          distance,
          symbol: note.symbol,
          date: note.date,
          direction: note.direction,
          outcome: note.result.outcome,
          pnl: note.result.pnlPips,
          metadata: {
            virtualTradeId: note.virtualTradeId,
            planId: note.planId,
            riskRewardActual: note.result.riskRewardActual,
          },
        });
      }
    }

    return { results, totalSearched };
  }

  /**
   * AITradeNote から簡易特徴量ベクトルを抽出
   * 
   * AITradeNote は現状 featureVector を持たないため、
   * result/entryAnalysis/exitAnalysis などから簡易ベクトルを生成
   */
  private extractAITradeNoteFeatures(note: AITradeNote): number[] {
    // 12次元ベクトルに変換（TradeNote と次元を合わせる）
    // 値は 0-1 の範囲に正規化
    
    const direction = note.direction === 'long' ? 1 : 0;
    const outcome = note.result.outcome === 'win' ? 1 : note.result.outcome === 'loss' ? 0 : 0.5;
    const rrRatio = Math.min(Math.max(note.result.riskRewardActual / 5, 0), 1); // RR比を0-1に
    const holdingTime = Math.min(note.result.holdingDuration / 480, 1); // 8時間=480分を最大に
    
    // エントリータイミング評価
    const entryTiming = note.entryAnalysis.timing === 'good' ? 1 : 
                        note.entryAnalysis.timing === 'fair' ? 0.5 : 0;
    
    // 決済タイミング評価
    const exitTiming = note.exitAnalysis.timing === 'optimal' ? 1 :
                       note.exitAnalysis.timing === 'early' ? 0.5 : 0;
    
    // プラン評価
    const planAccuracy = note.planEvaluation.scenarioAccuracy === 'accurate' ? 1 :
                         note.planEvaluation.scenarioAccuracy === 'partial' ? 0.5 : 0;
    
    // 12次元ベクトル（TradeNoteの特徴量構造に合わせる）
    return [
      direction,           // 0: トレンド方向
      rrRatio,            // 1: トレンド強度（RR比で代用）
      entryTiming,        // 2: トレンド整合性（エントリータイミングで代用）
      outcome,            // 3: モメンタム（勝敗で代用）
      exitTiming,         // 4: モメンタムクロスオーバー
      planAccuracy,       // 5: RSI値（プラン精度で代用）
      0.5,                // 6: RSIゾーン（デフォルト）
      0.5,                // 7: BBポジション（データなし）
      0.5,                // 8: BB幅（データなし）
      0.5,                // 9: ローソク足実体比率（データなし）
      direction,          // 10: ローソク足方向
      holdingTime,        // 11: セッションフラグ（保有時間で代用）
    ];
  }

  /**
   * コサイン類似度を計算（統一実装使用）
   */
  private calculateSimilarity(vecA: number[], vecB: number[]): number {
    // 次元が異なる場合はパディングで対応
    const maxLen = Math.max(vecA.length, vecB.length);
    const a = [...vecA];
    const b = [...vecB];
    while (a.length < maxLen) a.push(0);
    while (b.length < maxLen) b.push(0);
    
    return calculateCosineSimilarity(a, b);
  }

  /**
   * ユークリッド距離を計算
   */
  private calculateEuclideanDistance(vecA: number[], vecB: number[]): number {
    const maxLen = Math.max(vecA.length, vecB.length);
    const a = [...vecA];
    const b = [...vecB];
    while (a.length < maxLen) a.push(0);
    while (b.length < maxLen) b.push(0);

    let sum = 0;
    for (let i = 0; i < maxLen; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }

    return Math.sqrt(sum);
  }
}

// シングルトンインスタンス
export const crossSimilarityService = new CrossSimilarityService();
