/**
 * Side-B MTF（マルチタイムフレーム）知識モジュールのテスト
 *
 * テスト対象:
 * - classifyHigherTFBias(): 上位足バイアス判定
 * - classifyMTFAlignment(): 上位足と執行足の整合性判定
 * - buildHigherTFContext(): HigherTimeframeContext生成
 * - getMTFContext(): コンテキスト文字列生成
 * - MTF_ANALYSIS_RULES: キーワード確認
 */

import {
    MTF_ANALYSIS_RULES,
    classifyHigherTFBias,
    classifyMTFAlignment,
    buildHigherTFContext,
    getMTFContext,
} from '../knowledge';
import type { HigherTimeframeContext } from '../knowledge';

describe('mtfKnowledge', () => {
    describe('MTF_ANALYSIS_RULES', () => {
        it('必須キーワードが含まれる', () => {
            expect(MTF_ANALYSIS_RULES).toContain('上位足');
            expect(MTF_ANALYSIS_RULES).toContain('執行足');
            expect(MTF_ANALYSIS_RULES).toContain('バイアス');
        });

        it('矛盾ルールが含まれる', () => {
            expect(MTF_ANALYSIS_RULES).toContain('見送りではない');
            expect(MTF_ANALYSIS_RULES).toContain('押し目買い');
        });

        it('禁止事項が含まれる', () => {
            expect(MTF_ANALYSIS_RULES).toContain('禁止事項');
        });
    });

    describe('classifyHigherTFBias', () => {
        it('trendStrength <= 30 は常にneutral', () => {
            expect(classifyHigherTFBias(80, 20)).toBe('neutral');
            expect(classifyHigherTFBias(10, 25)).toBe('neutral');
            expect(classifyHigherTFBias(50, 30)).toBe('neutral');
        });

        it('trendDirection > 60 かつ trendStrength > 30 は long', () => {
            expect(classifyHigherTFBias(75, 50)).toBe('long');
            expect(classifyHigherTFBias(61, 31)).toBe('long');
            expect(classifyHigherTFBias(100, 100)).toBe('long');
        });

        it('trendDirection < 40 かつ trendStrength > 30 は short', () => {
            expect(classifyHigherTFBias(30, 50)).toBe('short');
            expect(classifyHigherTFBias(39, 31)).toBe('short');
            expect(classifyHigherTFBias(0, 100)).toBe('short');
        });

        it('trendDirection 40-60 は neutral', () => {
            expect(classifyHigherTFBias(50, 80)).toBe('neutral');
            expect(classifyHigherTFBias(40, 50)).toBe('neutral');
            expect(classifyHigherTFBias(60, 50)).toBe('neutral');
        });

        it('境界値: trendDirection=60, strength=31はneutral', () => {
            expect(classifyHigherTFBias(60, 31)).toBe('neutral');
        });

        it('境界値: trendDirection=61, strength=31はlong', () => {
            expect(classifyHigherTFBias(61, 31)).toBe('long');
        });

        it('境界値: trendDirection=39, strength=31はshort', () => {
            expect(classifyHigherTFBias(39, 31)).toBe('short');
        });
    });

    describe('classifyMTFAlignment', () => {
        it('上位足neutralの場合は常にneutral', () => {
            expect(classifyMTFAlignment('neutral', 80)).toBe('neutral');
            expect(classifyMTFAlignment('neutral', 20)).toBe('neutral');
            expect(classifyMTFAlignment('neutral', 50)).toBe('neutral');
        });

        it('上位足long + 執行足も上昇(>55) = aligned', () => {
            expect(classifyMTFAlignment('long', 70)).toBe('aligned');
            expect(classifyMTFAlignment('long', 90)).toBe('aligned');
        });

        it('上位足long + 執行足下降(<45) = conflicting', () => {
            expect(classifyMTFAlignment('long', 30)).toBe('conflicting');
            expect(classifyMTFAlignment('long', 10)).toBe('conflicting');
        });

        it('上位足long + 執行足中立(45-55) = neutral', () => {
            expect(classifyMTFAlignment('long', 50)).toBe('neutral');
            expect(classifyMTFAlignment('long', 45)).toBe('neutral');
            expect(classifyMTFAlignment('long', 55)).toBe('neutral');
        });

        it('上位足short + 執行足も下降(<45) = aligned', () => {
            expect(classifyMTFAlignment('short', 30)).toBe('aligned');
        });

        it('上位足short + 執行足上昇(>55) = conflicting', () => {
            expect(classifyMTFAlignment('short', 70)).toBe('conflicting');
        });
    });

    describe('buildHigherTFContext', () => {
        it('正しいHigherTimeframeContextを生成する', () => {
            const result = buildHigherTFContext('1D', {
                trendDirection: 75,
                trendStrength: 60,
                maAlignment: 80,
            });

            expect(result.timeframe).toBe('1D');
            expect(result.trendDirection).toBe(75);
            expect(result.trendStrength).toBe(60);
            expect(result.maAlignment).toBe(80);
            expect(result.bias).toBe('long');
        });

        it('neutralバイアスを正しく生成する', () => {
            const result = buildHigherTFContext('4H', {
                trendDirection: 50,
                trendStrength: 50,
                maAlignment: 50,
            });

            expect(result.bias).toBe('neutral');
        });

        it('shortバイアスを正しく生成する', () => {
            const result = buildHigherTFContext('1D', {
                trendDirection: 25,
                trendStrength: 70,
                maAlignment: 20,
            });

            expect(result.bias).toBe('short');
        });
    });

    describe('getMTFContext', () => {
        it('undefinedは空文字列を返す', () => {
            expect(getMTFContext(undefined)).toBe('');
        });

        it('nullは空文字列を返す', () => {
            expect(getMTFContext(null)).toBe('');
        });

        it('上位足データありでコンテキストが生成される', () => {
            const htf: HigherTimeframeContext = {
                timeframe: '1D',
                trendDirection: 75,
                trendStrength: 60,
                maAlignment: 80,
                bias: 'long',
            };
            const result = getMTFContext(htf);
            expect(result).toContain('MTF分析');
            expect(result).toContain('上位足（1D）');
            expect(result).toContain('ロング（上昇バイアス）');
            expect(result).toContain('75');
        });

        it('maAlignment > 70 で確信度高のメッセージ', () => {
            const htf: HigherTimeframeContext = {
                timeframe: '1D',
                trendDirection: 75,
                trendStrength: 60,
                maAlignment: 80,
                bias: 'long',
            };
            const result = getMTFContext(htf);
            expect(result).toContain('確信度高い');
        });

        it('maAlignment < 30 + bias != neutral でトレンド転換警告', () => {
            const htf: HigherTimeframeContext = {
                timeframe: '4H',
                trendDirection: 70,
                trendStrength: 50,
                maAlignment: 20,
                bias: 'long',
            };
            const result = getMTFContext(htf);
            expect(result).toContain('トレンド転換');
        });

        it('maAlignment < 30 + bias = neutral では転換警告なし', () => {
            const htf: HigherTimeframeContext = {
                timeframe: '1D',
                trendDirection: 50,
                trendStrength: 50,
                maAlignment: 20,
                bias: 'neutral',
            };
            const result = getMTFContext(htf);
            expect(result).not.toContain('トレンド転換');
        });

        it('executionTFTrendDirectionありで整合性判定が含まれる', () => {
            const htf: HigherTimeframeContext = {
                timeframe: '1D',
                trendDirection: 75,
                trendStrength: 60,
                maAlignment: 80,
                bias: 'long',
            };
            const result = getMTFContext(htf, 70);
            expect(result).toContain('整合性');
            expect(result).toContain('整合（同方向）');
            expect(result).toContain('信頼度+10%');
        });

        it('conflictingの場合の整合性判定', () => {
            const htf: HigherTimeframeContext = {
                timeframe: '1D',
                trendDirection: 75,
                trendStrength: 60,
                maAlignment: 80,
                bias: 'long',
            };
            const result = getMTFContext(htf, 30);
            expect(result).toContain('不整合（逆方向）');
            expect(result).toContain('タイミング待ち');
        });

        it('neutralの場合の整合性判定', () => {
            const htf: HigherTimeframeContext = {
                timeframe: '1D',
                trendDirection: 50,
                trendStrength: 20,
                maAlignment: 50,
                bias: 'neutral',
            };
            const result = getMTFContext(htf, 50);
            expect(result).toContain('中立');
            expect(result).toContain('既存ルールに従う');
        });
    });
});
