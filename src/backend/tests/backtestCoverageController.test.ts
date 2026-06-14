/**
 * バックテストカバレッジ API の返却契約テスト
 *
 * 確認事項:
 * - 市場データ不足時に UI が判断できる深刻度・不足期間・メッセージを返す
 * - 十分なカバレッジでは ok として返す
 */

import type { Request, Response } from 'express';
import { BacktestController } from '../controllers/backtestController';
import { checkDataCoverage } from '../services/strategyBacktestService';

jest.mock('../services/strategyBacktestService', () => ({
  checkDataCoverage: jest.fn(),
}));

interface CoverageResponseBody {
  success?: boolean;
  data?: {
    hasEnoughData: boolean;
    coverageRatio: number;
    missingBars: number;
    expectedBars: number;
    actualBars: number;
    presetExists: boolean;
    missingStart: string | null;
    missingEnd: string | null;
    severity: 'ok' | 'warning' | 'critical';
    message: string;
  };
  error?: string;
}

interface MockResponse extends Response {
  statusCode: number;
  body?: CoverageResponseBody;
}

function createRequest(body: object): Request {
  return { body } as Request;
}

function createMockResponse(): MockResponse {
  const response: {
    statusCode: number;
    body?: CoverageResponseBody;
    status(code: number): typeof response;
    json(body: CoverageResponseBody): typeof response;
  } = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: CoverageResponseBody) {
      this.body = body;
      return this;
    },
  };
  return response as MockResponse;
}

describe('BacktestController.checkCoverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('プリセット未登録のデータ不足は critical と不足期間を返す', async () => {
    jest.mocked(checkDataCoverage).mockResolvedValue({
      hasCoverage: false,
      presetExists: false,
      dataCount: 0,
      expectedCount: 100,
      missingStart: new Date('2026-06-01T00:00:00Z'),
      missingEnd: new Date('2026-06-10T00:00:00Z'),
      coverageRatio: 0,
    });

    const controller = new BacktestController();
    const res = createMockResponse();

    await controller.checkCoverage(createRequest({
      symbol: 'USDJPY',
      timeframe: '1h',
      startDate: '2026-06-01T00:00:00Z',
      endDate: '2026-06-10T00:00:00Z',
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.data).toMatchObject({
      hasEnoughData: false,
      presetExists: false,
      severity: 'critical',
      missingStart: '2026-06-01T00:00:00.000Z',
      missingEnd: '2026-06-10T00:00:00.000Z',
      message: '対象シンボル/時間足のデータプリセットが未登録です',
    });
  });

  it('十分なカバレッジは ok として返す', async () => {
    jest.mocked(checkDataCoverage).mockResolvedValue({
      hasCoverage: true,
      presetExists: true,
      dataCount: 100,
      expectedCount: 96,
      coverageRatio: 1,
    });

    const controller = new BacktestController();
    const res = createMockResponse();

    await controller.checkCoverage(createRequest({
      symbol: 'USDJPY',
      timeframe: '1h',
      startDate: '2026-06-01T00:00:00Z',
      endDate: '2026-06-10T00:00:00Z',
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.data).toMatchObject({
      hasEnoughData: true,
      presetExists: true,
      severity: 'ok',
      missingBars: 0,
      missingStart: null,
      missingEnd: null,
      message: '要求期間をカバーする市場データがあります',
    });
  });
});
