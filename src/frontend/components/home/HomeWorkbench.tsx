"use client";

/**
 * Side-A ホーム（P2 ワークベンチ）
 * @see docs/design/tradeassist_uiux_redesign_plan.md §4-3
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import OnboardingIntro from "@/components/OnboardingIntro";
import { NeonCard, GlowColor } from "@/components/ui/NeonCard";
import {
  fetchNoteStatusCounts,
  fetchNotes,
  fetchUnreadNotificationCount,
  fetchLatestPipelineRun,
} from "@/lib/api";
import type { PipelineRunDTO } from "@/lib/api";
import { readLastSideAPath } from "@/lib/lastSideAPath";
import { sideBApi } from "@/lib/sideBApi";
import type { NoteSummary } from "@/types/note";

function formatDateShort(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  } catch {
    return "";
  }
}

export default function HomeWorkbench() {
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [aiPendingCount, setAiPendingCount] = useState<number | null>(null);
  const [recentNotes, setRecentNotes] = useState<NoteSummary[]>([]);
  const [latestRun, setLatestRun] = useState<PipelineRunDTO | null>(null);
  const [lastPath, setLastPath] = useState<ReturnType<typeof readLastSideAPath>>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // localStorage は SSR 中に存在しないため client mount 後に読む。
    // 「外部システム (= localStorage) からの 1 回読み込み + 同期」であり、
    // react-hooks/set-state-in-effect の禁止意図 (cascading renders) には該当しない。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastPath(readLastSideAPath());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadError(null);
      const settled = await Promise.allSettled([
        fetchNoteStatusCounts(),
        fetchUnreadNotificationCount(),
        sideBApi.getPendingValidation(),
        fetchNotes({ limit: 5 }),
        fetchLatestPipelineRun(),
      ]);
      if (cancelled) return;

      const [countsR, unreadR, pendingR, notesR, runR] = settled;

      if (countsR.status === "fulfilled") {
        setDraftCount(countsR.value.draft ?? 0);
      } else {
        setDraftCount(null);
        console.error(countsR.reason);
      }

      if (unreadR.status === "fulfilled") {
        setUnreadCount(unreadR.value);
      } else {
        setUnreadCount(null);
        console.error(unreadR.reason);
      }

      if (pendingR.status === "fulfilled") {
        setAiPendingCount(pendingR.value.length);
      } else {
        setAiPendingCount(null);
        console.error(pendingR.reason);
      }

      if (notesR.status === "fulfilled") {
        setRecentNotes(notesR.value.notes ?? []);
      } else {
        setRecentNotes([]);
        console.error(notesR.reason);
      }

      if (runR.status === "fulfilled") {
        setLatestRun(runR.value);
      } else {
        setLatestRun(null);
        console.error(runR.reason);
      }

      const failed = settled.filter((s) => s.status === "rejected").length;
      if (failed === settled.length) {
        setLoadError("データを取得できませんでした。しばらくしてから再読み込みしてください。");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const primaryCta: { href: string; icon: string; title: string; desc: string }[] = [
    {
      href: "/notes",
      icon: "✍️",
      title: "トレードノート",
      desc: "一覧・下書きの確認・承認",
    },
    {
      href: "/market-analysis",
      icon: "📈",
      title: "市場を見る",
      desc: "チャート・分析",
    },
    {
      href: "/strategies",
      icon: "🎯",
      title: "ストラテジーを確認",
      desc: "ルール・シグナル",
    },
  ];

  const secondaryLinks: { href: string; icon: string; title: string; color: GlowColor }[] = [
    { href: "/import", icon: "📥", title: "トレード取込", color: "green" },
    { href: "/data-presets", icon: "📁", title: "データプリセット", color: "orange" },
    { href: "/settings", icon: "⚙️", title: "設定", color: "slate" },
  ];

  return (
    <div className="min-h-screen">
      <main className="max-w-3xl w-full mx-auto px-4 py-8 sm:py-10">
        <OnboardingIntro />

        <div className="text-center mb-8 sm:mb-10 animate-fade-in">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
            <span className="neon-text">TradeAssist</span>
          </h1>
          <p className="text-sm text-gray-400 tracking-wide">今日の作業をここから始められます</p>
          <div className="mt-3 mx-auto w-16 h-0.5 rounded-full bg-gradient-to-r from-pink-500 to-violet-500 opacity-60" />
        </div>

        {loadError && (
          <p className="mb-4 text-center text-sm text-amber-400/90" role="alert">
            {loadError}
          </p>
        )}

        {/* 上段: サマリー KPI */}
        <section className="mb-8" aria-label="サマリー">
          <h2 className="sr-only">要確認サマリー</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              label="下書きノート"
              value={draftCount}
              hint="承認待ち"
            />
            <KpiCard label="未読通知" value={unreadCount} hint="通知一覧へ" />
            <KpiCard label="AI 要確認" value={aiPendingCount} hint="Side-B 検証" />
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
              <p className="text-xs text-gray-500 mb-1">今日の注目</p>
              <p className="text-sm text-gray-200 leading-snug line-clamp-3">
                市場の状態はチャートで確認できます
              </p>
              <Link
                href="/market-analysis"
                className="mt-2 inline-block text-xs text-cyan-400 hover:text-cyan-300"
              >
                チャートを開く →
              </Link>
            </div>
          </div>
        </section>

        {/* マッチング稼働状況（最新 pipeline run） */}
        <section className="mb-8" aria-label="マッチング稼働状況">
          <h2 className="text-sm font-semibold text-gray-400 mb-3 px-1">マッチングの稼働状況</h2>
          <PipelineRunCard run={latestRun} />
        </section>

        {/* 中段: 主要3導線 */}
        <section className="mb-8" aria-label="主要な作業">
          <h2 className="text-sm font-semibold text-gray-400 mb-3 px-1">まずはここから</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 stagger-children">
            {primaryCta.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group block rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-800/40 p-4 transition hover:border-cyan-500/30 hover:shadow-lg hover:shadow-cyan-500/10"
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl" aria-hidden>
                    {item.icon}
                  </span>
                  <div>
                    <p className="font-semibold text-white group-hover:text-cyan-100">{item.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* 前回の続き */}
        {lastPath && (
          <section
            className="mb-8 rounded-2xl border border-violet-500/20 bg-violet-950/20 px-4 py-4"
            data-testid="home-last-continue"
          >
            <h2 className="text-sm font-semibold text-violet-200 mb-2">前回の続き</h2>
            <p className="text-xs text-gray-500 mb-2 truncate" title={lastPath.path}>
              {lastPath.path}
            </p>
            <Link
              href={lastPath.path}
              className="inline-flex items-center text-sm font-medium text-violet-300 hover:text-violet-200"
            >
              続きから開く →
            </Link>
            <p className="mt-2 text-[11px] text-gray-600">
              表示できない場合は{" "}
              <Link href="/" className="text-gray-500 underline hover:text-gray-400">
                ホーム
              </Link>
              へ
            </p>
          </section>
        )}

        {/* 最近のノート */}
        <section className="mb-8" aria-label="最近のノート">
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-sm font-semibold text-gray-400">最近のノート</h2>
            <Link href="/notes" className="text-xs text-cyan-400 hover:text-cyan-300">
              一覧へ
            </Link>
          </div>
          {recentNotes.length === 0 ? (
            <p className="text-sm text-gray-500 px-1 py-4 rounded-xl border border-dashed border-white/10 text-center">
              まだノートがありません。取込または手入力で作成できます。
            </p>
          ) : (
            <ul className="space-y-2">
              {recentNotes.map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/notes/${n.id}`}
                    className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-3 py-2.5 text-sm hover:border-cyan-500/20 hover:bg-white/10"
                  >
                    <span className="font-medium text-gray-200">
                      {n.symbol}{" "}
                      <span className="text-gray-500 font-normal">
                        {n.side === "buy" ? "買" : "売"}
                      </span>
                    </span>
                    <span className="text-xs text-gray-500">{formatDateShort(n.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* その他のツール（コンパクト） */}
        <section aria-label="その他">
          <h2 className="text-sm font-semibold text-gray-400 mb-3 px-1">その他</h2>
          <div className="grid grid-cols-2 gap-3 p-4 rounded-3xl glass-surface stagger-children">
            {secondaryLinks.map((item) => (
              <NeonCard
                key={item.href}
                href={item.href}
                icon={item.icon}
                title={item.title}
                color={item.color}
                className={`animate-slide-up ${item.href === "/settings" ? "col-span-2" : ""}`}
              />
            ))}
          </div>
        </section>

        <div className="text-center mt-8 text-xs text-gray-600 animate-fade-in">
          <p>TradeAssist</p>
        </div>
      </main>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | null;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-semibold text-white tabular-nums">
        {value === null ? "—" : value}
      </p>
      <p className="text-[10px] text-gray-600 mt-0.5">{hint}</p>
    </div>
  );
}

/** pipeline run の status を非エンジニア向けラベルと色に変換 */
function runStatusMeta(status: PipelineRunDTO["status"]): { label: string; className: string } {
  switch (status) {
    case "success":
      return { label: "正常", className: "text-green-400 border-green-600/30 bg-green-600/10" };
    case "skipped":
      return { label: "休場でスキップ", className: "text-slate-300 border-slate-500/30 bg-slate-600/10" };
    case "partial_failure":
      return { label: "一部失敗", className: "text-yellow-400 border-yellow-600/30 bg-yellow-600/10" };
    case "failed":
      return { label: "失敗", className: "text-red-400 border-red-600/30 bg-red-600/10" };
    default:
      return { label: status, className: "text-gray-300 border-white/10 bg-white/5" };
  }
}

/** 最新のマッチング実行状況カード（run が無ければプレースホルダ） */
function PipelineRunCard({ run }: { run: PipelineRunDTO | null }) {
  if (!run) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-gray-500">
        まだ実行記録がありません。市場が開いている時間に自動でマッチングが実行されると、ここに最新状況が表示されます。
      </div>
    );
  }

  const meta = runStatusMeta(run.status);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-sm text-gray-300">
          最終実行 {formatDateShort(run.startedAt)}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${meta.className}`}>
          {meta.label}
        </span>
      </div>
      {run.status === "skipped" ? (
        <p className="text-sm text-gray-400">{run.marketStatus ?? "市場休場のためスキップしました"}</p>
      ) : (
        <p className="text-sm text-gray-300 tabular-nums">
          マッチ {run.totalMatches} 件 ・ 通知 {run.notified} 件 ・ スキップ {run.skipped} 件
        </p>
      )}
      {run.errorCount > 0 && run.errors.length > 0 && (
        <p className="mt-1 text-xs text-red-400/90 line-clamp-2">{run.errors[0]}</p>
      )}
    </div>
  );
}
