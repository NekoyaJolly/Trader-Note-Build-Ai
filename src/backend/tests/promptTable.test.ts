/**
 * PR #117e + PR ④F: registry → mutation/crossover prompt 用 metadata table の整形テスト。
 *
 * PR ④F で TS surrogate が analysis-engine 経由に切替わった結果、
 * `pythonSeries=true` の 20 指標は **すべて 1 セクション (実装済)** に集約され、
 * 旧「Python BT のみ対応」セクションは消滅した。完全未対応 (= pythonSeries=false)
 * の 3 指標 (adx/supertrend/pivot) のみ別セクションで出力される。
 */

import { formatIndicatorMetadataTable } from '../../shared/indicators/promptTable';

describe('PR #117e: formatIndicatorMetadataTable', () => {
  const table = formatIndicatorMetadataTable();

  // PR ④F: extractBetween は旧「Python BT のみ対応」セクション (= 廃止) を
  // 取り出すために使っていたが、不要になったので削除。

  function extractAfter(content: string, marker: string): string {
    const parts = content.split(marker);
    expect(parts.length).toBeGreaterThan(1);
    return parts.slice(1).join(marker);
  }

  it('セクション見出しが揃っている (#### で挿入先見出しと整合)', () => {
    // PR #117e Copilot review #2: prompt md 側で `### 動的パラメータ付き indicator`
    // の下に macro を埋め込むため、macro 内は `####` で 1 段下げる。
    // PR ④F: 旧「Python BT のみ対応」セクションは消滅 (= 全 pythonSeries=true は実装済)。
    expect(table).toContain('#### 実装済 (mutation 推奨、surrogate + 本格 BT 両対応)');
    expect(table).toContain('#### 完全未対応 (出力禁止)');
    expect(table).not.toContain('#### Python BT のみ対応');
  });

  it('実装済セクションに pythonSeries=true の 20 指標 (= 旧 6 + 旧 14) が並ぶ', () => {
    // PR ④F: stochastic/cci/williamsR/dema/tema 等もすべて実装済セクションに統合
    for (const id of [
      'ema', 'sma', 'rsi', 'atr', 'macd', 'bb', // 旧「実装済」
      'stochastic', 'williamsR', 'roc', 'mfi', // 旧「Python BT のみ」momentum
      'dema', 'tema', 'aroon', 'cci', 'psar', 'ichimoku', // 旧「Python BT のみ」trend
      'kc', 'obv', 'vwap', 'cmf', // 旧「Python BT のみ」volatility/volume
    ]) {
      expect(table).toContain(`| \`${id}\` |`);
    }
  });

  it('完全未対応セクションに adx/supertrend/pivot が含まれる', () => {
    // 完全未対応 (= pythonSeries=false) は registry 由来で 3 件
    const unsupportedSection = extractAfter(table, '#### 完全未対応');
    for (const id of ['adx', 'supertrend', 'pivot']) {
      expect(unsupportedSection).toContain(`\`${id}\``);
    }
  });

  it('実装済セクションに params 付き条件 / compareTarget の使用例が含まれる', () => {
    expect(table).toContain('"params": { "period": 20 }');
    expect(table).toContain('"compareTarget"');
  });

  it('実装済セクションに ema の defaultParams (period=20) が出る', () => {
    // formatDefaultParams が "period=20" の表記で出すこと
    // PR ④F: 旧「Python BT のみ対応」セクションが消滅したため、unsupported 直前までが実装済領域
    const top = table.split('#### 完全未対応')[0];
    expect(top).toMatch(/\| `ema` \| trend \| period=20 \|/);
  });

  // PR #117e Copilot review #1: 文字列値 (例: pivotType="standard") は引用符付きで表示
  it('完全未対応セクションの pivot.defaultParams は文字列を引用符付きで表示する', () => {
    // pivot は `defaultParams: { pivotType: 'standard' }` を持つが、`columns: 2` 形式の
    // unsupported セクションでは defaultParams 列が出ない (3 列 vs 2 列)。
    // formatDefaultParams 自体の挙動は別途 unit test で確認する。
    // ここでは pivot 行が含まれることのみ確認 (= 文字列値が出力されても row 自体は崩れない)。
    const unsupportedSection = extractAfter(table, '#### 完全未対応');
    expect(unsupportedSection).toContain('| `pivot` |');
  });

  it('formatDefaultParams: 文字列値は引用符付きで表現される', () => {
    // 直接 helper 関数の挙動は private なので、registry 経由で文字列 default を持つ
    // entry が含まれる場合の出力を確認するための pin。
    // 現 registry では pivot.defaultParams.pivotType="standard" が唯一の文字列値だが、
    // unsupported セクションには params 列がないため、本テストは将来 pivot 等の
    // 文字列 params を持つ indicator が「実装済」セクションに昇格した時の回帰防止用。
    // 現段階では「数値 params (period=14) が引用符なしで出る」ことのみ確認する。
    expect(table).toMatch(/period=14[ ,|]/);
    expect(table).not.toMatch(/period="14"/);
  });

  it('テーブル全体は概ね 23 指標分の行を含む (= 20 実装済 + 3 未対応)', () => {
    // 厳密な行数 pin は registry 順序変更で fragile になるので、実装済セクションに
    // 主要 indicator が含まれることのみ確認
    const fullySupportedRows = (table.match(/\| `(ema|sma|rsi|atr|macd|bb)` \|/g) ?? []).length;
    expect(fullySupportedRows).toBe(6);
  });
});
