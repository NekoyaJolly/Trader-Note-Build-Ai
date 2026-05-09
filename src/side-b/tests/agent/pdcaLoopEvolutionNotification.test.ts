/**
 * Filter Evolution Phase E: PDCALoop.notifyEvolutionGenerationComplete テスト
 *
 * 設計書: docs/review/2026-05-09_agent_loop_diagnosis_and_plan.md §5.E.1
 *
 * 検証内容:
 * - thinking log に「進化ループ世代完了: regime=... gen=... ...」が追加される
 * - reflectionLessons なしのとき "(reflection lessons なし — Phase D 未完成 ...)" を含む
 * - reflectionLessons ありのとき category と lesson が " | " 区切りで整形される
 * - GenerationReport の構造的型 EvolutionGenerationSummaryForPDCA で循環依存なく動く
 */

import { PDCALoop, type EvolutionGenerationSummaryForPDCA, type EvolutionReflectionLesson } from '../../agent/pdcaLoop';

describe('PDCALoop.notifyEvolutionGenerationComplete (Phase E)', () => {
  // PR #143 Copilot review #2: 不要な型キャストを削除し、PDCALoopConfig の必要キーのみを渡す
  function makeLoop(): PDCALoop {
    return new PDCALoop({
      enabled: true,
      symbols: ['XAU/USD'],
      normalIntervalMs: 60_000,
      activeIntervalMs: 5_000,
      positionIntervalMs: 1_000,
      verbose: false,
    });
  }

  function summaryFor(generationIndex: number, generationsTotal: number): EvolutionGenerationSummaryForPDCA {
    return {
      generationIndex,
      generationsTotal,
      promotionCandidates: 3,
      validationConfirmed: 2,
      formalBtPassed: 4,
    };
  }

  it('thinking log に世代完了情報を含むエントリを追加する', () => {
    const loop = makeLoop();
    loop.notifyEvolutionGenerationComplete('breakout', summaryFor(0, 3));

    const logs = loop.getThinkingLog();
    expect(logs.length).toBeGreaterThan(0);
    const last = logs[logs.length - 1];
    expect(last.action).toContain('進化ループ世代完了');
    expect(last.action).toContain('regime=breakout');
    // PR #143 Copilot review #4: thinking log は 1-indexed 表示 (= summary.generationIndex+1)
    expect(last.action).toContain('gen=1/3');
    expect(last.action).toContain('promo=3');
    expect(last.action).toContain('validationConfirmed=2');
    expect(last.action).toContain('formalBtPassed=4');
  });

  it('reflectionLessons なしのとき "Phase D 未完成" メッセージを記録する', () => {
    const loop = makeLoop();
    loop.notifyEvolutionGenerationComplete('reversal', summaryFor(1, 2));

    const logs = loop.getThinkingLog();
    const last = logs[logs.length - 1];
    expect(last.reasoning).toContain('reflection lessons なし');
    expect(last.reasoning).toContain('Phase D 未完成');
  });

  it('reflectionLessons ありのとき category と lesson が整形される', () => {
    const loop = makeLoop();
    const lessons: EvolutionReflectionLesson[] = [
      { category: 'breakthrough', lesson: 'Gen 3 で time_session filter で promotion top-K に到達' },
      { category: 'mutation_decay', lesson: 'mutation 由来 child の Lift がほぼ全て 1.0 で停滞' },
    ];
    loop.notifyEvolutionGenerationComplete('breakout', summaryFor(2, 5), lessons);

    const logs = loop.getThinkingLog();
    const last = logs[logs.length - 1];
    expect(last.reasoning).toContain('[breakthrough] Gen 3 で time_session filter');
    expect(last.reasoning).toContain('[mutation_decay] mutation 由来 child');
    expect(last.reasoning).toContain(' | '); // 区切り文字
    expect(last.reasoning).not.toContain('Phase D 未完成');
  });

  it('reflectionLessons 空配列のときも "Phase D 未完成" メッセージ', () => {
    const loop = makeLoop();
    loop.notifyEvolutionGenerationComplete('breakout', summaryFor(0, 1), []);

    const logs = loop.getThinkingLog();
    const last = logs[logs.length - 1];
    expect(last.reasoning).toContain('reflection lessons なし');
  });
});
