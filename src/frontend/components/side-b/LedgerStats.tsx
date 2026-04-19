/**
 * 台帳 KPI カード行（Phase 4d §4.5 / §4.6）
 */

"use client";

import * as React from "react";

import { Card } from "@/components/ui/Card";
import type { StatsOverviewResponse } from "@/types/sideB";

export interface LedgerStatsProps {
  overview: StatsOverviewResponse | null;
  loading?: boolean;
  error?: string | null;
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export function LedgerStats({ overview, loading, error }: LedgerStatsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-xl bg-slate-800/60 animate-pulse border border-slate-700/50"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-xl border border-red-500/40 bg-red-500/10 text-sm text-red-200">
        {error}
      </div>
    );
  }

  if (!overview) return null;

  const growth =
    overview.confirmedGrowthRate !== null && overview.confirmedGrowthRate !== undefined
      ? `${overview.confirmedGrowthRate >= 0 ? "+" : ""}${(overview.confirmedGrowthRate * 100).toFixed(0)}%`
      : "—";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Card className="p-4 border-purple-500/30 bg-gradient-to-br from-purple-500/10 to-slate-900/60">
        <p className="text-[11px] text-gray-400 mb-1">総仮説数</p>
        <p className="text-2xl font-bold text-white tabular-nums">{overview.totalHypotheses}</p>
      </Card>
      <Card className="p-4 border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-slate-900/60">
        <p className="text-[11px] text-gray-400 mb-1">confirmed（先週比）</p>
        <p className="text-2xl font-bold text-emerald-300 tabular-nums">
          {overview.confirmedCount}
        </p>
        <p className="text-[10px] text-gray-500 mt-1">週次昇格: {growth}</p>
      </Card>
      <Card className="p-4 border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 to-slate-900/60">
        <p className="text-[11px] text-gray-400 mb-1">今週の新規仮説</p>
        <p className="text-2xl font-bold text-cyan-300 tabular-nums">
          {overview.newHypothesesThisWeek}
        </p>
      </Card>
      <Card className="p-4 border-pink-500/30 bg-gradient-to-br from-pink-500/10 to-slate-900/60">
        <p className="text-[11px] text-gray-400 mb-1">直近検証成功率（7日）</p>
        <p className="text-2xl font-bold text-pink-300 tabular-nums">
          {pct(overview.recentValidationSuccessRate)}
        </p>
      </Card>
    </div>
  );
}
