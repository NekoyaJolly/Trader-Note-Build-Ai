/**
 * EvolutionJob の純粋関数・定数モジュール
 *
 * PR-1 (sideb-refactor): `evolutionJob.ts` から純粋ロジック (定数 / env 解釈 /
 * clamp) を分離。テスト時に EvolutionLoop / Agent / Population など重い依存を
 * 引き込まずに単体検証できる軽量モジュール (PR #159 Copilot review #3 対応)。
 *
 * `evolutionJob.ts` 側は本モジュールを import する。
 */

import type { SideBSchedulerConfig } from './sideBScheduler';
import { MULTI_GENERATION_DEFAULTS } from '../evolution/multiGenerationRunner';

// ============================================================================
// 定数
// ============================================================================

/**
 * EvolutionInstanceCarry の保持日数 (= 14 日より古い行を retention で削除)。
 *
 * 14 日より短くすると「途中で評価が長引いた regime の carry が消える」リスクがあり、
 * 長くすると DB 容量が線形に増える (= 設計書 §8.2 の容量試算 168MB / 14d を超過)。
 *
 * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.B.4
 */
export const EVOLUTION_CARRY_RETENTION_DAYS = 14;

/**
 * 進化ループのデフォルト対象レジーム。
 *
 * SideBScheduler.DEFAULT_CONFIG.evolutionRegimes はこの定数を spread で参照する
 * (= 依存方向: scheduler → evolutionJobConfig、循環なし)。
 *
 * configOverride で空配列が渡されたケースの fallback として EvolutionJob.run() 内でも参照する
 * (旧 sideBScheduler.ts L1024-1026 の挙動互換)。
 */
export const DEFAULT_EVOLUTION_REGIMES = [
  'trending_with_pullback',
  'breakout',
  'consolidation',
  'reversal',
] as const;

// ============================================================================
// 環境変数解釈ヘルパー
// ============================================================================

/**
 * 環境変数値が「整数表現の文字列」であることを厳密に検証する。
 *
 * `parseInt` だと `'2abc'` / `'2.9'` を 2 として受理してしまう。本関数は trim 後に
 * `^-?\d+$` 全体一致でなければ null を返し、設定ミスを silent fail させない
 * (PR #138 Copilot review で指摘された運用事故防止)。
 *
 * 補足 (PR #159 Copilot review #2): 前後の空白は `trim()` で除去するため、
 * `'  2  '` は 2 として受理する (= env 変数の慣行と合わせた挙動)。
 * 厳密整数 0 件チェック (空白も禁止) が必要になった場合は本関数を分けるか
 * 呼び出し側で別途検証する。
 */
function parseStrictInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * 環境変数値を `'true' | 'false'` で厳密に判定する。
 *
 * trim + toLowerCase 後に 'true' / 'false' でなければ null (= 想定外文字列、warning 対象)。
 */
function parseStrictBool(raw: string): boolean | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return null;
}

/**
 * 環境変数から Evolution 関連の設定 override を読み取る。
 *
 * 対応 env:
 * - `EVOLUTION_GENERATIONS` (1〜MULTI_GENERATION_DEFAULTS.maxGenerations の整数)
 * - `EVOLUTION_ADAPTIVE_BUDGET` ('true' | 'false')
 * - `EVOLUTION_QD_ARCHIVE` ('true' | 'false')
 * - `EVOLUTION_QD_PARENT_LIMIT` (>=0 の整数)
 * - `AUTO_EVOLUTION` ('true' | 'false', Filter Evolution 観察フェーズ用)
 *
 * 不正値は warning を出力した上で無視 (= DEFAULT_CONFIG が使われる)。
 *
 * 旧 sideBScheduler.ts の `readEvolutionEnvOverrides()` を文言・挙動完全互換で移植。
 * warning 文言は `evolutionMultiGen.test.ts` で検証されているため変更不可。
 */
export function readEvolutionEnvOverrides(): Partial<SideBSchedulerConfig> {
  const out: Partial<SideBSchedulerConfig> = {};

  const gensRaw = process.env.EVOLUTION_GENERATIONS;
  if (gensRaw !== undefined && gensRaw !== '') {
    const parsed = parseStrictInt(gensRaw);
    if (
      parsed !== null &&
      parsed >= 1 &&
      parsed <= MULTI_GENERATION_DEFAULTS.maxGenerations
    ) {
      out.evolutionGenerations = parsed;
    } else {
      console.warn(
        `[SideBScheduler] EVOLUTION_GENERATIONS=${gensRaw} は不正値 (1〜${MULTI_GENERATION_DEFAULTS.maxGenerations} の整数のみ)、無視します`,
      );
    }
  }

  const adaptiveRaw = process.env.EVOLUTION_ADAPTIVE_BUDGET;
  if (adaptiveRaw !== undefined && adaptiveRaw !== '') {
    const parsed = parseStrictBool(adaptiveRaw);
    if (parsed === null) {
      console.warn(
        `[SideBScheduler] EVOLUTION_ADAPTIVE_BUDGET=${adaptiveRaw} は不正値 ('true' | 'false' のみ)、無視します`,
      );
    } else {
      out.evolutionAdaptiveBudget = parsed;
    }
  }

  const qdRaw = process.env.EVOLUTION_QD_ARCHIVE;
  if (qdRaw !== undefined && qdRaw !== '') {
    const parsed = parseStrictBool(qdRaw);
    if (parsed === null) {
      console.warn(
        `[SideBScheduler] EVOLUTION_QD_ARCHIVE=${qdRaw} は不正値 ('true' | 'false' のみ)、無視します`,
      );
    } else {
      out.evolutionQDArchive = parsed;
    }
  }

  const qdLimitRaw = process.env.EVOLUTION_QD_PARENT_LIMIT;
  if (qdLimitRaw !== undefined && qdLimitRaw !== '') {
    const parsed = parseStrictInt(qdLimitRaw);
    if (parsed !== null && parsed >= 0) {
      out.evolutionQDParentLimit = parsed;
    } else {
      console.warn(
        `[SideBScheduler] EVOLUTION_QD_PARENT_LIMIT=${qdLimitRaw} は不正値 (>=0 の整数のみ)、無視します`,
      );
    }
  }

  // Filter Evolution 観察フェーズ (2026-05-09): AUTO_EVOLUTION で evolution cron の自動起動を制御。
  const autoEvolutionRaw = process.env.AUTO_EVOLUTION;
  if (autoEvolutionRaw !== undefined && autoEvolutionRaw !== '') {
    const parsed = parseStrictBool(autoEvolutionRaw);
    if (parsed === null) {
      console.warn(
        `[SideBScheduler] AUTO_EVOLUTION=${autoEvolutionRaw} は不正値 ('true' | 'false' のみ)、無視します`,
      );
    } else {
      out.autoEvolution = parsed;
    }
  }

  return out;
}

// ============================================================================
// clamp ヘルパー
// ============================================================================

/**
 * `evolutionGenerations` を `[1, MULTI_GENERATION_DEFAULTS.maxGenerations]` に clamp する。
 *
 * configOverride 経由で 0 や maxGenerations 超過の値が渡されると runner 側で
 * clamp される一方で scheduler のログ表示や useMultiGen 判定がズレるため、
 * Job 入口で必ず clamp する (PR #138 Copilot review #4)。
 *
 * PR #159 Copilot review #1 対応: `Math.floor(NaN)` は NaN を返し、`Math.max(1, NaN)`
 * も NaN になるため `useMultiGen` 判定とログが壊れる。非有限値は 1 に fallback する。
 */
export function clampEvolutionGenerations(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.max(
    1,
    Math.min(MULTI_GENERATION_DEFAULTS.maxGenerations, Math.floor(raw)),
  );
}
