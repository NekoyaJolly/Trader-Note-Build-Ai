/**
 * ブラウザがローカル開発用オリジンか（cTrader OAuth の redirect 自動解決に使用）
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * 現在のウィンドウがローカルホスト向けか
 */
export function isBrowserLocalDevOrigin(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return LOCAL_HOSTNAMES.has(window.location.hostname);
}
