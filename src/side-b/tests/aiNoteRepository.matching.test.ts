/**
 * aiNoteRepository の「本番運用」選別フィルタ / トグルの単体テスト
 *
 * 検証対象（ノート本番運用選別）:
 *   - findAITradeNotes に usedForMatching を渡すと where 句に反映されること、
 *     未指定なら where に含めないこと（= 全件、後方互換）。
 *   - setAITradeNoteUsedForMatching が存在しない ID で null を返し update を呼ばないこと。
 *   - Side-B → Side-A 昇格用の最小材料を VirtualTrade から取得できること。
 *
 * DB へは到達させない。prisma クライアントをモックする。
 */

const findManyMock = jest.fn().mockResolvedValue([]);
const countMock = jest.fn().mockResolvedValue(0);
const findUniqueMock = jest.fn();
const updateMock = jest.fn();

jest.mock('../../backend/db/client', () => ({
  prisma: {
    aITradeNote: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
  },
}));

import {
  findAITradeNoteMaterializationSource,
  findAITradeNotes,
  setAITradeNoteUsedForMatching,
} from '../repositories/aiNoteRepository';

describe('aiNoteRepository - 本番運用選別', () => {
  beforeEach(() => {
    findManyMock.mockClear();
    countMock.mockClear();
    findUniqueMock.mockClear();
    updateMock.mockClear();
  });

  it('usedForMatching:true を渡すと where 句に usedForMatching:true が入る', async () => {
    await findAITradeNotes({ usedForMatching: true });

    const findManyArg = findManyMock.mock.calls[0][0];
    expect(findManyArg.where.usedForMatching).toBe(true);
  });

  it('usedForMatching 未指定なら where 句に usedForMatching を含めない（全件）', async () => {
    await findAITradeNotes({});

    const findManyArg = findManyMock.mock.calls[0][0];
    expect('usedForMatching' in findManyArg.where).toBe(false);
  });

  it('存在しない ID のトグルは null を返し update を呼ばない', async () => {
    findUniqueMock.mockResolvedValueOnce(null);

    const result = await setAITradeNoteUsedForMatching('missing-id', true);

    expect(result).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('Side-B 昇格用の材料は actualEntry 優先で取得する', async () => {
    const enteredAt = new Date('2026-06-16T09:00:00Z');
    const lensSnapshot = {
      timestamp: enteredAt.toISOString(),
      features: {
        current_analysis: {
          direction: 'bullish',
          trend_strength: 80,
        },
      },
      totalComputeDurationMs: 12,
    };
    findUniqueMock.mockResolvedValueOnce({
      id: 'ai-note-1',
      symbol: 'USDJPY',
      direction: 'long',
      timeframe: '15m',
      higherTimeframe: null,
      tradeNoteId: null,
      lensSnapshot,
      virtualTrade: {
        actualEntry: { toNumber: () => 156.12 },
        plannedEntry: { toNumber: () => 156.0 },
        enteredAt,
      },
    });

    const result = await findAITradeNoteMaterializationSource('ai-note-1');

    expect(result).toEqual({
      id: 'ai-note-1',
      symbol: 'USDJPY',
      direction: 'long',
      timeframe: '15m',
      higherTimeframe: undefined,
      entryPrice: 156.12,
      enteredAt,
      tradeNoteId: undefined,
      lensSnapshot,
    });
  });
});
