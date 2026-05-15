/**
 * Phase F: ADK 可視性 / 監視ソリューションの実地確認 (dry-run smoke)
 *
 * 設計書: docs/architecture/STEP_5_OBSERVABILITY_AUDIT.md (Phase F 検証結果まとめ)
 *           docs/architecture/STEP_5_RUNTIME_AUDIT.md (Phase A-F 全体集約)
 *
 * 目的:
 *   - Step 3 PDCALoop dry-run wrapper + Step 4 Lens ParallelAgent wrapper を
 *     回し、InMemoryTraceSink に記録される trace event 列を取得する
 *   - 取得した event 粒度 / 情報量が「エージェントループの可視化」として
 *     十分かを Nekoさん と判断する材料を作る
 *
 * 重要な制約:
 *   - dry-run 専用。createDryRunPdcaLoop は enabled:false の PDCALoop を返す
 *   - 本番 SideBScheduler / Express server には接続しない
 *   - DB 書き込み / 通知 / 取引判断は一切発生させない
 *   - 既存 pdcaLoop.ts / agentMemory.ts / lenses/* の git diff はゼロを保つ
 *
 * 実行:
 *   npx tsx scripts/sideB_runtime_observability_smoke.ts
 *
 * 出力:
 *   - 標準出力: 各シナリオの実行 + 取得 event 数のサマリ
 *   - ファイル: .observability-trace.json (取得した全 trace event を JSON 形式で保存)
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildPdcaDryRunWrapper,
  createDryRunPdcaLoop,
  PdcaObservationSubAgent,
  runPdcaDryRun,
} from '../src/side-b/adk/agents/pdcaDryRunWrapper';
import {
  buildLensParallelSmoke,
  runLensParallelSmoke,
} from '../src/side-b/adk/agents/lensParallelSmoke';
import { InMemoryTraceSink } from '../src/side-b/adk/tracing';
import type { AdkTraceEvent } from '../src/side-b/adk/tracing';
import type { Lens, LensFeature, LensInput } from '../src/side-b/lenses';
import type { Content } from '@google/genai';

// ============================================================================
// Fake Lens (検証専用、依存最小)
// ============================================================================

class FakeSuccessLens implements Lens {
  readonly name: string;
  readonly version = '0.0.0-smoke';
  readonly dependencies: ReadonlyArray<keyof LensInput> = ['symbol', 'timeframe', 'timestamp'];

  constructor(name: string) {
    this.name = name;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async compute(input: LensInput): Promise<LensFeature> {
    return {
      lensName: this.name,
      lensVersion: this.version,
      features: {
        symbol: input.symbol,
        timeframe: input.timeframe,
        epoch: input.timestamp.getTime(),
        flag: true,
      },
      computedAt: new Date(),
      confidence: 1.0,
    };
  }
}

class FakeFailingLens implements Lens {
  readonly name = 'fake-failing-lens';
  readonly version = '0.0.0-smoke';
  readonly dependencies: ReadonlyArray<keyof LensInput> = ['symbol', 'timeframe', 'timestamp'];

  // eslint-disable-next-line @typescript-eslint/require-await
  async compute(_input: LensInput): Promise<LensFeature> {
    throw new Error('synthetic failure: fake-failing-lens always fails for smoke testing');
  }
}

// ============================================================================
// Scenario 1: PDCALoop Dry-Run Wrapper の trace 取得
// ============================================================================

interface ScenarioReport {
  scenario: string;
  durationMs: number;
  eventCount: number;
  notes?: string;
}

async function runPdcaScenario(traceSink: InMemoryTraceSink): Promise<ScenarioReport> {
  const pdca = createDryRunPdcaLoop({ symbols: ['XAUUSD'] });

  const sub1 = new PdcaObservationSubAgent({
    name: 'observe-status',
    pdcaLoop: pdca,
    action: 'snapshot-status',
    traceSink,
  });
  const sub2 = new PdcaObservationSubAgent({
    name: 'observe-log',
    pdcaLoop: pdca,
    action: 'snapshot-log',
    traceSink,
  });

  const { runner } = buildPdcaDryRunWrapper({
    pdcaLoop: pdca,
    subAgents: [sub1, sub2],
  });

  const message: Content = {
    role: 'user',
    parts: [{ text: 'pdca dry-run smoke trigger' }],
  };

  const beforeCount = traceSink.events.length;
  const t0 = Date.now();
  await runPdcaDryRun(runner, { userId: 'phase-f-smoke', newMessage: message });
  const duration = Date.now() - t0;
  const afterCount = traceSink.events.length;

  return {
    scenario: 'pdca-dry-run',
    durationMs: duration,
    eventCount: afterCount - beforeCount,
    notes: 'snapshot-status + snapshot-log の 2 sub-agent を SequentialAgent 経由で実行',
  };
}

// ============================================================================
// Scenario 2: Lens ParallelAgent (成功 2 + 失敗 1 で failure isolation 確認)
// ============================================================================

async function runLensParallelScenario(
  traceSink: InMemoryTraceSink,
): Promise<ScenarioReport> {
  const input: LensInput = {
    symbol: 'XAUUSD',
    timeframe: '15m',
    timestamp: new Date('2026-05-15T00:00:00Z'),
  };

  const artifacts = buildLensParallelSmoke({
    lenses: [
      new FakeSuccessLens('fake-success-lens-a'),
      new FakeSuccessLens('fake-success-lens-b'),
      new FakeFailingLens(),
    ],
    input,
    traceSink,
  });

  const beforeCount = traceSink.events.length;
  const t0 = Date.now();
  const result = await runLensParallelSmoke(artifacts);
  const duration = Date.now() - t0;
  const afterCount = traceSink.events.length;

  return {
    scenario: 'lens-parallel-dry-run',
    durationMs: duration,
    eventCount: afterCount - beforeCount,
    notes: `successes=${result.successes.length} failures=${result.failures.length} (failure isolation: 1 lens 失敗でも他 lens が完走するか)`,
  };
}

// ============================================================================
// Trace event 要約 (event 種別ごとの内訳)
// ============================================================================

function summarizeEvents(events: ReadonlyArray<AdkTraceEvent>): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const e of events) {
    summary[e.kind] = (summary[e.kind] ?? 0) + 1;
  }
  return summary;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('=== Phase F: Side-B Runtime Observability Smoke ===');
  console.log(`実行時刻: ${new Date().toISOString()}`);
  console.log();

  const traceSink = new InMemoryTraceSink();
  const reports: ScenarioReport[] = [];

  console.log('--- Scenario 1: PDCALoop Dry-Run Wrapper ---');
  reports.push(await runPdcaScenario(traceSink));
  console.log();

  console.log('--- Scenario 2: Lens ParallelAgent (failure isolation 確認) ---');
  reports.push(await runLensParallelScenario(traceSink));
  console.log();

  const allEvents = traceSink.events;
  const eventSummary = summarizeEvents(allEvents);

  console.log('=== Summary ===');
  for (const r of reports) {
    console.log(
      `[${r.scenario}] eventCount=${r.eventCount} duration=${r.durationMs}ms` +
        (r.notes ? ` (${r.notes})` : ''),
    );
  }
  console.log();
  console.log('Trace Event 種別内訳:');
  for (const [type, count] of Object.entries(eventSummary).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }
  console.log();
  console.log(`総 event 数: ${allEvents.length}`);

  const outputPath = resolve(process.cwd(), '.observability-trace.json');
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        meta: {
          generatedAt: new Date().toISOString(),
          scenarios: reports,
          eventSummary,
          totalEvents: allEvents.length,
        },
        events: allEvents,
      },
      null,
      2,
    ),
  );
  console.log();
  console.log(`Trace event を ${outputPath} に保存しました。`);
}

main().catch((err: unknown) => {
  console.error('[smoke] 実行エラー:', err);
  process.exit(1);
});
