/**
 * /side-b/hypotheses/[id] - 仮説詳細画面（Phase 4d Step 4 / 仕様書 §4.3）
 *
 * 詳細 UI は `@/components/side-b/HypothesisDetail` に集約。
 */

"use client";

import { use } from "react";

import { HypothesisDetail } from "@/components/side-b/HypothesisDetail";

interface PageParams {
    params: Promise<{ id: string }>;
}

export default function HypothesisDetailPage({ params }: PageParams) {
    const { id } = use(params);
    return <HypothesisDetail hypothesisId={id} />;
}
