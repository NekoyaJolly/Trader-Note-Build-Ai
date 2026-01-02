/**
 * 特徴量サービス
 * 
 * 目的: トレードノートの特徴量（インジケータ値）を保存・取得・検索
 * 
 * 設計方針:
 * - TradeNote.indicators に JSONB 形式で保存
 * - TradeNote.featureVector に数値配列で保存（類似検索用）
 * - 将来的に pgvector での類似検索に対応可能な構造
 * 
 * 参照: 技術スタック選定シート ⑤⑥
 */

import { PrismaClient, TradeNote, Prisma } from '@prisma/client';
import {
  IndicatorService,
  OHLCVData,
  FeatureSnapshot,
} from './indicators/indicatorService';
import {
  calculateCosineSimilarity,
  SIMILARITY_THRESHOLDS,
} from './featureVectorService';

const prisma = new PrismaClient();
const indicatorService = new IndicatorService();

/**
 * トレンド方向の型定義
 */
export type TrendDirection = 'uptrend' | 'downtrend' | 'neutral';

/**
 * 特徴量更新用の入力型
 */
export interface FeatureUpdateInput {
  noteId: string;
  ohlcvData: OHLCVData[];
  timeframe?: string;
}

/**
 * 類似ノート検索の結果
 */
export interface SimilarNoteResult {
  note: TradeNote;
  similarity: number;  // 0〜1 の類似度
  distance: number;    // ユークリッド距離
}

/**
 * 特徴量サービスクラス
 */
export class FeatureService {
  /**
   * トレードノートの特徴量を計算・更新
   * 
   * OHLCV データから特徴量を計算し、TradeNote の
   * indicators（JSONB）と featureVector（Float[]）に保存
   * 
   * @param input - 特徴量更新入力
   * @returns 更新されたトレードノート
   */
  async updateNoteFeatures(input: FeatureUpdateInput): Promise<TradeNote> {
    const { noteId, ohlcvData, timeframe } = input;

    // 時間足のデフォルト値
    const tf = timeframe || '1h';

    // 特徴量スナップショットを生成
    const snapshot = indicatorService.generateFeatureSnapshot(ohlcvData, tf);
    
    // 類似検索用の特徴量ベクトルを生成
    const vector = indicatorService.generateFeatureVector(snapshot);

    // トレードノートを更新
    return prisma.tradeNote.update({
      where: { id: noteId },
      data: {
        indicators: snapshot as any,  // Prisma JSON 型に変換
        featureVector: vector,
        timeframe: tf,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * 複数のトレードノートの特徴量を一括更新
   * 
   * @param inputs - 特徴量更新入力の配列
   * @returns 更新件数
   */
  async bulkUpdateFeatures(inputs: FeatureUpdateInput[]): Promise<number> {
    let updatedCount = 0;

    for (const input of inputs) {
      try {
        await this.updateNoteFeatures(input);
        updatedCount++;
      } catch (error) {
        console.warn(`特徴量更新エラー (noteId: ${input.noteId}):`, error);
      }
    }

    return updatedCount;
  }

  /**
   * トレードノートの特徴量を取得
   * 
   * @param noteId - トレードノート ID
   * @returns 特徴量スナップショット（なければ null）
   */
  async getNoteFeatures(noteId: string): Promise<FeatureSnapshot | null> {
    const note = await prisma.tradeNote.findUnique({
      where: { id: noteId },
      select: { indicators: true },
    });

    if (!note || !note.indicators) {
      return null;
    }

    return note.indicators as unknown as FeatureSnapshot;
  }

  /**
   * コサイン類似度を計算
   * 
   * featureVectorService の統一 calculateCosineSimilarity を使用
   * 次元が異なる場合はパディングで対応
   * 
   * @param vecA - ベクトル A
   * @param vecB - ベクトル B
   * @returns コサイン類似度（-1〜1）
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) {
      // 次元が異なる場合はパディングで対応（後方互換用）
      const maxLen = Math.max(vecA.length, vecB.length);
      const a = [...vecA];
      const b = [...vecB];
      while (a.length < maxLen) a.push(0);
      while (b.length < maxLen) b.push(0);
      return calculateCosineSimilarity(a, b);
    }
    return calculateCosineSimilarity(vecA, vecB);
  }

  /**
   * ユークリッド距離を計算
   * 
   * @param vecA - ベクトル A
   * @param vecB - ベクトル B
   * @returns ユークリッド距離
   */
  private euclideanDistance(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      return Infinity;
    }

    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
      const diff = vecA[i] - vecB[i];
      sum += diff * diff;
    }

    return Math.sqrt(sum);
  }

  /**
   * 類似トレードノートを検索
   * 
   * 現在の市場状況（OHLCV データ）に類似した過去のトレードノートを検索
   * 将来的に pgvector に置き換え可能な設計
   * 
   * @param ohlcvData - 現在の OHLCV データ
   * @param symbol - 検索対象銘柄（省略時は全銘柄）
   * @param topK - 取得件数
   * @param minSimilarity - 最小類似度（0〜1）
  /**
   * 類似ノートを検索する
   * 
   * @param ohlcvData - 検索クエリ用のOHLCV データ
   * @param symbol - フィルタリング用のシンボル（省略可能）
   * @param topK - 返却する最大件数
   * @param minSimilarity - 最小類似度（これ以下は除外）
   * @returns 類似ノートの配列（類似度降順）
   */
  async findSimilarNotes(
    ohlcvData: OHLCVData[],
    symbol?: string,
    topK: number = 10,
    minSimilarity: number = 0.5
  ): Promise<SimilarNoteResult[]> {
    // 検索用の特徴量スナップショットを生成（デフォルト時間足 1h）
    const querySnapshot = indicatorService.generateFeatureSnapshot(ohlcvData, '1h');
    // 特徴量ベクトルを生成
    const queryVector = indicatorService.generateFeatureVector(querySnapshot);

    // 特徴量ベクトルを持つノートを取得
    // Prisma の生成型を使用
    const whereClause: Prisma.TradeNoteWhereInput = {
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
        aiSummary: true,
      },
    });

    // 類似度を計算してソート
    const results: SimilarNoteResult[] = [];
    for (const note of notes) {
      if (!note.featureVector || note.featureVector.length === 0) {
        continue;
      }

      const similarity = this.cosineSimilarity(queryVector, note.featureVector);
      const distance = this.euclideanDistance(queryVector, note.featureVector);

      // 最小類似度フィルター
      if (similarity >= minSimilarity) {
        results.push({
          note,
          similarity,
          distance,
        });
      }
    }

    // 類似度降順でソートして上位 K 件を返す
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * トレンド方向でフィルターした類似ノートを検索
   * 
   * @param ohlcvData - 現在の OHLCV データ
   * @param trendFilter - フィルターするトレンド方向
   * @param symbol - 検索対象銘柄
   * @param topK - 取得件数
   * @returns 類似ノートの配列
   */
  async findSimilarNotesByTrend(
    ohlcvData: OHLCVData[],
    trendFilter: TrendDirection,
    symbol?: string,
    topK: number = 10
  ): Promise<SimilarNoteResult[]> {
    // まず全体で類似検索
    const allSimilar = await this.findSimilarNotes(ohlcvData, symbol, topK * 2, 0.3);

    // トレンドでフィルター（indicators からトレンドを判定）
    const filtered = allSimilar.filter(result => {
      const indicators = result.note.indicators as unknown as FeatureSnapshot;
      if (!indicators) return false;
      
      // インジケータからトレンドを判定
      const noteTrend = indicatorService.determineTrend(indicators);
      return noteTrend === trendFilter;
    });

    return filtered.slice(0, topK);
  }

  /**
   * 特徴量が未設定のノートを取得
   * 
   * @param limit - 取得件数
   * @returns 特徴量未設定のノート配列
   */
  async getNotesWithoutFeatures(limit: number = 100): Promise<TradeNote[]> {
    return prisma.tradeNote.findMany({
      where: {
        OR: [
          { indicators: { equals: Prisma.DbNull } },
          { featureVector: { isEmpty: true } },
        ],
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 特徴量統計を取得
   * 
   * @returns 特徴量に関する統計情報
   */
  async getFeatureStats(): Promise<{
    totalNotes: number;
    notesWithFeatures: number;
    notesWithoutFeatures: number;
    featureVectorDimension: number | null;
  }> {
    const totalNotes = await prisma.tradeNote.count();
    
    const notesWithFeatures = await prisma.tradeNote.count({
      where: {
        featureVector: {
          isEmpty: false,
        },
      },
    });

    // 特徴量ベクトルの次元数を取得
    const sampleNote = await prisma.tradeNote.findFirst({
      where: {
        featureVector: {
          isEmpty: false,
        },
      },
      select: { featureVector: true },
    });

    return {
      totalNotes,
      notesWithFeatures,
      notesWithoutFeatures: totalNotes - notesWithFeatures,
      featureVectorDimension: sampleNote?.featureVector?.length ?? null,
    };
  }
}

// シングルトンインスタンス
export const featureService = new FeatureService();
