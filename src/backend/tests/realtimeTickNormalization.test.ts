import type { TickDataInput } from '../services/realtime/realtimeTickService';
import { normalizeTickWithReference } from '../services/realtime/realtimeTickService';

describe('normalizeTickWithReference', () => {
  const baseTimestamp = new Date('2024-01-01T00:00:00Z');
  const reference = 4000;

  const buildTick = (overrides: Partial<TickDataInput>): TickDataInput => ({
    symbol: 'XAUUSD',
    timestamp: baseTimestamp,
    bid: 4000,
    ask: 4000,
    mid: 4000,
    spread: 0,
    ...overrides,
  });

  it('ask が正しく bid がスケール崩れの場合は ask で補正する', () => {
    const tick = buildTick({ bid: 2000, ask: 4000, mid: 3000, spread: 2000 });

    const result = normalizeTickWithReference(tick, reference);

    expect(result.status).toBe('fixed');
    if (result.status === 'fixed') {
      expect(result.tick.bid).toBeCloseTo(4000);
      expect(result.tick.ask).toBeCloseTo(4000);
      expect(result.tick.mid).toBeCloseTo(4000);
      expect(result.tick.spread).toBe(0);
    }
  });

  it('bid が正しく ask がスケール崩れの場合は bid で補正する', () => {
    const tick = buildTick({ bid: 4000, ask: 2000, mid: 3000, spread: -2000 });

    const result = normalizeTickWithReference(tick, reference);

    expect(result.status).toBe('fixed');
    if (result.status === 'fixed') {
      expect(result.tick.bid).toBeCloseTo(4000);
      expect(result.tick.ask).toBeCloseTo(4000);
      expect(result.tick.mid).toBeCloseTo(4000);
      expect(result.tick.spread).toBe(0);
    }
  });

  it('両側ともスケールが崩れている場合は drop する', () => {
    const tick = buildTick({ bid: 2100, ask: 2000, mid: 2050, spread: -100 });

    const result = normalizeTickWithReference(tick, reference);

    expect(result.status).toBe('drop');
  });

  it('bid/ask が正常で mid だけズレている場合は平均で補正する', () => {
    const tick = buildTick({ bid: 4000, ask: 4002, mid: 1000, spread: 2 });

    const result = normalizeTickWithReference(tick, reference);

    expect(result.status).toBe('fixed');
    if (result.status === 'fixed') {
      expect(result.tick.mid).toBeCloseTo(4001);
      expect(result.tick.spread).toBeCloseTo(2);
    }
  });
});
