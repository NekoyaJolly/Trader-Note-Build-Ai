/**
 * MatchingService テスト
 * 
 * 目的:
 * - NoteEvaluator 経由のマッチング動作検証
 * - 次元不一致・NaN・0除算の防御テスト
 * - マッチ結果 DB 永続化のテスト
 * 
 * 設計（Task 6）:
 * - Service は NoteEvaluator.evaluate() を呼ぶだけ
 * - similarity を直接計算しない
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MatchingService } from '../../services/matchingService';
import type { TradeNote, MarketData } from '../../models/types';
import type { MatchResultDTO } from '../../domain/matching/MatchResultDTO';
import { SimultaneousHitControlService } from '../../services/notification/simultaneousHitControlService';
import type { MatchingPipelineRunRepository } from '../repositories/matchingPipelineRunRepository';
import {
  createNoteEvaluatorFromFSNote,
  convertMarketDataToSnapshot
} from '../../services/legacyNoteEvaluatorAdapter';
import type { TradeNote as PrismaTradeNote, EvaluationLog, MarketSnapshot } from '@prisma/client';
import type { TradeNoteWithSummary } from '../repositories/tradeNoteRepository';
import { Decimal } from '@prisma/client/runtime/library';
import type { LensEvaluationDetail } from '../../services/lensNoteCoreService';
import type { SnapshotSimilarityResult } from '../../shared/similarity/similarityEngine';
import type { TradeNoteService } from '../../services/tradeNoteService';
import type { MarketDataService } from '../../services/marketDataService';
import type { MatchResultRepository } from '../repositories/matchResultRepository';
import type { MarketSnapshotRepository } from '../repositories/marketSnapshotRepository';
import type { EvaluationLogRepository } from '../repositories/evaluationLogRepository';

describe('MatchingService', () => {
  let service: MatchingService;

  beforeEach(() => {
    service = new MatchingService();
  });

  // テスト用のトレードノートを生成
  const createMockNote = (overrides?: Partial<TradeNote>): TradeNote => ({
    id: 'note_test_123',
    tradeId: 'trade_test_123',
    timestamp: new Date(),
    symbol: 'BTCUSDT',
    side: 'buy',
    entryPrice: 50000,
    quantity: 1,
    marketContext: {
      timeframe: '15m',
      trend: 'bullish',
      indicators: { rsi: 60, macd: 10, volume: 1000 },
    },
    aiSummary: 'テスト要約',
    features: [50000, 1000, 60, 10, 1000, 1, 1],
    createdAt: new Date(),
    status: 'active',
    ...overrides,
  });

  // テスト用の市場データを生成
  const createMockMarket = (overrides?: Partial<MarketData>): MarketData => ({
    symbol: 'BTCUSDT',
    timestamp: new Date(),
    timeframe: '15m',
    open: 49900,
    high: 50100,
    low: 49800,
    close: 50000,
    volume: 1000,
    indicators: {
      rsi: 60,
      macd: 10,
      trend: 'bullish',
    },
    ...overrides,
  });

  /**
   * ヘルパー関数: NoteEvaluator 経由でスコアを計算
   * 
   * Task 6 設計: Service は similarity を直接計算しない
   * テストでも NoteEvaluator を使用する
   */
  const evaluateMatchViaEvaluator = (note: TradeNote, market: MarketData): number => {
    const evaluator = createNoteEvaluatorFromFSNote(note);
    const snapshot = convertMarketDataToSnapshot(market);
    const result = evaluator.evaluate(snapshot);
    return result.similarity;
  };

  describe('NoteEvaluator 経由のマッチスコア計算', () => {
    it('同一条件で類似度が計算される', () => {
      const note = createMockNote();
      const market = createMockMarket();

      const similarity = evaluateMatchViaEvaluator(note, market);

      // 類似度が 0-1 の範囲内
      expect(similarity).toBeGreaterThanOrEqual(0);
      expect(similarity).toBeLessThanOrEqual(1);
    });

    it('トレンド不一致でも類似度は計算される', () => {
      const note = createMockNote({ marketContext: { timeframe: '15m', trend: 'bullish' } });
      const market = createMockMarket({ indicators: { rsi: 30, macd: -10, trend: 'bearish' } });

      const similarity = evaluateMatchViaEvaluator(note, market);

      // 類似度が 0-1 の範囲内
      expect(similarity).toBeGreaterThanOrEqual(0);
      expect(similarity).toBeLessThanOrEqual(1);
    });

    it('価格レンジ外でも類似度は計算される', () => {
      const note = createMockNote({ entryPrice: 50000 });
      const market = createMockMarket({ close: 60000 }); // 20% 乖離

      const similarity = evaluateMatchViaEvaluator(note, market);

      // 類似度が 0-1 の範囲内
      expect(similarity).toBeGreaterThanOrEqual(0);
      expect(similarity).toBeLessThanOrEqual(1);
    });
  });

  describe('NoteEvaluator（エッジケース）', () => {
    it('空のベクトルでもエラーにならない', () => {
      const note = createMockNote({ features: [] });
      const market = createMockMarket();

      // エラーが発生しない
      expect(() => evaluateMatchViaEvaluator(note, market)).not.toThrow();
    });

    it('次元が異なるベクトルでもエラーにならない', () => {
      const note = createMockNote({ features: [1, 2, 3] });
      const market = createMockMarket();

      // エラーが発生しない
      expect(() => evaluateMatchViaEvaluator(note, market)).not.toThrow();
    });

    it('NaN を含むベクトルでもエラーにならない', () => {
      const note = createMockNote({ features: [NaN, 2, 3, 4, 5, 6, 7] });
      const market = createMockMarket();

      // エラーが発生しない
      expect(() => evaluateMatchViaEvaluator(note, market)).not.toThrow();
    });

    it('Infinity を含むベクトルでもエラーにならない', () => {
      const note = createMockNote({ features: [Infinity, 2, 3, 4, 5, 6, 7] });
      const market = createMockMarket();

      // エラーが発生しない
      expect(() => evaluateMatchViaEvaluator(note, market)).not.toThrow();
    });

    it('すべてゼロのベクトルでもエラーにならない', () => {
      const note = createMockNote({ features: [0, 0, 0, 0, 0, 0, 0] });
      const market = createMockMarket();

      // エラーが発生しない（0除算防御）
      const similarity = evaluateMatchViaEvaluator(note, market);
      expect(similarity).toBeLessThanOrEqual(1);
    });
  });

  describe('マッチ履歴取得', () => {
    it('getMatchHistory が配列を返す', async () => {
      // DB に依存するため、空配列が返ることを確認
      // 実際の DB テストは E2E で実施
      const history = await service.getMatchHistory({ limit: 10 });

      expect(Array.isArray(history)).toBe(true);
    });
  });

  /**
   * 通知パイプラインの配線テスト (確定P0: マッチ通知が UI に届かない問題)
   *
   * 旧実装は通知許可後に NotificationLog(監査ログ)を upsert するだけで、
   * UI 表示用の Notification 行を作る sendInApp が一度も呼ばれていなかった。
   * このブロックは「shouldNotify=true のとき sendInApp が呼ばれ Notification が作られる」
   * ことを固定する。
   */
  describe('runMatchingPipeline 通知配線', () => {
    // Side-B 接頭辞付きノートを使うと getNotePriority の DB アクセスを回避できる
    const createSideBMatch = (): MatchResultDTO => ({
      id: 'match_test_1',
      matchScore: 0.9,
      historicalNoteId: 'sideb:note_abc',
      marketSnapshot: {},
      marketSnapshotId: 'snap_123',
      symbol: 'EURUSD',
      reasons: ['トレンド一致'],
      evaluatedAt: new Date(),
    });

    // Side-A ノート (sideb: 接頭辞なし)。getNotePriority が DB を引くため、テストでは
    // getNotePriority をモックして DB アクセスを回避する。
    const createSideAMatch = (overrides?: Partial<MatchResultDTO>): MatchResultDTO => ({
      id: 'match_test_a1',
      matchScore: 0.88,
      historicalNoteId: 'note_side_a_1',
      marketSnapshot: {},
      marketSnapshotId: 'snap_a1',
      symbol: 'USDJPY',
      reasons: ['価格帯一致'],
      evaluatedAt: new Date(),
      ...overrides,
    });

    // control は対象ノートをそのまま通知対象に通すモック
    const buildHitControl = (): SimultaneousHitControlService => {
      const hitControl = new SimultaneousHitControlService();
      jest
        .spyOn(hitControl, 'control')
        .mockImplementation((hits) =>
          Promise.resolve({
            toNotify: hits,
            toSkip: [],
            groupedBySymbol: new Map(),
          })
        );
      return hitControl;
    };

    // run 永続化リポジトリのモック。テストで DB 書き込みを発生させないために注入する。
    // create の戻り値は finalizePipelineRun で使わないため空オブジェクトで足りる（テストのため cast 許容）。
    const buildRunRepo = (): Pick<
      MatchingPipelineRunRepository,
      'create' | 'findLatest' | 'findMany'
    > =>
      ({
        create: jest.fn<(input: unknown) => Promise<unknown>>().mockResolvedValue({}),
        findLatest: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
        findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
      }) as unknown as Pick<
        MatchingPipelineRunRepository,
        'create' | 'findLatest' | 'findMany'
      >;

    type MatchCollectionForTest = {
      matches: MatchResultDTO[];
      errors: string[];
      skipReasons: Record<string, number>;
    };

    const mockPipelineMatches = (
      pipeline: MatchingService,
      matches: MatchResultDTO[],
      overrides: Partial<Omit<MatchCollectionForTest, 'matches'>> = {}
    ): void => {
      jest
        .spyOn(
          pipeline as unknown as {
            checkForAllMatchesDetailed: () => Promise<MatchCollectionForTest>;
          },
          'checkForAllMatchesDetailed'
        )
        .mockResolvedValue({
          matches,
          errors: [],
          skipReasons: {},
          ...overrides,
        });
    };

    it('Side-B (sideb:) マッチは Side-A 通知経路の対象外として skip され error にならない', async () => {
      // Side-A/Side-B 切り分け: MatchResult/NotificationLog/Notification は noteId が
      // TradeNote(UUID) への FK で Side-A 専用。Side-B (sideb: 非UUID) を通すと UUID パース
      // エラーで毎回 notify_error になっていた。通知段階で明示的に除外する。
      const sendInApp = jest
        .fn<(p: unknown) => Promise<{ success: boolean; id?: string }>>()
        .mockResolvedValue({ success: true, id: 'notif_1' });
      const evaluateWithPersistence = jest
        .fn<() => Promise<{ shouldNotify: boolean; status: 'sent'; reasonSummary: string }>>()
        .mockResolvedValue({ shouldNotify: true, status: 'sent', reasonSummary: 'スコア: 0.900' });

      const runRepo = buildRunRepo();
      const pipeline = new MatchingService({
        inAppNotificationSender: { sendInApp, sendPush: jest.fn<(p: unknown) => Promise<{ success: boolean; id?: string }>>().mockResolvedValue({ success: true }) },
        notificationTriggerService: { evaluateWithPersistence, invalidateNotificationLog: jest.fn<(id: string) => Promise<void>>() },
        simultaneousHitControl: buildHitControl(),
        matchingPipelineRunRepository: runRepo,
      });
      mockPipelineMatches(pipeline, [createSideBMatch()]);

      const result = await pipeline.runMatchingPipeline({ trigger: 'cron' });

      // Side-B は通知判定 (evaluateWithPersistence) にも sendInApp にも渡らない = UUID エラーを起こさない
      expect(evaluateWithPersistence).not.toHaveBeenCalled();
      expect(sendInApp).not.toHaveBeenCalled();
      expect(result.notified).toBe(0);
      expect(result.skipped).toBe(1);
      // 除外は error ではないので skipReasons に side_b_excluded、status は success
      expect(result.skipReasons).toEqual({ side_b_excluded: 1 });
      expect(result.errors).toEqual([]);
      expect(result.status).toBe('success');
      expect(runRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          totalMatches: 1,
          skipped: 1,
          errorCount: 0,
          skipReasons: { side_b_excluded: 1 },
        })
      );
    });

    it('Side-A note ID でも shouldNotify=true なら sendInApp が呼ばれ notified にカウントされる', async () => {
      // ゴールデンパス保証: Side-A ノート(sideb: 接頭辞なし)の通知が UI 行作成まで届くことを固定する
      const sendInApp = jest
        .fn<(p: unknown) => Promise<{ success: boolean; id?: string }>>()
        .mockResolvedValue({ success: true, id: 'notif_a1' });
      const evaluateWithPersistence = jest
        .fn<() => Promise<{ shouldNotify: boolean; status: 'sent'; reasonSummary: string }>>()
        .mockResolvedValue({ shouldNotify: true, status: 'sent', reasonSummary: 'スコア: 0.880' });

      const pipeline = new MatchingService({
        inAppNotificationSender: { sendInApp, sendPush: jest.fn<(p: unknown) => Promise<{ success: boolean; id?: string }>>().mockResolvedValue({ success: true }) },
        notificationTriggerService: { evaluateWithPersistence, invalidateNotificationLog: jest.fn<(id: string) => Promise<void>>() },
        simultaneousHitControl: buildHitControl(),
        matchingPipelineRunRepository: buildRunRepo(),
      });
      // Side-A ノートは getNotePriority が DB を引くためモックして DB アクセスを回避する
      jest
        .spyOn(pipeline as unknown as { getNotePriority: (id: string) => Promise<number> }, 'getNotePriority')
        .mockResolvedValue(5);
      mockPipelineMatches(pipeline, [createSideAMatch()]);

      const result = await pipeline.runMatchingPipeline();

      expect(sendInApp).toHaveBeenCalledTimes(1);
      expect(sendInApp).toHaveBeenCalledWith(
        expect.objectContaining({
          noteId: 'note_side_a_1',
          marketSnapshotId: 'snap_a1',
          symbol: 'USDJPY',
          score: 0.88,
        })
      );
      expect(result.notified).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('同一 symbol の複数通知では通知本文に集約情報を載せる', async () => {
      // Notification 行は note 単位のまま維持しつつ、ユーザーが同一 symbol の同時ヒットを把握できるようにする
      const sendInApp = jest
        .fn<(p: unknown) => Promise<{ success: boolean; id?: string }>>()
        .mockResolvedValue({ success: true, id: 'notif_symbol_1' });
      const sendPush = jest
        .fn<(p: unknown) => Promise<{ success: boolean; id?: string }>>()
        .mockResolvedValue({ success: true });
      const evaluateWithPersistence = jest
        .fn<() => Promise<{ shouldNotify: boolean; status: 'sent'; reasonSummary: string }>>()
        .mockResolvedValue({ shouldNotify: true, status: 'sent', reasonSummary: 'スコア: 0.880' });
      const hitControl = new SimultaneousHitControlService();
      jest.spyOn(hitControl, 'control').mockImplementation((hits) =>
        Promise.resolve({
          toNotify: hits,
          toSkip: [],
          groupedBySymbol: new Map([['USDJPY', hits]]),
        })
      );

      const pipeline = new MatchingService({
        inAppNotificationSender: { sendInApp, sendPush },
        notificationTriggerService: {
          evaluateWithPersistence,
          invalidateNotificationLog: jest.fn<(id: string) => Promise<void>>(),
        },
        simultaneousHitControl: hitControl,
        matchingPipelineRunRepository: buildRunRepo(),
      });
      jest
        .spyOn(pipeline as unknown as { getNotePriority: (id: string) => Promise<number> }, 'getNotePriority')
        .mockResolvedValue(5);
      mockPipelineMatches(pipeline, [
        createSideAMatch(),
        createSideAMatch({
          id: 'match_test_a2',
          matchScore: 0.81,
          historicalNoteId: 'note_side_a_2',
          marketSnapshotId: 'snap_a2',
          reasons: ['RSI一致'],
        }),
      ]);

      const result = await pipeline.runMatchingPipeline();

      expect(sendInApp).toHaveBeenCalledTimes(2);
      expect(sendInApp).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          title: '同時ヒット: USDJPY',
          message: expect.stringContaining('USDJPYで2件のノートが同時ヒットしました'),
          reasonSummary: expect.stringContaining('同時ヒット 2/2件'),
        })
      );
      expect(sendInApp).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          title: '同時ヒット: USDJPY',
          message: expect.stringContaining('代表スコア: 88%, 81%'),
          reasonSummary: expect.stringContaining('同時ヒット 2/2件'),
        })
      );
      expect(result.notified).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('sendInApp が success:false のとき skipped + errors にし、先行ログを無効化して再試行可能にする', async () => {
      const sendInApp = jest
        .fn<(p: unknown) => Promise<{ success: boolean; id?: string }>>()
        .mockResolvedValue({ success: false });
      // 配信前に書かれた NotificationLog の id を返す = 失敗時に無効化対象になる
      const evaluateWithPersistence = jest
        .fn<() => Promise<{ shouldNotify: boolean; status: 'sent'; reasonSummary: string; notificationLogId: string }>>()
        .mockResolvedValue({
          shouldNotify: true,
          status: 'sent',
          reasonSummary: 'スコア: 0.900',
          notificationLogId: 'log_1',
        });
      const invalidateNotificationLog = jest.fn<(id: string) => Promise<void>>().mockResolvedValue();

      const pipeline = new MatchingService({
        inAppNotificationSender: { sendInApp, sendPush: jest.fn<(p: unknown) => Promise<{ success: boolean; id?: string }>>().mockResolvedValue({ success: true }) },
        notificationTriggerService: { evaluateWithPersistence, invalidateNotificationLog },
        simultaneousHitControl: buildHitControl(),
        matchingPipelineRunRepository: buildRunRepo(),
      });
      jest
        .spyOn(pipeline as unknown as { getNotePriority: (id: string) => Promise<number> }, 'getNotePriority')
        .mockResolvedValue(5);
      mockPipelineMatches(pipeline, [createSideAMatch()]);

      const result = await pipeline.runMatchingPipeline();

      expect(sendInApp).toHaveBeenCalledTimes(1);
      // 先行ログを無効化して次回再試行できるようにする
      expect(invalidateNotificationLog).toHaveBeenCalledWith('log_1');
      expect(result.notified).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('marketSnapshotId 欠落時は sendInApp を呼ばず skip + errors にする', async () => {
      const sendInApp = jest
        .fn<(p: unknown) => Promise<{ success: boolean; id?: string }>>()
        .mockResolvedValue({ success: true, id: 'notif_1' });
      const evaluateWithPersistence = jest
        .fn<() => Promise<{ shouldNotify: boolean; status: 'sent'; reasonSummary: string }>>()
        .mockResolvedValue({ shouldNotify: true, status: 'sent', reasonSummary: 'スコア: 0.900' });

      const pipeline = new MatchingService({
        inAppNotificationSender: { sendInApp, sendPush: jest.fn<(p: unknown) => Promise<{ success: boolean; id?: string }>>().mockResolvedValue({ success: true }) },
        notificationTriggerService: { evaluateWithPersistence, invalidateNotificationLog: jest.fn<(id: string) => Promise<void>>() },
        simultaneousHitControl: buildHitControl(),
        matchingPipelineRunRepository: buildRunRepo(),
      });
      // marketSnapshotId を空にしたマッチ (= 紐づく MatchResult が無いケース)
      jest
        .spyOn(pipeline as unknown as { getNotePriority: (id: string) => Promise<number> }, 'getNotePriority')
        .mockResolvedValue(5);
      mockPipelineMatches(pipeline, [{ ...createSideAMatch(), marketSnapshotId: '' }]);

      const result = await pipeline.runMatchingPipeline();

      expect(sendInApp).not.toHaveBeenCalled();
      expect(result.notified).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('shouldNotify=false のとき sendInApp は呼ばれず skipReasonCode が集計される', async () => {
      const sendInApp = jest
        .fn<(p: unknown) => Promise<{ success: boolean; id?: string }>>()
        .mockResolvedValue({ success: true, id: 'notif_1' });
      // skipReasonCode を返すと skipReasons 集計に reason code 別で反映される (P1 observability)
      const evaluateWithPersistence = jest
        .fn<() => Promise<{ shouldNotify: boolean; status: 'skipped'; skipReason: string; skipReasonCode: 'cooldown' }>>()
        .mockResolvedValue({ shouldNotify: false, status: 'skipped', skipReason: 'クールダウン中', skipReasonCode: 'cooldown' });

      const runRepo = buildRunRepo();
      const pipeline = new MatchingService({
        inAppNotificationSender: { sendInApp, sendPush: jest.fn<(p: unknown) => Promise<{ success: boolean; id?: string }>>().mockResolvedValue({ success: true }) },
        notificationTriggerService: { evaluateWithPersistence, invalidateNotificationLog: jest.fn<(id: string) => Promise<void>>() },
        simultaneousHitControl: buildHitControl(),
        matchingPipelineRunRepository: runRepo,
      });
      jest
        .spyOn(pipeline as unknown as { getNotePriority: (id: string) => Promise<number> }, 'getNotePriority')
        .mockResolvedValue(5);
      mockPipelineMatches(pipeline, [createSideAMatch()]);

      const result = await pipeline.runMatchingPipeline({ trigger: 'cron' });

      expect(sendInApp).not.toHaveBeenCalled();
      expect(result.notified).toBe(0);
      expect(result.skipped).toBe(1);
      // reason code 別の集計が戻り値と永続化の両方に乗る
      expect(result.skipReasons).toEqual({ cooldown: 1 });
      expect(runRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ trigger: 'cron', skipReasons: { cooldown: 1 } })
      );
    });

    it('市場データ取得失敗でマッチ0件でも partial_failure として run に残す', async () => {
      const runRepo = buildRunRepo();
      const pipeline = new MatchingService({
        simultaneousHitControl: buildHitControl(),
        matchingPipelineRunRepository: runRepo,
      });
      mockPipelineMatches(pipeline, [], {
        errors: ['市場データ取得エラー(lens): symbol=USDJPY, timeframe=15m, EODHD timeout'],
        skipReasons: { market_data_unavailable: 1 },
      });

      const result = await pipeline.runMatchingPipeline({ trigger: 'cron' });

      expect(result.totalMatches).toBe(0);
      expect(result.errors).toEqual([
        '市場データ取得エラー(lens): symbol=USDJPY, timeframe=15m, EODHD timeout',
      ]);
      expect(result.skipReasons).toEqual({ market_data_unavailable: 1 });
      expect(result.status).toBe('partial_failure');
      expect(runRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'partial_failure',
          errorCount: 1,
          skipReasons: { market_data_unavailable: 1 },
        })
      );
    });

    it('recordMarketClosedRun は status=skipped の run を記録し runId を返す', async () => {
      const runRepo = buildRunRepo();
      const pipeline = new MatchingService({ matchingPipelineRunRepository: runRepo });

      const runId = await pipeline.recordMarketClosedRun({
        trigger: 'cron',
        marketStatus: '土日休場',
      });

      expect(runId).toBeTruthy();
      expect(runRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: runId,
          trigger: 'cron',
          status: 'skipped',
          marketStatus: '土日休場',
        })
      );
    });

  });
});

// ============================================================
// レンズマッチングエンジン (Phase α-3、NOTE_SIMILARITY_FOUNDATION.md §9-3)
// ============================================================
describe('MatchingService lens エンジン (Phase α-3)', () => {
  // テスト用の Prisma 型ノートを生成 (loadActiveNotesForMatchingAsPrisma の戻り値型に合わせる)
  const createPrismaNote = (overrides?: Partial<TradeNoteWithSummary>): TradeNoteWithSummary => ({
    id: 'note_lens_1',
    tradeId: 'trade_lens_1',
    symbol: 'USDJPY',
    side: 'buy',
    entryPrice: new Decimal(150),
    aiSummary: null,
    indicators: null,
    timeframe: '15m',
    marketContext: { trend: 'bullish' },
    userNotes: null,
    tags: [],
    status: 'active',
    activatedAt: null,
    archivedAt: null,
    lastEditedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    indicatorConfig: null,
    userId: 'user_1',
    priority: 5,
    enabled: true,
    pausedUntil: null,
    featureVector: [],
    ...overrides,
  });

  // テスト用の市場データを生成
  const createLensMarket = (overrides?: Partial<MarketData>): MarketData => ({
    symbol: 'USDJPY',
    timestamp: new Date(),
    timeframe: '15m',
    open: 149.9,
    high: 150.1,
    low: 149.8,
    close: 150.0,
    volume: 1000,
    indicators: { rsi: 28, macd: -0.1, trend: 'bullish' },
    ...overrides,
  });

  // 発火するレンズ比較結果
  const triggeredComparison: SnapshotSimilarityResult = {
    comparable: true,
    score: 0.86,
    level: 'medium',
    triggered: true,
    threshold: 0.75,
    preset: 'indicator_focused',
    commonLensCount: 7,
    breakdown: [
      {
        lensId: 'indicator:rsi:p14',
        layer: 'indicator',
        similarity: 0.92,
        weight: 1,
        comparedKeys: 3,
        skippedKeys: 0,
        noteConfidence: 1,
        marketConfidence: 1,
      },
      {
        lensId: 'state:trend_regime',
        layer: 'state',
        similarity: 0.81,
        weight: 1,
        comparedKeys: 2,
        skippedKeys: 0,
        noteConfidence: 1,
        marketConfidence: 1,
      },
    ],
  };

  // lens 経路の外部依存を全てモック注入した MatchingService を組み立てる
  const buildLensService = (note: TradeNoteWithSummary, detail: LensEvaluationDetail) => {
    const loadActiveNotesForMatchingAsPrisma = jest
      .fn<TradeNoteService['loadActiveNotesForMatchingAsPrisma']>()
      .mockResolvedValue([note]);
    const getNoteById = jest.fn<TradeNoteService['getNoteById']>();
    const getCurrentMarketDataWithIndicators = jest
      .fn<MarketDataService['getCurrentMarketDataWithIndicators']>()
      .mockResolvedValue(createLensMarket());
    const upsertSnapshot = jest
      .fn<MarketSnapshotRepository['upsertSnapshot']>()
      .mockResolvedValue({ id: 'snap_lens_1' } as MarketSnapshot);
    const upsertLog = jest
      .fn<EvaluationLogRepository['upsertLog']>()
      .mockResolvedValue({ id: 'evallog_1' } as EvaluationLog);
    const upsertByNoteAndSnapshot = jest
      .fn<MatchResultRepository['upsertByNoteAndSnapshot']>()
      .mockResolvedValue({ id: 'match_lens_1' } as Awaited<ReturnType<MatchResultRepository['upsertByNoteAndSnapshot']>>);
    const findHistory = jest.fn<MatchResultRepository['findHistory']>();
    const evaluateNotesForMatching = jest
      .fn<(notes: ReadonlyArray<PrismaTradeNote>) => Promise<LensEvaluationDetail>>()
      .mockResolvedValue(detail);
    const service = new MatchingService({
      tradeNoteService: { loadActiveNotesForMatchingAsPrisma, getNoteById },
      marketDataService: { getCurrentMarketDataWithIndicators },
      marketSnapshotRepository: { upsertSnapshot },
      evaluationLogRepository: { upsertLog },
      matchResultRepository: { upsertByNoteAndSnapshot, findHistory },
      lensNoteCoreService: { evaluateNotesForMatching },
    });

    return {
      service,
      mocks: {
        loadActiveNotesForMatchingAsPrisma,
        getCurrentMarketDataWithIndicators,
        upsertSnapshot,
        upsertLog,
        upsertByNoteAndSnapshot,
        evaluateNotesForMatching,
      },
    };
  };

  it('triggered なレンズ評価から MatchResult が永続化され score/threshold がレンズ値になる', async () => {
    const note = createPrismaNote();
    const { service, mocks } = buildLensService(note, {
      activeNotes: 1,
      notesWithSnapshot: 1,
      symbols: 1,
      evaluations: [{ note, timeframe: '15m', comparison: triggeredComparison }],
      errors: [],
    });

    const matches = await service.checkForMatches();

    expect(mocks.evaluateNotesForMatching).toHaveBeenCalledWith([note]);
    // 市場データは評価時間足で取得される(15m 固定にしない。Copilot レビュー #385 対応)
    expect(mocks.getCurrentMarketDataWithIndicators).toHaveBeenCalledWith('USDJPY', '15m');
    expect(matches).toHaveLength(1);
    // score はレンズ類似度そのまま(旧経路のルール補正を適用しない)
    expect(matches[0]?.matchScore).toBe(0.86);
    expect(matches[0]?.threshold).toBe(0.75);
    expect(matches[0]?.historicalNoteId).toBe(note.id);
    expect(matches[0]?.marketSnapshotId).toBe('snap_lens_1');
    // 判定理由にレンズ類似度と上位レンズが含まれる(説明可能性)
    expect(matches[0]?.reasons?.[0]).toContain('レンズ類似度 86.0%');
    expect(matches[0]?.reasons?.join('\n')).toContain('indicator:rsi:p14');
    // MatchResult 永続化もレンズ値で行われる
    expect(mocks.upsertByNoteAndSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        noteId: note.id,
        marketSnapshotId: 'snap_lens_1',
        symbol: 'USDJPY',
        score: 0.86,
        threshold: 0.75,
      })
    );
    // EvaluationLog も記録される
    expect(mocks.upsertLog).toHaveBeenCalledWith(
      expect.objectContaining({
        noteId: note.id,
        symbol: 'USDJPY',
        timeframe: '15m',
      })
    );
  });

  // ============ Phase α-4: マルチユーザー分離 ============

  it('ノートの userId が MatchResult へ伝播する (Phase α-4 正常系)', async () => {
    const note = createPrismaNote({ userId: 'user-a-uuid' });
    const { service, mocks } = buildLensService(note, {
      activeNotes: 1,
      notesWithSnapshot: 1,
      symbols: 1,
      evaluations: [{ note, timeframe: '15m', comparison: triggeredComparison }],
      errors: [],
    });

    await service.checkForMatches();

    // MatchResult に由来ノートの所有ユーザーが設定される (通知のユーザー分離の起点)
    expect(mocks.upsertByNoteAndSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        noteId: note.id,
        userId: 'user-a-uuid',
      })
    );
  });

  it('Phase 6 以降は必須 userId を MatchResult へ伝播する', async () => {
    const note = createPrismaNote({ userId: 'user-required-uuid' });
    const { service, mocks } = buildLensService(note, {
      activeNotes: 1,
      notesWithSnapshot: 1,
      symbols: 1,
      evaluations: [{ note, timeframe: '15m', comparison: triggeredComparison }],
      errors: [],
    });

    await service.checkForMatches();

    expect(mocks.upsertByNoteAndSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-required-uuid' })
    );
  });

  it('checkForMatches(userId) は所有ノートの取得に userId を渡す (Phase α-4 手動チェック経路)', async () => {
    const note = createPrismaNote({ userId: 'user-a-uuid' });
    const { service, mocks } = buildLensService(note, {
      activeNotes: 1,
      notesWithSnapshot: 1,
      symbols: 1,
      evaluations: [{ note, timeframe: '15m', comparison: triggeredComparison }],
      errors: [],
    });

    await service.checkForMatches('user-a-uuid');

    // HTTP 経路 (手動チェック) では所有ノートのみ評価対象になる (symbolFilter は未指定)
    expect(mocks.loadActiveNotesForMatchingAsPrisma).toHaveBeenCalledWith('user-a-uuid', undefined);
  });

  it('checkForMatches() 引数なし (cron 経路) はユーザー横断でノートを取得する (Phase α-4 異常系防止)', async () => {
    const note = createPrismaNote();
    const { service, mocks } = buildLensService(note, {
      activeNotes: 1,
      notesWithSnapshot: 1,
      symbols: 1,
      evaluations: [{ note, timeframe: '15m', comparison: triggeredComparison }],
      errors: [],
    });

    await service.checkForMatches();

    // cron パイプラインは従来通り全ユーザーのノートを評価する (userId / symbolFilter なし)
    expect(mocks.loadActiveNotesForMatchingAsPrisma).toHaveBeenCalledWith(undefined, undefined);
  });

  it('checkForMatches(undefined, symbol) は DB 側で symbol 絞り込みする (Phase δ-1 リアルタイム)', async () => {
    const note = createPrismaNote({ symbol: 'XAUUSD' });
    const { service, mocks } = buildLensService(note, {
      activeNotes: 1,
      notesWithSnapshot: 1,
      symbols: 1,
      evaluations: [{ note, timeframe: '15m', comparison: triggeredComparison }],
      errors: [],
    });

    await service.checkForMatches(undefined, 'XAUUSD');

    // メモリ filter ではなく DB クエリに symbol を渡す (毎バーの全ノート読み込みを避ける)
    expect(mocks.loadActiveNotesForMatchingAsPrisma).toHaveBeenCalledWith(undefined, 'XAUUSD');
  });

  it('triggered=false の評価は EvaluationLog のみ記録し DTO を返さない(勝率の分母)', async () => {
    const note = createPrismaNote();
    const notTriggered: SnapshotSimilarityResult = {
      ...triggeredComparison,
      score: 0.5,
      level: 'none',
      triggered: false,
    };
    const { service, mocks } = buildLensService(note, {
      activeNotes: 1,
      notesWithSnapshot: 1,
      symbols: 1,
      evaluations: [{ note, timeframe: '15m', comparison: notTriggered }],
      errors: [],
    });

    const matches = await service.checkForMatches();

    expect(matches).toHaveLength(0);
    expect(mocks.upsertLog).toHaveBeenCalledTimes(1);
    expect(mocks.upsertByNoteAndSnapshot).not.toHaveBeenCalled();
  });

  it('比較不能(共通レンズなし)のノートは EvaluationLog も記録せずスキップする', async () => {
    const note = createPrismaNote();
    const notComparable: SnapshotSimilarityResult = {
      comparable: false,
      score: null,
      level: null,
      triggered: false,
      threshold: 0.75,
      preset: 'indicator_focused',
      commonLensCount: 0,
      breakdown: [],
      skipReason: 'no_common_lenses',
    };
    const { service, mocks } = buildLensService(note, {
      activeNotes: 1,
      notesWithSnapshot: 1,
      symbols: 1,
      evaluations: [{ note, timeframe: '15m', comparison: notComparable }],
      errors: [],
    });

    const matches = await service.checkForMatches();

    expect(matches).toHaveLength(0);
    expect(mocks.upsertLog).not.toHaveBeenCalled();
    expect(mocks.upsertByNoteAndSnapshot).not.toHaveBeenCalled();
  });

  it('時間足が異なるノートはグループごとに評価時間足で市場データを取得する', async () => {
    const note15m = createPrismaNote({ id: 'note_lens_15m', timeframe: '15m' });
    const note1h = createPrismaNote({ id: 'note_lens_1h', timeframe: '1h' });
    const { service, mocks } = buildLensService(note15m, {
      activeNotes: 2,
      notesWithSnapshot: 2,
      symbols: 2,
      evaluations: [
        { note: note15m, timeframe: '15m', comparison: triggeredComparison },
        { note: note1h, timeframe: '1h', comparison: triggeredComparison },
      ],
      errors: [],
    });

    const matches = await service.checkForMatches();

    // 1h ノートの市場データが既定 '15m' に固定されず、評価時間足で取得される
    expect(mocks.getCurrentMarketDataWithIndicators).toHaveBeenCalledTimes(2);
    expect(mocks.getCurrentMarketDataWithIndicators).toHaveBeenCalledWith('USDJPY', '15m');
    expect(mocks.getCurrentMarketDataWithIndicators).toHaveBeenCalledWith('USDJPY', '1h');
    expect(matches).toHaveLength(2);
    // EvaluationLog もそれぞれの評価時間足で記録される
    expect(mocks.upsertLog).toHaveBeenCalledWith(
      expect.objectContaining({ noteId: 'note_lens_1h', timeframe: '1h' })
    );
  });

  it('市場データ取得例外は詳細結果の errors / skipReasons に変換される', async () => {
    const note = createPrismaNote();
    const { service, mocks } = buildLensService(note, {
      activeNotes: 1,
      notesWithSnapshot: 1,
      symbols: 1,
      evaluations: [{ note, timeframe: '15m', comparison: triggeredComparison }],
      errors: [],
    });
    mocks.getCurrentMarketDataWithIndicators.mockRejectedValueOnce(new Error('EODHD timeout'));

    const detail = await (
      service as unknown as {
        checkForMatchesDetailed: () => Promise<{
          matches: MatchResultDTO[];
          errors: string[];
          skipReasons: Record<string, number>;
        }>;
      }
    ).checkForMatchesDetailed();

    expect(detail.matches).toHaveLength(0);
    expect(detail.errors[0]).toContain('市場データ取得エラー(lens): symbol=USDJPY, timeframe=15m');
    expect(detail.errors[0]).toContain('EODHD timeout');
    expect(detail.skipReasons).toEqual({ market_data_unavailable: 1 });
  });

});
