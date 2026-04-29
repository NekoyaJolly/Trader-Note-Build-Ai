/**
 * Phase 6: 実行時のプロンプトバリアント選択
 *
 * エージェント実行時に active or experimental のどちらを使うかを決める。
 *
 * 安全装置(§3.1.5):
 * - 実験プロンプトの使用率は 1 エージェントあたり全呼び出しの 20% 以下
 * - 残り 80% は active を使う
 * - 抽選は決定論的ではなく Math.random()(テストではシード差し替え可)
 *
 * 実験プロンプトの即時中止判定:
 * - usageCount >= MIN_USAGE_FOR_REJECTION(既定 20)
 * - かつ avgScore < active の avgScore * REJECTION_THRESHOLD(既定 0.7)
 * - この場合、呼び出し側で `registry.reject()` を発火させる
 */

import type { PromptVersion } from './types';

/** 実験プロンプトの使用率上限(20%)。 */
export const EXPERIMENTAL_USAGE_RATIO = 0.2;

/** 即時中止判定の最小使用回数。 */
export const MIN_USAGE_FOR_REJECTION = 20;

/** 即時中止の閾値(active の avgScore * 0.7 を下回ると reject)。 */
export const REJECTION_THRESHOLD = 0.7;

export interface VariantSelection {
  selected: PromptVersion;
  /** active が選ばれたか experimental が選ばれたか */
  isExperimental: boolean;
  /** experimental が存在するが実験ではない場合、active を返した理由 */
  reason: string;
}

/** 乱数生成器の注入用 interface(テストで固定値を注入できる)。 */
export type RandomGenerator = () => number;

/**
 * active と experimental の中から 1 つ選ぶ。
 *
 * - experimental が空なら常に active
 * - experimental があれば 20% の確率で experimental(複数あれば等確率)
 * - experimental のうち 即時中止判定を超えるものは候補から除外
 */
export function selectVariant(
  active: PromptVersion,
  experimentals: PromptVersion[],
  rand: RandomGenerator = Math.random,
): VariantSelection {
  if (experimentals.length === 0) {
    return { selected: active, isExperimental: false, reason: 'no experimental' };
  }

  // 即時中止候補を除外
  const viable = experimentals.filter(
    (e) => !shouldReject(e, active),
  );
  if (viable.length === 0) {
    return {
      selected: active,
      isExperimental: false,
      reason: 'all experimentals below rejection threshold',
    };
  }

  const roll = rand();
  if (roll >= EXPERIMENTAL_USAGE_RATIO) {
    return {
      selected: active,
      isExperimental: false,
      reason: `roll=${roll.toFixed(3)} >= ${EXPERIMENTAL_USAGE_RATIO}`,
    };
  }
  // viable から等確率で 1 つ選ぶ
  const idx = Math.min(
    viable.length - 1,
    Math.floor(rand() * viable.length),
  );
  return {
    selected: viable[idx],
    isExperimental: true,
    reason: `experimental sampled (viable=${viable.length})`,
  };
}

/**
 * experimental が即時中止判定を満たすか。
 * 満たす場合は呼び出し側で `registry.reject()` すべき。
 */
export function shouldReject(
  experimental: PromptVersion,
  active: PromptVersion,
): boolean {
  if (experimental.status !== 'experimental') return false;
  if (experimental.usageCount < MIN_USAGE_FOR_REJECTION) return false;
  if (active.avgScore <= 0) return false;
  return experimental.avgScore < active.avgScore * REJECTION_THRESHOLD;
}
