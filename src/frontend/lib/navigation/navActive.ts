/**
 * サイドバー・タブ共通のアクティブ判定。
 * `/side-b` は運転席専用とし、子パス（/side-b/dashboard 等）では他項目がアクティブになる。
 */

/**
 * ナビの href が現在の pathname でアクティブか。
 * ハッシュのみのリンクは pathname では判定しない（インジケーター等は別ロジック）。
 */
export function isNavHrefActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  if (href.startsWith("#")) {
    return false;
  }
  if (href === "/") {
    return pathname === "/";
  }
  // 運転席は厳密一致のみ（/side-b/xxx は別メニュー）
  if (href === "/side-b") {
    return pathname === "/side-b" || pathname === "/side-b/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
