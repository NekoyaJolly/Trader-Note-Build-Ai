/**
 * プロンプトローダー
 *
 * 目的: src/side-b/prompts/ 配下のマークダウンファイルを
 *       システムプロンプトとして読み込み、マクロ展開する。
 *
 * 設計思想:
 * - エージェントのシステムプロンプトはコードにハードコードせず外部ファイル化。
 * - 将来の進化的探索でプロンプト自体を変異対象にできるようにするため。
 * - マクロ ({{CORE_TRADING_RULES}} 等) は呼び出し側で注入する。
 */

import fs from 'fs';
import path from 'path';

const PROMPTS_DIR = __dirname;

/**
 * プロンプト内の {{KEY}} プレースホルダーを展開するための辞書。
 * 必要に応じて新しいキーを追加していく。
 */
export interface PromptMacros {
    CORE_TRADING_RULES?: string;
    MACRO_ENVIRONMENT_RULES?: string;
    MTF_ANALYSIS_RULES?: string;
    [key: string]: string | undefined;
}

/**
 * 指定したプロンプトファイルを読み込み、マクロ展開した文字列を返す。
 *
 * @param name 拡張子なしのファイル名 (例: 'strategy_thinker')
 * @param macros プレースホルダー置換用の辞書 (省略可)
 * @returns 展開済みのプロンプト文字列
 * @throws ファイルが存在しない場合
 */
export function loadPrompt(name: string, macros?: PromptMacros): string {
    const filePath = path.join(PROMPTS_DIR, `${name}.md`);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Prompt file not found: ${name} (expected at ${filePath})`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return expandMacros(content, macros);
}

/**
 * 任意の文字列に対してマクロプレースホルダー `{{KEY}}` を展開する。
 *
 * Phase 6.7a: Registry 経由で取得したプロンプト本文など、ファイル読み込みを経ない
 * コンテンツにもマクロ展開を適用できるよう、展開ロジックを切り出した。
 *
 * - `macros` 未指定 or 空 → content をそのまま返す
 * - 値が undefined のキーは空文字列に置換(プレースホルダーを残さない)
 * - 展開はキー順の決定論的処理(依存しない前提だが、副次効果として再現性あり)
 */
export function expandMacros(content: string, macros?: PromptMacros): string {
    if (!macros) return content;
    let out = content;
    for (const [key, value] of Object.entries(macros)) {
        const placeholder = `{{${key}}}`;
        out = out.split(placeholder).join(value ?? '');
    }
    return out;
}
