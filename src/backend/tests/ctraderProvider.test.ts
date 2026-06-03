/**
 * cTraderProvider の接続先 URL 回帰テスト。
 */

import { resolveCTraderWebSocketUrl } from '../../infrastructure/market/CTraderProvider';

describe('resolveCTraderWebSocketUrl', () => {
  it('ポート未指定の cTrader WebSocket URL には Protobuf 用ポートを補う', () => {
    expect(resolveCTraderWebSocketUrl('wss://live.ctraderapi.com', 5035)).toBe(
      'wss://live.ctraderapi.com:5035/',
    );
  });

  it('URL にポートが明示されている場合は既存ポートを維持する', () => {
    expect(resolveCTraderWebSocketUrl('wss://live.ctraderapi.com:5036', 5035)).toBe(
      'wss://live.ctraderapi.com:5036/',
    );
  });
});
