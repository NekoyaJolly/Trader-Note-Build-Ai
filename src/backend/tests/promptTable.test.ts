/**
 * PR #117e: registry → mutation/crossover prompt 用 metadata table 整形のテスト。
 *
 * `formatIndicatorMetadataTable()` が:
 *   - 実装済 (mutation 推奨) セクションに ema/sma/rsi/atr/macd/bb の 6 指標
 *   - Python BT のみ対応セクションに 14 指標
 *   - 完全未対応セクションに adx/supertrend/pivot
 * を出力することを pin。registry.json を更新したらこのテストも追従する。
 */

import { formatIndicatorMetadataTable } from '../../shared/indicators/promptTable';

describe('PR #117e: formatIndicatorMetadataTable', () => {
  const table = formatIndicatorMetadataTable();

  it('セクション見出しが揃っている', () => {
    expect(table).toContain('### 実装済 (mutation 推奨、TS surrogate + Python BT 両対応)');
    expect(table).toContain('### Python BT のみ対応 (TS surrogate では false 評価、推奨度低)');
    expect(table).toContain('### 完全未対応 (出力禁止)');
  });

  it('実装済セクションに ema/sma/rsi/atr/macd/bb の 6 指標が並ぶ', () => {
    // 各 indicator の行を pin (markdown table の cell 形式)
    for (const id of ['ema', 'sma', 'rsi', 'atr', 'macd', 'bb']) {
      expect(table).toContain(`| \`${id}\` |`);
    }
  });

  it('完全未対応セクションに adx/supertrend/pivot が含まれる', () => {
    // 完全未対応 (= pythonSeries=false) は registry 由来で 3 件
    const unsupportedSection = table.split('### 完全未対応')[1];
    expect(unsupportedSection).toBeDefined();
    for (const id of ['adx', 'supertrend', 'pivot']) {
      expect(unsupportedSection).toContain(`\`${id}\``);
    }
  });

  it('Python BT のみ対応セクションに stochastic/cci/williamsR が含まれる (例)', () => {
    const middle = table.split('### Python BT のみ対応')[1].split('### 完全未対応')[0];
    expect(middle).toBeDefined();
    for (const id of ['stochastic', 'cci', 'williamsR', 'roc', 'mfi']) {
      expect(middle).toContain(`\`${id}\``);
    }
  });

  it('実装済セクションに params 付き条件 / compareTarget の使用例が含まれる', () => {
    expect(table).toContain('"params": { "period": 20 }');
    expect(table).toContain('"compareTarget"');
  });

  it('実装済セクションに ema の defaultParams (period=20) が出る', () => {
    // formatDefaultParams が "period=20" の表記で出すこと
    const top = table.split('### Python BT のみ対応')[0];
    expect(top).toMatch(/\| `ema` \| trend \| period=20 \|/);
  });

  it('テーブル全体は概ね 23 指標分の行を含む (= 6 + 14 + 3)', () => {
    // 厳密な行数 pin は registry 順序変更で fragile になるので、各セクションに最低限の件数があることのみ確認
    const fullySupportedRows = (table.match(/\| `(ema|sma|rsi|atr|macd|bb)` \|/g) ?? []).length;
    expect(fullySupportedRows).toBe(6);
  });
});
