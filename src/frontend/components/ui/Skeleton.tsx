import type { PropsWithChildren } from "react";

/**
 * Skeleton コンポーネント（最小構成）
 * ローディング中のプレースホルダ表示。
 */
export function Skeleton(
  props: PropsWithChildren<{ className?: string }>
) {
  const { className, children } = props;
  return (
    <div className={`animate-pulse bg-gray-200 rounded ${className || "h-4 w-full"}`}>{children}</div>
  );
}
