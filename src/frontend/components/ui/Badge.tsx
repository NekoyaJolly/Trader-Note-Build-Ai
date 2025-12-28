import type { PropsWithChildren } from "react";

/**
 * Badge コンポーネント（最小構成）
 * ラベルの強調表示に使用する。
 */
export function Badge(
  props: PropsWithChildren<{ className?: string; variant?: "success" | "danger" | "neutral" }>
) {
  const { className, variant = "neutral", children } = props;
  const variantClass =
    variant === "success"
      ? "bg-green-100 text-green-700"
      : variant === "danger"
      ? "bg-red-100 text-red-700"
      : "bg-gray-100 text-gray-700";

  return (
    <span className={`inline-block px-2 py-1 text-xs font-semibold rounded ${variantClass} ${className || ""}`}>
      {children}
    </span>
  );
}
