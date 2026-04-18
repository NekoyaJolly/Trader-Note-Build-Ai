/**
 * プロンプトローダーのテスト
 */

import { loadPrompt } from '../../prompts/loader';

describe('loadPrompt', () => {
    it('strategy_thinker.md を読み込める（Phase 4a: 2ステップ構造）', () => {
        const content = loadPrompt('strategy_thinker');
        expect(content).toContain('Strategy Thinker');
        expect(content).toContain('ステップ1');
        expect(content).toContain('ステップ2');
        // Phase 4a で仮説生成ステップは HypothesisGenerator に移譲済み
        expect(content).not.toContain('ステップ3');
        expect(content).toContain('候補仮説');
    });

    it('devils_advocate.md を読み込める', () => {
        const content = loadPrompt('devils_advocate');
        expect(content).toContain("Devil's Advocate");
        expect(content).toContain('failureScenarios');
        expect(content).toContain('weakestAssumption');
        expect(content).toContain('recommendation');
    });

    it('market_observer.md を読み込める（参考ファイル）', () => {
        const content = loadPrompt('market_observer');
        expect(content).toContain('Market Observer');
    });

    it('存在しないプロンプト名はエラーになる', () => {
        expect(() => loadPrompt('nonexistent_prompt_xyz')).toThrow(/not found/);
    });

    it('マクロ展開が機能する', () => {
        const macros = {
            CORE_TRADING_RULES: '## テスト用コアルール',
            MACRO_ENVIRONMENT_RULES: '## テスト用マクロルール',
            MTF_ANALYSIS_RULES: '## テスト用MTFルール',
        };
        const content = loadPrompt('strategy_thinker', macros);
        expect(content).toContain('## テスト用コアルール');
        expect(content).toContain('## テスト用マクロルール');
        expect(content).toContain('## テスト用MTFルール');
        // プレースホルダーが残らないこと
        expect(content).not.toContain('{{CORE_TRADING_RULES}}');
        expect(content).not.toContain('{{MACRO_ENVIRONMENT_RULES}}');
        expect(content).not.toContain('{{MTF_ANALYSIS_RULES}}');
    });

    it('マクロ未指定時はプレースホルダーが残る（呼び出し側が注入すべき）', () => {
        const content = loadPrompt('strategy_thinker');
        expect(content).toContain('{{CORE_TRADING_RULES}}');
    });

    it('マクロが undefined の場合は空文字列に置換する', () => {
        const content = loadPrompt('strategy_thinker', {
            CORE_TRADING_RULES: undefined,
        });
        expect(content).not.toContain('{{CORE_TRADING_RULES}}');
    });
});
