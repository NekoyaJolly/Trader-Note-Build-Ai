/**
 * EdgeLedger.create() — Wave 1 G1 24h ハードリミット ガードのテスト
 *
 * 責務: `assertWithinDailyHardlimit()` の env 制御 + source 別上限の動作確認のみ。
 * 統合しなかった理由: 既存 edgeLedgerFind.test.ts は find() 専用、hardlimit は別関心事。
 * 恒久 or 一時: 恒久 (hardlimit guard 自体が Wave 1 で恒久実装)
 * 参照経路: jest が `*.test.ts` を自動収集
 * 削除条件: EdgeLedger から hardlimit guard が撤去された場合
 */

const mockCount = jest.fn();
const mockCreate = jest.fn();

jest.mock('../../../backend/db/client', () => ({
    prisma: {
        edgeHypothesis: {
            count: mockCount,
            create: mockCreate,
        },
    },
}));

import { EdgeLedger, HypothesisHardlimitExceededError } from '../../ledger/EdgeLedger';
import type { CreateEdgeHypothesisInput } from '../../models/edgeHypothesis';

const validInput: CreateEdgeHypothesisInput = {
    statement: 'test hypothesis',
    category: 'time',
    conditions: [],
    expectedDirection: 'long',
    status: 'unverified',
    symbols: ['EURUSD'],
    timeframes: ['15m'],
    observationCount: 0,
    winCount: 0,
    lossCount: 0,
    breakevenCount: 0,
    totalPnlPips: 0,
    avgRR: 0,
    source: 'ai_generated',
};

describe('EdgeLedger.create — Wave 1 G1 24h hardlimit', () => {
    const ledger = new EdgeLedger();
    const envBackup: Record<string, string | undefined> = {};

    beforeEach(() => {
        jest.clearAllMocks();
        envBackup.HYPOTHESIS_HARDLIMIT_ENABLED = process.env.HYPOTHESIS_HARDLIMIT_ENABLED;
        envBackup.HYPOTHESIS_HARDLIMIT_AI_GENERATED_24H =
            process.env.HYPOTHESIS_HARDLIMIT_AI_GENERATED_24H;
        // create() 戻り値の最小スタブ (mapPrismaToEdgeHypothesis が壊れない最低限)
        mockCreate.mockResolvedValue({
            id: 'test-id',
            statement: validInput.statement,
            category: validInput.category,
            conditions: [],
            expectedDirection: validInput.expectedDirection,
            status: validInput.status,
            statusUpdatedAt: new Date(),
            statusNote: null,
            symbols: validInput.symbols,
            timeframes: validInput.timeframes,
            observationCount: 0,
            winCount: 0,
            lossCount: 0,
            breakevenCount: 0,
            // Prisma Decimal は .toNumber() を持つので mock もそれを満たす
            totalPnlPips: { toNumber: () => 0 },
            avgRR: { toNumber: () => 0 },
            backtestResults: null,
            walkForwardResults: null,
            source: validInput.source,
            lensRelevance: null,
            defaultRiskManagement: null,
            materializedTradeNoteIds: [],
            invalidationConditions: null,
            confirmationNote: null,
            screeningResult: null,
            fullValidationReport: null,
            confirmationInterpretation: null,
            rejectionInterpretation: null,
            actionableInsights: [],
            parentIds: [],
            relatedNoteIds: [],
            firstObservedAt: new Date(),
            lastObservedAt: new Date(),
            lastTestedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
    });

    afterEach(() => {
        for (const k of Object.keys(envBackup)) {
            if (envBackup[k] === undefined) delete process.env[k];
            else process.env[k] = envBackup[k];
        }
    });

    it('ENABLED=false なら hardlimit を発動せず create を呼ぶ (テスト既定挙動)', async () => {
        process.env.HYPOTHESIS_HARDLIMIT_ENABLED = 'false';
        await ledger.create(validInput);
        expect(mockCount).not.toHaveBeenCalled();
        expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('ENABLED=true で直近 24h 件数が上限未満なら create する', async () => {
        process.env.HYPOTHESIS_HARDLIMIT_ENABLED = 'true';
        mockCount.mockResolvedValue(4);
        await ledger.create(validInput);
        expect(mockCount).toHaveBeenCalledWith({
            where: expect.objectContaining({
                source: 'ai_generated',
                createdAt: expect.objectContaining({ gte: expect.any(Date) }),
            }),
        });
        expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('ENABLED=true で直近 24h 件数が上限 (5) 以上なら throw する', async () => {
        process.env.HYPOTHESIS_HARDLIMIT_ENABLED = 'true';
        mockCount.mockResolvedValue(5);
        await expect(ledger.create(validInput)).rejects.toBeInstanceOf(
            HypothesisHardlimitExceededError,
        );
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('ENABLED=true で env による source 別上限の上書きが効く (3 件で上限到達)', async () => {
        process.env.HYPOTHESIS_HARDLIMIT_ENABLED = 'true';
        process.env.HYPOTHESIS_HARDLIMIT_AI_GENERATED_24H = '3';
        mockCount.mockResolvedValue(3);
        await expect(ledger.create(validInput)).rejects.toBeInstanceOf(
            HypothesisHardlimitExceededError,
        );
    });

    it('throw されたエラーが source/recent/limit を保持する', async () => {
        process.env.HYPOTHESIS_HARDLIMIT_ENABLED = 'true';
        mockCount.mockResolvedValue(7);
        try {
            await ledger.create(validInput);
            fail('should have thrown');
        } catch (e) {
            expect(e).toBeInstanceOf(HypothesisHardlimitExceededError);
            const err = e as HypothesisHardlimitExceededError;
            expect(err.source).toBe('ai_generated');
            expect(err.recent).toBe(7);
            expect(err.limit).toBe(5);
        }
    });
});
