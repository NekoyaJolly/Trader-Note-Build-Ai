/**
 * Deflated Sharpe Ratio (DSR) — 多重比較補正済の Sharpe Ratio (PR ⑤E)。
 *
 * **論文**: Bailey & López de Prado (2014) "The Deflated Sharpe Ratio:
 * Correcting for Selection Bias, Backtest Overfitting, and Non-Normality"
 *
 * **目的**: 進化ループで N 試行から best を選んだ時、その PF / Sharpe は
 * 必然的に過大評価される (= 試行回数が多いほど偶然 high Sharpe な戦略が出る
 * 確率が上がる)。DSR は試行回数 N と returns の歪度・尖度を補正し、
 * 「N 試行を考慮しても有意か」を判定する z-score を返す。
 *
 * **使い方** (= 本 PR では観測のみ):
 * - DSR > 0 (= z > 0): N 試行を補正しても期待 max Sharpe を上回る (= 真の有意)
 * - DSR <= 0: 偶然 N 試行の中で運が良かっただけの可能性が高い
 * - 通常 DSR > 1.96 で 95% 有意 (= one-sided)
 *
 * 本 PR では Promotion gate に組み込まず、各 promotion candidate に対して
 * DSR を計算してログに残すのみ (= 観測フェーズ)。本番運用前に Promotion gate
 * への組み込み + 試行回数 N の global history 化を別 PR で対応予定。
 *
 * @see https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf
 */

/**
 * Sharpe Ratio (annualized 不要、生の mean/std 比) を計算。
 *
 * - returns: trade ごとの収益率 (= pnl / initial_capital など、無次元化された値)
 * - returns.length < 2 の場合は 0 を返す (= サンプル不足)
 * - std=0 の場合は 0 を返す (= 損失なし戦略は数値判定不能)
 */
export function computeSharpeRatio(returns: readonly number[]): number {
  if (returns.length < 2) return 0;
  const n = returns.length;
  let sum = 0;
  for (const r of returns) sum += r;
  const mean = sum / n;
  let sqSum = 0;
  for (const r of returns) sqSum += (r - mean) * (r - mean);
  // 不偏分散 (n-1) ベース
  const variance = sqSum / (n - 1);
  if (variance <= 0) return 0;
  return mean / Math.sqrt(variance);
}

/**
 * Skewness (3 次標準化モーメント、Fisher 定義) を計算。
 *
 * - n < 3 のとき 0 を返す (= サンプル不足)
 * - std=0 のとき 0 を返す
 */
export function computeSkewness(returns: readonly number[]): number {
  const n = returns.length;
  if (n < 3) return 0;
  let sum = 0;
  for (const r of returns) sum += r;
  const mean = sum / n;
  let m2 = 0;
  let m3 = 0;
  for (const r of returns) {
    const d = r - mean;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= n;
  m3 /= n;
  if (m2 <= 0) return 0;
  return m3 / Math.pow(m2, 1.5);
}

/**
 * Kurtosis (4 次標準化モーメント、生の Pearson 定義: 正規分布で 3) を計算。
 *
 * Fisher 定義 (= excess kurtosis、正規分布で 0) ではなく、論文の式に合わせて
 * **Pearson 定義** (= 正規分布で 3) を返す。Bailey & López de Prado 2014 の
 * 式中 `(γ4 - 1) / 4` は γ4 が Pearson 定義 (= 正規分布で 3) を前提とする。
 */
export function computeKurtosis(returns: readonly number[]): number {
  const n = returns.length;
  if (n < 4) return 3; // 正規分布の値で fallback
  let sum = 0;
  for (const r of returns) sum += r;
  const mean = sum / n;
  let m2 = 0;
  let m4 = 0;
  for (const r of returns) {
    const d = r - mean;
    const d2 = d * d;
    m2 += d2;
    m4 += d2 * d2;
  }
  m2 /= n;
  m4 /= n;
  if (m2 <= 0) return 3;
  return m4 / (m2 * m2);
}

/**
 * 試行回数 N に対する **期待 max Sharpe Ratio** の近似を返す。
 *
 * Bailey & López de Prado (2014) では正規分布近似で:
 *   `E[max SR] ≈ sqrt(2 * ln(N))`
 *
 * より精密には Euler-Mascheroni 定数を含む補正項があるが、本実装は **論文の
 * 簡略式** を採用 (= 観測フェーズの目安として十分な精度)。
 *
 * - N <= 1 の場合は 0 を返す (= 試行 1 回なら max=自分自身、補正不要)
 */
export function expectedMaxSharpe(N: number): number {
  if (N <= 1) return 0;
  return Math.sqrt(2 * Math.log(N));
}

/**
 * Deflated Sharpe Ratio (DSR) を計算する。
 *
 * 式 (Bailey & López de Prado 2014, eq. 9):
 *
 *   DSR = (SR^ - SR0) * sqrt((T - 1) / (1 - γ3 * SR^ + ((γ4 - 1) / 4) * SR^2))
 *
 * - `SR^`: sample Sharpe Ratio (= mean/std)
 * - `SR0`: expected max Sharpe by chance ≈ sqrt(2 * ln(N))
 * - `T`: sample size (= returns.length、trade 数 or バー数)
 * - `γ3`: skewness (Fisher)
 * - `γ4`: kurtosis (Pearson、正規分布で 3)
 * - `N`: 試行回数 (= 同じ意思決定で試した戦略数)
 *
 * 戻り値は **z-score**。z > 0 で「N 試行を補正しても有意」、通常 z > 1.96 で
 * 95% one-sided 有意。
 *
 * 計算不能ケース (= サンプル不足、std=0、補正分母 ≤ 0) では 0 を返す。
 */
export interface DsrInputs {
  /** trade returns (= pnl / initial_capital など無次元化された値、時系列で並べる) */
  readonly returns: readonly number[];
  /** 試行回数 (= 同じ意思決定で試した戦略数、PR ⑤E では evolution_run 内の総候補数) */
  readonly trialCount: number;
}

export interface DsrResult {
  /** Deflated Sharpe Ratio の z-score */
  readonly dsr: number;
  /** sample Sharpe Ratio (= 補正前) */
  readonly sharpeRatio: number;
  /** expected max SR by chance (= sqrt(2*ln(N))) */
  readonly expectedMaxSr: number;
  /** skewness (Fisher) */
  readonly skewness: number;
  /** kurtosis (Pearson、正規分布で 3) */
  readonly kurtosis: number;
  /** sample size T */
  readonly sampleSize: number;
  /** 計算不能だった場合の理由 (= 観測ログ用)。OK の場合 null */
  readonly notComputable: string | null;
}

export function computeDeflatedSharpeRatio(inputs: DsrInputs): DsrResult {
  const { returns, trialCount } = inputs;
  const T = returns.length;
  const sharpeRatio = computeSharpeRatio(returns);
  const skewness = computeSkewness(returns);
  const kurtosis = computeKurtosis(returns);
  const expectedMaxSr = expectedMaxSharpe(trialCount);

  if (T < 2) {
    return {
      dsr: 0,
      sharpeRatio,
      expectedMaxSr,
      skewness,
      kurtosis,
      sampleSize: T,
      notComputable: 'sample size < 2',
    };
  }
  if (sharpeRatio === 0) {
    return {
      dsr: 0,
      sharpeRatio,
      expectedMaxSr,
      skewness,
      kurtosis,
      sampleSize: T,
      notComputable: 'sharpe ratio is 0 (= flat returns or std=0)',
    };
  }
  // 補正分母 (= 1 - γ3 * SR + (γ4 - 1) / 4 * SR^2)
  const correctionTerm =
    1 - skewness * sharpeRatio + ((kurtosis - 1) / 4) * sharpeRatio * sharpeRatio;
  if (correctionTerm <= 0) {
    return {
      dsr: 0,
      sharpeRatio,
      expectedMaxSr,
      skewness,
      kurtosis,
      sampleSize: T,
      notComputable: `correction term <= 0 (skew=${skewness.toFixed(3)}, kurt=${kurtosis.toFixed(3)}, SR=${sharpeRatio.toFixed(3)})`,
    };
  }
  const dsr = (sharpeRatio - expectedMaxSr) * Math.sqrt((T - 1) / correctionTerm);
  return {
    dsr,
    sharpeRatio,
    expectedMaxSr,
    skewness,
    kurtosis,
    sampleSize: T,
    notComputable: null,
  };
}
