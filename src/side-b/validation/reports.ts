/**
 * Phase 4c: 検証レポートの統合型
 *
 * 4ツール（screening / walkForward / monteCarlo / buyAndHold）の結果を
 * 束ねた成果物。BacktesterAgent が生成し、StrategistAgent が評価し、
 * EdgeHypothesis.fullValidationReport として永続化する。
 *
 * DB 保存は Prisma の Json 型。Date 値は JSON 化時に失われるため、
 * ISO8601 文字列で表現する。
 *
 * @see docs/design/phase_4c_specification.md §4.8
 */

import type { ValidationToolResult } from './tools/types';

export interface ConsolidatedValidationReport {
    hypothesisId: string;
    periodUsed: { start: string; end: string };

    /** Phase 4b 縮小版で取得したスクリーニング結果の流用 */
    screening?: ValidationToolResult;
    walkForward?: ValidationToolResult;
    monteCarlo?: ValidationToolResult;
    buyAndHold?: ValidationToolResult;

    /** 4ツール全てが passed=true か */
    allPassed: boolean;
    /** passed=true のツール数 */
    passedCount: number;
    /** 対象ツール総数（基本は 4） */
    totalCount: number;

    /** 検証開始時刻（ISO8601） */
    startedAt: string;
    /** 検証完了時刻（ISO8601） */
    completedAt: string;
    /** 合計実行時間（ms） */
    totalDurationMs: number;

    /** 一部ツール失敗時のエラー詳細（toolName: reason 形式） */
    errors: string[];
}
