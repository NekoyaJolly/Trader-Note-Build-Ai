/**
 * EdgeHypothesis 型定義（Phase 4a）
 *
 * 設計思想:
 * - 「検証可能な仮説」の台帳エントリー。
 * - 機械判定可能な条件（MachineReadableCondition）で仮説を表現することで、
 *   LLM が生成した曖昧な発見も、最終的には TypeScript 側で評価できる。
 * - ステータスライフサイクル: unverified → testing → confirmed / rejected / stale
 * - 昇格判定は Phase 4b の EdgeValidator が担当。Phase 4a では unverified のまま蓄積。
 *
 * @see docs/design/phase_4_specification.md セクション4.1
 */

import type { JsonValue } from '../../utils/jsonValue';

// ===========================================
// カテゴリ / ステータス / ソース
// ===========================================

export type EdgeCategory =
    | 'time'
    | 'level'
    | 'event'
    | 'correlation'
    | 'positioning'
    | 'volatility'
    | 'structure'
    | 'other';

export const EDGE_CATEGORIES: EdgeCategory[] = [
    'time',
    'level',
    'event',
    'correlation',
    'positioning',
    'volatility',
    'structure',
    'other',
];

export type EdgeStatus =
    | 'unverified'         // 新規、未検証
    | 'screening_passed'   // Phase 4b 縮小版: Side-A BT 事前スクリーニング通過（confirmed 昇格待ち）
    | 'testing'            // バックテスト中
    | 'confirmed'          // 昇格済み（Phase 4c で最終判定）
    | 'stale'              // 劣化中
    | 'rejected'           // 棄却
    | 'insufficient_data'  // Phase 4b: 検証データ不足で保留
    | 'not_testable';      // Phase 4b: Side-A で検証不能な仮説

export const EDGE_STATUSES: EdgeStatus[] = [
    'unverified',
    'screening_passed',
    'testing',
    'confirmed',
    'stale',
    'rejected',
    'insufficient_data',
    'not_testable',
];

export type EdgeSource =
    | 'ai_generated'
    | 'reflection'
    | 'user_input'
    | 'backtest'
    | 'discovery';

export const EDGE_SOURCES: EdgeSource[] = [
    'ai_generated',
    'reflection',
    'user_input',
    'backtest',
    'discovery',
];

// ===========================================
// 条件 / 結果サマリー
// ===========================================

export type ConditionOp =
    | '<'
    | '<='
    | '>'
    | '>='
    | '=='
    | '!='
    | 'between'
    | 'in';

/**
 * 機械判定可能な条件
 * lens の feature に対する predicate。LensFeatureSnapshot で評価される。
 */
export interface MachineReadableCondition {
    /** どのレンズの */
    lensName: string;
    /** どの特徴量が */
    featureKey: string;
    /** 比較演算子 */
    op: ConditionOp;
    /** 比較対象の値 */
    value: number | string | boolean | [number, number] | string[];
}

export interface BacktestSummary {
    pf: number;
    winRate: number;
    tradeCount: number;
    runAt: Date;
    runId?: string;
}

export interface WalkForwardSummary {
    overfitScore: number;
    avgInSampleWinRate: number;
    avgOutOfSampleWinRate: number;
    runAt: Date;
    runId?: string;
    /**
     * Phase 4b: WF 単独で BT 結果を兼ねる方針のため、
     * IS/OOS の PF 平均を保持する。StatusManager の昇格判定で参照する。
     */
    avgInSamplePF?: number;
    avgOutOfSamplePF?: number;
    totalTradeCount?: number;
}

// ===========================================
// Phase 4b: defaultRiskManagement
// ===========================================

/**
 * SL の指定方式
 * Phase 4b では atr_multiple と fixed_pips のみ実装、swing_point は Phase 4c 以降
 */
export type StopLossSpec =
    | { type: 'atr_multiple'; value: number }
    | { type: 'fixed_pips'; value: number }
    | { type: 'swing_point'; lookbackBars: number };

/**
 * TP の指定方式
 * Phase 4b では rr_ratio と atr_multiple のみ実装
 */
export type TakeProfitSpec =
    | { type: 'rr_ratio'; value: number }
    | { type: 'fixed_pips'; value: number }
    | { type: 'atr_multiple'; value: number };

/**
 * 仮説のデフォルトリスク管理設定
 * HypothesisGenerator が仮説生成時に決定する
 * 欠落している場合は DEFAULT_RISK_MANAGEMENT で補完される
 */
export interface DefaultRiskManagement {
    stopLoss: StopLossSpec;
    takeProfit: TakeProfitSpec;
    maxHoldingBars?: number;
}

/** Phase 4a 仮説の補完値（仕様書 Q5 で合意） */
export const DEFAULT_RISK_MANAGEMENT: DefaultRiskManagement = {
    stopLoss: { type: 'atr_multiple', value: 1.5 },
    takeProfit: { type: 'rr_ratio', value: 2.0 },
    maxHoldingBars: 48,
};

// ===========================================
// Phase 4c: ConsolidatedValidationReport（再エクスポート）
// ===========================================

// 本格検証レポート型は validation 層に定義。EdgeHypothesis が field として
// 参照するため型のみ再エクスポートする（循環参照を避けるため type-only import）。
export type { ConsolidatedValidationReport } from '../validation/reports';
import type { ConsolidatedValidationReport } from '../validation/reports';

// ===========================================
// Phase 4b 縮小版: screeningResult
// ===========================================

/**
 * スクリーニングで取得した Side-A BT のメトリクス要約
 */
export interface ScreeningMetrics {
    /** プロフィットファクター */
    pf: number;
    /** 勝率（0-1 または 0-100 のいずれかを記録、Side-A が返す形式に準拠） */
    winRate: number;
    /** 有効トレード数（setupCount 相当） */
    tradeCount: number;
}

/**
 * スクリーニング結果（Phase 4b で実行）
 *
 * 本格検証（Phase 4c の WF/MC/BH）とは別物。
 * ここで passed=true になった仮説が Phase 4c の入力となる。
 */
export interface ScreeningResult {
    /** ISO8601 文字列 */
    executedAt: string;
    /**
     * スクリーニングに使われた TradeNote の ID（旧経路で materialize した場合のみ）。
     * Critical-4 段階 1 以降の analysis-engine 経路では TradeNote を作らないため
     * 未設定。段階 3 で旧経路廃止と同時にこのフィールドも削除予定。
     */
    tradeNoteId?: string;
    /** スクリーニング通過可否 */
    passed: boolean;
    /** Side-A BT のメトリクス */
    metrics: ScreeningMetrics;
    /** passed=false の場合の棄却理由（配列） */
    reasons?: string[];
    /**
     * 旧 Side-A BT (BacktestRun) の runId（トレース用、任意）。
     * Critical-4 段階 3 で削除予定。
     */
    backtestRunId?: string;
    /**
     * Critical-4 段階 1: analysis-engine 経由 BT 結果 ID。
     * `ScreeningBacktestRun.id` を参照する。
     */
    screeningBacktestRunId?: string;
}

// ===========================================
// EdgeHypothesis 本体
// ===========================================

export interface EdgeHypothesis {
    id: string;

    // 記述
    /** 人間可読の仮説文 */
    statement: string;
    category: EdgeCategory;
    /** 機械判定条件（全て AND で評価） */
    conditions: MachineReadableCondition[];
    /** 期待される方向 */
    expectedDirection: 'long' | 'short' | 'either';

    // ライフサイクル
    status: EdgeStatus;
    statusUpdatedAt: Date;

    // 対象
    symbols: string[];
    timeframes: string[];

    // 実績
    observationCount: number;
    winCount: number;
    lossCount: number;
    breakevenCount: number;
    totalPnlPips: number;
    avgRR: number;

    // 検証履歴（Phase 4b で EdgeValidator が埋める）
    backtestResults?: BacktestSummary;
    walkForwardResults?: WalkForwardSummary;

    // メタデータ
    source: EdgeSource;
    /** レンズごとの重要度推定（0-1） */
    lensRelevance?: Record<string, number>;
    /** ステータス変更の直近理由（rejected / stale など） */
    statusNote?: string;

    // タイムスタンプ
    firstObservedAt: Date;
    lastObservedAt: Date;
    lastTestedAt?: Date;
    createdAt: Date;
    updatedAt: Date;

    // 関連
    parentIds?: string[];
    relatedNoteIds?: string[];

    // --- Phase 4b: ブリッジ層 ---
    /** デフォルトのリスク管理設定（HypothesisGenerator が決定 / 欠落時は補完） */
    defaultRiskManagement?: DefaultRiskManagement;
    /** この仮説から materialize された Side-A TradeNote の ID 群 */
    materializedTradeNoteIds?: string[];
    /** 無効化条件（仮説が成立しなくなる条件群） */
    invalidationConditions?: MachineReadableCondition[];
    /** confirmed 昇格時の LLM 解釈テキスト */
    confirmationNote?: string;
    /**
     * Phase 4b 縮小版: 直近のスクリーニング結果
     * 複数回スクリーニングされても最新のものだけを保持する（履歴は Phase 4c 以降で検討）。
     */
    screeningResult?: ScreeningResult;

    // --- Phase 4c: 本格検証レポート ---
    /** 4ツール統合の検証レポート（StrategistAgent の判定に利用） */
    fullValidationReport?: ConsolidatedValidationReport;
    /** confirmed 時の LLM 解釈（StrategistAgent が生成） */
    confirmationInterpretation?: string;
    /** rejected 時の LLM 解釈（StrategistAgent が生成） */
    rejectionInterpretation?: string;
    /** LLM による改善提案（任意） */
    actionableInsights?: string[];
}

// ===========================================
// 入力型
// ===========================================

export type CreateEdgeHypothesisInput = Omit<
    EdgeHypothesis,
    'id' | 'createdAt' | 'updatedAt' | 'statusUpdatedAt' | 'firstObservedAt' | 'lastObservedAt'
> & {
    /** 省略時は現在時刻 */
    firstObservedAt?: Date;
};

// ===========================================
// バリデーション
// ===========================================

export function isEdgeCategory(x: JsonValue | undefined): x is EdgeCategory {
    return typeof x === 'string' && (EDGE_CATEGORIES as string[]).includes(x);
}

export function isEdgeStatus(x: JsonValue | undefined): x is EdgeStatus {
    return typeof x === 'string' && (EDGE_STATUSES as string[]).includes(x);
}

export function isEdgeSource(x: JsonValue | undefined): x is EdgeSource {
    return typeof x === 'string' && (EDGE_SOURCES as string[]).includes(x);
}

export function isConditionOp(x: JsonValue | undefined): x is ConditionOp {
    return (
        typeof x === 'string' &&
        ['<', '<=', '>', '>=', '==', '!=', 'between', 'in'].includes(x)
    );
}

export function validateCondition(c: JsonValue): MachineReadableCondition {
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
        throw new Error('Condition must be an object');
    }
    const cc = c as Record<string, JsonValue | undefined>;
    if (typeof cc.lensName !== 'string' || typeof cc.featureKey !== 'string') {
        throw new Error('Condition missing lensName/featureKey');
    }
    if (!isConditionOp(cc.op)) {
        const opLabel =
            cc.op === undefined || cc.op === null
                ? '(missing)'
                : typeof cc.op === 'object'
                  ? JSON.stringify(cc.op)
                  : String(cc.op);
        throw new Error(`Invalid condition op: ${opLabel}`);
    }
    if (cc.value === undefined || cc.value === null) {
        throw new Error('Condition.value is required');
    }

    return {
        lensName: cc.lensName,
        featureKey: cc.featureKey,
        op: cc.op,
        value: cc.value as MachineReadableCondition['value'],
    };
}
