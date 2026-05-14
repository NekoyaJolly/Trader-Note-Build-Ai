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
  LENS_PARALLEL_SMOKE_DEFAULT_AGENT_NAME,
  LENS_PARALLEL_SMOKE_DEFAULT_APP_NAME,
  buildLensParallelSmoke,
  createDryRunLensParallelAgent,
  createLensSubAgent,
  runLensParallelSmoke,
} from '../../../adk/agents/lensParallelSmoke';
import type { LensSubAgent } from '../../../adk/agents/lensParallelSmoke';
import { ParallelAgent } from '@google/adk';
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

// ============================================================================
// Phase 3: isolateFailure オプション (LensSubAgent 単体)
// ============================================================================

describe('LensSubAgent: runAsyncImpl 冒頭 reset (Phase 3 Copilot review 対応)', () => {
  /**
   * 同 instance を意図的に 2 回実行した場合、1 回目の result / error が
   * 2 回目に状態混入しないことを確認する。通常運用では factory が新規
   * instance を返すが、防衛的 reset の挙動を直接検証する。
   */
  class SwitchableLens implements Lens {
    readonly name: string = 'switchable';
    readonly version: string = '1.0.0';
    readonly dependencies: ReadonlyArray<keyof LensInput> = ['symbol'];
    public mode: 'ok' | 'fail' = 'ok';
    public callCount: number = 0;

    compute(_input: LensInput): Promise<LensFeature> {
      this.callCount += 1;
      if (this.mode === 'fail') {
        return Promise.reject(new Error(`switchable failed on call #${this.callCount}`));
      }
      return Promise.resolve({
        lensName: this.name,
        lensVersion: this.version,
        features: { call: this.callCount },
        computedAt: new Date(0),
        computeDurationMs: 0,
        confidence: 0.5,
      });
    }
  }

  it('成功 → 失敗で同 instance 再実行: result が undefined にリセットされる', async () => {
    const lens = new SwitchableLens();
    const sub = createLensSubAgent({
      lens,
      input: dummyInput,
      isolateFailure: true,
    });
    // 1 回目: 成功
    await runLensSubAgentSmoke(sub);
    expect(sub.getResult()).toBeDefined();
    expect(sub.getError()).toBeUndefined();

    // 2 回目: 失敗
    lens.mode = 'fail';
    await runLensSubAgentSmoke(sub);
    expect(sub.getResult()).toBeUndefined();
    expect(sub.getError()?.message).toMatch(/switchable failed on call #2/);
  });

  it('失敗 → 成功で同 instance 再実行: error が undefined にリセットされる', async () => {
    const lens = new SwitchableLens();
    lens.mode = 'fail';
    const sub = createLensSubAgent({
      lens,
      input: dummyInput,
      isolateFailure: true,
    });
    // 1 回目: 失敗
    await runLensSubAgentSmoke(sub);
    expect(sub.getError()).toBeDefined();
    expect(sub.getResult()).toBeUndefined();

    // 2 回目: 成功
    lens.mode = 'ok';
    await runLensSubAgentSmoke(sub);
    expect(sub.getError()).toBeUndefined();
    expect(sub.getResult()).toBeDefined();
    expect(sub.getResult()?.features.call).toBe(2);
  });
});

describe('LensSubAgent: isolateFailure オプション (Phase 3 追加)', () => {
  it('isolateFailure=true なら Lens throw でも runEphemeral が正常完了する', async () => {
    const sink = new InMemoryTraceSink();
    const sub = createLensSubAgent({
      lens: new ThrowingFakeLens('isolated err'),
      input: dummyInput,
      traceSink: sink,
      isolateFailure: true,
    });
    await expect(runLensSubAgentSmoke(sub)).resolves.toBeUndefined();
    expect(sub.getResult()).toBeUndefined();
    expect(sub.getError()).toBeInstanceOf(Error);
    expect(sub.getError()?.message).toBe('isolated err');
    // failed trace は isolateFailure に関わらず記録される
    expect(sink.events).toHaveLength(2);
    expect(sink.events[1].kind).toBe('adk.subagent.failed');
  });

  it('isolateFailure=false (default) は Phase 2 既存挙動 (throw 伝播)', async () => {
    const sub = createLensSubAgent({
      lens: new ThrowingFakeLens('still bubbles up'),
      input: dummyInput,
    });
    await expect(runLensSubAgentSmoke(sub)).rejects.toThrow(/still bubbles up/);
  });
});

// ============================================================================
// buildLensParallelSmoke: 構築物
// ============================================================================

describe('buildLensParallelSmoke: 構築物', () => {
  it('lenses 空で throw する', () => {
    expect(() =>
      buildLensParallelSmoke({ lenses: [], input: dummyInput }),
    ).toThrow(/lenses must be non-empty/);
  });

  it('同名 Lens が含まれていると throw する', () => {
    const a = new DeterministicFakeLens({ name: 'dup' });
    const b = new DeterministicFakeLens({ name: 'dup' });
    expect(() =>
      buildLensParallelSmoke({ lenses: [a, b], input: dummyInput }),
    ).toThrow(/duplicate lens name "dup"/);
  });

  it('ParallelAgent / Runner / InMemorySessionService / subAgents が揃う', () => {
    const a = new DeterministicFakeLens({ name: 'lens_a' });
    const b = new DeterministicFakeLens({ name: 'lens_b' });
    const art = buildLensParallelSmoke({ lenses: [a, b], input: dummyInput });
    expect(art.runner).toBeDefined();
    expect(art.rootAgent).toBeInstanceOf(ParallelAgent);
    expect(art.sessionService).toBeDefined();
    expect(art.subAgents).toHaveLength(2);
  });

  it('subAgents は lensName 昇順でソートされる (構築時点で安定 key)', () => {
    const c = new DeterministicFakeLens({ name: 'gamma' });
    const a = new DeterministicFakeLens({ name: 'alpha' });
    const b = new DeterministicFakeLens({ name: 'beta' });
    const art = buildLensParallelSmoke({ lenses: [c, a, b], input: dummyInput });
    expect(art.subAgents.map((s) => s.getLensName())).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('appName / agentName のデフォルトが Phase 3 用識別子', () => {
    const art = buildLensParallelSmoke({
      lenses: [new DeterministicFakeLens()],
      input: dummyInput,
    });
    expect(art.runner.appName).toBe(LENS_PARALLEL_SMOKE_DEFAULT_APP_NAME);
    expect(art.rootAgent.name).toBe(LENS_PARALLEL_SMOKE_DEFAULT_AGENT_NAME);
  });

  it('appName / agentName を override できる', () => {
    const art = buildLensParallelSmoke({
      lenses: [new DeterministicFakeLens()],
      input: dummyInput,
      appName: 'custom-app',
      agentName: 'custom-root',
    });
    expect(art.runner.appName).toBe('custom-app');
    expect(art.rootAgent.name).toBe('custom-root');
  });

  it('各 sub-agent は isolateFailure=true で構築される (Lens throw を吸収して並列継続)', async () => {
    // 直接フィールド検証は private のためできない → 実行で挙動確認: 1 Lens throw で全体停止しない
    const art = buildLensParallelSmoke({
      lenses: [
        new ThrowingFakeLens('one fails'),
        new DeterministicFakeLens({ name: 'survives' }),
      ],
      input: dummyInput,
    });
    await expect(runLensParallelSmoke(art)).resolves.toBeDefined();
  });
});

// ============================================================================
// runLensParallelSmoke: 並列実行 + 集約
// ============================================================================

describe('runLensParallelSmoke: 並列実行', () => {
  it('複数 Lens が同入力で実行され、successes が lensName 昇順', async () => {
    const art = buildLensParallelSmoke({
      lenses: [
        new DeterministicFakeLens({ name: 'zeta' }),
        new DeterministicFakeLens({ name: 'alpha' }),
        new DeterministicFakeLens({ name: 'mu' }),
      ],
      input: dummyInput,
    });
    const result = await runLensParallelSmoke(art);
    expect(result.successes.map((f) => f.lensName)).toEqual(['alpha', 'mu', 'zeta']);
    expect(result.failures).toEqual([]);
  });

  it('各 sub-agent の features が個別に取得できる', async () => {
    const art = buildLensParallelSmoke({
      lenses: [
        new DeterministicFakeLens({ name: 'lens_x', features: { v: 1 } }),
        new DeterministicFakeLens({ name: 'lens_y', features: { w: 2 } }),
      ],
      input: dummyInput,
    });
    const result = await runLensParallelSmoke(art);
    expect(result.successes.find((f) => f.lensName === 'lens_x')?.features.v).toBe(1);
    expect(result.successes.find((f) => f.lensName === 'lens_y')?.features.w).toBe(2);
  });

  it('trace event が lensName 単位で分離される (sub-agent ごとに started+completed)', async () => {
    const sink = new InMemoryTraceSink();
    const art = buildLensParallelSmoke({
      lenses: [
        new DeterministicFakeLens({ name: 'lens_a' }),
        new DeterministicFakeLens({ name: 'lens_b' }),
        new DeterministicFakeLens({ name: 'lens_c' }),
      ],
      input: dummyInput,
      traceSink: sink,
    });
    await runLensParallelSmoke(art);
    // 3 Lens × (started + completed) = 6 event
    expect(sink.events).toHaveLength(6);
    // Lens 名単位で started + completed が揃うことを順序非依存で検証
    const byLens = new Map<string, AdkTraceEvent[]>();
    for (const ev of sink.events) {
      const arr = byLens.get(ev.skillName) ?? [];
      arr.push(ev);
      byLens.set(ev.skillName, arr);
    }
    for (const name of ['lens_a', 'lens_b', 'lens_c']) {
      const evs = byLens.get(name);
      expect(evs).toHaveLength(2);
      const kinds = new Set(evs?.map((e) => e.kind));
      expect(kinds).toEqual(
        new Set(['adk.subagent.started', 'adk.subagent.completed']),
      );
    }
  });
});

// ============================================================================
// runLensParallelSmoke: failure isolation (Phase 3 DoD)
// ============================================================================

describe('runLensParallelSmoke: failure isolation', () => {
  it('1 Lens が throw しても他 Lens の completed が観測できる', async () => {
    const sink = new InMemoryTraceSink();
    const art = buildLensParallelSmoke({
      lenses: [
        new DeterministicFakeLens({ name: 'survivor_a' }),
        new ThrowingFakeLens('boom'),
        new DeterministicFakeLens({ name: 'survivor_b' }),
      ],
      input: dummyInput,
      traceSink: sink,
    });
    const result = await runLensParallelSmoke(art);
    expect(result.successes.map((f) => f.lensName).sort()).toEqual([
      'survivor_a',
      'survivor_b',
    ]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].lensName).toBe('fake_throwing');
    expect(result.failures[0].error.message).toBe('boom');
  });

  it('複数 Lens が throw しても他 Lens の success が完全に取れる', async () => {
    // ThrowingFakeLens は内部固定名 'fake_throwing' なので 2 件入れると重複。
    // Phase 3 wrapper では同名で throw する故、ここでは別名で fake を作って検証する。
    class NamedThrowingLens extends ThrowingFakeLens {
      readonly name: string;
      constructor(name: string, message: string) {
        super(message);
        this.name = name;
      }
    }
    const art = buildLensParallelSmoke({
      lenses: [
        new NamedThrowingLens('thrower_1', 'err 1'),
        new NamedThrowingLens('thrower_2', 'err 2'),
        new DeterministicFakeLens({ name: 'survivor' }),
      ],
      input: dummyInput,
    });
    const result = await runLensParallelSmoke(art);
    expect(result.successes.map((f) => f.lensName)).toEqual(['survivor']);
    expect(result.failures.map((f) => f.lensName).sort()).toEqual([
      'thrower_1',
      'thrower_2',
    ]);
  });

  it('全 Lens が throw しても successes が空配列で返り、例外伝播しない', async () => {
    class NamedThrowingLens extends ThrowingFakeLens {
      readonly name: string;
      constructor(name: string) {
        super('all fail');
        this.name = name;
      }
    }
    const art = buildLensParallelSmoke({
      lenses: [new NamedThrowingLens('a'), new NamedThrowingLens('b')],
      input: dummyInput,
    });
    const result = await runLensParallelSmoke(art);
    expect(result.successes).toEqual([]);
    expect(result.failures.map((f) => f.lensName)).toEqual(['a', 'b']);
  });
});

// ============================================================================
// runLensParallelSmoke: determinism (KICKOFF Phase 3 DoD §同入力同出力)
// ============================================================================

describe('runLensParallelSmoke: determinism', () => {
  function makeStablePair() {
    return [
      new DeterministicFakeLens({ name: 'd_alpha', features: { val: 1, tag: 'A' } }),
      new DeterministicFakeLens({ name: 'd_beta', features: { val: 2, tag: 'B' } }),
    ] as const;
  }

  it('同 input で 2 回実行しても features (volatile 除く) が一致する', async () => {
    const lenses1 = makeStablePair();
    const lenses2 = makeStablePair();
    const r1 = await runLensParallelSmoke(
      buildLensParallelSmoke({ lenses: [...lenses1], input: dummyInput }),
    );
    const r2 = await runLensParallelSmoke(
      buildLensParallelSmoke({ lenses: [...lenses2], input: dummyInput }),
    );
    // volatile field (computedAt / computeDurationMs) を除外して比較
    const strip = (fs: readonly { lensName: string; lensVersion: string; features: Readonly<Record<string, number | string | boolean>>; confidence?: number }[]) =>
      fs.map((f) => ({
        lensName: f.lensName,
        lensVersion: f.lensVersion,
        features: f.features,
        confidence: f.confidence,
      }));
    expect(strip(r1.successes)).toEqual(strip(r2.successes));
  });

  it('並列実行を 3 回繰り返しても全 features が同一', async () => {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const lenses = makeStablePair();
      const art = buildLensParallelSmoke({ lenses: [...lenses], input: dummyInput });
      runs.push(await runLensParallelSmoke(art));
    }
    const first = runs[0].successes;
    for (let i = 1; i < runs.length; i++) {
      const r = runs[i].successes;
      expect(r).toHaveLength(first.length);
      for (let j = 0; j < first.length; j++) {
        expect(r[j].lensName).toBe(first[j].lensName);
        expect(r[j].features).toEqual(first[j].features);
      }
    }
  });

  it('lenses の入力順序を変えても successes は lensName 昇順で同一', async () => {
    const r1 = await runLensParallelSmoke(
      buildLensParallelSmoke({
        lenses: [
          new DeterministicFakeLens({ name: 'z' }),
          new DeterministicFakeLens({ name: 'a' }),
          new DeterministicFakeLens({ name: 'm' }),
        ],
        input: dummyInput,
      }),
    );
    const r2 = await runLensParallelSmoke(
      buildLensParallelSmoke({
        lenses: [
          new DeterministicFakeLens({ name: 'a' }),
          new DeterministicFakeLens({ name: 'm' }),
          new DeterministicFakeLens({ name: 'z' }),
        ],
        input: dummyInput,
      }),
    );
    expect(r1.successes.map((f) => f.lensName)).toEqual(['a', 'm', 'z']);
    expect(r2.successes.map((f) => f.lensName)).toEqual(['a', 'm', 'z']);
  });
});

// ============================================================================
// createDryRunLensParallelAgent: 一発便利関数
// ============================================================================

describe('createDryRunLensParallelAgent: 一発便利関数', () => {
  it('build + run を 1 関数呼び出しで完了できる', async () => {
    const result = await createDryRunLensParallelAgent({
      lenses: [
        new DeterministicFakeLens({ name: 'one' }),
        new DeterministicFakeLens({ name: 'two' }),
      ],
      input: dummyInput,
    });
    expect(result.successes.map((f) => f.lensName)).toEqual(['one', 'two']);
    expect(result.failures).toEqual([]);
  });
});

// ============================================================================
// 実 Lens 統合 smoke (Phase 3): 既存 Lens 群を ParallelAgent で並列観測
// ============================================================================

describe('Phase 3 実 Lens 統合 smoke (KICKOFF §8.4)', () => {
  it('TimeSessionLens を ParallelAgent 経由で 1 件だけ並列観測する', async () => {
    const result = await createDryRunLensParallelAgent({
      lenses: [new TimeSessionLens()],
      input: dummyInput,
    });
    expect(result.failures).toEqual([]);
    expect(result.successes).toHaveLength(1);
    const f = result.successes[0];
    expect(f.lensName).toBe(new TimeSessionLens().name);
    expect(Object.keys(f.features).length).toBeGreaterThan(0);
  });
});
