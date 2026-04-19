/**
 * /side-b/hypotheses - 仮説一覧画面（Phase 4d Step 3 / 仕様書 §4.2）
 *
 * 一覧 UI は `@/components/side-b/HypothesisList` に集約。
 */

"use client";

import { Suspense } from "react";

import {
    HypothesisList,
    HypothesisListSkeleton,
} from "@/components/side-b/HypothesisList";

export default function HypothesesListPage() {
    return (
        <Suspense fallback={<HypothesisListSkeleton />}>
            <HypothesisList />
        </Suspense>
    );
}
