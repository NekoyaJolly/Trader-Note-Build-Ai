/**
 * LensSnapshotView - レンズスナップショット表示（仕様書 §4.6）
 *
 * 仮説登録時のレンズ出力（複数レンズの特徴量）をアコーディオン形式で表示する。
 * 仕様書の定義に従い、スナップショット型は以下の形:
 *
 *   {
 *     timestamp: string;
 *     features: Record<string, Record<string, number | string | boolean>>;
 *     //        ^^^^^^ レンズ名                ^^^^^^ 特徴量 key → value
 *   }
 *
 * 注意:
 *   - 現時点では Phase 4a の EdgeHypothesis にスナップショット格納フィールドは
 *     無いため、このコンポーネントは「受け取ったら表示する」単純な Presenter。
 *   - 格納経路が決まった段階で呼び出し元側で渡すデータ形状を合わせる。
 */

"use client";

import * as React from "react";

import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

// ===========================================
// 型
// ===========================================

export interface LensSnapshot {
    /** ISO8601 タイムスタンプ */
    timestamp: string;
    /** レンズ名 → 特徴量の key-value マップ */
    features: Record<string, Record<string, number | string | boolean>>;
}

export interface LensSnapshotViewProps {
    snapshot?: LensSnapshot;
    /** 初期展開するレンズ名のリスト。未指定時は全レンズ折りたたみ。 */
    expandedLenses?: string[];
    className?: string;
}

// ===========================================
// ヘルパー
// ===========================================

function formatValue(value: number | string | boolean): string {
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "string") return value;
    if (!Number.isFinite(value)) return "-";

    if (Number.isInteger(value)) return String(value);
    if (Math.abs(value) < 0.01) return value.toExponential(2);
    return value.toFixed(3);
}

/** category 的な文字列値と数値/真偽値を視覚的に区別するためのガード */
function isCategoricalValue(value: number | string | boolean): boolean {
    return typeof value === "string" || typeof value === "boolean";
}

function formatTimestamp(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

// ===========================================
// 本体
// ===========================================

export function LensSnapshotView({
    snapshot,
    expandedLenses = [],
    className,
}: LensSnapshotViewProps) {
    if (!snapshot) {
        return (
            <Card
                data-testid="lens-snapshot-empty"
                className={cn("p-4 text-xs text-gray-500", className)}
            >
                レンズスナップショットはありません
            </Card>
        );
    }

    const lensNames = Object.keys(snapshot.features);
    if (lensNames.length === 0) {
        return (
            <Card
                data-testid="lens-snapshot-empty"
                className={cn("p-4 text-xs text-gray-500", className)}
            >
                記録されたレンズがありません
            </Card>
        );
    }

    return (
        <div
            data-testid="lens-snapshot-view"
            className={cn("flex flex-col gap-2", className)}
        >
            <p className="text-[11px] text-gray-500" data-testid="snapshot-timestamp">
                記録時刻: {formatTimestamp(snapshot.timestamp)}
            </p>

            {lensNames.map((lensName) => (
                <LensPanel
                    key={lensName}
                    lensName={lensName}
                    features={snapshot.features[lensName]}
                    defaultOpen={expandedLenses.includes(lensName)}
                />
            ))}
        </div>
    );
}

// ===========================================
// 個別レンズパネル（内部 subcomponent）
// ===========================================

interface LensPanelProps {
    lensName: string;
    features: Record<string, number | string | boolean>;
    defaultOpen: boolean;
}

function LensPanel({ lensName, features, defaultOpen }: LensPanelProps) {
    const entries = Object.entries(features ?? {});

    // details/summary で実装することでネイティブの展開状態管理に任せる
    // (状態管理を props drill させない & アクセシビリティ面でも良好)
    return (
        <details
            open={defaultOpen}
            data-testid="lens-panel"
            data-lens-name={lensName}
            className={cn(
                "rounded-lg border border-slate-700 bg-slate-800/70",
                "group",
            )}
        >
            <summary
                className={cn(
                    "cursor-pointer list-none px-3 py-2",
                    "flex items-center justify-between",
                    "text-sm font-semibold text-gray-200",
                    "hover:bg-slate-700/30 rounded-t-lg",
                )}
            >
                <span>{lensName}</span>
                <span className="text-xs text-gray-500">
                    {entries.length} 特徴
                    <span className="ml-2 group-open:hidden">▸</span>
                    <span className="ml-2 hidden group-open:inline">▾</span>
                </span>
            </summary>

            {entries.length === 0 ? (
                <p className="px-3 pb-3 text-xs text-gray-500">
                    特徴量がありません
                </p>
            ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 pb-3 pt-1 text-xs">
                    {entries.map(([key, value]) => (
                        <React.Fragment key={key}>
                            <dt className="text-gray-400 break-all">{key}</dt>
                            <dd
                                className="text-right"
                                data-feature-key={key}
                            >
                                {isCategoricalValue(value) ? (
                                    <Badge variant="outline" className="text-[10px]">
                                        {formatValue(value)}
                                    </Badge>
                                ) : (
                                    <span className="text-gray-100 tabular-nums">
                                        {formatValue(value)}
                                    </span>
                                )}
                            </dd>
                        </React.Fragment>
                    ))}
                </dl>
            )}
        </details>
    );
}
