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
    const createSideAMatch = (): MatchResultDTO => ({
      id: 'match_test_a1',
      matchScore: 0.88,
      historicalNoteId: 'note_side_a_1',
      marketSnapshot: {},
      marketSnapshotId: 'snap_a1',
      symbol: 'USDJPY',
      reasons: ['価格帯一致'],
      evaluatedAt: new Date(),
    });

    // control は対象ノートをそのまま通知対象に通すモック
    const buildHitControl = (): SimultaneousHitControlService => {
      const hitControl = new SimultaneousHitControlService();
      jest
        .spyOn(hitControl, 'control')
        .mockImplementation(async (hits) => ({
          toNotify: hits,
          toSkip: [],
          groupedBySymbol: new Map(),
        }));
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
      jest
        .spyOn(pipeline, 'checkForAllMatches')
        .mockResolvedValue([createSideBMatch()]);

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
      jest
        .spyOn(pipeline, 'checkForAllMatches')
        .mockResolvedValue([createSideAMatch()]);

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
      jest
        .spyOn(pipeline, 'checkForAllMatches')
        .mockResolvedValue([createSideAMatch()]);

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
      jest
        .spyOn(pipeline, 'checkForAllMatches')
        .mockResolvedValue([{ ...createSideAMatch(), marketSnapshotId: '' }]);

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
      jest
        .spyOn(pipeline, 'checkForAllMatches')
        .mockResolvedValue([createSideAMatch()]);

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

    // ============================================================
    // レンズ類似度シャドー評価 (Phase α-2、NOTE_SIMILARITY_FOUNDATION.md §9-2)
    // ============================================================
    describe('レンズシャドー評価の配線', () => {
      const originalShadowEnv = process.env.LENS_SHADOW_EVALUATION;
      afterEach(() => {
        process.env.LENS_SHADOW_EVALUATION = originalShadowEnv;
      });

      const shadowSummary = {
        activeNotes: 2,
        notesWithSnapshot: 1,
        comparable: 1,
        triggered: 0,
        symbols: 1,
        averageScore: 0.62,
        errors: [],
      };

      it('シャドー評価のサマリーが結果に additive に含まれる(マッチ 0 件でも実行される)', async () => {
        process.env.LENS_SHADOW_EVALUATION = 'true';
        const shadowEvaluateActiveNotes = jest
          .fn<() => Promise<typeof shadowSummary>>()
          .mockResolvedValue(shadowSummary);
        const runRepo = buildRunRepo();
        const pipeline = new MatchingService({
          matchingPipelineRunRepository: runRepo,
          lensNoteCoreService: { shadowEvaluateActiveNotes },
        });
        jest.spyOn(pipeline, 'checkForAllMatches').mockResolvedValue([]);

        const result = await pipeline.runMatchingPipeline({ trigger: 'manual_test' });

        // 旧マッチングが 0 件でもシャドー評価は走る(レンズ基盤の観測が目的のため)
        expect(shadowEvaluateActiveNotes).toHaveBeenCalledTimes(1);
        expect(result.lensShadow).toEqual(shadowSummary);
        expect(result.status).toBe('success');
      });

      it('シャドー評価の失敗はパイプラインの成否に影響しない', async () => {
        process.env.LENS_SHADOW_EVALUATION = 'true';
        const shadowEvaluateActiveNotes = jest
          .fn<() => Promise<typeof shadowSummary>>()
          .mockRejectedValue(new Error('shadow down'));
        const pipeline = new MatchingService({
          matchingPipelineRunRepository: buildRunRepo(),
          lensNoteCoreService: { shadowEvaluateActiveNotes },
        });
        jest.spyOn(pipeline, 'checkForAllMatches').mockResolvedValue([]);

        const result = await pipeline.runMatchingPipeline();

        expect(result.status).toBe('success');
        expect(result.errors).toEqual([]);
        expect(result.lensShadow).toBeUndefined();
      });

      it('LENS_SHADOW_EVALUATION=false で無効化できる', async () => {
        process.env.LENS_SHADOW_EVALUATION = 'false';
        const shadowEvaluateActiveNotes = jest
          .fn<() => Promise<typeof shadowSummary>>()
          .mockResolvedValue(shadowSummary);
        const pipeline = new MatchingService({
          matchingPipelineRunRepository: buildRunRepo(),
          lensNoteCoreService: { shadowEvaluateActiveNotes },
        });
        jest.spyOn(pipeline, 'checkForAllMatches').mockResolvedValue([]);

        const result = await pipeline.runMatchingPipeline();

        expect(shadowEvaluateActiveNotes).not.toHaveBeenCalled();
        expect(result.lensShadow).toBeUndefined();
      });
    });
  });
});
