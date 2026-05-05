/**
 * PR #105: analysisEngineRobustnessAdapter のテスト。
 *
 * 確認:
 *   1. buildOosSplitWindowV1 は時系列順 (trainStart < trainEnd <= oosStart < oosEnd)
 *   2. validationRatio + oosRatio が 1 を超えると validation 側を縮める (= OOS 優先)
 *   3. 期間が短すぎると oosStart === oosEnd (= isOosWindowEmpty=true)
 *   4. ratio が負値 / 1 超 でも安全にクランプされる
 *   5. validationRatio=0 (既定) なら window.validationStart / End は省略される
 */

import {
  buildOosSplitWindowV1,
  isOosWindowEmpty,
} from '../../evolution/analysisEngineRobustnessAdapter';

describe('buildOosSplitWindowV1', () => {
  it('1. 時系列順 (train → oos) で隙間なく構築される', () => {
    const w = buildOosSplitWindowV1({
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      oosRatio: 0.2,
    });
    expect(new Date(w.trainStart).getTime()).toBeLessThan(new Date(w.trainEnd).getTime());
    expect(w.trainEnd).toBe(w.oosStart);
    expect(new Date(w.oosStart).getTime()).toBeLessThan(new Date(w.oosEnd).getTime());
    expect(w.validationStart).toBeUndefined();
    expect(w.validationEnd).toBeUndefined();
    expect(isOosWindowEmpty(w)).toBe(false);
  });

  it('2. validationRatio + oosRatio > 1 なら validation 側を縮める (= OOS 優先)', () => {
    const w = buildOosSplitWindowV1({
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      oosRatio: 0.7,
      validationRatio: 0.7, // 合計 1.4 → validation を 0.3 に縮小
    });
    expect(w.validationStart).toBeDefined();
    expect(w.validationEnd).toBeDefined();
    // OOS 期間は元の oosRatio=0.7 のまま
    const oosDays =
      (new Date(w.oosEnd).getTime() - new Date(w.oosStart).getTime()) / 86_400_000;
    expect(oosDays).toBeGreaterThan(200); // 365 * 0.7 ≒ 255
  });

  it('3. 期間が短すぎると oosStart === oosEnd (= isOosWindowEmpty)', () => {
    const w = buildOosSplitWindowV1({
      startDate: '2025-01-01',
      endDate: '2025-01-02',
      oosRatio: 0.2,
    });
    // 1日 * 0.2 = 0 日 → oosStart === oosEnd
    expect(isOosWindowEmpty(w)).toBe(true);
  });

  it('4. ratio が負値でも 0 にクランプされ、1 超でも 1 にクランプされる', () => {
    const negative = buildOosSplitWindowV1({
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      oosRatio: -0.5,
    });
    expect(isOosWindowEmpty(negative)).toBe(true); // oosRatio=0 なので OOS=0 日

    const overOne = buildOosSplitWindowV1({
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      oosRatio: 5.0,
    });
    // クランプされて oosRatio=1.0 (= 全期間 OOS)
    expect(overOne.trainStart).toBe(overOne.trainEnd);
  });

  it('5. validationRatio 既定 0 なら validation* は省略される', () => {
    const w = buildOosSplitWindowV1({
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    });
    expect(w.validationStart).toBeUndefined();
    expect(w.validationEnd).toBeUndefined();
  });
});
