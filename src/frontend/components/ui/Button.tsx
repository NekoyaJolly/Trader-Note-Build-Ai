import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

/**
 * Button コンポーネント（最小構成）
 * shadcn/ui 風のシンプルなボタン実装。
 */
export function Button(
  props: PropsWithChildren<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      variant?: "primary" | "secondary" | "ghost";
      size?: "sm" | "md" | "lg";
    }
  >
) {
  const { className, variant = "primary", size = "md", children, ...rest } = props;

  // バリアントに応じたスタイルを定義（Tailwind のみ）
  const variantClass =
    variant === "primary"
      ? "bg-blue-600 text-white hover:bg-blue-700"
      : variant === "secondary"
      ? "bg-gray-200 text-gray-800 hover:bg-gray-300"
      : "bg-transparent text-gray-700 hover:bg-gray-100";

  const sizeClass =
    size === "sm"
      ? "px-2 py-1 text-xs"
      : size === "lg"
      ? "px-5 py-3 text-base"
      : "px-4 py-2 text-sm";

  return (
    <button
      className={`${variantClass} ${sizeClass} rounded transition-colors ${className || ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}
