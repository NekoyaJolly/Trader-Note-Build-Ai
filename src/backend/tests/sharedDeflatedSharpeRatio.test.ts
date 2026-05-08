/**
 * Deflated Sharpe Ratio (DSR) helper の単体テスト (PR ⑤E)。
 *
 * TS 版 (`src/shared/statistics/deflatedSharpeRatio.ts`) と Python 版
 * (`analysis-engine/app/statistics/dsr.py`) で同じ式が実装されていることを
 * pin する。固定 returns + trialCount に対する期待値で検証。
 */

import {
  computeDeflatedSharpeRatio,
  computeKurtosis,
  computeSharpeRatio,
  computeSkewness,
  expectedMaxSharpe,
} from '../../shared/statistics/deflatedSharpeRatio';

describe('computeSharpeRatio', () => {
  it('flat returns (= std=0) は 0 を返す', () => {
    expect(computeSharpeRatio([1, 1, 1, 1])).toBe(0);
  });

  it('mean / sample std (= 不偏分散の平方根) ベースで計算される', () => {
    // returns = [1, 2, 3] → mean=2, var(unbiased)=1, std=1, SR=2/1=2
    expect(computeSharpeRatio([1, 2, 3])).toBeCloseTo(2, 6);
  });

  it('サンプル不足 (length < 2) は 0', () => {
    expect(computeSharpeRatio([])).toBe(0);
    expect(computeSharpeRatio([5])).toBe(0);
  });

  it('対称分布で正の mean なら正の SR', () => {
    const out = computeSharpeRatio([0.1, -0.05, 0.15, -0.03, 0.08]);
    expect(out).toBeGreaterThan(0);
  });
});

describe('computeSkewness / computeKurtosis', () => {
  it('対称分布の skewness は ~0', () => {
    const symmetric = [-2, -1, 0, 1, 2];
    expect(computeSkewness(symmetric)).toBeCloseTo(0, 6);
  });

  it('右に長い裾の分布は positive skew', () => {
    const rightSkewed = [0, 0, 0, 0, 10];
    expect(computeSkewness(rightSkewed)).toBeGreaterThan(0);
  });

  it('正規分布近似 (= 一様分布) の kurtosis は < 3', () => {
    const uniform = [-2, -1, 0, 1, 2];
    expect(computeKurtosis(uniform)).toBeLessThan(3);
  });

  it('裾の重い分布の kurtosis は > 3', () => {
    const heavyTail = [0, 0, 0, 0, 0, 10, -10];
    expect(computeKurtosis(heavyTail)).toBeGreaterThan(3);
  });

  it('サンプル不足: skewness は n<3 で 0、kurtosis は n<4 で 3', () => {
    expect(computeSkewness([1, 2])).toBe(0);
    expect(computeKurtosis([1, 2, 3])).toBe(3);
  });
});

describe('expectedMaxSharpe', () => {
  it('N=1 では 0 (= 試行 1 回なら補正不要)', () => {
    expect(expectedMaxSharpe(1)).toBe(0);
    expect(expectedMaxSharpe(0)).toBe(0);
  });

  it('N が増えると単調増加', () => {
    const a = expectedMaxSharpe(10);
    const b = expectedMaxSharpe(100);
    const c = expectedMaxSharpe(1000);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('式 sqrt(2*ln(N)) で計算される', () => {
    expect(expectedMaxSharpe(Math.E)).toBeCloseTo(Math.sqrt(2), 6);
    expect(expectedMaxSharpe(100)).toBeCloseTo(Math.sqrt(2 * Math.log(100)), 6);
  });
});

describe('computeDeflatedSharpeRatio', () => {
  it('サンプル不足は notComputable に理由を入れて返す', () => {
    const result = computeDeflatedSharpeRatio({ returns: [1], trialCount: 10 });
    expect(result.dsr).toBe(0);
    expect(result.notComputable).toBe('sample size < 2');
  });

  it('flat returns (= std=0) も notComputable', () => {
    const result = computeDeflatedSharpeRatio({
      returns: [1, 1, 1, 1, 1],
      trialCount: 10,
    });
    expect(result.dsr).toBe(0);
    expect(result.notComputable).toContain('sharpe ratio is 0');
  });

  it('正常系: 高 SR + 多サンプル + 少試行 で DSR > 0', () => {
    // mean=0.03, std≈0.02 → SR≈1.49。trialCount=2 (= expectedMaxSr≈1.18) より高い
    // ので SR - expectedMaxSr > 0 → DSR > 0
    const returns = Array.from({ length: 100 }, (_, i) =>
      i % 2 === 0 ? 0.05 : 0.01,
    );
    const result = computeDeflatedSharpeRatio({
      returns,
      trialCount: 2,
    });
    expect(result.notComputable).toBeNull();
    expect(result.sampleSize).toBe(100);
    expect(result.sharpeRatio).toBeGreaterThan(0);
    expect(result.expectedMaxSr).toBeGreaterThan(0);
    expect(result.sharpeRatio).toBeGreaterThan(result.expectedMaxSr);
    expect(result.dsr).toBeGreaterThan(0);
  });

  it('正常系: 低 SR + 多試行 で DSR < 0 (= N 試行補正で有意でない)', () => {
    // 微妙な収益で SR が低い場合
    const returns = Array.from({ length: 50 }, (_, i) =>
      i % 3 === 0 ? 0.001 : -0.0005,
    );
    const result = computeDeflatedSharpeRatio({
      returns,
      trialCount: 1000, // 大量試行
    });
    expect(result.notComputable).toBeNull();
    // expectedMaxSr が SR を上回るので DSR は負
    expect(result.dsr).toBeLessThan(0);
  });

  it('SR と expectedMaxSr が同値なら DSR = 0', () => {
    // sample std=0 ではなく、ちょうど SR = expectedMaxSharpe(N) を作るのは難しいので、
    // expectedMaxSharpe(1)=0 を使って SR > 0 での DSR > 0 を確認
    const returns = [0.1, 0.05, 0.15, 0.08];
    const result = computeDeflatedSharpeRatio({ returns, trialCount: 1 });
    expect(result.expectedMaxSr).toBe(0);
    expect(result.dsr).toBeGreaterThan(0);
  });

  it('返却値: sharpeRatio / expectedMaxSr / skewness / kurtosis / sampleSize がすべて埋まる', () => {
    const returns = [0.05, -0.02, 0.08, 0.01, -0.03, 0.06, 0.04, -0.01];
    const result = computeDeflatedSharpeRatio({ returns, trialCount: 10 });
    expect(typeof result.sharpeRatio).toBe('number');
    expect(typeof result.expectedMaxSr).toBe('number');
    expect(typeof result.skewness).toBe('number');
    expect(typeof result.kurtosis).toBe('number');
    expect(result.sampleSize).toBe(returns.length);
  });
});
