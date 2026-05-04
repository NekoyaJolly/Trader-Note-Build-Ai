/**
 * FailureReason → RepairHint v1 (Critical-4 PR #100)
 *
 * 目的: 正式 BT / surrogate / validation で失敗した候補について、既存の failureReason を
 *   deterministic に修復方針 (RepairHint) へ変換し、次世代 mutation の入力文脈とする。
 *
 * 方針:
 *   - LLM に「失敗理由」「修復方針」を推測させない (deterministic mapping)
 *   - 既存 failureReason 自由文字列 (例: `"tradeCount 0 < 30"`, `"pf 0.5 < 1"`,
 *     `"analysis-engine BT failed: timeout"`) を canonical key に正規化する
 *   - RepairHint 生成は失敗候補に対する mutation 補助情報であり、
 *     候補の評価・昇格・採用の根拠にはならない
 *   - `dsl_missing` 等 fatal 系は repair mutation 対象外、親プールからも除外
 *
 * スコープ外 (PR #101 以降):
 *   - FailureReason の 13 分類化 / EdgeStatus 拡張
 *   - LLM による failureReason 推定
 *   - Promotion Gate / EvolutionCandidateStage
 *
 * @see docs/design/pr_100_failure_reason_to_repair_hint_agent_prompt.md
 */

// =================================================================
// 型定義 (設計書 §型定義)
// =================================================================

/** 修復ヒントの強さ。mutation の変更幅制御に使う。 */
export type RepairHintSeverity = 'low' | 'medium' | 'high' | 'fatal';

/** どの部分を修復対象にするか。 */
export type RepairTarget =
  | 'entry'
  | 'exit'
  | 'risk'
  | 'filters'
  | 'timeframe'
  | 'parameters'
  | 'dsl_shape'
  | 'evaluation_runtime'
  | 'none';

/** mutation agent に渡す修復アクション。 */
export interface RepairHintAction {
  target: RepairTarget;
  instruction: string;
  allowedChangeScope: 'small' | 'medium' | 'large' | 'none';
}

/** failureReason から生成する修復ヒント。 */
export interface RepairHint {
  failureReason: string;
  severity: RepairHintSeverity;
  summary: string;
  actions: RepairHintAction[];
  mutationGuidance: string;
  shouldUseForRepairMutation: boolean;
  shouldExcludeFromParentPool: boolean;
  warnings: string[];
}

/** RepairHint 生成に使う評価文脈。 */
export interface RepairHintContext {
  candidateId: string;
  dslId?: string;
  /** rescue route (`normal_pass` / `near_miss_rescue` / `novelty_rescue` 等)。未知は省略可。 */
  route?: string;
  /** 既存 formalBtFailureReason の自由文字列をそのまま渡す (空文字 / undefined は `other` 扱い)。 */
  failureReason: string;
  metrics?: {
    pf?: number | null;
    tradeCount?: number | null;
    maxDrawdown?: number | null;
    expectancy?: number | null;
  };
  notes?: string[];
}

/** smoke / GenerationReport に出す集計。 */
export interface RepairHintSummary {
  totalFailures: number;
  repairable: number;
  excluded: number;
  byFailureReason: Record<string, number>;
  bySeverity: Record<RepairHintSeverity, number>;
  byRoute: Record<string, number>;
  warnings: string[];
}

// =================================================================
// 既存 failureReason → canonical key 正規化
// =================================================================

/**
 * canonical な failureReason キー。設計書の v1 分類に対応。
 * 既存コードは自由文字列 (`"tradeCount X < Y"`, `"pf X < Y"`,
 * `"analysis-engine BT failed: ..."` 等) を用いるため、本関数で正規化する。
 *
 * ここで増やしたキーは `createRepairHintV1` の switch でも扱う必要がある。
 * 13 分類化は PR #100 のスコープ外。
 */
export type CanonicalFailureReason =
  | 'insufficient_trades'
  | 'low_pf'
  | 'analysis_engine_timeout'
  | 'analysis_engine_error'
  | 'dsl_missing'
  | 'other';

/**
 * 既存 formalBtFailureReason 自由文字列を canonical key へマップする。
 *
 * 既存パターン (EvolutionLoop / surrogateRescuePolicy 由来):
 *   - `"tradeCount N < M"`             → insufficient_trades
 *   - `"pf X < Y"` / pf 0.x 系          → low_pf
 *   - `"analysis-engine BT failed: …"` → timeout / error の判別
 *   - `"dsl_missing"` / DSL 不在系     → dsl_missing
 *   - 上記以外                          → other (未知でも例外を投げない)
 *
 * canonical key そのものを渡された場合 (新コードからの呼び出し) はそのまま受理する。
 */
export function normalizeFailureReason(raw: string | undefined | null): CanonicalFailureReason {
  if (!raw) return 'other';
  const lower = raw.toLowerCase().trim();

  // canonical key を直接受け取ったケース (新コード経路)
  if (lower === 'insufficient_trades') return 'insufficient_trades';
  if (lower === 'low_pf') return 'low_pf';
  if (lower === 'analysis_engine_timeout') return 'analysis_engine_timeout';
  if (lower === 'analysis_engine_error') return 'analysis_engine_error';
  if (lower === 'dsl_missing') return 'dsl_missing';
  if (lower === 'other') return 'other';

  // 既存自由文字列パターン
  if (lower.startsWith('tradecount ')) return 'insufficient_trades';
  if (lower.startsWith('pf ')) return 'low_pf';

  // analysis-engine 系: timeout を error より先に判定する
  if (lower.includes('analysis-engine')) {
    if (lower.includes('timeout') || lower.includes('timed out')) {
      return 'analysis_engine_timeout';
    }
    return 'analysis_engine_error';
  }

  // DSL 不在 / 変換失敗系
  if (
    lower.includes('dsl_missing') ||
    lower.includes('missing_hypothesis_id') ||
    lower.includes('missing_conditions') ||
    lower.includes('schema_validation_failed')
  ) {
    return 'dsl_missing';
  }

  return 'other';
}

// =================================================================
// canonical key ごとの基本 RepairHint テンプレート
// =================================================================

/**
 * 設計書 §mapping 仕様 のテンプレートを基底として返す。
 * `metrics` による補足調整は `applyMetricsAdjustments` 側で行う。
 */
function baseRepairHint(
  reasonKey: CanonicalFailureReason,
  rawReason: string,
): Omit<RepairHint, 'failureReason' | 'warnings'> & { warnings: string[] } {
  switch (reasonKey) {
    case 'insufficient_trades':
      return {
        severity: 'medium',
        summary: '取引回数が不足。entry / filter 条件を緩和する方向で修復する。',
        actions: [
          {
            target: 'entry',
            instruction:
              'entry条件が厳しすぎる可能性があるため、閾値・比較条件・必要条件数を少し緩和する',
            allowedChangeScope: 'medium',
          },
          {
            target: 'filters',
            instruction:
              'filter条件が多すぎる場合は、最も寄与の低いfilterを1つだけ削る',
            allowedChangeScope: 'small',
          },
        ],
        mutationGuidance:
          '取引回数を増やす方向で修復する。ただし、entry条件を無制限に緩めず、元の仮説の中核条件を1つ以上残す。',
        shouldUseForRepairMutation: true,
        shouldExcludeFromParentPool: false,
        warnings: [],
      };

    case 'low_pf':
      return {
        severity: 'medium',
        summary: 'PF が低い。entry 精度 / exit 設計を改善する方向で修復する。',
        actions: [
          {
            target: 'exit',
            instruction:
              '利確・損切り・trailing の条件を見直し、損小利大または損失抑制を改善する',
            allowedChangeScope: 'medium',
          },
          {
            target: 'filters',
            instruction:
              'ノイズの多いentryを減らすため、trend / volatility / price action filter を1つ追加または調整する',
            allowedChangeScope: 'small',
          },
        ],
        mutationGuidance:
          'PF改善を目的に、entry精度またはexit設計を改善する。条件を増やしすぎず、変更点は最大2箇所に抑える。',
        shouldUseForRepairMutation: true,
        shouldExcludeFromParentPool: false,
        warnings: [],
      };

    case 'analysis_engine_timeout':
      return {
        severity: 'high',
        summary: '評価処理が重すぎる。条件数 / indicator 参照を減らして単純化する。',
        actions: [
          {
            target: 'dsl_shape',
            instruction:
              '条件数やindicator参照数を減らし、評価可能な単純な形にする',
            allowedChangeScope: 'medium',
          },
          {
            target: 'evaluation_runtime',
            instruction:
              '複雑な複数条件・複数時間足・重いindicatorの組み合わせを避ける',
            allowedChangeScope: 'medium',
          },
        ],
        mutationGuidance:
          '評価可能性を優先し、戦略構造を単純化する。性能改善よりもまずanalysis-engineが完走できる形にする。',
        shouldUseForRepairMutation: true,
        shouldExcludeFromParentPool: false,
        warnings: [],
      };

    case 'analysis_engine_error':
      return {
        severity: 'high',
        summary:
          'analysis-engine 実行エラー。DSL構造 / 演算子 / 欠損を疑い schema 準拠へ修正する。',
        actions: [
          {
            target: 'dsl_shape',
            instruction:
              '未対応の演算子・不正な条件構造・欠損フィールドを避け、StrategyDSL schema に沿った単純な構造へ修正する',
            allowedChangeScope: 'medium',
          },
        ],
        mutationGuidance:
          '性能改善ではなく、まずanalysis-engineで実行できるDSL形状へ修復する。',
        shouldUseForRepairMutation: true,
        shouldExcludeFromParentPool: false,
        warnings: [],
      };

    case 'dsl_missing':
      return {
        severity: 'fatal',
        summary: 'StrategyDSL 不在。repair mutation 対象外、親プールから除外する。',
        actions: [
          {
            target: 'none',
            instruction:
              'StrategyDSL が存在しないため、この候補はrepair mutation対象にしない',
            allowedChangeScope: 'none',
          },
        ],
        mutationGuidance:
          'DSL欠損候補は修復変異に使わず、親候補から除外する。EdgeHypothesis由来の場合は別途DSL変換経路で扱う。',
        shouldUseForRepairMutation: false,
        shouldExcludeFromParentPool: true,
        warnings: [],
      };

    case 'other':
    default:
      return {
        severity: 'low',
        summary:
          `失敗理由が曖昧 (raw="${rawReason}")。中核ロジックは維持して小さなパラメータ調整のみ行う。`,
        actions: [
          {
            target: 'parameters',
            instruction:
              '失敗理由が不明なため、変更幅を小さくし、主要ロジックは維持したまま閾値を微調整する',
            allowedChangeScope: 'small',
          },
        ],
        mutationGuidance:
          '不明理由のため大改変しない。元の仮説の中核を維持し、1〜2個のパラメータのみ小さく変更する。',
        shouldUseForRepairMutation: true,
        shouldExcludeFromParentPool: false,
        warnings: [],
      };
  }
}

// =================================================================
// metrics による補足調整
// =================================================================

/**
 * failureReason だけでなく、metrics が取れる場合は hint を補強する。
 *
 * - tradeCount=0 かつ insufficient_trades: severity を high に上げて warning 追加
 * - pf < 0.8: warning 追加
 * - maxDrawdown が大きい (>0.3): risk action を追加
 *
 * 新しい failureReason 名を増やすことはしない (PR #100 スコープ)。
 */
function applyMetricsAdjustments(
  hint: RepairHint,
  reasonKey: CanonicalFailureReason,
  metrics: RepairHintContext['metrics'],
): RepairHint {
  if (!metrics) return hint;

  const next: RepairHint = {
    ...hint,
    actions: hint.actions.slice(),
    warnings: hint.warnings.slice(),
  };

  if (
    reasonKey === 'insufficient_trades' &&
    typeof metrics.tradeCount === 'number' &&
    metrics.tradeCount === 0
  ) {
    next.severity = 'high';
    next.warnings.push('tradeCount=0: entry / filter 条件が極端に厳しい可能性が高い');
  }

  if (reasonKey === 'low_pf' && typeof metrics.pf === 'number' && metrics.pf < 0.8) {
    next.warnings.push(`PF=${metrics.pf.toFixed(2)} が極端に低い (< 0.8)`);
  }

  if (
    typeof metrics.maxDrawdown === 'number' &&
    metrics.maxDrawdown > 0.3 &&
    next.actions.every((a) => a.target !== 'risk')
  ) {
    next.actions.push({
      target: 'risk',
      instruction:
        'maxDrawdown が大きいため、stopLoss / position sizing を見直し、損失上限を抑える',
      allowedChangeScope: 'small',
    });
  }

  return next;
}

// =================================================================
// メイン: createRepairHintV1
// =================================================================

/**
 * 与えられた評価文脈から RepairHint v1 を deterministic に生成する。
 *
 * - LLM 推論なし。同じ入力には常に同じ出力を返す。
 * - 未知の failureReason は `other` 相当で扱い、例外を投げない。
 */
export function createRepairHintV1(context: RepairHintContext): RepairHint {
  const reasonKey = normalizeFailureReason(context.failureReason);
  const base = baseRepairHint(reasonKey, context.failureReason);

  const hint: RepairHint = {
    failureReason: reasonKey,
    severity: base.severity,
    summary: base.summary,
    actions: base.actions,
    mutationGuidance: base.mutationGuidance,
    shouldUseForRepairMutation: base.shouldUseForRepairMutation,
    shouldExcludeFromParentPool: base.shouldExcludeFromParentPool,
    warnings: base.warnings,
  };

  return applyMetricsAdjustments(hint, reasonKey, context.metrics);
}

// =================================================================
// summary 集計
// =================================================================

/**
 * 失敗候補ごとの RepairHint を `RepairHintSummary` に集計する。
 *
 * - byFailureReason: canonical key でカウント
 * - bySeverity: 4 段階全て 0 から開始 (キー欠落で undefined にならない)
 * - byRoute: 不明な route は `unknown` にまとめる
 */
export function summarizeRepairHints(
  items: ReadonlyArray<{ hint: RepairHint; route?: string }>,
): RepairHintSummary {
  const summary: RepairHintSummary = {
    totalFailures: items.length,
    repairable: 0,
    excluded: 0,
    byFailureReason: {},
    bySeverity: { low: 0, medium: 0, high: 0, fatal: 0 },
    byRoute: {},
    warnings: [],
  };

  for (const { hint, route } of items) {
    if (hint.shouldUseForRepairMutation && !hint.shouldExcludeFromParentPool) {
      summary.repairable += 1;
    } else {
      summary.excluded += 1;
    }
    summary.byFailureReason[hint.failureReason] =
      (summary.byFailureReason[hint.failureReason] ?? 0) + 1;
    summary.bySeverity[hint.severity] += 1;
    const routeKey = route && route.length > 0 ? route : 'unknown';
    summary.byRoute[routeKey] = (summary.byRoute[routeKey] ?? 0) + 1;
    if (hint.warnings.length > 0) {
      for (const w of hint.warnings) summary.warnings.push(w);
    }
  }

  return summary;
}
