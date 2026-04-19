"use client";

/**
 * ヘッダー用ワークスペースタブ（Side-A / Side-B）
 *
 * 切替先は各ワークスペースのホーム（§4-1）。アクティブは pathname から一意に決まる。
 *
 * @see docs/design/tradeassist_uiux_redesign_plan.md §4-1
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  getWorkspaceSideFromPathname,
  SIDE_A_HOME,
  SIDE_B_HOME,
  type WorkspaceSide,
} from "@/lib/workspaceSide";

export default function WorkspaceTabs() {
  const pathname = usePathname();
  const active = getWorkspaceSideFromPathname(pathname);

  const tabClass = (side: WorkspaceSide) => {
    const isOn = active === side;
    const base =
      "inline-flex min-h-[36px] items-center justify-center rounded-md px-2.5 sm:px-3 text-[11px] sm:text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900";
    if (side === "side-a") {
      return `${base} ${
        isOn
          ? "bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.25)]"
          : "text-gray-400 hover:bg-slate-700/50 hover:text-cyan-100"
      }`;
    }
    return `${base} ${
      isOn
        ? "bg-purple-500/20 text-purple-200 ring-1 ring-purple-500/50 shadow-[0_0_12px_rgba(168,85,247,0.25)]"
        : "text-gray-400 hover:bg-slate-700/50 hover:text-purple-100"
    }`;
  };

  return (
    <nav
      className="flex items-center gap-1 rounded-lg border border-slate-600/40 bg-slate-900/50 p-0.5"
      aria-label="ワークスペース切替"
      data-testid="workspace-tabs"
    >
      <Link
        data-testid="workspace-tab-side-a"
        href={SIDE_A_HOME}
        className={tabClass("side-a")}
        aria-current={active === "side-a" ? "page" : undefined}
      >
        Side-A
      </Link>
      <Link
        data-testid="workspace-tab-side-b"
        href={SIDE_B_HOME}
        className={tabClass("side-b")}
        aria-current={active === "side-b" ? "page" : undefined}
      >
        Side-B
      </Link>
    </nav>
  );
}
