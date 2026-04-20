/**
 * Side-B 共通レイアウト（パンくずを全ページで統一表示）
 */

import type { ReactNode } from "react";
import SideBBreadcrumbs from "@/components/navigation/SideBBreadcrumbs";

export default function SideBLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SideBBreadcrumbs />
      {children}
    </>
  );
}
