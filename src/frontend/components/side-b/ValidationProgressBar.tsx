/**
 * 本格検証の4ツール進行表示（Phase 4d §4.6）
 *
 * testing 中はレポートが未完のことが多いため、未完時はインデターミネート表示に近いパルスを使う。
 */

"use client";

import * as React from "react";

import { Progress } from "@/components/ui/Progress";
import type { ConsolidatedValidationReport } from "@/types/sideB";
import type { EdgeStatus } from "@/types/sideB";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "screening", label: "スクリーニング" },
  { key: "walkForward", label: "ウォークフォワード" },
  { key: "monteCarlo", label: "モンテカルロ" },
  { key: "buyAndHold", label: "バイ&ホールド" },
] as const;

/** レポートに各ツール結果が載っている段階数（実行完了ツール数の目安） */
function countCompletedTools(report?: ConsolidatedValidationReport | null): number {
  if (!report) return 0;
  let n = 0;
  if (report.screening !== undefined) n++;
  if (report.walkForward !== undefined) n++;
  if (report.monteCarlo !== undefined) n++;
  if (report.buyAndHold !== undefined) n++;
  return n;
}

export interface ValidationProgressBarProps {
  hypothesisId: string;
  status: EdgeStatus;
  report?: ConsolidatedValidationReport | null;
  /** 検証開始の目安（経過表示用・任意） */
  startedAtIso?: string | null;
  className?: string;
}

export function ValidationProgressBar({
  hypothesisId,
  status,
  report,
  startedAtIso,
  className,
}: ValidationProgressBarProps) {
  const isTesting = status === "testing";
  const completed = countCompletedTools(report);
  const pct =
    !isTesting && (status === "confirmed" || status === "rejected")
      ? 100
      : isTesting
        ? Math.min(95, Math.max(8, (completed / 4) * 100))
        : (completed / 4) * 100;

  // 検証中は 900ms ごとに「現在の経過秒数」を再計算する。
  // useMemo 内で Date.now() を直接呼ぶと react-hooks/purity に違反するため、
  // state に保持して effect 内で更新する。
  const [elapsedLabel, setElapsedLabel] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!startedAtIso) {
      setElapsedLabel(null);
      return;
    }
    const startedMs = new Date(startedAtIso).getTime();
    if (Number.isNaN(startedMs)) {
      setElapsedLabel(null);
      return;
    }
    const update = () => {
      const sec = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      setElapsedLabel(m > 0 ? `${m}分${s}秒` : `${s}秒`);
    };
    update();
    if (!isTesting) return;
    const id = window.setInterval(update, 900);
    return () => window.clearInterval(id);
  }, [startedAtIso, isTesting]);

  return (
    <div
      className={cn("rounded-xl border border-slate-700 bg-slate-800/50 p-3", className)}
      data-testid={`validation-progress-${hypothesisId}`}
    >
      <div className="flex items-center justify-between text-[11px] text-gray-400 mb-2">
        <span className="truncate">仮説 {hypothesisId.slice(0, 8)}…</span>
        {elapsedLabel && <span>経過 {elapsedLabel}</span>}
      </div>
      <Progress value={pct} className="h-2 mb-3" />
      <ol className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px]">
        {STEPS.map((step, i) => {
          const done =
            !isTesting && (status === "confirmed" || status === "rejected")
              ? true
              : i < completed;
          const active = isTesting && i === completed;
          return (
            <li
              key={step.key}
              className={cn(
                "rounded-md px-1.5 py-1 text-center border",
                done
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : active
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-200 animate-pulse"
                    : "border-slate-700 text-gray-500",
              )}
            >
              {step.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
