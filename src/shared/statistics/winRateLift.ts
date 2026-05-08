/**
 * Win Rate Lift — フィルタ追加による勝率改善倍率 (Filter Evolution M2)。
 *
 * **動機**: 進化ループの crossover/mutation を「新戦略生成」ではなく「既存戦略
 * の騙し (false signal) 回避フィルタ追加」に再定義する設計の根幹評価指標。
 * 親 A (= base setup) と子 A+F (= setup + filter) の trade list を比較して、
 * filter F の質を Lift = winRate(A+F) / winRate(A) で測る。
 *
 * **業界用語注記**: アルゴリズム取引業界には「フィルタ追加で勝ち維持しつつ
 * 負けを除去できたか」を測る統一指標が存在しない (2026-05-08 調査時点)。
 * Curtis Faith の Edge Ratio (= MFE/MAE) は別概念。本実装は ML/マーケティング
 * 分野で確立済の **Lift** (= Provost & Fawcett 2013 / scikit-learn) を流用。
 *
 * **設計書**: `docs/design/phase_filter_evolution_specification.md`
 *
 * @see https://en.wikipedia.org/wiki/Lift_(data_mining)
 */

/**
 * Trade のうち winRateLift 計算に必要な最小フィールドだけを切り出した型。
 * analysis-engine の `ScreeningBacktestTrade` から `entryTime` / `outcome` だけを
 * 取り出して渡せば良い (= helper を analysis-engine schema に依存させない)。
 */
export interface WinRateLiftTrade {
  /** ISO 8601 datetime、trade 識別キー (= subset 判定に使う) */
  readonly entryTime: string;
  /** trade の結末 (= win / loss / timeout) */
  readonly outcome: 'win' | 'loss' | 'timeout';
}

export interface WinRateLiftInputs {
  /** 親 A の trade list (= base 戦略、filter 追加前) */
  readonly parentTrades: readonly WinRateLiftTrade[];
  /** 子 A+F の trade list (= base 戦略 + filter 追加後) */
  readonly childTrades: readonly WinRateLiftTrade[];
  /**
   * Safety guard 設定 (= filter が壊滅的に取引数を減らした / 勝ちトレードを
   * 多く捨てた場合に Lift = 1.0 (= no improvement) を返す閾値)。省略時は設計書既定値。
   */
  readonly safetyGuards?: {
    /** 子の勝ちトレード数 W_AF が親の W_A の何割以上を保つ必要があるか (既定 0.7) */
    readonly minWinPreservationRatio?: number;
    /** 子の総取引数 T_AF が親の T_A の何割以上を保つ必要があるか (既定 0.3) */
    readonly minTradeCountRatio?: number;
    /** 子の総取引数の絶対最低値 (既定 20) */
    readonly minAbsoluteTradeCount?: number;
  };
}

export interface WinRateLiftResult {
  /**
   * Lift 値 (= winRate(A+F) / winRate(A))。
   * - `> 1.0`: filter が勝率を改善 (= 騙し回避効果あり)
   * - `= 1.0`: filter 無効 (= safety guard で弾かれた、または改善なし)
   * - `< 1.0`: filter が悪化 (理論上は subset 違反 / 勝ち多数除去で発生)
   */
  readonly lift: number;
  /** 親 A の勝率 (= W_A / T_A、T_A=0 なら 0) */
  readonly parentWinRate: number;
  /** 子 A+F の勝率 (= W_AF / T_AF、T_AF=0 なら 0) */
  readonly childWinRate: number;
  /** 親 A の勝ちトレード数 */
  readonly parentWinCount: number;
  /** 親 A の負けトレード数 */
  readonly parentLossCount: number;
  /** 親 A の総取引数 (= win + loss + timeout) */
  readonly parentTradeCount: number;
  /** 子 A+F の勝ちトレード数 */
  readonly childWinCount: number;
  /** 子 A+F の負けトレード数 */
  readonly childLossCount: number;
  /** 子 A+F の総取引数 */
  readonly childTradeCount: number;
  /** 副次観察: filter precision = ΔL / (ΔW + ΔL) (= 捨てた中で負けの割合) */
  readonly filterPrecision: number;
  /** 副次観察: specificity = ΔL / L_A (= 元の負けのうち何割除去できたか) */
  readonly specificity: number;
  /** 副次観察: preserve_win = W_AF / W_A (= 勝ちを何割維持できたか、recall 相当) */
  readonly preserveWin: number;
  /** 計算不能だった場合の理由 (= 観測ログ用)。OK の場合 null */
  readonly notComputable: string | null;
}

const DEFAULT_MIN_WIN_PRESERVATION_RATIO = 0.7;
const DEFAULT_MIN_TRADE_COUNT_RATIO = 0.3;
const DEFAULT_MIN_ABSOLUTE_TRADE_COUNT = 20;

/**
 * trade list から win / loss 件数と total を集計する。
 * timeout は total には含めるが win/loss には含めない (= 勝率計算では除外、
 * 取引数 guard では含める保守的な設計)。
 */
function countOutcomes(trades: readonly WinRateLiftTrade[]): {
  winCount: number;
  lossCount: number;
  totalCount: number;
} {
  let winCount = 0;
  let lossCount = 0;
  for (const t of trades) {
    if (t.outcome === 'win') winCount++;
    else if (t.outcome === 'loss') lossCount++;
  }
  return { winCount, lossCount, totalCount: trades.length };
}

/**
 * 子の trade list が親の trade list の strict subset かどうかを entryTime ベースで確認。
 * filter は本来 trade を除去するだけ (= entry timing をずらさない) なので、子の全 entry が
 * 親に存在するはず。subset でなければ filter 以外の影響が混入している。
 */
function isStrictSubset(
  parentTrades: readonly WinRateLiftTrade[],
  childTrades: readonly WinRateLiftTrade[],
): boolean {
  const parentEntryTimes = new Set(parentTrades.map((t) => t.entryTime));
  for (const c of childTrades) {
    if (!parentEntryTimes.has(c.entryTime)) return false;
  }
  return true;
}

/**
 * Win Rate Lift を計算する。
 *
 * 設計書 §2.1 採用指標:
 * ```
 * lift = winRate(A+F) / winRate(A)
 *   if W_AF >= minWinPreservationRatio × W_A         # 勝ちトレード保護
 *   and T_AF >= max(minAbsoluteTradeCount, minTradeCountRatio × T_A)
 *   else 1.0                                         # safety guard で弾く
 * ```
 *
 * 計算不能ケース (= parent に trade なし、parent winRate 0、child not subset 等)
 * では lift=1.0 + notComputable に理由を入れて返す (= 観測ログ用)。
 */
export function computeWinRateLift(inputs: WinRateLiftInputs): WinRateLiftResult {
  const { parentTrades, childTrades, safetyGuards } = inputs;
  const minWinPreservationRatio =
    safetyGuards?.minWinPreservationRatio ?? DEFAULT_MIN_WIN_PRESERVATION_RATIO;
  const minTradeCountRatio = safetyGuards?.minTradeCountRatio ?? DEFAULT_MIN_TRADE_COUNT_RATIO;
  const minAbsoluteTradeCount =
    safetyGuards?.minAbsoluteTradeCount ?? DEFAULT_MIN_ABSOLUTE_TRADE_COUNT;

  const parent = countOutcomes(parentTrades);
  const child = countOutcomes(childTrades);

  // 副次観察用の統計値 (notComputable でも埋めておく、デバッグ用)
  const deltaWin = parent.winCount - child.winCount;
  const deltaLoss = parent.lossCount - child.lossCount;
  const deltaTotal = deltaWin + deltaLoss;
  const filterPrecision = deltaTotal > 0 ? deltaLoss / deltaTotal : 0;
  const specificity = parent.lossCount > 0 ? deltaLoss / parent.lossCount : 0;
  const preserveWin = parent.winCount > 0 ? child.winCount / parent.winCount : 0;
  const parentWinRate =
    parent.totalCount > 0 ? parent.winCount / parent.totalCount : 0;
  const childWinRate =
    child.totalCount > 0 ? child.winCount / child.totalCount : 0;

  const baseResult = {
    parentWinRate,
    childWinRate,
    parentWinCount: parent.winCount,
    parentLossCount: parent.lossCount,
    parentTradeCount: parent.totalCount,
    childWinCount: child.winCount,
    childLossCount: child.lossCount,
    childTradeCount: child.totalCount,
    filterPrecision,
    specificity,
    preserveWin,
  };

  if (parent.totalCount === 0) {
    return { ...baseResult, lift: 1.0, notComputable: 'parent has no trades' };
  }
  if (parent.winCount === 0) {
    // 親 winRate=0 だと Lift 分母が 0 で計算不能。filter の比較対象としては意味がない
    return { ...baseResult, lift: 1.0, notComputable: 'parent has zero win rate' };
  }
  if (child.totalCount === 0) {
    return { ...baseResult, lift: 1.0, notComputable: 'child has no trades (= filter rejected all)' };
  }
  if (!isStrictSubset(parentTrades, childTrades)) {
    return {
      ...baseResult,
      lift: 1.0,
      notComputable: 'child is not a strict subset of parent (= filter changed entry timing)',
    };
  }

  // Safety guards
  const minRequiredWin = minWinPreservationRatio * parent.winCount;
  const minRequiredTradeCount = Math.max(
    minAbsoluteTradeCount,
    minTradeCountRatio * parent.totalCount,
  );
  if (child.winCount < minRequiredWin) {
    return {
      ...baseResult,
      lift: 1.0,
      notComputable: `safety guard: child wins ${child.winCount} < ${minRequiredWin.toFixed(1)} (${(minWinPreservationRatio * 100).toFixed(0)}% of parent wins ${parent.winCount})`,
    };
  }
  if (child.totalCount < minRequiredTradeCount) {
    return {
      ...baseResult,
      lift: 1.0,
      notComputable: `safety guard: child trades ${child.totalCount} < ${minRequiredTradeCount.toFixed(1)} (= max(${minAbsoluteTradeCount}, ${(minTradeCountRatio * 100).toFixed(0)}% of parent ${parent.totalCount}))`,
    };
  }

  const lift = childWinRate / parentWinRate;
  return { ...baseResult, lift, notComputable: null };
}
