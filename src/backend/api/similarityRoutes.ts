/**
 * 横断類似ノート検索 API ルート
 * 
 * Side-A/Side-B を横断した類似ノート検索エンドポイント
 */

import { Router, Request, Response } from 'express';
import { crossSimilarityService } from '../../services/crossSimilarityService';
import {
  CrossSimilaritySearchRequestSchema,
  CrossSimilaritySearchResponseSchema,
  ErrorResponseSchema,
  type CrossSimilaritySearchRequest,
} from '../../schemas/api/similarity';

const router = Router();

/**
 * POST /api/similarity/search-cross
 * 
 * Side-A と Side-B を横断して類似ノートを検索
 * 
 * リクエストボディ:
 * - ohlcvData?: OHLCVData[] - OHLCV データ配列（特徴量自動抽出）
 * - featureVector?: number[] - 12次元特徴ベクトル（直接指定）
 * - symbol?: string - シンボルフィルタ
 * - topK?: number - 取得件数（デフォルト: 10）
 * - minSimilarity?: number - 最小類似度（デフォルト: 0.5）
 * - searchTradeNotes?: boolean - TradeNote を検索（デフォルト: true）
 * - searchAITradeNotes?: boolean - AITradeNote を検索（デフォルト: true）
 * 
 * レスポンス:
 * - results: 類似ノート配列（noteType, similarity, distance 等）
 * - totalCount: 結果件数
 * - searchStats: 検索統計情報
 */
router.post('/search-cross', async (req: Request, res: Response) => {
  try {
    // リクエストバリデーション
    const result = CrossSimilaritySearchRequestSchema.safeParse(req.body);
    
    if (!result.success) {
      const errorResponse = ErrorResponseSchema.parse({
        success: false,
        error: 'バリデーションエラー',
        details: result.error.format(),
      });
      return res.status(400).json(errorResponse);
    }

    const params: CrossSimilaritySearchRequest = result.data;

    // 横断検索を実行
    const searchResult = await crossSimilarityService.searchSimilarNotes({
      ohlcvData: params.ohlcvData,
      featureVector: params.featureVector,
      symbol: params.symbol,
      topK: params.topK,
      minSimilarity: params.minSimilarity,
      searchTradeNotes: params.searchTradeNotes,
      searchAITradeNotes: params.searchAITradeNotes,
    });

    // レスポンスバリデーション
    const response = CrossSimilaritySearchResponseSchema.parse({
      success: true,
      data: searchResult,
    });

    return res.json(response);
    
  } catch (error) {
    console.error('横断類似検索エラー:', error);
    
    const errorResponse = ErrorResponseSchema.parse({
      success: false,
      error: error instanceof Error ? error.message : '類似検索に失敗しました',
      details: process.env.NODE_ENV !== 'production' && error instanceof Error 
        ? error.stack 
        : undefined,
    });
    
    return res.status(500).json(errorResponse);
  }
});

/**
 * GET /api/similarity/health
 * 
 * 類似検索サービスのヘルスチェック
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'cross-similarity-search',
    timestamp: new Date().toISOString(),
  });
});

export default router;
