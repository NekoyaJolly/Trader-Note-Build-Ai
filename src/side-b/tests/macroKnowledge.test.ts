/**
 * Side-B マクロ環境知識モジュールのテスト
 *
 * テスト対象:
 * - 状態フラグ分類関数（VIX→volatilityRegime, S&P500→riskSentiment, yields→yieldCurve）
 * - getMacroContext() がマクロデータから正しいコンテキスト文字列を生成するか
 * - MACRO_ENVIRONMENT_RULES に必須キーワードが含まれるか
 */

import {
    MACRO_ENVIRONMENT_RULES,
    classifyVolatilityRegime,
    classifyRiskSentiment,
    classifyYieldCurve,
    classifyMacroEnvironment,
    getMacroContext,
} from '../knowledge';
import type { MacroEnvironmentData } from '../knowledge';

describe('macroKnowledge', () => {
    describe('MACRO_ENVIRONMENT_RULES', () => {
        it('必須キーワードが含まれる', () => {
            expect(MACRO_ENVIRONMENT_RULES).toContain('volatilityRegime');
            expect(MACRO_ENVIRONMENT_RULES).toContain('riskSentiment');
            expect(MACRO_ENVIRONMENT_RULES).toContain('yieldCurveSignal');
            expect(MACRO_ENVIRONMENT_RULES).toContain('ボラティリティ');
        });

        it('テクニカルを上書きしないルールが含まれる', () => {
            expect(MACRO_ENVIRONMENT_RULES).toContain('テクニカルを上書きしない');
        });
    });

    describe('classifyVolatilityRegime', () => {
        it('undefinedはnormal', () => {
            expect(classifyVolatilityRegime(undefined)).toBe('normal');
        });

        it('VIX < 15 は low', () => {
            expect(classifyVolatilityRegime(12)).toBe('low');
        });

        it('VIX 15-20 は normal', () => {
            expect(classifyVolatilityRegime(17)).toBe('normal');
        });

        it('VIX 20-30 は elevated', () => {
            expect(classifyVolatilityRegime(25)).toBe('elevated');
        });

        it('VIX > 30 は crisis', () => {
            expect(classifyVolatilityRegime(35)).toBe('crisis');
        });

        it('境界値: VIX = 15 は normal', () => {
            expect(classifyVolatilityRegime(15)).toBe('normal');
        });

        it('境界値: VIX = 20 は normal', () => {
            expect(classifyVolatilityRegime(20)).toBe('normal');
        });

        it('境界値: VIX = 20.01 は elevated', () => {
            expect(classifyVolatilityRegime(20.01)).toBe('elevated');
        });

        it('境界値: VIX = 30.01 は crisis', () => {
            expect(classifyVolatilityRegime(30.01)).toBe('crisis');
        });
    });

    describe('classifyRiskSentiment', () => {
        it('データなしはneutral', () => {
            expect(classifyRiskSentiment(undefined, undefined)).toBe('neutral');
        });

        it('SMA50なしはneutral', () => {
            expect(classifyRiskSentiment(5000, undefined)).toBe('neutral');
        });

        it('S&P500 > SMA50 は risk_on', () => {
            expect(classifyRiskSentiment(5100, 5000)).toBe('risk_on');
        });

        it('S&P500 < SMA50*0.98 は risk_off', () => {
            expect(classifyRiskSentiment(4880, 5000)).toBe('risk_off');
        });

        it('S&P500 ≈ SMA50 は neutral', () => {
            expect(classifyRiskSentiment(4950, 5000)).toBe('neutral');
        });

        it('急落(-2%超)はrisk_off', () => {
            expect(classifyRiskSentiment(5100, 5000, -2.5)).toBe('risk_off');
        });

        it('急落が他のシグナルに優先する', () => {
            // S&P > SMA50だがリターンが-2%超
            expect(classifyRiskSentiment(5100, 5000, -3)).toBe('risk_off');
        });
    });

    describe('classifyYieldCurve', () => {
        it('データなしはnormal', () => {
            expect(classifyYieldCurve(undefined, undefined)).toBe('normal');
        });

        it('正常なスプレッド(>0.25)はnormal', () => {
            expect(classifyYieldCurve(4.0, 4.5)).toBe('normal');
        });

        it('フラット化(0<spread<0.25)はflattening', () => {
            expect(classifyYieldCurve(4.3, 4.4)).toBe('flattening');
        });

        it('逆転(spread<0)はinverted', () => {
            expect(classifyYieldCurve(4.5, 4.3)).toBe('inverted');
        });
    });

    describe('classifyMacroEnvironment', () => {
        it('nullはデフォルト（全てneutral/normal）', () => {
            const result = classifyMacroEnvironment(null);
            expect(result.riskSentiment).toBe('neutral');
            expect(result.volatilityRegime).toBe('normal');
            expect(result.yieldCurveSignal).toBe('normal');
        });

        it('undefinedはデフォルト', () => {
            const result = classifyMacroEnvironment(undefined);
            expect(result.riskSentiment).toBe('neutral');
            expect(result.volatilityRegime).toBe('normal');
            expect(result.yieldCurveSignal).toBe('normal');
        });

        it('全データありの場合、正しく分類される', () => {
            const data: MacroEnvironmentData = {
                vix: 35,
                sp500: 4800,
                sp500Sma50: 5000,
                yield2y: 4.5,
                yield10y: 4.3,
            };
            const result = classifyMacroEnvironment(data);
            expect(result.volatilityRegime).toBe('crisis');
            expect(result.riskSentiment).toBe('risk_off');
            expect(result.yieldCurveSignal).toBe('inverted');
        });
    });

    describe('getMacroContext', () => {
        it('undefinedは空文字列', () => {
            expect(getMacroContext(undefined)).toBe('');
        });

        it('nullは空文字列', () => {
            expect(getMacroContext(null)).toBe('');
        });

        it('VIXデータありでVIX情報が含まれる', () => {
            const result = getMacroContext({ vix: 25, vixChange: 3 });
            expect(result).toContain('VIX');
            expect(result).toContain('25');
            expect(result).toContain('↑上昇中');
            expect(result).toContain('警戒');
        });

        it('DXYデータありでDXY情報が含まれる', () => {
            const result = getMacroContext({ dxy: 105, dxySma20: 103 });
            expect(result).toContain('DXY');
            expect(result).toContain('ドル高基調');
        });

        it('イールドカーブ逆転が正しく表示される', () => {
            const result = getMacroContext({ yield2y: 4.5, yield10y: 4.3 });
            expect(result).toContain('逆転');
            expect(result).toContain('リセッション警戒');
        });

        it('金利急変動の警告が表示される', () => {
            const result = getMacroContext({
                yield2y: 4.0, yield10y: 4.5, yieldDailyChangeBp: 15,
            });
            expect(result).toContain('金利急変動');
            expect(result).toContain('+15bp');
        });

        it('S&P500データありでリスクセンチメントが含まれる', () => {
            const result = getMacroContext({ sp500: 5100, sp500Sma50: 5000, sp500DailyReturn: 1.2 });
            expect(result).toContain('S&P500');
            expect(result).toContain('リスクオン');
        });

        it('総合判定セクションが含まれる', () => {
            const result = getMacroContext({ vix: 25 });
            expect(result).toContain('マクロ総合判定');
            expect(result).toContain('ボラティリティ環境');
            expect(result).toContain('リスクセンチメント');
            expect(result).toContain('イールドカーブ');
        });

        it('全データありの完全なコンテキストが生成される', () => {
            const data: MacroEnvironmentData = {
                vix: 32,
                vixChange: 5,
                dxy: 106,
                dxySma20: 104,
                yield2y: 4.5,
                yield5y: 4.2,
                yield10y: 4.3,
                yieldDailyChangeBp: -12,
                sp500: 4800,
                sp500Sma50: 5000,
                sp500DailyReturn: -2.5,
            };
            const result = getMacroContext(data);
            // VIX crisis
            expect(result).toContain('危機');
            // DXY
            expect(result).toContain('ドル高基調');
            // Yields inverted
            expect(result).toContain('逆転');
            // 金利急変動
            expect(result).toContain('金利急変動');
            // S&P500 risk off
            expect(result).toContain('リスクオフ');
        });
    });
});
