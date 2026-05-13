/**
 * pdcaDryRunWrapper の単体テスト (Step 3 Phase 3)
 *
 * 設計書: docs/architecture/STEP_3_KICKOFF.md §5 Phase 3 / §5.11 DoD
 *
 * 検証項目 (KICKOFF §5.11 DoD):
 * 1. /src/side-b/adk/agents/ 配下に dry-run wrapper がある (= 本テストの存在で対応)
 * 2. pdcaLoop.ts の git diff がゼロ (PR レベルで確認、テスト側は static-check 不可)
 * 3. agentLoop.ts / agentMemory.ts の git diff がゼロ (同上)
 * 4. /src/side-b/skills/ の git diff がゼロ (同上)
 * 5. private method / private field にアクセスしていない (TypeScript コンパイラで防御済み)
 * 6. wrapper 実行が DB 書き込み・通知・取引判断を発生させない
 *    → 実行前後で agentMemory.getState() / pdcaLoop.getStatus() の不変性を実測
 * 7. wrapper 実行が traceSink に記録される
 * 8. error ケースで failed trace が記録される
 * 9. STEP_3_PDCA_DRYRUN_NOTES.md に実測結果がある (本 PR の docs/ で対応)
 *
 * 追加検証:
 * - traceSink.record() の throw / reject で wrapper 実行が壊れない
 * - error message 短縮 (DEFAULT_ERROR_MESSAGE_MAX) が機能する
 * - executeAction の各アクション (noop-start / noop-stop / snapshot-status / snapshot-log) が動作
 */

import { InMemorySessionService, Runner, SequentialAgent } from '@google/adk';
import type { Content } from '@google/genai';

import { agentMemory } from '../../../agent/agentMemory';
import { PDCALoop } from '../../../agent/pdcaLoop';
import {
  buildPdcaDryRunWrapper,
  createDryRunPdcaLoop,
  PDCA_DRY_RUN_CALLER_REASON,
  PDCA_DRY_RUN_DEFAULT_AGENT_NAME,
  PDCA_DRY_RUN_DEFAULT_APP_NAME,
  PdcaObservationSubAgent,
  runPdcaDryRun,
} from '../../../adk/agents/pdcaDryRunWrapper';
import { InMemoryTraceSink } from '../../../adk/tracing';

// ============================================================================
// テスト共通
// ============================================================================

const helloMessage: Content = {
  role: 'user',
  parts: [{ text: 'pdca dry-run trigger' }],
};

// ============================================================================
// createDryRunPdcaLoop: enabled:false で構築されることの確認
// ============================================================================

describe('createDryRunPdcaLoop: 安全な PDCALoop ファクトリ', () => {
  it('PDCALoop インスタンスを返す', () => {
    const pdca = createDryRunPdcaLoop();
    expect(pdca).toBeInstanceOf(PDCALoop);
  });

  it('受け取った PDCALoop は enabled:false (start() 呼んでも isRunning が true にならない)', () => {
    const pdca = createDryRunPdcaLoop();
    pdca.start(); // enabled:false のため即 return される
    const status = pdca.getStatus();
    expect(status.isRunning).toBe(false);
    expect(status.config.enabled).toBe(false);
  });

  it('verbose: false がデフォルト (console ログを抑止)', () => {
    const pdca = createDryRunPdcaLoop();
    expect(pdca.getStatus().config.verbose).toBe(false);
  });
});

// ============================================================================
// buildPdcaDryRunWrapper: 構築物
// ============================================================================

describe('buildPdcaDryRunWrapper: 構築物', () => {
  it('SequentialAgent / Runner / InMemorySessionService が揃う', () => {
    const pdca = createDryRunPdcaLoop();
    const sub = new PdcaObservationSubAgent({
      name: 'observe-status',
      pdcaLoop: pdca,
      action: 'snapshot-status',
    });
    const { runner, rootAgent, sessionService } = buildPdcaDryRunWrapper({
      pdcaLoop: pdca,
      subAgents: [sub],
    });
    expect(runner).toBeInstanceOf(Runner);
    expect(rootAgent).toBeInstanceOf(SequentialAgent);
    expect(sessionService).toBeInstanceOf(InMemorySessionService);
  });

  it('Runner.sessionService が InMemorySessionService (DatabaseSessionService 不採用)', () => {
    const pdca = createDryRunPdcaLoop();
    const sub = new PdcaObservationSubAgent({
      name: 'observe-status',
      pdcaLoop: pdca,
      action: 'snapshot-status',
    });
    const { runner } = buildPdcaDryRunWrapper({
      pdcaLoop: pdca,
      subAgents: [sub],
    });
    expect(runner.sessionService).toBeInstanceOf(InMemorySessionService);
  });

  it('appName / agentName のデフォルトが Phase 3 用識別子', () => {
    const pdca = createDryRunPdcaLoop();
    const sub = new PdcaObservationSubAgent({
      name: 'observe-status',
      pdcaLoop: pdca,
      action: 'snapshot-status',
    });
    const { runner, rootAgent } = buildPdcaDryRunWrapper({
      pdcaLoop: pdca,
      subAgents: [sub],
    });
    expect(runner.appName).toBe(PDCA_DRY_RUN_DEFAULT_APP_NAME);
    expect(rootAgent.name).toBe(PDCA_DRY_RUN_DEFAULT_AGENT_NAME);
  });

  it('subAgents が空だと throw', () => {
    const pdca = createDryRunPdcaLoop();
    expect(() =>
      buildPdcaDryRunWrapper({ pdcaLoop: pdca, subAgents: [] }),
    ).toThrow(/subAgents must be non-empty/);
  });
});

// ============================================================================
// 観測アクション 4 種の実行検証
// ============================================================================

describe('観測アクション: 副作用なし + trace 記録', () => {
  it('noop-start: pdcaLoop.start() を呼んでも isRunning は false のまま', async () => {
    const pdca = createDryRunPdcaLoop();
    const sink = new InMemoryTraceSink();
    const sub = new PdcaObservationSubAgent({
      name: 'noop-start-step',
      pdcaLoop: pdca,
      action: 'noop-start',
      traceSink: sink,
    });
    const { runner } = buildPdcaDryRunWrapper({ pdcaLoop: pdca, subAgents: [sub] });

    const stateBefore = agentMemory.getState();
    const statusBefore = pdca.getStatus();

    await runPdcaDryRun(runner, { userId: 'phase3-user', newMessage: helloMessage });

    expect(pdca.getStatus().isRunning).toBe(false);
    // agentMemory state は変わらない (副作用ゼロ)
    expect(agentMemory.getState()).toBe(stateBefore);
    // pdcaLoop の他のフィールドも初期状態のまま
    expect(pdca.getStatus().lastTickAt).toBe(statusBefore.lastTickAt);
    expect(pdca.getStatus().nextTickAt).toBe(statusBefore.nextTickAt);

    const completed = sink.events.find(
      (e) => e.kind === 'adk.subagent.completed' && e.skillName === 'noop-start-step',
    );
    expect(completed).toBeDefined();
    expect(completed?.status).toBe('ok');
  });

  it('noop-stop: isRunning=false で即 return、副作用なし', async () => {
    const pdca = createDryRunPdcaLoop();
    const sink = new InMemoryTraceSink();
    const sub = new PdcaObservationSubAgent({
      name: 'noop-stop-step',
      pdcaLoop: pdca,
      action: 'noop-stop',
      traceSink: sink,
    });
    const { runner } = buildPdcaDryRunWrapper({ pdcaLoop: pdca, subAgents: [sub] });

    const stateBefore = agentMemory.getState();
    await runPdcaDryRun(runner, { userId: 'phase3-user', newMessage: helloMessage });

    expect(pdca.getStatus().isRunning).toBe(false);
    expect(agentMemory.getState()).toBe(stateBefore);

    const completed = sink.events.find(
      (e) => e.kind === 'adk.subagent.completed' && e.skillName === 'noop-stop-step',
    );
    expect(completed).toBeDefined();
  });

  it('snapshot-status: getStatus() を呼び、resultSummary に縮約された summary を載せる', async () => {
    const pdca = createDryRunPdcaLoop();
    const sink = new InMemoryTraceSink();
    const sub = new PdcaObservationSubAgent({
      name: 'snapshot-status-step',
      pdcaLoop: pdca,
      action: 'snapshot-status',
      traceSink: sink,
    });
    const { runner } = buildPdcaDryRunWrapper({ pdcaLoop: pdca, subAgents: [sub] });

    await runPdcaDryRun(runner, { userId: 'phase3-user', newMessage: helloMessage });

    const completed = sink.events.find(
      (e) => e.kind === 'adk.subagent.completed' && e.skillName === 'snapshot-status-step',
    );
    expect(completed).toBeDefined();
    expect(completed?.resultSummary?.redacted).toBe(true);
    // getStatus() の top-level keys (isRunning / state / summary / config / recentLog 等) が
    // summary に含まれる
    const topKeys = completed?.resultSummary?.topLevelKeys ?? [];
    expect(topKeys).toEqual(expect.arrayContaining(['isRunning', 'state', 'config']));
  });

  it('snapshot-log: getThinkingLog(N) を呼び、配列の summary を記録', async () => {
    const pdca = createDryRunPdcaLoop();
    const sink = new InMemoryTraceSink();
    const sub = new PdcaObservationSubAgent({
      name: 'snapshot-log-step',
      pdcaLoop: pdca,
      action: 'snapshot-log',
      thinkingLogLimit: 5,
      traceSink: sink,
    });
    const { runner } = buildPdcaDryRunWrapper({ pdcaLoop: pdca, subAgents: [sub] });

    await runPdcaDryRun(runner, { userId: 'phase3-user', newMessage: helloMessage });

    const completed = sink.events.find(
      (e) => e.kind === 'adk.subagent.completed' && e.skillName === 'snapshot-log-step',
    );
    expect(completed).toBeDefined();
    expect(completed?.resultSummary?.redacted).toBe(true);
    // 配列 summary は fieldCount に length が入る (array は object とは別経路で payloadToSummary 化)
    expect(completed?.resultSummary).toBeDefined();
  });
});

// ============================================================================
// 副作用無発生の包括検証
// ============================================================================

describe('副作用無発生 (KICKOFF §5.11 DoD)', () => {
  it('4 アクションすべてを連続実行しても agentMemory state は変わらない', async () => {
    const pdca = createDryRunPdcaLoop();
    const sink = new InMemoryTraceSink();
    const subs: PdcaObservationSubAgent[] = [
      new PdcaObservationSubAgent({ name: 's1', pdcaLoop: pdca, action: 'snapshot-status', traceSink: sink }),
      new PdcaObservationSubAgent({ name: 's2', pdcaLoop: pdca, action: 'snapshot-log', traceSink: sink }),
      new PdcaObservationSubAgent({ name: 's3', pdcaLoop: pdca, action: 'noop-start', traceSink: sink }),
      new PdcaObservationSubAgent({ name: 's4', pdcaLoop: pdca, action: 'noop-stop', traceSink: sink }),
    ];
    const { runner } = buildPdcaDryRunWrapper({ pdcaLoop: pdca, subAgents: subs });

    const stateBefore = agentMemory.getState();
    const watchSymbolsBefore = pdca.getStatus().config.symbols.slice();

    await runPdcaDryRun(runner, { userId: 'phase3-user', newMessage: helloMessage });

    // agentMemory の state は不変
    expect(agentMemory.getState()).toBe(stateBefore);
    // pdcaLoop の config も不変
    expect(pdca.getStatus().config.symbols).toEqual(watchSymbolsBefore);
    expect(pdca.getStatus().isRunning).toBe(false);

    // 4 sub-agent ぶんの completed が記録される (副作用検証完了)
    const completed = sink.events.filter((e) => e.kind === 'adk.subagent.completed');
    expect(completed.length).toBe(4);
  });

  it('trace event の callerReason は Phase 3 専用識別子', async () => {
    const pdca = createDryRunPdcaLoop();
    const sink = new InMemoryTraceSink();
    const sub = new PdcaObservationSubAgent({
      name: 'caller-check',
      pdcaLoop: pdca,
      action: 'snapshot-status',
      traceSink: sink,
    });
    const { runner } = buildPdcaDryRunWrapper({ pdcaLoop: pdca, subAgents: [sub] });

    await runPdcaDryRun(runner, { userId: 'phase3-user', newMessage: helloMessage });

    expect(sink.events.length).toBeGreaterThan(0);
    for (const ev of sink.events) {
      expect(ev.callerReason).toBe(PDCA_DRY_RUN_CALLER_REASON);
    }
  });
});

// ============================================================================
// error ケース
// ============================================================================

describe('error ケース: failed trace が記録される', () => {
  it('sub-agent が throw すると adk.subagent.failed が記録され、PDCALoop は無傷', async () => {
    const pdca = createDryRunPdcaLoop();
    const sink = new InMemoryTraceSink();
    const subA = new PdcaObservationSubAgent({
      name: 'before-failure',
      pdcaLoop: pdca,
      action: 'snapshot-status',
      traceSink: sink,
    });
    const subB = new PdcaObservationSubAgent({
      name: 'fails',
      pdcaLoop: pdca,
      action: 'snapshot-status',
      traceSink: sink,
      shouldThrow: true,
      throwMessage: 'intentional Phase 3 failure',
    });
    const subC = new PdcaObservationSubAgent({
      name: 'after-failure',
      pdcaLoop: pdca,
      action: 'snapshot-status',
      traceSink: sink,
    });
    const { runner } = buildPdcaDryRunWrapper({
      pdcaLoop: pdca,
      subAgents: [subA, subB, subC],
    });

    const stateBefore = agentMemory.getState();

    await expect(
      runPdcaDryRun(runner, { userId: 'phase3-user', newMessage: helloMessage }),
    ).rejects.toThrow(/intentional Phase 3 failure/);

    // 失敗後も PDCALoop に副作用なし
    expect(pdca.getStatus().isRunning).toBe(false);
    expect(agentMemory.getState()).toBe(stateBefore);

    // failed trace が記録される
    const failedEvents = sink.events.filter((e) => e.kind === 'adk.subagent.failed');
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].skillName).toBe('fails');
    expect(failedEvents[0].status).toBe('thrown');
    expect(failedEvents[0].errorMessage).toContain('intentional Phase 3 failure');

    // failed sub-agent 以降は実行されない (SequentialAgent skip)
    const afterStarted = sink.events.find(
      (e) => e.kind === 'adk.subagent.started' && e.skillName === 'after-failure',
    );
    expect(afterStarted).toBeUndefined();
  });

  it('巨大な throw message が DEFAULT_ERROR_MESSAGE_MAX で短縮される', async () => {
    const pdca = createDryRunPdcaLoop();
    const sink = new InMemoryTraceSink();
    const longMessage = 'P3-LONG-'.repeat(2000);
    const sub = new PdcaObservationSubAgent({
      name: 'long-throw',
      pdcaLoop: pdca,
      action: 'snapshot-status',
      traceSink: sink,
      shouldThrow: true,
      throwMessage: longMessage,
    });
    const { runner } = buildPdcaDryRunWrapper({ pdcaLoop: pdca, subAgents: [sub] });

    await expect(
      runPdcaDryRun(runner, { userId: 'phase3-user', newMessage: helloMessage }),
    ).rejects.toThrow();

    const failed = sink.events.find((e) => e.kind === 'adk.subagent.failed');
    expect(failed).toBeDefined();
    expect((failed?.errorMessage ?? '').length).toBeLessThan(longMessage.length);
    expect((failed?.errorMessage ?? '').length).toBeLessThanOrEqual(600);
  });
});

// ============================================================================
// traceSink 失敗の握りつぶし (Phase 2 と同パターン)
// ============================================================================

describe('traceSink.record() 失敗の握りつぶし', () => {
  it('record() が同期 throw しても wrapper 実行は壊れない', async () => {
    const pdca = createDryRunPdcaLoop();
    const failingSink = {
      record: (): void => {
        throw new Error('sink throws sync (phase 3)');
      },
    };
    const sub = new PdcaObservationSubAgent({
      name: 'sub-with-throwing-sink',
      pdcaLoop: pdca,
      action: 'snapshot-status',
      traceSink: failingSink,
    });
    const { runner } = buildPdcaDryRunWrapper({ pdcaLoop: pdca, subAgents: [sub] });

    const events = await runPdcaDryRun(runner, {
      userId: 'phase3-user',
      newMessage: helloMessage,
    });
    expect(events.length).toBeGreaterThan(0);
  });

  it('record() が Promise reject しても wrapper 実行は壊れない', async () => {
    const pdca = createDryRunPdcaLoop();
    const rejectingSink = {
      record: (): Promise<void> => Promise.reject(new Error('sink rejects (phase 3)')),
    };
    const sub = new PdcaObservationSubAgent({
      name: 'sub-with-rejecting-sink',
      pdcaLoop: pdca,
      action: 'snapshot-status',
      traceSink: rejectingSink,
    });
    const { runner } = buildPdcaDryRunWrapper({ pdcaLoop: pdca, subAgents: [sub] });

    const events = await runPdcaDryRun(runner, {
      userId: 'phase3-user',
      newMessage: helloMessage,
    });
    expect(events.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// raw payload 非保存
// ============================================================================

describe('raw payload 非保存 (redaction)', () => {
  it('PDCALoop getStatus() の中身 (config / state) が trace event JSON に直接含まれない', async () => {
    const pdca = createDryRunPdcaLoop({ symbols: ['VERY-UNIQUE-MARKER-SYMBOL-PHASE3'] });
    const sink = new InMemoryTraceSink();
    const sub = new PdcaObservationSubAgent({
      name: 'redaction-check',
      pdcaLoop: pdca,
      action: 'snapshot-status',
      traceSink: sink,
    });
    const { runner } = buildPdcaDryRunWrapper({ pdcaLoop: pdca, subAgents: [sub] });

    await runPdcaDryRun(runner, { userId: 'phase3-user', newMessage: helloMessage });

    expect(sink.events.length).toBeGreaterThan(0);
    for (const ev of sink.events) {
      const serialized = JSON.stringify(ev);
      // 「symbols 配列の中身 (生の文字列)」は trace に乗らない
      expect(serialized).not.toContain('VERY-UNIQUE-MARKER-SYMBOL-PHASE3');
      // resultSummary がある場合は redacted: true
      if (ev.resultSummary !== undefined) {
        expect(ev.resultSummary.redacted).toBe(true);
      }
    }
  });
});
