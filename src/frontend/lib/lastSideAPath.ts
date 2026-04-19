/**
 * Side-A で最後に開いた画面（ホーム以外）を記録し、「前回の続き」に使う。
 *
 * - 保存は **pathname のみ**（トースト・モーダル・ページ番号などのクエリは保存しない）
 * - **7 日**より古い記録は無効として破棄（死にリンクの温床を減らす）
 *
 * localStorage のため PII は含めず、パス文字列のみ。
 */

import { isSafeInternalRedirectPath } from "@/lib/postLoginRedirect";

const STORAGE_KEY = "tradeassist:side_a_last_path";

/** 「前回の続き」として使う最大経過日数 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type LastSideAPath = {
  /** pathname のみ（クエリなし） */
  path: string;
  /** ISO 8601 */
  savedAt: string;
};

/**
 * 記録してよい Side-A のパスか（ホーム・認証・Side-B は除外）
 */
export function shouldRecordSideAPath(pathname: string): boolean {
  if (pathname === "/") return false;
  if (pathname.startsWith("/side-b")) return false;
  if (pathname.startsWith("/login")) return false;
  if (pathname.startsWith("/auth")) return false;
  return true;
}

function isFresh(savedAt: string): boolean {
  const t = Date.parse(savedAt);
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= MAX_AGE_MS;
}

/**
 * 直近の Side-A パスを読む。不正・期限切れは null。
 */
export function readLastSideAPath(): LastSideAPath | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { path?: unknown; savedAt?: unknown };
    if (typeof parsed.path !== "string" || !parsed.path) return null;
    const savedAt = typeof parsed.savedAt === "string" ? parsed.savedAt : "";
    if (!isFresh(savedAt)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (!isSafeInternalRedirectPath(parsed.path)) return null;
    if (parsed.path === "/") return null;
    return { path: parsed.path, savedAt };
  } catch {
    return null;
  }
}

/**
 * 画面遷移時に呼ぶ。shouldRecordSideAPath が true のときだけ pathname を保存する。
 */
export function writeLastSideAPath(pathname: string): void {
  if (typeof window === "undefined") return;
  if (!shouldRecordSideAPath(pathname)) return;
  if (!isSafeInternalRedirectPath(pathname)) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        path: pathname,
        savedAt: new Date().toISOString(),
      } satisfies LastSideAPath),
    );
  } catch {
    // ストレージ満杯等は無視
  }
}
