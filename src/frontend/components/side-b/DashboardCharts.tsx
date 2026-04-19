/**
 * 台帳ダッシュボード用チャート群（Phase 4d §4.6）
 *
 * Recharts は既存依存。Neon Dark に合わせた色設定。
 */

"use client";

import * as React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

import { Card } from "@/components/ui/Card";
import type {
  StatsTimeSeriesResponse,
  StatsByCategoryResponse,
  StatsValidationActivityResponse,
} from "@/types/sideB";

const AXIS = { stroke: "#64748b", fontSize: 10 };
const GRID = { stroke: "#334155", strokeDasharray: "3 3" as const };
const COLORS = ["#a855f7", "#22d3ee", "#34d399", "#f472b6", "#fbbf24", "#94a3b8"];

export interface DashboardChartsProps {
  timeSeries: StatsTimeSeriesResponse | null;
  byCategory: StatsByCategoryResponse | null;
  activity: StatsValidationActivityResponse | null;
  loading?: boolean;
}

export function DashboardCharts({
  timeSeries,
  byCategory,
  activity,
  loading,
}: DashboardChartsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-64 rounded-xl bg-slate-800/50 animate-pulse border border-slate-700/40" />
        ))}
      </div>
    );
  }

  const tsPointsRaw =
    timeSeries?.points.map((p) => ({
      label: p.periodStart.slice(0, 7),
      count: p.confirmedCount,
    })) ?? [];
  const tsPoints =
    tsPointsRaw.length > 0 ? tsPointsRaw : [{ label: "—", count: 0 }];

  const catData =
    byCategory?.categories.map((c) => ({
      name: c.category,
      value: c.confirmedCount,
    })) ?? [];

  const pieFallback =
    catData.length === 0 ? [{ name: "データなし", value: 1 }] : catData;

  const actPoints = activity?.points ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4 bg-slate-800/40 border-slate-700">
        <h3 className="text-xs font-semibold text-gray-300 mb-2">confirmed 件数（時系列）</h3>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={tsPoints} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="label" tick={AXIS} />
              <YAxis tick={AXIS} width={32} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #475569" }}
                labelStyle={{ color: "#e2e8f0" }}
              />
              <Line type="monotone" dataKey="count" stroke="#c084fc" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4 bg-slate-800/40 border-slate-700">
        <h3 className="text-xs font-semibold text-gray-300 mb-2">カテゴリ別 confirmed</h3>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieFallback}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={70}
                label={({ name, value }) => `${name}: ${value}`}
              >
                {pieFallback.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #475569" }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4 bg-slate-800/40 border-slate-700 lg:col-span-2">
        <h3 className="text-xs font-semibold text-gray-300 mb-2">検証実行件数（日別）</h3>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={actPoints} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="date" tick={AXIS} />
              <YAxis tick={AXIS} width={32} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #475569" }}
              />
              <Bar dataKey="count" fill="#22d3ee" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
