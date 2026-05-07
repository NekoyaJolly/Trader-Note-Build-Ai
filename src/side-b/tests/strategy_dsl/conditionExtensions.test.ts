/**
 * PR #116a: DSL Condition の拡張 (params / compareTarget) と snapshot key 正規化のテスト。
 *
 * 確認:
 *   1. 既存 DSL ({ lens, feature, op, value }) はそのまま parse 通る (後方互換)
 *   2. params 付き condition が parse 通る (動的 indicator パラメータ)
 *   3. compareTarget 付き condition が parse 通る (indicator operand)
 *   4. value と compareTarget の排他性 (両方 / どちらも無し は parse エラー)
 *   5. snapshot key 構築の挙動 (params 順序非依存、Number 正規化)
 *   6. dslToBacktestNotePayload で compareTarget をネイティブ schema で表現
 *      (PR #116c で sentinel 経路は撤去済み、`ScreeningBacktestCondition.compareTarget`
 *      フィールドにそのまま載る)
 */

import {
  UNSUPPORTED_COMPARE_TARGET_SENTINEL,
  dslToBacktestNotePayload,
} from '../../strategy_dsl/dslToBacktestNotePayload';
import {
  ConditionSchema,
  IndicatorOperandSchema,
  StrategyDSLSchema,
  type ConditionValue,
  type StrategyDSL,
} from '../../strategy_dsl/schema';
import { buildSnapshotKey, formatStableParams } from '../../strategy_dsl/snapshotKey';

/**
 * テスト用 trigger conditions の入力型 (Condition leaf の最小形)。
 * PR #116a Copilot review #5: `unknown[]` は型が弱すぎるため、Condition の
 * input 形に揃える (parse 通る形で受ける)。group ネストは現テストでは未使用のため
 * leaf 型のみで十分。
 *
 * PR #120 Copilot review #2: `value?: unknown` は any/unknown 禁止 rule に違反する
 * ため、schema が受け付ける `ConditionValue` 型に揃える (= literal / ParamRef /
 * range / set のいずれか)。
 */
type ConditionLeafInput = {
  lens: string;
  feature: string;
  op: string;
  value?: ConditionValue;
  params?: Record<string, number>;
  compareTarget?: { lens: string; feature: string; params?: Record<string, number> };
};

function makeBaseStrategy(triggerConditions: ConditionLeafInput[]): StrategyDSL {
  return StrategyDSLSchema.parse({
    id: 'test-strategy',
    generation: 0,
    parentIds: [],
    regimeTarget: 'breakout',
    symbol: 'EURUSD',
    timeframe: '1h',
    entry: {
      direction: 'long',
      trigger: { logic: 'AND', conditions: triggerConditions },
      orderType: 'market',
    },
    stopLoss: { type: 'atr_multiple', value: 1.5 },
    takeProfit: { type: 'rr_ratio', value: 2 },
    parameters: {},
    metadata: {
      createdAt: '2026-05-07T00:00:00Z',
      createdBy: 'mutation',
      description: 'PR #116a test',
    },
  });
}

describe('PR #116a: ConditionSchema 拡張', () => {
  describe('1. 既存 DSL の後方互換 (params / compareTarget なし)', () => {
    it('value=number の condition は parse 通る', () => {
      const c = { lens: 'ohlcv', feature: 'rsi', op: '<', value: 30 };
      expect(() => ConditionSchema.parse(c)).not.toThrow();
    });

    it('value=ParamRef の condition は parse 通る', () => {
      const c = { lens: 'ohlcv', feature: 'rsi', op: '<', value: '$threshold' };
      expect(() => ConditionSchema.parse(c)).not.toThrow();
    });

    it('value=tuple [number, number] (between) の condition は parse 通る', () => {
      const c = { lens: 'ohlcv', feature: 'rsi', op: 'between', value: [30, 70] };
      expect(() => ConditionSchema.parse(c)).not.toThrow();
    });
  });

  describe('2. params 付き condition (動的 indicator パラメータ)', () => {
    it('feature=ema + params={period:20} は parse 通る', () => {
      const c = { lens: 'ohlcv', feature: 'ema', op: '>', value: 1.05, params: { period: 20 } };
      expect(() => ConditionSchema.parse(c)).not.toThrow();
    });

    it('feature=macd + params={fastPeriod, slowPeriod, signalPeriod} は parse 通る', () => {
      const c = {
        lens: 'ohlcv',
        feature: 'macd',
        op: '>',
        value: 0,
        params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
      };
      expect(() => ConditionSchema.parse(c)).not.toThrow();
    });

    it('params の値は数値のみ (PR #116a の v1 制約)', () => {
      const c = { lens: 'ohlcv', feature: 'ema', op: '>', value: 1, params: { period: 'twenty' } };
      expect(() => ConditionSchema.parse(c)).toThrow();
    });
  });

  describe('3. compareTarget 付き condition (indicator operand)', () => {
    it('compareTarget で別 indicator を operand にできる', () => {
      const c = {
        lens: 'ohlcv',
        feature: 'close',
        op: '>',
        compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 20 } },
      };
      expect(() => ConditionSchema.parse(c)).not.toThrow();
    });

    it('IndicatorOperandSchema は params なしでも通る', () => {
      const op = { lens: 'ohlcv', feature: 'sma' };
      expect(() => IndicatorOperandSchema.parse(op)).not.toThrow();
    });
  });

  describe('4. value と compareTarget の排他性', () => {
    it('value も compareTarget も無いと parse エラー', () => {
      const c = { lens: 'ohlcv', feature: 'close', op: '>' };
      expect(() => ConditionSchema.parse(c)).toThrow(/value または compareTarget/);
    });

    it('value と compareTarget を両方指定すると parse エラー', () => {
      const c = {
        lens: 'ohlcv',
        feature: 'close',
        op: '>',
        value: 1.05,
        compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 20 } },
      };
      expect(() => ConditionSchema.parse(c)).toThrow(/同時指定/);
    });
  });

  describe('5. snapshot key 構築 (buildSnapshotKey / formatStableParams)', () => {
    it('params なし: lens.feature 形式', () => {
      expect(buildSnapshotKey('ohlcv', 'rsi')).toBe('ohlcv.rsi');
      expect(buildSnapshotKey('ohlcv', 'rsi', {})).toBe('ohlcv.rsi');
    });

    it('params あり: lens.feature(stable_params) 形式', () => {
      expect(buildSnapshotKey('ohlcv', 'ema', { period: 20 })).toBe('ohlcv.ema(period=20)');
    });

    it('params の順序非依存: 同じ key/value なら必ず同じ snapshot key', () => {
      const a = buildSnapshotKey('ohlcv', 'macd', { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 });
      const b = buildSnapshotKey('ohlcv', 'macd', { signalPeriod: 9, slowPeriod: 26, fastPeriod: 12 });
      expect(a).toBe(b);
      expect(a).toContain('fastPeriod=12');
      expect(a).toContain('slowPeriod=26');
      expect(a).toContain('signalPeriod=9');
    });

    it('formatStableParams: キー昇順でカンマ区切り', () => {
      expect(formatStableParams({ b: 2, a: 1 })).toBe('a=1,b=2');
    });

    it('-0 を 0 に正規化', () => {
      expect(formatStableParams({ x: -0 })).toBe('x=0');
    });

    it('非有限値 (NaN / Infinity) はエラー', () => {
      expect(() => formatStableParams({ x: NaN })).toThrow();
      expect(() => formatStableParams({ x: Infinity })).toThrow();
    });
  });

  describe('6. dslToBacktestNotePayload: PR #116c で compareTarget をネイティブ schema で表現', () => {
    it('value 付き condition は通常の payload', () => {
      const dsl = makeBaseStrategy([{ lens: 'ohlcv', feature: 'rsi', op: '<', value: 30 }]);
      const payload = dslToBacktestNotePayload(dsl, {});
      const conds = payload.conditions ?? [];
      expect(conds).toHaveLength(1);
      expect(conds[0]).toMatchObject({ lensName: 'ohlcv', featureKey: 'rsi', op: '<', value: 30 });
      // params なし condition は notePayload.indicators[] には積まれない (= static feature)
      expect(payload.indicators).toEqual([]);
    });

    it('compareTarget 付き condition は新 schema フィールドで素直に渡される (PR #116c で sentinel 撤去)', () => {
      const dsl = makeBaseStrategy([
        {
          lens: 'ohlcv',
          feature: 'close',
          op: '>',
          compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 20 } },
        },
      ]);
      const payload = dslToBacktestNotePayload(dsl, {});
      const conds = payload.conditions ?? [];
      expect(conds).toHaveLength(1);
      expect(conds[0].lensName).toBe('ohlcv');
      expect(conds[0].featureKey).toBe('close');
      // op は元の op がそのまま残る (sentinel 経路は撤去)
      expect(conds[0].op).toBe('>');
      // value はもう sentinel ではない (= 新 schema では undefined)
      expect(conds[0].value).toBeUndefined();
      // compareTarget はネイティブ schema で表現
      expect(conds[0].compareTarget).toEqual({
        lensName: 'ohlcv',
        featureKey: 'ema',
        params: { period: 20 },
      });
      // notePayload.indicators[] に compareTarget の operand spec が自動 populate
      expect(payload.indicators).toEqual([
        { indicatorId: 'ema', params: { period: 20 }, field: 'value' },
      ]);
    });

    it('params 付き leaf condition も notePayload.indicators[] に自動 populate', () => {
      const dsl = makeBaseStrategy([
        { lens: 'ohlcv', feature: 'ema', op: '>', value: 1.05, params: { period: 50 } },
      ]);
      const payload = dslToBacktestNotePayload(dsl, {});
      expect(payload.indicators).toEqual([
        { indicatorId: 'ema', params: { period: 50 }, field: 'value' },
      ]);
      // leaf 自体にも params が残る
      expect(payload.conditions?.[0].params).toEqual({ period: 50 });
    });

    it('UNSUPPORTED_COMPARE_TARGET_SENTINEL は deprecated だが値は維持 (下流互換)', () => {
      // PR #116c で sentinel 経路は撤去されたが、定数 export は下流の参照箇所のため残す
      expect(UNSUPPORTED_COMPARE_TARGET_SENTINEL).toBe('__pr116a_unsupported_compareTarget__');
    });
  });

  // post-Phase 5A: 数学的に常時 true / false な leaf を schema レベルで弾く
  describe('post-Phase 5A: trivial leaf (常時 true / false) は parse エラー', () => {
    it('close > 0 は常時 true (価格 > 0 前提) → エラー', () => {
      const c = { lens: 'ohlcv', feature: 'close', op: '>', value: 0 };
      expect(() => ConditionSchema.parse(c)).toThrow(/常時 true/);
    });

    it('close > -0.5 も常時 true → エラー', () => {
      const c = { lens: 'ohlcv', feature: 'close', op: '>', value: -0.5 };
      expect(() => ConditionSchema.parse(c)).toThrow(/常時 true/);
    });

    it('close >= 0 も常時 true → エラー', () => {
      const c = { lens: 'ohlcv', feature: 'close', op: '>=', value: 0 };
      expect(() => ConditionSchema.parse(c)).toThrow(/常時 true/);
    });

    it('close < 0 は常時 false → エラー', () => {
      const c = { lens: 'ohlcv', feature: 'close', op: '<', value: 0 };
      expect(() => ConditionSchema.parse(c)).toThrow(/常時 false/);
    });

    it('open / high / low も同等に弾く', () => {
      for (const feature of ['open', 'high', 'low']) {
        const c = { lens: 'ohlcv', feature, op: '>', value: 0 };
        expect(() => ConditionSchema.parse(c)).toThrow(/常時 true/);
      }
    });

    it('volume > -1 は常時 true (volume >= 0 前提) → エラー', () => {
      const c = { lens: 'ohlcv', feature: 'volume', op: '>', value: -1 };
      expect(() => ConditionSchema.parse(c)).toThrow(/常時 true/);
    });

    it('volume < -1 は常時 false → エラー', () => {
      const c = { lens: 'ohlcv', feature: 'volume', op: '<', value: -1 };
      expect(() => ConditionSchema.parse(c)).toThrow(/常時 false/);
    });

    it('close > 0.0001 は通る (forex 価格は 1.0+ で実質常時 true だが境界判定の対象外)', () => {
      const c = { lens: 'ohlcv', feature: 'close', op: '>', value: 0.0001 };
      expect(() => ConditionSchema.parse(c)).not.toThrow();
    });

    it('volume > 0 は通る (= 弾く対象外、value < 0 のみ trivial 扱い)', () => {
      const c = { lens: 'ohlcv', feature: 'volume', op: '>', value: 0 };
      expect(() => ConditionSchema.parse(c)).not.toThrow();
    });

    it('rsi / atr は trivial 判定の対象外 (= 範囲が複雑なため別判定)', () => {
      const rsiCond = { lens: 'ohlcv', feature: 'rsi', op: '>', value: 0 };
      expect(() => ConditionSchema.parse(rsiCond)).not.toThrow();
      const atrCond = { lens: 'ohlcv', feature: 'atr', op: '>', value: 0 };
      expect(() => ConditionSchema.parse(atrCond)).not.toThrow();
    });

    it('別 lens (例: rsi.value) は判定対象外 (= ohlcv lens のみ)', () => {
      const c = { lens: 'rsi', feature: 'value', op: '>', value: 0 };
      expect(() => ConditionSchema.parse(c)).not.toThrow();
    });

    it('非数値 value (ParamRef) は判定対象外', () => {
      const c = { lens: 'ohlcv', feature: 'close', op: '>', value: '$threshold' };
      expect(() => ConditionSchema.parse(c)).not.toThrow();
    });
  });

  // PR #120 Copilot review #3: 期間系キーは整数 + 正値を強制
  describe('PR #120: ConditionParamsSchema 期間系キー整数性', () => {
    it('period が整数なら parse 通る (例: 14)', () => {
      const c = { lens: 'ohlcv', feature: 'rsi', op: '<', value: 30, params: { period: 14 } };
      expect(() => ConditionSchema.parse(c)).not.toThrow();
    });

    it('period が小数 (20.5) だと parse エラー (snapshot key と実計算ズレ防止)', () => {
      const c = { lens: 'ohlcv', feature: 'ema', op: '>', value: 1, params: { period: 20.5 } };
      expect(() => ConditionSchema.parse(c)).toThrow(/integer|整数/);
    });

    it('period が 0 / 負値だと parse エラー', () => {
      for (const period of [0, -1, -14]) {
        const c = { lens: 'ohlcv', feature: 'rsi', op: '<', value: 30, params: { period } };
        expect(() => ConditionSchema.parse(c)).toThrow(/正の値|positive/);
      }
    });

    it('macd の fastPeriod / slowPeriod / signalPeriod も整数強制', () => {
      const bad = {
        lens: 'ohlcv',
        feature: 'macd',
        op: '>',
        value: 0,
        params: { fastPeriod: 12, slowPeriod: 26.5, signalPeriod: 9 },
      };
      expect(() => ConditionSchema.parse(bad)).toThrow(/integer|整数/);
    });

    it('期間系以外のキー (例: multiplier, threshold) は小数 OK', () => {
      const c = {
        lens: 'ohlcv',
        feature: 'ema',
        op: '>',
        value: 1,
        params: { period: 20, multiplier: 2.5 }, // multiplier は INTEGER_PARAM_KEYS に含まれない
      };
      expect(() => ConditionSchema.parse(c)).not.toThrow();
    });
  });

  // PR #116a Copilot review #2: ConditionParamsSchema を z.number().finite() で厳密化
  describe('ConditionParamsSchema: 非有限値は parse 時点で弾く', () => {
    it('params に Infinity が含まれていると parse エラー', () => {
      const c = { lens: 'ohlcv', feature: 'ema', op: '>', value: 1, params: { period: Infinity } };
      expect(() => ConditionSchema.parse(c)).toThrow();
    });

    it('params に NaN が含まれていると parse エラー', () => {
      const c = { lens: 'ohlcv', feature: 'ema', op: '>', value: 1, params: { period: NaN } };
      expect(() => ConditionSchema.parse(c)).toThrow();
    });
  });
});
