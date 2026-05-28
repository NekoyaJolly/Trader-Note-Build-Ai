/**
 * ValidationController のテスト（Phase 4c Step G / Step D-1 で StrategistAgent 廃止）
 *
 * Express の Request/Response を最小実装のスタブで置き換え、
 * validateHypothesis (決定論検証関数) と EdgeLedger をモックして検証する。
 */

import { ValidationController } from '../../controllers/validationController';
import type { Request, Response } from 'express';
import type { EdgeHypothesis } from '../../models/edgeHypothesis';
import type { PromotionVerdict } from '../../services/hypothesisValidationService';

function makeHypothesis(overrides?: Partial<EdgeHypothesis>): EdgeHypothesis {
    return {
        id: 'hyp-api-1',
        statement: 'api test hypothesis',
        category: 'time',
        conditions: [],
        expectedDirection: 'long',
        status: 'screening_passed',
        statusUpdatedAt: new Date('2025-06-01'),
        symbols: ['XAUUSD'],
        timeframes: ['15m'],
        observationCount: 0,
        winCount: 0,
        lossCount: 0,
        breakevenCount: 0,
        totalPnlPips: 0,
        avgRR: 0,
        source: 'ai_generated',
        firstObservedAt: new Date(),
        lastObservedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        materializedTradeNoteIds: ['note-1'],
        ...overrides,
    };
}

function makeReqRes(
    params: Record<string, string> = {},
    query: Record<string, unknown> = {},
) {
    const req = { params, query } as unknown as Request;
    const res: Partial<Response> & { statusCode: number; body: unknown } = {
        statusCode: 200,
        body: undefined,
    };
    res.status = jest.fn().mockImplementation((code: number) => {
        res.statusCode = code;
        return res;
    });
    res.json = jest.fn().mockImplementation((payload: unknown) => {
        res.body = payload;
        return res;
    });
    return { req, res: res as Response & { statusCode: number; body: unknown } };
}

describe('ValidationController.validate', () => {
    it('verdict=confirmed を返す', async () => {
        const validateFn = jest.fn<Promise<PromotionVerdict>, [string]>().mockResolvedValue({
            verdict: 'confirmed',
            hypothesisId: 'hyp-api-1',
            baseCriteriaReasons: [],
            decidedAt: new Date('2026-01-01'),
        });
        const ledger = { get: jest.fn(), findByStatus: jest.fn() };
         
        const ctrl = new ValidationController(ledger as any, validateFn as any);
        const { req, res } = makeReqRes({ id: 'hyp-api-1' });

        await ctrl.validate(req, res);

        expect(res.statusCode).toBe(200);
        expect(validateFn).toHaveBeenCalledWith('hyp-api-1');
        const body = res.body as Record<string, unknown>;
        expect(body.success).toBe(true);
        expect(body.verdict).toBe('confirmed');
    });

    it('not found は 404', async () => {
        const validateFn = jest
            .fn()
            .mockRejectedValue(new Error('Hypothesis not found: hyp-missing'));
        const ledger = { get: jest.fn(), findByStatus: jest.fn() };
         
        const ctrl = new ValidationController(ledger as any, validateFn as any);
        const { req, res } = makeReqRes({ id: 'hyp-missing' });

        await ctrl.validate(req, res);

        expect(res.statusCode).toBe(404);
        const body = res.body as Record<string, unknown>;
        expect(body.success).toBe(false);
        expect(body.error).toContain('not found');
    });

    it('その他の例外は 500', async () => {
        const validateFn = jest.fn().mockRejectedValue(new Error('python container down'));
        const ledger = { get: jest.fn(), findByStatus: jest.fn() };
         
        const ctrl = new ValidationController(ledger as any, validateFn as any);
        const { req, res } = makeReqRes({ id: 'hyp-api-1' });

        await ctrl.validate(req, res);

        expect(res.statusCode).toBe(500);
    });

    it('id が欠落していれば 400', async () => {
        const validateFn = jest.fn();
        const ledger = { get: jest.fn(), findByStatus: jest.fn() };
         
        const ctrl = new ValidationController(ledger as any, validateFn as any);
        const { req, res } = makeReqRes({});

        await ctrl.validate(req, res);

        expect(res.statusCode).toBe(400);
        expect(validateFn).not.toHaveBeenCalled();
    });
});

describe('ValidationController.getValidationStatus', () => {
    it('存在する仮説のステータスを返す', async () => {
        const hyp = makeHypothesis({
            status: 'confirmed',
            fullValidationReport: {
                hypothesisId: 'hyp-api-1',
                periodUsed: { start: '2025-01-01', end: '2025-12-31' },
                allPassed: true,
                passedCount: 4,
                totalCount: 4,
                startedAt: '2026-01-01T00:00:00Z',
                completedAt: '2026-01-01T00:00:10Z',
                totalDurationMs: 10000,
                errors: [],
            },
            confirmationInterpretation: '優秀なパターン',
            actionableInsights: ['横展開検討'],
        });
        const ledger = {
            get: jest.fn().mockResolvedValue(hyp),
            findByStatus: jest.fn(),
        };
         
        const ctrl = new ValidationController(ledger as any);
        const { req, res } = makeReqRes({ id: 'hyp-api-1' });

        await ctrl.getValidationStatus(req, res);

        expect(res.statusCode).toBe(200);
        const body = res.body as Record<string, unknown>;
        expect(body.success).toBe(true);
        expect(body.status).toBe('confirmed');
        expect(body.confirmationInterpretation).toBe('優秀なパターン');
        expect(body.actionableInsights).toEqual(['横展開検討']);
    });

    it('存在しない仮説は 404', async () => {
        const ledger = {
            get: jest.fn().mockResolvedValue(null),
            findByStatus: jest.fn(),
        };
         
        const ctrl = new ValidationController(ledger as any);
        const { req, res } = makeReqRes({ id: 'hyp-missing' });

        await ctrl.getValidationStatus(req, res);

        expect(res.statusCode).toBe(404);
    });

    it('ledger が throw したら 500', async () => {
        const ledger = {
            get: jest.fn().mockRejectedValue(new Error('db down')),
            findByStatus: jest.fn(),
        };
         
        const ctrl = new ValidationController(ledger as any);
        const { req, res } = makeReqRes({ id: 'hyp-api-1' });

        await ctrl.getValidationStatus(req, res);
        expect(res.statusCode).toBe(500);
    });
});

describe('ValidationController.listPendingValidation', () => {
    it('screening_passed 一覧を返す', async () => {
        const hyps = [
            makeHypothesis({ id: 'h1' }),
            makeHypothesis({ id: 'h2', symbols: ['USDJPY'] }),
        ];
        const ledger = {
            get: jest.fn(),
            findByStatus: jest.fn().mockResolvedValue(hyps),
        };
         
        const ctrl = new ValidationController(ledger as any);
        const { req, res } = makeReqRes({});

        await ctrl.listPendingValidation(req, res);

        expect(ledger.findByStatus).toHaveBeenCalledWith('screening_passed');
        expect(res.statusCode).toBe(200);
        const body = res.body as { total: number; hypotheses: Array<{ id: string }> };
        expect(body.total).toBe(2);
        expect(body.hypotheses.map((h) => h.id)).toEqual(['h1', 'h2']);
    });

    it('空配列でも 200 で total=0', async () => {
        const ledger = {
            get: jest.fn(),
            findByStatus: jest.fn().mockResolvedValue([]),
        };
         
        const ctrl = new ValidationController(ledger as any);
        const { req, res } = makeReqRes({});

        await ctrl.listPendingValidation(req, res);

        expect(res.statusCode).toBe(200);
        const body = res.body as { total: number };
        expect(body.total).toBe(0);
    });

    it('ledger が throw したら 500', async () => {
        const ledger = {
            get: jest.fn(),
            findByStatus: jest.fn().mockRejectedValue(new Error('db error')),
        };
         
        const ctrl = new ValidationController(ledger as any);
        const { req, res } = makeReqRes({});

        await ctrl.listPendingValidation(req, res);
        expect(res.statusCode).toBe(500);
    });
});

// ===========================================
// Phase 4d Step 3: listHypotheses
// ===========================================

describe('ValidationController.listHypotheses', () => {
    function buildController(findResult: {
        hypotheses?: EdgeHypothesis[];
        total?: number;
        page?: number;
        limit?: number;
    } = {}) {
        const findMock = jest.fn().mockResolvedValue({
            hypotheses: findResult.hypotheses ?? [],
            total: findResult.total ?? 0,
            page: findResult.page ?? 1,
            limit: findResult.limit ?? 20,
        });
        const ledger = { get: jest.fn(), findByStatus: jest.fn(), find: findMock };

        const ctrl = new ValidationController(ledger as any);
        return { ctrl, ledger, findMock };
    }

    it('クエリ無しで既定フィルタ (全件、newest、page=1、limit=20) を渡す', async () => {
        const { ctrl, findMock } = buildController();
        const { req, res } = makeReqRes({}, {});

        await ctrl.listHypotheses(req, res);

        expect(res.statusCode).toBe(200);
        expect(findMock).toHaveBeenCalledWith({
            statuses: undefined,
            categories: undefined,
            sources: undefined,
            symbols: undefined,
            search: undefined,
            sortBy: 'newest',
            page: 1,
            limit: 20,
        });
        const body = res.body as Record<string, unknown>;
        expect(body.success).toBe(true);
        expect(body.total).toBe(0);
        expect(body.page).toBe(1);
        expect(body.limit).toBe(20);
    });

    it('カンマ区切りの status を配列に分解し、未知値は無視する', async () => {
        const { ctrl, findMock } = buildController();
        const { req, res } = makeReqRes({}, {
            status: 'confirmed,rejected,bogus,screening_passed',
        });

        await ctrl.listHypotheses(req, res);

        expect(findMock).toHaveBeenCalledWith(expect.objectContaining({
            statuses: ['confirmed', 'rejected', 'screening_passed'],
        }));
    });

    it('配列形式の status でも正しく受け取れる', async () => {
        const { ctrl, findMock } = buildController();
        const { req, res } = makeReqRes({}, { status: ['confirmed', 'testing'] });

        await ctrl.listHypotheses(req, res);

        expect(findMock).toHaveBeenCalledWith(expect.objectContaining({
            statuses: ['confirmed', 'testing'],
        }));
    });

    it('全て未知 status が指定された場合は undefined になる（= 全件）', async () => {
        const { ctrl, findMock } = buildController();
        const { req, res } = makeReqRes({}, { status: 'bogus,unknown' });

        await ctrl.listHypotheses(req, res);

        expect(findMock).toHaveBeenCalledWith(expect.objectContaining({
            statuses: undefined,
        }));
    });

    it('category / source / symbol / search がそのまま渡る', async () => {
        const { ctrl, findMock } = buildController();
        const { req, res } = makeReqRes({}, {
            category: 'time,volatility',
            source: 'ai_generated',
            symbol: 'XAU/USD,EUR/USD',
            search: '  ロンドン  ',
        });

        await ctrl.listHypotheses(req, res);

        expect(findMock).toHaveBeenCalledWith(expect.objectContaining({
            categories: ['time', 'volatility'],
            sources: ['ai_generated'],
            symbols: ['XAU/USD', 'EUR/USD'],
            search: '  ロンドン  ', // trim は find 側の責務
        }));
    });

    it('sortBy は許可値のみ採用、それ以外は newest にフォールバック', async () => {
        const { ctrl, findMock } = buildController();

        for (const [input, expected] of [
            ['newest', 'newest'],
            ['oldest', 'oldest'],
            ['observation', 'observation'],
            ['confidence', 'newest'], // 未実装キー
            ['garbage', 'newest'],
        ] as const) {
            findMock.mockClear();
            const { req, res } = makeReqRes({}, { sortBy: input });
            await ctrl.listHypotheses(req, res);
            expect(findMock).toHaveBeenCalledWith(expect.objectContaining({ sortBy: expected }));
        }
    });

    it('page / limit を数値に変換、不正値は既定値', async () => {
        const { ctrl, findMock } = buildController();

        findMock.mockClear();
        const { req: r1, res: s1 } = makeReqRes({}, { page: '3', limit: '50' });
        await ctrl.listHypotheses(r1, s1);
        expect(findMock).toHaveBeenCalledWith(expect.objectContaining({ page: 3, limit: 50 }));

        findMock.mockClear();
        const { req: r2, res: s2 } = makeReqRes({}, { page: 'abc', limit: '-5' });
        await ctrl.listHypotheses(r2, s2);
        expect(findMock).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 }));
    });

    it('ledger が正常終了時はレスポンスに hypotheses / total / page / limit が含まれる', async () => {
        const hyp = {
            id: 'h1',
            statement: 'test',
            category: 'time',
            conditions: [],
            expectedDirection: 'long',
            status: 'confirmed',
            statusUpdatedAt: new Date(),
            symbols: ['XAU/USD'],
            timeframes: ['15m'],
            observationCount: 5,
            winCount: 3,
            lossCount: 2,
            breakevenCount: 0,
            totalPnlPips: 100,
            avgRR: 1.5,
            source: 'ai_generated',
            firstObservedAt: new Date(),
            lastObservedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
        } as unknown as EdgeHypothesis;

        const { ctrl } = buildController({
            hypotheses: [hyp],
            total: 1,
            page: 1,
            limit: 20,
        });
        const { req, res } = makeReqRes({}, {});

        await ctrl.listHypotheses(req, res);

        expect(res.statusCode).toBe(200);
        const body = res.body as { hypotheses: EdgeHypothesis[]; total: number; page: number; limit: number };
        expect(body.hypotheses).toHaveLength(1);
        expect(body.total).toBe(1);
        expect(body.page).toBe(1);
        expect(body.limit).toBe(20);
    });

    it('find が throw したら 500', async () => {
        const findMock = jest.fn().mockRejectedValue(new Error('db error'));
        const ledger = { get: jest.fn(), findByStatus: jest.fn(), find: findMock };
         
        const ctrl = new ValidationController(ledger as any);
        const { req, res } = makeReqRes({}, {});

        await ctrl.listHypotheses(req, res);
        expect(res.statusCode).toBe(500);
        expect((res.body as { success: boolean }).success).toBe(false);
    });
});

// ===========================================
// Phase 4d Step 4: getHypothesis / getValidationHistory
// ===========================================

describe('ValidationController.getHypothesis', () => {
    it('存在する仮説を `{ success, hypothesis }` 形式で返す', async () => {
        const hyp = makeHypothesis({ id: 'hyp-detail-1' });
        const ledger = {
            get: jest.fn().mockResolvedValue(hyp),
            findByStatus: jest.fn(),
        };
         
        const ctrl = new ValidationController(ledger as any);
        const { req, res } = makeReqRes({ id: 'hyp-detail-1' });

        await ctrl.getHypothesis(req, res);

        expect(res.statusCode).toBe(200);
        const body = res.body as { success: boolean; hypothesis: EdgeHypothesis };
        expect(body.success).toBe(true);
        expect(body.hypothesis.id).toBe('hyp-detail-1');
        expect(ledger.get).toHaveBeenCalledWith('hyp-detail-1');
    });

    it('存在しない仮説は 404', async () => {
        const ledger = {
            get: jest.fn().mockResolvedValue(null),
            findByStatus: jest.fn(),
        };
         
        const ctrl = new ValidationController(ledger as any);
        const { req, res } = makeReqRes({ id: 'hyp-missing' });

        await ctrl.getHypothesis(req, res);
        expect(res.statusCode).toBe(404);
        expect((res.body as { success: boolean }).success).toBe(false);
    });

    it('id が欠落していれば 400', async () => {
        const ledger = { get: jest.fn(), findByStatus: jest.fn() };
         
        const ctrl = new ValidationController(ledger as any);
        const { req, res } = makeReqRes({});

        await ctrl.getHypothesis(req, res);
        expect(res.statusCode).toBe(400);
        expect(ledger.get).not.toHaveBeenCalled();
    });

    it('ledger が throw したら 500', async () => {
        const ledger = {
            get: jest.fn().mockRejectedValue(new Error('db error')),
            findByStatus: jest.fn(),
        };
         
        const ctrl = new ValidationController(ledger as any);
        const { req, res } = makeReqRes({ id: 'hyp-1' });

        await ctrl.getHypothesis(req, res);
        expect(res.statusCode).toBe(500);
    });
});

describe('ValidationController.getValidationHistory', () => {
    it('screeningResult のみがある場合、screening エントリ 1 件だけを返す', async () => {
        const hyp = makeHypothesis({
            screeningResult: {
                executedAt: '2026-01-15T10:00:00Z',
                tradeNoteId: 'note-1',
                passed: true,
                metrics: { pf: 1.8, winRate: 0.55, tradeCount: 30 },
            },
        });
        const ledger = {
            get: jest.fn().mockResolvedValue(hyp),
            findByStatus: jest.fn(),
        };
         
        const ctrl = new ValidationController(ledger as any);
        const { req, res } = makeReqRes({ id: 'hyp-api-1' });

        await ctrl.getValidationHistory(req, res);

        expect(res.statusCode).toBe(200);
        const body = res.body as { success: boolean; history: Array<Record<string, unknown>> };
        expect(body.success).toBe(true);
        expect(body.history).toHaveLength(1);
        expect(body.history[0].type).toBe('screening');
        expect(body.history[0].passed).toBe(true);
        expect(body.history[0].executedAt).toBe('2026-01-15T10:00:00Z');
    });

    it('screeningResult も fullValidationReport も無ければ history は空配列', async () => {
        const hyp = makeHypothesis();
        const ledger = {
            get: jest.fn().mockResolvedValue(hyp),
            findByStatus: jest.fn(),
        };
         
        const ctrl = new ValidationController(ledger as any);
        const { req, res } = makeReqRes({ id: 'hyp-api-1' });

        await ctrl.getValidationHistory(req, res);

        expect(res.statusCode).toBe(200);
        const body = res.body as { history: unknown[] };
        expect(body.history).toEqual([]);
    });

    it('両方ある場合は full_validation / screening を新しい順に並べる', async () => {
        const hyp = makeHypothesis({
            screeningResult: {
                executedAt: '2026-01-15T10:00:00Z',
                tradeNoteId: 'note-1',
                passed: true,
                metrics: { pf: 1.8, winRate: 0.55, tradeCount: 30 },
            },
            fullValidationReport: {
                hypothesisId: 'hyp-api-1',
                periodUsed: { start: '2025-01-01', end: '2025-12-31' },
                allPassed: false,
                passedCount: 3,
                totalCount: 4,
                startedAt: '2026-02-01T00:00:00Z',
                completedAt: '2026-02-01T00:00:10Z',
                totalDurationMs: 10000,
                errors: [],
            },
        });
        const ledger = {
            get: jest.fn().mockResolvedValue(hyp),
            findByStatus: jest.fn(),
        };
         
        const ctrl = new ValidationController(ledger as any);
        const { req, res } = makeReqRes({ id: 'hyp-api-1' });

        await ctrl.getValidationHistory(req, res);

        const body = res.body as { history: Array<{ type: string; executedAt: string }> };
        expect(body.history).toHaveLength(2);
        // completedAt が screening.executedAt より新しいので full_validation が先
        expect(body.history[0].type).toBe('full_validation');
        expect(body.history[1].type).toBe('screening');
    });

    it('存在しない仮説は 404', async () => {
        const ledger = {
            get: jest.fn().mockResolvedValue(null),
            findByStatus: jest.fn(),
        };
         
        const ctrl = new ValidationController(ledger as any);
        const { req, res } = makeReqRes({ id: 'hyp-missing' });

        await ctrl.getValidationHistory(req, res);
        expect(res.statusCode).toBe(404);
    });

    it('id が欠落していれば 400', async () => {
        const ledger = { get: jest.fn(), findByStatus: jest.fn() };
         
        const ctrl = new ValidationController(ledger as any);
        const { req, res } = makeReqRes({});

        await ctrl.getValidationHistory(req, res);
        expect(res.statusCode).toBe(400);
    });
});
