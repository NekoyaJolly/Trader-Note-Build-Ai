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

    // Phase 5.5: ハードコード prompt 外部ファイル化 PR
    // agentLoop / reflectionAIService / researchAIService の system prompt を
    // src/side-b/prompts/*.md に移植したことを保証する。ファイル削除や rename で
    // 本番起動時に「Prompt file not found」になる事故を防ぐ。
    describe('Phase 5.5: ハードコードから移植した prompt が読める', () => {
        it('agent_loop_default.md を読み込める', () => {
            const content = loadPrompt('agent_loop_default');
            expect(content).toContain('Side-B AI Trade System');
            expect(content).toContain('PDCAサイクル');
            expect(content).toContain('リスクリワード比');
        });

        it('reflection.md を読み込める', () => {
            const content = loadPrompt('reflection');
            expect(content).toContain('FXトレードコーチ');
            expect(content).toContain('プロセスを評価');
            expect(content).toContain('JSONのみを出力');
        });

        it('research.md を読み込める', () => {
            const content = loadPrompt('research');
            expect(content).toContain('テクニカル特徴量を抽出');
            expect(content).toContain('再現性');
            expect(content).toContain('JSONのみを出力');
        });
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
    // PR #117e: 動的 indicator metadata 注入で構造変更 (静的 feature 表 + macro 注入)
    describe('PR #113 + #117e: mutation / crossover に対応 lens/feature 範囲が明記されている', () => {
        it('mutation.md に静的 ohlcv feature 表が含まれている', () => {
            const content = loadPrompt('mutation');
            // 対応 lens=ohlcv のみであることを明示
            expect(content).toContain('利用可能なエントリー条件');
            expect(content).toContain('静的 ohlcv feature');
            // 7 static features 全て列挙
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
            // 「常に true」条件の禁止例
            expect(content).toContain('常に true');
            // PR #113 Copilot review: ParamRef を value に使う場合は parameters 側で定義必須を注記
            expect(content).toContain('ParamRef を value に使う場合は');
            expect(content).toContain('parameters');
            // PR #117e: 動的 indicator metadata 注入 macro
            expect(content).toContain('{{INDICATOR_METADATA_TABLE}}');
            expect(content).toContain('動的パラメータ付き indicator');
            // PR #117e: PR #116 の新機能 (params / compareTarget) が変異の種類に追加されている
            expect(content).toContain('Condition.params');
            expect(content).toContain('compareTarget');
            // PR ⑤C: MTF / 状態遷移 op / multi-instance / wait_for_trigger / 戦略アーキタイプ
            // / 探索的変異 が prompt に明示されている (= 機能群を使い切れる prompt)
            expect(content).toContain('マルチタイムフレーム');
            expect(content).toContain('Condition.timeframe');
            expect(content).toContain('cross_above');
            expect(content).toContain('touch_close');
            expect(content).toContain('multi-instance');
            expect(content).toContain('wait_for_trigger');
            expect(content).toContain('探索的変異');
            expect(content).toContain('戦略アーキタイプの広がり');
        });

        it('crossover.md に静的 ohlcv feature 表 + macro 注入 + Filter Evolution M3 要素が含まれている', () => {
            const content = loadPrompt('crossover');
            expect(content).toContain('利用可能なエントリー条件');
            expect(content).toContain('静的 ohlcv feature');
            expect(content).toContain('| `ohlcv` | `rsi` |');
            expect(content).toContain('| `ohlcv` | `atr` |');
            expect(content).toContain('常に true');
            // PR #117e: 動的 indicator metadata 注入 macro
            expect(content).toContain('{{INDICATOR_METADATA_TABLE}}');
            expect(content).toContain('動的パラメータ付き indicator');
            expect(content).toContain('マルチタイムフレーム');
            // Filter Evolution M3: filter 追加器再設計 / 親 A の負けトレード文脈 / wrapper 出力 / ModuleParent
            expect(content).toContain('フィルタ追加器');
            expect(content).toContain('親A_loss_trades');
            expect(content).toContain('module_parents');
            expect(content).toContain('child_dsl');
            expect(content).toContain('rejected_loss_count');
            expect(content).toContain('preserved_win_count');
            expect(content).toContain('rationale');
        });
    });
});
