/**
 * @reiryoku/ctrader-layer の依存解決回帰テスト。
 */

import { createRequire } from 'module';

const requireFromTest = createRequire(__filename);

describe('@reiryoku/ctrader-layer dependency resolution', () => {
  it('ctrader-layer は loadProtoFile を持つ protobufjs v5 系を参照する', () => {
    const ctraderLayerEntry = requireFromTest.resolve('@reiryoku/ctrader-layer');
    const requireFromCtraderLayer = createRequire(ctraderLayerEntry);
    const resolvedProtobufPackage = requireFromCtraderLayer.resolve('protobufjs/package.json');
    const protobuf = requireFromCtraderLayer('protobufjs') as {
      loadProtoFile?: (file: string, builder?: object) => object;
    };

    // Windows ではパス区切りが \ になるため、比較前に / へ正規化する
    // (Mac→Windows 開発環境移行で顕在化したクロスプラットフォーム問題の修正)
    expect(resolvedProtobufPackage.split('\\').join('/')).toContain(
      '@reiryoku/ctrader-layer/node_modules/protobufjs'
    );
    expect(typeof protobuf.loadProtoFile).toBe('function');
  });

  it('CTraderConnection の生成時に protobuf 読み込みで例外を出さない', () => {
    const ctraderLayer = requireFromTest('@reiryoku/ctrader-layer') as {
      CTraderConnection: new (config: { host: string; port: number }) => object;
    };

    expect(() => new ctraderLayer.CTraderConnection({ host: 'localhost', port: 5035 })).not.toThrow();
  });
});
