/**
 * lensParallelSmoke の単体テスト (Step 4 Phase 2: 単体 Lens sub-agent wrapper)
 *
 * 設計書: docs/architecture/STEP_4_KICKOFF.md §5 Phase 2 §テスト
 *
 * 検証項目 (KICKOFF Phase 2 テスト要件):
 * 1. 成功時に started → completed が記録される
 * 2. 失敗時に started → failed が記録される
 * 3. traceSink.record が同期 throw しても実行本体は壊れない
 * 4. traceSink.record が Promise reject しても実行本体は壊れない
 * 5. raw payload が trace event に含まれない
 * 6. errorMessage が上限文字数で短縮される
 * 7. 本番コードに `any` / `unknown` / `as any` / `as unknown as` がない
 *
 * 加えて以下を確認:
 * - `LensSubAgent.getResult()` が成功時の `LensFeature` を返す
 * - `LensSubAgent.getError()` が失敗時の `Error` を返す
 * - `lens.name` が `BaseAgent.name` と `event.skillName` に伝搬する
 * - `nameOverride` で sub-agent 名を上書きできる
 * - `callerReason` が Step 4 固定値 (`lens_parallel_dry_run`) になる
 * - 実 Lens (`TimeSessionLens`) を 1 件だけ通す薄い統合 smoke
 *
 * 実 LLM は呼ばない: `LensSubAgent` は BaseAgent 直接 subclass、`Lens.compute()` を
 * そのまま委譲するだけ。
 *
 * Step 4 KICKOFF §8.3 に従い、ほとんどのテストは fake Lens (DeterministicFakeLens /
 * ThrowingFakeLens) で wrapper の責務だけを検証する。実 Lens 統合は 1 ケースに留める。
 */

import { InMemorySessionService, Runner } from '@google/adk';
import type { Content } from '@google/genai';

import { TimeSessionLens } from '../../../lenses';
import type { Lens, LensFeature, LensInput } from '../../../lenses';
import {
  LENS_PARALLEL_SMOKE_CALLER_REASON,
  createLensSubAgent,
} from '../../../adk/agents/lensParallelSmoke';
import type { LensSubAgent } from '../../../adk/agents/lensParallelSmoke';
import {
  DEFAULT_ERROR_MESSAGE_MAX,
  InMemoryTraceSink,
  type AdkTraceEvent,
  type TraceSink,
} from '../../../adk/tracing';

// ============================================================================
// テスト double
// ============================================================================

/** 固定 features を返す deterministic fake Lens。compute は副作用なし。 */
class DeterministicFakeLens implements Lens {
  readonly name: string;
  readonly version: string;
  readonly dependencies: ReadonlyArray<keyof LensInput>;
  private readonly featuresOut: Readonly<Record<string, number | string | boolean>>;
  private readonly confidenceOut: number;

  constructor(args: {
    name?: string;
    version?: string;
    dependencies?: ReadonlyArray<keyof LensInput>;
    features?: Readonly<Record<string, number | string | boolean>>;
    confidence?: number;
  } = {}) {
    this.name = args.name ?? 'fake_deterministic';
    this.version = args.version ?? '1.0.0';
    this.dependencies = args.dependencies ?? ['symbol'];
    this.featuresOut = args.features ?? { sentinel: 1, kind: 'deterministic', flag: true };
    this.confidenceOut = args.confidence ?? 0.5;
  }

  compute(_input: LensInput): Promise<LensFeature> {
    return Promise.resolve({
      lensName: this.name,
      lensVersion: this.version,
      features: this.featuresOut,
      computedAt: new Date(0),
      computeDurationMs: 0,
      confidence: this.confidenceOut,
    });
  }
}

/** 必ず throw する fake Lens。message は constructor で指定可能。 */
class ThrowingFakeLens implements Lens {
  readonly name: string = 'fake_throwing';
  readonly version: string = '1.0.0';
  readonly dependencies: ReadonlyArray<keyof LensInput> = ['symbol'];
  private readonly throwMessage: string;

  constructor(message: string = 'fake throw') {
    this.throwMessage = message;
  }

  compute(_input: LensInput): Promise<LensFeature> {
    return Promise.reject(new Error(this.throwMessage));
  }
}

// ============================================================================
// テスト共通: Runner で 1 LensSubAgent を root agent として動かす
// ============================================================================

const dummyInput: LensInput = {
  symbol: 'XAUUSD',
  timeframe: '15m',
  // テストでは Lens 内部で `Date.now()` 比較に引っかからないよう「現在より少し過去」を使う。
  timestamp: new Date(Date.now() - 60_000),
};

const triggerMessage: Content = {
  role: 'user',
  parts: [{ text: 'lens parallel smoke trigger' }],
};

const LENS_SMOKE_APP_NAME = 'trader-note-build-ai-adk-lens-parallel-smoke';

async function runLensSubAgentSmoke(subAgent: LensSubAgent): Promise<void> {
  const sessionService = new InMemorySessionService();
  const runner = new Runner({
    appName: LENS_SMOKE_APP_NAME,
    agent: subAgent,
    sessionService,
  });
  const gen = runner.runEphemeral({ userId: 'tester', newMessage: triggerMessage });
  for await (const _event of gen) {
    // Event 自体の中身検証は trace 側で行う。ここでは generator を最後まで回す目的のみ。
  }
}

// ============================================================================
// createLensSubAgent: 構築物
// ============================================================================

describe('createLensSubAgent: 構築物', () => {
  it('lens.name が BaseAgent.name に伝搬する', () => {
    const lens = new DeterministicFakeLens({ name: 'lens_alpha' });
    const sub = createLensSubAgent({ lens, input: dummyInput });
    expect(sub.name).toBe('lens_alpha');
    expect(sub.getLensName()).toBe('lens_alpha');
  });

  it('nameOverride で BaseAgent.name を差し替えられる (lens.name は維持)', () => {
    const lens = new DeterministicFakeLens({ name: 'lens_alpha' });
    const sub = createLensSubAgent({ lens, input: dummyInput, nameOverride: 'override_x' });
    expect(sub.name).toBe('override_x');
    expect(sub.getLensName()).toBe('lens_alpha');
  });

  it('lens.version が getLensVersion() で取得できる', () => {
    const lens = new DeterministicFakeLens({ version: '9.9.9' });
    const sub = createLensSubAgent({ lens, input: dummyInput });
    expect(sub.getLensVersion()).toBe('9.9.9');
  });

  it('traceSink を省略しても構築できる (NoopTraceSink 相当)', () => {
    const lens = new DeterministicFakeLens();
    expect(() => createLensSubAgent({ lens, input: dummyInput })).not.toThrow();
  });

  it('factory が常に新しい instance を返す (二重実行を避ける運用と整合)', () => {
    const lens = new DeterministicFakeLens();
    const a = createLensSubAgent({ lens, input: dummyInput });
    const b = createLensSubAgent({ lens, input: dummyInput });
    expect(a).not.toBe(b);
  });
});

// ============================================================================
// 成功時の trace event 仕様
// ============================================================================

describe('LensSubAgent.runAsyncImpl: 成功時の trace', () => {
  it('started → completed の順で 2 件 record される', async () => {
    const sink = new InMemoryTraceSink();
    const lens = new DeterministicFakeLens({ name: 'lens_alpha' });
    const sub = createLensSubAgent({ lens, input: dummyInput, traceSink: sink });
    await runLensSubAgentSmoke(sub);
    const events = sink.events;
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe('adk.subagent.started');
    expect(events[1].kind).toBe('adk.subagent.completed');
    expect(events[0].status).toBe('started');
    expect(events[1].status).toBe('ok');
  });

  it('completed の parentTraceId が started.traceId を指す', async () => {
    const sink = new InMemoryTraceSink();
    const sub = createLensSubAgent({
      lens: new DeterministicFakeLens(),
      input: dummyInput,
      traceSink: sink,
    });
    await runLensSubAgentSmoke(sub);
    const [started, completed] = sink.events;
    expect(completed.parentTraceId).toBe(started.traceId);
  });

  it('callerReason は Step 4 固定値 lens_parallel_dry_run', async () => {
    const sink = new InMemoryTraceSink();
    const sub = createLensSubAgent({
      lens: new DeterministicFakeLens(),
      input: dummyInput,
      traceSink: sink,
    });
    await runLensSubAgentSmoke(sub);
    for (const ev of sink.events) {
      expect(ev.callerReason).toBe(LENS_PARALLEL_SMOKE_CALLER_REASON);
    }
  });

  it('skillName に lens.name が入る (sub-agent 名 として再利用)', async () => {
    const sink = new InMemoryTraceSink();
    const sub = createLensSubAgent({
      lens: new DeterministicFakeLens({ name: 'lens_gamma' }),
      input: dummyInput,
      traceSink: sink,
    });
    await runLensSubAgentSmoke(sub);
    for (const ev of sink.events) {
      expect(ev.skillName).toBe('lens_gamma');
    }
  });

  it('completed の resultSummary.fieldCount が features 数と一致する (redacted)', async () => {
    const sink = new InMemoryTraceSink();
    const sub = createLensSubAgent({
      lens: new DeterministicFakeLens({
        features: { a: 1, b: 2, c: 'three', d: false, e: true },
      }),
      input: dummyInput,
      traceSink: sink,
    });
    await runLensSubAgentSmoke(sub);
    const completed = sink.events[1];
    expect(completed.resultSummary).toBeDefined();
    expect(completed.resultSummary?.redacted).toBe(true);
    expect(completed.resultSummary?.fieldCount).toBe(5);
  });

  it('getResult() で完了後に LensFeature を取得できる', async () => {
    const lens = new DeterministicFakeLens({
      name: 'lens_delta',
      features: { x: 42 },
      confidence: 0.7,
    });
    const sub = createLensSubAgent({ lens, input: dummyInput });
    await runLensSubAgentSmoke(sub);
    const result = sub.getResult();
    expect(result).toBeDefined();
    expect(result?.lensName).toBe('lens_delta');
    expect(result?.features.x).toBe(42);
    expect(result?.confidence).toBe(0.7);
  });

  it('durationMs が non-negative かつ startedAt/endedAt と整合', async () => {
    const sink = new InMemoryTraceSink();
    const sub = createLensSubAgent({
      lens: new DeterministicFakeLens(),
      input: dummyInput,
      traceSink: sink,
    });
    await runLensSubAgentSmoke(sub);
    const completed = sink.events[1];
    expect(completed.durationMs).toBeGreaterThanOrEqual(0);
    expect(completed.startedAt.getTime()).toBeLessThanOrEqual(
      completed.endedAt?.getTime() ?? 0,
    );
  });
});

// ============================================================================
// 失敗時の trace event 仕様
// ============================================================================

describe('LensSubAgent.runAsyncImpl: 失敗時の trace', () => {
  it('started → failed の順で 2 件 record される', async () => {
    const sink = new InMemoryTraceSink();
    const sub = createLensSubAgent({
      lens: new ThrowingFakeLens('lens explosion'),
      input: dummyInput,
      traceSink: sink,
    });
    await expect(runLensSubAgentSmoke(sub)).rejects.toThrow(/lens explosion/);
    const events = sink.events;
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe('adk.subagent.started');
    expect(events[1].kind).toBe('adk.subagent.failed');
    expect(events[1].status).toBe('thrown');
  });

  it('failed.errorCode が LENS_SUBAGENT_THROWN', async () => {
    const sink = new InMemoryTraceSink();
    const sub = createLensSubAgent({
      lens: new ThrowingFakeLens(),
      input: dummyInput,
      traceSink: sink,
    });
    await expect(runLensSubAgentSmoke(sub)).rejects.toThrow();
    const failed = sink.events[1];
    expect(failed.errorCode).toBe('LENS_SUBAGENT_THROWN');
  });

  it('巨大な errorMessage が DEFAULT_ERROR_MESSAGE_MAX で短縮される', async () => {
    const sink = new InMemoryTraceSink();
    const longMessage = 'X'.repeat(DEFAULT_ERROR_MESSAGE_MAX * 5);
    const sub = createLensSubAgent({
      lens: new ThrowingFakeLens(longMessage),
      input: dummyInput,
      traceSink: sink,
    });
    await expect(runLensSubAgentSmoke(sub)).rejects.toThrow();
    const failed = sink.events[1];
    expect(failed.errorMessage).toBeDefined();
    expect((failed.errorMessage ?? '').length).toBeLessThanOrEqual(
      DEFAULT_ERROR_MESSAGE_MAX,
    );
  });

  it('getError() で失敗後に Error を取得できる、getResult() は undefined', async () => {
    const sub = createLensSubAgent({
      lens: new ThrowingFakeLens('captured err'),
      input: dummyInput,
    });
    await expect(runLensSubAgentSmoke(sub)).rejects.toThrow();
    expect(sub.getResult()).toBeUndefined();
    expect(sub.getError()).toBeInstanceOf(Error);
    expect(sub.getError()?.message).toBe('captured err');
  });

  it('throw が呼び出し元 (runEphemeral) まで伝播する', async () => {
    const sub = createLensSubAgent({
      lens: new ThrowingFakeLens('bubble up'),
      input: dummyInput,
    });
    await expect(runLensSubAgentSmoke(sub)).rejects.toThrow(/bubble up/);
  });
});

// ============================================================================
// traceSink 失敗の握りつぶし (本処理を壊さない契約)
// ============================================================================

describe('LensSubAgent.runAsyncImpl: traceSink 失敗の握りつぶし', () => {
  /** 同期 throw する TraceSink。 */
  class SyncThrowingSink implements TraceSink {
    public attempted: number = 0;
    record(_event: AdkTraceEvent): void {
      this.attempted += 1;
      throw new Error('sync sink failure');
    }
  }

  /** Promise reject する TraceSink。 */
  class AsyncRejectingSink implements TraceSink {
    public attempted: number = 0;
    record(_event: AdkTraceEvent): Promise<void> {
      this.attempted += 1;
      return Promise.reject(new Error('async sink failure'));
    }
  }

  it('同期 throw の sink でも Lens compute が成功完了する', async () => {
    const sink = new SyncThrowingSink();
    const sub = createLensSubAgent({
      lens: new DeterministicFakeLens({ name: 'lens_resilient' }),
      input: dummyInput,
      traceSink: sink,
    });
    await expect(runLensSubAgentSmoke(sub)).resolves.toBeUndefined();
    expect(sub.getResult()?.lensName).toBe('lens_resilient');
    // started + completed の 2 回 record が試みられている
    expect(sink.attempted).toBeGreaterThanOrEqual(2);
  });

  it('Promise reject の sink でも Lens compute が成功完了する', async () => {
    const sink = new AsyncRejectingSink();
    const sub = createLensSubAgent({
      lens: new DeterministicFakeLens(),
      input: dummyInput,
      traceSink: sink,
    });
    await expect(runLensSubAgentSmoke(sub)).resolves.toBeUndefined();
    expect(sub.getResult()).toBeDefined();
    expect(sink.attempted).toBeGreaterThanOrEqual(2);
  });

  it('同期 throw の sink でも Lens 失敗時の throw が呼び出し元に伝播する', async () => {
    const sink = new SyncThrowingSink();
    const sub = createLensSubAgent({
      lens: new ThrowingFakeLens('lens err in resilient trace'),
      input: dummyInput,
      traceSink: sink,
    });
    await expect(runLensSubAgentSmoke(sub)).rejects.toThrow(
      /lens err in resilient trace/,
    );
  });
});

// ============================================================================
// raw payload 不保存 (型レベル + 実値検証)
// ============================================================================

describe('LensSubAgent.runAsyncImpl: raw payload 不保存', () => {
  it('trace event に args の raw 値も Lens features の raw 値も含まれない', async () => {
    const sink = new InMemoryTraceSink();
    const secretValue = 'SHOULD_NOT_LEAK_TO_TRACE_PAYLOAD';
    const sub = createLensSubAgent({
      lens: new DeterministicFakeLens({
        features: { secret: secretValue, count: 1 },
      }),
      input: dummyInput,
      traceSink: sink,
    });
    await runLensSubAgentSmoke(sub);
    const serialized = JSON.stringify(sink.events);
    expect(serialized.includes(secretValue)).toBe(false);
  });

  it('resultSummary には redacted: true マーカーが必ず付く', async () => {
    const sink = new InMemoryTraceSink();
    const sub = createLensSubAgent({
      lens: new DeterministicFakeLens(),
      input: dummyInput,
      traceSink: sink,
    });
    await runLensSubAgentSmoke(sub);
    const completed = sink.events[1];
    expect(completed.resultSummary?.redacted).toBe(true);
  });
});

// ============================================================================
// 実 Lens (TimeSessionLens) との薄い統合 smoke
// ============================================================================

describe('LensSubAgent: 実 Lens 統合 smoke (薄め、KICKOFF §8.4)', () => {
  it('TimeSessionLens を 1 件だけ通して features が取得できる', async () => {
    const lens = new TimeSessionLens();
    const sub = createLensSubAgent({ lens, input: dummyInput });
    await runLensSubAgentSmoke(sub);
    const result = sub.getResult();
    expect(result).toBeDefined();
    expect(result?.lensName).toBe(lens.name);
    expect(result?.lensVersion).toBe(lens.version);
    expect(Object.keys(result?.features ?? {}).length).toBeGreaterThan(0);
  });
});
