/**
 * PR #116a: DSL Condition の拡張 (params / compareTarget) と snapshot key 正規化のテスト。
 *
 * 確認:
 *   1. 既存 DSL ({ lens, feature, op, value }) はそのまま parse 通る (後方互換)
 *   2. params 付き condition が parse 通る (動的 indicator パラメータ)
 *   3. compareTarget 付き condition が parse 通る (indicator operand)
 *   4. value と compareTarget の排他性 (両方 / どちらも無し は parse エラー)
 *   5. snapshot key 構築の挙動 (params 順序非依存、Number 正規化)
 *   6. dslToBacktestNotePayload で compareTarget 付き condition は sentinel 化
 *      (Python 側で false 評価される、PR #116c までの一時措置)
 */

import {
  UNSUPPORTED_COMPARE_TARGET_SENTINEL,
  dslToBacktestNotePayload,
} from '../../strategy_dsl/dslToBacktestNotePayload';
import {
  ConditionSchema,
  IndicatorOperandSchema,
  StrategyDSLSchema,
  type StrategyDSL,
} from '../../strategy_dsl/schema';
import { buildSnapshotKey, formatStableParams } from '../../strategy_dsl/snapshotKey';

/**
 * テスト用 trigger conditions の入力型 (Condition leaf の最小形)。
 * PR #116a Copilot review #5: `unknown[]` は型が弱すぎるため、Condition の
 * input 形に揃える (parse 通る形で受ける)。group ネストは現テストでは未使用のため
 * leaf 型のみで十分。
 */
type ConditionLeafInput = {
  lens: string;
  feature: string;
  op: string;
  value?: unknown;
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

  describe('6. dslToBacktestNotePayload: compareTarget 付き condition は sentinel 化 (PR #116c までの一時措置)', () => {
    it('value 付き condition は通常の payload', () => {
      const dsl = makeBaseStrategy([{ lens: 'ohlcv', feature: 'rsi', op: '<', value: 30 }]);
      const payload = dslToBacktestNotePayload(dsl, {});
      const conds = payload.conditions ?? [];
      expect(conds).toHaveLength(1);
      expect(conds[0]).toMatchObject({ lensName: 'ohlcv', featureKey: 'rsi', op: '<', value: 30 });
    });

    it('compareTarget 付き condition は sentinel value で payload に出る (Python 側で false 評価)', () => {
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
      // PR #116a Copilot review #4: sentinel は dslToBacktestNotePayload 側が単一 source。
      // PR #116a Copilot review #1: op も `==` に固定して `number == string` で必ず false 評価
      expect(conds[0].op).toBe('==');
      expect(conds[0].value).toBe(UNSUPPORTED_COMPARE_TARGET_SENTINEL);
    });

    it('compareTarget + op="!=" でも sentinel 経路で確実に false 評価される (PR #116a Copilot review #1)', () => {
      // 旧実装は op をそのまま残していたため `op="!=" + value=string` は number != string が true になり
      // 「未対応 condition は常に false 評価」が崩れていた。op を `==` に固定することで
      // op に関わらず必ず false に倒れるようになっている。
      const dsl = makeBaseStrategy([
        {
          lens: 'ohlcv',
          feature: 'close',
          op: '!=',
          compareTarget: { lens: 'ohlcv', feature: 'ema', params: { period: 20 } },
        },
      ]);
      const payload = dslToBacktestNotePayload(dsl, {});
      const conds = payload.conditions ?? [];
      expect(conds[0].op).toBe('==');
      expect(conds[0].value).toBe(UNSUPPORTED_COMPARE_TARGET_SENTINEL);
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
