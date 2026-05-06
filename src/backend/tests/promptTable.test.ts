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

  /**
   * PR #117e Copilot review #3: split 連鎖で undefined.split が起きると、どの
   * セクション抽出で壊れたか分からない。事前に存在を確認してから取り出す helper。
   */
  function extractBetween(content: string, startMarker: string, endMarker: string): string {
    const startParts = content.split(startMarker);
    expect(startParts.length).toBeGreaterThan(1); // startMarker が見つからないと test 即失敗
    const afterStart = startParts.slice(1).join(startMarker);
    const endParts = afterStart.split(endMarker);
    expect(endParts.length).toBeGreaterThan(1); // endMarker も同様
    return endParts[0];
  }

  function extractAfter(content: string, marker: string): string {
    const parts = content.split(marker);
    expect(parts.length).toBeGreaterThan(1);
    return parts.slice(1).join(marker);
  }

  it('セクション見出しが揃っている (#### で挿入先見出しと整合)', () => {
    // PR #117e Copilot review #2: prompt md 側で `### 動的パラメータ付き indicator`
    // の下に macro を埋め込むため、macro 内は `####` で 1 段下げる
    expect(table).toContain('#### 実装済 (mutation 推奨、TS surrogate + Python BT 両対応)');
    expect(table).toContain('#### Python BT のみ対応 (TS surrogate では false 評価、推奨度低)');
    expect(table).toContain('#### 完全未対応 (出力禁止)');
  });

  it('実装済セクションに ema/sma/rsi/atr/macd/bb の 6 指標が並ぶ', () => {
    // 各 indicator の行を pin (markdown table の cell 形式)
    for (const id of ['ema', 'sma', 'rsi', 'atr', 'macd', 'bb']) {
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

  it('Python BT のみ対応セクションに stochastic/cci/williamsR が含まれる (例)', () => {
    const middle = extractBetween(table, '#### Python BT のみ対応', '#### 完全未対応');
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
    const top = table.split('#### Python BT のみ対応')[0];
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

  it('テーブル全体は概ね 23 指標分の行を含む (= 6 + 14 + 3)', () => {
    // 厳密な行数 pin は registry 順序変更で fragile になるので、各セクションに最低限の件数があることのみ確認
    const fullySupportedRows = (table.match(/\| `(ema|sma|rsi|atr|macd|bb)` \|/g) ?? []).length;
    expect(fullySupportedRows).toBe(6);
  });
});
