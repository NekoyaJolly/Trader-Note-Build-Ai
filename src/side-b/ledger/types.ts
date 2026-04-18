/**
 * EdgeLedger 公開型定義（Phase 4a）
 */

import type { EdgeStatus, EdgeCategory, EdgeSource } from '../models/edgeHypothesis';

/**
 * 台帳統計
 */
export interface EdgeLedgerStats {
    totalCount: number;
    byStatus: Record<EdgeStatus, number>;
    byCategory: Record<EdgeCategory, number>;
    bySource: Record<EdgeSource, number>;
}

/**
 * recordObservation の入力
 */
export interface ObservationInput {
    outcome: 'win' | 'loss' | 'breakeven';
    pnlPips: number;
    rr: number;
    noteId: string;
}
