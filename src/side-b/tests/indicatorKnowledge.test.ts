/**
 * Side-B インジケーター知識モジュールのテスト
 *
 * テスト対象:
 * - CORE_TRADING_RULES に必須キーワードが含まれているか
 * - getRelevantIndicatorContext() がインジケーターデータに応じて正しいコンテキストを返すか
 * - getPlanIndicatorContext() が特徴量に応じた状況判定ガイドを返すか
 */

import {
    CORE_TRADING_RULES,
    INDICATOR_CONTEXT,
    getRelevantIndicatorContext,
    getPlanIndicatorContext,
} from '../knowledge';

describe('indicatorKnowledge', () => {
    describe('CORE_TRADING_RULES', () => {
        it('インジケーター優先順位ルールが含まれる', () => {
            expect(CORE_TRADING_RULES).toContain('SMA/EMA');
            expect(CORE_TRADING_RULES).toContain('ADX');
            expect(CORE_TRADING_RULES).toContain('RSI');
            expect(CORE_TRADING_RULES).toContain('MACD');
        });

        it('禁止事項が含まれる', () => {
            expect(CORE_TRADING_RULES).toContain('単独判断禁止');
            expect(CORE_TRADING_RULES).toContain('矛盾時は見送り');
        });

        it('12次元特徴量の説明が含まれる', () => {
            expect(CORE_TRADING_RULES).toContain('12次元特徴量');
            expect(CORE_TRADING_RULES).toContain('トレンド系');
            expect(CORE_TRADING_RULES).toContain('モメンタム系');
            expect(CORE_TRADING_RULES).toContain('ボラティリティ系');
            expect(CORE_TRADING_RULES).toContain('価格構造系');
        });
    });

    describe('INDICATOR_CONTEXT', () => {
        it('主要インジケーターが全て定義されている', () => {
            const expectedIndicators = [
                'rsi', 'macd', 'sma', 'ema', 'adx', 'aroon', 'bb', 'atr',
                'stochastic', 'obv', 'vwap', 'mfi', 'cmf', 'pivot',
                'psar', 'supertrend', 'ichimoku', 'kc', 'cci', 'roc',
                'williamsR', 'dema', 'tema',
            ];

            for (const indicator of expectedIndicators) {
                expect(INDICATOR_CONTEXT[indicator]).toBeDefined();
                expect(typeof INDICATOR_CONTEXT[indicator]).toBe('string');
                expect(INDICATOR_CONTEXT[indicator].length).toBeGreaterThan(0);
            }
        });
    });

    describe('getRelevantIndicatorContext', () => {
        it('undefinedを渡すと空文字列を返す', () => {
            expect(getRelevantIndicatorContext(undefined)).toBe('');
        });

        it('nullを渡すと空文字列を返す', () => {
            expect(getRelevantIndicatorContext(null)).toBe('');
        });

        it('空のオブジェクトを渡すと空文字列を返す', () => {
            expect(getRelevantIndicatorContext({})).toBe('');
        });

        it('全値がundefinedのオブジェクトは空文字列を返す', () => {
            expect(getRelevantIndicatorContext({
                rsi: undefined,
                sma20: undefined,
            })).toBe('');
        });

        it('RSIが含まれるとRSIの知識が返される', () => {
            const result = getRelevantIndicatorContext({ rsi: 55 });
            expect(result).toContain('RSI');
            expect(result).toContain('インジケーターの知識');
        });

        it('SMA20が含まれるとSMAの知識が返される', () => {
            const result = getRelevantIndicatorContext({ sma20: 3240 });
            expect(result).toContain('SMA');
        });

        it('複数のインジケーターが含まれると複数の知識が返される', () => {
            const result = getRelevantIndicatorContext({
                rsi: 65,
                macd: { value: 1.5, signal: 1.2, histogram: 0.3 },
                atr: 15,
            });
            expect(result).toContain('RSI');
            expect(result).toContain('MACD');
            expect(result).toContain('ATR');
        });

        it('BB関連フィールドが重複しても1つのBB知識のみ返す', () => {
            const result = getRelevantIndicatorContext({
                bbUpper: 3300,
                bbLower: 3200,
                bbMiddle: 3250,
            });
            // BB知識は1回だけ含まれる（Setで重複排除）
            const bbMatches = (result.match(/BB\(ボリンジャーバンド\)/g) || []).length;
            expect(bbMatches).toBe(1);
        });
    });

    describe('getPlanIndicatorContext', () => {
        it('低トレンド強度で状況判定ガイドが返される', () => {
            const result = getPlanIndicatorContext(
                { trendStrength: 15, rsiLevel: 50 },
                null
            );
            expect(result).toContain('レンジ戦略');
        });

        it('高トレンド強度で状況判定ガイドが返される', () => {
            const result = getPlanIndicatorContext(
                { trendStrength: 80, rsiLevel: 50 },
                null
            );
            expect(result).toContain('強いトレンド中');
        });

        it('RSI過熱圏で警告が返される', () => {
            const result = getPlanIndicatorContext(
                { trendStrength: 50, rsiLevel: 75 },
                null
            );
            expect(result).toContain('RSI過熱圏');
        });

        it('RSI売られすぎで通知が返される', () => {
            const result = getPlanIndicatorContext(
                { trendStrength: 50, rsiLevel: 25 },
                null
            );
            expect(result).toContain('売られすぎ');
        });

        it('ダイバージェンス検出で通知が返される', () => {
            const result = getPlanIndicatorContext(
                { trendStrength: 50, rsiLevel: 50, momentumDivergence: 70 },
                null
            );
            expect(result).toContain('ダイバージェンス検出');
        });

        it('中立的な値では状況判定ガイドが空', () => {
            const result = getPlanIndicatorContext(
                { trendStrength: 50, rsiLevel: 50, momentumDivergence: 20 },
                null
            );
            expect(result).not.toContain('状況判定ガイド');
        });

        it('インジケーター知識と状況判定ガイドを両方返せる', () => {
            const result = getPlanIndicatorContext(
                { trendStrength: 15, rsiLevel: 75 },
                { rsi: 75, sma20: 3240 }
            );
            // Layer 2 基本
            expect(result).toContain('RSI');
            expect(result).toContain('SMA');
            // 状況判定
            expect(result).toContain('レンジ戦略');
            expect(result).toContain('RSI過熱圏');
        });
    });
});
