/**
 * cTrader redirect_uri 解決ロジックのテスト
 */

import { config } from '../../config';
import {
  resolveRedirectUriForAuthUrl,
  resolveRedirectUriForTokenExchange,
  tryBuildRedirectUriFromBase,
} from '../utils/ctraderRedirectUri';

describe('ctraderRedirectUri', () => {
  const fallback = config.ctrader.redirectUri;

  describe('tryBuildRedirectUriFromBase', () => {
    it('localhost のオリジンから callback URL を組み立てる', () => {
      expect(tryBuildRedirectUriFromBase('http://localhost:3102')).toBe(
        'http://localhost:3102/auth/ctrader/callback',
      );
    });

    it('127.0.0.1 を許可する', () => {
      expect(tryBuildRedirectUriFromBase('http://127.0.0.1:3102')).toBe(
        'http://127.0.0.1:3102/auth/ctrader/callback',
      );
    });

    it('パス付き redirect_base は拒否する', () => {
      expect(tryBuildRedirectUriFromBase('http://localhost:3102/foo')).toBeNull();
    });

    it('外部オリジンは拒否する', () => {
      expect(tryBuildRedirectUriFromBase('https://evil.example')).toBeNull();
    });
  });

  describe('resolveRedirectUriForAuthUrl', () => {
    it('ローカル base があればそれを使う', () => {
      expect(resolveRedirectUriForAuthUrl('http://localhost:3102')).toBe(
        'http://localhost:3102/auth/ctrader/callback',
      );
    });

    it('未指定または不正なら config の redirectUri にフォールバック', () => {
      expect(resolveRedirectUriForAuthUrl(undefined)).toBe(fallback);
      expect(resolveRedirectUriForAuthUrl('https://preview.vercel.app')).toBe(fallback);
    });
  });

  describe('resolveRedirectUriForTokenExchange', () => {
    it('ローカル用の完全な redirect_uri を採用する', () => {
      expect(
        resolveRedirectUriForTokenExchange('http://localhost:3102/auth/ctrader/callback'),
      ).toBe('http://localhost:3102/auth/ctrader/callback');
    });

    it('パスが違う場合はフォールバックする', () => {
      expect(resolveRedirectUriForTokenExchange('http://localhost:3102/wrong')).toBe(fallback);
    });

    it('未指定はフォールバックする', () => {
      expect(resolveRedirectUriForTokenExchange(undefined)).toBe(fallback);
    });
  });
});
