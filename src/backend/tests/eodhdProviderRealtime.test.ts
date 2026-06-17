/**
 * EodhdProvider WebSocket 購読 (realtime) の単体テスト
 *
 * 本番障害の再発防止:
 * - 症状: `InvalidStateError: Sent before connected.` で購読が成立せず RealtimeOHLCV が凍結。
 * - 原因: orchestrator が空 symbols で先に connect → open 前の socket に ws.subscribe() を送出。
 * - 修正: socket 生成を「購読 symbol が確定する最初の subscribe」まで遅延し、必ず SDK の
 *   コンストラクタ初期 symbols 経路 (onopen で購読 = race-free) に乗せる。
 *
 * ここでは EODHD SDK を jest.mock でスタブ化し、上記の経路が守られているかを検証する。
 */

import type { TickData } from '../../infrastructure/market/IMarketDataProvider';

/** SDK が返す WebSocket クライアントのスタブ (provider が使う on/subscribe/unsubscribe/close のみ) */
const wsMock = {
  on: jest.fn(),
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

    // socket は初期 symbols 付きで 1 回だけ生成される
    expect(sdkMocks.websocket).toHaveBeenCalledTimes(1);
    const [feed, initialSymbols] = sdkMocks.websocket.mock.calls[0];
    expect(feed).toBe('forex');
    expect(initialSymbols).toEqual(['XAUUSD.FOREX']);

    // open 前 socket への ws.subscribe() (= Sent before connected の原因) は呼ばれない
    expect(wsMock.subscribe).not.toHaveBeenCalled();
  });

  it('接続後に新規 symbol を追加したときだけ ws.subscribe() をライブ購読で呼ぶ', async () => {
    const provider = new EodhdProvider({ apiToken: 'test-token' });
    await provider.subscribeToTicks(['XAU/USD'], noopTick); // socket 生成 (初期 symbols)
    expect(sdkMocks.websocket).toHaveBeenCalledTimes(1);

    // 新規 symbol → 既に open 済みの socket に対して subscribe
    await provider.addSymbols(['EUR/USD']);
    expect(wsMock.subscribe).toHaveBeenCalledTimes(1);
    expect(wsMock.subscribe).toHaveBeenCalledWith(['EURUSD.FOREX']);

    // socket は再生成されない
    expect(sdkMocks.websocket).toHaveBeenCalledTimes(1);
  });

  it('既に購読済みの symbol を再追加しても ws.subscribe() は呼ばない (重複購読を避ける)', async () => {
    const provider = new EodhdProvider({ apiToken: 'test-token' });
    await provider.subscribeToTicks(['XAU/USD'], noopTick);

    await provider.addSymbols(['XAU/USD']); // 既存と同じ
    expect(wsMock.subscribe).not.toHaveBeenCalled();
  });
});
