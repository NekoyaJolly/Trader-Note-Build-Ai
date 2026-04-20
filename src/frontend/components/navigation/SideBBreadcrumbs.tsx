"use client";

/**
 * Side-B 配下のパンくず（lib/navigation/sideBBreadcrumbs.ts と同一ラベル）
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getSideBBreadcrumbSegments } from "@/lib/navigation/sideBBreadcrumbs";

export default function SideBBreadcrumbs() {
  const pathname = usePathname();
  const segments = getSideBBreadcrumbSegments(pathname);

  if (segments.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="パンくず"
      className="mb-4 px-1"
      data-testid="side-b-breadcrumb"
    >
      <ol className="flex flex-wrap items-center gap-1 text-xs sm:text-sm text-gray-400">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          return (
            <li key={`${seg.label}-${i}`} className="flex items-center gap-1 min-w-0">
              {i > 0 && (
                <ChevronRight className="w-3.5 h-3.5 shrink-0 text-gray-600" aria-hidden />
              )}
              {isLast || !seg.href ? (
                <span
                  className={isLast ? "text-gray-200 font-medium truncate" : "truncate"}
                  aria-current={isLast ? "page" : undefined}
                >
                  {seg.label}
                </span>
              ) : (
                <Link
                  href={seg.href}
                  className="text-purple-300/90 hover:text-purple-200 truncate transition-colors"
                >
                  {seg.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
