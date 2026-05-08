"""Deflated Sharpe Ratio (DSR) — TS 版 `src/shared/statistics/deflatedSharpeRatio.ts`
と同期実装 (PR ⑤E)。

論文: Bailey & López de Prado (2014) "The Deflated Sharpe Ratio"
https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf

TS と Python で **同じ式** を実装し、analysis-engine と Side-B で同じ DSR
値を返すよう保証する (= drift 防止)。テスト (sharedDeflatedSharpeRatio.test.ts)
と Python テストで両側を pin する。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Optional, Sequence


def compute_sharpe_ratio(returns: Sequence[float]) -> float:
    """Sharpe Ratio (raw mean/std、annualized 補正なし)。

    - returns 長さ < 2 → 0 (= サンプル不足)
    - 不偏分散 (n-1) ベース
    - std=0 → 0 (= 損失なし戦略は判定不能)
    """
    n = len(returns)
    if n < 2:
        return 0.0
    mean = sum(returns) / n
    sq_sum = sum((r - mean) ** 2 for r in returns)
    variance = sq_sum / (n - 1)
    if variance <= 0:
        return 0.0
    return mean / math.sqrt(variance)


def compute_skewness(returns: Sequence[float]) -> float:
    """Skewness (Fisher 定義、3 次標準化モーメント)。

    - n < 3 → 0
    - std=0 → 0
    """
    n = len(returns)
    if n < 3:
        return 0.0
    mean = sum(returns) / n
    m2 = sum((r - mean) ** 2 for r in returns) / n
    m3 = sum((r - mean) ** 3 for r in returns) / n
    if m2 <= 0:
        return 0.0
    return m3 / (m2 ** 1.5)


def compute_kurtosis(returns: Sequence[float]) -> float:
    """Kurtosis (Pearson 定義、4 次標準化モーメント、正規分布で 3)。

    Bailey & López de Prado 2014 の式 `(γ4 - 1) / 4` は γ4 が Pearson 定義
    (= 正規分布で 3) を前提としている。
    """
    n = len(returns)
    if n < 4:
        return 3.0
    mean = sum(returns) / n
    m2 = sum((r - mean) ** 2 for r in returns) / n
    m4 = sum((r - mean) ** 4 for r in returns) / n
    if m2 <= 0:
        return 3.0
    return m4 / (m2 ** 2)


def expected_max_sharpe(N: int) -> float:
    """試行回数 N に対する期待 max Sharpe Ratio の近似。

    `E[max SR] ≈ sqrt(2 * ln(N))` (= Bailey & López de Prado 2014 の簡略式)。

    N <= 1 → 0 (= 試行 1 回なら補正不要)
    """
    if N <= 1:
        return 0.0
    return math.sqrt(2 * math.log(N))


@dataclass(frozen=True)
class DsrResult:
    """compute_deflated_sharpe_ratio の戻り値。"""

    dsr: float
    sharpe_ratio: float
    expected_max_sr: float
    skewness: float
    kurtosis: float
    sample_size: int
    not_computable: Optional[str]


def compute_deflated_sharpe_ratio(
    returns: Iterable[float],
    trial_count: int,
) -> DsrResult:
    """Deflated Sharpe Ratio (DSR) を計算する。

    式 (Bailey & López de Prado 2014, eq. 9):
      DSR = (SR^ - SR0) * sqrt((T - 1) / (1 - γ3 * SR^ + ((γ4 - 1) / 4) * SR^2))

    戻り値は z-score。z > 0 で「N 試行を補正しても有意」、z > 1.96 で 95%
    one-sided 有意。

    計算不能ケース (= サンプル不足 / std=0 / 補正分母 ≤ 0) では dsr=0 +
    not_computable に理由を入れて返す (= 観測ログ用)。
    """
    rets = list(returns)
    T = len(rets)
    sharpe_ratio = compute_sharpe_ratio(rets)
    skewness = compute_skewness(rets)
    kurtosis = compute_kurtosis(rets)
    expected_max_sr = expected_max_sharpe(trial_count)

    if T < 2:
        return DsrResult(
            dsr=0.0,
            sharpe_ratio=sharpe_ratio,
            expected_max_sr=expected_max_sr,
            skewness=skewness,
            kurtosis=kurtosis,
            sample_size=T,
            not_computable="sample size < 2",
        )
    if sharpe_ratio == 0:
        return DsrResult(
            dsr=0.0,
            sharpe_ratio=sharpe_ratio,
            expected_max_sr=expected_max_sr,
            skewness=skewness,
            kurtosis=kurtosis,
            sample_size=T,
            not_computable="sharpe ratio is 0 (= flat returns or std=0)",
        )
    correction_term = (
        1 - skewness * sharpe_ratio + ((kurtosis - 1) / 4) * sharpe_ratio * sharpe_ratio
    )
    if correction_term <= 0:
        return DsrResult(
            dsr=0.0,
            sharpe_ratio=sharpe_ratio,
            expected_max_sr=expected_max_sr,
            skewness=skewness,
            kurtosis=kurtosis,
            sample_size=T,
            not_computable=(
                f"correction term <= 0 (skew={skewness:.3f}, "
                f"kurt={kurtosis:.3f}, SR={sharpe_ratio:.3f})"
            ),
        )
    dsr = (sharpe_ratio - expected_max_sr) * math.sqrt((T - 1) / correction_term)
    return DsrResult(
        dsr=dsr,
        sharpe_ratio=sharpe_ratio,
        expected_max_sr=expected_max_sr,
        skewness=skewness,
        kurtosis=kurtosis,
        sample_size=T,
        not_computable=None,
    )
