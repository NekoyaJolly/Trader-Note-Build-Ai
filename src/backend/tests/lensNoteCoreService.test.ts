/**
 * LensNoteCoreService(src/services/lensNoteCoreService.ts)のユニットテスト
 *
 * 検証観点:
 * - Note コア生成: snapshot 生成成否に関わらず Note 行が登録される(取り込みを止めない)
 * - シャドー評価(§9-2): ノート側 lensId から市場側仕様を逆解決し、比較サマリーを返す。
 *   通知系には一切触れない(観測のみ)
 *
 * 外部依存(builder / リポジトリ / ノート読込)は全て DI モックで遮断する。
 */

import type { TradeNote as PrismaTradeNote, Note as PrismaNote } from '@prisma/client';
import {
  LensNoteCoreService,
  type LensNoteCoreServiceDeps,
} from '../../services/lensNoteCoreService';
import {
  createNoteLensSnapshot,
  type NoteLensSnapshot,
} from '../../shared/similarity/lensSnapshotTypes';

const EVENT_TIME = new Date('2026-06-01T12:00:00Z');

/** テスト用のノート側 snapshot(状態レンズ + 指標レンズ) */
function makeNoteSnapshot(): NoteLensSnapshot {
  return createNoteLensSnapshot({
    symbol: 'USDJPY',
    timeframe: '15m',
    eventTime: EVENT_TIME,
    lenses: {
      pattern: { lensVersion: '1.0.0', confidence: 1, features: { doji: true } },
      'ind:rsi#p14': {
        lensVersion: '1.0.0',
        confidence: 1,
        features: { rsi_zone: 'oversold', rsi_value: 0.25, rsi_divergence: 'none' },
      },
    },
  });
}

/** PrismaTradeNote の最小スタブ(テストでは必要フィールドのみ) */
function makeActiveNote(id: string): PrismaTradeNote {
  return {
    id,
    symbol: 'USDJPY',
    timeframe: '15m',
    status: 'active',
    enabled: true,
  } as unknown as PrismaTradeNote;
}

/** Note コア行スタブ */
function makeCoreRow(tradeNoteId: string, snapshot: NoteLensSnapshot | null): PrismaNote {
  return {
    id: `core_${tradeNoteId}`,
    tradeNoteId,
    lensSnapshot: snapshot === null ? null : JSON.parse(JSON.stringify(snapshot)),
  } as unknown as PrismaNote;
}

describe('LensNoteCoreService.createForSideATradeNote', () => {
  test('snapshot 生成成功時に Note 行へ snapshot 付きで upsert される', async () => {
    const snapshot = makeNoteSnapshot();
    const upsertForTradeNote = jest.fn().mockResolvedValue({ id: 'core_1' });
    const deps = {
      builder: { build: jest.fn().mockResolvedValue({ snapshot, warnings: [], barsUsed: 130 }) },
      noteCoreRepository: { upsertForTradeNote, findByTradeNoteIds: jest.fn() },
      tradeNoteService: { loadActiveNotesForMatchingAsPrisma: jest.fn() },
    } as LensNoteCoreServiceDeps;
    const service = new LensNoteCoreService(deps);

    const result = await service.createForSideATradeNote({
      tradeNoteId: 'note_1',
      userId: 'user_1',
      symbol: 'USDJPY',
      side: 'buy',
      timeframe: '15m',
      entryPrice: 150.5,
      eventTime: EVENT_TIME,
      indicatorConfigs: [{ indicatorId: 'rsi', params: { period: 14 }, enabled: true }],
    });

    expect(result.snapshotGenerated).toBe(true);
    expect(result.noteCoreId).toBe('core_1');
    expect(upsertForTradeNote).toHaveBeenCalledWith(
      expect.objectContaining({
        tradeNoteId: 'note_1',
        userId: 'user_1',
        symbol: 'USDJPY',
        lensSnapshot: snapshot,
      })
    );
  });

  test('builder が失敗しても Note 行は lensSnapshot=null で登録される(取り込みを止めない)', async () => {
    const upsertForTradeNote = jest.fn().mockResolvedValue({ id: 'core_2' });
    const deps = {
      builder: { build: jest.fn().mockRejectedValue(new Error('engine down')) },
      noteCoreRepository: { upsertForTradeNote, findByTradeNoteIds: jest.fn() },
      tradeNoteService: { loadActiveNotesForMatchingAsPrisma: jest.fn() },
    } as LensNoteCoreServiceDeps;
    const service = new LensNoteCoreService(deps);

    const result = await service.createForSideATradeNote({
      tradeNoteId: 'note_2',
      userId: null,
      symbol: 'USDJPY',
      side: 'sell',
      timeframe: '15m',
      eventTime: EVENT_TIME,
      indicatorConfigs: [],
    });

    expect(result.snapshotGenerated).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(upsertForTradeNote).toHaveBeenCalledWith(
      expect.objectContaining({ tradeNoteId: 'note_2', lensSnapshot: null })
    );
  });
});

describe('LensNoteCoreService.shadowEvaluateActiveNotes', () => {
  test('snapshot を持つノートだけ比較され、lensId から市場側仕様が逆解決される', async () => {
    const noteSnapshot = makeNoteSnapshot();
    // 市場側はノートと同一の特徴 → スコア 1.0 / triggered
    const build = jest
      .fn()
      .mockResolvedValue({ snapshot: makeNoteSnapshot(), warnings: [], barsUsed: 130 });
    const deps = {
      builder: { build },
      noteCoreRepository: {
        upsertForTradeNote: jest.fn(),
        findByTradeNoteIds: jest.fn().mockResolvedValue([
          makeCoreRow('note_with_snapshot', noteSnapshot),
          makeCoreRow('note_without_snapshot', null),
        ]),
      },
      tradeNoteService: {
        loadActiveNotesForMatchingAsPrisma: jest
          .fn()
          .mockResolvedValue([makeActiveNote('note_with_snapshot'), makeActiveNote('note_without_snapshot')]),
      },
    } as LensNoteCoreServiceDeps;
    const service = new LensNoteCoreService(deps);

    const summary = await service.shadowEvaluateActiveNotes();

    expect(summary.activeNotes).toBe(2);
    expect(summary.notesWithSnapshot).toBe(1);
    expect(summary.comparable).toBe(1);
    expect(summary.triggered).toBe(1);
    expect(summary.symbols).toBe(1);
    // 同一スナップショット同士でも rsi_divergence='none' 同士は 0.5(§6.2 イベント表)のため
    // ind:rsi = (1 + 1 + 0.5)/3 = 5/6、全体 = 0.35×1.0(状態) + 0.65×5/6(指標) ≈ 0.8917
    expect(summary.averageScore).toBeCloseTo(0.35 + 0.65 * (5 / 6), 5);
    expect(summary.errors).toEqual([]);
    // 市場側 build にはノート側 lensId (ind:rsi#p14) から逆解決した仕様が渡る
    const buildArgs = build.mock.calls[0][0] as {
      symbol: string;
      indicatorSpecs: Array<{ lensId: string }>;
    };
    expect(buildArgs.symbol).toBe('USDJPY');
    expect(buildArgs.indicatorSpecs.map((s) => s.lensId)).toEqual(['ind:rsi#p14']);
  });

  test('市場側 snapshot が生成できないシンボルは errors に記録し他を継続する', async () => {
    const deps = {
      builder: {
        build: jest.fn().mockResolvedValue({ snapshot: null, warnings: ['データなし'], barsUsed: 0 }),
      },
      noteCoreRepository: {
        upsertForTradeNote: jest.fn(),
        findByTradeNoteIds: jest
          .fn()
          .mockResolvedValue([makeCoreRow('note_1', makeNoteSnapshot())]),
      },
      tradeNoteService: {
        loadActiveNotesForMatchingAsPrisma: jest.fn().mockResolvedValue([makeActiveNote('note_1')]),
      },
    } as LensNoteCoreServiceDeps;
    const service = new LensNoteCoreService(deps);

    const summary = await service.shadowEvaluateActiveNotes();
    expect(summary.comparable).toBe(0);
    expect(summary.errors.length).toBe(1);
  });

  test('アクティブノート 0 件なら何もせず空サマリーを返す', async () => {
    const build = jest.fn();
    const deps = {
      builder: { build },
      noteCoreRepository: { upsertForTradeNote: jest.fn(), findByTradeNoteIds: jest.fn() },
      tradeNoteService: {
        loadActiveNotesForMatchingAsPrisma: jest.fn().mockResolvedValue([]),
      },
    } as LensNoteCoreServiceDeps;
    const service = new LensNoteCoreService(deps);

    const summary = await service.shadowEvaluateActiveNotes();
    expect(summary.activeNotes).toBe(0);
    expect(build).not.toHaveBeenCalled();
  });
});
