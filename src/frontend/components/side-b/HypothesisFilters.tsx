/**
 * HypothesisFilters - 仮説一覧のフィルタ UI（仕様書 §4.2）
 *
 * ステータス / カテゴリ / ソース はマルチセレクト（チップトグル）。
 * シンボル / 検索はテキスト入力。ソートはセレクト。
 *
 * 親コンポーネントが state を持つ（controlled）。本コンポーネントは純粋な
 * Presenter で、変更は `onChange` で親に返す。URL 同期は親ページが担当。
 *
 * 確信度順は現時点未対応（HypothesisListSortKey は newest/oldest/observation のみ）。
 */

"use client";

import * as React from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
    EDGE_STATUSES,
    EDGE_CATEGORIES,
    EDGE_SOURCES,
    type EdgeStatus,
    type EdgeCategory,
    type EdgeSource,
    type HypothesisListParams,
    type HypothesisListSortKey,
} from "@/types/sideB";
import { STATUS_BADGE_LABEL } from "@/components/side-b/StatusBadge";

// ===========================================
// ラベル
// ===========================================

const CATEGORY_LABEL: Record<EdgeCategory, string> = {
    time: "時間",
    level: "レベル",
    event: "イベント",
    correlation: "相関",
    positioning: "ポジショニング",
    volatility: "ボラ",
    structure: "構造",
    other: "その他",
};

const SOURCE_LABEL: Record<EdgeSource, string> = {
    ai_generated: "AI 生成",
    reflection: "振り返り",
    user_input: "手入力",
    backtest: "バックテスト",
    discovery: "Discovery",
};

const SORT_OPTIONS: Array<{ value: HypothesisListSortKey; label: string }> = [
    { value: "newest", label: "最新順" },
    { value: "oldest", label: "古い順" },
    { value: "observation", label: "観測数順" },
    // 'confidence' は confidence スコア未設計のため未掲載 (仕様書 §4.2 / future work)
];

// ===========================================
// Props
// ===========================================

export interface HypothesisFiltersProps {
    value: HypothesisListParams;
    onChange: (next: HypothesisListParams) => void;
    className?: string;
}

// ===========================================
// 小コンポーネント: 多選択チップ
// ===========================================

interface ToggleChipProps {
    active: boolean;
    onClick: () => void;
    label: string;
    testId?: string;
}

function ToggleChip({ active, onClick, label, testId }: ToggleChipProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            data-testid={testId}
            data-active={active}
            className={cn(
                "px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors",
                active
                    ? "bg-pink-500/20 text-pink-200 border-pink-500/40"
                    : "bg-slate-800/50 text-gray-400 border-slate-700 hover:text-white",
            )}
        >
            {label}
        </button>
    );
}

// ===========================================
// 本体
// ===========================================

function toggleArrayMember<T>(arr: T[] | undefined, value: T): T[] {
    const set = new Set(arr ?? []);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    return Array.from(set);
}

export function HypothesisFilters({
    value,
    onChange,
    className,
}: HypothesisFiltersProps) {
    // フィルタ変更時は page を 1 に戻す（他フィルタでの現在ページを引き継がない）
    const update = (patch: Partial<HypothesisListParams>) => {
        onChange({ ...value, ...patch, page: patch.page ?? 1 });
    };

    const [symbolDraft, setSymbolDraft] = React.useState<string>(
        value.symbols?.join(", ") ?? "",
    );

    // 親から value.symbols が更新された場合に draft を同期（URL 直接操作対応）
    React.useEffect(() => {
        setSymbolDraft(value.symbols?.join(", ") ?? "");
    }, [value.symbols]);

    const commitSymbols = () => {
        const parsed = symbolDraft
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean);
        update({ symbols: parsed.length > 0 ? parsed : undefined });
    };

    const clearAll = () => {
        onChange({ page: 1, limit: value.limit });
    };

    return (
        <div
            data-testid="hypothesis-filters"
            className={cn(
                "flex flex-col gap-3 p-3 sm:p-4 rounded-xl border border-slate-700 bg-slate-800/60",
                className,
            )}
        >
            {/* 検索 + ソート */}
            <div className="flex flex-col sm:flex-row gap-2">
                <input
                    type="search"
                    value={value.search ?? ""}
                    onChange={(e) => update({ search: e.target.value || undefined })}
                    placeholder="statement を検索…"
                    data-testid="filter-search"
                    className={cn(
                        "flex-1 min-w-0 px-3 py-1.5 rounded-lg text-sm",
                        "bg-slate-900/60 border border-slate-700 text-gray-100",
                        "placeholder:text-gray-500",
                        "focus:outline-none focus:border-pink-500/50",
                    )}
                />
                <select
                    value={value.sortBy ?? "newest"}
                    onChange={(e) =>
                        update({ sortBy: e.target.value as HypothesisListSortKey })
                    }
                    data-testid="filter-sort"
                    className={cn(
                        "px-3 py-1.5 rounded-lg text-sm",
                        "bg-slate-900/60 border border-slate-700 text-gray-100",
                        "focus:outline-none focus:border-pink-500/50",
                    )}
                >
                    {SORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
            </div>

            {/* ステータス */}
            <FilterRow label="ステータス">
                {EDGE_STATUSES.map((s) => (
                    <ToggleChip
                        key={s}
                        active={value.statuses?.includes(s) ?? false}
                        onClick={() =>
                            update({
                                statuses: normalize(toggleArrayMember(value.statuses, s)),
                            })
                        }
                        label={STATUS_BADGE_LABEL[s]}
                        testId={`filter-status-${s}`}
                    />
                ))}
            </FilterRow>

            {/* カテゴリ */}
            <FilterRow label="カテゴリ">
                {EDGE_CATEGORIES.map((c) => (
                    <ToggleChip
                        key={c}
                        active={value.categories?.includes(c) ?? false}
                        onClick={() =>
                            update({
                                categories: normalize(toggleArrayMember(value.categories, c)),
                            })
                        }
                        label={CATEGORY_LABEL[c]}
                        testId={`filter-category-${c}`}
                    />
                ))}
            </FilterRow>

            {/* ソース */}
            <FilterRow label="ソース">
                {EDGE_SOURCES.map((s) => (
                    <ToggleChip
                        key={s}
                        active={value.sources?.includes(s) ?? false}
                        onClick={() =>
                            update({
                                sources: normalize(toggleArrayMember(value.sources, s)),
                            })
                        }
                        label={SOURCE_LABEL[s]}
                        testId={`filter-source-${s}`}
                    />
                ))}
            </FilterRow>

            {/* シンボル */}
            <FilterRow label="シンボル">
                <input
                    type="text"
                    value={symbolDraft}
                    onChange={(e) => setSymbolDraft(e.target.value)}
                    onBlur={commitSymbols}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            commitSymbols();
                        }
                    }}
                    placeholder="XAU/USD, EUR/USD"
                    data-testid="filter-symbols"
                    className={cn(
                        "flex-1 min-w-0 px-3 py-1 rounded-lg text-xs",
                        "bg-slate-900/60 border border-slate-700 text-gray-100",
                        "placeholder:text-gray-500",
                        "focus:outline-none focus:border-pink-500/50",
                    )}
                />
            </FilterRow>

            {/* クリア */}
            <div className="flex justify-end">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={clearAll}
                    data-testid="filter-clear"
                >
                    クリア
                </Button>
            </div>
        </div>
    );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-start gap-2">
            <span className="text-[11px] text-gray-500 sm:w-20 sm:pt-1 flex-shrink-0">
                {label}
            </span>
            <div className="flex flex-wrap gap-1.5 flex-1">{children}</div>
        </div>
    );
}

/** 空配列を undefined に畳む（URL / API 的に "未指定 = 全件" を表現するため） */
function normalize<T>(arr: T[]): T[] | undefined {
    return arr.length === 0 ? undefined : arr;
}
