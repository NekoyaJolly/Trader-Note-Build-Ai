/**
 * cTraderProvider の接続先 URL 回帰テスト。
 */

import { resolveCTraderWebSocketUrl } from '../../infrastructure/market/CTraderProvider';
import { config } from '../../config';

describe('resolveCTraderWebSocketUrl', () => {
  it('ポート未指定の cTrader WebSocket URL には設定ポート(JSON=5036)を補う', () => {
    expect(resolveCTraderWebSocketUrl('wss://live.ctraderapi.com', 5036)).toBe(
      'wss://live.ctraderapi.com:5036/',
    );
  });

  it('URL にポートが明示されている場合は既存ポートを維持する', () => {
    expect(resolveCTraderWebSocketUrl('wss://live.ctraderapi.com:5035', 5036)).toBe(
      'wss://live.ctraderapi.com:5035/',
    );
  });
});

// プロトコル別ポート分離の回帰テスト。
// 背景: PR #339 で wsPort を JSON 用 5036 に変えた際、Protobuf 経路 (ログイン fetchAccountId /
// ctraderDataService) が同じ wsPort を共有していたため 5036 に繋いで無応答ハングし、本番ログインが
// 全面停止した。JSON=wsPort(5036) と Protobuf=wsPortProtobuf(5035) が別であることを固定する。
describe('cTrader WebSocket ポートのプロトコル別分離', () => {
  it('JSON プロトコル用 wsPort は既定 5036', () => {
    expect(config.ctrader.wsPort).toBe(5036);
  });

  it('Protobuf プロトコル用 wsPortProtobuf は既定 5035', () => {
    expect(config.ctrader.wsPortProtobuf).toBe(5035);
  });

  it('JSON と Protobuf のポートは別であること (共有すると一方が必ず壊れる)', () => {
    expect(config.ctrader.wsPort).not.toBe(config.ctrader.wsPortProtobuf);
  });
});
