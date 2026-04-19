/**
 * ログイン成功直後の遷移先
 *
 * デスクトップ（Tailwind md 以上）: Side-A ホーム
 * モバイル: チャート（MT 系アプリに近い体験）
 *
 * 明示的な遷移意図（OAuth `state` や `/login?next=`）がある場合は {@link resolvePostLoginRedirect} を使う。
 *
 * @see docs/design/tradeassist_uiux_redesign_plan.md §3-4・§3-5
 */
export function getPostLoginPath(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  return window.matchMedia("(min-width: 768px)").matches ? "/" : "/market-analysis";
}

/**
 * クエリ・フラグメントより前のパス名部分だけを取り出す。
 */
export function getPathnameOnly(path: string): string {
  return path.split(/[?#]/)[0] ?? "";
}

/**
 * ログイン画面・OAuth コールバックへ戻すだけの遷移はループになるため拒否する。
 */
export function isRedirectLoopPath(path: string): boolean {
  const pathname = getPathnameOnly(path);
  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return true;
  }
  if (
    pathname === "/auth/ctrader/callback" ||
    pathname.startsWith("/auth/ctrader/callback/")
  ) {
    return true;
  }
  return false;
}

/**
 * `%2F%2Fevil.com` のように多重エンコードされた入力を段階的にデコードする。
 * 失敗した時点の直前までを返す。
 */
export function fullyDecodeRedirectInput(raw: string): string {
  let cur = raw;
  for (let i = 0; i < 6; i++) {
    try {
      const next = decodeURIComponent(cur);
      if (next === cur) break;
      cur = next;
    } catch {
      break;
    }
  }
  return cur;
}

/**
 * オープンリダイレクト防止のため、社内パスのみ許可する。
 * 絶対URL・プロトコル相対（//）・制御文字・危険スキーム・認証ループ先は拒否。
 */
export function isSafeInternalRedirectPath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  if (!trimmed.startsWith("/")) return false;
  if (trimmed.startsWith("//")) return false;
  if (trimmed.includes("\0")) return false;
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  if (/javascript\s*:/i.test(trimmed)) return false;
  if (isRedirectLoopPath(trimmed)) return false;
  return true;
}

/**
 * ログイン後の最終遷移先を決定する。
 *
 * 優先順位（高い順・仕様固定）:
 * 1. OAuth `state` または `/login?next=` で渡された明示パス（多重デコード・安全性検証済み）
 * 2. {@link getPostLoginPath}（ビューポート別デフォルト＝最終フォールバック）
 *
 * `state` と `next` は同一カテゴリ（明示意図）。コールバックでは `state` のみ、ログイン画面では `next` のみが使われる。
 */
export function resolvePostLoginRedirect(explicit: string | null | undefined): string {
  if (explicit == null || explicit === "") {
    return getPostLoginPath();
  }
  const decoded = fullyDecodeRedirectInput(explicit);
  if (!isSafeInternalRedirectPath(decoded)) {
    return getPostLoginPath();
  }
  return decoded;
}
