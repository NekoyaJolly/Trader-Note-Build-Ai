/**
 * シークレットチェッカーヘルパーのテスト
 * 
 * 目的: secret-checker ヘルパー関数の動作を検証
 */

import {
  checkRequiredSecrets,
  hasCtraderCredentials,
  isMinimalTestMode,
  skipIfMissingSecret,
  skipIfNotMinimalTest,
} from './helpers/secret-checker';

describe('Secret Checker Helper', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // 環境変数をリセット
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // 環境変数を復元
    process.env = originalEnv;
  });

  describe('checkRequiredSecrets', () => {
    it('全てのシークレットが設定されている場合は全てtrueを返す', () => {
      process.env.AI_API_KEY = 'test-ai-key';
      process.env.MARKET_API_KEY = 'test-market-key';
      process.env.CTRADER_CLIENT_ID = 'test-ctrader-id';
      process.env.CTRADER_CLIENT_SECRET = 'test-ctrader-secret';

      const secrets = checkRequiredSecrets();

      expect(secrets.hasAiApiKey).toBe(true);
      expect(secrets.hasMarketApiKey).toBe(true);
      expect(secrets.hasCtraderClientId).toBe(true);
      expect(secrets.hasCtraderClientSecret).toBe(true);
    });

    it('シークレットが未設定の場合はfalseを返す', () => {
      delete process.env.AI_API_KEY;
      delete process.env.MARKET_API_KEY;
      delete process.env.CTRADER_CLIENT_ID;
      delete process.env.CTRADER_CLIENT_SECRET;

      const secrets = checkRequiredSecrets();

      expect(secrets.hasAiApiKey).toBe(false);
      expect(secrets.hasMarketApiKey).toBe(false);
      expect(secrets.hasCtraderClientId).toBe(false);
      expect(secrets.hasCtraderClientSecret).toBe(false);
    });
  });

  describe('hasCtraderCredentials', () => {
    it('両方のcTraderシークレットが設定されている場合はtrueを返す', () => {
      process.env.CTRADER_CLIENT_ID = 'test-id';
      process.env.CTRADER_CLIENT_SECRET = 'test-secret';

      expect(hasCtraderCredentials()).toBe(true);
    });

    it('片方だけ設定されている場合はfalseを返す', () => {
      process.env.CTRADER_CLIENT_ID = 'test-id';
      delete process.env.CTRADER_CLIENT_SECRET;

      expect(hasCtraderCredentials()).toBe(false);
    });

    it('両方とも未設定の場合はfalseを返す', () => {
      delete process.env.CTRADER_CLIENT_ID;
      delete process.env.CTRADER_CLIENT_SECRET;

      expect(hasCtraderCredentials()).toBe(false);
    });
  });

  describe('isMinimalTestMode', () => {
    it('CI環境でRUN_FULL_PAID_API_TESTS=falseの場合はtrueを返す', () => {
      process.env.CI = 'true';
      delete process.env.RUN_FULL_PAID_API_TESTS;

      expect(isMinimalTestMode()).toBe(true);
    });

    it('CI環境でRUN_FULL_PAID_API_TESTS=trueの場合はfalseを返す', () => {
      process.env.CI = 'true';
      process.env.RUN_FULL_PAID_API_TESTS = 'true';

      expect(isMinimalTestMode()).toBe(false);
    });

    it('CI環境でない場合はfalseを返す', () => {
      delete process.env.CI;

      expect(isMinimalTestMode()).toBe(false);
    });
  });

  describe('skipIfMissingSecret', () => {
    it('シークレットが設定されている場合はfalseを返す', () => {
      process.env.AI_API_KEY = 'test-key';

      const shouldSkip = skipIfMissingSecret('hasAiApiKey', 'Test');

      expect(shouldSkip).toBe(false);
    });

    it('シークレットが未設定の場合はtrueを返す', () => {
      delete process.env.AI_API_KEY;

      const shouldSkip = skipIfMissingSecret('hasAiApiKey', 'Test');

      expect(shouldSkip).toBe(true);
    });
  });

  describe('skipIfNotMinimalTest', () => {
    it('最小限モードの場合はtrueを返す', () => {
      process.env.CI = 'true';
      delete process.env.RUN_FULL_PAID_API_TESTS;

      const shouldSkip = skipIfNotMinimalTest('Extended Test');

      expect(shouldSkip).toBe(true);
    });

    it('フルテストモードの場合はfalseを返す', () => {
      process.env.CI = 'true';
      process.env.RUN_FULL_PAID_API_TESTS = 'true';

      const shouldSkip = skipIfNotMinimalTest('Extended Test');

      expect(shouldSkip).toBe(false);
    });

    it('ローカル環境の場合はfalseを返す', () => {
      delete process.env.CI;

      const shouldSkip = skipIfNotMinimalTest('Extended Test');

      expect(shouldSkip).toBe(false);
    });
  });
});
