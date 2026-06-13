/**
 * analysis-engine client の境界ヘッダーテスト。
 *
 * 目的: Side-B / backend から Python service へ出る内部HTTPに相関IDを引き継ぐ契約を固定する。
 */

import { buildAnalysisEngineJsonHeaders } from '../services/analysisEngineClient';

describe('analysisEngineClient', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSharedSecret = process.env.ANALYSIS_ENGINE_SHARED_SECRET;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalSharedSecret === undefined) {
      delete process.env.ANALYSIS_ENGINE_SHARED_SECRET;
    } else {
      process.env.ANALYSIS_ENGINE_SHARED_SECRET = originalSharedSecret;
    }
  });

  it('correlationId 指定時は X-Correlation-Id を付与する', () => {
    delete process.env.ANALYSIS_ENGINE_SHARED_SECRET;
    process.env.NODE_ENV = 'test';

    const headers = buildAnalysisEngineJsonHeaders({
      correlationId: 'sideb-run-20260603',
    });

    expect(headers).toEqual({
      'Content-Type': 'application/json',
      'X-Correlation-Id': 'sideb-run-20260603',
    });
  });

  it('correlationId 未指定時は JSON ヘッダーだけを返す', () => {
    delete process.env.ANALYSIS_ENGINE_SHARED_SECRET;
    process.env.NODE_ENV = 'test';

    const headers = buildAnalysisEngineJsonHeaders();

    expect(headers).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('shared secret 設定時は X-Analysis-Engine-Secret を付与する', () => {
    process.env.NODE_ENV = 'test';
    process.env.ANALYSIS_ENGINE_SHARED_SECRET = 'analysis-engine-secret-for-tests-123';

    const headers = buildAnalysisEngineJsonHeaders({
      correlationId: 'sideb-run-20260603',
    });

    expect(headers).toEqual({
      'Content-Type': 'application/json',
      'X-Analysis-Engine-Secret': 'analysis-engine-secret-for-tests-123',
      'X-Correlation-Id': 'sideb-run-20260603',
    });
  });

  it('production で shared secret 未設定なら fail-fast する', () => {
    delete process.env.ANALYSIS_ENGINE_SHARED_SECRET;
    process.env.NODE_ENV = 'production';

    expect(() => buildAnalysisEngineJsonHeaders()).toThrow(
      'ANALYSIS_ENGINE_SHARED_SECRET は production で必須です',
    );
  });

  it('shared secret が短すぎる場合は env 名付きで fail-fast する', () => {
    process.env.NODE_ENV = 'test';
    process.env.ANALYSIS_ENGINE_SHARED_SECRET = 'short-secret';

    expect(() => buildAnalysisEngineJsonHeaders()).toThrow(
      'ANALYSIS_ENGINE_SHARED_SECRET は32文字以上で設定してください',
    );
  });
});
