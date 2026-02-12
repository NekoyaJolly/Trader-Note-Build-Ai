/**
 * positionSizeCalculator のユニットテスト
 */

import {
    calculateLotSize,
    getPipValue,
    pipValueFromDigits,
    slValueToPips,
    calculateUsedMargin,
} from '../services/positionSizeCalculator';

describe('pipValueFromDigits', () => {
    it('digits=5 → 0.0001 (EURUSD)', () => {
        expect(pipValueFromDigits(5)).toBeCloseTo(0.0001);
    });

    it('digits=3 → 0.01 (USDJPY)', () => {
        expect(pipValueFromDigits(3)).toBeCloseTo(0.01);
    });

    it('digits=2 → 0.1 (XAUUSD)', () => {
        expect(pipValueFromDigits(2)).toBeCloseTo(0.1);
    });

    it('digits=1 → 1.0', () => {
        expect(pipValueFromDigits(1)).toBeCloseTo(1.0);
    });
});

describe('getPipValue', () => {
    it('JPYペアは0.01を返す', () => {
        expect(getPipValue('USDJPY')).toBe(0.01);
        expect(getPipValue('EURJPY')).toBe(0.01);
        expect(getPipValue('GBPJPY')).toBe(0.01);
    });

    it('USDペアは0.0001を返す', () => {
        expect(getPipValue('EURUSD')).toBe(0.0001);
        expect(getPipValue('GBPUSD')).toBe(0.0001);
        expect(getPipValue('AUDUSD')).toBe(0.0001);
    });

    it('XAUUSD（ゴールド）は0.1を返す', () => {
        expect(getPipValue('XAUUSD')).toBe(0.1);
        expect(getPipValue('GOLD')).toBe(0.1);
    });

    it('XAGUSD（シルバー）は0.01を返す', () => {
        expect(getPipValue('XAGUSD')).toBe(0.01);
        expect(getPipValue('SILVER')).toBe(0.01);
    });

    it('大文字小文字を問わない', () => {
        expect(getPipValue('usdjpy')).toBe(0.01);
        expect(getPipValue('EurUsd')).toBe(0.0001);
    });

    it('digitsが渡された場合は動的計算が優先される', () => {
        // digits=3 → 0.01（USDJPYと同じだが動的に算出）
        expect(getPipValue('EURUSD', 3)).toBeCloseTo(0.01);
        // digits=5 → 0.0001（ハードコードと同じ結果だが動的）
        expect(getPipValue('EURUSD', 5)).toBeCloseTo(0.0001);
        // digits=2のXAUUSD
        expect(getPipValue('XAUUSD', 2)).toBeCloseTo(0.1);
    });

    it('digits=0はフォールバックを使用', () => {
        expect(getPipValue('USDJPY', 0)).toBe(0.01);
    });
});

describe('calculateLotSize', () => {
    it('JPYペアでリスク2%、SL50pipsの計算', () => {
        // capital=1,000,000, risk=2% → riskAmount=20,000
        // pipValue=0.01, slPips=50
        // lotSize = 20,000 / (50 × 0.01) = 40,000
        const result = calculateLotSize({
            capital: 1_000_000,
            riskPercent: 2,
            slPips: 50,
            symbol: 'USDJPY',
            leverage: 25,
            entryPrice: 150.0,
        });

        expect(result.lotSize).toBe(40_000);
        expect(result.riskAmount).toBe(20_000);
        expect(result.pipValue).toBe(0.01);
        expect(result.isMarginConstrained).toBe(false);
    });

    it('USDペアでリスク1%、SL30pipsの計算', () => {
        // capital=1,000,000, risk=1% → riskAmount=10,000
        // pipValue=0.0001, slPips=30
        // lotSize = 10,000 / (30 × 0.0001) = 3,333,333 → floor to 3,333,000
        const result = calculateLotSize({
            capital: 1_000_000,
            riskPercent: 1,
            slPips: 30,
            symbol: 'EURUSD',
            leverage: 25,
            entryPrice: 1.08,
        });

        expect(result.calculatedLotSize).toBe(3_333_000);
        expect(result.pipValue).toBe(0.0001);
    });

    it('XAUUSDでの計算', () => {
        // capital=1,000,000, risk=2% → riskAmount=20,000
        // pipValue=0.1, slPips=100
        // lotSize = 20,000 / (100 × 0.1) = 2,000
        const result = calculateLotSize({
            capital: 1_000_000,
            riskPercent: 2,
            slPips: 100,
            symbol: 'XAUUSD',
            leverage: 100,
            entryPrice: 2000.0,
        });

        expect(result.lotSize).toBe(2_000);
        expect(result.riskAmount).toBe(20_000);
        expect(result.pipValue).toBe(0.1);
    });

    it('証拠金上限でロットが切り詰められるケース', () => {
        // capital=100,000, leverage=1, entryPrice=150
        // maxLotByMargin = (100,000 × 1) / 150 ≈ 666 → floor to 0
        // riskPercent=50 → riskAmount=50,000
        // lotSize = 50,000 / (50 × 0.01) = 100,000
        // → margin constrained to 0
        const result = calculateLotSize({
            capital: 100_000,
            riskPercent: 50,
            slPips: 50,
            symbol: 'USDJPY',
            leverage: 1,
            entryPrice: 150.0,
        });

        expect(result.isMarginConstrained).toBe(true);
        // maxLot = 100000/150 ≈ 666 → floor to 0
        expect(result.lotSize).toBe(0);
    });

    it('riskAmount（固定金額）での計算', () => {
        // riskAmount=10,000（固定）
        // slPips=50, pipValue=0.01
        // lotSize = 10,000 / (50 × 0.01) = 20,000
        const result = calculateLotSize({
            capital: 1_000_000,
            riskAmount: 10_000,
            slPips: 50,
            symbol: 'USDJPY',
            leverage: 25,
            entryPrice: 150.0,
        });

        expect(result.lotSize).toBe(20_000);
        expect(result.riskAmount).toBe(10_000);
    });

    it('資金が0以下の場合はゼロ結果', () => {
        const result = calculateLotSize({
            capital: 0,
            riskPercent: 2,
            slPips: 50,
            symbol: 'USDJPY',
            leverage: 25,
            entryPrice: 150.0,
        });

        expect(result.lotSize).toBe(0);
    });

    it('SLが0以下の場合はゼロ結果', () => {
        const result = calculateLotSize({
            capital: 1_000_000,
            riskPercent: 2,
            slPips: 0,
            symbol: 'USDJPY',
            leverage: 25,
            entryPrice: 150.0,
        });

        expect(result.lotSize).toBe(0);
    });

    it('1000通貨単位に丸められる', () => {
        // 15,500 → 15,000 に切り捨て
        const result = calculateLotSize({
            capital: 1_000_000,
            riskAmount: 7_750, // 7750 / (50 × 0.01) = 15,500
            slPips: 50,
            symbol: 'USDJPY',
            leverage: 25,
            entryPrice: 150.0,
        });

        expect(result.lotSize).toBe(15_000);
    });
});

describe('slValueToPips', () => {
    it('pips単位はそのまま返す', () => {
        expect(slValueToPips(50, 'pips', 150.0, 'USDJPY')).toBe(50);
    });

    it('percent → pips 変換（USDJPY）', () => {
        // 1% of 150.0 = 1.5 price diff
        // 1.5 / 0.01 = 150 pips
        expect(slValueToPips(1, 'percent', 150.0, 'USDJPY')).toBe(150);
    });

    it('percent → pips 変換（EURUSD）', () => {
        // 1% of 1.08 = 0.0108 price diff
        // 0.0108 / 0.0001 = 108 pips
        expect(slValueToPips(1, 'percent', 1.08, 'EURUSD')).toBeCloseTo(108, 0);
    });
});

describe('calculateUsedMargin', () => {
    it('空のポジションマップは0を返す', () => {
        const positions = new Map<string, { entryPrice: number; lotSize: number }>();
        expect(calculateUsedMargin(positions, 25)).toBe(0);
    });

    it('単一ポジションの証拠金を正しく計算', () => {
        const positions = new Map<string, { entryPrice: number; lotSize: number }>();
        positions.set('ticket1', { entryPrice: 150.0, lotSize: 10000 });
        // 10000 × 150 / 25 = 60,000
        expect(calculateUsedMargin(positions, 25)).toBe(60_000);
    });

    it('複数ポジションの証拠金合計', () => {
        const positions = new Map<string, { entryPrice: number; lotSize: number }>();
        positions.set('ticket1', { entryPrice: 150.0, lotSize: 10000 });
        positions.set('ticket2', { entryPrice: 151.0, lotSize: 20000 });
        // 10000×150/25 + 20000×151/25 = 60,000 + 120,800 = 180,800
        expect(calculateUsedMargin(positions, 25)).toBe(180_800);
    });
});
