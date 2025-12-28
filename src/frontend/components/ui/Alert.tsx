import type { PropsWithChildren } from "react";

/**
 * Alert コンポーネント（最小構成）
 * 情報/エラー通知の表示に使用する。
 */
export function Alert(
  props: PropsWithChildren<{
    className?: string;
    variant?: "info" | "error" | "warning";
    title?: string;
  }>
) {
  const { className, variant = "info", title, children } = props;
  const variantClass =
    variant === "error"
      ? "bg-red-50 border-red-200 text-red-800"
      : variant === "warning"
      ? "bg-yellow-50 border-yellow-200 text-yellow-800"
      : "bg-blue-50 border-blue-200 text-blue-800";

  return (
    <div className={`border rounded p-4 ${variantClass} ${className || ""}`}>
      {title ? <div className="font-semibold mb-1">{title}</div> : null}
      <div className="text-sm">{children}</div>
    </div>
  );
}
