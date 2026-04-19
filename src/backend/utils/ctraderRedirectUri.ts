/**
 * cTrader OAuth の redirect_uri 解決
 *
 * ローカル（localhost / 127.0.0.1 / ::1）では、フロントから渡す origin または
 * 完全な callback URL をそのまま採用し、.env の CTRADER_REDIRECT_URI と毎回揃える負担を減らす。
 * それ以外のホストでは常に config（環境変数）の値のみ使用する。
 */

import { config } from '../../config';

/** cTrader がリダイレクトするフロントのパス（Next.js App Router） */
export const CTRADER_CALLBACK_PATH = '/auth/ctrader/callback';

/**
 * ローカル開発用に許可するオリジンか（プロトコル + ホスト + ポート）
 *
 * 理由: プレビュー URL 等はクライアント指示を信頼せず環境変数で固定する。
 */
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * GET /api/auth/ctrader/url の redirect_base（オリジン）から redirect_uri を組み立てる。
 * 非ローカルまたは不正な場合は null。
 */
export function tryBuildRedirectUriFromBase(redirectBase: string | undefined): string | null {
  if (!redirectBase || typeof redirectBase !== 'string') {
    return null;
  }
  let url: URL;
  try {
    url = new URL(redirectBase);
  } catch {
    return null;
  }
  // クエリやパス付きの redirect_base は誤用のため拒否（オリジンのみ想定）
  if (url.pathname !== '/' || url.hash !== '') {
    return null;
  }
  const origin = url.origin;
  if (!LOCAL_ORIGIN_RE.test(origin)) {
    return null;
  }
  return `${origin}${CTRADER_CALLBACK_PATH}`;
}

/**
 * 認可 URL 用の redirect_uri を決定する。
 */
export function resolveRedirectUriForAuthUrl(redirectBase: string | undefined): string {
  const local = tryBuildRedirectUriFromBase(redirectBase);
  if (local) {
    return local;
  }
  return config.ctrader.redirectUri;
}

/**
 * トークン交換用の redirect_uri。認可リクエスト時と完全一致が必須。
 */
export function resolveRedirectUriForTokenExchange(clientRedirectUri: string | undefined): string {
  if (!clientRedirectUri) {
    return config.ctrader.redirectUri;
  }
  try {
    const u = new URL(clientRedirectUri);
    if (u.pathname !== CTRADER_CALLBACK_PATH || u.hash !== '') {
      return config.ctrader.redirectUri;
    }
    if (!LOCAL_ORIGIN_RE.test(u.origin)) {
      return config.ctrader.redirectUri;
    }
    return clientRedirectUri;
  } catch {
    return config.ctrader.redirectUri;
  }
}
