/**
 * PR #115: 共通 INDICATOR registry のテスト。
 *
 * registry.json (canonical) が Zod parse を通り、Side-A 既存の
 * INDICATOR_METADATA 経路と整合し、Python 評価器 (analysis-engine
 * indicators.py) でサポートされる指標が `support.pythonSeries=true` で
 * マークされていることを pin する。
 *
 * このテストが失敗する典型的なケース:
 *   - registry.json に未対応カテゴリ / strict 違反のフィールドを入れた
 *   - Python 側 indicators.py に新指標を追加したが registry を更新し忘れた
 *   - Side-A 既存 API (INDICATOR_METADATA) を壊した
 */

import { readFileSync } from 'fs';
import path from 'path';

import { INDICATOR_METADATA, getIndicatorMetadata, getIndicatorsByCategory } from '../../models/indicatorConfig';
import {
  INDICATOR_IDS,
  INDICATOR_REGISTRY,
  IndicatorRegistryEntrySchema,
  IndicatorRegistryFileSchema,
  PivotTypeSchema,
  getIndicatorRegistryEntry,
  getPythonSupportedIndicators,
  isIndicatorId,
} from '../../shared/indicators/registry';

const REGISTRY_JSON_PATH = path.join(__dirname, '../../shared/indicators/data/registry.json');

describe('PR #115: shared indicator registry', () => {
  describe('registry.json (canonical)', () => {
    it('Zod 構造検証を通る (strict / 23 件 / version=1)', () => {
      const raw = JSON.parse(readFileSync(REGISTRY_JSON_PATH, 'utf-8'));
      const parsed = IndicatorRegistryFileSchema.parse(raw);
      expect(parsed.version).toBe(1);
      expect(parsed.indicators).toHaveLength(23);
    });

    it('id がユニーク', () => {
      const ids = INDICATOR_REGISTRY.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('全エントリが IndicatorRegistryEntrySchema (strict) を満たす', () => {
      for (const entry of INDICATOR_REGISTRY) {
        expect(() => IndicatorRegistryEntrySchema.parse(entry)).not.toThrow();
      }
    });

    it('登録順は変更しないこと (PR #115 時点の登録順を pin)', () => {
      // UI 表示順 / mutation prompt 列挙順が安定するよう登録順をテストで pin する。
      // 順序を変える時はこのテストを意図的に更新すること (= 影響範囲レビュー)。
      const expected = [
        'rsi', 'stochastic', 'williamsR', 'roc', 'mfi',
        'sma', 'ema', 'dema', 'tema', 'macd', 'aroon', 'cci', 'psar', 'ichimoku',
        'atr', 'bb', 'kc',
        'obv', 'vwap', 'cmf',
        'adx', 'supertrend', 'pivot',
      ];
      expect(INDICATOR_IDS).toEqual(expected);
    });
  });

  describe('Python 評価器サポート (analysis-engine indicators.py)', () => {
    /**
     * 2026-05-07 時点で analysis-engine `app/indicators.py:compute_indicator_series` が
     * 実装している指標 ID 集合。registry.json の `support.pythonSeries=true` と
     * 完全一致することをテストで pin する。
     *
     * 新指標を Python 側に追加した時はこの配列を更新 + registry.json も同時に
     * `pythonSeries: true` に変える。
     */
    const PYTHON_SUPPORTED = new Set([
      'sma', 'ema', 'rsi', 'macd', 'bb', 'atr',
      'stochastic', 'obv', 'vwap',
      'williamsR', 'cci', 'aroon', 'roc', 'mfi', 'cmf',
      'dema', 'tema', 'kc', 'psar', 'ichimoku',
    ]);

    it('20 指標が pythonSeries=true (analysis-engine 実装済)', () => {
      const flagged = getPythonSupportedIndicators().map((e) => e.id);
      expect(new Set(flagged)).toEqual(PYTHON_SUPPORTED);
    });

    it('Python 未実装の 3 指標 (adx / supertrend / pivot) は pythonSeries=false', () => {
      for (const id of ['adx', 'supertrend', 'pivot']) {
        const entry = getIndicatorRegistryEntry(id);
        expect(entry).toBeDefined();
        expect(entry?.support.pythonSeries).toBe(false);
      }
    });

    it('PR ④F 後: tsSurrogate=true は pythonSeries=true と同義 (= 20 指標)', () => {
      // PR ④F で TS surrogate も analysis-engine 経由で indicator を取得する
      // ようになり、TS 側で再計算しなくなったため、pythonSeries=true なら
      // すべて tsSurrogate=true。pythonSeries=false の adx/supertrend/pivot のみ
      // tsSurrogate=false のまま。
      const tsSurrogateIds = INDICATOR_REGISTRY
        .filter((e) => e.support.tsSurrogate)
        .map((e) => e.id)
        .sort();
      const pythonSeriesIds = INDICATOR_REGISTRY
        .filter((e) => e.support.pythonSeries)
        .map((e) => e.id)
        .sort();
      expect(tsSurrogateIds).toEqual(pythonSeriesIds);
      expect(tsSurrogateIds).toHaveLength(20);
    });

    it('PR ④F 後: tsSurrogate=false なのは pythonSeries=false の 3 指標のみ', () => {
      const notTsSurrogate = INDICATOR_REGISTRY
        .filter((e) => !e.support.tsSurrogate)
        .map((e) => e.id)
        .sort();
      expect(notTsSurrogate).toEqual(['adx', 'pivot', 'supertrend']);
    });
  });

  describe('helpers', () => {
    it('getIndicatorRegistryEntry: 既知 id は entry を返す', () => {
      const rsi = getIndicatorRegistryEntry('rsi');
      expect(rsi).toBeDefined();
      expect(rsi?.category).toBe('momentum');
      expect(rsi?.defaultParams).toEqual({ period: 14 });
    });

    it('getIndicatorRegistryEntry: 未知 id は undefined', () => {
      expect(getIndicatorRegistryEntry('nonexistent_xyz')).toBeUndefined();
    });

    it('isIndicatorId: registry に登録された id のみ true', () => {
      expect(isIndicatorId('rsi')).toBe(true);
      expect(isIndicatorId('nonexistent_xyz')).toBe(false);
    });
  });

  describe('Side-A 既存 API 互換性 (= PR #115 で壊さないこと)', () => {
    it('INDICATOR_METADATA の長さは registry と一致 (23 件)', () => {
      expect(INDICATOR_METADATA).toHaveLength(INDICATOR_REGISTRY.length);
      expect(INDICATOR_METADATA).toHaveLength(23);
    });

    it('INDICATOR_METADATA は registry の登録順を保つ', () => {
      const metaIds = INDICATOR_METADATA.map((m) => m.id);
      expect(metaIds).toEqual([...INDICATOR_IDS]);
    });

    it('getIndicatorMetadata("rsi") は registry の rsi と整合', () => {
      const meta = getIndicatorMetadata('rsi');
      const entry = getIndicatorRegistryEntry('rsi');
      expect(meta?.id).toBe(entry?.id);
      expect(meta?.displayName).toBe(entry?.displayName);
      expect(meta?.category).toBe(entry?.category);
      expect(meta?.defaultParams).toEqual(entry?.defaultParams);
      expect(meta?.paramConstraints).toEqual(entry?.paramConstraints);
    });

    it('getIndicatorsByCategory("momentum") に 5 種類 (rsi/stochastic/williamsR/roc/mfi)', () => {
      const ids = getIndicatorsByCategory('momentum').map((m) => m.id).sort();
      expect(ids).toEqual(['mfi', 'roc', 'rsi', 'stochastic', 'williamsR'].sort());
    });

    it('Side-A の IndicatorMetadata 形には support フィールドが漏れていない', () => {
      // registry の `support` は Side-B 用なので Side-A の `IndicatorMetadata` には projection 時に落とす
      for (const meta of INDICATOR_METADATA) {
        expect(meta).not.toHaveProperty('support');
      }
    });

    // PR #115 Copilot review #3: defaultParams の shallow copy が機能することを pin
    it('getIndicatorMetadata の defaultParams を mutation しても registry 側が汚染されない', () => {
      const m1 = getIndicatorMetadata('rsi');
      // defaultParams は IndicatorParams 型 (period 等の optional field) なので
      // 直接代入ではなく Object.assign で書き換える
      Object.assign(m1?.defaultParams ?? {}, { period: 999 });
      const m2 = getIndicatorMetadata('rsi');
      expect(m2?.defaultParams).toEqual({ period: 14 });
      expect(getIndicatorRegistryEntry('rsi')?.defaultParams).toEqual({ period: 14 });
    });
  });

  // PR #115 Copilot review #1 + #2: defaultParams の値型を indicator 別に厳密化
  describe('defaultParams 値型の厳密化 (Copilot review #1 + #2)', () => {
    function makeBaseEntry(): Record<string, unknown> {
      return {
        id: 'rsi',
        displayName: 'RSI',
        category: 'momentum',
        description: 'desc',
        defaultParams: { period: 14 },
        paramConstraints: {},
        support: { pythonSeries: true, tsSurrogate: false },
      };
    }

    it('rsi.defaultParams.period が number なら通る', () => {
      const entry = { ...makeBaseEntry(), defaultParams: { period: 14 } };
      expect(() => IndicatorRegistryEntrySchema.parse(entry)).not.toThrow();
    });

    it('rsi.defaultParams.period が string ("14") だと弾く (validateIndicatorConfig が数値比較を前提とするため)', () => {
      const entry = { ...makeBaseEntry(), defaultParams: { period: '14' } };
      expect(() => IndicatorRegistryEntrySchema.parse(entry)).toThrow(/数値である必要がある/);
    });

    it('pivot.defaultParams.pivotType は PivotTypeSchema の値のみ通る', () => {
      const base = { ...makeBaseEntry(), id: 'pivot', displayName: 'Pivot', category: 'support_resistance' as const };
      // standard / fibonacci / camarilla はすべて通る
      for (const t of PivotTypeSchema.options) {
        const entry = { ...base, defaultParams: { pivotType: t } };
        expect(() => IndicatorRegistryEntrySchema.parse(entry)).not.toThrow();
      }
      // 範囲外は弾く
      const bad = { ...base, defaultParams: { pivotType: 'invalid_xyz' } };
      expect(() => IndicatorRegistryEntrySchema.parse(bad)).toThrow(/pivotType は/);
    });

    it('PivotTypeSchema は実際に schema 内で参照されている (= 不要定義ではない)', () => {
      // Copilot review #1: PivotTypeSchema が unused だと指摘されていたが
      // superRefine で利用するように変更した。`pivotType: "invalid"` を弾くことで
      // 実際に schema 経由で使われていることを保証する。
      const entry = { ...makeBaseEntry(), id: 'pivot', defaultParams: { pivotType: 'invalid' } };
      expect(() => IndicatorRegistryEntrySchema.parse(entry)).toThrow();
    });
  });
});
