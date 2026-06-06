/**
 * cTraderProvider の接続先 URL 回帰テスト。
 */

import { resolveCTraderWebSocketUrl } from '../../infrastructure/market/CTraderProvider';
// 型のみ import (実行時評価されないため config の env 読み込みは走らない)。
// 実体は各テストで jest.resetModules() + require して env を反映させる。
import type { config as AppConfig } from '../../config';

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
//
// 注意: config は import 時に process.env を読むため、ローカル .env の CTRADER_WS_PORT* に影響されると
// テストが不安定になる。各ケースで env を明示制御し jest.resetModules() で config を再ロードする。
describe('cTrader WebSocket ポートのプロトコル別分離', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    // テスト対象の env のみ操作するため元 env を複製して使う
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.resetModules();
  });

  /** 指定 env を反映した状態で config を再ロードする (env 未指定キーは delete) */
  function loadConfig(overrides: Record<string, string | undefined>): typeof AppConfig {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    jest.resetModules();
    // 動的ロードで env を反映させる必要があるため require を使う (テストの module reset 用途)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('../../config') as { config: typeof AppConfig }).config;
  }

  it('env 未設定なら JSON=5036 / Protobuf=5035 で別ポート', () => {
    const config = loadConfig({ CTRADER_WS_PORT: undefined, CTRADER_WS_PORT_PROTOBUF: undefined });
    expect(config.ctrader.wsPort).toBe(5036);
    expect(config.ctrader.wsPortProtobuf).toBe(5035);
    expect(config.ctrader.wsPort).not.toBe(config.ctrader.wsPortProtobuf);
  });

  it('数値以外/範囲外の env は既定値にフォールバックする (NaN ガード)', () => {
    const config = loadConfig({ CTRADER_WS_PORT: 'abc', CTRADER_WS_PORT_PROTOBUF: '999999' });
    expect(config.ctrader.wsPort).toBe(5036);
    expect(config.ctrader.wsPortProtobuf).toBe(5035);
  });

  it('正当な env は上書きが効く', () => {
    const config = loadConfig({ CTRADER_WS_PORT: '6000', CTRADER_WS_PORT_PROTOBUF: '6001' });
    expect(config.ctrader.wsPort).toBe(6000);
    expect(config.ctrader.wsPortProtobuf).toBe(6001);
  });
});
