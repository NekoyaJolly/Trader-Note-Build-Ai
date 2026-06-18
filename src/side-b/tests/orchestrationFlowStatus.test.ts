/**
 * orchestrationFlowStatus (ノード/エッジ状態算出) の単体テスト。
 * 「偽の green を出さない」「閉場中は idle」「ハンドオフ断絶を broken で出す」を担保する。
 */

import {
  deriveNodeStatus,
  deriveEdgeStatus,
  isForexLikelyOpen,
  type NodeStatusInput,
} from '../observability/orchestrationFlowStatus';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 5, 17, 12, 0, 0); // 2026-06-17 (水) 12:00 UTC = 開場中

function base(overrides: Partial<NodeStatusInput> = {}): NodeStatusInput {
  return {
    hasSignal: true,
    lastActivityMs: NOW,
    expectedCadenceMs: 4 * HOUR,
    nowMs: NOW,
    marketDependent: false,
    marketOpen: true,
    ...overrides,
  };
}

describe('deriveNodeStatus', () => {
  it('信号なし → unknown (偽 green を出さない)', () => {
    expect(deriveNodeStatus(base({ hasSignal: false }))).toBe('unknown');
  });

  it('cadence 内の活動 → flowing', () => {
    expect(deriveNodeStatus(base({ lastActivityMs: NOW - 3 * HOUR }))).toBe('flowing');
  });

  it('cadence×2 超〜×6 内 (開場中) → stale', () => {
    expect(deriveNodeStatus(base({ lastActivityMs: NOW - 12 * HOUR }))).toBe('stale');
  });

  it('cadence×6 超 (開場中) → dead', () => {
    expect(deriveNodeStatus(base({ lastActivityMs: NOW - 2 * DAY }))).toBe('dead');
  });

  it('活動記録なし + 期待 cadence あり (開場中) → dead', () => {
    expect(deriveNodeStatus(base({ lastActivityMs: null }))).toBe('dead');
  });

  it('市場依存 + 閉場中 + 古い活動 → idle (止まってて当然)', () => {
    expect(
      deriveNodeStatus(base({ lastActivityMs: NOW - 2 * DAY, marketDependent: true, marketOpen: false })),
    ).toBe('idle');
  });

  it('市場依存 + 閉場中 + 活動記録なし → idle', () => {
    expect(
      deriveNodeStatus(base({ lastActivityMs: null, marketDependent: true, marketOpen: false })),
    ).toBe('idle');
  });

  it('イベント駆動 (cadence なし) + 24h 内 → flowing, 7d 超 → dead', () => {
    expect(deriveNodeStatus(base({ expectedCadenceMs: null, lastActivityMs: NOW - 6 * HOUR }))).toBe('flowing');
    expect(deriveNodeStatus(base({ expectedCadenceMs: null, lastActivityMs: NOW - 8 * DAY }))).toBe('dead');
  });

  it('イベント駆動 + 活動記録なし → unknown (dead と断定しない)', () => {
    expect(deriveNodeStatus(base({ expectedCadenceMs: null, lastActivityMs: null }))).toBe('unknown');
  });
});

describe('deriveEdgeStatus', () => {
  it('どちらか unknown → unknown', () => {
    expect(deriveEdgeStatus('unknown', 'flowing')).toBe('unknown');
    expect(deriveEdgeStatus('flowing', 'unknown')).toBe('unknown');
  });
  it('上流 flowing なのに下流 dead/stale → broken (ハンドオフ断絶)', () => {
    expect(deriveEdgeStatus('flowing', 'dead')).toBe('broken');
    expect(deriveEdgeStatus('flowing', 'stale')).toBe('broken');
  });
  it('下流 flowing → flowing', () => {
    expect(deriveEdgeStatus('stale', 'flowing')).toBe('flowing');
  });
  it('idle 伝播', () => {
    expect(deriveEdgeStatus('idle', 'dead')).toBe('idle');
  });
  it('それ以外 → stale', () => {
    expect(deriveEdgeStatus('dead', 'dead')).toBe('stale');
  });
});

describe('isForexLikelyOpen', () => {
  it('土曜は終日クローズ', () => {
    expect(isForexLikelyOpen(Date.UTC(2026, 5, 20, 12, 0, 0))).toBe(false); // 2026-06-20 Sat
  });
  it('日曜 22:00 UTC まではクローズ / 以降は開場', () => {
    expect(isForexLikelyOpen(Date.UTC(2026, 5, 21, 20, 0, 0))).toBe(false); // Sun 20:00
    expect(isForexLikelyOpen(Date.UTC(2026, 5, 21, 23, 0, 0))).toBe(true); // Sun 23:00
  });
  it('金曜 22:00 UTC 以降はクローズ', () => {
    expect(isForexLikelyOpen(Date.UTC(2026, 5, 19, 23, 0, 0))).toBe(false); // Fri 23:00
  });
  it('平日は開場', () => {
    expect(isForexLikelyOpen(Date.UTC(2026, 5, 17, 12, 0, 0))).toBe(true); // Wed
  });
});
