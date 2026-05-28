/**
 * DiscoveryFunnelPanel — Step D-4b
 *
 * DiscoveryAgent が組成した仮説 (source='discovery') のライフサイクル funnel を可視化する
 * 観測導線。「組成 (unverified) → screening_passed → testing → confirmed / rejected」の
 * status 別件数と直近サンプル (symbol / timeframe 付き) を表示する。
 *
 * 組成は `DISCOVERY_COMPOSE_ENABLED` ゲート (既定 OFF) で動くため、無効時は total=0 になる。
 */

"use client";

import * as React from "react";
import Link from "next/link";

import { Card } from "@/components/ui/Card";
import { parseEvolutionStatement } from "@/lib/evolutionStatement";
import type { DiscoveryFunnelResponse, EdgeStatus } from "@/types/sideB";

/** funnel をライフサイクル順に並べるための定義 (label + 色)。 */
const FUNNEL_STAGES: ReadonlyArray<{ status: EdgeStatus; label: string; cls: string }> = [
  { status: "unverified", label: "組成 (未検証)", cls: "text-gray-300 border-gray-600" },
  { status: "screening_passed", label: "スクリーニング通過", cls: "text-sky-300 border-sky-700" },
  { status: "testing", label: "検証中", cls: "text-indigo-300 border-indigo-700" },
  { status: "confirmed", label: "確定 (採用)", cls: "text-emerald-300 border-emerald-700" },
  { status: "rejected", label: "棄却", cls: "text-red-300 border-red-700" },
];

/** ライフサイクル外の補助 status (件数がある時だけ表示)。 */
const AUX_STATUSES: ReadonlyArray<{ status: EdgeStatus; label: string }> = [
  { status: "not_testable", label: "検証不能" },
  { status: "insufficient_data", label: "データ不足" },
  { status: "stale", label: "劣化" },
];

export function DiscoveryFunnelPanel({
  funnel,
}: {
  funnel: DiscoveryFunnelResponse | null;
}): React.JSX.Element {
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-300 mb-2">
        Discovery 組成 funnel
      </h2>
      <Card className="p-4 text-xs text-gray-300 space-y-3">
        {funnel ? (
          funnel.total === 0 ? (
            <p className="text-gray-500">
              discovery 由来の組成仮説はまだありません
              （組成は DISCOVERY_COMPOSE_ENABLED が有効な時のみ動作します）。
            </p>
          ) : (
            <>
              <p className="text-gray-400">
                組成仮説 合計:{" "}
                <span className="text-white font-medium">{funnel.total}</span> 件
              </p>
              <div className="flex flex-wrap gap-2">
                {FUNNEL_STAGES.map((stage) => (
                  <div
                    key={stage.status}
                    className={`rounded border px-2 py-1 ${stage.cls}`}
                  >
                    <span className="opacity-70">{stage.label}</span>{" "}
                    <span className="font-semibold">
                      {funnel.byStatus[stage.status] ?? 0}
                    </span>
                  </div>
                ))}
              </div>
              {AUX_STATUSES.some((a) => (funnel.byStatus[a.status] ?? 0) > 0) && (
                <div className="flex flex-wrap gap-2 text-gray-500">
                  {AUX_STATUSES.filter((a) => (funnel.byStatus[a.status] ?? 0) > 0).map(
                    (a) => (
                      <span key={a.status}>
                        {a.label}: {funnel.byStatus[a.status] ?? 0}
                      </span>
                    ),
                  )}
                </div>
              )}
              {funnel.recent.length > 0 && (
                <div className="space-y-1">
                  <p className="text-gray-500">直近の組成仮説</p>
                  <ul className="list-disc list-inside text-gray-400 space-y-1">
                    {funnel.recent.map((h) => {
                      const t = parseEvolutionStatement(h.statement).displayText;
                      const tf =
                        h.timeframes.length > 0 ? h.timeframes.join("/") : "?";
                      const sym = h.symbols.length > 0 ? h.symbols.join(",") : "?";
                      return (
                        <li key={h.id}>
                          <span className="text-gray-600">
                            [{sym} {tf}]
                          </span>{" "}
                          <Link
                            href={`/side-b/hypotheses/${h.id}`}
                            className="text-cyan-400 hover:underline"
                          >
                            {t.length > 40 ? t.slice(0, 40) + "…" : t}
                          </Link>
                          <span className="text-gray-600"> ({h.status})</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )
        ) : (
          <p className="text-gray-500">読み込み中…</p>
        )}
      </Card>
    </section>
  );
}
