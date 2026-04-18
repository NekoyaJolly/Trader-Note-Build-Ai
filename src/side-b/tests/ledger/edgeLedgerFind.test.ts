/**
 * EdgeLedger.find（Phase 4d Step 3）のテスト
 *
 * prisma を jest.mock で差し替え、以下を検証する:
 *   - 既定オプション（page=1, limit=20, sortBy=newest）
 *   - マルチフィルタ（status/category/source が { in: [...] }、symbols が hasSome）
 *   - search 文字列の trim と case-insensitive contains
 *   - ソート 3 種（newest / oldest / observation）の orderBy 変換
 *   - page / limit の clamp（limit<=100, page>=1）
 *   - total / page / limit がレスポンスに含まれる
 *
 * 既存の findByStatus 等の振る舞いは不変のため本ファイルでは検証しない
 * （既存テストがそれをカバー済み）。
 */

// ===========================================
// prisma モック
// ===========================================
// 型推論に使うためだけの import（実行時は jest.mock で置換）。
// tsconfig.test.json の paths を使わないので相対 import のみ。

const mockFindMany = jest.fn();
const mockCount = jest.fn();

jest.mock('../../../backend/db/client', () => ({
    prisma: {
        edgeHypothesis: {
            findMany: mockFindMany,
            count: mockCount,
        },
    },
}));

// mock 設定後に import（副作用対策）
import { EdgeLedger } from '../../ledger/EdgeLedger';

beforeEach(() => {
    mockFindMany.mockReset();
    mockCount.mockReset();
    // デフォルトは空配列返し
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
});

describe('EdgeLedger.find', () => {
    it('既定引数で呼ぶと page=1, limit=20, newest ソート', async () => {
        const ledger = new EdgeLedger();
        await ledger.find();

        expect(mockCount).toHaveBeenCalledTimes(1);
        expect(mockFindMany).toHaveBeenCalledTimes(1);
        const call = mockFindMany.mock.calls[0][0];
        expect(call.skip).toBe(0);
        expect(call.take).toBe(20);
        expect(call.orderBy).toEqual({ createdAt: 'desc' });
        expect(call.where).toEqual({});
    });

    it('statuses フィルタは { status: { in: [...] } } に変換される', async () => {
        const ledger = new EdgeLedger();
        await ledger.find({ statuses: ['confirmed', 'rejected'] });
        const call = mockFindMany.mock.calls[0][0];
        expect(call.where.status).toEqual({ in: ['confirmed', 'rejected'] });
    });

    it('categories / sources も { in: [...] } に変換される', async () => {
        const ledger = new EdgeLedger();
        await ledger.find({
            categories: ['time', 'volatility'],
            sources: ['ai_generated'],
        });
        const call = mockFindMany.mock.calls[0][0];
        expect(call.where.category).toEqual({ in: ['time', 'volatility'] });
        expect(call.where.source).toEqual({ in: ['ai_generated'] });
    });

    it('symbols は { hasSome: [...] } で OR 結合される', async () => {
        const ledger = new EdgeLedger();
        await ledger.find({ symbols: ['XAU/USD', 'EUR/USD'] });
        const call = mockFindMany.mock.calls[0][0];
        expect(call.where.symbols).toEqual({ hasSome: ['XAU/USD', 'EUR/USD'] });
    });

    it('search は trim + insensitive contains', async () => {
        const ledger = new EdgeLedger();
        await ledger.find({ search: '  ロンドン寄り  ' });
        const call = mockFindMany.mock.calls[0][0];
        expect(call.where.statement).toEqual({
            contains: 'ロンドン寄り',
            mode: 'insensitive',
        });
    });

    it('search が空白のみの場合は where.statement を付けない', async () => {
        const ledger = new EdgeLedger();
        await ledger.find({ search: '   ' });
        const call = mockFindMany.mock.calls[0][0];
        expect(call.where.statement).toBeUndefined();
    });

    it('空配列のフィルタは where に含めない', async () => {
        const ledger = new EdgeLedger();
        await ledger.find({
            statuses: [],
            categories: [],
            sources: [],
            symbols: [],
        });
        const call = mockFindMany.mock.calls[0][0];
        expect(call.where).toEqual({});
    });

    it('sortBy=oldest は createdAt asc', async () => {
        const ledger = new EdgeLedger();
        await ledger.find({ sortBy: 'oldest' });
        const call = mockFindMany.mock.calls[0][0];
        expect(call.orderBy).toEqual({ createdAt: 'asc' });
    });

    it('sortBy=observation は observationCount desc', async () => {
        const ledger = new EdgeLedger();
        await ledger.find({ sortBy: 'observation' });
        const call = mockFindMany.mock.calls[0][0];
        expect(call.orderBy).toEqual({ observationCount: 'desc' });
    });

    it('page / limit は skip / take に変換される', async () => {
        const ledger = new EdgeLedger();
        await ledger.find({ page: 3, limit: 10 });
        const call = mockFindMany.mock.calls[0][0];
        expect(call.skip).toBe(20); // (3-1) * 10
        expect(call.take).toBe(10);
    });

    it('page < 1 は 1 に clamp', async () => {
        const ledger = new EdgeLedger();
        await ledger.find({ page: 0 });
        const call = mockFindMany.mock.calls[0][0];
        expect(call.skip).toBe(0);
    });

    it('limit > 100 は 100 に clamp、< 1 は 1 に clamp', async () => {
        const ledger = new EdgeLedger();
        await ledger.find({ limit: 500 });
        expect(mockFindMany.mock.calls[0][0].take).toBe(100);

        mockFindMany.mockClear();
        await ledger.find({ limit: 0 });
        expect(mockFindMany.mock.calls[0][0].take).toBe(1);
    });

    it('total / page / limit をレスポンスに返す', async () => {
        mockCount.mockResolvedValueOnce(57);
        mockFindMany.mockResolvedValueOnce([]);

        const ledger = new EdgeLedger();
        const result = await ledger.find({ page: 2, limit: 25 });

        expect(result.total).toBe(57);
        expect(result.page).toBe(2);
        expect(result.limit).toBe(25);
        expect(result.hypotheses).toEqual([]);
    });
});
