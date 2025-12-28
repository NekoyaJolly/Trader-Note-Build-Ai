import type { PropsWithChildren } from "react";

/**
 * Card コンポーネント（最小構成）
 * コンテンツの囲み枠として利用する。
 */
export function Card(props: PropsWithChildren<{ className?: string; title?: string }>) {
  const { className, title, children } = props;
  return (
    <div className={`bg-white rounded-lg shadow border ${className || ""}`}>
      {title ? (
        <div className="border-b px-4 py-3 text-sm font-semibold text-gray-800">{title}</div>
      ) : null}
      <div className="p-4">{children}</div>
    </div>
  );
}
