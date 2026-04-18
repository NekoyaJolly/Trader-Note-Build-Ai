/**
 * HypothesisCard - 仮説カード（仕様書 §4.2 / §4.6）
 *
 * 使途:
 *   - `/side-b/hypotheses` 一覧画面での各仮説の一行表示
 *   - `/side-b/validation` の検証待ちセクション
 *   - ダッシュボードの「最近の仮説」セクション（variant=compact）
 *
 * 表示要素（仕様書 §4.2）:
 *   - ステータスバッジ
 *   - カテゴリバッジ
 *   - statement（40 文字まで短縮）
 *   - ソース表示
 *   - 観測数 / 勝率 / PF（あれば）
 *   - 最終検証日時
 *
 * Props 設計の注意:
 *   `HypothesisListItem`（pending-validation 応答）は EdgeHypothesis の部分集合
 *   で status / observationCount 等を持たないため、本コンポーネントは
 *   必須フィールドを最小限に絞り、任意フィールドは undefined 許容で受け取る。
 *   full な EdgeHypothesis も型互換でそのまま渡せる。
 */

"use client";

import * as React from "react";
import Link from "next/link";

import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/side-b/StatusBadge";
import { cn } from "@/lib/utils";
import type {
    EdgeCategory,
    EdgeSource,
    EdgeStatus,
    ScreeningResult,
} from "@/types/sideB";

// ===========================================
// 表示用ラベル
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

// ===========================================
// Props
// ===========================================

/**
 * HypothesisCard が表示するデータ。
 * EdgeHypothesis / HypothesisListItem のどちらもここに代入可能な緩い形。
 */
export interface HypothesisCardData {
    id: string;
    statement: string;
    category: EdgeCategory;
    status?: EdgeStatus;
    source?: EdgeSource;
    symbols?: string[];
    timeframes?: string[];
    observationCount?: number;
    winCount?: number;
    lossCount?: number;
    avgRR?: number;
    /** ISO8601 */
    lastTestedAt?: string;
    /** ISO8601 */
    statusUpdatedAt?: string;
    screeningResult?: ScreeningResult;
}

export interface HypothesisCardProps {
    hypothesis: HypothesisCardData;
    /** full = 詳細表示、compact = ダッシュボード等の小型表示 */
    variant?: "full" | "compact";
    /** 指定時はカード全体が `/side-b/hypotheses/:id` へのリンクになる */
    href?: string;
    /** href 未指定時のクリックハンドラ */
    onClick?: () => void;
    className?: string;
}

// ===========================================
// ユーティリティ
// ===========================================

function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max) + "…";
}

function formatDateJP(iso?: string): string | undefined {
    if (!iso) return undefined;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return undefined;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}/${m}/${day}`;
}

/**
 * 勝率を 0-100 表記に正規化して %付きで返す。
 * Side-A の winRate は 0-1 / 0-100 のいずれかが来るため、1 以下は ×100 する
 * (バックエンド StatusManager.canPromoteToScreeningPassed と同じ判断ロジック)。
 */
function formatWinRate(winRate?: number): string | undefined {
    if (typeof winRate !== "number" || !Number.isFinite(winRate)) return undefined;
    const normalized = winRate <= 1 ? winRate * 100 : winRate;
    return `${normalized.toFixed(1)}%`;
}

function computeObservationWinRate(
    winCount?: number,
    lossCount?: number,
): number | undefined {
    if (typeof winCount !== "number" || typeof lossCount !== "number") return undefined;
    const total = winCount + lossCount;
    if (total <= 0) return undefined;
    return winCount / total;
}

// ===========================================
// 本体
// ===========================================

export function HypothesisCard({
    hypothesis,
    variant = "full",
    href,
    onClick,
    className,
}: HypothesisCardProps) {
    const isCompact = variant === "compact";
    const statementLimit = isCompact ? 30 : 60;

    const observationWR = computeObservationWinRate(
        hypothesis.winCount,
        hypothesis.lossCount,
    );
    const screeningPF = hypothesis.screeningResult?.metrics?.pf;
    const screeningWR = hypothesis.screeningResult?.metrics?.winRate;

    const displayWR =
        formatWinRate(observationWR) ?? formatWinRate(screeningWR);
    const displayPF =
        typeof screeningPF === "number" && Number.isFinite(screeningPF)
            ? screeningPF.toFixed(2)
            : undefined;

    const lastTested = formatDateJP(hypothesis.lastTestedAt);
    const statusUpdated = formatDateJP(hypothesis.statusUpdatedAt);

    const content = (
        <Card
            data-testid="hypothesis-card"
            data-hypothesis-id={hypothesis.id}
            className={cn(
                "cursor-pointer",
                isCompact ? "p-3" : "p-4",
                className,
            )}
            onClick={href ? undefined : onClick}
        >
            <div className="flex flex-col gap-2">
                {/* 1行目: バッジ群 */}
                <div className="flex flex-wrap items-center gap-1.5">
                    {hypothesis.status && (
                        <StatusBadge
                            status={hypothesis.status}
                            size={isCompact ? "sm" : "md"}
                        />
                    )}
                    <Badge variant="outline" className="text-[10px] sm:text-xs">
                        {CATEGORY_LABEL[hypothesis.category]}
                    </Badge>
                    {hypothesis.source && (
                        <span className="text-[10px] sm:text-xs text-gray-500">
                            {SOURCE_LABEL[hypothesis.source]}
                        </span>
                    )}
                </div>

                {/* 2行目: statement */}
                <p
                    className={cn(
                        "text-gray-100 leading-snug",
                        isCompact ? "text-sm" : "text-sm sm:text-base",
                    )}
                >
                    {truncate(hypothesis.statement, statementLimit)}
                </p>

                {/* 3行目: 対象 */}
                {!isCompact &&
                    (hypothesis.symbols?.length || hypothesis.timeframes?.length) ? (
                    <div className="flex flex-wrap gap-1 text-xs text-gray-400">
                        {hypothesis.symbols && hypothesis.symbols.length > 0 && (
                            <span data-testid="symbols">
                                {hypothesis.symbols.join(", ")}
                            </span>
                        )}
                        {hypothesis.timeframes && hypothesis.timeframes.length > 0 && (
                            <span data-testid="timeframes" className="text-gray-500">
                                ({hypothesis.timeframes.join(", ")})
                            </span>
                        )}
                    </div>
                ) : null}

                {/* 4行目: メトリクス */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
                    {typeof hypothesis.observationCount === "number" && (
                        <span>
                            観測 <span className="text-gray-200">{hypothesis.observationCount}</span>
                        </span>
                    )}
                    {displayWR && (
                        <span>
                            勝率 <span className="text-gray-200">{displayWR}</span>
                        </span>
                    )}
                    {displayPF && (
                        <span>
                            PF <span className="text-gray-200">{displayPF}</span>
                        </span>
                    )}
                    {!isCompact && typeof hypothesis.avgRR === "number" && (
                        <span>
                            avgRR <span className="text-gray-200">{hypothesis.avgRR.toFixed(2)}</span>
                        </span>
                    )}
                </div>

                {/* 5行目: 日時 */}
                {(lastTested || statusUpdated) && !isCompact && (
                    <div className="text-[11px] text-gray-500" data-testid="timestamps">
                        {lastTested && <span>最終検証: {lastTested}</span>}
                        {lastTested && statusUpdated && <span className="mx-1">·</span>}
                        {statusUpdated && <span>状態更新: {statusUpdated}</span>}
                    </div>
                )}
            </div>
        </Card>
    );

    if (href) {
        return (
            <Link href={href} className="block no-underline">
                {content}
            </Link>
        );
    }
    return content;
}
