/**
 * SL 最小フロア / 最大キャップ (getStopLossClampPips) のユニットテスト。
 *
 * 低ボラ局面で ATR 基準 SL が往復コストに飲まれて縮みすぎる過大評価を防ぐフロア
 * (= 往復コスト × 係数) と、高ボラ局面で SL が過大になるのを抑えるシンボル別キャップ
 * (絶対 pips) の値・env 上書きを固定する。
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import {
  getStopLossClampPips,
  SYMBOL_MAX_STOP_LOSS_PIPS,
} from '../../strategy_dsl/executionSimulation';

describe('getStopLossClampPips', () => {
  const savedFloorMult = process.env.SL_FLOOR_COST_MULT;
  const savedMaxDefault = process.env.SL_MAX_PIPS_DEFAULT;

  afterEach(() => {
    // env を毎テスト後に復元 (他テストへ漏らさない)
    if (savedFloorMult === undefined) delete process.env.SL_FLOOR_COST_MULT;
    else process.env.SL_FLOOR_COST_MULT = savedFloorMult;
    if (savedMaxDefault === undefined) delete process.env.SL_MAX_PIPS_DEFAULT;
    else process.env.SL_MAX_PIPS_DEFAULT = savedMaxDefault;
  });

  it('XAUUSD: フロア = 2 × 往復コスト3.0pips = 6, キャップ = 80', () => {
    delete process.env.SL_FLOOR_COST_MULT;
    expect(getStopLossClampPips('XAUUSD')).toEqual({ minPips: 6, maxPips: 80 });
  });

  it('EURUSD: フロア = 2 × 1.2 = 2.4, キャップ = 40', () => {
    delete process.env.SL_FLOOR_COST_MULT;
    expect(getStopLossClampPips('EURUSD')).toEqual({ minPips: 2.4, maxPips: 40 });
  });

  it('USDJPY: フロア = 2 × 1.5 = 3, キャップ = 40', () => {
    delete process.env.SL_FLOOR_COST_MULT;
    expect(getStopLossClampPips('USDJPY')).toEqual({ minPips: 3, maxPips: 40 });
  });

  it('スラッシュ付き表記 (EUR/USD) も正規化してマッチする', () => {
    delete process.env.SL_FLOOR_COST_MULT;
    expect(getStopLossClampPips('EUR/USD')).toEqual({ minPips: 2.4, maxPips: 40 });
  });

  it('未定義シンボル: フロア = 2 × 既定コスト2.0 = 4, キャップ = 既定60', () => {
    delete process.env.SL_FLOOR_COST_MULT;
    delete process.env.SL_MAX_PIPS_DEFAULT;
    expect(getStopLossClampPips('GBPCHF')).toEqual({ minPips: 4, maxPips: 60 });
  });

  it('env SL_FLOOR_COST_MULT でフロア係数を上書きできる', () => {
    process.env.SL_FLOOR_COST_MULT = '3';
    // XAUUSD: 3 × 3.0 = 9
    expect(getStopLossClampPips('XAUUSD').minPips).toBe(9);
  });

  it('env SL_MAX_PIPS_DEFAULT で未定義シンボルのキャップを上書きできる', () => {
    process.env.SL_MAX_PIPS_DEFAULT = '100';
    expect(getStopLossClampPips('GBPCHF').maxPips).toBe(100);
  });

  it('不正な env 値は既定値にフォールバックする', () => {
    process.env.SL_FLOOR_COST_MULT = 'abc';
    process.env.SL_MAX_PIPS_DEFAULT = '-5';
    // フロア係数は既定2、未定義シンボルのキャップは既定60
    expect(getStopLossClampPips('GBPCHF')).toEqual({ minPips: 4, maxPips: 60 });
  });

  it('SYMBOL_MAX_STOP_LOSS_PIPS は Nekoさん 決定の絶対 pips 表と一致する', () => {
    expect(SYMBOL_MAX_STOP_LOSS_PIPS).toEqual({ XAUUSD: 80, EURUSD: 40, USDJPY: 40 });
  });
});
