/**
 * analysis-engine client の境界ヘッダーテスト。
 *
 * 目的: Side-B / backend から Python service へ出る内部HTTPに相関IDを引き継ぐ契約を固定する。
 */

import { buildAnalysisEngineJsonHeaders } from '../services/analysisEngineClient';

describe('analysisEngineClient', () => {
  it('correlationId 指定時は X-Correlation-Id を付与する', () => {
    const headers = buildAnalysisEngineJsonHeaders({
      correlationId: 'sideb-run-20260603',
    });

    expect(headers).toEqual({
      'Content-Type': 'application/json',
      'X-Correlation-Id': 'sideb-run-20260603',
    });
  });

  it('correlationId 未指定時は JSON ヘッダーだけを返す', () => {
    const headers = buildAnalysisEngineJsonHeaders();

    expect(headers).toEqual({
      'Content-Type': 'application/json',
    });
  });
});
