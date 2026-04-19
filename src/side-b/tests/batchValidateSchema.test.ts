/**
 * バッチ検証リクエストスキーマ（Phase 4d）
 */

import { BatchValidateRequestSchema } from '../../schemas/api/sideB';

describe('BatchValidateRequestSchema', () => {
    const sampleId = '123e4567-e89b-12d3-a456-426614174000';

    it('最大10件まで通る', () => {
        const ids = Array.from({ length: 10 }, () => sampleId);
        const r = BatchValidateRequestSchema.safeParse({ ids });
        expect(r.success).toBe(true);
    });

    it('11件は拒否', () => {
        const ids = Array.from({ length: 11 }, () => sampleId);
        const r = BatchValidateRequestSchema.safeParse({ ids });
        expect(r.success).toBe(false);
    });

    it('空配列は拒否', () => {
        const r = BatchValidateRequestSchema.safeParse({ ids: [] });
        expect(r.success).toBe(false);
    });
});
