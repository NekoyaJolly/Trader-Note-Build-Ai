/**
 * 仮説一覧の表示・URL 同期・ページネーション（Phase 4d §4.2）
 *
 * ページ本体は薄く保ち、本コンポーネントに一覧 UI を集約する。
 */

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { HypothesisCard } from "@/components/side-b/HypothesisCard";
import { HypothesisFilters } from "@/components/side-b/HypothesisFilters";
import { sideBApi, SideBApiError } from "@/lib/sideBApi";
import type {
    EdgeHypothesis,
    HypothesisListParams,
    HypothesisListSortKey,
    EdgeStatus,
    EdgeCategory,
    EdgeSource,
} from "@/types/sideB";
import {
    EDGE_STATUSES,
    EDGE_CATEGORIES,
    EDGE_SOURCES,
} from "@/types/sideB";

// ===========================================
// URL <-> HypothesisListParams
// ===========================================

const SORT_KEYS: HypothesisListSortKey[] = ["newest", "oldest", "observation"];

function parseSearchParams(sp: URLSearchParams): HypothesisListParams {
    const split = (v: string | null) =>
        v
            ? v.split(",").map((x) => x.trim()).filter(Boolean)
            : undefined;

    const statuses = split(sp.get("status"))?.filter(
        (v): v is EdgeStatus => (EDGE_STATUSES as string[]).includes(v),
    );
    const categories = split(sp.get("category"))?.filter(
        (v): v is EdgeCategory => (EDGE_CATEGORIES as string[]).includes(v),
    );
    const sources = split(sp.get("source"))?.filter(
        (v): v is EdgeSource => (EDGE_SOURCES as string[]).includes(v),
    );
    const symbols = split(sp.get("symbol"));
    const search = sp.get("search") ?? undefined;
    const rawSort = sp.get("sortBy");
    const sortBy: HypothesisListSortKey | undefined =
        rawSort && SORT_KEYS.includes(rawSort as HypothesisListSortKey)
            ? (rawSort as HypothesisListSortKey)
            : undefined;
    const page = Number.parseInt(sp.get("page") ?? "", 10);
    const limit = Number.parseInt(sp.get("limit") ?? "", 10);

    return {
        statuses: statuses?.length ? statuses : undefined,
        categories: categories?.length ? categories : undefined,
        sources: sources?.length ? sources : undefined,
        symbols: symbols?.length ? symbols : undefined,
        search: search && search.trim() ? search : undefined,
        sortBy,
        page: Number.isFinite(page) && page > 0 ? page : undefined,
        limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    };
}

function toUrlQuery(params: HypothesisListParams): string {
    const sp = new URLSearchParams();
    const putArr = (k: string, v?: readonly string[]) => {
        if (v && v.length > 0) sp.set(k, v.join(","));
    };
    putArr("status", params.statuses);
    putArr("category", params.categories);
    putArr("source", params.sources);
    putArr("symbol", params.symbols);
    if (params.search && params.search.trim()) sp.set("search", params.search);
    if (params.sortBy && params.sortBy !== "newest") sp.set("sortBy", params.sortBy);
    if (params.page && params.page > 1) sp.set("page", String(params.page));
    if (params.limit && params.limit !== 20) sp.set("limit", String(params.limit));
    const s = sp.toString();
    return s ? `?${s}` : "";
}

// ===========================================
// 公開コンポーネント
// ===========================================

/** Suspense fallback 用スケルトン */
export function HypothesisListSkeleton() {
    return (
        <div className="min-h-screen bg-slate-900 text-gray-100">
            <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
                <Skeleton className="h-8 w-40 mb-4" />
                <Skeleton className="h-32 w-full mb-4 rounded-xl" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-28 rounded-xl" />
                    ))}
                </div>
            </main>
        </div>
    );
}

/** 仮説一覧（`useSearchParams` 利用のため親で Suspense 必須） */
export function HypothesisList() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const [filters, setFilters] = React.useState<HypothesisListParams>(() =>
        parseSearchParams(new URLSearchParams(searchParams.toString())),
    );

    const [items, setItems] = React.useState<EdgeHypothesis[]>([]);
    const [total, setTotal] = React.useState(0);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        const currentQuery = searchParams.toString();
        const nextQuery = toUrlQuery(filters).replace(/^\?/, "");
        if (currentQuery !== nextQuery) {
            router.replace(`${pathname}${nextQuery ? `?${nextQuery}` : ""}`, {
                scroll: false,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters]);

    React.useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        sideBApi
            .listHypotheses(filters)
            .then((res) => {
                if (cancelled) return;
                setItems(res.hypotheses);
                setTotal(res.total);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const msg = err instanceof SideBApiError ? err.message : String(err);
                setError(msg);
                setItems([]);
                setTotal(0);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [filters]);

    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const pageCount = Math.max(1, Math.ceil(total / limit));
    const goToPage = (p: number) => {
        setFilters({ ...filters, page: Math.max(1, Math.min(pageCount, p)) });
    };

    return (
        <div className="min-h-screen bg-slate-900 text-gray-100">
            <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
                <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold text-white">
                            仮説一覧
                        </h1>
                        <p className="text-xs text-gray-400 mt-0.5">
                            エッジ台帳 (EdgeLedger) に登録された全仮説
                        </p>
                    </div>
                    <Link
                        href="/side-b"
                        className="text-xs text-gray-400 hover:text-white transition-colors"
                    >
                        ← Side-B TOP
                    </Link>
                </div>

                <div className="mb-4">
                    <HypothesisFilters value={filters} onChange={setFilters} />
                </div>

                <div
                    className="flex items-center justify-between text-xs text-gray-500 mb-3"
                    data-testid="list-summary"
                >
                    <span>
                        {loading ? "読み込み中…" : `${total} 件`}
                    </span>
                    {!loading && total > 0 && (
                        <span>
                            {(page - 1) * limit + 1} – {Math.min(page * limit, total)} 件目
                        </span>
                    )}
                </div>

                {error ? (
                    <div
                        role="alert"
                        data-testid="list-error"
                        className="p-4 rounded-xl border border-red-500/40 bg-red-500/10 text-sm text-red-200"
                    >
                        <p className="font-semibold mb-1">読み込みに失敗しました</p>
                        <p className="text-xs text-red-300 mb-3">{error}</p>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setFilters({ ...filters })}
                        >
                            再試行
                        </Button>
                    </div>
                ) : loading ? (
                    <ListSkeleton />
                ) : items.length === 0 ? (
                    <EmptyState hasFilters={hasActiveFilters(filters)} />
                ) : (
                    <>
                        <div
                            data-testid="list-grid"
                            className="grid grid-cols-1 md:grid-cols-2 gap-3"
                        >
                            {items.map((h) => (
                                <HypothesisCard
                                    key={h.id}
                                    hypothesis={h}
                                    href={`/side-b/hypotheses/${h.id}`}
                                />
                            ))}
                        </div>

                        {pageCount > 1 && (
                            <Pagination
                                page={page}
                                pageCount={pageCount}
                                onChange={goToPage}
                            />
                        )}
                    </>
                )}
            </main>
        </div>
    );
}

// ===========================================
// 内部
// ===========================================

function ListSkeleton() {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="list-skeleton">
            {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
        </div>
    );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
    return (
        <div
            className="p-8 text-center rounded-xl border border-slate-700 bg-slate-800/40"
            data-testid="list-empty"
        >
            <p className="text-sm text-gray-300 mb-2">
                {hasFilters
                    ? "条件に一致する仮説はありませんでした"
                    : "まだ仮説が登録されていません"}
            </p>
            {!hasFilters && (
                <p className="text-xs text-gray-500">
                    Discovery AI や Hypothesis Generator が実行されると、
                    ここに仮説が追加されていきます。
                </p>
            )}
        </div>
    );
}

function Pagination({
    page,
    pageCount,
    onChange,
}: {
    page: number;
    pageCount: number;
    onChange: (p: number) => void;
}) {
    return (
        <div
            className="flex items-center justify-center gap-2 mt-4"
            data-testid="list-pagination"
        >
            <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => onChange(page - 1)}
            >
                前へ
            </Button>
            <span className="text-xs text-gray-400 min-w-[4rem] text-center">
                {page} / {pageCount}
            </span>
            <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => onChange(page + 1)}
            >
                次へ
            </Button>
        </div>
    );
}

function hasActiveFilters(f: HypothesisListParams): boolean {
    return Boolean(
        (f.statuses && f.statuses.length > 0) ||
        (f.categories && f.categories.length > 0) ||
        (f.sources && f.sources.length > 0) ||
        (f.symbols && f.symbols.length > 0) ||
        (f.search && f.search.trim()),
    );
}
