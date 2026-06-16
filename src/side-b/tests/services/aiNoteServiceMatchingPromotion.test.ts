/**
 * aiNoteService の本番運用トグル昇格テスト。
 *
 * 目的:
 * - usedForMatching=true で Side-A active TradeNote への materialize を必ず通す
 * - usedForMatching=false でリンク済み Side-A ノートを監視対象外へ戻す
 * - AITradeNote が無い場合は既存どおり null を返す
 *
 * DB には到達させず、Repository / MaterializationService をモックする。
 */

const findSourceMock = jest.fn();
const setMatchingMock = jest.fn();
const materializeMock = jest.fn();
const archiveMock = jest.fn();

jest.mock('../../repositories/aiNoteRepository', () => ({
  findAITradeNoteMaterializationSource: (...args: string[]) => findSourceMock(...args),
  setAITradeNoteUsedForMatching: (...args: [string, boolean]) => setMatchingMock(...args),
}));

jest.mock('../../bridge/MaterializationService', () => ({
  materializationService: {
    materializeFromVirtualTrade: (...args: readonly object[]) => materializeMock(...args),
    archiveMaterializedTradeNote: (...args: readonly object[]) => archiveMock(...args),
  },
}));

import { setNoteUsedForMatching } from '../../services/aiNoteService';

describe('aiNoteService - 本番運用トグル昇格', () => {
  beforeEach(() => {
    findSourceMock.mockReset();
    setMatchingMock.mockReset();
    materializeMock.mockReset();
    archiveMock.mockReset();
    materializeMock.mockResolvedValue('trade-note-1');
    archiveMock.mockResolvedValue(undefined);
    setMatchingMock.mockResolvedValue({ id: 'ai-note-1', usedForMatching: true });
  });

  it('AIノートが存在しない場合は null を返し、副作用を起こさない', async () => {
    findSourceMock.mockResolvedValueOnce(null);

    const result = await setNoteUsedForMatching('missing', true, 'user-1');

    expect(result).toBeNull();
    expect(materializeMock).not.toHaveBeenCalled();
    expect(archiveMock).not.toHaveBeenCalled();
    expect(setMatchingMock).not.toHaveBeenCalled();
  });

  it('usedForMatching=true では認証ユーザー所有の active Side-A ノートへ昇格してからフラグを更新する', async () => {
    const enteredAt = new Date('2026-06-16T09:00:00Z');
    const lensSnapshot = {
      timestamp: enteredAt.toISOString(),
      features: { current_analysis: { direction: 'bullish', trend_strength: 80 } },
    };
    findSourceMock.mockResolvedValueOnce({
      id: 'ai-note-1',
      symbol: 'USDJPY',
      direction: 'long',
      timeframe: '15m',
      higherTimeframe: '1h',
      entryPrice: 156.12,
      enteredAt,
      lensSnapshot,
      tradeNoteId: undefined,
    });

    await setNoteUsedForMatching('ai-note-1', true, 'user-1');

    expect(materializeMock).toHaveBeenCalledWith({
      userId: 'user-1',
      aiTradeNoteId: 'ai-note-1',
      symbol: 'USDJPY',
      side: 'long',
      entryPrice: 156.12,
      enteredAt,
      timeframe: '15m',
      higherTimeframe: '1h',
      lensSnapshot,
      existingTradeNoteId: undefined,
      status: 'active',
    });
    expect(setMatchingMock).toHaveBeenCalledWith('ai-note-1', true);
  });

  it('usedForMatching=false ではリンク済み Side-A ノートをアーカイブしてからフラグを更新する', async () => {
    findSourceMock.mockResolvedValueOnce({
      id: 'ai-note-1',
      symbol: 'USDJPY',
      direction: 'long',
      timeframe: '15m',
      higherTimeframe: undefined,
      entryPrice: 156.12,
      enteredAt: new Date('2026-06-16T09:00:00Z'),
      lensSnapshot: undefined,
      tradeNoteId: 'trade-note-1',
    });

    await setNoteUsedForMatching('ai-note-1', false, 'user-1');

    expect(archiveMock).toHaveBeenCalledWith({
      tradeNoteId: 'trade-note-1',
      userId: 'user-1',
    });
    expect(materializeMock).not.toHaveBeenCalled();
    expect(setMatchingMock).toHaveBeenCalledWith('ai-note-1', false);
  });
});
