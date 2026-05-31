/**
 * crossSimilarityService の「本番運用」選別フィルタの単体テスト
 *
 * 検証対象（ノート本番運用選別）:
 *   - aiNotesUsedForMatchingOnly=true のとき、AITradeNote 検索が
 *     usedForMatching:true で repository に問い合わせること（実行時のライブ照合は選別集合のみ）。
 *   - 既定（未指定）では usedForMatching を渡さず全 AITradeNote を対象にすること（後方互換）。
 *
 * DB へは到達させない。prisma クライアントと aiNoteRepository をモックする。
 */

// prisma クライアント（TradeNote 側検索で参照される）をモック。
// AITradeNote 側の検証に集中するため findMany は空配列を返す。
jest.mock('../../backend/db/client', () => ({
  prisma: {
    tradeNote: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

// AITradeNote リポジトリをモック。findAITradeNotes の呼び出し引数を検証する。
jest.mock('../../side-b/repositories/aiNoteRepository', () => ({
  findAITradeNotes: jest.fn().mockResolvedValue({ notes: [], total: 0 }),
}));

import { CrossSimilarityService } from '../crossSimilarityService';
import * as aiNoteRepository from '../../side-b/repositories/aiNoteRepository';

const findAITradeNotesMock = aiNoteRepository.findAITradeNotes as jest.Mock;

describe('CrossSimilarityService - 本番運用選別フィルタ', () => {
  const service = new CrossSimilarityService();
  // 12 次元の特徴ベクトル（prepareQueryVector が OHLCV 不要でそのまま使う）
  const featureVector = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.5, 0.5];

  beforeEach(() => {
    findAITradeNotesMock.mockClear();
  });

  it('aiNotesUsedForMatchingOnly=true のとき usedForMatching:true で AITradeNote を検索する', async () => {
    await service.searchSimilarNotes({
      featureVector,
      symbol: 'EURUSD',
      searchTradeNotes: false,
      searchAITradeNotes: true,
      aiNotesUsedForMatchingOnly: true,
    });

    expect(findAITradeNotesMock).toHaveBeenCalledTimes(1);
    expect(findAITradeNotesMock).toHaveBeenCalledWith(
      expect.objectContaining({ usedForMatching: true, symbol: 'EURUSD' })
    );
  });

  it('既定（未指定）では usedForMatching を渡さず全 AITradeNote を対象にする', async () => {
    await service.searchSimilarNotes({
      featureVector,
      searchTradeNotes: false,
      searchAITradeNotes: true,
    });

    expect(findAITradeNotesMock).toHaveBeenCalledTimes(1);
    const passedOptions = findAITradeNotesMock.mock.calls[0][0];
    expect(passedOptions.usedForMatching).toBeUndefined();
  });
});
