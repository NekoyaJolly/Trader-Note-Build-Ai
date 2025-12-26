/**
 * トレードノート生成サービス
 * 
 * 目的: トレード履歴から構造化されたノートを生成し、DB に永続化する
 * 
 * 責務:
 * - トレード履歴 → ノート変換
 * - 特徴量計算の統合
 * - AI 要約生成の統合
 * - DB への永続化
 * 
 * 重要: Phase3 の判定ロジックが読みやすいよう、分かりやすさを優先する
 */

import { Trade, TradeSide } from '@prisma/client';
import { TradeNoteRepository } from '../../backend/repositories/tradeNoteRepository';
import { AISummaryService, TradeDataForSummary } from '../aiSummaryService';
import { FeatureExtractor, MarketContext, FeatureVector } from './featureExtractor';

/**
 * ノート生成結果
 */
export interface TradeNoteGenerationResult {
  noteId: string;           // 生成されたノートの ID
  tradeId: string;          // 元のトレード ID
  summary: string;          // AI 要約 (日本語)
  featureVector: number[];  // 特徴量ベクトル (固定長 7)
  createdAt: Date;          // 作成日時
  tokenUsage?: {            // トークン使用量 (AI 使用時のみ)
    promptTokens?: number;
    completionTokens?: number;
  };
}

/**
 * トレードノート生成サービス
 */
export class TradeNoteGeneratorService {
  private repository: TradeNoteRepository;
  private aiService: AISummaryService;
  private featureExtractor: FeatureExtractor;

  constructor(
    repository?: TradeNoteRepository,
    aiService?: AISummaryService,
    featureExtractor?: FeatureExtractor
  ) {
    // 依存性注入を許可 (テストしやすくするため)
    this.repository = repository || new TradeNoteRepository();
    this.aiService = aiService || new AISummaryService();
    this.featureExtractor = featureExtractor || new FeatureExtractor();
  }

  /**
   * トレードからノートを生成し、DB に永続化する
   * 
   * @param trade - トレードデータ
   * @param marketContext - 市場コンテキスト (オプション)
   * @returns ノート生成結果
   * 
   * 処理フロー:
   * 1. 特徴量を計算
   * 2. AI 要約を生成
   * 3. TradeNote と AISummary を DB に保存
   * 
   * 前提条件:
   * - trade.id に対する TradeNote が未作成であること
   * 
   * 副作用:
   * - DB に TradeNote と AISummary が永続化される
   * - AI API を呼び出す (トークン消費)
   */
  async generateAndSaveNote(
    trade: Trade,
    marketContext?: MarketContext
  ): Promise<TradeNoteGenerationResult> {
    // ステップ 1: 特徴量を計算
    const featureVector = this.featureExtractor.extractFeatures(trade, marketContext);

    // ステップ 2: AI 要約を生成
    const summaryData = this.prepareTradeDataForSummary(trade, marketContext);
    const aiResult = await this.aiService.generateTradeSummary(summaryData);

    // ステップ 3: DB に永続化
    const savedNote = await this.repository.createWithSummary(
      {
        tradeId: trade.id,
        symbol: trade.symbol,
        entryPrice: Number(trade.price),
        side: trade.side,
        indicators: marketContext ? this.extractIndicators(marketContext) : undefined,
        featureVector: featureVector.values,
        timeframe: marketContext?.timeframe,
      },
      {
        summary: aiResult.summary,
        promptTokens: aiResult.promptTokens,
        completionTokens: aiResult.completionTokens,
        model: aiResult.model,
      }
    );

    // 結果を返す
    return {
      noteId: savedNote.id,
      tradeId: savedNote.tradeId,
      summary: aiResult.summary,
      featureVector: featureVector.values,
      createdAt: savedNote.createdAt,
      tokenUsage: {
        promptTokens: aiResult.promptTokens,
        completionTokens: aiResult.completionTokens,
      },
    };
  }

  /**
   * 複数のトレードからノートを一括生成する
   * 
   * @param trades - トレードデータの配列
   * @param getMarketContext - 各トレードの市場コンテキストを取得する関数 (オプション)
   * @returns ノート生成結果の配列
   * 
   * 用途:
   * - CSV インポート後に全トレードのノートを一括生成
   * 
   * 注意:
   * - 大量のトレードを処理する場合は AI API のレート制限に注意
   * - エラーが発生したトレードはスキップし、ログに記録する
   */
  async batchGenerateNotes(
    trades: Trade[],
    getMarketContext?: (trade: Trade) => Promise<MarketContext | undefined>
  ): Promise<TradeNoteGenerationResult[]> {
    const results: TradeNoteGenerationResult[] = [];

    for (const trade of trades) {
      try {
        // 市場コンテキストを取得 (提供されている場合)
        const marketContext = getMarketContext ? await getMarketContext(trade) : undefined;

        // ノートを生成
        const result = await this.generateAndSaveNote(trade, marketContext);
        results.push(result);

        console.log(`ノート生成成功: トレード ${trade.id} → ノート ${result.noteId}`);
      } catch (error) {
        console.error(`ノート生成エラー (トレード ${trade.id}):`, error);
        // エラーが発生してもスキップして続行
      }
    }

    return results;
  }

  /**
   * トレードデータを AI 要約用の形式に変換する
   * 
   * @param trade - トレードデータ
   * @param marketContext - 市場コンテキスト (オプション)
   * @returns AI 要約用のデータ
   */
  private prepareTradeDataForSummary(
    trade: Trade,
    marketContext?: MarketContext
  ): TradeDataForSummary {
    return {
      symbol: trade.symbol,
      side: trade.side as 'buy' | 'sell',
      price: Number(trade.price),
      quantity: Number(trade.quantity),
      timestamp: trade.timestamp,
      marketContext: marketContext ? {
        rsi: marketContext.rsi,
        macd: marketContext.macd,
        timeframe: marketContext.timeframe,
        trend: this.convertTrend(marketContext),
      } : undefined,
    };
  }

  /**
   * MarketContext からトレンド情報を抽出する
   * 
   * @param marketContext - 市場コンテキスト
   * @returns トレンド ('uptrend' | 'downtrend' | 'neutral')
   */
  private convertTrend(
    marketContext: MarketContext
  ): 'uptrend' | 'downtrend' | 'neutral' {
    // RSI ベースでトレンドを判定 (簡易版)
    // Phase3 でより高度な判定ロジックに置き換え可能
    if (!marketContext.rsi) {
      return 'neutral';
    }

    if (marketContext.rsi > 60) {
      return 'uptrend';
    } else if (marketContext.rsi < 40) {
      return 'downtrend';
    } else {
      return 'neutral';
    }
  }

  /**
   * MarketContext から指標データを抽出して JSON 形式にする
   * 
   * @param marketContext - 市場コンテキスト
   * @returns 指標データ (JSON 互換オブジェクト)
   */
  private extractIndicators(marketContext: MarketContext): any {
    return {
      rsi: marketContext.rsi,
      macd: marketContext.macd,
      previousClose: marketContext.previousClose,
      averageVolume: marketContext.averageVolume,
      marketHours: marketContext.marketHours,
    };
  }

  /**
   * 既存のトレードノートを取得する
   * 
   * @param noteId - ノート ID
   * @returns トレードノート (存在しない場合は null)
   */
  async getNote(noteId: string) {
    return await this.repository.findById(noteId);
  }

  /**
   * シンボル別にノートを取得する
   * 
   * @param symbol - 銘柄シンボル
   * @param limit - 取得件数の上限
   * @returns トレードノートの配列
   */
  async getNotesBySymbol(symbol: string, limit: number = 100) {
    return await this.repository.findBySymbol(symbol, limit);
  }

  /**
   * すべてのノートを取得する (ページング対応)
   * 
   * @param limit - 取得件数の上限
   * @param offset - スキップする件数
   * @returns トレードノートの配列
   */
  async getAllNotes(limit: number = 100, offset: number = 0) {
    return await this.repository.findAll(limit, offset);
  }
}
