/**
 * EodhdProvider WebSocket 購読 (realtime) の単体テスト
 *
 * 本番障害の再発防止:
 * - 症状: `InvalidStateError: Sent before connected.` で購読が成立せず RealtimeOHLCV が凍結。
 * - 原因: orchestrator が空 symbols で先に connect → open 前の socket に ws.subscribe() を送出。
 * - 修正: socket 生成を「購読 symbol が確定する最初の subscribe」まで遅延し、必ず SDK の
 *   コンストラクタ初期 symbols 経路 (onopen で購読 = race-free) に乗せる。さらに open 未確定の
 *   間に symbol を追加する場合も ws.subscribe() を呼ばず、初期 symbols 経路で張り直す
 *   (Copilot review PR #429 指摘)。
 */

import type { TickData } from '../../infrastructure/market/IMarketDataProvider';

type WsTick = { s: string; p: number; t: number };
type WsListener = (arg: WsTick) => void;

/** SDK が返す WebSocket クライアントのスタブ (provider が使う on/subscribe/unsubscribe/close のみ) */
const wsMock = {
  on: jest.fn<void, [string, WsListener]>(),
  subscribe: jest.fn<void, [string[]]>(),
  unsubscribe: jest.fn<void, [string[]]>(),
  close: jest.fn<void, []>(),
};

const sdkMocks = {
  websocket: jest.fn<typeof wsMock, [string, string[]]>(),
};

jest.mock('eodhd', () => ({
  EODHDClient: jest.fn().mockImplementation(() => ({
    websocket: sdkMocks.websocket,
  })),
}));

import { EodhdProvider } from '../../infrastructure/market/EodhdProvider';

/** wsMock.on に登録された 'data' リスナを呼び、tick 受信 (= open 確定) を模擬する */
function emitTick(symbol = 'XAUUSD', price = 4300): void {
  const dataCall = wsMock.on.mock.calls.find((c) => c[0] === 'data');
  const listener = dataCall?.[1];
  if (!listener) throw new Error('data listener が登録されていない');
  listener({ s: symbol, p: price, t: 1_781_728_844_000 });
}

describe('EodhdProvider — realtime WS 購読 (Sent before connected レース対策)', () => {
  beforeEach(() => {
    wsMock.on.mockReset();
    wsMock.subscribe.mockReset();
    wsMock.unsubscribe.mockReset();
    wsMock.close.mockReset();
    sdkMocks.websocket.mockReset();
    sdkMocks.websocket.mockReturnValue(wsMock);
  });

  const noopTick = (_tick: TickData): void => {
    void _tick;
  };

  it('connect() を symbol 未確定で呼んでも socket を生成しない (空 symbols での早すぎる接続を防ぐ)', async () => {
    const provider = new EodhdProvider({ apiToken: 'test-token' });
    const ok = await provider.connect();

    expect(ok).toBe(true);
    expect(sdkMocks.websocket).not.toHaveBeenCalled();
  });

  it('最初の subscribeToTicks は socket を「初期 symbols 付き」で生成し、ws.subscribe() は呼ばない (race-free)', async () => {
    const provider = new EodhdProvider({ apiToken: 'test-token' });
    // orchestrator と同じ順序: 先に connect (空) → その後 subscribe
    await provider.connect();
    await provider.subscribeToTicks(['XAU/USD'], noopTick);

    expect(sdkMocks.websocket).toHaveBeenCalledTimes(1);
    const [feed, initialSymbols] = sdkMocks.websocket.mock.calls[0];
    expect(feed).toBe('forex');
    expect(initialSymbols).toEqual(['XAUUSD.FOREX']);
    expect(wsMock.subscribe).not.toHaveBeenCalled();
  });

  it('open 未確定のまま新規 symbol を追加したら、ws.subscribe() ではなく初期 symbols 経路で張り直す', async () => {
    const provider = new EodhdProvider({ apiToken: 'test-token' });
    await provider.subscribeToTicks(['XAU/USD'], noopTick); // socket 生成 (まだ tick 未受信 = open 未確定)
    expect(sdkMocks.websocket).toHaveBeenCalledTimes(1);

    await provider.addSymbols(['EUR/USD']);

    // open 前 send を避けるため ws.subscribe() は呼ばない
    expect(wsMock.subscribe).not.toHaveBeenCalled();
    // 旧 socket を閉じ、確定した全 symbol を初期 symbols として張り直す
    expect(wsMock.close).toHaveBeenCalledTimes(1);
    expect(sdkMocks.websocket).toHaveBeenCalledTimes(2);
    const [, reopenSymbols] = sdkMocks.websocket.mock.calls[1];
    expect(reopenSymbols).toEqual(['XAUUSD.FOREX', 'EURUSD.FOREX']);
  });

  it('open 確定後 (tick 受信後) は新規 symbol を ws.subscribe() でライブ購読する (張り直さない)', async () => {
    const provider = new EodhdProvider({ apiToken: 'test-token' });
    await provider.subscribeToTicks(['XAU/USD'], noopTick);
    emitTick(); // 最初の tick = open 確定

    await provider.addSymbols(['EUR/USD']);

    expect(wsMock.subscribe).toHaveBeenCalledTimes(1);
    expect(wsMock.subscribe).toHaveBeenCalledWith(['EURUSD.FOREX']);
    // 張り直しは起きない
    expect(wsMock.close).not.toHaveBeenCalled();
    expect(sdkMocks.websocket).toHaveBeenCalledTimes(1);
  });

  it('既に購読済みの symbol を再追加しても ws.subscribe() も張り直しもしない', async () => {
    const provider = new EodhdProvider({ apiToken: 'test-token' });
    await provider.subscribeToTicks(['XAU/USD'], noopTick);
    emitTick();

    await provider.addSymbols(['XAU/USD']); // 既存と同じ
    expect(wsMock.subscribe).not.toHaveBeenCalled();
    expect(wsMock.close).not.toHaveBeenCalled();
    expect(sdkMocks.websocket).toHaveBeenCalledTimes(1);
  });
});
