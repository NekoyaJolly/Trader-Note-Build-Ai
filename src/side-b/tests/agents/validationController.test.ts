/**
 * ValidationController のテスト（Phase 4c Step G）
 *
 * Express の Request/Response を最小実装のスタブで置き換え、
 * StrategistAgent と EdgeLedger をモックして 3 エンドポイントを検証する。
 */

import { ValidationController } from '../../controllers/validationController';
import type { Request, Response } from 'express';
import type { EdgeHypothesis } from '../../models/edgeHypothesis';
import type { PromotionVerdict } from '../../agents/StrategistAgent';

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

function makeReqRes(params: Record<string, string> = {}) {
    const req = { params } as unknown as Request;
    const res: Partial<Response> & { statusCode: number; body: unknown } = {
        statusCode: 200,
        body: undefined,
    };
    res.status = jest.fn().mockImplementation((code: number) => {
        res.statusCode = code;
        return res;
    }) as unknown as Response['status'];
    res.json = jest.fn().mockImplementation((payload: unknown) => {
        res.body = payload;
        return res;
    }) as unknown as Response['json'];
    return { req, res: res as Response & { statusCode: number; body: unknown } };
}

describe('ValidationController.validate', () => {
    it('verdict=confirmed を返す', async () => {
        const strategist = {
            validate: jest.fn<Promise<PromotionVerdict>, [string]>().mockResolvedValue({
                verdict: 'confirmed',
                hypothesisId: 'hyp-api-1',
                baseCriteriaReasons: [],
                interpretation: '全ツール通過',
                actionableInsights: [],
                decidedAt: new Date('2026-01-01'),
            }),
        };
        const ledger = { get: jest.fn(), findByStatus: jest.fn() };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctrl = new ValidationController(ledger as any, strategist as any);
        const { req, res } = makeReqRes({ id: 'hyp-api-1' });

        await ctrl.validate(req, res);

        expect(res.statusCode).toBe(200);
        expect(strategist.validate).toHaveBeenCalledWith('hyp-api-1');
        const body = res.body as Record<string, unknown>;
        expect(body.success).toBe(true);
        expect(body.verdict).toBe('confirmed');
        expect(body.interpretation).toBe('全ツール通過');
    });

    it('not found は 404', async () => {
        const strategist = {
            validate: jest.fn().mockRejectedValue(new Error('Hypothesis not found: hyp-missing')),
        };
        const ledger = { get: jest.fn(), findByStatus: jest.fn() };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctrl = new ValidationController(ledger as any, strategist as any);
        const { req, res } = makeReqRes({ id: 'hyp-missing' });

        await ctrl.validate(req, res);

        expect(res.statusCode).toBe(404);
        const body = res.body as Record<string, unknown>;
        expect(body.success).toBe(false);
        expect(body.error).toContain('not found');
    });

    it('その他の例外は 500', async () => {
        const strategist = {
            validate: jest.fn().mockRejectedValue(new Error('python container down')),
        };
        const ledger = { get: jest.fn(), findByStatus: jest.fn() };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctrl = new ValidationController(ledger as any, strategist as any);
        const { req, res } = makeReqRes({ id: 'hyp-api-1' });

        await ctrl.validate(req, res);

        expect(res.statusCode).toBe(500);
    });

    it('id が欠落していれば 400', async () => {
        const strategist = { validate: jest.fn() };
        const ledger = { get: jest.fn(), findByStatus: jest.fn() };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctrl = new ValidationController(ledger as any, strategist as any);
        const { req, res } = makeReqRes({});

        await ctrl.validate(req, res);

        expect(res.statusCode).toBe(400);
        expect(strategist.validate).not.toHaveBeenCalled();
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
        const strategist = { validate: jest.fn() };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctrl = new ValidationController(ledger as any, strategist as any);
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
        const strategist = { validate: jest.fn() };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctrl = new ValidationController(ledger as any, strategist as any);
        const { req, res } = makeReqRes({ id: 'hyp-missing' });

        await ctrl.getValidationStatus(req, res);

        expect(res.statusCode).toBe(404);
    });

    it('ledger が throw したら 500', async () => {
        const ledger = {
            get: jest.fn().mockRejectedValue(new Error('db down')),
            findByStatus: jest.fn(),
        };
        const strategist = { validate: jest.fn() };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctrl = new ValidationController(ledger as any, strategist as any);
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
        const strategist = { validate: jest.fn() };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctrl = new ValidationController(ledger as any, strategist as any);
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
        const strategist = { validate: jest.fn() };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctrl = new ValidationController(ledger as any, strategist as any);
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
        const strategist = { validate: jest.fn() };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctrl = new ValidationController(ledger as any, strategist as any);
        const { req, res } = makeReqRes({});

        await ctrl.listPendingValidation(req, res);
        expect(res.statusCode).toBe(500);
    });
});
