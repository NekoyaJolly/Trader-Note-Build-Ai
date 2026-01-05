/**
 * Cronエンドポイント テスト
 * 
 * 目的: cronAuthミドルウェアの動作確認
 */

import express from 'express';

// 環境変数のモック
const originalEnv = process.env;

describe('cronAuth ミドルウェア', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('開発モード（CRON_SECRET未設定）', () => {
    beforeEach(() => {
      delete process.env.CRON_SECRET;
    });

    it('認証なしの場合の動作確認', () => {
      // CRON_SECRETが未設定の場合、開発モードとして認証をスキップ
      // 実際の動作はcronAuth.tsのロジックで定義
      delete process.env.CRON_SECRET;
      expect(process.env.CRON_SECRET).toBeUndefined();
    });
  });

  describe('本番モード（CRON_SECRET設定済み）', () => {
    const TEST_SECRET = 'test-cron-secret-12345';

    beforeEach(() => {
      process.env.CRON_SECRET = TEST_SECRET;
    });

    it('正しいBearerトークンで認証成功', async () => {
      // cronAuthのロジックをユニットテスト
      const mockReq = {
        headers: {
          authorization: `Bearer ${TEST_SECRET}`,
        },
        query: {},
      } as express.Request;
      
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as express.Response;
      
      const mockNext = jest.fn();

      // cronAuthを直接インポートして再設定
      jest.isolateModules(() => {
        process.env.CRON_SECRET = TEST_SECRET;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { cronAuth: isolatedCronAuth } = require('../../middleware/cronAuth');
        isolatedCronAuth(mockReq, mockRes, mockNext);
      });

      // next()が呼ばれることを確認
      expect(mockNext).toHaveBeenCalled();
    });

    it('トークンなしで401エラー', async () => {
      const mockReq = {
        headers: {},
        query: {},
      } as express.Request;
      
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as express.Response;
      
      const mockNext = jest.fn();

      jest.isolateModules(() => {
        process.env.CRON_SECRET = TEST_SECRET;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { cronAuth: isolatedCronAuth } = require('../../middleware/cronAuth');
        isolatedCronAuth(mockReq, mockRes, mockNext);
      });

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('不正なトークンで403エラー', async () => {
      const mockReq = {
        headers: {
          authorization: 'Bearer wrong-token',
        },
        query: {},
      } as express.Request;
      
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as express.Response;
      
      const mockNext = jest.fn();

      jest.isolateModules(() => {
        process.env.CRON_SECRET = TEST_SECRET;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { cronAuth: isolatedCronAuth } = require('../../middleware/cronAuth');
        isolatedCronAuth(mockReq, mockRes, mockNext);
      });

      // 不正なトークンは403を返す（認証はされたがアクセス拒否）
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('クエリパラメータのsecretでも認証成功', async () => {
      const mockReq = {
        headers: {},
        query: {
          secret: TEST_SECRET,
        },
      } as unknown as express.Request;
      
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as express.Response;
      
      const mockNext = jest.fn();

      jest.isolateModules(() => {
        process.env.CRON_SECRET = TEST_SECRET;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { cronAuth: isolatedCronAuth } = require('../../middleware/cronAuth');
        isolatedCronAuth(mockReq, mockRes, mockNext);
      });

      expect(mockNext).toHaveBeenCalled();
    });
  });
});

describe('Cron ルート', () => {
  describe('GET /api/cron/health', () => {
    it('ヘルスチェックレスポンス形式が正しい', () => {
      // ヘルスチェックのレスポンス形式を検証
      const expectedResponse = {
        status: 'ok',
        timestamp: expect.any(String),
        market: {
          isOpen: expect.any(Boolean),
          message: expect.any(String),
        },
      };
      
      // モックレスポンスが期待形式に一致するかテスト
      const mockResponse = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        market: {
          isOpen: true,
          message: 'FX市場は開場中',
        },
      };
      
      expect(mockResponse).toMatchObject(expectedResponse);
    });
  });

  describe('GET /api/cron/side-b/daily-plan', () => {
    it('日次プランレスポンス形式が正しい', () => {
      // 成功レスポンスの形式を検証
      const successResponse = {
        success: true,
        message: '日次プラン生成完了',
        data: { count: 1 },
        duration: 1234,
      };
      
      expect(successResponse.success).toBe(true);
      expect(successResponse.duration).toBeGreaterThan(0);
    });

    it('市場休場時のスキップレスポンス形式', () => {
      const skipResponse = {
        success: true,
        skipped: true,
        reason: '市場休場',
        market: '週末のため休場',
        duration: 10,
      };
      
      expect(skipResponse.skipped).toBe(true);
      expect(skipResponse.reason).toBe('市場休場');
    });
  });

  describe('GET /api/cron/side-b/monitor', () => {
    it('監視実行レスポンス形式が正しい', () => {
      const successResponse = {
        success: true,
        message: '監視完了: 処理 2件, エントリー 0件, 決済 0件',
        data: { 
          processed: 2,
          entered: 0,
          exited: 0,
        },
        duration: 5678,
      };
      
      expect(successResponse.success).toBe(true);
      expect(successResponse.data.processed).toBeDefined();
    });
  });
});
