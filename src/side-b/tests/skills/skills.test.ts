/**
 * 個別スキルのテスト (Phase 5.5 MVP 8スキル)
 *
 * 各スキルは既存の決定論ロジック(EdgeLedger / ScreeningOrchestrator 等)を
 * ラップする薄い層なので、本テストでは
 *   (1) 入力が依存関数へ正しく渡ること
 *   (2) 依存の出力がそのまま返ること
 *   (3) Zod バリデーションが効くこと
 * を確認する。実ロジックのテストは既存の各レイヤーのテストが担当する。
 */

import { createQueryEdgeLedgerSkill } from '../../skills/ledger/queryEdgeLedger';
import { createGetHypothesisSkill } from '../../skills/ledger/getHypothesis';
import { createRegisterHypothesisSkill } from '../../skills/ledger/registerHypothesis';
import { createRunScreeningSkill } from '../../skills/validation/runScreening';
import { createRunFullValidationSkill } from '../../skills/validation/runFullValidation';
import type { validateHypothesis } from '../../services/hypothesisValidationService';
import { createReadRecentNotesSkill } from '../../skills/notes/readRecentNotes';
import { createRecordLessonSkill } from '../../skills/notes/recordLesson';
import { createComputeLensFeaturesSkill } from '../../skills/lens/computeLensFeatures';

import type { EdgeLedger } from '../../ledger/EdgeLedger';
import type { ScreeningOrchestrator } from '../../bridge/ScreeningOrchestrator';
import type { AgentMemory } from '../../agent/agentMemory';

// ヘルパー: 最小限のコンテキスト
const ctx = { timestamp: new Date('2026-04-21T00:00:00Z') };

// ===========================================
// ledger 系
// ===========================================

describe('query_edge_ledger', () => {
  it('EdgeLedger.find に入力をそのまま渡し、結果を返す', async () => {
    const find = jest.fn().mockResolvedValue({
      hypotheses: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    const mockLedger = { find } as unknown as EdgeLedger;
    const skill = createQueryEdgeLedgerSkill(mockLedger);

    const out = await skill.execute(
      { statuses: ['unverified'], limit: 10 },
      ctx,
    );

    expect(find).toHaveBeenCalledWith({ statuses: ['unverified'], limit: 10 });
    expect(out.total).toBe(0);
  });

  it('空入力でも全件取得(= ledger.find({})) を呼び出せる', async () => {
    const find = jest.fn().mockResolvedValue({
      hypotheses: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    const skill = createQueryEdgeLedgerSkill({ find } as unknown as EdgeLedger);
    await skill.execute({}, ctx);
    expect(find).toHaveBeenCalledWith({});
  });

  it('無効な status 値は Zod で弾かれる', async () => {
    const skill = createQueryEdgeLedgerSkill({
      find: jest.fn(),
    } as unknown as EdgeLedger);
    await expect(
      skill.execute({ statuses: ['not_a_real_status'] } as never, ctx),
    ).rejects.toThrow();
  });
});

describe('get_hypothesis', () => {
  it('id を渡して ledger.get を呼び、結果を返す', async () => {
    const get = jest.fn().mockResolvedValue({ id: 'abc', statement: 'x' });
    const skill = createGetHypothesisSkill({ get } as unknown as EdgeLedger);
    const out = await skill.execute({ id: 'abc' }, ctx);
    expect(get).toHaveBeenCalledWith('abc');
    expect(out).toEqual({ id: 'abc', statement: 'x' });
  });

  it('空 id は Zod で弾かれる', async () => {
    const skill = createGetHypothesisSkill({
      get: jest.fn(),
    } as unknown as EdgeLedger);
    await expect(skill.execute({ id: '' }, ctx)).rejects.toThrow();
  });
});

describe('register_hypothesis', () => {
  it('必須フィールドで ledger.create を呼び、unverified 状態で登録する', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'new-1' });
    const skill = createRegisterHypothesisSkill({
      create,
    } as unknown as EdgeLedger);

    await skill.execute(
      {
        statement: 'test hypothesis',
        category: 'time',
        conditions: [
          { lensName: 'time_session', featureKey: 'session', op: '==', value: 'asia' },
        ],
        expectedDirection: 'long',
        symbols: ['XAUUSD'],
        timeframes: ['15m'],
        source: 'discovery',
      },
      ctx,
    );

    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0]![0] as { status: string; observationCount: number };
    expect(arg.status).toBe('unverified');
    expect(arg.observationCount).toBe(0);
  });

  it('conditions が空配列は Zod で弾かれる', async () => {
    const skill = createRegisterHypothesisSkill({
      create: jest.fn(),
    } as unknown as EdgeLedger);
    await expect(
      skill.execute(
        {
          statement: 's',
          category: 'time',
          conditions: [],
          expectedDirection: 'long',
          symbols: ['X'],
          timeframes: ['15m'],
          source: 'discovery',
        },
        ctx,
      ),
    ).rejects.toThrow();
  });
});

// ===========================================
// validation 系
// ===========================================

describe('run_screening', () => {
  it('ScreeningOrchestrator.runScreening に hypothesisId と options を渡す', async () => {
    const runScreening = jest.fn().mockResolvedValue({
      hypothesisId: 'h1',
      verdict: 'screening_passed',
      tradeNoteId: 'note-1',
      metrics: { pf: 2, winRate: 0.6, tradeCount: 50 },
      backtestRunId: 'bt-1',
    });
    const skill = createRunScreeningSkill({
      runScreening,
    } as unknown as ScreeningOrchestrator);

    await skill.execute(
      {
        hypothesisId: 'h1',
        period: { start: '2025-01-01', end: '2025-06-30' },
        force: true,
      },
      ctx,
    );

    expect(runScreening).toHaveBeenCalledWith('h1', {
      period: { start: '2025-01-01', end: '2025-06-30' },
      matchThreshold: undefined,
      force: true,
    });
  });
});

describe('run_full_validation', () => {
  it('validateHypothesis に hypothesisId と period を渡す', async () => {
    const validateFn = jest.fn() as jest.MockedFunction<typeof validateHypothesis>;
    validateFn.mockResolvedValue({
      verdict: 'confirmed',
      hypothesisId: 'h1',
      baseCriteriaReasons: [],
      decidedAt: new Date(),
    });

    const skill = createRunFullValidationSkill(validateFn);

    await skill.execute({ hypothesisId: 'h1' }, ctx);

    expect(validateFn).toHaveBeenCalledWith('h1', { period: undefined });
  });
});

// ===========================================
// notes 系
// ===========================================

describe('read_recent_notes', () => {
  it('symbol 指定時は findBySymbol を使う', async () => {
    const findBySymbol = jest.fn().mockResolvedValue([{ id: 'n1' }]);
    const findRecent = jest.fn();
    const skill = createReadRecentNotesSkill({ findRecent, findBySymbol });
    const out = await skill.execute({ symbol: 'XAUUSD', limit: 10 }, ctx);
    expect(findBySymbol).toHaveBeenCalledWith('XAUUSD', 10);
    expect(findRecent).not.toHaveBeenCalled();
    expect(out).toEqual([{ id: 'n1' }]);
  });

  it('symbol 省略時は findRecent を使う', async () => {
    const findBySymbol = jest.fn();
    const findRecent = jest.fn().mockResolvedValue([]);
    const skill = createReadRecentNotesSkill({ findRecent, findBySymbol });
    await skill.execute({}, ctx);
    expect(findRecent).toHaveBeenCalledWith(50);
    expect(findBySymbol).not.toHaveBeenCalled();
  });
});

describe('record_lesson', () => {
  it('AgentMemory.addLesson に metadata(source / linkedNoteIds / linkedHypothesisIds) を渡す', async () => {
    const addLesson = jest.fn().mockResolvedValue(undefined);
    const skill = createRecordLessonSkill({ addLesson } as unknown as AgentMemory);

    await skill.execute(
      {
        lesson: '焦って入った',
        symbol: 'XAUUSD',
        tradeId: 't1',
        source: 'reflection',
        linkedNoteIds: ['n1'],
        linkedHypothesisIds: ['h1'],
      },
      ctx,
    );

    expect(addLesson).toHaveBeenCalledWith('焦って入った', 'XAUUSD', 't1', {
      source: 'reflection',
      linkedNoteIds: ['n1'],
      linkedHypothesisIds: ['h1'],
    });
  });

  it('メタデータ未指定時は metadata=undefined で addLesson を呼ぶ', async () => {
    const addLesson = jest.fn().mockResolvedValue(undefined);
    const skill = createRecordLessonSkill({ addLesson } as unknown as AgentMemory);

    await skill.execute({ lesson: 'x', symbol: 'XAUUSD' }, ctx);

    expect(addLesson).toHaveBeenCalledWith('x', 'XAUUSD', undefined, undefined);
  });

  it('不正な source 値は Zod で弾かれる', async () => {
    const addLesson = jest.fn();
    const skill = createRecordLessonSkill({ addLesson } as unknown as AgentMemory);
    await expect(
      skill.execute(
        { lesson: 'x', symbol: 'XAUUSD', source: 'invalid' } as never,
        ctx,
      ),
    ).rejects.toThrow();
    expect(addLesson).not.toHaveBeenCalled();
  });
});

// ===========================================
// lens 系
// ===========================================

describe('compute_lens_features', () => {
  it('fetchOhlcv で取得したバーをレンズ集約に渡し、シリアライズ結果を返す', async () => {
    const fetchOhlcv = jest.fn().mockResolvedValue([
      {
        symbol: 'XAUUSD',
        timeframe: '15m',
        timestamp: new Date('2026-04-21T00:00:00Z'),
        open: 2300,
        high: 2310,
        low: 2295,
        close: 2305,
        volume: 100,
      },
    ]);
    const skill = createComputeLensFeaturesSkill({ fetchOhlcv });

    const out = await skill.execute(
      { symbol: 'XAUUSD', timeframe: '15m', barCount: 50 },
      ctx,
    );

    expect(fetchOhlcv).toHaveBeenCalledWith('XAUUSD', '15m', 50);
    expect(out.symbol).toBe('XAUUSD');
    expect(typeof out.timestamp).toBe('string');
    expect(out.features).toBeDefined();
  });

  it('timestamp 指定時は LensInput.timestamp に反映される', async () => {
    const fetchOhlcv = jest.fn().mockResolvedValue([]);
    const skill = createComputeLensFeaturesSkill({ fetchOhlcv });
    const iso = '2025-12-01T10:00:00.000Z';
    const out = await skill.execute(
      { symbol: 'XAUUSD', timeframe: '15m', timestamp: iso },
      ctx,
    );
    expect(new Date(out.timestamp).toISOString()).toBe(iso);
  });

  it('lenses フィルタで出力を絞り込む', async () => {
    const fetchOhlcv = jest.fn().mockResolvedValue([]);
    const skill = createComputeLensFeaturesSkill({ fetchOhlcv });
    // 存在しないレンズ名でフィルタ → 結果は空の features
    const out = await skill.execute(
      { symbol: 'XAUUSD', timeframe: '15m', lenses: ['__nonexistent__'] },
      ctx,
    );
    expect(Object.keys(out.features)).toEqual([]);
  });
});
