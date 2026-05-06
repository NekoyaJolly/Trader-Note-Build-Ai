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
        expect(content).toContain('btWeaknesses');
        expect(content).toContain('watchItems');
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

    // PR #113: mutation / crossover prompt の lens/feature 範囲明示を pin
    describe('PR #113: mutation / crossover に対応 lens/feature 範囲が明記されている', () => {
        it('mutation.md に対応 lens/feature 表が含まれている', () => {
            const content = loadPrompt('mutation');
            // 対応 lens=ohlcv のみであることを明示
            expect(content).toContain('利用可能なエントリー条件');
            expect(content).toContain('対応 lens / feature');
            // 7 features 全て列挙
            expect(content).toContain('| `ohlcv` | `open` |');
            expect(content).toContain('| `ohlcv` | `high` |');
            expect(content).toContain('| `ohlcv` | `low` |');
            expect(content).toContain('| `ohlcv` | `close` |');
            expect(content).toContain('| `ohlcv` | `volume` |');
            expect(content).toContain('| `ohlcv` | `rsi` |');
            expect(content).toContain('| `ohlcv` | `atr` |');
            // alias 表記を許容
            expect(content).toContain("`lens='rsi', feature='value'`");
            expect(content).toContain("`lens='atr', feature='value'`");
            // 未対応 lens を明示禁止
            expect(content).toContain('サポート外');
            expect(content).toContain('ema');
            expect(content).toContain('macd');
            // 「常に true」条件の禁止例
            expect(content).toContain('常に true');
        });

        it('crossover.md に対応 lens/feature 表が含まれている', () => {
            const content = loadPrompt('crossover');
            expect(content).toContain('利用可能なエントリー条件');
            expect(content).toContain('対応 lens / feature');
            expect(content).toContain('| `ohlcv` | `rsi` |');
            expect(content).toContain('| `ohlcv` | `atr` |');
            // 親が未対応 lens を持つ場合の処理方針
            expect(content).toContain('対応 lens に置き換える');
            expect(content).toContain('常に true');
        });
    });
});
