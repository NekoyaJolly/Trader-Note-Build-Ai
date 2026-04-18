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

    let content = fs.readFileSync(filePath, 'utf-8');

    if (macros) {
        for (const [key, value] of Object.entries(macros)) {
            const placeholder = `{{${key}}}`;
            content = content.split(placeholder).join(value ?? '');
        }
    }

    return content;
}
