/**
 * ブラウザが叩くバックエンド API のベース URL を解決する。
 *
 * NEXT_PUBLIC_API_BASE_URL が無いと相対パスになり Next 自身へ fetch して 404 になるため、
 * ローカルホスト上では既定で Express（:3100）を指す。
 */

const LOCAL_DEFAULT_BACKEND = 'http://localhost:3100';

/**
 * 環境変数またはローカル開発時の既定で API オリジンを返す（末尾スラッシュなし）
 */
export function getPublicApiBaseUrl(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').trim().replace(/\/$/, '');
  if (fromEnv) {
    return fromEnv;
  }
  if (typeof window !== 'undefined') {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') {
      return LOCAL_DEFAULT_BACKEND;
    }
  }
  return '';
}
